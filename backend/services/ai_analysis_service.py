"""Prepare snapshot-based evidence for authorized internal analysis; never expose directly as a route.

Per-reviewer ratings are deliberately absent from the serialized contract. Peer written
comments are included only once enough distinct colleagues wrote them, without reviewer
identity, in a fixed shuffled order and with people's names replaced.
Evidence IDs are locators, not authorization tokens: resolve them only after rechecking
reports access, campaign/evaluatee scope, and the same suppression rules.
"""

import hashlib
import re
from collections import Counter, defaultdict
from statistics import mean

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from services import question_analytics_service
from services import reporting_service
from services import section_scoring_service
from services.ai_analysis_models import (
    DataQualityWarning, EmployeeAnalysisContext,
    EvaluatorCategoryComparison, EvidenceReference,
    OverallStatistics, QualitativeEvidence, QuantitativeStatistics,
    QuestionEvidence, RatingDistributionBin, SectionStatistics,
)


def _issued_questions(snapshot: object) -> list[tuple[dict, int | None, str | None]]:
    """Accept only schema-v2 section and question blocks."""
    if not isinstance(snapshot, dict) or snapshot.get("schema_version") != 2 or not isinstance(snapshot.get("questions"), list):
        raise ValueError("unsupported_snapshot_schema")
    issued = []
    for block in snapshot["questions"]:
        if not isinstance(block, dict):
            raise ValueError("malformed_snapshot")
        if block.get("type") == "section":
            section_id, section, questions = block.get("section_id"), block.get("section"), block.get("questions")
            if (type(section_id) is not int or section_id <= 0 or not isinstance(section, dict)
                    or not isinstance(section.get("name"), str) or not section["name"].strip()
                    or not isinstance(questions, list)):
                raise ValueError("malformed_snapshot")
            issued.extend((question, section_id, section["name"]) for question in questions)
        elif block.get("type") == "question":
            issued.append((block.get("question"), None, None))
        else:
            raise ValueError("malformed_snapshot")
    ids = []
    for question, _, _ in issued:
        if (not isinstance(question, dict) or not isinstance(question.get("id"), str)
                or not question["id"].strip() or not isinstance(question.get("text"), str)
                or not question["text"].strip()):
            raise ValueError("malformed_snapshot")
        ids.append(question["id"])
    if len(ids) != len(set(ids)) or not ids:
        raise ValueError("malformed_snapshot")
    return issued


def _answers(answers: object) -> tuple[dict[str, object], set[str]]:
    values: dict[str, object] = {}
    duplicates: set[str] = set()
    if not isinstance(answers, list):
        return values, duplicates
    for answer in answers:
        if not isinstance(answer, dict) or not isinstance(answer.get("question_id"), str):
            continue
        question_id = answer["question_id"]
        if question_id in values:
            duplicates.add(question_id)
        values[question_id] = answer.get("value")
    return values, duplicates


MAX_COMMENT_CHARACTERS = 1500
LENGTHENED = {"a": "[aá]", "e": "[eé]"}


def redact_names(text: str, employee: str | None, colleagues: list[str]) -> str:
    """Replace people's names in a written comment, so the model cannot tie it to anyone.

    Full names and their parts (three letters or more) are matched case-sensitively, longest
    first, with any word ending attached (Hungarian suffixes: "Annával"). A part shared by the
    employee and a colleague (a common surname) counts as a colleague.
    """
    placeholders: dict[str, str] = {}
    for name, placeholder in [*((name, "[colleague]") for name in colleagues if name != employee),
                              *([(employee, "[the employee]")] if employee else [])]:
        full = " ".join(name.split())
        for part in [full, *full.split()]:
            if len(part) >= 3:
                placeholders.setdefault(part, placeholder)
    if not placeholders:
        return text
    ordered = sorted(placeholders, key=len, reverse=True)
    # Hungarian lengthens a final a/e before a suffix: Anna -> Annával, Gergely -> Gergelyé.
    alternatives = [f"({re.escape(part[:-1])}{LENGTHENED.get(part[-1], re.escape(part[-1]))})" for part in ordered]
    pattern = re.compile(rf"(?<!\w)(?:{'|'.join(alternatives)})\w*")
    return pattern.sub(lambda match: placeholders[ordered[match.lastindex - 1]], text)


def _statistics(observations: list[tuple[int, float, str]], *, minimum: int = 1) -> QuantitativeStatistics:
    if not observations:
        return QuantitativeStatistics(availability="no_data", answer_count=0)
    # Each observation is (original rating, unrounded normalized rating, source ID).
    if len(observations) < minimum:
        return QuantitativeStatistics(availability="suppressed")
    scores = [item[1] for item in observations]
    counts = Counter(item[0] for item in observations)
    return QuantitativeStatistics(
        availability="available", answer_count=len(observations),
        average_normalized=round(mean(scores), 2),
        original_distribution=[RatingDistributionBin(original_value=value, count=count) for value, count in sorted(counts.items())],
        evidence_ids=sorted({item[2] for item in observations}),
    )


def _section_stat(result: section_scoring_service.ScoreResult, evidence_ids: set[str]) -> QuantitativeStatistics:
    if result.availability != "available":
        return QuantitativeStatistics(availability=result.availability, answer_count=0 if result.availability == "no_data" else None)
    return QuantitativeStatistics(availability="available", answer_count=result.contributor_count,
                                   average_normalized=round(result.score, 2), evidence_ids=sorted(evidence_ids))


def build_employee_analysis_context(db: Session, campaign_id: int, employee_id: int, *,
                                    actor: models.User) -> EmployeeAnalysisContext:
    """Require an authenticated Reports actor; do not serialize this internal object to employee routes."""
    campaign = reporting_service.require_reports_access(campaign_id, actor, db)
    assert campaign is not None
    if db.query(models.Employee.id).filter(models.Employee.id == employee_id).first() is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    rows = db.query(models.FilledForm).filter(models.FilledForm.campaign_id == campaign_id, models.FilledForm.evaluatee_id == employee_id).order_by(models.FilledForm.id).all()
    # Match Reports' object boundary: assigned evaluatees or assigned-group members.
    groups = [group.id for group in reporting_service.assigned_campaign_groups(campaign_id, db)]
    member = (db.query(models.employee_company_groups.c.employee_id).filter(
        models.employee_company_groups.c.employee_id == employee_id,
        models.employee_company_groups.c.company_group_id.in_(groups),
    ).first() if groups else None)
    if not rows and member is None:
        raise HTTPException(status_code=404, detail="Employee is not part of this campaign report")

    warnings: list[DataQualityWarning] = []
    scored = []
    definitions: dict[str, dict] = {}
    observations: dict[tuple[str, str], list[tuple[int, float, str]]] = defaultdict(list)
    references: dict[str, EvidenceReference] = {}
    text_evidence: list[QualitativeEvidence] = []
    section_names: dict[int, str] = {}
    section_refs: dict[tuple[int, str], set[str]] = defaultdict(set)
    evaluator_by_form: dict[int, int] = {}
    latest_section_form: dict[tuple[int, str, int], tuple[object, int]] = {}
    peer_text: list[tuple[EvidenceReference, str, int]] = []
    for assignment in rows:
        if assignment.finish_date is None:
            continue
        try:
            issued = _issued_questions(assignment.form_snapshot)
        except ValueError:
            continue
        if not isinstance(assignment.answers, list):
            continue
        category = "self" if assignment.evaluator_id == employee_id else "peer"
        evaluator_by_form[assignment.id] = assignment.evaluator_id
        answers, duplicates = _answers(assignment.answers)
        for question, section_id, section_name in issued:
            if section_id is not None:
                section_names.setdefault(section_id, section_name)
            definition = question_analytics_service._definition(question, section_id)
            if definition is None:
                continue
            key, metadata = definition
            definitions.setdefault(key, {**metadata, "section_name": section_name,
                                         "min_label": question.get("min_label") if isinstance(question.get("min_label"), str) else None,
                                         "max_label": question.get("max_label") if isinstance(question.get("max_label"), str) else None})
            question_id = question["id"]
            if question_id in duplicates or question_id not in answers:
                continue
            value = answers[question_id]
            evidence_type = "rating" if metadata["category"] == "rating" else "text"
            evidence_id = f"form:{assignment.id}:question:{question_id}:{evidence_type}"
            reference = EvidenceReference(evidence_id=evidence_id, filled_form_id=assignment.id,
                                          question_id=question_id, question_text=question["text"],
                                          section_id=section_id, section_name=section_name, category=category)
            if metadata["category"] == "rating":
                normalized = (section_scoring_service.normalize_rating(value, metadata["scale_min"], metadata["scale_max"])
                              if type(value) is int else None)
                if normalized is None:
                    continue
                observations[(key, category)].append((value, normalized, evidence_id))
                if category == "self":
                    reference.original_value = value
                    reference.normalized_value = round(normalized, 2)
                references[evidence_id] = reference
                if section_id is not None:
                    section_refs[(section_id, category)].add(evidence_id)
            elif metadata["category"] == "text" and isinstance(value, str) and value.strip() and category == "self":
                references[evidence_id] = reference
                text_evidence.append(QualitativeEvidence(reference=reference, response_text=value))
            elif metadata["category"] == "text" and isinstance(value, str) and value.strip() and category == "peer":
                peer_text.append((reference, value.strip(), assignment.evaluator_id))
        # Section scores come from the same scoring as Reports; this loop only collects the evidence behind them.
        evaluation = section_scoring_service.score_evaluation(assignment)
        scored.append(evaluation)
        for section_id in evaluation.sections:
            key = (section_id, category, assignment.evaluator_id)
            candidate = (assignment.finish_date, assignment.id)
            if key not in latest_section_form or candidate > latest_section_form[key]:
                latest_section_form[key] = candidate

    # Colleagues' comments count only when enough different people wrote them, like peer scores.
    peer_authors = {author for _, _, author in peer_text}
    peer_text_released = len(peer_authors) >= reporting_service.min_individual_peer_reviewers()
    if peer_text_released:
        people = db.query(models.Employee.id, models.Employee.full_name).all()
        employee_name = next((name for person_id, name in people if person_id == employee_id), None)
        colleagues = [name for _, name in people if name]
        for reference, text, author in sorted(peer_text, key=lambda item: hashlib.sha256(item[0].evidence_id.encode()).hexdigest()):
            references[reference.evidence_id] = reference
            text_evidence.append(QualitativeEvidence(
                reference=reference, response_text=redact_names(text[:MAX_COMMENT_CHARACTERS], employee_name, colleagues),
                author_key=hashlib.sha256(f"{campaign_id}:{author}".encode()).hexdigest()[:16]))

    results = section_scoring_service.employee_scores(scored, campaign_id, employee_id)
    released_peer_keys = {item["key"] for item in question_analytics_service.build_question_report(
        campaign_id, actor, db, employee_id=employee_id, evaluation_type="peer")["questions"]
        if item["availability"] == "available"}
    questions = []
    released_ids: set[str] = set()
    for key, definition in sorted(definitions.items()):
        peer_items = observations[(key, "peer")]
        peer_reviewers = {evaluator_by_form[references[item[2]].filled_form_id] for item in peer_items}
        peer = _statistics(peer_items, minimum=reporting_service.min_individual_peer_reviewers()
                            if len(peer_reviewers) >= reporting_service.min_individual_peer_reviewers() else len(peer_items) + 1)
        if peer.availability == "available" and key not in released_peer_keys:
            peer = QuantitativeStatistics(availability="suppressed")
        self_result = _statistics(observations[(key, "self")])
        released_ids.update(peer.evidence_ids + self_result.evidence_ids)
        if definition["category"] != "rating":
            continue
        questions.append(QuestionEvidence(question_key=key, question_text=definition["text"], question_type=definition["type"],
                                          section_id=definition["section_id"], section_name=definition["section_name"],
                                          scale_min=definition["scale_min"], scale_max=definition["scale_max"],
                                          min_label=definition.get("min_label"), max_label=definition.get("max_label"),
                                          peer=peer, self_evaluation=self_result))

    sections = []
    comparisons = []
    for section_id in sorted(results.peer_sections):
        peer_forms = {value[1] for (section, category, _), value in latest_section_form.items()
                      if section == section_id and category == "peer"}
        self_forms = {value[1] for (section, category, _), value in latest_section_form.items()
                      if section == section_id and category == "self"}
        peer_refs = {ref for ref in section_refs[(section_id, "peer")] if references[ref].filled_form_id in peer_forms}
        self_refs = {ref for ref in section_refs[(section_id, "self")] if references[ref].filled_form_id in self_forms}
        peer = _section_stat(results.peer_sections[section_id], peer_refs)
        self_result = _section_stat(results.self_sections[section_id], self_refs)
        released_ids.update(peer.evidence_ids + self_result.evidence_ids)
        sections.append(SectionStatistics(section_id=section_id, section_name=section_names.get(section_id, "Unnamed section"),
                                          peer=peer, self_evaluation=self_result))
        if peer.average_normalized is not None and self_result.average_normalized is not None:
            raw_peer = results.peer_sections[section_id].score
            raw_self = results.self_sections[section_id].score
            comparisons.append(EvaluatorCategoryComparison(section_id=section_id, peer_average=round(raw_peer, 2),
                                                             self_average=round(raw_self, 2), self_minus_peer=round(raw_self - raw_peer, 2),
                                                             evidence_ids=sorted(set(peer.evidence_ids + self_result.evidence_ids))))
    peer_ids = {ref for section in sections if section.peer.availability == "available" for ref in section.peer.evidence_ids}
    self_ids = {ref for section in sections if section.self_evaluation.availability == "available" for ref in section.self_evaluation.evidence_ids}
    overall = OverallStatistics(peer=_section_stat(results.overall_peer, peer_ids),
                                self_evaluation=_section_stat(results.overall_self, self_ids))
    if peer_text and not peer_text_released:
        warnings.append(DataQualityWarning(code="peer_text_withheld", message="Colleagues' written comments are left out: fewer than two colleagues wrote one."))
    if any(question.peer.availability == "suppressed" for question in questions) or any(section.peer.availability == "suppressed" for section in sections):
        warnings.append(DataQualityWarning(code="insufficient_peer_reviewers", message="Peer results with fewer than two distinct reviewers are suppressed."))
    visible_evidence = released_ids | {item.reference.evidence_id for item in text_evidence}
    return EmployeeAnalysisContext(
        campaign_id=campaign_id, evaluatee_employee_id=employee_id,
        questions=questions, sections=sections, overall=overall, comparisons=comparisons,
        qualitative_evidence=text_evidence,
        evidence_references=[references[key] for key in sorted(visible_evidence)],
        warnings=warnings,
    )

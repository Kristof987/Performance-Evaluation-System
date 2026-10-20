"""Prepare snapshot-based evidence for authorized internal analysis; never expose directly as a route.

Peer text and per-reviewer ratings are deliberately absent from the serialized contract.
Evidence IDs are locators, not authorization tokens: resolve them only after rechecking
reports access, campaign/evaluatee scope, and the same suppression rules.
"""

from collections import Counter, defaultdict
from datetime import datetime, timezone
from statistics import mean

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
import question_analytics_service
import reporting_service
import section_scoring_service
from ai_analysis_models import (
    CampaignAnalysisMetadata, DataQualityWarning, EmployeeAnalysisContext,
    EvaluationSource, EvaluatorCategoryComparison, EvidenceReference,
    OverallStatistics, QualitativeEvidence, QuantitativeStatistics,
    QuestionEvidence, RatingDistributionBin, SectionStatistics,
)


def _issued_questions(snapshot: object) -> list[tuple[dict, int | None, str | None]]:
    """Accept v2 blocks and its explicitly supported historical flat-question layout."""
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
        elif "text" in block:  # Historical flat question in a v2 issued snapshot.
            issued.append((block, None, None))
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
        minimum_normalized=round(min(scores), 2), maximum_normalized=round(max(scores), 2),
        normalized_range=round(max(scores) - min(scores), 2) if len(scores) >= 3 else None,
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
    rows = db.query(models.FilledForm, models.FormStatus.name).join(
        models.FormStatus, models.FormStatus.id == models.FilledForm.status_id,
    ).filter(models.FilledForm.campaign_id == campaign_id, models.FilledForm.evaluatee_id == employee_id).order_by(models.FilledForm.id).all()
    # Match Reports' object boundary: assigned evaluatees or assigned-group members.
    groups = [group.id for group in reporting_service.assigned_campaign_groups(campaign_id, db)]
    member = (db.query(models.employee_company_groups.c.employee_id).filter(
        models.employee_company_groups.c.employee_id == employee_id,
        models.employee_company_groups.c.company_group_id.in_(groups),
    ).first() if groups else None)
    if not rows and member is None:
        raise HTTPException(status_code=404, detail="Employee is not part of this campaign report")

    warnings: list[DataQualityWarning] = []
    sources: list[EvaluationSource] = []
    scored = []
    definitions: dict[str, dict] = {}
    observations: dict[tuple[str, str], list[tuple[int, float, str]]] = defaultdict(list)
    references: dict[str, EvidenceReference] = {}
    text_evidence: list[QualitativeEvidence] = []
    section_names: dict[int, str] = {}
    section_refs: dict[tuple[int, str], set[str]] = defaultdict(set)
    evaluator_by_form: dict[int, int] = {}
    latest_section_form: dict[tuple[int, str, int], tuple[object, int]] = {}
    structures: set[tuple[str, ...]] = set()
    withheld_peer_text = False
    for assignment, status in rows:
        # Unlike status_key, a finish date alone does not prove submission.
        if (status.strip().lower() not in reporting_service.COMPLETED_STATUSES
                or assignment.finish_date is None):
            continue
        try:
            issued = _issued_questions(assignment.form_snapshot)
        except ValueError as error:
            warnings.append(DataQualityWarning(code=str(error), message="A submitted evaluation has no usable issued questionnaire snapshot."))
            continue
        if not isinstance(assignment.answers, list):
            warnings.append(DataQualityWarning(code="malformed_answers", message="A submitted evaluation has malformed answers."))
            continue
        category = "self" if assignment.evaluator_id == employee_id else "peer"
        snapshot = assignment.form_snapshot
        form_name = snapshot.get("form_name")
        sources.append(EvaluationSource(filled_form_id=assignment.id, questionnaire_name=form_name if isinstance(form_name, str) and form_name.strip() else "Issued questionnaire",
                                        snapshot_schema_version=2, category=category))
        evaluator_by_form[assignment.id] = assignment.evaluator_id
        answers, duplicates = _answers(assignment.answers)
        structure = []
        form_sections: dict[int, list[float]] = defaultdict(list)
        for question, section_id, section_name in issued:
            if section_id is not None:
                if section_id in section_names and section_names[section_id] != section_name:
                    warnings.append(DataQualityWarning(code="different_section_names", message="Issued Section names differ between questionnaires."))
                section_names.setdefault(section_id, section_name)
            if (question.get("type") in section_scoring_service.RATING_TYPES
                    and question.get("scale_direction", "higher_is_better") != "higher_is_better"):
                warnings.append(DataQualityWarning(code="unsupported_scale_direction", message="A rating with an unsupported scale direction was excluded."))
                continue
            definition = question_analytics_service._definition(question, section_id)
            if definition is None:
                warnings.append(DataQualityWarning(code="unsupported_question", message="An issued question cannot be interpreted for analysis."))
                continue
            key, metadata = definition
            structure.append(key)
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
                    warnings.append(DataQualityWarning(code="invalid_rating", message="An invalid submitted rating was excluded."))
                    continue
                observations[(key, category)].append((value, normalized, evidence_id))
                if category == "self":
                    reference.original_value = value
                    reference.normalized_value = round(normalized, 2)
                references[evidence_id] = reference
                if section_id is not None:
                    form_sections[section_id].append(normalized)
                    section_refs[(section_id, category)].add(evidence_id)
            elif metadata["category"] == "text" and isinstance(value, str) and value.strip() and category == "self":
                references[evidence_id] = reference
                text_evidence.append(QualitativeEvidence(reference=reference, response_text=value))
            elif metadata["category"] == "text" and isinstance(value, str) and value.strip() and category == "peer":
                withheld_peer_text = True
        structures.add(tuple(sorted(structure)))
        scored.append(section_scoring_service.EvaluationSections(
            assignment.id, campaign_id, assignment.evaluator_id, employee_id, assignment.company_group_id,
            assignment.finish_date, frozenset(section_id for _, section_id, _ in issued if section_id is not None),
            {section_id: mean(values) for section_id, values in form_sections.items()},
        ))
        for section_id in form_sections:
            key = (section_id, category, assignment.evaluator_id)
            candidate = (assignment.finish_date, assignment.id)
            if key not in latest_section_form or candidate > latest_section_form[key]:
                latest_section_form[key] = candidate

    if len(structures) > 1:
        warnings.append(DataQualityWarning(code="different_questionnaires", message="Issued questionnaires contain different question structures; only matching questions are aggregated."))
    if not sources:
        warnings.append(DataQualityWarning(code="no_submitted_evaluations", message="No submitted evaluation has a valid issued snapshot."))
    results = section_scoring_service.employee_scores(scored, campaign_id, employee_id)
    questions = []
    released_ids: set[str] = set()
    for key, definition in sorted(definitions.items()):
        peer_items = observations[(key, "peer")]
        peer_reviewers = {evaluator_by_form[references[item[2]].filled_form_id] for item in peer_items}
        peer = _statistics(peer_items, minimum=reporting_service.MIN_INDIVIDUAL_PEER_REVIEWERS
                           if len(peer_reviewers) >= reporting_service.MIN_INDIVIDUAL_PEER_REVIEWERS else len(peer_items) + 1)
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
        sections.append(SectionStatistics(section_id=section_id, section_name=section_names.get(section_id, "Archived section"),
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
    if not any(question.peer.availability == "available" or question.self_evaluation.availability == "available" for question in questions):
        warnings.append(DataQualityWarning(code="missing_quantitative_data", message="No reportable quantitative responses are available."))
    if not text_evidence:
        warnings.append(DataQualityWarning(code="no_qualitative_feedback", message="No releasable written feedback is available; peer raw text is withheld by Reports policy."))
    if withheld_peer_text:
        warnings.append(DataQualityWarning(code="peer_text_withheld", message="Raw peer written feedback is withheld by Reports policy."))
    if any(question.peer.availability == "suppressed" for question in questions) or any(section.peer.availability == "suppressed" for section in sections):
        warnings.append(DataQualityWarning(code="insufficient_peer_reviewers", message="Peer results with fewer than two distinct reviewers are suppressed."))
    visible_evidence = released_ids | {item.reference.evidence_id for item in text_evidence}
    visible_forms = {references[key].filled_form_id for key in visible_evidence}
    return EmployeeAnalysisContext(
        campaign_id=campaign_id, evaluatee_employee_id=employee_id, submitted_evaluation_count=len(sources),
        metadata=CampaignAnalysisMetadata(campaign_id=campaign_id, campaign_name=campaign.name,
                                          lifecycle_status=campaign.status, analyzed_at=datetime.now(timezone.utc)),
        sources=[source for source in sources if source.category == "self" or source.filled_form_id in visible_forms],
        questions=questions, sections=sections, overall=overall, comparisons=comparisons,
        qualitative_evidence=text_evidence,
        evidence_references=[references[key] for key in sorted(visible_evidence)],
        warnings=warnings,
    )

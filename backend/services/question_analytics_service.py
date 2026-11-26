"""Snapshot-only, raw-answer Reports distributions; independent of Section scoring."""

from collections import Counter, defaultdict
from dataclasses import dataclass
from hashlib import sha256
import json
from statistics import mean
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from services import permissions, reporting_service
from services.section_scoring_service import normalize_rating, rating_range


@dataclass(frozen=True)
class Observation:
    assignment_id: int
    evaluatee_id: int
    evaluator_id: int
    group_id: int | None
    role_id: int | None
    key: str
    value: Any


def _options(question: dict) -> list[dict]:
    """Issued choice options: validated before issuing to be at least two, each with a unique id and a label."""
    # Generated option IDs identify issued answers, not cross-Form semantics.
    return [{"value": option["id"], "label": option["label"],
             "definition": {k: v for k, v in option.items() if k not in {"id", "value"}}} for option in question["options"]]


def _definition(question: dict, section_id: int | None) -> tuple[str, dict]:
    """A question's content key (stable across campaigns while the question is unchanged) and its metadata."""
    kind, text = question["type"], question["text"]
    bounds, options = rating_range(question), []
    if kind == "Scale":
        category, config = "rating", {"bounds": bounds}
    elif kind in {"Single choice", "Multiple choice"}:
        options = _options(question)
        category, config = "choice", {"options": [item["definition"] for item in options]}
    else:
        category, config = "text", {}
    # Include issued answer-domain metadata, not presentation/order, UUIDs or requiredness.
    excluded = {"id", "text", "type", "required", "options", "scale_min", "scale_max", "section_id"}
    config.update({key: value for key, value in question.items() if key not in excluded})
    identity = [kind, " ".join(text.split()).casefold(), section_id, config]
    canonical = json.dumps(identity, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    key = sha256(canonical.encode("utf-8")).hexdigest()
    return key, {"key": key, "text": text.strip(), "type": kind, "category": category, "section_id": section_id,
                 "scale_min": bounds[0] if bounds else None, "scale_max": bounds[1] if bounds else None,
                 "options": [{"label": option["label"], "value": option["value"]} for option in options]}


def _collect(rows: list[Any], db: Session, *, include_text: bool = False):
    """Issued questions and submitted answers; both were validated against the snapshot when saved."""
    definitions: dict[str, dict] = {}
    observations: list[Observation] = []
    issued_scopes: dict[str, set[tuple[int | None, int | None, int, str]]] = defaultdict(set)
    roles = {employee_id: role.id for employee_id, (_employee, role) in reporting_service.users_by_id(db).items()}
    for assignment, _form in rows:
        snapshot = assignment.form_snapshot
        # Unissued assignments have no snapshot; pre-v2 list snapshots stay out of Reports.
        if not snapshot or snapshot.get("schema_version") != 2:
            continue
        issued: list[tuple[dict, int | None]] = []
        names: dict[int, str | None] = {}
        for block in snapshot["questions"]:
            if block["type"] == "section":
                names[block["section_id"]] = (block.get("section") or {}).get("name")
                issued.extend((question, block["section_id"]) for question in block["questions"])
            else:
                issued.append((block["question"], None))
        answers = {answer["question_id"]: answer["value"] for answer in assignment.answers} if assignment.finish_date is not None else {}
        role_id = reporting_service.assignment_role_id(assignment, roles)
        evaluation_type = "self" if assignment.evaluator_id == assignment.evaluatee_id else "peer"
        for question, section_id in issued:
            key, metadata = _definition(question, section_id)
            metadata["section_name"] = names.get(section_id) if section_id is not None else "Other questions"
            definitions.setdefault(key, metadata)
            issued_scopes[key].add((assignment.company_group_id, role_id, assignment.evaluatee_id, evaluation_type))
            if question["id"] not in answers:
                continue
            value = answers[question["id"]]
            if metadata["category"] == "choice":
                # Option positions, matched through this snapshot's own option IDs.
                positions = {option["id"]: index for index, option in enumerate(question["options"])}
                value = [positions[item] for item in value] if isinstance(value, list) else positions[value]
            elif metadata["category"] == "text" and not include_text:
                value = True  # Ordinary analytics retains availability, not written feedback.
            observations.append(Observation(assignment.id, assignment.evaluatee_id, assignment.evaluator_id,
                                            assignment.company_group_id, role_id, key, value))
    # Issued names win so a rename does not relabel past campaigns; the catalog only fills gaps.
    unnamed = {definition["section_id"] for definition in definitions.values()
               if definition["section_id"] is not None and not definition["section_name"]}
    section_names = {section.id: section.name for section in db.query(models.Section).filter(models.Section.id.in_(unnamed)).all()} if unnamed else {}
    for definition in definitions.values():
        if definition["section_id"] is not None and not definition["section_name"]:
            definition["section_name"] = section_names.get(definition["section_id"], reporting_service.UNNAMED_SECTION)
    return definitions, observations, issued_scopes


def _released(metadata: dict, items: list[Observation], availability: str) -> dict:
    result = {**{field: value for field, value in metadata.items() if field != "options"},
              "availability": availability, "response_count": None if availability == "suppressed" else len(items),
              "average_normalized": None, "distribution": None, "distribution_kind": None}
    if availability != "available":
        return result
    if metadata["category"] == "rating":
        minimum, maximum = metadata["scale_min"], metadata["scale_max"]
        counts = Counter(item.value for item in items)
        result["average_normalized"] = round(mean(normalize_rating(item.value, minimum, maximum) for item in items), 2)
        result["distribution_kind"] = "original"
        result["distribution"] = [{"label": str(value), "count": counts[value], "percentage": round(100 * counts[value] / len(items), 1)}
                                  for value in range(minimum, maximum + 1)]
    elif metadata["category"] == "choice":
        counts = Counter(choice for item in items for choice in (item.value if isinstance(item.value, list) else [item.value]))
        result["distribution_kind"] = "options"
        result["distribution"] = [{"label": option["label"], "count": counts[index],
                                   "percentage": round(100 * counts[index] / len(items), 1)} for index, option in enumerate(metadata["options"])]
    return result


def _peer_release_allowed(cohort: list[Observation], *, single_employee: bool) -> bool:
    """Colleagues' answers are shown only behind enough distinct reviewers.

    An employee needs at least the minimum number of reviewers. A group, role or campaign
    also needs enough evaluated employees, and every one of them enough reviewers: otherwise
    the cohort total minus the other employees' visible results would reveal a single answer.
    """
    reviewers = reporting_service.min_individual_peer_reviewers()
    by_employee: dict[int, set[int]] = defaultdict(set)
    for item in cohort:
        by_employee[item.evaluatee_id].add(item.evaluator_id)
    return (all(len(evaluators) >= reviewers for evaluators in by_employee.values())
            and (single_employee or len(by_employee) >= reporting_service.min_aggregate_evaluatees()))


def _self_release_allowed(cohort: list[Observation], *, single_employee: bool) -> bool:
    """One employee's own answers are shown; a cohort's only with enough employees."""
    return single_employee or len({item.evaluatee_id for item in cohort}) >= reporting_service.min_aggregate_evaluatees()


@dataclass(frozen=True)
class Prepared:
    """One campaign's questions and answers, collected once for any number of question reports."""
    campaign_id: int
    rows: list[Any]
    aggregate_access: bool
    definitions: dict[str, dict]
    observations: list[Observation]
    issued_scopes: dict[str, set[tuple]]


def prepare(campaign_id: int, actor: models.User, db: Session) -> Prepared:
    reporting_service.require_reports_access(campaign_id, actor, db)
    rows = reporting_service.campaign_report_rows(campaign_id, db)
    return Prepared(campaign_id, rows, permissions.has_permission(actor, db, "campaigns.manage"), *_collect(rows, db))


def build_question_report(campaign_id: int, actor: models.User, db: Session, *, group_id: int | None = None,
                          role_id: int | None = None, employee_id: int | None = None,
                          evaluation_type: str = "peer", prepared: Prepared | None = None) -> dict:
    prepared = prepared or prepare(campaign_id, actor, db)
    if group_id is not None and group_id not in {group.id for group in reporting_service.assigned_campaign_groups(campaign_id, db)}:
        raise HTTPException(status_code=404, detail="Group report not found")
    if role_id is not None and db.get(models.CompanyRole, role_id) is None:
        raise HTTPException(status_code=404, detail="Role report not found")
    if employee_id is not None and employee_id not in reporting_service.campaign_participant_ids(campaign_id, prepared.rows, db):
        raise HTTPException(status_code=404, detail="Employee is not part of this campaign report")
    allowed = _self_release_allowed if evaluation_type == "self" else _peer_release_allowed
    by_question: dict[str, list[Observation]] = defaultdict(list)
    for item in prepared.observations:
        by_question[item.key].append(item)
    questions = []
    for key, metadata in prepared.definitions.items():
        issued = [scope for scope in prepared.issued_scopes[key] if scope[3] == evaluation_type
                  and (group_id is None or scope[0] == group_id)
                  and (role_id is None or scope[1] == role_id)
                  and (employee_id is None or scope[2] == employee_id)]
        if not issued:
            continue
        population = [item for item in by_question[key]
                      if (item.evaluator_id == item.evaluatee_id) == (evaluation_type == "self")]
        cohort = [item for item in population if (group_id is None or item.group_id == group_id)
                  and (role_id is None or item.role_id == role_id)
                  and (employee_id is None or item.evaluatee_id == employee_id)]
        availability = ("no_data" if not cohort else
                        "available" if prepared.aggregate_access or allowed(cohort, single_employee=employee_id is not None)
                        else "suppressed")
        questions.append(_released(metadata, cohort, availability))
    questions.sort(key=lambda item: (item["section_id"] is None, item["section_name"].casefold(), item["text"].casefold(), item["key"]))
    return {"evaluation_type": evaluation_type, "questions": questions}


def build_rating_distribution_report(campaign_id: int, actor: models.User, db: Session) -> dict:
    """Re-bin only already-released peer-question counts; never infer suppressed answers."""
    questions = build_question_report(campaign_id, actor, db, evaluation_type="peer")["questions"]
    bins = ((0, 1), (1, 2), (2, 3), (3, 4), (4, 5))

    def release(items: list[dict], section_id: int | None) -> dict:
        counts = [0] * len(bins)
        released = False
        for question in items:
            if question["availability"] != "available" or question["distribution_kind"] != "original":
                continue
            released = True
            for bucket in question["distribution"]:
                value = normalize_rating(int(bucket["label"]), question["scale_min"], question["scale_max"])
                counts[min(4, int(value))] += bucket["count"]
        total = sum(counts)
        if not released or total == 0:
            return {"section_id": section_id, "availability": "suppressed" if any(item["availability"] == "suppressed" for item in items) else "no_data",
                    "response_count": None, "bins": None}
        return {"section_id": section_id, "availability": "available", "response_count": total,
                "bins": [{"label": f"{low}-<{high}" if high < 5 else "4-5", "count": count,
                          "percentage": round(100 * count / total, 1)}
                         for (low, high), count in zip(bins, counts)]}

    ratings = [question for question in questions if question["category"] == "rating"]
    section_ids = sorted({question["section_id"] for question in ratings if question["section_id"] is not None})
    return {"campaign": release(ratings, None),
            "sections": [release([question for question in ratings if question["section_id"] == section_id], section_id)
                         for section_id in section_ids]}

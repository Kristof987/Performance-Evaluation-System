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
import reporting_service
from section_scoring_service import RATING_TYPES, _rating_range, normalize_rating


@dataclass(frozen=True)
class Observation:
    assignment_id: int
    evaluatee_id: int
    evaluator_id: int
    group_id: int | None
    role_id: int | None
    evaluator_role_id: int | None
    key: str
    value: Any


def _options(question: dict) -> list[dict] | None:
    raw = question.get("options", question.get("choices"))
    if not isinstance(raw, list) or len(raw) < 2:
        return None
    options = []
    for option in raw:
        if isinstance(option, str):
            options.append({"value": option, "label": option, "definition": {"label": option}})
        elif isinstance(option, dict):
            value = next((option[field] for field in ("id", "value", "label") if isinstance(option.get(field), str)), None)
            label = option.get("label")
            if not isinstance(value, str) or not isinstance(label, str):
                return None
            # Generated option IDs identify issued answers, not cross-Form semantics.
            definition = {k: v for k, v in option.items() if k not in {"id", "value"}}
            options.append({"value": value, "label": label, "definition": definition})
        else:
            return None
    if len({item["value"] for item in options}) != len(options):
        return None
    return options


def _definition(question: dict, section_id: int | None) -> tuple[str, dict] | None:
    kind, text = question.get("type"), question.get("text")
    if not isinstance(text, str) or not text.strip():
        return None
    if kind in RATING_TYPES:
        bounds = _rating_range(question)
        if bounds is None:
            return None
        category = "rating"
        config: dict[str, Any] = {"bounds": bounds}
    elif kind in {"Single choice", "Multiple choice"}:
        options = _options(question)
        if options is None:
            return None
        category = "choice"
        config = {"options": [item["definition"] for item in options]}
    elif kind == "Text":
        category = "text"
        config = {}
    else:
        return None
    # Include issued answer-domain metadata, not presentation/order, UUIDs or requiredness.
    excluded = {"id", "text", "type", "required", "options", "choices", "scale_min", "scale_max",
                "dimension", "dimension_id", "dimensionId", "section_id"}
    config.update({key: value for key, value in question.items() if key not in excluded})
    identity = [kind, " ".join(text.split()).casefold(), section_id, config]
    canonical = json.dumps(identity, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    key = sha256(canonical.encode("utf-8")).hexdigest()
    return key, {"key": key, "text": text.strip(), "type": kind, "category": category,
                 "section_id": section_id, "required": bool(question.get("required")),
                 "required_modes": ["required" if question.get("required") else "optional"],
                 "scale_min": bounds[0] if category == "rating" else None,
                 "scale_max": bounds[1] if category == "rating" else None,
                 "options": [{"label": option["label"], "value": option["value"]} for option in options] if category == "choice" else []}


def _collect(rows: list[Any], db: Session):
    definitions: dict[str, dict] = {}
    observations: list[Observation] = []
    issued_scopes: dict[str, set[tuple[int | None, int | None, int | None, int]]] = defaultdict(set)
    section_ids: set[int] = set()
    roles = {employee_id: role.id for employee_id, (_employee, role) in reporting_service.users_by_id(db).items()}
    seen_assignments: set[int] = set()
    for assignment, _form, status in rows:
        if assignment.id in seen_assignments or reporting_service.status_key(status, assignment.finish_date) != "completed":
            continue
        seen_assignments.add(assignment.id)
        snapshot = assignment.form_snapshot
        if not isinstance(snapshot, dict) or snapshot.get("schema_version") != 2 or not isinstance(snapshot.get("questions"), list):
            continue
        blocks = snapshot["questions"]
        issued: list[tuple[dict, int | None]] = []
        names: dict[int, str] = {}
        for block in blocks:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "section":
                section_id = block.get("section_id")
                if isinstance(section_id, bool) or not isinstance(section_id, int) or section_id <= 0:
                    continue
                metadata = block.get("section")
                if isinstance(metadata, dict) and isinstance(metadata.get("name"), str):
                    names[section_id] = metadata["name"]
                questions = block.get("questions")
                if isinstance(questions, list):
                    issued.extend((question, section_id) for question in questions if isinstance(question, dict))
            elif block.get("type") == "question" and isinstance(block.get("question"), dict):
                issued.append((block["question"], None))
        ids = Counter(question.get("id") for question, _ in issued if isinstance(question.get("id"), str))
        answers: dict[str, Any] = {}
        repeated: set[str] = set()
        for answer in assignment.answers if isinstance(assignment.answers, list) else []:
            if not isinstance(answer, dict) or not isinstance(answer.get("question_id"), str):
                continue
            question_id = answer["question_id"]
            if question_id in answers:
                repeated.add(question_id)
            answers[question_id] = answer.get("value")
        for question, section_id in issued:
            question_id = question.get("id")
            if not isinstance(question_id, str) or ids[question_id] != 1:
                continue
            definition = _definition(question, section_id)
            if definition is None:
                continue
            key, metadata = definition
            if section_id is not None:
                section_ids.add(section_id)
                metadata["section_name"] = names.get(section_id, "Archived section")
            else:
                metadata["section_name"] = "Other questions"
            definitions.setdefault(key, metadata)
            mode = metadata["required_modes"][0]
            if mode not in definitions[key]["required_modes"]:
                definitions[key]["required_modes"].append(mode)
            issued_scopes[key].add((assignment.company_group_id, roles.get(assignment.evaluatee_id),
                                    roles.get(assignment.evaluator_id), assignment.evaluatee_id))
            if question_id not in answers or question_id in repeated:
                continue
            value = answers[question_id]
            category = metadata["category"]
            if category == "rating":
                valid = isinstance(value, int) and not isinstance(value, bool) and normalize_rating(value, metadata["scale_min"], metadata["scale_max"]) is not None
            elif category == "choice":
                allowed = {option["value"] for option in metadata["options"]}
                valid = (isinstance(value, str) and value in allowed if question["type"] == "Single choice" else
                         isinstance(value, list) and bool(value) and all(isinstance(item, str) and item in allowed for item in value) and len(value) == len(set(value)))
                if valid:
                    positions = {option["value"]: index for index, option in enumerate(metadata["options"])}
                    value = [positions[item] for item in value] if isinstance(value, list) else positions[value]
            else:
                valid = isinstance(value, str) and bool(value.strip())
                if valid:
                    value = True  # Count availability without retaining written feedback in analytics observations.
            if valid:
                observations.append(Observation(assignment.id, assignment.evaluatee_id, assignment.evaluator_id,
                                                assignment.company_group_id, roles.get(assignment.evaluatee_id),
                                                roles.get(assignment.evaluator_id), key, value))
    section_names = {section.id: section.name for section in db.query(models.Section).filter(models.Section.id.in_(section_ids)).all()} if section_ids else {}
    for definition in definitions.values():
        if definition["section_id"] in section_names:
            definition["section_name"] = section_names[definition["section_id"]]
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


def build_question_report(campaign_id: int, actor: models.User, db: Session, *, group_id: int | None = None,
                          role_id: int | None = None, employee_id: int | None = None,
                          perspective: str = "evaluatee", evaluation_type: str = "peer") -> dict:
    reporting_service.require_reports_access(campaign_id, actor, db)
    if group_id is not None and group_id not in {group.id for group in reporting_service.assigned_campaign_groups(campaign_id, db)}:
        raise HTTPException(status_code=404, detail="Group report not found")
    if role_id is not None and db.query(models.CompanyRole).filter(models.CompanyRole.id == role_id).first() is None:
        raise HTTPException(status_code=404, detail="Role report not found")
    rows = reporting_service.campaign_report_rows(campaign_id, db)
    if employee_id is not None and employee_id not in reporting_service.campaign_participant_ids(campaign_id, rows, db):
        raise HTTPException(status_code=404, detail="Employee is not part of this campaign report")
    definitions, observations, issued_scopes = _collect(rows, db)
    by_question: dict[str, list[Observation]] = defaultdict(list)
    for item in observations:
        by_question[item.key].append(item)
    questions = []
    minimum = reporting_service.MIN_AGGREGATE_EVALUATEES
    for key, metadata in definitions.items():
        population = [item for item in by_question[key]
                      if (item.evaluator_id == item.evaluatee_id) == (evaluation_type == "self")]
        if not population:
            continue
        if not any((group_id is None or issued_group == group_id)
                   and (role_id is None or (evaluator_role if perspective == "evaluator" else issued_role) == role_id)
                   and (employee_id is None or issued_employee == employee_id)
                   for issued_group, issued_role, evaluator_role, issued_employee in issued_scopes[key]):
            continue
        if employee_id is not None:
            employee_items = [item for item in population if item.evaluatee_id == employee_id]
            if not employee_items:
                continue
            available = (evaluation_type == "self" or
                         len({item.evaluator_id for item in employee_items}) >= reporting_service.MIN_INDIVIDUAL_PEER_REVIEWERS)
            questions.append(_released(metadata, employee_items, "available" if available else "suppressed"))
            continue
        cohort = [item for item in population if (group_id is None or item.group_id == group_id)
                  and (role_id is None or (item.evaluator_role_id if perspective == "evaluator" else item.role_id) == role_id)]
        if not cohort:
            continue
        contributors = {item.evaluatee_id for item in cohort}
        reviewers = {item.evaluator_id for item in cohort}
        cohort_assignments = {item.assignment_id for item in cohort}
        remaining = {item.evaluatee_id for item in population if item.assignment_id not in cohort_assignments}
        # A released total and a released slice must not disclose a one-person complement.
        unsafe_partition = False
        # All released group/role marginals share this population. A singleton
        # intersection can otherwise be recovered by overlapping those filters.
        intersections: dict[tuple[int | None, int | None], set[int]] = defaultdict(set)
        groups_by_employee: dict[int, set[int | None]] = defaultdict(set)
        for item in population:
            intersections[(item.group_id, item.evaluator_role_id if perspective == "evaluator" else item.role_id)].add(item.evaluatee_id)
            groups_by_employee[item.evaluatee_id].add(item.group_id)
        if any(0 < len(part) < minimum for part in intersections.values()):
            unsafe_partition = True
        if group_id is not None and any(len(groups) > 1 for groups in groups_by_employee.values()):
            unsafe_partition = True
        if group_id is None and role_id is None:
            for attribute in ("group_id", "evaluator_role_id" if perspective == "evaluator" else "role_id"):
                partitions: dict[Any, set[int]] = defaultdict(set)
                for item in population:
                    partitions[getattr(item, attribute)].add(item.evaluatee_id)
                if any(0 < len(part) < minimum for part in partitions.values()):
                    unsafe_partition = True
        availability = ("no_data" if not cohort else "suppressed" if len(contributors) < minimum or len(reviewers) < minimum else "available")
        if availability == "available" and (unsafe_partition or (group_id is not None or role_id is not None) and 0 < len(remaining) < minimum):
            availability = "suppressed"
        questions.append(_released(metadata, cohort, availability))
    questions.sort(key=lambda item: (item["section_id"] is None, item["section_name"].casefold(), item["text"].casefold(), item["key"]))
    return {"evaluation_type": evaluation_type, "questions": questions, "notes": {"weighting": "Each valid submitted answer is one observation; self responses are separate from peer distributions.",
            "rating_bins": "Exact issued integer ratings are shown; normalized averages use 1 + 4 * (answer - minimum) / (maximum - minimum).",
            "privacy": "Peer counts and distributions are withheld when contributor or complementary cohort thresholds are not met."}}


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
                if value is not None:
                    counts[min(4, int(value))] += bucket["count"]
        total = sum(counts)
        if not released or total == 0:
            return {"section_id": section_id, "availability": "suppressed" if items else "no_data",
                    "response_count": None, "bins": None}
        return {"section_id": section_id, "availability": "available", "response_count": total,
                "bins": [{"label": f"{low}-<{high}" if high < 5 else "4-5", "count": count,
                          "percentage": round(100 * count / total, 1)}
                         for (low, high), count in zip(bins, counts)]}

    ratings = [question for question in questions if question["category"] == "rating"]
    section_ids = sorted({question["section_id"] for question in ratings if question["section_id"] is not None})
    return {"campaign": release(ratings, None),
            "sections": [release([question for question in ratings if question["section_id"] == section_id], section_id)
                         for section_id in section_ids],
            "notes": "Only privacy-released peer rating questions contribute. Each valid response counts once; campaign includes standalone rating questions, while section views use issued section IDs. Values use the issued range normalized to 1-5 on a 0-5 axis. Bins are [0,1), [1,2), [2,3), [3,4), [4,5]; percentages use released rating responses as the denominator. Section scores use different weighting."}

"""All Answers: submitted questionnaires per employee for HR, without reviewer identity.

Colleague questionnaires are labelled "Evaluator 1, 2, ..." in an order derived from a
hash, never from submission time, evaluator or assignment order. Reviewer name, role and
submission date are not returned. Because a whole questionnaire stays together, colleague
answers are released only once at least min_individual_peer_reviewers() colleagues have
submitted for the employee.
"""

from hashlib import sha256
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
import reporting_service
from form_snapshot_service import snapshot_form_name
from question_analytics_service import _options
from section_scoring_service import RATING_TYPES, _rating_range

ANSWER_STATUSES = (models.CampaignStatus.ACTIVE, models.CampaignStatus.REVIEW,
                   models.CampaignStatus.PAUSED, models.CampaignStatus.CLOSED)
OTHER_QUESTIONS = "Other questions"


def _require_access(campaign_id: int, actor: models.User, db: Session) -> tuple[models.Campaign, list[Any]]:
    reporting_service.require_reports_access(None, actor, db)
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update(read=True).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if models.CampaignStatus(campaign.status) not in ANSWER_STATUSES:
        raise HTTPException(status_code=409, detail="Answers are available only after questionnaires are issued")
    if not reporting_service._has_permission(actor, db, "campaigns.manage"):
        raise HTTPException(status_code=403, detail="Campaign management permission is required")
    rows = reporting_service.campaign_report_rows(campaign_id, db)
    return campaign, rows


def _submitted(row) -> bool:
    assignment, _form, status = row
    return reporting_service.status_key(status, assignment.finish_date) == "completed"


def _is_self(assignment: models.FilledForm) -> bool:
    return assignment.evaluator_id == assignment.evaluatee_id


def build_answers_index(campaign_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    campaign, rows = _require_access(campaign_id, actor, db)
    unique = {row[0].id: row for row in rows}.values()
    counts: dict[int, dict[str, int | bool]] = {}
    for row in unique:
        assignment = row[0]
        entry = counts.setdefault(assignment.evaluatee_id, {"self_assigned": False, "self_submitted": False,
                                                             "peer_assigned": 0, "peer_submitted": 0})
        if _is_self(assignment):
            entry["self_assigned"] = True
            entry["self_submitted"] = entry["self_submitted"] or _submitted(row)
        else:
            entry["peer_assigned"] += 1
            entry["peer_submitted"] += int(_submitted(row))
    people = db.query(models.Employee).filter(models.Employee.id.in_(counts)).all() if counts else []
    employees = sorted(({"employee_id": person.id, "employee_name": person.full_name, **counts[person.id]} for person in people),
                       key=lambda item: (item["employee_name"].casefold(), item["employee_id"]))
    return {"campaign_id": campaign.id, "min_peer_reviewers": reporting_service.min_individual_peer_reviewers(),
            "employees": employees}


def _answer(question: dict, value: Any, answered: bool) -> dict[str, Any] | None:
    kind, text = question.get("type"), question.get("text")
    if not isinstance(kind, str) or not isinstance(text, str) or not text.strip():
        return None
    result: dict[str, Any] = {"question_id": question.get("id") if isinstance(question.get("id"), str) else "",
                              "text": text.strip(), "type": kind, "required": bool(question.get("required")),
                              "rating": None, "rating_label": None, "scale_min": None, "scale_max": None, "choices": [], "text_answer": None,
                              "answered": False}
    if kind in RATING_TYPES:
        bounds = _rating_range(question)
        if bounds is None:
            return None
        result["scale_min"], result["scale_max"] = bounds
        if answered and isinstance(value, int) and not isinstance(value, bool) and bounds[0] <= value <= bounds[1]:
            result["rating"], result["answered"] = value, True
            labels = question.get("scale_labels")
            if isinstance(labels, list) and len(labels) == bounds[1] - bounds[0] + 1 and isinstance(labels[value - bounds[0]], str):
                result["rating_label"] = labels[value - bounds[0]].strip() or None
    elif kind in {"Single choice", "Multiple choice"}:
        options = _options(question)
        if options is None:
            return None
        labels = {option["value"]: option["label"] for option in options}
        picked = value if isinstance(value, list) else [value]
        if answered and picked and all(isinstance(item, str) and item in labels for item in picked):
            # Issued option order, not the order the reviewer clicked.
            result["choices"] = [option["label"] for option in options if option["value"] in picked]
            result["answered"] = True
    elif kind == "Text":
        if answered and isinstance(value, str) and value.strip():
            result["text_answer"], result["answered"] = value.strip(), True
    else:
        return None
    return result


def _questionnaire(assignment: models.FilledForm, form: models.Form, db_section_names: dict[int, str]) -> dict[str, Any] | None:
    snapshot = assignment.form_snapshot
    if not isinstance(snapshot, dict) or snapshot.get("schema_version") != 2 or not isinstance(snapshot.get("questions"), list):
        return None
    answers: dict[str, Any] = {}
    repeated: set[str] = set()
    for item in assignment.answers if isinstance(assignment.answers, list) else []:
        if isinstance(item, dict) and isinstance(item.get("question_id"), str):
            if item["question_id"] in answers:
                repeated.add(item["question_id"])
            answers[item["question_id"]] = item.get("value")
    sections: list[dict[str, Any]] = []
    loose: list[dict[str, Any]] = []
    for block in snapshot["questions"]:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "section" and isinstance(block.get("questions"), list):
            section_id = block.get("section_id")
            if isinstance(section_id, bool) or not isinstance(section_id, int) or section_id <= 0:
                section_id = None
            metadata = block.get("section")
            name = metadata.get("name") if isinstance(metadata, dict) and isinstance(metadata.get("name"), str) else None
            questions = block["questions"]
        elif block.get("type") == "question" and isinstance(block.get("question"), dict):
            section_id, name, questions = None, None, [block["question"]]
        else:
            continue
        rows = []
        for question in questions:
            if not isinstance(question, dict):
                continue
            question_id = question.get("id")
            answered = isinstance(question_id, str) and question_id in answers and question_id not in repeated
            row = _answer(question, answers.get(question_id) if answered else None, answered)
            if row is not None:
                rows.append(row)
        if not rows:
            continue
        if block.get("type") == "question":
            loose.extend(rows)
        else:
            sections.append({"section_id": section_id,
                             "section_name": name or (db_section_names.get(section_id) if section_id else None) or reporting_service.UNNAMED_SECTION,
                             "answers": rows})
    if loose:
        sections.append({"section_id": None, "section_name": OTHER_QUESTIONS, "answers": loose})
    return {"form_name": snapshot_form_name(assignment, form), "sections": sections}


def build_employee_answers(campaign_id: int, employee_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    campaign, rows = _require_access(campaign_id, actor, db)
    unique = list({row[0].id: row for row in rows if row[0].evaluatee_id == employee_id}.values())
    if not unique and employee_id not in reporting_service.campaign_participant_ids(campaign_id, rows, db):
        raise HTTPException(status_code=404, detail="Employee is not part of this campaign")
    employee = db.get(models.Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    section_ids = {block.get("section_id") for row in unique if isinstance(row[0].form_snapshot, dict)
                   for block in row[0].form_snapshot.get("questions") or [] if isinstance(block, dict)}
    section_ids = {item for item in section_ids if isinstance(item, int) and not isinstance(item, bool)}
    names = dict(db.query(models.Section.id, models.Section.name).filter(models.Section.id.in_(section_ids)).all()) if section_ids else {}

    self_rows = [row for row in unique if _is_self(row[0])]
    peer_rows = [row for row in unique if not _is_self(row[0])]
    submitted_peers = [row for row in peer_rows if _submitted(row)]
    threshold = reporting_service.min_individual_peer_reviewers()

    self_questionnaires = []
    for assignment, form, _status in sorted((row for row in self_rows if _submitted(row)), key=lambda row: row[0].id):
        item = _questionnaire(assignment, form, names)
        if item is not None:
            self_questionnaires.append({"label": "Self-evaluation", "kind": "self", **item})

    peers: list[dict[str, Any]] = []
    if len(submitted_peers) >= threshold:
        ordered = sorted(submitted_peers, key=lambda row: sha256(f"answers:{campaign_id}:{employee_id}:{row[0].id}".encode()).digest())
        for assignment, form, _status in ordered:
            item = _questionnaire(assignment, form, names)
            if item is not None:
                peers.append({"label": f"Evaluator {len(peers) + 1}", "kind": "peer", **item})
        availability = "available" if peers else "no_data"
    else:
        availability = "no_data" if not submitted_peers else "suppressed"

    return {"campaign_id": campaign.id, "employee": {"id": employee.id, "name": employee.full_name},
            "min_peer_reviewers": threshold,
            "self_assigned": bool(self_rows), "self_submitted": any(_submitted(row) for row in self_rows),
            "peer_assigned": len(peer_rows), "peer_submitted": len(submitted_peers), "peer_availability": availability,
            "questionnaires": self_questionnaires + peers}

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
from services import permissions, reporting_service
from services.form_snapshot_service import snapshot_form_name
from services.question_analytics_service import _options
from services.section_scoring_service import rating_range

ANSWER_STATUSES = (models.CampaignStatus.ACTIVE, models.CampaignStatus.REVIEW,
                   models.CampaignStatus.PAUSED, models.CampaignStatus.CLOSED)
OTHER_QUESTIONS = "Other questions"


def _require_access(campaign_id: int, actor: models.User, db: Session) -> tuple[models.Campaign, list[Any]]:
    reporting_service.require_reports_access(None, actor, db)  # Also loads the privacy thresholds.
    campaign = db.get(models.Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if models.CampaignStatus(campaign.status) not in ANSWER_STATUSES:
        raise HTTPException(status_code=409, detail="Answers are available only after questionnaires are issued")
    if not permissions.has_permission(actor, db, "campaigns.manage"):
        raise HTTPException(status_code=403, detail="Campaign management permission is required")
    rows = reporting_service.campaign_report_rows(campaign_id, db)
    return campaign, rows


def _submitted(row) -> bool:
    return row[0].finish_date is not None


def _is_self(assignment: models.FilledForm) -> bool:
    return assignment.evaluator_id == assignment.evaluatee_id


def build_answers_index(campaign_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    campaign, rows = _require_access(campaign_id, actor, db)
    counts: dict[int, dict[str, int | bool]] = {}
    for row in rows:
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


def _answer(question: dict, value: Any) -> dict[str, Any]:
    """value is None when unanswered; saved answers were validated against this snapshot."""
    kind = question["type"]
    result: dict[str, Any] = {"question_id": question["id"], "text": question["text"].strip(), "type": kind,
                              "required": bool(question.get("required")), "rating": None, "rating_label": None,
                              "scale_min": None, "scale_max": None, "choices": [], "text_answer": None,
                              "answered": value is not None}
    if kind == "Scale":
        result["scale_min"], result["scale_max"] = rating_range(question)
        if value is not None:
            labels = question.get("scale_labels")
            result["rating"] = value
            result["rating_label"] = (labels[value - result["scale_min"]].strip() or None) if labels else None
    elif kind in {"Single choice", "Multiple choice"}:
        picked = value if isinstance(value, list) else [value]
        # Issued option order, not the order the reviewer clicked.
        result["choices"] = [option["label"] for option in _options(question) if option["value"] in picked]
    elif value is not None:
        result["text_answer"] = value.strip()
    return result


def _questionnaire(assignment: models.FilledForm, form: models.Form) -> dict[str, Any] | None:
    snapshot = assignment.form_snapshot
    if snapshot.get("schema_version") != 2:  # Legacy v1 snapshots are left out, as in every report.
        return None
    answers = {item["question_id"]: item["value"] for item in assignment.answers}
    sections: list[dict[str, Any]] = []
    loose: list[dict[str, Any]] = []
    for block in snapshot["questions"]:
        if block["type"] == "section":
            sections.append({"section_id": block["section_id"], "section_name": block["section"]["name"],
                             "answers": [_answer(question, answers.get(question["id"])) for question in block["questions"]]})
        else:
            loose.append(_answer(block["question"], answers.get(block["question"]["id"])))
    if loose:
        sections.append({"section_id": None, "section_name": OTHER_QUESTIONS, "answers": loose})
    return {"form_name": snapshot_form_name(assignment, form), "sections": sections}


def build_employee_answers(campaign_id: int, employee_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    campaign, rows = _require_access(campaign_id, actor, db)
    unique = [row for row in rows if row[0].evaluatee_id == employee_id]
    if not unique and employee_id not in reporting_service.campaign_participant_ids(campaign_id, rows, db):
        raise HTTPException(status_code=404, detail="Employee is not part of this campaign")
    employee = db.get(models.Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    self_rows = [row for row in unique if _is_self(row[0])]
    peer_rows = [row for row in unique if not _is_self(row[0])]
    submitted_peers = [row for row in peer_rows if _submitted(row)]
    threshold = reporting_service.min_individual_peer_reviewers()

    self_questionnaires = []
    for assignment, form in sorted((row for row in self_rows if _submitted(row)), key=lambda row: row[0].id):
        item = _questionnaire(assignment, form)
        if item is not None:
            self_questionnaires.append({"label": "Self-evaluation", "kind": "self", **item})

    peers: list[dict[str, Any]] = []
    if len(submitted_peers) >= threshold:
        ordered = sorted(submitted_peers, key=lambda row: sha256(f"answers:{campaign_id}:{employee_id}:{row[0].id}".encode()).digest())
        for assignment, form in ordered:
            item = _questionnaire(assignment, form)
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

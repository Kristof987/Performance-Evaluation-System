"""Filling in questionnaires: what an employee may see and edit, answer validation, drafts and submission."""

from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

import models
import schemas
from services import campaign_lifecycle, campaign_service, form_snapshot_service
from business_calendar import business_date, campaign_instant
from business_calendar import business_today as campaign_today


def issued_employee_questions(filled_form: models.FilledForm) -> list[dict]:
    snapshot = filled_form.form_snapshot
    if isinstance(snapshot, dict) and isinstance(snapshot.get("questions"), list):
        return snapshot["questions"]
    # Historical issued snapshots may contain the question list directly.
    return snapshot if isinstance(snapshot, list) else []


def questionnaire_can_edit(campaign: models.Campaign, filled_form: models.FilledForm, now: datetime) -> bool:
    """Filling ends at the deadline; Review is for discussing stable results, so it never reopens."""
    return (filled_form.finish_date is None
            and campaign.status == models.CampaignStatus.ACTIVE.value
            and not campaign.is_archived and campaign.start_date <= now
            and (campaign.end_date is None or now < campaign.end_date)
            and isinstance(filled_form.form_snapshot, (dict, list)))


def list_employee_evaluations(employee: models.Employee, db: Session) -> list[dict]:

    rows = (
        db.query(
            models.FilledForm,
            models.Campaign,
            models.Form,
            models.FormStatus,
            models.Employee,
        )
        .join(models.Campaign, models.Campaign.id == models.FilledForm.campaign_id)
        .join(models.Form, models.Form.id == models.FilledForm.form_id)
        .join(models.FormStatus, models.FormStatus.id == models.FilledForm.status_id)
        .join(models.Employee, models.Employee.id == models.FilledForm.evaluatee_id)
        .filter(models.FilledForm.evaluator_id == employee.id)
        .filter(or_(campaign_service.issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
        .order_by(
            models.FilledForm.finish_date.isnot(None).asc(),
            models.Campaign.end_date.asc().nullslast(),
            models.FilledForm.created_at.desc(),
        )
        .all()
    )

    today = campaign_today()
    now = datetime.now(timezone.utc)
    evaluations = []
    for filled_form, campaign, form, status, evaluatee in rows:
        if campaign.status not in {models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value} or campaign.is_archived:
            continue
        can_edit = questionnaire_can_edit(campaign, filled_form, now)
        if filled_form.finish_date is None and not can_edit:
            continue
        questions = issued_employee_questions(filled_form)
        answers = filled_form.answers if isinstance(filled_form.answers, list) else []
        issued_questions = list(form_snapshot_service.iter_snapshot_questions(questions))
        question_ids = {question.get("id") for question in issued_questions if isinstance(question.get("id"), str)}
        answered_count = len({answer.get("question_id") for answer in answers if isinstance(answer, dict) and answer.get("question_id") in question_ids})

        evaluations.append({
            "id": filled_form.id,
            "evaluator_id": filled_form.evaluator_id,
            "campaign_id": campaign.id,
            "campaign_name": campaign.name,
            "campaign_start_date": business_date(campaign.start_date),
            "campaign_start_at": campaign_instant(campaign.start_date),
            "campaign_end_at": campaign_instant(campaign.end_date),
            "is_overdue": campaign_lifecycle.is_overdue(filled_form, campaign, now=now),
            "can_edit": can_edit,
            "campaign_is_active": campaign.is_active,
            "campaign_status": campaign.status,
            "campaign_lifecycle_status": campaign_service.campaign_lifecycle_status(campaign, today),
            "current_date": today,
            "form_id": form.id,
            "form_name": form_snapshot_service.snapshot_form_name(filled_form, form),
            "form_description": form_snapshot_service.snapshot_form_description(filled_form, form),
            "evaluatee_id": evaluatee.id,
            "evaluatee_name": evaluatee.full_name,
            "status_name": status.name,
            "due_date": business_date(campaign.end_date),
            "finish_date": filled_form.finish_date,
            "question_count": len(issued_questions),
            "answered_count": answered_count,
            "created_at": filled_form.created_at,
        })

    return evaluations


def employee_questionnaire(employee: models.Employee, evaluation_id: int, db: Session) -> dict:
    if db.query(models.FilledForm.id).filter(
        models.FilledForm.id == evaluation_id, models.FilledForm.evaluator_id == employee.id,
    ).first() is None:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    evaluation = next((item for item in list_employee_evaluations(employee, db) if item["id"] == evaluation_id), None)
    if evaluation is None:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    filled_form = db.query(models.FilledForm).filter(
        models.FilledForm.id == evaluation_id, models.FilledForm.evaluator_id == employee.id,
    ).first()
    if filled_form is None:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    if not isinstance(filled_form.form_snapshot, (dict, list)):
        raise HTTPException(status_code=403, detail="This questionnaire has not been issued")
    return {"evaluation": evaluation, "questions": issued_employee_questions(filled_form), "answers": filled_form.answers}


def update_assigned_questionnaire(*, user_id: int, evaluation_id: int, payload: schemas.AssignedQuestionnaireUpdate, db: Session, actor: models.User, employee: models.Employee):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    campaign_id = db.query(models.FilledForm.campaign_id).filter(
        models.FilledForm.id == evaluation_id, models.FilledForm.evaluator_id == employee.id,
    ).scalar()
    if campaign_id is None:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).populate_existing().with_for_update().one()
    questionnaire = employee_questionnaire(employee, evaluation_id, db)
    evaluation = questionnaire["evaluation"]
    if not evaluation["can_edit"]:
        raise HTTPException(status_code=403, detail="This questionnaire is not currently available")
    if evaluation["finish_date"] is not None:
        raise HTTPException(status_code=409, detail="This questionnaire has already been submitted")

    questions = list(form_snapshot_service.iter_snapshot_questions(questionnaire["questions"]))
    by_id = {question.get("id"): question for question in questions}
    seen = set()
    for answer in payload.answers:
        question_id = answer.get("question_id")
        if not isinstance(question_id, str) or question_id not in by_id or question_id in seen or set(answer) != {"question_id", "value"}:
            raise HTTPException(status_code=400, detail="Unknown or duplicate questionnaire answer")
        seen.add(question_id)
        question = by_id[question_id]
        value = answer["value"]
        kind = question.get("type")
        options = question.get("options", question.get("choices", []))
        choices = [option if isinstance(option, str) else next((option[key] for key in ("id", "value", "label") if option.get(key) is not None), None) for option in options if isinstance(option, (str, dict))] if isinstance(options, list) else []
        if kind in {"Scale", "Numerical scale", "Scale 1-5", "Scale 1-10"}:
            minimum = question.get("scale_min", 1)
            maximum = question.get("scale_max", 10 if kind == "Scale 1-10" else 5)
            valid = isinstance(value, int) and not isinstance(value, bool) and isinstance(minimum, int) and not isinstance(minimum, bool) and isinstance(maximum, int) and not isinstance(maximum, bool) and minimum <= value <= maximum
        elif kind == "Single choice":
            valid = isinstance(value, str) and value in choices
        elif kind == "Multiple choice":
            valid = isinstance(value, list) and len(value) > 0 and len(value) == len(set(str(item) for item in value)) and all(isinstance(item, str) and item in choices for item in value)
        elif kind == "Text":
            valid = isinstance(value, str) and value.strip() != ""
        elif kind == "Number":
            valid = isinstance(value, (int, float)) and not isinstance(value, bool)
        elif kind == "Date":
            try:
                valid = isinstance(value, str) and len(value) == 10 and date.fromisoformat(value).isoformat() == value
            except ValueError:
                valid = False
        else:
            valid = False
        if not valid:
            if kind in {"Scale", "Numerical scale", "Scale 1-5", "Scale 1-10"}:
                detail = f"Rating for question {question_id} must be a whole number from {minimum} to {maximum}"
            elif kind in {"Single choice", "Multiple choice"}:
                detail = f"Select valid issued options for question {question_id}"
            else:
                detail = f"Invalid answer for question {question_id}"
            raise HTTPException(status_code=400, detail=detail)
    if payload.submit and (not questions or any(question.get("required") and question.get("id") not in seen for question in questions)):
        raise HTTPException(status_code=400, detail="Answer all required questions before submitting")

    filled_form = db.query(models.FilledForm).filter(
        models.FilledForm.id == evaluation_id, models.FilledForm.evaluator_id == employee.id,
    ).with_for_update().first()
    if filled_form is None:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    if filled_form.finish_date is not None or filled_form.form_snapshot is None:
        raise HTTPException(status_code=409, detail="This questionnaire is no longer available for editing")
    if not questionnaire_can_edit(campaign, filled_form, datetime.now(timezone.utc)):
        raise HTTPException(status_code=403, detail="This questionnaire is not currently available")
    filled_form.answers = payload.answers
    status_name = "Completed" if payload.submit else "In progress"
    status = db.query(models.FormStatus).filter(func.lower(models.FormStatus.name) == status_name.lower()).first()
    if status is None:
        status = models.FormStatus(name=status_name)
        db.add(status)
        db.flush()
    filled_form.status_id = status.id
    if payload.submit:
        filled_form.finish_date = campaign_today()
    db.commit()
    return employee_questionnaire(employee, evaluation_id, db)


def get_employee_dashboard(*, user_id: int, db: Session, actor: models.User, employee: models.Employee):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Assigned evaluations not found")
    evaluations = list_employee_evaluations(employee, db)
    restricted_campaigns = (db.query(models.Campaign.id, models.Campaign.name, models.Campaign.status)
                            .join(models.FilledForm, models.FilledForm.campaign_id == models.Campaign.id)
                            .filter(models.FilledForm.evaluator_id == employee.id,
                                    models.Campaign.status.in_([
                                        models.CampaignStatus.PAUSED.value, models.CampaignStatus.CLOSED.value,
                                     ]))
                             .filter(or_(campaign_service.issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
                             .distinct().all())
    open_evaluations = [evaluation for evaluation in evaluations if evaluation["finish_date"] is None]
    completed_evaluations = [evaluation for evaluation in evaluations if evaluation["finish_date"] is not None]
    active_campaign = (
        db.query(models.Campaign)
        .join(models.FilledForm, models.FilledForm.campaign_id == models.Campaign.id)
        .filter(models.FilledForm.evaluator_id == employee.id)
        .filter(models.Campaign.status.in_([
            models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value,
        ]))
        .filter(models.Campaign.is_archived.is_(False))
        .filter(or_(campaign_service.issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
        .order_by((models.Campaign.status == models.CampaignStatus.ACTIVE.value).desc(),
                  models.Campaign.end_date.asc().nullslast(), models.Campaign.start_date.asc())
        .first()
    )
    next_campaign = None
    if active_campaign is None:
        next_campaign = (
            db.query(models.Campaign)
            .join(models.FilledForm, models.FilledForm.campaign_id == models.Campaign.id)
            .filter(models.FilledForm.evaluator_id == employee.id)
            .filter(models.Campaign.start_date >= datetime.now(timezone.utc))
            .filter(models.Campaign.status == models.CampaignStatus.ACTIVE.value)
            .filter(models.Campaign.is_archived.is_(False))
            .filter(or_(campaign_service.issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
            .order_by(models.Campaign.start_date.asc())
            .first()
        )

    campaign_date_label = ("Campaign deadline" if active_campaign.status == models.CampaignStatus.REVIEW.value
                           else "Campaign ends") if active_campaign is not None else "Next campaign"
    campaign_date = (
        business_date(active_campaign.end_date)
        if active_campaign is not None
        else business_date(next_campaign.start_date) if next_campaign is not None else None
    )
    campaign_date_empty_text = "No deadline" if active_campaign is not None else "Not announced yet"
    latest_result = completed_evaluations[0] if len(completed_evaluations) > 0 else None

    return {
        "current_date": campaign_today(),
        "evaluations": evaluations,
        "restricted_campaigns": [{"campaign_id": row.id, "campaign_name": row.name,
                                   "campaign_status": row.status} for row in restricted_campaigns],
        "open_count": len(open_evaluations),
        "completed_count": len(completed_evaluations),
        "next_review_date": campaign_date,
        "campaign_date_label": campaign_date_label,
        "campaign_date": campaign_date,
        "campaign_date_empty_text": campaign_date_empty_text,
        "latest_result": latest_result,
        "history": [
            {
                "id": evaluation["id"],
                "title": evaluation["form_name"],
                "subtitle": evaluation["campaign_name"],
                "status": "Submitted" if evaluation["finish_date"] is not None else evaluation["status_name"],
                "occurred_at": evaluation["finish_date"] or evaluation["created_at"],
            }
            for evaluation in evaluations[:3]
        ],
    }

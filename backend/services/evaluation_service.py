"""Filling in questionnaires: what an employee may see and edit, answer validation, drafts and submission."""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

import models
import schemas
from services import campaign_service, form_snapshot_service
from business_calendar import business_date, campaign_instant
from business_calendar import business_today as campaign_today


def issued_employee_questions(filled_form: models.FilledForm) -> list[dict]:
    return filled_form.form_snapshot["questions"] if filled_form.form_snapshot else []


def questionnaire_can_edit(campaign: models.Campaign, filled_form: models.FilledForm, now: datetime) -> bool:
    """Filling ends at the deadline; Review is for discussing stable results, so it never reopens."""
    return (filled_form.finish_date is None
            and campaign.status == models.CampaignStatus.ACTIVE.value
            and not campaign.is_archived and campaign.start_date <= now
            and (campaign.end_date is None or now < campaign.end_date)
            and filled_form.form_snapshot is not None)


def list_employee_evaluations(employee: models.Employee, db: Session) -> list[dict]:
    rows = (
        db.query(
            models.FilledForm,
            models.Campaign,
            models.Form,
            models.Employee,
        )
        .join(models.Campaign, models.Campaign.id == models.FilledForm.campaign_id)
        .join(models.Form, models.Form.id == models.FilledForm.form_id)
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
    for filled_form, campaign, form, evaluatee in rows:
        if campaign.status not in {models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value} or campaign.is_archived:
            continue
        can_edit = questionnaire_can_edit(campaign, filled_form, now)
        if filled_form.finish_date is None and not can_edit:
            continue
        issued_questions = list(form_snapshot_service.iter_snapshot_questions(issued_employee_questions(filled_form)))
        question_ids = {question["id"] for question in issued_questions}
        answered_count = sum(answer["question_id"] in question_ids for answer in filled_form.answers or [])

        evaluations.append({
            "id": filled_form.id,
            "evaluator_id": filled_form.evaluator_id,
            "campaign_id": campaign.id,
            "campaign_name": campaign.name,
            "campaign_start_date": business_date(campaign.start_date),
            "campaign_end_at": campaign_instant(campaign.end_date),
            "can_edit": can_edit,
            "campaign_status": campaign.status,
            "current_date": today,
            "form_id": form.id,
            "form_name": form_snapshot_service.snapshot_form_name(filled_form, form),
            "form_description": form_snapshot_service.snapshot_form_description(filled_form, form),
            "evaluatee_id": evaluatee.id,
            "evaluatee_name": evaluatee.full_name,
            "due_date": business_date(campaign.end_date),
            "finish_date": filled_form.finish_date,
            "question_count": len(issued_questions),
            "answered_count": answered_count,
        })

    return evaluations


def employee_questionnaire(employee: models.Employee, evaluation_id: int, db: Session) -> dict:
    # The list only holds issued (or submitted) questionnaires of open campaigns assigned to this evaluator.
    evaluation = next((item for item in list_employee_evaluations(employee, db) if item["id"] == evaluation_id), None)
    if evaluation is None:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    filled_form = db.get(models.FilledForm, evaluation_id)
    return {"evaluation": evaluation, "questions": issued_employee_questions(filled_form), "answers": filled_form.answers}


def update_assigned_questionnaire(*, user_id: int, evaluation_id: int, payload: schemas.AssignedQuestionnaireUpdate, db: Session, actor: models.User, employee: models.Employee):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    questionnaire = employee_questionnaire(employee, evaluation_id, db)  # 404 unless it is visible to this evaluator
    if not questionnaire["evaluation"]["can_edit"]:
        raise HTTPException(status_code=403, detail="This questionnaire is not currently available")
    # Locking the assignment makes a second, concurrent submit wait and then see it submitted.
    filled_form = db.query(models.FilledForm).filter(models.FilledForm.id == evaluation_id).with_for_update().populate_existing().one()
    if filled_form.finish_date is not None:
        raise HTTPException(status_code=409, detail="This questionnaire is no longer available for editing")

    questions = list(form_snapshot_service.iter_snapshot_questions(questionnaire["questions"]))
    by_id = {question["id"]: question for question in questions}
    seen = set()
    for answer in payload.answers:
        question_id = answer.get("question_id")
        if not isinstance(question_id, str) or question_id not in by_id or question_id in seen or set(answer) != {"question_id", "value"}:
            raise HTTPException(status_code=400, detail="Unknown or duplicate questionnaire answer")
        seen.add(question_id)
        question = by_id[question_id]
        value = answer["value"]
        kind = question["type"]
        choices = {option["id"] for option in question.get("options") or []}
        if kind == "Scale":
            minimum, maximum = question["scale_min"], question["scale_max"]
            valid = isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum
        elif kind == "Single choice":
            valid = isinstance(value, str) and value in choices
        elif kind == "Multiple choice":
            valid = (isinstance(value, list) and len(value) > 0 and all(isinstance(item, str) and item in choices for item in value)
                     and len(value) == len(set(value)))
        else:  # Text
            valid = isinstance(value, str) and value.strip() != ""
        if not valid:
            if kind == "Scale":
                detail = f"Rating for question {question_id} must be a whole number from {minimum} to {maximum}"
            elif kind in {"Single choice", "Multiple choice"}:
                detail = f"Select valid issued options for question {question_id}"
            else:
                detail = f"Invalid answer for question {question_id}"
            raise HTTPException(status_code=400, detail=detail)
    if payload.submit and (not questions or any(question.get("required") and question["id"] not in seen for question in questions)):
        raise HTTPException(status_code=400, detail="Answer all required questions before submitting")
    filled_form.answers = payload.answers
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
    return {
        "current_date": campaign_today(),
        "evaluations": evaluations,
        "restricted_campaigns": [{"campaign_id": row.id, "campaign_name": row.name,
                                   "campaign_status": row.status} for row in restricted_campaigns],
    }

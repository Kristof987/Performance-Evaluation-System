from copy import deepcopy
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
import os
from uuid import uuid4
from typing import Literal

from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import and_, case, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from api.dependencies import get_current_employee, get_db, reject_conflicting_requester, require_permission
from services.business_calendar import business_today as campaign_today, business_date, campaign_instant
from services import campaign_lifecycle
from services import campaign_reminder_service
import models
from services import form_snapshot_service
from services import reporting_service
from services import answers_service
from services import form_import_service
from services import report_dashboard_service
from services import question_analytics_service
from services import evaluation_quality_service
from services import ai_workflow_service
from services import ai_aggregate_workflow_service
from services import ai_generation_jobs
from services import ai_form_generation_service
from services.ai_analysis_models import EmployeeAIAnalysis
from services.ai_generation_service import AnalysisGenerationError
import schemas
from services import workspace_settings_service
from api import auth as auth_router
from api import me as me_router
from api import workspace as workspace_router
from api import people as people_router
from services import campaign_service
from services import form_service
from services import people_service

#Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    stop, worker = ai_generation_jobs.start_worker()
    try:
        yield
    finally:
        stop.set()
        worker.join(timeout=1)


app = FastAPI(lifespan=lifespan)

FRONTEND_URL = os.getenv("FRONTEND_URL")

allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

if FRONTEND_URL:
    allowed_origins.append(FRONTEND_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_campaign_form_ids(campaign_id: int, db: Session):
    rule_form_ids = {
        form_id
        for (form_id,) in db.query(models.CampaignEvaluationRule.form_id)
        .filter(models.CampaignEvaluationRule.campaign_id == campaign_id)
        .distinct()
        .all()
    }
    filled_form_ids = {
        form_id
        for (form_id,) in db.query(models.FilledForm.form_id)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .distinct()
        .all()
    }

    return sorted((rule_form_ids | filled_form_ids) - {None})


def get_campaign_participant_count(campaign_id: int, db: Session):
    evaluator_ids = {
        employee_id
        for (employee_id,) in db.query(models.FilledForm.evaluator_id)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .distinct()
        .all()
    }
    evaluatee_ids = {
        employee_id
        for (employee_id,) in db.query(models.FilledForm.evaluatee_id)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .distinct()
        .all()
    }

    return len(evaluator_ids | evaluatee_ids)


def get_campaign_participants(campaign_id: int, db: Session):
    assigned_group_ids = campaign_service.get_campaign_assigned_group_ids(campaign_id, db)
    if len(assigned_group_ids) == 0:
        return []

    rows = (
        db.query(models.Employee, models.User, models.CompanyRole, models.CompanyGroup)
        .outerjoin(models.User, models.User.id == models.Employee.user_id)
        .join(models.CompanyRole, models.CompanyRole.id == models.Employee.company_role_id)
        .join(models.employee_company_groups, models.employee_company_groups.c.employee_id == models.Employee.id)
        .join(models.CompanyGroup, models.CompanyGroup.id == models.employee_company_groups.c.company_group_id)
        .filter(models.employee_company_groups.c.company_group_id.in_(assigned_group_ids))
        .filter(models.Employee.is_active.is_(True))
        .filter(or_(models.Employee.user_id.is_(None), models.User.is_active.is_(True)))
        .order_by(models.Employee.full_name.asc(), models.CompanyGroup.name.asc())
        .all()
    )

    participants_by_id = {}
    evaluations_left_by_user_id = dict(
        db.query(models.FilledForm.evaluator_id, func.count(models.FilledForm.id))
        .filter(models.FilledForm.campaign_id == campaign_id)
        .filter(models.FilledForm.finish_date.is_(None))
        .filter(issued_snapshot_filter())
        .group_by(models.FilledForm.evaluator_id)
        .all()
    )
    for employee, user, role, group in rows:
        participant = participants_by_id.setdefault(
            employee.id,
            {
                "employee_id": employee.id,
                "name": employee.full_name,
                "email": user.email if user else None,
                "profile_image_url": employee.profile_image_url,
                "role_name": role.name,
                "groups": [],
                "evaluations_left": evaluations_left_by_user_id.get(employee.id, 0),
            },
        )
        participant["groups"].append(group.name)

    return list(participants_by_id.values())


def campaign_lifecycle_status(campaign: models.Campaign, today: date) -> str:
    return {
        models.CampaignStatus.DRAFT.value: "Disabled",
        models.CampaignStatus.SCHEDULED.value: "Scheduled",
        models.CampaignStatus.ACTIVE.value: "Ongoing",
        models.CampaignStatus.PAUSED.value: "Disabled",
        models.CampaignStatus.REVIEW.value: "Completed",
        models.CampaignStatus.CLOSED.value: "Completed",
    }[campaign.status]


def campaign_payload(campaign: models.Campaign, today: date, issued: int = 0, submitted: int = 0) -> dict:
    return {**campaign.__dict__, "start_date": business_date(campaign.start_date),
            "end_date": business_date(campaign.end_date), "start_at": campaign_instant(campaign.start_date),
            "end_at": campaign_instant(campaign.end_date), "campaign_status": campaign.status,
            "current_date": today, "lifecycle_status": campaign_lifecycle_status(campaign, today),
            "activation_error": campaign.lifecycle_error if campaign.status == models.CampaignStatus.SCHEDULED.value else None,
            "activation_retry_at": campaign.lifecycle_retry_at if campaign.status == models.CampaignStatus.SCHEDULED.value else None,
            "activation_attempts": campaign.lifecycle_attempts if campaign.status == models.CampaignStatus.SCHEDULED.value else 0,
             "issued_forms_count": issued, "submitted_forms_count": submitted}


def require_mutable_campaign_configuration(campaign: models.Campaign) -> None:
    if campaign.is_archived:
        raise HTTPException(status_code=409, detail="Archived campaign configuration cannot be changed")
    if campaign.status in {models.CampaignStatus.PAUSED.value, models.CampaignStatus.REVIEW.value,
                           models.CampaignStatus.CLOSED.value}:
        raise HTTPException(status_code=409, detail="Campaign configuration is locked in this lifecycle status")


def require_mutable_campaign_plan(campaign: models.Campaign) -> None:
    if campaign.is_archived or campaign.status == models.CampaignStatus.CLOSED.value:
        raise HTTPException(status_code=409, detail="Campaign plan is locked in this lifecycle status")


def unissued_snapshot_filter():
    # Older planned rows may contain JSON null; new rows use SQL NULL.
    return or_(models.FilledForm.form_snapshot.is_(None), models.FilledForm.form_snapshot == JSONB.NULL)


def issued_snapshot_filter():
    return and_(models.FilledForm.form_snapshot.isnot(None), models.FilledForm.form_snapshot != JSONB.NULL)


def ensure_campaign_issued(campaign_id: int, db: Session, *, commit: bool = True,
                           actor_user_id: int | None = None):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    now = datetime.now(timezone.utc)
    if (campaign is None or campaign.legacy_issuance_blocked
            or campaign.status not in {models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value}
            or campaign.is_archived or campaign.start_date > now
            or (campaign.status == models.CampaignStatus.ACTIVE.value
                and campaign.end_date is not None and campaign.end_date <= now)):
        return []

    errors = issue_activation_snapshots(campaign, db, actor_user_id=actor_user_id, require_all=False)
    if commit:
        db.commit()
    return errors


def unschedule_if_incomplete(campaign: models.Campaign, db: Session, actor_user_id: int) -> None:
    if campaign.status == models.CampaignStatus.SCHEDULED.value and campaign_service.validate_campaign_configuration(campaign, db):
        campaign_lifecycle.transition_campaign(
            db, campaign.id, models.CampaignStatus.DRAFT,
            now=datetime.now(timezone.utc), actor_user_id=actor_user_id,
        )


def issue_activation_snapshots(campaign: models.Campaign, db: Session,
                               *, actor_user_id: int | None = None, require_all: bool = True) -> list[str]:
    """Issue only untouched planned rows; caller owns the campaign lock and transaction."""
    errors = []
    issued_count = 0
    group_members = {}
    self_form_ids = None
    for assignment in db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign.id,
        unissued_snapshot_filter(),
    ).order_by(models.FilledForm.id).all():
        # Historical answers cannot be reconstructed from today's editable form.
        if assignment.finish_date is not None or assignment.answers:
            continue
        if assignment.form_id is None:
            if require_all:
                errors.append(f"Assignment {assignment.id}: select a form before issuance")
            continue
        if not require_all:
            if assignment.company_group_id not in group_members:
                group_members[assignment.company_group_id] = {
                    person.id: person for person, _role in people_service.get_group_employees(assignment.company_group_id, db)
                } if assignment.company_group_id is not None else {}
            members = group_members[assignment.company_group_id]
            evaluator = members.get(assignment.evaluator_id)
            evaluatee = members.get(assignment.evaluatee_id)
            if evaluator is None or evaluatee is None:
                errors.append(f"Assignment {assignment.id}: employees are not active members of the selected group")
                continue
            if assignment.evaluator_id == assignment.evaluatee_id:
                if self_form_ids is None:
                    self_form_ids = {row.employee_id: row.form_id for row in db.query(models.CampaignEmployeeSelfEvaluation)
                                     .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign.id)}
                expected = self_form_ids.get(assignment.evaluator_id)
            else:
                expected = get_form_id_for_employee_pair(
                    campaign.id, assignment.company_group_id, evaluator, evaluatee, db)
            if expected != assignment.form_id:
                errors.append(f"Assignment {assignment.id}: saved questionnaire no longer matches the pair's role assignment")
                continue
        form = db.query(models.Form).filter(models.Form.id == assignment.form_id).first()
        if form is None:
            errors.append(f"Assignment {assignment.id}: source form no longer exists")
            continue
        problems = form_service.form_issuance_errors(form.questions if isinstance(form.questions, list) else [], db)
        if problems:
            errors.append(f"Assignment {assignment.id} ({form.name}): {' '.join(problems)}")
            continue
        assignment.form_snapshot = form_snapshot_service.create_form_snapshot(form, db)
        assignment.snapshot_status = "verified"
        snapshot_assignment_roles(assignment, db)
        issued_count += 1

    campaign_lifecycle.record_snapshot_issuance(db, campaign, issued_count, actor_user_id=actor_user_id)
    return errors


def snapshot_assignment_roles(assignment: models.FilledForm, db: Session) -> None:
    """Freeze both company roles when an assignment is issued."""
    for employee_id, field in ((assignment.evaluator_id, "evaluator_company_role_id"),
                               (assignment.evaluatee_id, "evaluatee_company_role_id")):
        if getattr(assignment, field) is None:
            person = db.get(models.Employee, employee_id)
            setattr(assignment, field, person.company_role_id if person else None)


@app.get("/users/{user_id}/assigned-evaluations", response_model=list[schemas.AssignedEvaluationResponse])
def get_assigned_evaluations(user_id: int, db: Session = Depends(get_db),
                             actor: models.User = Depends(require_permission("evaluations.read_assigned")),
                             employee: models.Employee = Depends(get_current_employee)):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Assigned evaluations not found")
    return list_employee_evaluations(employee, db)


def issued_employee_questions(filled_form: models.FilledForm) -> list[dict]:
    snapshot = filled_form.form_snapshot
    if isinstance(snapshot, dict) and isinstance(snapshot.get("questions"), list):
        return snapshot["questions"]
    # Historical issued snapshots may contain the question list directly.
    return snapshot if isinstance(snapshot, list) else []


def questionnaire_can_edit(campaign: models.Campaign, filled_form: models.FilledForm, now: datetime) -> bool:
    return (filled_form.finish_date is None
            and campaign.status in {models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value}
            and not campaign.is_archived and campaign.start_date <= now
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
        .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
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
            "campaign_lifecycle_status": campaign_lifecycle_status(campaign, today),
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


@app.get("/users/{user_id}/assigned-evaluations/{evaluation_id}", response_model=schemas.AssignedQuestionnaireResponse)
def get_assigned_questionnaire(user_id: int, evaluation_id: int, db: Session = Depends(get_db),
                               actor: models.User = Depends(require_permission("evaluations.read_assigned")),
                               employee: models.Employee = Depends(get_current_employee)):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    return employee_questionnaire(employee, evaluation_id, db)


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


@app.put("/users/{user_id}/assigned-evaluations/{evaluation_id}", response_model=schemas.AssignedQuestionnaireResponse)
def update_assigned_questionnaire(user_id: int, evaluation_id: int, payload: schemas.AssignedQuestionnaireUpdate,
                                  db: Session = Depends(get_db),
                                  actor: models.User = Depends(require_permission("evaluations.submit")),
                                  employee: models.Employee = Depends(get_current_employee)):
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


@app.get("/users/{user_id}/employee-dashboard", response_model=schemas.EmployeeDashboardResponse)
def get_employee_dashboard(user_id: int, db: Session = Depends(get_db),
                           actor: models.User = Depends(require_permission("evaluations.read_assigned")),
                           employee: models.Employee = Depends(get_current_employee)):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Assigned evaluations not found")
    evaluations = list_employee_evaluations(employee, db)
    restricted_campaigns = (db.query(models.Campaign.id, models.Campaign.name, models.Campaign.status)
                            .join(models.FilledForm, models.FilledForm.campaign_id == models.Campaign.id)
                            .filter(models.FilledForm.evaluator_id == employee.id,
                                    models.Campaign.status.in_([
                                        models.CampaignStatus.PAUSED.value, models.CampaignStatus.CLOSED.value,
                                     ]))
                             .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
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
        .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
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
            .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
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


@app.get("/dashboard", response_model=schemas.DashboardResponse)
def get_dashboard(campaign_id: int | None = Query(default=None), db: Session = Depends(get_db),
                  _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaigns = (
        db.query(models.Campaign)
        .order_by(models.Campaign.is_archived.asc(),
                  case((models.Campaign.status == models.CampaignStatus.ACTIVE.value, 0),
                       (models.Campaign.status == models.CampaignStatus.REVIEW.value, 1),
                       (models.Campaign.status == models.CampaignStatus.PAUSED.value, 2),
                       (models.Campaign.status == models.CampaignStatus.SCHEDULED.value, 3),
                       (models.Campaign.status == models.CampaignStatus.DRAFT.value, 4), else_=5),
                  models.Campaign.start_date.desc())
        .all()
    )
    today = campaign_today()
    selected_campaign = None
    if campaign_id is not None:
        selected_campaign = next((campaign for campaign in campaigns if campaign.id == campaign_id), None)
        if selected_campaign is None:
            raise HTTPException(status_code=404, detail="Campaign not found")

    if selected_campaign is None and len(campaigns) > 0:
        selected_campaign = campaigns[0]

    upcoming_campaigns = (
        db.query(models.Campaign)
        .filter(models.Campaign.status == models.CampaignStatus.SCHEDULED.value,
                models.Campaign.is_archived.is_(False),
                models.Campaign.start_date >= datetime.now(timezone.utc))
        .order_by(models.Campaign.start_date.asc())
        .limit(3)
        .all()
    )

    upcoming_reviews = [
        {
            "campaign_id": campaign.id,
            "name": campaign.name,
            "start_date": business_date(campaign.start_date),
            "participant_count": get_campaign_participant_count(campaign.id, db),
            "form_count": len(get_campaign_form_ids(campaign.id, db)),
        }
        for campaign in upcoming_campaigns
    ]
    upcoming_deadlines = sorted(
        [
            {
                "campaign_id": campaign.id,
                "name": campaign.name,
                "deadline_type": "Starts",
                "date": business_date(campaign.start_date),
            }
            for campaign in campaigns
            if campaign.status == models.CampaignStatus.SCHEDULED.value and not campaign.is_archived
            and campaign.start_date > datetime.now(timezone.utc)
        ]
        + [
            {
                "campaign_id": campaign.id,
                "name": campaign.name,
                "deadline_type": "Ends",
                "date": business_date(campaign.end_date),
            }
            for campaign in campaigns
            if campaign.status == models.CampaignStatus.ACTIVE.value and not campaign.is_archived
            and campaign.end_date is not None and campaign.end_date > datetime.now(timezone.utc)
        ],
        key=lambda item: (item["date"], item["deadline_type"], item["name"], item["campaign_id"]),
    )[:8]
    campaign_summaries = [
        {
            "id": campaign.id,
            "name": campaign.name,
            "is_active": campaign.is_active,
            "start_date": business_date(campaign.start_date),
            "end_date": business_date(campaign.end_date),
            "current_date": today,
            "lifecycle_status": campaign_lifecycle_status(campaign, today),
            "campaign_status": campaign.status,
            "is_archived": campaign.is_archived,
        }
        for campaign in campaigns
    ]

    if selected_campaign is None:
        return {
            "current_date": today,
            "campaigns": campaign_summaries,
            "selected_campaign_id": None,
            "metrics": None,
            "forms": [],
            "participants": [],
            "upcoming_reviews": upcoming_reviews,
            "upcoming_deadlines": upcoming_deadlines,
        }

    assignments = (
        db.query(models.FilledForm)
        .filter(models.FilledForm.campaign_id == selected_campaign.id)
        .all()
    )
    planned_count = sum(1 for assignment in assignments if assignment.form_snapshot is None and assignment.finish_date is None and not assignment.answers)
    assignment_count = len(assignments) - planned_count
    submitted_count = sum(1 for assignment in assignments if assignment.finish_date is not None)
    overdue_assignments = [
        assignment
        for assignment in assignments
        if assignment.form_snapshot is not None
        and campaign_lifecycle.is_overdue(assignment, selected_campaign, now=datetime.now(timezone.utc))
    ]
    form_ids = get_campaign_form_ids(selected_campaign.id, db)
    overdue_form_ids = {assignment.form_id for assignment in overdue_assignments}
    next_campaign = next((campaign for campaign in upcoming_campaigns if campaign.id != selected_campaign.id), None)

    status_names = dict(db.query(models.FormStatus.id, models.FormStatus.name).all())
    in_progress_count = sum(assignment.finish_date is None and not (assignment.form_snapshot is None and not assignment.answers)
                            and (bool(assignment.answers) or normalize_form_status(status_names.get(assignment.status_id), None)[0] == "in_progress")
                            for assignment in assignments)
    metrics = {
        "assignment_count": assignment_count,
        "planned_count": planned_count,
        "submitted_count": submitted_count,
        "completion_rate": round((submitted_count / assignment_count) * 100) if assignment_count > 0 else 0,
        "awaiting_submission_count": assignment_count - submitted_count,
        "not_started_count": max(0, assignment_count - submitted_count - in_progress_count),
        "in_progress_count": in_progress_count,
        "overdue_count": len(overdue_assignments),
        "overdue_forms_count": len(overdue_form_ids),
        "upcoming_reviews_count": len(upcoming_reviews),
        "next_review_date": business_date(next_campaign.start_date) if next_campaign is not None else None,
    }

    forms = []
    for form_id in form_ids:
        form = db.query(models.Form).filter(models.Form.id == form_id).first()
        if form is None:
            continue

        form_assignments = [assignment for assignment in assignments if assignment.form_id == form_id]
        form_submitted_count = sum(1 for assignment in form_assignments if assignment.finish_date is not None)
        form_overdue_count = sum(1 for assignment in form_assignments if assignment in overdue_assignments)
        group_names = [
            name
            for (name,) in db.query(models.CompanyGroup.name)
            .join(models.CampaignEvaluationRule, models.CampaignEvaluationRule.company_group_id == models.CompanyGroup.id)
            .filter(models.CampaignEvaluationRule.campaign_id == selected_campaign.id)
            .filter(models.CampaignEvaluationRule.form_id == form_id)
            .distinct()
            .all()
        ]

        forms.append({
            "form_id": form.id,
            "name": form.name,
            "audience": ", ".join(group_names) if len(group_names) > 0 else "No groups assigned",
            "submitted_count": form_submitted_count,
            "assignment_count": len(form_assignments),
            "due_date": business_date(selected_campaign.end_date),
            "overdue_count": form_overdue_count,
        })

    return {
        "current_date": today,
        "campaigns": campaign_summaries,
        "selected_campaign_id": selected_campaign.id,
        "metrics": metrics,
        "forms": forms,
        "participants": get_campaign_participants(selected_campaign.id, db),
        "upcoming_reviews": upcoming_reviews,
        "upcoming_deadlines": upcoming_deadlines,
    }


def normalize_form_status(status_name: str | None, finish_date: date | None) -> tuple[str, str]:
    if finish_date is not None:
        return "completed", "Completed"
    normalized = (status_name or "Not started").strip().lower()
    if normalized in {"completed", "submitted"}:
        return "completed", "Completed"
    if normalized in {"in progress", "in_progress", "started"}:
        return "in_progress", "In progress"
    return "not_started", "Not started"


def campaign_for_emails(campaign_id: int, db: Session, *, lock: bool = False) -> models.Campaign:
    query = db.query(models.Campaign).filter(models.Campaign.id == campaign_id)
    campaign = (query.with_for_update() if lock else query).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


def require_email_schedule_editable(campaign: models.Campaign) -> None:
    if campaign.is_archived or campaign.status in {models.CampaignStatus.CLOSED.value, models.CampaignStatus.REVIEW.value}:
        raise HTTPException(status_code=409, detail="Emails can no longer be scheduled for this campaign")


@app.get("/campaigns/{campaign_id}/emails", response_model=schemas.CampaignEmailOverview)
def get_campaign_emails(campaign_id: int, db: Session = Depends(get_db),
                        _reader: models.User = Depends(require_permission("campaigns.read"))):
    return campaign_reminder_service.email_overview(campaign_for_emails(campaign_id, db), db)


@app.post("/campaigns/{campaign_id}/emails/reminders", response_model=schemas.CampaignEmailOverview)
def add_campaign_reminder(campaign_id: int, payload: schemas.CampaignReminderCreate, db: Session = Depends(get_db),
                          actor: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = campaign_for_emails(campaign_id, db, lock=True)
    require_email_schedule_editable(campaign)
    if campaign.end_date is None:
        raise HTTPException(status_code=409, detail="Set a campaign end date before scheduling reminders")
    campaign_reminder_service.customize_reminders(campaign, actor, db)
    if db.query(models.CampaignReminder.id).filter_by(campaign_id=campaign.id, days_before_end=payload.days_before_end).first():
        raise HTTPException(status_code=409, detail="A reminder is already scheduled for that day")
    db.add(models.CampaignReminder(campaign_id=campaign.id, days_before_end=payload.days_before_end, created_by=actor.id))
    workspace_settings_service.record_audit(db, "notifications", actor, f"Reminder added for {campaign.name}",
                                            {"campaign_id": campaign.id, "days_before_end": payload.days_before_end})
    db.commit()
    return campaign_reminder_service.email_overview(campaign, db)


@app.delete("/campaigns/{campaign_id}/emails/reminders/{days_before_end}", response_model=schemas.CampaignEmailOverview)
def delete_campaign_reminder(campaign_id: int, days_before_end: int, db: Session = Depends(get_db),
                             actor: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = campaign_for_emails(campaign_id, db, lock=True)
    require_email_schedule_editable(campaign)
    campaign_reminder_service.customize_reminders(campaign, actor, db)
    reminder = db.query(models.CampaignReminder).filter_by(campaign_id=campaign.id, days_before_end=days_before_end).first()
    if reminder is None:
        raise HTTPException(status_code=404, detail="Reminder not found")
    workspace_settings_service.record_audit(db, "notifications", actor, f"Reminder removed for {campaign.name}",
                                            {"campaign_id": campaign.id, "days_before_end": days_before_end})
    db.delete(reminder)
    db.commit()
    return campaign_reminder_service.email_overview(campaign, db)


@app.post("/campaigns/{campaign_id}/emails/reminders/reset", response_model=schemas.CampaignEmailOverview)
def reset_campaign_reminders(campaign_id: int, db: Session = Depends(get_db),
                             actor: models.User = Depends(require_permission("campaigns.manage"))):
    """Drop the campaign's own reminders and follow the workspace defaults again."""
    campaign = campaign_for_emails(campaign_id, db, lock=True)
    require_email_schedule_editable(campaign)
    db.query(models.CampaignReminder).filter_by(campaign_id=campaign.id).delete()
    campaign.custom_reminders = False
    workspace_settings_service.record_audit(db, "notifications", actor, f"Reminders reset to defaults for {campaign.name}",
                                            {"campaign_id": campaign.id})
    db.commit()
    return campaign_reminder_service.email_overview(campaign, db)


@app.get("/campaigns/{campaign_id}/emails/recipients", response_model=list[schemas.CampaignReminderRecipient])
def get_campaign_reminder_recipients(campaign_id: int, db: Session = Depends(get_db),
                                     _manager: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_reminder_service.recipient_list(campaign_for_emails(campaign_id, db), db)


@app.put("/campaigns/{campaign_id}/emails/launch", response_model=schemas.CampaignEmailOverview)
def update_campaign_launch_email(campaign_id: int, payload: schemas.CampaignLaunchEmailUpdate, db: Session = Depends(get_db),
                                 actor: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = campaign_for_emails(campaign_id, db, lock=True)
    require_email_schedule_editable(campaign)
    campaign.launch_email_enabled = payload.enabled
    workspace_settings_service.record_audit(db, "notifications", actor,
                                            f"Launch email {'enabled' if payload.enabled else 'disabled'} for {campaign.name}",
                                            {"campaign_id": campaign.id})
    db.commit()
    return campaign_reminder_service.email_overview(campaign, db)


@app.post("/campaigns/{campaign_id}/emails/send", response_model=schemas.CampaignManualReminderResult)
def send_campaign_reminder_now(campaign_id: int, payload: schemas.CampaignManualReminder, db: Session = Depends(get_db),
                               actor: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = campaign_for_emails(campaign_id, db)
    return campaign_reminder_service.send_manual(campaign, actor, payload.employee_ids, db)


@app.get("/campaigns/{campaign_id}/completion-status", response_model=schemas.CompletionStatusResponse)
def get_campaign_completion_status(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    search: str | None = Query(default=None),
    status: str | None = Query(default=None),
    overdue_only: bool = Query(default=False),
    sort: str = Query(default="outstanding"),
    order: str = Query(default="desc"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("campaigns.read")),
):
    """Progress per evaluator. Who evaluates whom is never part of this view (requirement 7.4)."""
    reject_conflicting_requester(requester_user_id, actor)
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    today = campaign_today()
    now = datetime.now(timezone.utc)
    rows = (
        db.query(
            models.FilledForm.id,
            models.FilledForm.evaluator_id,
            models.FilledForm.evaluatee_id,
            models.FilledForm.form_id,
            models.FilledForm.company_group_id,
            models.FilledForm.finish_date,
            models.Employee.full_name.label("evaluator_name"),
            models.User.email.label("evaluator_email"),
            models.FormStatus.name.label("status_name"),
        )
        .join(models.Employee, models.Employee.id == models.FilledForm.evaluator_id)
        .outerjoin(models.User, models.User.id == models.Employee.user_id)
        .join(models.FormStatus, models.FormStatus.id == models.FilledForm.status_id)
        .filter(models.FilledForm.campaign_id == campaign.id)
        .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
        .all()
    )

    due_date = business_date(campaign.end_date)
    people: dict[int, dict] = {}
    pair_counts: dict[tuple, int] = {}
    for row in rows:
        status_key, _label = normalize_form_status(row.status_name, row.finish_date)
        person = people.setdefault(row.evaluator_id, {
            "evaluator_id": row.evaluator_id,
            "evaluator_name": row.evaluator_name,
            "evaluator_email": row.evaluator_email,
            "total": 0, "not_started": 0, "in_progress": 0, "completed": 0, "overdue": 0,
            "due_date": due_date, "last_completed_at": None,
        })
        person["total"] += 1
        person[status_key] += 1
        if row.finish_date is None and campaign_lifecycle.is_overdue(row, campaign, now=now):
            person["overdue"] += 1
        if row.finish_date is not None and (person["last_completed_at"] is None or row.finish_date > person["last_completed_at"]):
            person["last_completed_at"] = row.finish_date
        key = (row.evaluator_id, row.evaluatee_id, row.form_id, row.company_group_id)
        pair_counts[key] = pair_counts.get(key, 0) + 1

    def progress_key(person: dict) -> str:
        if person["completed"] == person["total"]:
            return "completed"
        if person["completed"] == 0 and person["in_progress"] == 0:
            return "not_started"
        return "in_progress"

    labels = {"not_started": "Not started", "in_progress": "In progress", "completed": "Completed"}
    all_people = []
    for person in people.values():
        person["outstanding"] = person["total"] - person["completed"]
        person["status_key"] = progress_key(person)
        person["status_label"] = labels[person["status_key"]]
        all_people.append(person)

    total = len(rows)
    completed = sum(person["completed"] for person in all_people)
    summary = {
        "total_evaluations": total,
        "not_started": sum(person["not_started"] for person in all_people),
        "in_progress": sum(person["in_progress"] for person in all_people),
        "completed": completed,
        "overdue": sum(person["overdue"] for person in all_people),
        "completion_rate": round((completed / total) * 100) if total > 0 else 0,
        "outstanding": total - completed,
        "evaluators": len(all_people),
        "evaluators_done": sum(1 for person in all_people if person["status_key"] == "completed"),
    }

    filtered = all_people
    if search is not None and search.strip() != "":
        term = search.strip().lower()
        filtered = [person for person in filtered
                    if term in person["evaluator_name"].lower() or term in (person["evaluator_email"] or "").lower()]
    if status is not None and status.strip() != "":
        status_key = status.strip().lower().replace("-", "_").replace(" ", "_")
        filtered = [person for person in filtered if person["status_key"] == status_key]
    if overdue_only:
        filtered = [person for person in filtered if person["overdue"] > 0]

    reverse = order.lower() == "desc"
    name = lambda person: (person["evaluator_name"].lower(), person["evaluator_id"])
    sort_key_map = {
        "outstanding": lambda person: (person["outstanding"], person["overdue"], *name(person)),
        "evaluator": name,
        "completed": lambda person: (person["completed"], *name(person)),
        "status": lambda person: ({"not_started": 0, "in_progress": 1, "completed": 2}[person["status_key"]], *name(person)),
        "last_completed_at": lambda person: (person["last_completed_at"] or date.min, *name(person)),
    }
    filtered = sorted(filtered, key=sort_key_map.get(sort, sort_key_map["outstanding"]), reverse=reverse)
    total_items = len(filtered)
    total_pages = max(1, (total_items + page_size - 1) // page_size)
    page = min(page, total_pages)
    page_start = (page - 1) * page_size
    page_rows = [{key: value for key, value in person.items() if key != "status_key"}
                 for person in filtered[page_start:page_start + page_size]]

    return {
        "campaign": {
            "id": campaign.id,
            "name": campaign.name,
            "is_active": campaign.is_active,
            "start_date": business_date(campaign.start_date),
            "end_date": business_date(campaign.end_date),
            "current_date": today,
            "lifecycle_status": campaign_lifecycle_status(campaign, today),
            "campaign_status": campaign.status,
            "is_archived": campaign.is_archived,
        },
        "summary": summary,
        "rows": page_rows,
        "pagination": {"page": page, "page_size": page_size, "total_items": total_items, "total_pages": total_pages},
        "duplicate_assignment_count": sum(1 for count in pair_counts.values() if count > 1),
    }


@app.get("/reports/campaigns", response_model=list[schemas.ReportCampaignOption])
def get_report_campaigns(requester_user_id: int | None = Query(default=None), db: Session = Depends(get_db),
                         actor: models.User = Depends(require_permission("reports.read", "reports.read_team"))):
    reject_conflicting_requester(requester_user_id, actor)
    return reporting_service.list_report_campaigns(actor, db)


@app.get("/reports/campaigns/{campaign_id}/overview", response_model=schemas.CampaignReportOverviewResponse)
def get_campaign_report_overview(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return reporting_service.build_campaign_report_overview(campaign_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/dashboard", response_model=schemas.CampaignDashboardResponse)
def get_campaign_report_dashboard(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return report_dashboard_service.build_campaign_dashboard(campaign_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/sections/{section_id}/questions", response_model=schemas.SectionQuestionsResponse)
def get_campaign_section_questions(
    campaign_id: int,
    section_id: int,
    group_ids: str = Query(default="", pattern=r"^(\d+(,\d+)*)?$"),
    role_ids: str = Query(default="", pattern=r"^(\d+(,\d+)*)?$"),
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    selected = list(dict.fromkeys(int(value) for value in group_ids.split(",") if value))
    roles = list(dict.fromkeys(int(value) for value in role_ids.split(",") if value))
    return report_dashboard_service.build_section_questions(campaign_id, section_id, selected, actor, db, role_ids=roles)


@app.get("/reports/campaigns/{campaign_id}/evaluation-quality", response_model=schemas.EvaluationQualityResponse)
def get_campaign_evaluation_quality(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return evaluation_quality_service.build_evaluation_quality(campaign_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/sections/{section_id}/comparison", response_model=schemas.ReportSectionCohortComparison)
def get_report_section_cohort_comparison(
    campaign_id: int,
    section_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return reporting_service.build_section_cohort_comparison(campaign_id, section_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/rating-distribution", response_model=schemas.ReportRatingDistributionResponse)
def get_campaign_rating_distribution(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    # Campaign-wide counts; for a group leader they are the company reference next to their groups.
    reporting_service.require_team_campaign(campaign_id, actor, db)
    return question_analytics_service.build_rating_distribution_report(campaign_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/questions", response_model=schemas.ReportQuestionsResponse)
def get_campaign_report_questions(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    group_id: int | None = Query(default=None),
    role_id: int | None = Query(default=None),
    employee_id: int | None = Query(default=None),
    perspective: str = Query(default="evaluatee"),
    evaluation_type: Literal["peer", "self"] = Query(default="peer"),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    if sum(value is not None for value in (group_id, role_id, employee_id)) > 1:
        raise HTTPException(status_code=400, detail="Select one Reports scope at a time")
    if perspective not in {"evaluatee", "evaluator"} or (perspective == "evaluator" and role_id is None):
        raise HTTPException(status_code=400, detail="Invalid question analytics perspective")
    # Team leads may explore questions for a group they lead or one of its employees only.
    if employee_id is not None:
        reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    elif group_id is not None:
        reporting_service.require_team_group(campaign_id, group_id, actor, db)
    else:
        reporting_service.enter_report_scope(actor, db)
        if reporting_service._team_groups.get() is not None:
            raise HTTPException(status_code=403, detail="Campaign-wide question analytics require full report access")
    return question_analytics_service.build_question_report(
        campaign_id, actor, db, group_id=group_id, role_id=role_id, employee_id=employee_id,
        perspective=perspective, evaluation_type=evaluation_type,
    )


@app.get("/reports/campaigns/{campaign_id}/written-feedback", response_model=schemas.ReportWrittenFeedbackResponse | schemas.ReportWrittenFeedbackIndexResponse)
def get_campaign_written_feedback(
    campaign_id: int,
    question_key: str | None = Query(default=None, pattern=r"^[0-9a-f]{64}$"),
    evaluation_type: Literal["peer", "self"] = Query(default="peer"),
    section_id: int | None = Query(default=None, gt=0),
    employee_id: int | None = Query(default=None, gt=0),
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return reporting_service.build_written_feedback(
        campaign_id, question_key, evaluation_type, actor, db,
        employee_id=employee_id, section_id=section_id,
    )


@app.get("/reports/campaigns/{campaign_id}/answers", response_model=schemas.AnswersIndexResponse)
def get_campaign_answers_index(
    campaign_id: int,
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    return answers_service.build_answers_index(campaign_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/answers/{employee_id}", response_model=schemas.EmployeeAnswersResponse)
def get_employee_answers(
    campaign_id: int,
    employee_id: int,
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    return answers_service.build_employee_answers(campaign_id, employee_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/groups")
def get_campaign_report_groups(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    reporting_service.enter_report_scope(actor, db)
    return reporting_service.build_groups_overview(campaign_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/groups/{group_id}")
def get_campaign_report_group_detail(
    campaign_id: int,
    group_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    reporting_service.require_team_group(campaign_id, group_id, actor, db)
    return reporting_service.build_group_detail(campaign_id, group_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/roles")
def get_campaign_report_roles(
    campaign_id: int,
    perspective: str = Query(default="evaluatee"),
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return reporting_service.build_roles_overview(campaign_id, actor, db, perspective)


@app.get("/reports/campaigns/{campaign_id}/roles/{role_id}")
def get_campaign_report_role_detail(
    campaign_id: int,
    role_id: int,
    perspective: str = Query(default="evaluatee"),
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return reporting_service.build_role_detail(campaign_id, role_id, actor, db, perspective)


@app.get("/reports/campaigns/{campaign_id}/employees")
def get_campaign_report_employees(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    reporting_service.enter_report_scope(actor, db)
    return reporting_service.build_employee_reports_overview(campaign_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/employees/{employee_id}")
def get_campaign_report_employee_detail(
    campaign_id: int,
    employee_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return reporting_service.build_employee_report_detail(campaign_id, employee_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis")
def get_employee_ai_analyses(
    campaign_id: int, employee_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return ai_workflow_service.list_analyses(db, campaign_id, employee_id, actor=actor)


@app.post("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/generate", status_code=202)
def generate_employee_ai_report(
    campaign_id: int, employee_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("ai_analysis.generate")),
):
    return ai_generation_jobs.start(db, campaign_id, "employee", employee_id, actor=actor)


@app.get("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/generation-job")
def employee_ai_generation_job(
    campaign_id: int, employee_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return ai_generation_jobs.status(db, campaign_id, "employee", employee_id, actor=actor)


@app.get("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/generation-job/{job_id}")
def employee_ai_generation_job_status(
    campaign_id: int, employee_id: int, job_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return ai_generation_jobs.status(db, campaign_id, "employee", employee_id, actor=actor, job_id=job_id)


@app.put("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/{analysis_id}")
def edit_employee_ai_report(
    campaign_id: int, employee_id: int, analysis_id: int, payload: EmployeeAIAnalysis,
    db: Session = Depends(get_db), actor: models.User = Depends(require_permission("ai_analysis.generate")),
):
    try:
        return ai_workflow_service.edit(db, campaign_id, employee_id, analysis_id, payload, actor=actor)
    except AnalysisGenerationError:
        raise HTTPException(status_code=422, detail="Edited analysis contains unsupported evidence or numerical claims") from None


@app.post("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/{analysis_id}/approve")
def approve_employee_ai_report(
    campaign_id: int, employee_id: int, analysis_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("ai_analysis.approve")),
):
    return ai_workflow_service.approve(db, campaign_id, employee_id, analysis_id, actor=actor)


def _register_aggregate_ai_routes(scope_type: str, route: str) -> None:
    """Keep all three aggregate scopes on the same authorized HR workflow."""
    read_permissions = ("reports.read", "reports.read_team") if scope_type == "group" else ("reports.read",)

    def authorize_read(campaign_id: int, scope_id: int | None, actor: models.User, db: Session) -> None:
        if scope_type == "group":
            reporting_service.require_team_group(campaign_id, scope_id or 0, actor, db)

    def history(campaign_id: int, scope_id: int | None = None, db: Session = Depends(get_db),
                actor: models.User = Depends(require_permission(*read_permissions))):
        authorize_read(campaign_id, scope_id, actor, db)
        return ai_aggregate_workflow_service.list_analyses(db, campaign_id, scope_type, scope_id, actor=actor)

    def generate(campaign_id: int, scope_id: int | None = None, db: Session = Depends(get_db),
                 actor: models.User = Depends(require_permission("ai_analysis.generate"))):
        return ai_generation_jobs.start(db, campaign_id, scope_type, scope_id, actor=actor)

    def latest_job(campaign_id: int, scope_id: int | None = None, db: Session = Depends(get_db),
                   actor: models.User = Depends(require_permission(*read_permissions))):
        authorize_read(campaign_id, scope_id, actor, db)
        return ai_generation_jobs.status(db, campaign_id, scope_type, scope_id, actor=actor)

    def job_status(campaign_id: int, job_id: int, scope_id: int | None = None,
                   db: Session = Depends(get_db),
                   actor: models.User = Depends(require_permission(*read_permissions))):
        authorize_read(campaign_id, scope_id, actor, db)
        return ai_generation_jobs.status(db, campaign_id, scope_type, scope_id, actor=actor, job_id=job_id)

    def edit(campaign_id: int, analysis_id: int, payload: EmployeeAIAnalysis,
             scope_id: int | None = None, db: Session = Depends(get_db),
             actor: models.User = Depends(require_permission("ai_analysis.generate"))):
        try:
            return ai_aggregate_workflow_service.edit(db, campaign_id, scope_type, scope_id,
                                                        analysis_id, payload, actor=actor)
        except AnalysisGenerationError:
            raise HTTPException(status_code=422, detail="Edited analysis contains unsupported evidence or numerical claims") from None

    def approve(campaign_id: int, analysis_id: int, scope_id: int | None = None,
                db: Session = Depends(get_db),
                actor: models.User = Depends(require_permission("ai_analysis.approve"))):
        return ai_aggregate_workflow_service.approve(db, campaign_id, scope_type, scope_id, analysis_id, actor=actor)

    app.add_api_route(route, history, methods=["GET"], name=f"get_{scope_type}_ai_analysis")
    app.add_api_route(f"{route}/generate", generate, methods=["POST"], status_code=202,
                      name=f"generate_{scope_type}_ai_analysis")
    app.add_api_route(f"{route}/generation-job", latest_job, methods=["GET"], name=f"latest_{scope_type}_ai_generation_job")
    app.add_api_route(f"{route}/generation-job/{{job_id}}", job_status, methods=["GET"],
                      name=f"get_{scope_type}_ai_generation_job")
    app.add_api_route(f"{route}/{{analysis_id}}", edit, methods=["PUT"], name=f"edit_{scope_type}_ai_analysis")
    app.add_api_route(f"{route}/{{analysis_id}}/approve", approve, methods=["POST"], name=f"approve_{scope_type}_ai_analysis")


_register_aggregate_ai_routes("campaign", "/reports/campaigns/{campaign_id}/ai-analysis")
_register_aggregate_ai_routes("group", "/reports/campaigns/{campaign_id}/groups/{scope_id}/ai-analysis")
_register_aggregate_ai_routes("role", "/reports/campaigns/{campaign_id}/roles/{scope_id}/ai-analysis")


def normalize_section_name(name: str) -> tuple[str, str]:
    display = " ".join(name.strip().split())
    if not display or len(display) > 120:
        raise HTTPException(status_code=400, detail="Section name must contain 1 to 120 characters")
    normalized = display.casefold()
    if len(normalized) > 120:
        raise HTTPException(status_code=400, detail="Normalized section name must contain at most 120 characters")
    return display, normalized


@app.get("/sections", response_model=list[schemas.SectionResponse])
def get_sections(include_archived: bool = Query(default=True), requester_user_id: int | None = Query(default=None),
                 db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.read"))):
    reject_conflicting_requester(requester_user_id, actor)
    query = db.query(models.Section).filter(models.Section.scope_key == "default")
    if not include_archived:
        query = query.filter(models.Section.is_archived.is_(False))
    return query.order_by(models.Section.is_archived.asc(), models.Section.name.asc()).all()


@app.post("/sections", response_model=schemas.SectionResponse, status_code=201)
def create_section(payload: schemas.SectionCreate, requester_user_id: int | None = Query(default=None),
                   db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.manage"))):
    reject_conflicting_requester(requester_user_id, actor)
    name, normalized = normalize_section_name(payload.name)
    section = models.Section(scope_key="default", name=name, normalized_name=normalized)
    db.add(section)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) != "uq_section_scope_name":
            raise
        raise HTTPException(status_code=409, detail="A section with this name already exists") from error
    db.refresh(section)
    return section


@app.put("/sections/{section_id}", response_model=schemas.SectionResponse)
def update_section(section_id: int, payload: schemas.SectionUpdate, requester_user_id: int | None = Query(default=None),
                   db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.manage"))):
    reject_conflicting_requester(requester_user_id, actor)
    section = db.query(models.Section).filter(models.Section.id == section_id, models.Section.scope_key == "default").first()
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")
    section.name, section.normalized_name = normalize_section_name(payload.name)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) != "uq_section_scope_name":
            raise
        raise HTTPException(status_code=409, detail="A section with this name already exists") from error
    db.refresh(section)
    return section


@app.post("/sections/{section_id}/archive", response_model=schemas.SectionResponse)
def archive_section(section_id: int, requester_user_id: int | None = Query(default=None),
                    db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.manage"))):
    reject_conflicting_requester(requester_user_id, actor)
    return set_section_archived(section_id, True, db)


@app.post("/sections/{section_id}/restore", response_model=schemas.SectionResponse)
def restore_section(section_id: int, requester_user_id: int | None = Query(default=None),
                    db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.manage"))):
    reject_conflicting_requester(requester_user_id, actor)
    return set_section_archived(section_id, False, db)


def set_section_archived(section_id: int, archived: bool, db: Session):
    section = db.query(models.Section).filter(models.Section.id == section_id, models.Section.scope_key == "default").first()
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")
    section.is_archived = archived
    db.commit()
    db.refresh(section)
    return section


@app.get("/campaigns", response_model=list[schemas.CampaignResponse])
def get_campaigns(db: Session = Depends(get_db),
                   _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaigns = (
        db.query(models.Campaign)
        .order_by(models.Campaign.is_archived.asc(),
                  case((models.Campaign.status == models.CampaignStatus.ACTIVE.value, 0),
                       (models.Campaign.status == models.CampaignStatus.SCHEDULED.value, 1),
                       (models.Campaign.status == models.CampaignStatus.REVIEW.value, 2),
                       (models.Campaign.status == models.CampaignStatus.PAUSED.value, 3),
                       (models.Campaign.status == models.CampaignStatus.DRAFT.value, 4), else_=5),
                  models.Campaign.start_date.desc())
        .all()
    )
    today = campaign_today()
    issued_counts = dict(
        db.query(models.FilledForm.campaign_id, func.count(models.FilledForm.id))
        .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
        .group_by(models.FilledForm.campaign_id)
        .all()
    )
    submitted_counts = dict(
        db.query(models.FilledForm.campaign_id, func.count(models.FilledForm.id))
        .filter(models.FilledForm.finish_date.isnot(None))
        .group_by(models.FilledForm.campaign_id)
        .all()
    )

    return [
        campaign_payload(campaign, today, issued_counts.get(campaign.id, 0), submitted_counts.get(campaign.id, 0))
        for campaign in campaigns
    ]


@app.get("/campaigns/{campaign_id}", response_model=schemas.CampaignResponse)
def get_campaign(campaign_id: int, db: Session = Depends(get_db),
                 _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaign = (
        db.query(models.Campaign)
        .filter(models.Campaign.id == campaign_id)
        .first()
    )

    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")

    today = campaign_today()
    issued_forms_count = (
        db.query(models.FilledForm)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
        .count()
    )

    submitted_forms_count = db.query(models.FilledForm).filter(
            models.FilledForm.campaign_id == campaign_id,
            models.FilledForm.finish_date.isnot(None),
        ).count()
    return campaign_payload(campaign, today, issued_forms_count, submitted_forms_count)


@app.get("/campaigns/{campaign_id}/operational-metrics", response_model=schemas.CampaignOperationalMetrics)
def get_campaign_operational_metrics(campaign_id: int, db: Session = Depends(get_db),
                                     _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    rows = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)),
    ).all()
    now = datetime.now(timezone.utc)
    submitted = sum(row.finish_date is not None for row in rows)
    total = len(rows)
    return {"campaign_id": campaign_id, "campaign_status": campaign.status, "total": total,
            "submitted": submitted, "incomplete": total - submitted,
            "completion_rate": round(submitted * 100 / total) if total else 0,
            "overdue": sum(campaign_lifecycle.is_overdue(row, campaign, now=now) for row in rows)}


@app.get("/campaigns/{campaign_id}/deletion-eligibility", response_model=schemas.CampaignDeletionEligibility)
def get_campaign_deletion_eligibility(campaign_id: int, db: Session = Depends(get_db),
                                      _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    reason = campaign_lifecycle.deletion_blocker(db, campaign)
    return {"campaign_id": campaign_id, "can_delete": reason is None, "reason": reason}


def change_campaign_archive(campaign_id: int, archived: bool, db: Session, actor: models.User):
    try:
        campaign = campaign_lifecycle.set_campaign_archived(
            db, campaign_id, archived, actor_user_id=actor.id, now=datetime.now(timezone.utc))
        db.commit()
    except campaign_lifecycle.CampaignLifecycleError as error:
        db.rollback()
        raise HTTPException(status_code=404 if str(error) == "Campaign not found" else 409, detail=str(error)) from error
    db.refresh(campaign)
    return campaign_payload(campaign, campaign_today())


@app.post("/campaigns/{campaign_id}/archive", response_model=schemas.CampaignResponse)
def archive_campaign(campaign_id: int, db: Session = Depends(get_db),
                     actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_archive(campaign_id, True, db, actor)


@app.post("/campaigns/{campaign_id}/unarchive", response_model=schemas.CampaignResponse)
def unarchive_campaign(campaign_id: int, db: Session = Depends(get_db),
                       actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_archive(campaign_id, False, db, actor)


@app.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: int, db: Session = Depends(get_db),
                     manager: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).populate_existing().with_for_update().one_or_none()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    reason = campaign_lifecycle.deletion_blocker(db, campaign)
    if reason is not None:
        raise HTTPException(status_code=409, detail=reason)
    db.add(models.CampaignOperationAudit(
        campaign_id=campaign.id, category="delete", actor_user_id=manager.id,
        is_automatic=False, occurred_at=datetime.now(timezone.utc),
        previous_status=campaign.status, resulting_status=None, issued_count=0,
    ))
    # All these rows are campaign-owned; forms, groups, employees and users are shared.
    db.query(models.FilledForm).filter(models.FilledForm.campaign_id == campaign_id).delete(synchronize_session=False)
    db.query(models.CampaignEvaluationRule).filter(models.CampaignEvaluationRule.campaign_id == campaign_id).delete(synchronize_session=False)
    db.query(models.CampaignEmployeeSelfEvaluation).filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id).delete(synchronize_session=False)
    db.execute(models.campaign_company_groups.delete().where(models.campaign_company_groups.c.campaign_id == campaign_id))
    db.query(models.CampaignLifecycleHistory).filter(models.CampaignLifecycleHistory.campaign_id == campaign_id).delete(synchronize_session=False)
    db.delete(campaign)
    db.commit()
    return {"deleted": True}


def duplicate_campaign_name(db: Session, name: str, exclude_id: int | None = None) -> bool:
    normalized = func.lower(func.regexp_replace(models.Campaign.name, r"^[[:space:]]+|[[:space:]]+$", "", "g"))
    requested = func.lower(func.regexp_replace(name, r"^[[:space:]]+|[[:space:]]+$", "", "g"))
    query = db.query(models.Campaign.id).filter(normalized == requested)
    if exclude_id is not None:
        query = query.filter(models.Campaign.id != exclude_id)
    return query.first() is not None


def campaigns_referencing_form(form_id: int, db: Session) -> list[models.Campaign]:
    ids = {row[0] for model in (models.CampaignEvaluationRule, models.CampaignEmployeeSelfEvaluation, models.FilledForm)
           for row in db.query(model.campaign_id).filter(model.form_id == form_id).distinct().all()}
    return [db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().one()
            for campaign_id in sorted(ids)]


def forms_used_by_campaigns(db: Session, campaign_id: int | None = None) -> set[int]:
    """Form ids referred to by campaign rules, self-evaluations or assignments (optionally of one campaign)."""
    used: set[int] = set()
    for model in (models.CampaignEvaluationRule, models.CampaignEmployeeSelfEvaluation, models.FilledForm):
        query = db.query(model.form_id).filter(model.form_id.isnot(None))
        if campaign_id is not None:
            query = query.filter(model.campaign_id == campaign_id)
        used.update(form_id for (form_id,) in query.distinct())
    return used


def selectable_forms(campaign_id: int, db: Session) -> list[models.Form]:
    """Forms a campaign can pick from: active ones, plus any archived one it already uses (so its name still shows)."""
    used = forms_used_by_campaigns(db, campaign_id)
    return (db.query(models.Form)
            .filter(or_(models.Form.archived_at.is_(None), models.Form.id.in_(used or {-1})))
            .order_by(models.Form.name.asc()).all())


def change_campaign_schedule(campaign_id: int, target: models.CampaignStatus, db: Session, actor: models.User):
    try:
        campaign = campaign_lifecycle.transition_campaign(
            db, campaign_id, target, now=datetime.now(timezone.utc), actor_user_id=actor.id,
            validate_configuration=campaign_service.validate_campaign_configuration,
        )
        db.commit()
    except campaign_lifecycle.CampaignLifecycleError as error:
        db.rollback()
        raise HTTPException(status_code=404 if str(error) == "Campaign not found" else 409, detail=str(error)) from error
    db.refresh(campaign)
    return campaign_payload(campaign, campaign_today())


@app.post("/campaigns/{campaign_id}/pause", response_model=schemas.CampaignResponse)
def pause_campaign(campaign_id: int, db: Session = Depends(get_db),
                   actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_schedule(campaign_id, models.CampaignStatus.PAUSED, db, actor)


@app.post("/campaigns/{campaign_id}/resume", response_model=schemas.CampaignResponse)
def resume_campaign(campaign_id: int, db: Session = Depends(get_db),
                    actor: models.User = Depends(require_permission("campaigns.manage"))):
    try:
        campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).populate_existing().with_for_update().one_or_none()
        if campaign is None:
            raise campaign_lifecycle.CampaignLifecycleError("Campaign not found")
        now = datetime.now(timezone.utc)
        target = (models.CampaignStatus.REVIEW if campaign.paused_from_status == models.CampaignStatus.REVIEW.value
                  or (campaign.end_date is not None and now >= campaign.end_date) else models.CampaignStatus.ACTIVE)
        campaign = campaign_lifecycle.transition_campaign(db, campaign_id, target, now=now, actor_user_id=actor.id)
        ensure_campaign_issued(campaign_id, db, commit=False, actor_user_id=actor.id)
        db.commit()
    except campaign_lifecycle.CampaignLifecycleError as error:
        db.rollback()
        raise HTTPException(status_code=404 if str(error) == "Campaign not found" else 409, detail=str(error)) from error
    db.refresh(campaign)
    return campaign_payload(campaign, campaign_today())


@app.post("/campaigns/{campaign_id}/review", response_model=schemas.CampaignResponse)
def review_campaign(campaign_id: int, db: Session = Depends(get_db),
                    actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_schedule(campaign_id, models.CampaignStatus.REVIEW, db, actor)


@app.post("/campaigns/{campaign_id}/close", response_model=schemas.CampaignResponse)
def close_campaign(campaign_id: int, db: Session = Depends(get_db),
                   actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_schedule(campaign_id, models.CampaignStatus.CLOSED, db, actor)


@app.post("/campaigns/{campaign_id}/schedule", response_model=schemas.CampaignResponse)
def schedule_campaign(campaign_id: int, db: Session = Depends(get_db),
                      actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_schedule(campaign_id, models.CampaignStatus.SCHEDULED, db, actor)


@app.post("/campaigns/{campaign_id}/unschedule", response_model=schemas.CampaignResponse)
def unschedule_campaign(campaign_id: int, db: Session = Depends(get_db),
                        actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_schedule(campaign_id, models.CampaignStatus.DRAFT, db, actor)


@app.post("/campaigns", response_model=schemas.CampaignResponse)
def create_campaign(campaign: schemas.CampaignCreate, db: Session = Depends(get_db),
                    actor: models.User = Depends(require_permission("campaigns.manage"))):
    if not campaign.name.strip():
        raise HTTPException(status_code=400, detail="Campaign name is required")
    try:
        start_at, end_at = campaign_instant(campaign.start_date), campaign_instant(campaign.end_date)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if end_at is not None and (end_at < start_at or (end_at == start_at and not (type(campaign.start_date) is date and type(campaign.end_date) is date))):
        raise HTTPException(status_code=400, detail="End date cannot be earlier than start date")

    if campaign.created_by is not None and campaign.created_by != actor.id:
        raise HTTPException(status_code=403, detail="Campaign creator does not match authenticated user")

    if duplicate_campaign_name(db, campaign.name):
        raise HTTPException(status_code=409, detail="A campaign with this name already exists.")

    new_campaign = models.Campaign(
        name=campaign.name.strip(),
        description=campaign.description,
        start_date=start_at,
        end_date=end_at,
        is_active=False,
        status=models.CampaignStatus.DRAFT.value,
        comment=campaign.comment,
        created_by=actor.id,
        launch_email_enabled=campaign_reminder_service.workspace_reminder_defaults(db)[1],
    )

    db.add(new_campaign)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) == "uq_campaigns_normalized_name":
            raise HTTPException(status_code=409, detail="A campaign with this name already exists.") from error
        raise
    db.refresh(new_campaign)

    return campaign_payload(new_campaign, campaign_today())


@app.put("/campaigns/{campaign_id}", response_model=schemas.CampaignResponse)
def update_campaign(campaign_id: int, campaign_update: schemas.CampaignUpdate, db: Session = Depends(get_db),
                     manager: models.User = Depends(require_permission("campaigns.manage"))):
    if not campaign_update.name.strip():
        raise HTTPException(status_code=400, detail="Campaign name is required")
    campaign = (
        db.query(models.Campaign)
        .filter(models.Campaign.id == campaign_id)
        .with_for_update()
        .first()
    )

    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_mutable_campaign_configuration(campaign)

    if duplicate_campaign_name(db, campaign_update.name, campaign_id):
        raise HTTPException(status_code=409, detail="A campaign with this name already exists.")

    issued_forms_count = (
        db.query(models.FilledForm)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
        .count()
    )

    supplied = campaign_update.model_fields_set
    if "is_active" in supplied and campaign_update.is_active != campaign.is_active:
        raise HTTPException(status_code=409, detail="Use the campaign lifecycle to change availability")
    start_at, end_at = campaign.start_date, campaign.end_date
    try:
        if "start_date" in supplied:
            if campaign_update.start_date is None:
                raise ValueError("Start date cannot be null")
            requested = campaign_instant(campaign_update.start_date)
            if isinstance(campaign_update.start_date, date) and not isinstance(campaign_update.start_date, datetime) and business_date(start_at) == campaign_update.start_date:
                requested = start_at
            start_at = requested
        if "end_date" in supplied:
            requested = campaign_instant(campaign_update.end_date)
            if type(campaign_update.end_date) is date and business_date(end_at) == campaign_update.end_date:
                requested = end_at
            end_at = requested
        if "start_at" in supplied:
            if campaign_update.start_at is None:
                raise ValueError("Start timestamp cannot be null")
            precise = campaign_instant(campaign_update.start_at)
            if "start_date" in supplied and (
                campaign_instant(campaign_update.start_date) != precise if isinstance(campaign_update.start_date, datetime)
                else business_date(precise) != campaign_update.start_date
            ):
                raise ValueError("Start date and timestamp disagree")
            start_at = precise
        if "end_at" in supplied:
            precise = campaign_instant(campaign_update.end_at)
            if "end_date" in supplied and (
                campaign_instant(campaign_update.end_date) != precise if isinstance(campaign_update.end_date, datetime)
                else business_date(precise) != campaign_update.end_date
            ):
                raise ValueError("End date and timestamp disagree")
            end_at = precise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    date_only_equal = type(campaign_update.start_date) is date and type(campaign_update.end_date) is date
    if end_at is not None and (end_at < start_at or (end_at == start_at and (start_at != campaign.start_date or end_at != campaign.end_date) and not date_only_equal)):
        raise HTTPException(status_code=400, detail="End date cannot be earlier than start date")

    if (start_at, end_at) != (campaign.start_date, campaign.end_date):
        try:
            campaign_lifecycle.validate_date_edit(campaign, start_at, end_at, now=datetime.now(timezone.utc),
                                                   validate_configuration=lambda _campaign, _start, _end: campaign_service.validate_campaign_configuration(campaign, db))
        except campaign_lifecycle.CampaignLifecycleError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    if (
        issued_forms_count > 0
        and campaign.end_date is not None
        and end_at is not None
        and end_at < campaign.end_date
    ):
        raise HTTPException(status_code=400, detail="End date cannot be moved earlier after questionnaires have been issued")

    campaign.name = campaign_update.name.strip()
    campaign.description = campaign_update.description
    if campaign.start_date != start_at:
        campaign.start_date = start_at
    if campaign.end_date != end_at:
        campaign.end_date = end_at
    campaign.comment = campaign_update.comment

    try:
        db.flush()
        campaign_service.validate_scheduled_campaign(campaign, db)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) == "uq_campaigns_normalized_name":
            raise HTTPException(status_code=409, detail="A campaign with this name already exists.") from error
        raise
    issued_forms_count = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)),
    ).count()
    db.refresh(campaign)

    submitted_forms_count = db.query(models.FilledForm).filter(
            models.FilledForm.campaign_id == campaign_id,
            models.FilledForm.finish_date.isnot(None),
        ).count()
    return campaign_payload(campaign, campaign_today(), issued_forms_count, submitted_forms_count)


@app.get("/campaigns/{campaign_id}/groups", response_model=schemas.CampaignGroupsResponse)
def get_campaign_groups(campaign_id: int, db: Session = Depends(get_db),
                        _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")

    groups = db.query(models.CompanyGroup).order_by(models.CompanyGroup.name.asc()).all()
    assigned_group_ids = [
        group_id
        for (group_id,) in db.query(models.campaign_company_groups.c.company_group_id)
        .filter(models.campaign_company_groups.c.campaign_id == campaign_id)
        .all()
    ]

    return {
        "available_groups": groups,
        "assigned_group_ids": assigned_group_ids,
    }


@app.put("/campaigns/{campaign_id}/groups", response_model=schemas.CampaignGroupsResponse)
def update_campaign_groups(campaign_id: int, payload: schemas.CampaignGroupsUpdate, db: Session = Depends(get_db),
                           manager: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_mutable_campaign_configuration(campaign)

    unique_group_ids = sorted(set(payload.group_ids))
    if len(unique_group_ids) > 0:
        matching_count = (
            db.query(models.CompanyGroup)
            .filter(models.CompanyGroup.id.in_(unique_group_ids))
            .count()
        )
        if matching_count != len(unique_group_ids):
            raise HTTPException(status_code=400, detail="One or more groups do not exist")

    removed_ids = set(campaign_service.get_campaign_assigned_group_ids(campaign_id, db)) - set(unique_group_ids)
    if removed_ids:
        has_rules = db.query(models.CampaignEvaluationRule.id).filter(
            models.CampaignEvaluationRule.campaign_id == campaign_id,
            models.CampaignEvaluationRule.company_group_id.in_(removed_ids),
        ).first() is not None
        group_assignments = db.query(models.FilledForm).filter(
            models.FilledForm.campaign_id == campaign_id,
            models.FilledForm.company_group_id.in_(removed_ids),
        ).all()
        has_evaluations = any(campaign_service.assignment_is_immutable(record) for record in group_assignments)
        if has_evaluations:
            raise HTTPException(status_code=409, detail="Groups with issued evaluations cannot be removed")
        if has_rules:
            raise HTTPException(status_code=409, detail="Remove saved form rules before deselecting these groups")
        remaining_members = {group_id: {person.id: person for person, _ in people_service.get_group_employees(group_id, db)}
                             for group_id in unique_group_ids}
        occupied = {(row.evaluator_id, row.evaluatee_id) for row in db.query(models.FilledForm).filter(
            models.FilledForm.campaign_id == campaign_id,
            ~models.FilledForm.company_group_id.in_(removed_ids),
        ).all()}
        for record in group_assignments:
            pair = (record.evaluator_id, record.evaluatee_id)
            if pair in occupied:
                raise HTTPException(status_code=409, detail="Overlapping groups already contain this evaluation pair")
            target = next((group_id for group_id, members in remaining_members.items()
                           if record.evaluator_id in members and record.evaluatee_id in members), None)
            if target is None:
                raise HTTPException(status_code=409, detail="Selected pairs must remain in a campaign group; use setup to replan them")
            record.company_group_id = target
            occupied.add(pair)
            if record.evaluator_id != record.evaluatee_id:
                record.form_id = get_form_id_for_employee_pair(
                    campaign_id, target, remaining_members[target][record.evaluator_id],
                    remaining_members[target][record.evaluatee_id], db)

    db.execute(
        models.campaign_company_groups.delete().where(
            models.campaign_company_groups.c.campaign_id == campaign_id
        )
    )
    for group_id in unique_group_ids:
        db.execute(
            models.campaign_company_groups.insert().values(
                campaign_id=campaign_id,
                company_group_id=group_id,
            )
        )
    db.flush()
    unschedule_if_incomplete(campaign, db, manager.id)
    db.commit()

    groups = db.query(models.CompanyGroup).order_by(models.CompanyGroup.name.asc()).all()
    return {
        "available_groups": groups,
        "assigned_group_ids": unique_group_ids,
    }


def get_self_evaluation_participants(campaign_id: int, db: Session, group_ids: list[int] | None = None):
    participants = {}
    for group_id in (campaign_service.get_campaign_assigned_group_ids(campaign_id, db) if group_ids is None else group_ids):
        group = db.query(models.CompanyGroup).filter(models.CompanyGroup.id == group_id).first()
        for employee, role in people_service.get_group_employees(group_id, db):
            row = participants.setdefault(employee.id, {
                "employee_id": employee.id,
                "employee_name": employee.full_name,
                "role_name": role.name,
                "group_names": [],
            })
            row["group_names"].append(group.name)
    return participants


def build_campaign_self_evaluations(campaign_id: int, db: Session, group_ids: list[int] | None = None):
    participants = get_self_evaluation_participants(campaign_id, db, group_ids)
    mappings = {
        row.employee_id: row.form_id
        for row in db.query(models.CampaignEmployeeSelfEvaluation)
        .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id).all()
    }
    issued = {}
    for row in db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        models.FilledForm.evaluator_id == models.FilledForm.evaluatee_id,
    ).all():
        if campaign_service.assignment_is_immutable(row):
            issued.setdefault(row.evaluator_id, row.form_id)
    forms = selectable_forms(campaign_id, db)
    return {
        "forms": [{"id": form.id, "name": form.name} for form in forms],
        "participants": [
            {**participant, "form_id": issued.get(employee_id, mappings.get(employee_id)), "locked": employee_id in issued}
            for employee_id, participant in sorted(participants.items(), key=lambda item: (item[1]["employee_name"], item[0]))
        ],
    }


@app.get("/campaigns/{campaign_id}/self-evaluations", response_model=schemas.CampaignSelfEvaluationsResponse)
def get_campaign_self_evaluations(campaign_id: int, db: Session = Depends(get_db),
                                  _reader: models.User = Depends(require_permission("campaigns.read"))):
    if db.query(models.Campaign.id).filter(models.Campaign.id == campaign_id).first() is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return build_campaign_self_evaluations(campaign_id, db)


@app.put("/campaigns/{campaign_id}/self-evaluations", response_model=schemas.CampaignSelfEvaluationsResponse)
def update_campaign_self_evaluations(campaign_id: int, payload: schemas.CampaignSelfEvaluationsUpdate, db: Session = Depends(get_db),
                                      manager: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_mutable_campaign_plan(campaign)
    participants = get_self_evaluation_participants(campaign_id, db)
    form_ids = {form_id for (form_id,) in db.query(models.Form.id).filter(models.Form.archived_at.is_(None))}
    desired = {}
    for assignment in payload.assignments:
        if assignment.employee_id not in participants:
            raise HTTPException(status_code=400, detail="Employee is not an active campaign participant")
        if assignment.employee_id in desired:
            raise HTTPException(status_code=400, detail="Duplicate self-evaluation assignment")
        if assignment.form_id is not None and assignment.form_id not in form_ids:
            raise HTTPException(status_code=400, detail="Self-evaluation form does not exist or is archived")
        desired[assignment.employee_id] = assignment.form_id

    issued = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        models.FilledForm.evaluator_id == models.FilledForm.evaluatee_id,
    ).all()
    for record in issued:
        if campaign_service.assignment_is_immutable(record) and record.evaluator_id in participants and desired.get(record.evaluator_id) != record.form_id:
            raise HTTPException(status_code=409, detail="Issued self-evaluations cannot be changed or removed")

    existing = {
        row.employee_id: row
        for row in db.query(models.CampaignEmployeeSelfEvaluation)
        .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id).all()
    }
    for employee_id, mapping in existing.items():
        # Retain historical assignments for employees no longer participating.
        if employee_id not in participants:
            continue
        form_id = desired.get(employee_id)
        if form_id is None:
            db.delete(mapping)
        else:
            mapping.form_id = form_id
    for employee_id, form_id in desired.items():
        if form_id is not None and employee_id not in existing:
            db.add(models.CampaignEmployeeSelfEvaluation(
                campaign_id=campaign_id, employee_id=employee_id, form_id=form_id,
            ))
    for record in issued:
        if campaign_service.assignment_is_immutable(record) or record.evaluator_id not in participants:
            continue
        form_id = desired.get(record.evaluator_id)
        record.form_id = form_id
    db.flush()
    unschedule_if_incomplete(campaign, db, manager.id)
    db.commit()
    return build_campaign_self_evaluations(campaign_id, db)


def build_campaign_rule_matrix(campaign_id: int, db: Session, group_ids: list[int] | None = None):
    assigned_group_ids = campaign_service.get_campaign_assigned_group_ids(campaign_id, db) if group_ids is None else group_ids
    groups = []
    if len(assigned_group_ids) > 0:
        groups = (
            db.query(models.CompanyGroup)
            .filter(models.CompanyGroup.id.in_(assigned_group_ids))
            .order_by(models.CompanyGroup.name.asc())
            .all()
        )

    existing_rules = {
        (rule.company_group_id, rule.evaluator_role_id, rule.evaluatee_role_id): rule
        for rule in db.query(models.CampaignEvaluationRule)
        .filter(models.CampaignEvaluationRule.campaign_id == campaign_id)
        .all()
    }
    locked_role_pairs = issued_role_pair_keys(campaign_id, db)
    planned = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        models.FilledForm.company_group_id.in_(assigned_group_ids),
        models.FilledForm.evaluator_id != models.FilledForm.evaluatee_id,
    ).all() if assigned_group_ids else []
    employee_ids = {employee_id for row in planned for employee_id in (row.evaluator_id, row.evaluatee_id)}
    employee_roles = dict(db.query(models.Employee.id, models.Employee.company_role_id).filter(
        models.Employee.id.in_(employee_ids)).all()) if employee_ids else {}
    required_pairs = {
        (row.company_group_id, employee_roles[row.evaluator_id], employee_roles[row.evaluatee_id])
        for row in planned if not campaign_service.assignment_is_immutable(row)
        and row.evaluator_id in employee_roles and row.evaluatee_id in employee_roles
    }

    matrices = []
    for group in groups:
        roles = people_service.get_group_roles(group.id, db)
        role_pairs = []
        for evaluator_role in roles:
            for evaluatee_role in roles:
                rule = existing_rules.get((group.id, evaluator_role.id, evaluatee_role.id))
                role_pairs.append({
                    "evaluator_role_id": evaluator_role.id,
                    "evaluator_role_name": evaluator_role.name,
                    "evaluatee_role_id": evaluatee_role.id,
                    "evaluatee_role_name": evaluatee_role.name,
                    "form_id": rule.form_id if rule is not None else None,
                    "rule_id": rule.id if rule is not None else None,
                    "locked": rule is not None and (group.id, evaluator_role.id, evaluatee_role.id) in locked_role_pairs,
                    "required": (group.id, evaluator_role.id, evaluatee_role.id) in required_pairs,
                })
        matrices.append({
            "group_id": group.id,
            "group_name": group.name,
            "role_pairs": role_pairs,
            "required_count": sum(pair["required"] for pair in role_pairs),
            "configured_required_count": sum(pair["required"] and pair["form_id"] is not None for pair in role_pairs),
        })

    forms = selectable_forms(campaign_id, db)
    return {
        "forms": [{"id": form.id, "name": form.name} for form in forms],
        "groups": matrices,
    }


def issued_role_pair_keys(campaign_id: int, db: Session):
    assignments = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        models.FilledForm.company_group_id.isnot(None),
        models.FilledForm.evaluator_id != models.FilledForm.evaluatee_id,
    ).all()
    issued = [assignment for assignment in assignments if campaign_service.assignment_is_immutable(assignment)]
    employee_ids = {employee_id for assignment in issued for employee_id in (assignment.evaluator_id, assignment.evaluatee_id)}
    roles = {person.id: person.company_role_id for person in db.query(models.Employee).filter(models.Employee.id.in_(employee_ids)).all()} if employee_ids else {}
    keys = set()
    for assignment in issued:
        evaluator_role = reporting_service.assignment_role_id(assignment, roles, evaluator=True)
        evaluatee_role = reporting_service.assignment_role_id(assignment, roles)
        if evaluator_role is not None and evaluatee_role is not None:
            keys.add((assignment.company_group_id, evaluator_role, evaluatee_role))
    return keys


def get_or_create_default_form_status(db: Session):
    status = (
        db.query(models.FormStatus)
        .filter(func.lower(models.FormStatus.name) == "not started")
        .first()
    )
    if status is not None:
        return status

    status = models.FormStatus(name="Not started")
    db.add(status)
    db.flush()
    return status


def get_form_id_for_employee_pair(campaign_id: int, group_id: int, evaluator, evaluatee, db: Session):
    rule = (
        db.query(models.CampaignEvaluationRule)
        .filter(models.CampaignEvaluationRule.campaign_id == campaign_id)
        .filter(models.CampaignEvaluationRule.company_group_id == group_id)
        .filter(models.CampaignEvaluationRule.evaluator_role_id == evaluator.company_role_id)
        .filter(models.CampaignEvaluationRule.evaluatee_role_id == evaluatee.company_role_id)
        .first()
    )
    return rule.form_id if rule is not None else None


def build_campaign_evaluation_matrix(campaign_id: int, db: Session, issuance_errors=None, group_ids: list[int] | None = None):
    assigned_group_ids = campaign_service.get_campaign_assigned_group_ids(campaign_id, db) if group_ids is None else group_ids
    groups = []
    if len(assigned_group_ids) > 0:
        groups = (
            db.query(models.CompanyGroup)
            .filter(models.CompanyGroup.id.in_(assigned_group_ids))
            .order_by(models.CompanyGroup.name.asc())
            .all()
        )

    filled_forms_by_pair = {}
    for filled_form in (
        db.query(models.FilledForm)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .filter(models.FilledForm.company_group_id.isnot(None))
        .all()
    ):
        key = (filled_form.company_group_id, filled_form.evaluator_id, filled_form.evaluatee_id)
        existing = filled_forms_by_pair.get(key)
        if existing is None or campaign_service.assignment_is_immutable(filled_form) and not campaign_service.assignment_is_immutable(existing):
            filled_forms_by_pair[key] = filled_form

    matrices = []
    for group in groups:
        employee_rows = people_service.get_group_employees(group.id, db)
        active_member_ids = {person.id for person, _role in employee_rows}
        employees_by_id = {person.id: (person, role) for person, role in employee_rows}
        group_assignments = [row for row in filled_forms_by_pair.values() if row.company_group_id == group.id and campaign_service.assignment_is_immutable(row)]
        historical_employee_ids = {employee_id for row in group_assignments for employee_id in (row.evaluator_id, row.evaluatee_id)} - set(employees_by_id)
        if historical_employee_ids:
            for person, role in db.query(models.Employee, models.CompanyRole).join(
                models.CompanyRole, models.CompanyRole.id == models.Employee.company_role_id,
            ).filter(models.Employee.id.in_(historical_employee_ids)).all():
                employees_by_id[person.id] = (person, role)
        employee_rows = sorted(employees_by_id.values(), key=lambda item: (item[0].full_name.lower(), item[0].id))
        employees = [person for person, _role in employee_rows]
        matrices.append({
            "group_id": group.id,
            "group_name": group.name,
            "employees": [
                {
                    "id": person.id,
                    "name": person.full_name,
                    "role_id": role.id,
                    "role_name": role.name,
                    "active": person.id in active_member_ids and person.is_active,
                }
                for person, role in employee_rows
            ],
            "assignments": [
                {
                    "evaluator_id": evaluator.id,
                    "evaluatee_id": evaluatee.id,
                    "form_id": filled_form.form_id,
                    "filled_form_id": filled_form.id,
                    # Only whether it is locked: per-pair progress would turn the planning
                    # matrix into a "who evaluates whom" completion view (requirement 7.4).
                    "issued": campaign_service.assignment_is_immutable(filled_form),
                }
                for evaluator in employees
                for evaluatee in employees
                for filled_form in [filled_forms_by_pair.get((group.id, evaluator.id, evaluatee.id))]
                if filled_form is not None
            ],
        })

    return {"groups": matrices, "issuance_errors": issuance_errors or []}


@app.get("/campaigns/{campaign_id}/evaluation-rules", response_model=schemas.CampaignEvaluationRulesResponse)
def get_campaign_evaluation_rules(campaign_id: int, db: Session = Depends(get_db),
                                  _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return build_campaign_rule_matrix(campaign_id, db)


@app.put("/campaigns/{campaign_id}/evaluation-rules", response_model=schemas.CampaignEvaluationRulesResponse)
def update_campaign_evaluation_rules(campaign_id: int, payload: schemas.CampaignEvaluationRulesUpdate, db: Session = Depends(get_db),
                                      manager: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_mutable_campaign_plan(campaign)

    assigned_group_ids = set(campaign_service.get_campaign_assigned_group_ids(campaign_id, db))
    form_ids = {form_id for (form_id,) in db.query(models.Form.id).filter(models.Form.archived_at.is_(None))}
    valid_role_pairs_by_group = {}
    for group_id in assigned_group_ids:
        role_ids = {role.id for role in people_service.get_group_roles(group_id, db)}
        valid_role_pairs_by_group[group_id] = {
            (evaluator_role_id, evaluatee_role_id)
            for evaluator_role_id in role_ids
            for evaluatee_role_id in role_ids
        }

    seen_pairs = set()
    for rule in payload.rules:
        if rule.company_group_id not in assigned_group_ids:
            raise HTTPException(status_code=400, detail="Rule group is not assigned to this campaign")
        if rule.form_id not in form_ids:
            raise HTTPException(status_code=400, detail="Rule form does not exist or is archived")
        pair = (rule.evaluator_role_id, rule.evaluatee_role_id)
        if pair not in valid_role_pairs_by_group.get(rule.company_group_id, set()):
            raise HTTPException(status_code=400, detail="Rule role pair is not valid for the selected group")
        unique_key = (rule.company_group_id, rule.evaluator_role_id, rule.evaluatee_role_id)
        if unique_key in seen_pairs:
            raise HTTPException(status_code=400, detail="Duplicate rule for the same group and role pair")
        seen_pairs.add(unique_key)

    selected_rules = {(rule.company_group_id, rule.evaluator_role_id, rule.evaluatee_role_id): rule.form_id for rule in payload.rules}
    existing_rules = {
        (rule.company_group_id, rule.evaluator_role_id, rule.evaluatee_role_id): rule
        for rule in db.query(models.CampaignEvaluationRule).filter(models.CampaignEvaluationRule.campaign_id == campaign_id).all()
    }
    for key in issued_role_pair_keys(campaign_id, db):
        current = existing_rules.get(key)
        if current is not None and selected_rules.get(key) != current.form_id:
            raise HTTPException(status_code=409, detail="Form rules used by issued evaluations cannot be changed or removed")

    for key, rule in existing_rules.items():
        if key not in selected_rules:
            db.delete(rule)
        else:
            rule.form_id = selected_rules[key]
    for key, form_id in selected_rules.items():
        if key not in existing_rules:
            group_id, evaluator_role_id, evaluatee_role_id = key
            db.add(models.CampaignEvaluationRule(
                campaign_id=campaign_id,
                company_group_id=group_id,
                evaluator_role_id=evaluator_role_id,
                evaluatee_role_id=evaluatee_role_id,
                form_id=form_id,
            ))
    for assignment in db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        unissued_snapshot_filter(),
        models.FilledForm.company_group_id.isnot(None),
    ).all():
        if assignment.finish_date is not None or assignment.answers or assignment.evaluator_id == assignment.evaluatee_id:
            continue
        evaluator = db.query(models.Employee).filter(models.Employee.id == assignment.evaluator_id).first()
        evaluatee = db.query(models.Employee).filter(models.Employee.id == assignment.evaluatee_id).first()
        form_id = selected_rules.get((assignment.company_group_id, evaluator.company_role_id, evaluatee.company_role_id)) if evaluator and evaluatee else None
        assignment.form_id = form_id
    db.flush()
    unschedule_if_incomplete(campaign, db, manager.id)
    db.commit()

    return build_campaign_rule_matrix(campaign_id, db)


@app.get("/campaigns/{campaign_id}/evaluation-matrix", response_model=schemas.CampaignEvaluationMatrixResponse)
def get_campaign_evaluation_matrix(campaign_id: int, db: Session = Depends(get_db),
                                   _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")

    return build_campaign_evaluation_matrix(campaign_id, db)


def validate_matrix_issued_assignments(existing_by_pair, scoped_pairs, selected_pairs, requested_tasks, existing_tasks):
    issued_pairs = {pair for pair, form in existing_by_pair.items() if campaign_service.assignment_is_immutable(form)}
    if issued_pairs.intersection(scoped_pairs) - selected_pairs:
        raise HTTPException(status_code=409, detail="Issued evaluations cannot be removed from the matrix. Reload and keep their selections")

    new_tasks = set()
    for group_id, evaluator_id, evaluatee_id, _form_id in requested_tasks:
        if (group_id, evaluator_id, evaluatee_id) in existing_by_pair:
            continue
        task = (evaluator_id, evaluatee_id)
        if task in existing_tasks or task in new_tasks:
            raise HTTPException(status_code=409, detail="This evaluation already exists in another group; select it in only one group")
        new_tasks.add(task)


@app.put("/campaigns/{campaign_id}/evaluation-matrix", response_model=schemas.CampaignEvaluationMatrixUpdateResponse)
def update_campaign_evaluation_matrix(campaign_id: int, payload: schemas.CampaignEvaluationMatrixUpdate, db: Session = Depends(get_db),
                                       manager: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_mutable_campaign_plan(campaign)

    assigned_group_ids = set(campaign_service.get_campaign_assigned_group_ids(campaign_id, db))
    group_members_by_group = {
        group_id: {user.id: user for user, _role in people_service.get_group_employees(group_id, db)}
        for group_id in assigned_group_ids
    }
    scoped_group_user_pairs = {
        (group_id, evaluator_id, evaluatee_id)
        for group_id, members in group_members_by_group.items()
        for evaluator_id in members.keys()
        for evaluatee_id in members.keys()
    }
    existing_forms = db.query(models.FilledForm).filter(models.FilledForm.campaign_id == campaign_id).all()
    self_form_ids = {
        row.employee_id: row.form_id
        for row in db.query(models.CampaignEmployeeSelfEvaluation)
        .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id).all()
    }
    existing_self_forms = {form.evaluator_id: form for form in existing_forms if form.evaluator_id == form.evaluatee_id and campaign_service.assignment_is_immutable(form)}
    existing_by_pair = {}
    for filled_form in existing_forms:
        if filled_form.company_group_id is None:
            continue
        key = (filled_form.company_group_id, filled_form.evaluator_id, filled_form.evaluatee_id)
        if key in existing_by_pair:
            raise HTTPException(status_code=409, detail="Duplicate issued evaluations exist for a matrix pair; resolve them before saving")
        existing_by_pair[key] = filled_form
    scoped_group_user_pairs.update(pair for pair, assignment in existing_by_pair.items() if campaign_service.assignment_is_immutable(assignment))

    seen_assignments = set()
    desired_assignments = set()
    for assignment in payload.assignments:
        if assignment.company_group_id not in assigned_group_ids:
            raise HTTPException(status_code=400, detail="Assignment group is not assigned to this campaign")

        unique_group_pair = (assignment.company_group_id, assignment.evaluator_id, assignment.evaluatee_id)
        existing = existing_by_pair.get(unique_group_pair)
        if existing is not None and campaign_service.assignment_is_immutable(existing):
            if unique_group_pair in seen_assignments:
                raise HTTPException(status_code=400, detail="Duplicate matrix assignment")
            seen_assignments.add(unique_group_pair)
            desired_assignments.add((*unique_group_pair, existing.form_id))
            continue

        group_members = group_members_by_group.get(assignment.company_group_id, {})
        evaluator = group_members.get(assignment.evaluator_id)
        evaluatee = group_members.get(assignment.evaluatee_id)
        if evaluator is None or evaluatee is None:
            raise HTTPException(status_code=400, detail="Assignment employees must be active members of the selected group")

        if unique_group_pair in seen_assignments:
            raise HTTPException(status_code=400, detail="Duplicate matrix assignment")
        seen_assignments.add(unique_group_pair)

        if assignment.evaluator_id == assignment.evaluatee_id:
            if assignment.evaluator_id in existing_self_forms:
                # Another group already issued this employee's single campaign-wide task.
                continue
            form_id = self_form_ids.get(assignment.evaluator_id)
            desired_assignments.add((*unique_group_pair, form_id))
            continue
        form_id = get_form_id_for_employee_pair(campaign_id, assignment.company_group_id, evaluator, evaluatee, db)
        desired_assignments.add((*unique_group_pair, form_id))

    # Multiple groups can contain the same person, but only one diagonal task may be issued.
    self_tasks = {}
    for task in sorted(desired_assignments, key=lambda item: (item[0], item[1], item[2])):
        group_id, evaluator_id, evaluatee_id, form_id = task
        if evaluator_id != evaluatee_id or (group_id, evaluator_id, evaluatee_id) in existing_by_pair and campaign_service.assignment_is_immutable(existing_by_pair[(group_id, evaluator_id, evaluatee_id)]):
            continue
        if evaluator_id in self_tasks:
            desired_assignments.remove(task)
        else:
            self_tasks[evaluator_id] = form_id

    selected_people_pairs = set()
    for _group_id, evaluator_id, evaluatee_id, _form_id in desired_assignments:
        pair = (evaluator_id, evaluatee_id)
        if pair in selected_people_pairs:
            raise HTTPException(status_code=409, detail="Only one assignment per evaluator/evaluatee pair is allowed in a campaign")
        selected_people_pairs.add(pair)

    # Duplicate pairs are forbidden even when different groups specify different forms.
    existing_tasks = {
        (form.evaluator_id, form.evaluatee_id)
        for form in existing_forms
        if campaign_service.assignment_is_immutable(form)
    }
    validate_matrix_issued_assignments(
        existing_by_pair, scoped_group_user_pairs, seen_assignments, desired_assignments, existing_tasks
    )

    desired_by_pair = {(group_id, evaluator_id, evaluatee_id): form_id for group_id, evaluator_id, evaluatee_id, form_id in desired_assignments}
    removed_count = 0
    for pair, existing in existing_by_pair.items():
        if campaign_service.assignment_is_immutable(existing):
            continue
        if campaign.legacy_issuance_blocked and desired_by_pair.get(pair) != existing.form_id:
            raise HTTPException(status_code=409, detail="Historical planned assignments cannot be changed through migrated-campaign issuance")
        if pair not in desired_by_pair:
            db.delete(existing)
            removed_count += 1
        else:
            existing.form_id = desired_by_pair[pair]

    remaining_pairs = {(form.evaluator_id, form.evaluatee_id) for form in existing_forms if campaign.legacy_issuance_blocked or campaign_service.assignment_is_immutable(form) or (form.company_group_id, form.evaluator_id, form.evaluatee_id) in desired_by_pair}
    for group_id, evaluator_id, evaluatee_id, form_id in desired_assignments:
        if (group_id, evaluator_id, evaluatee_id) not in existing_by_pair and (evaluator_id, evaluatee_id) in remaining_pairs:
            raise HTTPException(status_code=409, detail="This evaluator/evaluatee pair already has an assignment in this campaign")
        remaining_pairs.add((evaluator_id, evaluatee_id))

    status = get_or_create_default_form_status(db)

    created_count = 0
    created_records = []
    for group_id, evaluator_id, evaluatee_id, form_id in desired_assignments:
        if (group_id, evaluator_id, evaluatee_id) in existing_by_pair:
            continue
        form = db.query(models.Form).filter(models.Form.id == form_id).first() if form_id is not None else None
        if form_id is not None and form is None:
            raise HTTPException(status_code=400, detail="Assignment form does not exist")
        record = models.FilledForm(
            campaign_id=campaign_id,
            company_group_id=group_id,
            evaluator_id=evaluator_id,
            evaluatee_id=evaluatee_id,
            form_id=form_id,
            status_id=status.id,
            finish_date=None,
            answers=[],
            form_snapshot=None,
            snapshot_status=None,
        )
        db.add(record)
        created_records.append(record)
        created_count += 1

    if campaign.legacy_issuance_blocked and campaign.status in {
        models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value,
    } and created_records:
        raise HTTPException(status_code=409, detail="New pairs in migrated campaigns require a verified issuance path")
    db.flush()
    unschedule_if_incomplete(campaign, db, manager.id)
    db.commit()
    matrix = build_campaign_evaluation_matrix(campaign_id, db)
    return {
        **matrix,
        "created_count": created_count,
        "removed_count": removed_count,
        "kept_completed_count": sum(form.finish_date is not None for form in existing_forms),
    }


@app.post("/campaigns/{campaign_id}/issue-planned", response_model=schemas.CampaignEvaluationMatrixResponse)
def issue_ready_campaign_evaluations(campaign_id: int, db: Session = Depends(get_db),
                                     manager: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.is_archived or campaign.status not in {
        models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value,
    } or campaign.legacy_issuance_blocked:
        raise HTTPException(status_code=409, detail="Only active or review campaigns with verified provenance can issue planned evaluations")
    now = datetime.now(timezone.utc)
    if campaign.status == models.CampaignStatus.ACTIVE.value and (
        campaign.start_date > now or campaign.end_date is not None and campaign.end_date <= now
    ):
        raise HTTPException(status_code=409, detail="The active campaign window has ended; move to Review before issuing")

    planned = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id, unissued_snapshot_filter(),
        models.FilledForm.finish_date.is_(None), models.FilledForm.answers == [],
    ).order_by(models.FilledForm.id).all()
    if not planned:
        raise HTTPException(status_code=409, detail="No planned evaluations are waiting for issuance")
    group_ids = set(campaign_service.get_campaign_assigned_group_ids(campaign_id, db))
    members = {group_id: {person.id: person for person, _ in people_service.get_group_employees(group_id, db)}
               for group_id in group_ids}
    self_forms = {row.employee_id: row.form_id for row in db.query(models.CampaignEmployeeSelfEvaluation)
                  .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id)}
    for row in planned:
        group_members = members.get(row.company_group_id, {})
        evaluator = group_members.get(row.evaluator_id)
        evaluatee = group_members.get(row.evaluatee_id)
        if evaluator is None or evaluatee is None:
            raise HTTPException(status_code=409, detail="Planned evaluation employees must belong to an active selected group")
        expected = self_forms.get(row.evaluator_id) if row.evaluator_id == row.evaluatee_id else get_form_id_for_employee_pair(
            campaign_id, row.company_group_id, evaluator, evaluatee, db)
        if expected is None:
            raise HTTPException(status_code=409, detail="Assign questionnaires to all planned evaluation pairs before issuing")
        if row.form_id != expected:
            raise HTTPException(status_code=409, detail="A planned evaluation has a stale questionnaire; save its role assignments before issuing")

    errors = issue_activation_snapshots(campaign, db, actor_user_id=manager.id)
    if errors:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cannot issue planned evaluations: " + "; ".join(errors))
    db.commit()
    return build_campaign_evaluation_matrix(campaign_id, db)


@app.get("/campaigns/{campaign_id}/setup-preview", response_model=schemas.CampaignSetupPreviewResponse)
def get_campaign_setup_preview(campaign_id: int, group_ids: list[int] = Query(default=[]),
                               db: Session = Depends(get_db),
                               _reader: models.User = Depends(require_permission("campaigns.read"))):
    if db.query(models.Campaign.id).filter(models.Campaign.id == campaign_id).first() is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if len(group_ids) != len(set(group_ids)) or db.query(models.CompanyGroup.id).filter(models.CompanyGroup.id.in_(group_ids)).count() != len(group_ids):
        raise HTTPException(status_code=400, detail="Selected groups must exist and be unique")
    return {
        "rules": build_campaign_rule_matrix(campaign_id, db, group_ids),
        "self_evaluations": build_campaign_self_evaluations(campaign_id, db, group_ids),
        "matrix": build_campaign_evaluation_matrix(campaign_id, db, group_ids=group_ids),
    }


@app.put("/campaigns/{campaign_id}/setup", response_model=schemas.CampaignEvaluationMatrixResponse)
def update_campaign_setup(campaign_id: int, payload: schemas.CampaignSetupUpdate, db: Session = Depends(get_db),
                          manager: models.User = Depends(require_permission("campaigns.manage"))):
    """Replace a draft/scheduled configuration in one transaction, without issuing forms."""
    try:
        if payload.memberships:
            grant = db.query(models.SystemPermission.id).select_from(models.User).join(
                models.SystemRole, models.SystemRole.id == models.User.system_role_id,
            ).join(models.system_role_permissions,
                   models.system_role_permissions.c.system_role_id == models.SystemRole.id).join(
                models.SystemPermission, models.SystemPermission.id == models.system_role_permissions.c.permission_id,
            ).filter(models.User.id == manager.id, models.SystemPermission.name == "groups.manage").first()
            if grant is None:
                raise HTTPException(status_code=403, detail="Group membership changes require groups.manage")
        campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
        if campaign is None:
            raise HTTPException(status_code=404, detail="Campaign not found")
        require_mutable_campaign_configuration(campaign)
        if campaign.status not in {models.CampaignStatus.DRAFT.value, models.CampaignStatus.SCHEDULED.value}:
            raise HTTPException(status_code=409, detail="Only draft and scheduled campaigns can replace their setup")

        group_ids = set(payload.group_ids)
        if len(group_ids) != len(payload.group_ids) or db.query(models.CompanyGroup.id).filter(models.CompanyGroup.id.in_(group_ids)).count() != len(group_ids):
            raise HTTPException(status_code=400, detail="Groups must exist and be unique")

        previous_groups = set(campaign_service.get_campaign_assigned_group_ids(campaign_id, db))
        removed_groups = previous_groups - group_ids
        membership_keys = set()
        affected = {}
        for change in payload.memberships:
            key = (change.company_group_id, change.employee_id)
            if key in membership_keys or change.company_group_id not in (group_ids | previous_groups):
                raise HTTPException(status_code=400, detail="Membership changes must be unique and belong to a campaign group")
            membership_keys.add(key)
            if db.query(models.Employee.id).filter(models.Employee.id == change.employee_id).first() is None:
                raise HTTPException(status_code=400, detail="Membership employee does not exist")
        if membership_keys:
            affected = {row.id: row for row in campaign_service.scheduled_campaigns_for_groups(
                {group_id for group_id, _ in membership_keys}, db) if row.id != campaign_id}
        for change in payload.memberships:
            membership = models.employee_company_groups.select().where(
                models.employee_company_groups.c.company_group_id == change.company_group_id,
                models.employee_company_groups.c.employee_id == change.employee_id,
            )
            exists = db.execute(membership).first() is not None
            if change.included and not exists:
                db.execute(models.employee_company_groups.insert().values(
                    company_group_id=change.company_group_id, employee_id=change.employee_id))
            elif not change.included and exists:
                immutable = db.query(models.FilledForm).filter(
                    models.FilledForm.company_group_id == change.company_group_id,
                    or_(models.FilledForm.evaluator_id == change.employee_id,
                        models.FilledForm.evaluatee_id == change.employee_id),
                ).all()
                if any(campaign_service.assignment_is_immutable(row) for row in immutable):
                    raise HTTPException(status_code=409, detail="Issued evaluations prevent removing this member")
                db.execute(models.employee_company_groups.delete().where(
                    models.employee_company_groups.c.company_group_id == change.company_group_id,
                    models.employee_company_groups.c.employee_id == change.employee_id))

        members = {group_id: {person.id: person for person, _ in people_service.get_group_employees(group_id, db)} for group_id in group_ids}
        participants = {employee_id for people in members.values() for employee_id in people}
        form_ids = {row[0] for row in db.query(models.Form.id).all()}
        rules = {}
        for item in payload.rules:
            if item.company_group_id in removed_groups:
                continue
            key = (item.company_group_id, item.evaluator_role_id, item.evaluatee_role_id)
            roles = {person.company_role_id for person in members.get(item.company_group_id, {}).values()}
            if key in rules or item.evaluator_role_id not in roles or item.evaluatee_role_id not in roles or item.form_id not in form_ids:
                raise HTTPException(status_code=400, detail="Invalid or duplicate role rule")
            rules[key] = item.form_id
        self_forms = {}
        existing_self = {row.employee_id: row for row in db.query(models.CampaignEmployeeSelfEvaluation)
                         .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id)}
        for item in payload.self_evaluations:
            if item.employee_id not in participants and item.employee_id in existing_self and removed_groups:
                continue
            if item.employee_id in self_forms or item.employee_id not in participants or (item.form_id is not None and item.form_id not in form_ids):
                raise HTTPException(status_code=400, detail="Invalid or duplicate self-evaluation")
            if item.form_id is not None:
                self_forms[item.employee_id] = item.form_id

        selected = {}
        selected_people = set()
        for item in payload.assignments:
            if item.company_group_id in removed_groups:
                continue
            key = (item.company_group_id, item.evaluator_id, item.evaluatee_id)
            pair = (item.evaluator_id, item.evaluatee_id)
            if key in selected or pair in selected_people or item.evaluator_id not in members.get(item.company_group_id, {}) or item.evaluatee_id not in members[item.company_group_id]:
                raise HTTPException(status_code=400, detail="Invalid or duplicate matrix assignment")
            selected_people.add(pair)
            evaluator = members[item.company_group_id][item.evaluator_id]
            evaluatee = members[item.company_group_id][item.evaluatee_id]
            form_id = (self_forms.get(item.evaluator_id) if item.evaluator_id == item.evaluatee_id else
                       rules.get((item.company_group_id, evaluator.company_role_id, evaluatee.company_role_id)))
            selected[key] = form_id

        existing_assignments = db.query(models.FilledForm).filter(models.FilledForm.campaign_id == campaign_id).all()
        existing_pairs = set()
        for row in existing_assignments:
            key = (row.company_group_id, row.evaluator_id, row.evaluatee_id)
            if key in existing_pairs:
                raise HTTPException(status_code=409, detail="Duplicate historical matrix assignments must be resolved")
            existing_pairs.add(key)
            if campaign_service.assignment_is_immutable(row) and (key not in selected or selected[key] != row.form_id):
                raise HTTPException(status_code=409, detail="Issued evaluations cannot be changed or removed")
            if campaign.legacy_issuance_blocked and not campaign_service.assignment_is_immutable(row) and (key not in selected or selected[key] != row.form_id):
                raise HTTPException(status_code=409, detail="Historical planned assignments cannot be changed")
        relocated = {}
        for row in existing_assignments:
            if row.company_group_id not in removed_groups or campaign_service.assignment_is_immutable(row) or campaign.legacy_issuance_blocked:
                continue
            pair = (row.evaluator_id, row.evaluatee_id)
            if any((other.evaluator_id, other.evaluatee_id) == pair and other.id != row.id for other in existing_assignments):
                continue
            candidates = [key for key in selected if key[1:] == pair]
            if not candidates and pair not in selected_people:
                for group_id in sorted(group_ids):
                    people = members[group_id]
                    if pair[0] not in people or pair[1] not in people:
                        continue
                    form_id = (self_forms.get(pair[0]) if pair[0] == pair[1] else rules.get(
                        (group_id, people[pair[0]].company_role_id, people[pair[1]].company_role_id)))
                    target = (group_id, *pair)
                    selected[target] = form_id
                    selected_people.add(pair)
                    candidates = [target]
                    break
            if candidates:
                relocated[row.id] = candidates[0]
        existing_rules = {(row.company_group_id, row.evaluator_role_id, row.evaluatee_role_id): row for row in
                          db.query(models.CampaignEvaluationRule).filter(models.CampaignEvaluationRule.campaign_id == campaign_id)}
        for key in issued_role_pair_keys(campaign_id, db):
            if key in existing_rules and rules.get(key) != existing_rules[key].form_id:
                raise HTTPException(status_code=409, detail="Issued form rules cannot be changed or removed")
        for row in existing_assignments:
            if campaign_service.assignment_is_immutable(row) and row.evaluator_id == row.evaluatee_id and self_forms.get(row.evaluator_id) != row.form_id:
                raise HTTPException(status_code=409, detail="Issued self-evaluations cannot be changed")

        for row in existing_assignments:
            if not campaign_service.assignment_is_immutable(row) and not campaign.legacy_issuance_blocked:
                key = relocated.get(row.id, (row.company_group_id, row.evaluator_id, row.evaluatee_id))
                if key not in selected:
                    db.delete(row)
                else:
                    row.company_group_id = key[0]
                    row.form_id = selected[key]
        for key, row in existing_rules.items():
            if key not in rules:
                db.delete(row)
            else:
                row.form_id = rules[key]
        for key, form_id in rules.items():
            if key not in existing_rules:
                db.add(models.CampaignEvaluationRule(campaign_id=campaign_id, company_group_id=key[0],
                                                     evaluator_role_id=key[1], evaluatee_role_id=key[2], form_id=form_id))
        for employee_id, row in existing_self.items():
            if employee_id not in self_forms:
                db.delete(row)
            else:
                row.form_id = self_forms[employee_id]
        for employee_id, form_id in self_forms.items():
            if employee_id not in existing_self:
                db.add(models.CampaignEmployeeSelfEvaluation(campaign_id=campaign_id, employee_id=employee_id, form_id=form_id))
        db.execute(models.campaign_company_groups.delete().where(models.campaign_company_groups.c.campaign_id == campaign_id))
        for group_id in sorted(group_ids):
            db.execute(models.campaign_company_groups.insert().values(campaign_id=campaign_id, company_group_id=group_id))
        retained_pairs = existing_pairs | set(relocated.values())
        status = get_or_create_default_form_status(db) if selected.keys() - retained_pairs else None
        for key, form_id in selected.items():
            if key not in retained_pairs:
                db.add(models.FilledForm(campaign_id=campaign_id, company_group_id=key[0], evaluator_id=key[1],
                                         evaluatee_id=key[2], form_id=form_id, status_id=status.id,
                                         finish_date=None, answers=[], form_snapshot=None, snapshot_status=None))
        db.flush()
        unschedule_if_incomplete(campaign, db, manager.id)
        for other in affected.values():
            campaign_service.validate_scheduled_campaign(other, db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return build_campaign_evaluation_matrix(campaign_id, db)


@app.get("/forms", response_model=list[schemas.FormResponse])
def get_forms(db: Session = Depends(get_db),
              _reader: models.User = Depends(require_permission("forms.read"))):
    used = forms_used_by_campaigns(db)
    return [schemas.FormResponse.model_validate(form).model_copy(update={"used_in_campaigns": form.id in used})
            for form in db.query(models.Form).order_by(models.Form.id.desc()).all()]


@app.post("/forms/ai/generate", response_model=schemas.FormAIGenerateResponse)
def generate_form_draft(request: schemas.FormAIGenerateRequest, db: Session = Depends(get_db),
                        manager: models.User = Depends(require_permission("forms.manage"))):
    workspace_settings_service.require_ai_enabled(db)

    def validation_errors(draft: dict) -> list[str]:
        if not all(section["section_id"] is not None for section in draft["sections"]):
            return []  # Proposed sections have no DB IDs until HR approves them.
        blocks = [{"type": "section", "section_id": section["section_id"], "questions": section["questions"]}
                  for section in draft["sections"]]
        blocks.extend({"type": "question", "question": question} for question in draft["standalone_questions"])
        errors = form_service.form_issuance_errors(blocks, db)
        feedback = []
        for error in errors:
            if "option" in error.lower():
                feedback.append("Choice questions need at least two distinct, labeled options")
            elif "scale" in error.lower() or "maximum" in error.lower():
                feedback.append("Rating scales need integer endpoints 1 and 5 with higher values better")
            elif "section" in error.lower():
                feedback.append("Every section must be nonempty and reference a unique existing Section")
            elif "id" in error.lower():
                feedback.append("Every question needs a unique ID")
            else:
                feedback.append("Every question must meet the form issuance rules")
        return list(dict.fromkeys(feedback))

    return ai_form_generation_service.generate(request, db, validate_draft=validation_errors, actor=manager)


@app.get("/form-templates", response_model=list[schemas.FormTemplateResponse])
def get_form_templates(db: Session = Depends(get_db),
                       _reader: models.User = Depends(require_permission("forms.read"))):
    return db.query(models.FormTemplate).order_by(models.FormTemplate.id.asc()).all()


def clone_template_questions(questions: list[dict]):
    cloned_questions = deepcopy(questions)
    for question in form_service.iter_form_questions(cloned_questions):
        question["id"] = str(uuid4())
    return cloned_questions


def form_section_ids(questions: object) -> set[int]:
    return {block["section_id"] for block in questions if isinstance(block, dict) and block.get("type") == "section"
            and isinstance(block.get("section_id"), int)} if isinstance(questions, list) else set()


def reject_newly_archived_sections(questions: list[dict], previous_questions: object, db: Session) -> None:
    """Archived Sections cannot be added to questionnaires; ones already in a questionnaire may stay."""
    added = form_section_ids(questions) - form_section_ids(previous_questions)
    if not added:
        return
    archived = db.query(models.Section.name).filter(models.Section.id.in_(added), models.Section.is_archived.is_(True)).order_by(models.Section.name).all()
    if archived:
        names = ", ".join(f"“{name}”" for (name,) in archived)
        raise HTTPException(status_code=400, detail=f"Archived sections cannot be added to a questionnaire: {names}. Restore them or choose another section.")


def validate_form_like_payload(payload: schemas.FormCreate, model, db: Session, item_id: int | None = None):
    name = payload.name.strip()
    if name == "":
        raise HTTPException(status_code=400, detail="Name is required")

    existing_query = db.query(model).filter(func.lower(model.name) == name.lower())
    if item_id is not None:
        existing_query = existing_query.filter(model.id != item_id)
    if existing_query.first() is not None:
        raise HTTPException(status_code=400, detail="Name already exists")

    questions = deepcopy(payload.questions)
    form_service.validate_question_definitions(questions, db)
    previous = db.query(model.questions).filter(model.id == item_id).scalar() if item_id is not None else None
    reject_newly_archived_sections(questions, previous, db)

    return {
        "name": name,
        "description": payload.description.strip() if payload.description is not None else None,
        "questions": questions,
    }


@app.post("/forms/import", response_model=schemas.FormImportResponse)
def import_form_from_excel(file: UploadFile = File(...), db: Session = Depends(get_db),
                           actor: models.User = Depends(require_permission("forms.manage"))):
    """Read a filled-in form template into a draft; the editor saves it as a form or a template."""
    return form_import_service.parse_form_workbook(file.file, file.filename, actor, db)


@app.post("/forms", response_model=schemas.FormResponse)
def create_form(form: schemas.FormCreate, db: Session = Depends(get_db),
                _manager: models.User = Depends(require_permission("forms.manage"))):
    values = validate_form_like_payload(form, models.Form, db)
    if form.source_template_id is not None:
        template = db.query(models.FormTemplate).filter(models.FormTemplate.id == form.source_template_id).first()
        if template is None:
            raise HTTPException(status_code=404, detail="Template not found")
        values["questions"] = clone_template_questions(template.questions)
        reject_newly_archived_sections(values["questions"], None, db)
    new_form = models.Form(**values)
    db.add(new_form)
    db.commit()
    db.refresh(new_form)
    return new_form


@app.get("/forms/{form_id}/validation", response_model=schemas.FormValidationResponse)
def get_form_issuance_validation(form_id: int, db: Session = Depends(get_db),
                                 _reader: models.User = Depends(require_permission("forms.read"))):
    form = db.query(models.Form).filter(models.Form.id == form_id).first()
    if form is None:
        raise HTTPException(status_code=404, detail="Form not found")
    errors = form_service.form_issuance_errors(form.questions if isinstance(form.questions, list) else [], db)
    return {"valid_for_issuance": not errors, "errors": errors}


@app.post("/form-templates", response_model=schemas.FormTemplateResponse)
def create_form_template(template: schemas.FormCreate, db: Session = Depends(get_db),
                         _manager: models.User = Depends(require_permission("forms.manage"))):
    new_template = models.FormTemplate(**validate_form_like_payload(template, models.FormTemplate, db))
    db.add(new_template)
    db.commit()
    db.refresh(new_template)
    return new_template


@app.put("/forms/{form_id}", response_model=schemas.FormResponse)
def update_form(form_id: int, form_update: schemas.FormUpdate, db: Session = Depends(get_db),
                  _manager: models.User = Depends(require_permission("forms.manage"))):
    # Editing a shared source Form must not silently issue campaign questionnaires.
    campaigns = campaigns_referencing_form(form_id, db)
    for campaign in campaigns:
        require_mutable_campaign_configuration(campaign)
        if campaign.status == models.CampaignStatus.ACTIVE.value and db.query(models.FilledForm.id).filter(
            models.FilledForm.campaign_id == campaign.id, models.FilledForm.form_id == form_id,
            unissued_snapshot_filter(),
        ).first() is not None:
            raise HTTPException(status_code=409, detail="Issue planned active campaign assignments before editing their source form")
    form = db.query(models.Form).filter(models.Form.id == form_id).first()
    if form is None:
        raise HTTPException(status_code=404, detail="Form not found")
    if form.archived_at is not None:
        raise HTTPException(status_code=409, detail="Restore this form before editing it")
    values = validate_form_like_payload(form_update, models.Form, db, form_id)
    form.name = values["name"]
    form.description = values["description"]
    form.questions = values["questions"]
    db.flush()
    for campaign in campaigns:
        campaign_service.validate_scheduled_campaign(campaign, db)
    db.commit()
    db.refresh(form)
    return schemas.FormResponse.model_validate(form).model_copy(update={"used_in_campaigns": bool(campaigns)})


@app.put("/form-templates/{template_id}", response_model=schemas.FormTemplateResponse)
def update_form_template(template_id: int, template_update: schemas.FormUpdate, db: Session = Depends(get_db),
                         _manager: models.User = Depends(require_permission("forms.manage"))):
    template = db.query(models.FormTemplate).filter(models.FormTemplate.id == template_id).first()
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    values = validate_form_like_payload(template_update, models.FormTemplate, db, template_id)
    template.name = values["name"]
    template.description = values["description"]
    template.questions = values["questions"]
    db.commit()
    db.refresh(template)
    return template


@app.delete("/forms/{form_id}", response_model=schemas.FormDeleteResponse)
def delete_form(form_id: int, db: Session = Depends(get_db),
                  _manager: models.User = Depends(require_permission("forms.manage"))):
    """Unused forms are deleted. Forms that only finished campaigns refer to are archived, so their history stays."""
    form = db.query(models.Form).filter(models.Form.id == form_id).with_for_update().first()
    if form is None:
        raise HTTPException(status_code=404, detail="Form not found")
    campaigns = campaigns_referencing_form(form_id, db)
    running = [campaign for campaign in campaigns
               if not campaign.is_archived and campaign.status != models.CampaignStatus.CLOSED.value]
    if running:
        names = ", ".join(f"“{campaign.name}”" for campaign in running[:3]) + (" and others" if len(running) > 3 else "")
        raise HTTPException(status_code=409, detail=f"This form is used by {names}. Remove it from "
                            f"{'that campaign' if len(running) == 1 else 'those campaigns'} first, or wait until "
                            f"{'it closes' if len(running) == 1 else 'they close'}.")
    if campaigns:
        if form.archived_at is None:
            form.archived_at = datetime.now(timezone.utc)
        db.commit()
        return {"deleted": False, "archived": True}
    db.delete(form)
    db.commit()
    return {"deleted": True, "archived": False}


@app.post("/forms/{form_id}/restore", response_model=schemas.FormResponse)
def restore_form(form_id: int, db: Session = Depends(get_db),
                 _manager: models.User = Depends(require_permission("forms.manage"))):
    form = db.query(models.Form).filter(models.Form.id == form_id).first()
    if form is None:
        raise HTTPException(status_code=404, detail="Form not found")
    form.archived_at = None
    db.commit()
    db.refresh(form)
    return schemas.FormResponse.model_validate(form).model_copy(
        update={"used_in_campaigns": form.id in forms_used_by_campaigns(db)})


@app.delete("/form-templates/{template_id}")
def delete_form_template(template_id: int, db: Session = Depends(get_db),
                         _manager: models.User = Depends(require_permission("forms.manage"))):
    template = db.query(models.FormTemplate).filter(models.FormTemplate.id == template_id).first()
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    db.delete(template)
    db.commit()
    return {"deleted": True}


app.include_router(auth_router.router)
app.include_router(me_router.router)
app.include_router(workspace_router.router)


app.include_router(people_router.router)

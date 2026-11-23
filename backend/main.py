from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
import os
from typing import Literal

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from api.dependencies import get_current_employee, get_db, reject_conflicting_requester, require_permission
from services.business_calendar import business_today as campaign_today, business_date, campaign_instant
from services import campaign_lifecycle
import models
from services import form_snapshot_service
from services import reporting_service
from services import answers_service
from services import report_dashboard_service
from services import question_analytics_service
from services import evaluation_quality_service
from services import ai_workflow_service
from services import ai_aggregate_workflow_service
from services import ai_generation_jobs
from services.ai_analysis_models import EmployeeAIAnalysis
from services.ai_generation_service import AnalysisGenerationError
import schemas
from api import auth as auth_router
from api import me as me_router
from api import workspace as workspace_router
from api import people as people_router
from services import campaign_service
from api import forms as forms_router
from api import sections as sections_router
from api import campaign_emails as campaign_emails_router
from api import campaigns as campaigns_router
from api import campaign_setup as campaign_setup_router

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
            "participant_count": campaign_service.get_campaign_participant_count(campaign.id, db),
            "form_count": len(campaign_service.get_campaign_form_ids(campaign.id, db)),
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
            "lifecycle_status": campaign_service.campaign_lifecycle_status(campaign, today),
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
    form_ids = campaign_service.get_campaign_form_ids(selected_campaign.id, db)
    overdue_form_ids = {assignment.form_id for assignment in overdue_assignments}
    next_campaign = next((campaign for campaign in upcoming_campaigns if campaign.id != selected_campaign.id), None)

    status_names = dict(db.query(models.FormStatus.id, models.FormStatus.name).all())
    in_progress_count = sum(assignment.finish_date is None and not (assignment.form_snapshot is None and not assignment.answers)
                            and (bool(assignment.answers) or campaign_service.normalize_form_status(status_names.get(assignment.status_id), None)[0] == "in_progress")
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
        "participants": campaign_service.get_campaign_participants(selected_campaign.id, db),
        "upcoming_reviews": upcoming_reviews,
        "upcoming_deadlines": upcoming_deadlines,
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


app.include_router(auth_router.router)
app.include_router(me_router.router)
app.include_router(workspace_router.router)


app.include_router(people_router.router)


app.include_router(forms_router.router)
app.include_router(sections_router.router)


app.include_router(campaign_emails_router.router)
app.include_router(campaigns_router.router)


app.include_router(campaign_setup_router.router)

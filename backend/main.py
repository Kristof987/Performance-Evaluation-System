from contextlib import asynccontextmanager
import os
from typing import Literal

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from api.dependencies import get_db, reject_conflicting_requester, require_permission
import models
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
from api import forms as forms_router
from api import sections as sections_router
from api import campaign_emails as campaign_emails_router
from api import campaigns as campaigns_router
from api import campaign_setup as campaign_setup_router
from api import dashboard as dashboard_router
from api import evaluations as evaluations_router

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


app.include_router(dashboard_router.router)
app.include_router(evaluations_router.router)

"""AI summaries in reports: employee, group and campaign analyses, their generation jobs, edits and approval."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from api.dependencies import get_db, require_permission
from services import (
    ai_aggregate_workflow_service,
    ai_generation_jobs,
    ai_workflow_service,
    reporting_service,
)
from services.ai_analysis_models import EmployeeAIAnalysis
from services.ai_generation_service import AnalysisGenerationError

router = APIRouter()


@router.get("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis")
def get_employee_ai_analyses(
    campaign_id: int, employee_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return ai_workflow_service.list_analyses(db, campaign_id, employee_id, actor=actor)


@router.post("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/generate", status_code=202)
def generate_employee_ai_report(
    campaign_id: int, employee_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("ai_analysis.generate")),
):
    return ai_generation_jobs.start(db, campaign_id, "employee", employee_id, actor=actor)


@router.get("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/generation-job")
def employee_ai_generation_job(
    campaign_id: int, employee_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return ai_generation_jobs.status(db, campaign_id, "employee", employee_id, actor=actor)


@router.get("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/generation-job/{job_id}")
def employee_ai_generation_job_status(
    campaign_id: int, employee_id: int, job_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return ai_generation_jobs.status(db, campaign_id, "employee", employee_id, actor=actor, job_id=job_id)


@router.put("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/{analysis_id}")
def edit_employee_ai_report(
    campaign_id: int, employee_id: int, analysis_id: int, payload: EmployeeAIAnalysis,
    db: Session = Depends(get_db), actor: models.User = Depends(require_permission("ai_analysis.generate")),
):
    try:
        return ai_workflow_service.edit(db, campaign_id, employee_id, analysis_id, payload, actor=actor)
    except AnalysisGenerationError:
        raise HTTPException(status_code=422, detail="Edited analysis contains unsupported evidence or numerical claims") from None


@router.post("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/{analysis_id}/approve")
def approve_employee_ai_report(
    campaign_id: int, employee_id: int, analysis_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("ai_analysis.approve")),
):
    return ai_workflow_service.approve(db, campaign_id, employee_id, analysis_id, actor=actor)


def _register_aggregate_ai_routes(scope_type: str, route: str) -> None:
    """Keep both aggregate scopes on the same authorized HR workflow."""
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

    router.add_api_route(route, history, methods=["GET"], name=f"get_{scope_type}_ai_analysis")
    router.add_api_route(f"{route}/generate", generate, methods=["POST"], status_code=202,
                      name=f"generate_{scope_type}_ai_analysis")
    router.add_api_route(f"{route}/generation-job", latest_job, methods=["GET"], name=f"latest_{scope_type}_ai_generation_job")
    router.add_api_route(f"{route}/generation-job/{{job_id}}", job_status, methods=["GET"],
                      name=f"get_{scope_type}_ai_generation_job")
    router.add_api_route(f"{route}/{{analysis_id}}", edit, methods=["PUT"], name=f"edit_{scope_type}_ai_analysis")
    router.add_api_route(f"{route}/{{analysis_id}}/approve", approve, methods=["POST"], name=f"approve_{scope_type}_ai_analysis")


_register_aggregate_ai_routes("campaign", "/reports/campaigns/{campaign_id}/ai-analysis")
_register_aggregate_ai_routes("group", "/reports/campaigns/{campaign_id}/groups/{scope_id}/ai-analysis")

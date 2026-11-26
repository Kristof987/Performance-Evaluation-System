"""Campaign reports: overview, sections, questions, groups, roles, employees and answers."""

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

import models
import schemas
from api.dependencies import get_db, require_permission
from services import (
    answers_service,
    question_analytics_service,
    report_dashboard_service,
    reporting_service,
)

router = APIRouter()


@router.get("/reports/campaigns", response_model=list[schemas.ReportCampaignOption])
def get_report_campaigns(db: Session = Depends(get_db),
                         actor: models.User = Depends(require_permission("reports.read", "reports.read_team"))):
    return reporting_service.list_report_campaigns(actor, db)


@router.get("/reports/campaigns/{campaign_id}/dashboard", response_model=schemas.CampaignDashboardResponse)
def get_campaign_report_dashboard(
    campaign_id: int,
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    return report_dashboard_service.build_campaign_dashboard(campaign_id, actor, db)


@router.get("/reports/campaigns/{campaign_id}/sections/{section_id}/questions", response_model=schemas.SectionQuestionsResponse)
def get_campaign_section_questions(
    campaign_id: int,
    section_id: int,
    group_ids: str = Query(default="", pattern=r"^(\d+(,\d+)*)?$"),
    role_ids: str = Query(default="", pattern=r"^(\d+(,\d+)*)?$"),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    selected = list(dict.fromkeys(int(value) for value in group_ids.split(",") if value))
    roles = list(dict.fromkeys(int(value) for value in role_ids.split(",") if value))
    return report_dashboard_service.build_section_questions(campaign_id, section_id, selected, actor, db, role_ids=roles)


@router.get("/reports/campaigns/{campaign_id}/rating-distribution", response_model=schemas.ReportRatingDistributionResponse)
def get_campaign_rating_distribution(
    campaign_id: int,
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    # Campaign-wide counts; for a group leader they are the company reference next to their groups.
    reporting_service.require_team_campaign(campaign_id, actor, db)
    return question_analytics_service.build_rating_distribution_report(campaign_id, actor, db)


@router.get("/reports/campaigns/{campaign_id}/questions", response_model=schemas.ReportQuestionsResponse)
def get_campaign_report_questions(
    campaign_id: int,
    employee_id: int = Query(gt=0),
    evaluation_type: Literal["peer", "self"] = Query(default="peer"),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    # Team leads may explore the questions of an employee in a group they lead only.
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return question_analytics_service.build_question_report(
        campaign_id, actor, db, employee_id=employee_id, evaluation_type=evaluation_type,
    )


@router.get("/reports/campaigns/{campaign_id}/written-feedback", response_model=schemas.ReportWrittenFeedbackResponse | schemas.ReportWrittenFeedbackIndexResponse)
def get_campaign_written_feedback(
    campaign_id: int,
    question_key: str | None = Query(default=None, pattern=r"^[0-9a-f]{64}$"),
    evaluation_type: Literal["peer", "self"] = Query(default="peer"),
    section_id: int | None = Query(default=None, gt=0),
    employee_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    # HR sees every employee; a group leader the members of the groups they lead (see build_written_feedback).
    reporting_service.enter_report_scope(actor, db)
    return reporting_service.build_written_feedback(
        campaign_id, question_key, evaluation_type, actor, db,
        employee_id=employee_id, section_id=section_id,
    )


@router.get("/reports/campaigns/{campaign_id}/answers", response_model=schemas.AnswersIndexResponse)
def get_campaign_answers_index(
    campaign_id: int,
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    return answers_service.build_answers_index(campaign_id, actor, db)


@router.get("/reports/campaigns/{campaign_id}/answers/{employee_id}", response_model=schemas.EmployeeAnswersResponse)
def get_employee_answers(
    campaign_id: int,
    employee_id: int,
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    return answers_service.build_employee_answers(campaign_id, employee_id, actor, db)


@router.get("/reports/campaigns/{campaign_id}/groups/{group_id}")
def get_campaign_report_group_detail(
    campaign_id: int,
    group_id: int,
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reporting_service.require_team_group(campaign_id, group_id, actor, db)
    return reporting_service.build_group_detail(campaign_id, group_id, actor, db)


@router.get("/reports/campaigns/{campaign_id}/employees")
def get_campaign_report_employees(
    campaign_id: int,
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reporting_service.enter_report_scope(actor, db)
    return reporting_service.build_employee_reports_overview(campaign_id, actor, db)


@router.get("/reports/campaigns/{campaign_id}/employees/{employee_id}")
def get_campaign_report_employee_detail(
    campaign_id: int,
    employee_id: int,
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return reporting_service.build_employee_report_detail(campaign_id, employee_id, actor, db)

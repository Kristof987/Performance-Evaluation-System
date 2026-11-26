"""Figures for the HR home page."""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import case
from sqlalchemy.orm import Session

import models
from services import campaign_lifecycle, campaign_service
from business_calendar import business_date
from business_calendar import business_today as campaign_today


def get_dashboard(*, campaign_id: int | None = None, db: Session):
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

    in_progress_count = sum(assignment.finish_date is None and bool(assignment.answers) for assignment in assignments)
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

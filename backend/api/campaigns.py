"""Campaigns: list, details, create, edit, delete, archive, lifecycle actions and completion status."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

import models
import schemas
from api.dependencies import get_db, require_permission
from services import campaign_service

router = APIRouter()


@router.get("/campaigns/{campaign_id}/completion-status", response_model=schemas.CompletionStatusResponse)
def get_campaign_completion_status(
    campaign_id: int,
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
    return campaign_service.get_campaign_completion_status(campaign_id=campaign_id, search=search, status=status, overdue_only=overdue_only, sort=sort, order=order, page=page, page_size=page_size, db=db)


@router.get("/campaigns", response_model=list[schemas.CampaignResponse])
def get_campaigns(db: Session = Depends(get_db),
                   _reader: models.User = Depends(require_permission("campaigns.read"))):
    return campaign_service.get_campaigns(db=db)


@router.get("/campaigns/{campaign_id}", response_model=schemas.CampaignResponse)
def get_campaign(campaign_id: int, db: Session = Depends(get_db),
                 _reader: models.User = Depends(require_permission("campaigns.read"))):
    return campaign_service.get_campaign(campaign_id=campaign_id, db=db)


@router.get("/campaigns/{campaign_id}/operational-metrics", response_model=schemas.CampaignOperationalMetrics)
def get_campaign_operational_metrics(campaign_id: int, db: Session = Depends(get_db),
                                     _reader: models.User = Depends(require_permission("campaigns.read"))):
    return campaign_service.get_campaign_operational_metrics(campaign_id=campaign_id, db=db)


@router.get("/campaigns/{campaign_id}/deletion-eligibility", response_model=schemas.CampaignDeletionEligibility)
def get_campaign_deletion_eligibility(campaign_id: int, db: Session = Depends(get_db),
                                      _reader: models.User = Depends(require_permission("campaigns.read"))):
    return campaign_service.get_campaign_deletion_eligibility(campaign_id=campaign_id, db=db)


@router.post("/campaigns/{campaign_id}/archive", response_model=schemas.CampaignResponse)
def archive_campaign(campaign_id: int, db: Session = Depends(get_db),
                     actor: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_service.change_campaign_archive(campaign_id, True, db, actor)


@router.post("/campaigns/{campaign_id}/unarchive", response_model=schemas.CampaignResponse)
def unarchive_campaign(campaign_id: int, db: Session = Depends(get_db),
                       actor: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_service.change_campaign_archive(campaign_id, False, db, actor)


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: int, db: Session = Depends(get_db),
                     manager: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_service.delete_campaign(campaign_id=campaign_id, db=db, manager=manager)


@router.post("/campaigns/{campaign_id}/pause", response_model=schemas.CampaignResponse)
def pause_campaign(campaign_id: int, db: Session = Depends(get_db),
                   actor: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_service.change_campaign_schedule(campaign_id, models.CampaignStatus.PAUSED, db, actor)


@router.post("/campaigns/{campaign_id}/resume", response_model=schemas.CampaignResponse)
def resume_campaign(campaign_id: int, db: Session = Depends(get_db),
                    actor: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_service.resume_campaign(campaign_id=campaign_id, db=db, actor=actor)


@router.post("/campaigns/{campaign_id}/review", response_model=schemas.CampaignResponse)
def review_campaign(campaign_id: int, db: Session = Depends(get_db),
                    actor: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_service.change_campaign_schedule(campaign_id, models.CampaignStatus.REVIEW, db, actor)


@router.post("/campaigns/{campaign_id}/close", response_model=schemas.CampaignResponse)
def close_campaign(campaign_id: int, db: Session = Depends(get_db),
                   actor: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_service.change_campaign_schedule(campaign_id, models.CampaignStatus.CLOSED, db, actor)


@router.post("/campaigns/{campaign_id}/schedule", response_model=schemas.CampaignResponse)
def schedule_campaign(campaign_id: int, db: Session = Depends(get_db),
                      actor: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_service.change_campaign_schedule(campaign_id, models.CampaignStatus.SCHEDULED, db, actor)


@router.post("/campaigns/{campaign_id}/unschedule", response_model=schemas.CampaignResponse)
def unschedule_campaign(campaign_id: int, db: Session = Depends(get_db),
                        actor: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_service.change_campaign_schedule(campaign_id, models.CampaignStatus.DRAFT, db, actor)


@router.post("/campaigns", response_model=schemas.CampaignResponse)
def create_campaign(campaign: schemas.CampaignCreate, db: Session = Depends(get_db),
                    actor: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_service.create_campaign(campaign=campaign, db=db, actor=actor)


@router.put("/campaigns/{campaign_id}", response_model=schemas.CampaignResponse)
def update_campaign(campaign_id: int, campaign_update: schemas.CampaignUpdate, db: Session = Depends(get_db),
                     manager: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_service.update_campaign(campaign_id=campaign_id, campaign_update=campaign_update, db=db, actor=manager)

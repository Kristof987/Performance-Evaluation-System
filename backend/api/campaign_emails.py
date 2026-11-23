"""Campaign e-mails: launch e-mail, reminder schedule, recipients and sending reminders now."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
import schemas
from api.dependencies import get_db, require_permission
from services import campaign_reminder_service

router = APIRouter()


@router.get("/campaigns/{campaign_id}/emails", response_model=schemas.CampaignEmailOverview)
def get_campaign_emails(campaign_id: int, db: Session = Depends(get_db),
                        _reader: models.User = Depends(require_permission("campaigns.read"))):
    return campaign_reminder_service.email_overview(campaign_reminder_service.campaign_for_emails(campaign_id, db), db)


@router.post("/campaigns/{campaign_id}/emails/reminders", response_model=schemas.CampaignEmailOverview)
def add_campaign_reminder(campaign_id: int, payload: schemas.CampaignReminderCreate, db: Session = Depends(get_db),
                          actor: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_reminder_service.add_campaign_reminder(campaign_id=campaign_id, payload=payload, db=db, actor=actor)


@router.delete("/campaigns/{campaign_id}/emails/reminders/{days_before_end}", response_model=schemas.CampaignEmailOverview)
def delete_campaign_reminder(campaign_id: int, days_before_end: int, db: Session = Depends(get_db),
                             actor: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_reminder_service.delete_campaign_reminder(campaign_id=campaign_id, days_before_end=days_before_end, db=db, actor=actor)


@router.post("/campaigns/{campaign_id}/emails/reminders/reset", response_model=schemas.CampaignEmailOverview)
def reset_campaign_reminders(campaign_id: int, db: Session = Depends(get_db),
                             actor: models.User = Depends(require_permission("campaigns.manage"))):
    """Drop the campaign's own reminders and follow the workspace defaults again."""
    return campaign_reminder_service.reset_campaign_reminders(campaign_id=campaign_id, db=db, actor=actor)


@router.get("/campaigns/{campaign_id}/emails/recipients", response_model=list[schemas.CampaignReminderRecipient])
def get_campaign_reminder_recipients(campaign_id: int, db: Session = Depends(get_db),
                                     _manager: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_reminder_service.recipient_list(campaign_reminder_service.campaign_for_emails(campaign_id, db), db)


@router.put("/campaigns/{campaign_id}/emails/launch", response_model=schemas.CampaignEmailOverview)
def update_campaign_launch_email(campaign_id: int, payload: schemas.CampaignLaunchEmailUpdate, db: Session = Depends(get_db),
                                 actor: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_reminder_service.update_campaign_launch_email(campaign_id=campaign_id, payload=payload, db=db, actor=actor)


@router.post("/campaigns/{campaign_id}/emails/send", response_model=schemas.CampaignManualReminderResult)
def send_campaign_reminder_now(campaign_id: int, payload: schemas.CampaignManualReminder, db: Session = Depends(get_db),
                               actor: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = campaign_reminder_service.campaign_for_emails(campaign_id, db)
    return campaign_reminder_service.send_manual(campaign, actor, payload.employee_ids, db)

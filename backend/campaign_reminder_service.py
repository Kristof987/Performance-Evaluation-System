"""Campaign emails: a launch email when evaluations open, HR-scheduled reminders before the end, manual reminders."""

import logging
import math
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

import email_service
import models
import reporting_service
from database import SessionLocal


logger = logging.getLogger(__name__)
MANUAL_COOLDOWN = timedelta(hours=24)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def open_evaluation_counts(campaign_id: int, db: Session) -> dict[int, int]:
    """Issued, not yet completed evaluations per evaluator."""
    rows = (db.query(models.FilledForm.evaluator_id, models.FormStatus.name, models.FilledForm.finish_date)
            .join(models.FormStatus, models.FormStatus.id == models.FilledForm.status_id)
            .filter(models.FilledForm.campaign_id == campaign_id, models.FilledForm.form_snapshot.isnot(None)).all())
    counts: dict[int, int] = {}
    for evaluator_id, status_name, finish_date in rows:
        if reporting_service.status_key(status_name, finish_date) != "completed":
            counts[evaluator_id] = counts.get(evaluator_id, 0) + 1
    return counts


def _recipients(campaign_id: int, db: Session, employee_ids: set[int] | None = None):
    counts = open_evaluation_counts(campaign_id, db)
    if employee_ids is not None:
        counts = {employee_id: count for employee_id, count in counts.items() if employee_id in employee_ids}
    if not counts:
        return []
    people = (db.query(models.Employee, models.User).join(models.User, models.User.id == models.Employee.user_id)
              .filter(models.Employee.id.in_(counts), models.Employee.is_active.is_(True), models.User.is_active.is_(True))
              .order_by(models.Employee.id).all())
    return [(employee, user, counts[employee.id]) for employee, user in people if user.email]


def _deadline_text(end_date: datetime | None) -> str:
    if end_date is None:
        return "no deadline set"
    local = _aware(end_date).astimezone(ZoneInfo(os.getenv("APP_TIMEZONE", "Europe/Budapest")))
    return f"{local.day} {local.strftime('%B %Y, %H:%M')}"


def _time_left(end_date: datetime | None, now: datetime) -> str:
    if end_date is None:
        return "no deadline"
    days = math.ceil((_aware(end_date) - now).total_seconds() / 86400)
    if days <= 1:
        return "ends within a day" if days == 1 else "ends today"
    return f"{days} days left"


def _values(campaign: models.Campaign, employee: models.Employee, count: int, now: datetime) -> dict[str, object]:
    return {
        "first_name": (employee.full_name or "").split(" ")[0] or "there",
        "campaign_name": campaign.name,
        "open_count": count,
        "evaluation_word": "evaluation" if count == 1 else "evaluations",
        "deadline": _deadline_text(campaign.end_date),
        "time_left": _time_left(campaign.end_date, now),
        "link": email_service.app_link("/evaluations"),
        "sender_name": email_service.sender_name(),
    }


def _deliver(db: Session, campaign: models.Campaign, employee: models.Employee, user: models.User, count: int, *,
             kind: str, dedupe_key: str, reminder_id: int | None = None, actor: models.User | None = None) -> str:
    """Claim the dedupe key first, so a crash or a second worker never sends the same email twice."""
    claimed = db.execute(insert(models.EmailDelivery).values(
        campaign_id=campaign.id, employee_id=employee.id, kind=kind, reminder_id=reminder_id, dedupe_key=dedupe_key,
        recipient=user.email, status="pending", created_by=actor.id if actor else None,
    ).on_conflict_do_nothing(index_elements=["dedupe_key"]).returning(models.EmailDelivery.id)).scalar()
    db.commit()
    if claimed is None:
        return "skipped"
    delivery = db.get(models.EmailDelivery, claimed)
    template = "campaign_launch" if kind == "launch" else "campaign_reminder"
    try:
        email_service.send(user.email, *email_service.render(template, _values(campaign, employee, count, _now())))
        delivery.status, delivery.sent_at = "sent", _now()
    except Exception as error:
        logger.warning("Campaign email %s failed (%s)", claimed, type(error).__name__)
        delivery.status, delivery.error = "failed", type(error).__name__[:200]
    db.commit()
    return delivery.status


def due_reminder(campaign: models.Campaign, now: datetime, db: Session) -> models.CampaignReminder | None:
    """The latest reminder that is due; earlier ones it supersedes are never sent late in a burst."""
    if campaign.end_date is None or now >= _aware(campaign.end_date):
        return None
    end, start = _aware(campaign.end_date), _aware(campaign.start_date)
    due = [reminder for reminder in campaign_reminders(campaign.id, db)
           if end - timedelta(days=reminder.days_before_end) <= now
           # A reminder falling before the start would just repeat the launch email.
           and end - timedelta(days=reminder.days_before_end) > start]
    return min(due, key=lambda reminder: reminder.days_before_end, default=None)


def campaign_reminders(campaign_id: int, db: Session) -> list[models.CampaignReminder]:
    return (db.query(models.CampaignReminder).filter(models.CampaignReminder.campaign_id == campaign_id)
            .order_by(models.CampaignReminder.days_before_end.desc()).all())


def send_due_emails(db: Session, now: datetime | None = None) -> int:
    now = now or _now()
    sent = 0
    campaigns = (db.query(models.Campaign).filter(models.Campaign.status == models.CampaignStatus.ACTIVE.value,
                                                  models.Campaign.is_archived.is_(False)).order_by(models.Campaign.id).all())
    for campaign in campaigns:
        reminder = due_reminder(campaign, now, db)
        for employee, user, count in _recipients(campaign.id, db):
            if campaign.launch_email_enabled:
                sent += _deliver(db, campaign, employee, user, count, kind="launch",
                                 dedupe_key=f"launch:{campaign.id}:{employee.id}") == "sent"
            if reminder is not None:
                sent += _deliver(db, campaign, employee, user, count, kind="reminder", reminder_id=reminder.id,
                                 dedupe_key=f"reminder:{reminder.id}:{employee.id}") == "sent"
    return sent


def run_due() -> None:
    """Worker entry point; without SMTP nothing is claimed, so enabling email later still sends what is due."""
    if not email_service.configured():
        return
    with SessionLocal() as db:
        send_due_emails(db)


def send_manual(campaign: models.Campaign, actor: models.User, employee_ids: list[int] | None, db: Session) -> dict:
    if campaign.status != models.CampaignStatus.ACTIVE.value or campaign.is_archived:
        raise HTTPException(status_code=409, detail="Reminders can only be sent while the campaign is active")
    if not email_service.configured():
        raise HTTPException(status_code=503, detail="Email sending is not configured on the server")
    since = _now() - MANUAL_COOLDOWN
    recent = {employee_id for (employee_id,) in db.query(models.EmailDelivery.employee_id).filter(
        models.EmailDelivery.campaign_id == campaign.id, models.EmailDelivery.kind == "manual",
        models.EmailDelivery.status == "sent", models.EmailDelivery.sent_at >= since).all()}
    result = {"sent": 0, "failed": 0, "skipped_recently_reminded": 0}
    for employee, user, count in _recipients(campaign.id, db, set(employee_ids) if employee_ids is not None else None):
        if employee.id in recent:
            result["skipped_recently_reminded"] += 1
            continue
        status = _deliver(db, campaign, employee, user, count, kind="manual", actor=actor,
                          dedupe_key=f"manual:{campaign.id}:{employee.id}:{uuid4().hex}")
        result["sent" if status == "sent" else "failed"] += 1
    import workspace_settings_service

    workspace_settings_service.record_audit(db, "notifications", actor, f"Reminder emails sent for {campaign.name}",
                                            {"campaign_id": campaign.id, **result})
    db.commit()
    return result


def email_overview(campaign: models.Campaign, db: Session) -> dict:
    now = _now()
    deliveries = db.query(models.EmailDelivery).filter(models.EmailDelivery.campaign_id == campaign.id).all()
    by_reminder: dict[int, list[models.EmailDelivery]] = {}
    for delivery in deliveries:
        if delivery.reminder_id is not None:
            by_reminder.setdefault(delivery.reminder_id, []).append(delivery)
    end = _aware(campaign.end_date) if campaign.end_date else None
    reminders = []
    for reminder in campaign_reminders(campaign.id, db):
        sent = [item for item in by_reminder.get(reminder.id, []) if item.status == "sent"]
        reminders.append({
            "id": reminder.id,
            "days_before_end": reminder.days_before_end,
            "scheduled_for": end - timedelta(days=reminder.days_before_end) if end else None,
            "sent_count": len(sent),
            "last_sent_at": max((item.sent_at for item in sent), default=None),
        })
    launch = [item for item in deliveries if item.kind == "launch"]
    manual = [item for item in deliveries if item.kind == "manual" and item.status == "sent"]
    return {
        "email_configured": email_service.configured(),
        "launch_email_enabled": campaign.launch_email_enabled,
        "launch_sent_count": sum(item.status == "sent" for item in launch),
        "failed_count": sum(item.status == "failed" for item in deliveries),
        "manual_last_sent_at": max((item.sent_at for item in manual), default=None),
        "open_recipients": len(_recipients(campaign.id, db)),
        "reminders": reminders,
        "now": now,
    }

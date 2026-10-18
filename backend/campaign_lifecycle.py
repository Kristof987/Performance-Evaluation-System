"""Campaign lifecycle domain logic for authenticated campaign transitions.

Callers must supply a non-committing configuration validator and issuance function
when activating a campaign. Keep the session open and commit only after this
function succeeds. Row locking serializes competing transitions for one campaign.
"""

from collections.abc import Callable, Sequence
from datetime import datetime, timezone

from sqlalchemy import or_
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from models import Campaign, CampaignLifecycleHistory, CampaignStatus, FilledForm


class CampaignLifecycleError(ValueError):
    pass


ALLOWED_TRANSITIONS = {
    CampaignStatus.DRAFT: {CampaignStatus.SCHEDULED},
    CampaignStatus.SCHEDULED: {CampaignStatus.DRAFT, CampaignStatus.ACTIVE},
    CampaignStatus.ACTIVE: {CampaignStatus.PAUSED, CampaignStatus.REVIEW},
    CampaignStatus.PAUSED: {CampaignStatus.ACTIVE, CampaignStatus.REVIEW},
    CampaignStatus.REVIEW: {CampaignStatus.PAUSED, CampaignStatus.CLOSED},
    CampaignStatus.CLOSED: set(),
}


def _instant(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise CampaignLifecycleError("Campaign dates must be timezone-aware timestamps")
    return value.astimezone(timezone.utc)


def validate_dates(start: datetime, end: datetime | None) -> None:
    start = _instant(start)
    if end is not None and _instant(end) <= start:
        raise CampaignLifecycleError("Campaign end must be later than its start")


def validate_date_edit(
    campaign: Campaign, start: datetime, end: datetime | None, *, now: datetime,
    validate_configuration: Callable[[Campaign, datetime, datetime | None], Sequence[str]] | None = None,
) -> None:
    """Validate edits to draft or scheduled campaign dates."""
    status = CampaignStatus(campaign.status)
    if status not in {CampaignStatus.DRAFT, CampaignStatus.SCHEDULED}:
        raise CampaignLifecycleError(f"Dates cannot be changed in {status.value}")
    validate_dates(start, end)
    if status == CampaignStatus.SCHEDULED and _instant(start) <= _instant(now):
        raise CampaignLifecycleError("Scheduled campaigns must start in the future")
    if status == CampaignStatus.SCHEDULED:
        if end is None:
            raise CampaignLifecycleError("Scheduled campaigns require an end timestamp")
        if validate_configuration is None:
            raise CampaignLifecycleError("A complete configuration validator is required")
        errors = validate_configuration(campaign, start, end)
        if errors:
            raise CampaignLifecycleError("Invalid campaign configuration: " + "; ".join(errors))


def reporting_allowed(campaign: Campaign) -> bool:
    """Additional future reports.read gate; privacy suppression still applies."""
    return CampaignStatus(campaign.status) in {CampaignStatus.REVIEW, CampaignStatus.CLOSED}


def is_overdue(form: FilledForm, campaign: Campaign, *, now: datetime) -> bool:
    return (
        form.finish_date is None
        and campaign.end_date is not None
        and _instant(now) > _instant(campaign.end_date)
        and CampaignStatus(campaign.status) in {
            CampaignStatus.ACTIVE, CampaignStatus.PAUSED, CampaignStatus.REVIEW, CampaignStatus.CLOSED,
        }
    )


def transition_campaign(
    db: Session,
    campaign_id: int,
    target: CampaignStatus,
    *,
    now: datetime,
    actor_user_id: int | None = None,
    automatic: bool = False,
    validate_configuration: Callable[[Campaign, Session], Sequence[str]] | None = None,
    issue_snapshots: Callable[[Campaign, Session], Sequence[str]] | None = None,
) -> Campaign:
    """Lock and flush a transition/history atomically; never commits the caller's transaction.

    Validators return blocking errors. Issuance must be idempotent, must not commit,
    and must update only as-yet-unissued assignments. An issuance failure rolls back
    the nested transaction, including snapshots written during the attempt.
    """
    now = _instant(now)
    target = CampaignStatus(target)
    if not automatic and actor_user_id is None:
        raise CampaignLifecycleError("Manual transitions require an acting user")
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).populate_existing().with_for_update().one_or_none()
    if campaign is None:
        raise CampaignLifecycleError("Campaign not found")
    current = CampaignStatus(campaign.status)
    if target not in ALLOWED_TRANSITIONS[current]:
        raise CampaignLifecycleError(f"Invalid transition: {current.value} -> {target.value}")
    if campaign.is_archived and automatic:
        raise CampaignLifecycleError("Archived campaigns cannot transition automatically")
    if automatic and (current, target) not in {
        (CampaignStatus.SCHEDULED, CampaignStatus.ACTIVE),
        (CampaignStatus.ACTIVE, CampaignStatus.REVIEW),
    }:
        raise CampaignLifecycleError("This transition requires a manual action")

    if (current, target) in {
        (CampaignStatus.DRAFT, CampaignStatus.SCHEDULED),
        (CampaignStatus.SCHEDULED, CampaignStatus.ACTIVE),
    }:
        validate_dates(campaign.start_date, campaign.end_date)
        if campaign.end_date is None:
            raise CampaignLifecycleError("Scheduling and activation require an end timestamp")
        if validate_configuration is None:
            raise CampaignLifecycleError("A complete configuration validator is required")
        errors = validate_configuration(campaign, db)
        if errors:
            raise CampaignLifecycleError("Invalid campaign configuration: " + "; ".join(errors))
    if current == CampaignStatus.DRAFT and target == CampaignStatus.SCHEDULED and _instant(campaign.start_date) <= now:
        raise CampaignLifecycleError("Campaign start must be in the future")
    if current == CampaignStatus.SCHEDULED and target == CampaignStatus.ACTIVE and now < _instant(campaign.start_date):
        raise CampaignLifecycleError("Campaign has not started")
    if current == CampaignStatus.SCHEDULED and target == CampaignStatus.ACTIVE and (
        campaign.end_date is not None and now >= _instant(campaign.end_date)
    ):
        raise CampaignLifecycleError("Campaign deadline has passed before activation")
    if automatic and current == CampaignStatus.ACTIVE and target == CampaignStatus.REVIEW and (
        campaign.end_date is None or now < _instant(campaign.end_date)
    ):
        raise CampaignLifecycleError("Automatic review requires a passed deadline")
    if current == CampaignStatus.PAUSED:
        expected = CampaignStatus.REVIEW if campaign.paused_from_status == CampaignStatus.REVIEW.value or (
            campaign.end_date is not None and now >= _instant(campaign.end_date)
        ) else CampaignStatus.ACTIVE
        if target != expected:
            raise CampaignLifecycleError(f"Paused campaign must resume in {expected.value}")

    with db.begin_nested():
        if current == CampaignStatus.SCHEDULED and target == CampaignStatus.ACTIVE:
            if issue_snapshots is None:
                raise CampaignLifecycleError("Snapshot issuer is required to activate a campaign")
            errors = issue_snapshots(campaign, db)
            if errors:
                raise CampaignLifecycleError("Snapshot issuance failed: " + "; ".join(errors))
            db.flush()
            # Submitted legacy records without a snapshot are historical; do not
            # overwrite them or block activation on an irrecoverable old form.
            pending = db.query(FilledForm.id).filter(
                FilledForm.campaign_id == campaign.id,
                FilledForm.finish_date.is_(None),
                or_(FilledForm.form_snapshot.is_(None), FilledForm.form_snapshot == JSONB.NULL),
                FilledForm.answers == [],
            ).first()
            if pending is not None:
                raise CampaignLifecycleError("Not all assignments received a snapshot")
        campaign.paused_from_status = current.value if target == CampaignStatus.PAUSED else None
        campaign.status = target.value
        if (current, target) == (CampaignStatus.DRAFT, CampaignStatus.SCHEDULED):
            campaign.is_active = False
        elif (current, target) == (CampaignStatus.SCHEDULED, CampaignStatus.ACTIVE):
            campaign.is_active = True
        elif (current, target) == (CampaignStatus.SCHEDULED, CampaignStatus.DRAFT):
            campaign.is_active = False
        db.add(CampaignLifecycleHistory(
            campaign_id=campaign.id, previous_status=current.value, new_status=target.value,
            transitioned_at=now, actor_user_id=actor_user_id, is_automatic=automatic,
        ))
        db.flush()
    return campaign


def set_campaign_archived(db: Session, campaign_id: int, archived: bool) -> Campaign:
    """Archiving is orthogonal to lifecycle; callers own the transaction."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).populate_existing().with_for_update().one_or_none()
    if campaign is None:
        raise CampaignLifecycleError("Campaign not found")
    campaign.is_archived = archived
    db.flush()
    return campaign

"""Campaign lifecycle domain logic for authenticated campaign transitions.

Callers must supply a non-committing configuration validator and issuance function
when activating a campaign. Keep the session open and commit only after this
function succeeds. Row locking serializes competing transitions for one campaign.
"""

from collections.abc import Callable, Sequence
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models import (
    Campaign,
    CampaignArchiveEvent,
    CampaignLifecycleHistory,
    CampaignOperationAudit,
    CampaignStatus,
    FilledForm,
)


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
REPORTABLE_STATUSES = (CampaignStatus.REVIEW, CampaignStatus.CLOSED)


def validate_date_edit(campaign: Campaign, start: datetime, end: datetime | None, *, now: datetime,
                       configuration_errors: Callable[[], Sequence[str]]) -> None:
    """Validate date edits (already ordered by the caller): any date before activation, only a later deadline while active."""
    status = CampaignStatus(campaign.status)
    if status == CampaignStatus.ACTIVE:
        # Review ends filling for good, so a later deadline is how HR gives people more time.
        if start != campaign.start_date:
            raise CampaignLifecycleError("The start of an active campaign cannot change")
        if end is None:
            raise CampaignLifecycleError("Active campaigns require an end timestamp")
        if end <= now:
            raise CampaignLifecycleError("The new deadline must be in the future")
        if end < campaign.end_date:
            raise CampaignLifecycleError("The deadline of an active campaign can only be extended")
        return
    if status not in {CampaignStatus.DRAFT, CampaignStatus.SCHEDULED}:
        raise CampaignLifecycleError(f"Dates cannot be changed in {status.value}")
    if status == CampaignStatus.SCHEDULED:
        if start <= now:
            raise CampaignLifecycleError("Scheduled campaigns must start in the future")
        if end is None:
            raise CampaignLifecycleError("Scheduled campaigns require an end timestamp")
        errors = configuration_errors()
        if errors:
            raise CampaignLifecycleError("Invalid campaign configuration: " + "; ".join(errors))


def reporting_allowed(campaign: Campaign) -> bool:
    """Result availability is separate from reports.read and privacy suppression."""
    return CampaignStatus(campaign.status) in REPORTABLE_STATUSES


def record_snapshot_issuance(db: Session, campaign: Campaign, count: int,
                             *, actor_user_id: int | None = None) -> None:
    if count <= 0:
        return
    db.add(CampaignOperationAudit(
        campaign_id=campaign.id, category="snapshot_issuance", actor_user_id=actor_user_id,
        is_automatic=actor_user_id is None, occurred_at=datetime.now(timezone.utc),
        previous_status=campaign.status, resulting_status=campaign.status, issued_count=count,
    ))


def status_of(filled_form: FilledForm) -> str:
    """Submitted once it has a finish date; in progress once answers are saved; otherwise not started."""
    if filled_form.finish_date is not None:
        return "completed"
    return "in_progress" if filled_form.answers else "not_started"


def is_overdue(form: FilledForm, campaign: Campaign, *, now: datetime) -> bool:
    return (
        form.finish_date is None
        and campaign.end_date is not None
        and now >= campaign.end_date
        and CampaignStatus(campaign.status) in {
            CampaignStatus.ACTIVE, CampaignStatus.PAUSED, CampaignStatus.REVIEW, CampaignStatus.CLOSED,
        }
    )


def resume_target(campaign: Campaign, now: datetime) -> CampaignStatus:
    """A paused campaign returns where it was, except that a passed deadline ends filling."""
    if campaign.paused_from_status == CampaignStatus.REVIEW.value or (campaign.end_date is not None and now >= campaign.end_date):
        return CampaignStatus.REVIEW
    return CampaignStatus.ACTIVE


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

    Scheduling and activation need validate_configuration, activation also issue_snapshots (the
    lifecycle worker). Issuance must be idempotent and must not commit; a failure rolls back the
    nested transaction, including snapshots written during the attempt.
    """
    target = CampaignStatus(target)
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).populate_existing().with_for_update().one_or_none()
    if campaign is None:
        raise CampaignLifecycleError("Campaign not found")
    current = CampaignStatus(campaign.status)
    if target not in ALLOWED_TRANSITIONS[current]:
        raise CampaignLifecycleError(f"Invalid transition: {current.value} -> {target.value}")
    if campaign.is_archived:
        raise CampaignLifecycleError("Archived campaigns cannot transition")
    if target in {CampaignStatus.SCHEDULED, CampaignStatus.ACTIVE} and current != CampaignStatus.PAUSED:
        if campaign.end_date is None:
            raise CampaignLifecycleError("Scheduling and activation require an end timestamp")
        errors = validate_configuration(campaign, db)
        if errors:
            raise CampaignLifecycleError("Invalid campaign configuration: " + "; ".join(errors))
    if target == CampaignStatus.SCHEDULED and campaign.start_date <= now:
        raise CampaignLifecycleError("Campaign start must be in the future")
    if current == CampaignStatus.SCHEDULED and target == CampaignStatus.ACTIVE and now < campaign.start_date:
        raise CampaignLifecycleError("Campaign has not started")
    if automatic and target == CampaignStatus.REVIEW and now < campaign.end_date:
        raise CampaignLifecycleError("Automatic review requires a passed deadline")
    if current == CampaignStatus.PAUSED and target != resume_target(campaign, now):
        raise CampaignLifecycleError(f"Paused campaign must resume in {resume_target(campaign, now).value}")

    with db.begin_nested():
        if current == CampaignStatus.SCHEDULED and target == CampaignStatus.ACTIVE:
            errors = issue_snapshots(campaign, db)
            if errors:
                raise CampaignLifecycleError("Snapshot issuance failed: " + "; ".join(errors))
        campaign.paused_from_status = current.value if target == CampaignStatus.PAUSED else None
        campaign.status = target.value
        campaign.is_active = target == CampaignStatus.ACTIVE
        campaign.lifecycle_error = None
        campaign.lifecycle_retry_at = None
        campaign.lifecycle_attempts = 0
        campaign.last_transition_at = now
        db.add(CampaignLifecycleHistory(
            campaign_id=campaign.id, previous_status=current.value, new_status=target.value,
            transitioned_at=now, actor_user_id=actor_user_id, is_automatic=automatic,
        ))
        db.flush()
    return campaign


def set_campaign_archived(db: Session, campaign_id: int, archived: bool, *, actor_user_id: int, now: datetime) -> Campaign:
    """Archiving is orthogonal to lifecycle; callers own the transaction."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).populate_existing().with_for_update().one_or_none()
    if campaign is None:
        raise CampaignLifecycleError("Campaign not found")
    if campaign.is_archived == archived:
        raise CampaignLifecycleError("Campaign is already " + ("archived" if archived else "unarchived"))
    if archived and campaign.status not in {CampaignStatus.PAUSED.value, CampaignStatus.CLOSED.value}:
        raise CampaignLifecycleError("Only paused or closed campaigns can be archived")
    campaign.is_archived = archived
    if archived:
        campaign.archived_at, campaign.archived_by = now, actor_user_id
    else:
        campaign.unarchived_at, campaign.unarchived_by = now, actor_user_id
    db.add(CampaignArchiveEvent(campaign_id=campaign.id, action="archive" if archived else "unarchive",
                                occurred_at=now, actor_user_id=actor_user_id))
    db.flush()
    return campaign


def deletion_blocker(campaign: Campaign) -> str | None:
    """Only a never-started campaign is deletable: no transition leads back to Draft or Scheduled once
    it was active, and issuing, answering and archiving all happen only after activation."""
    if campaign.status not in {CampaignStatus.DRAFT.value, CampaignStatus.SCHEDULED.value}:
        return "Only draft or scheduled campaigns can be deleted"
    return None

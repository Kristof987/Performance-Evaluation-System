"""Dedicated, transaction-scoped campaign lifecycle worker."""

import logging
from datetime import datetime, timedelta, timezone
from threading import Event

from sqlalchemy import and_, or_

import campaign_lifecycle
from database import SessionLocal
from models import Campaign, CampaignOperationAudit, CampaignStatus


logger = logging.getLogger(__name__)
POLL_SECONDS = 15


def run_due_transitions(validate_configuration, issue_snapshots, *, limit=100):
    """Catch up overdue campaigns; SKIP LOCKED prevents replicas doing the same work."""
    for _ in range(limit):
        now = datetime.now(timezone.utc)
        with SessionLocal() as db:
            campaign = (
                db.query(Campaign)
                .filter(
                    Campaign.is_archived.is_(False),
                    or_(Campaign.lifecycle_retry_at.is_(None), Campaign.lifecycle_retry_at <= now),
                    or_(
                        and_(Campaign.status == CampaignStatus.SCHEDULED.value, Campaign.start_date <= now),
                        and_(Campaign.status == CampaignStatus.ACTIVE.value, Campaign.end_date.isnot(None),
                             Campaign.end_date <= now),
                    ),
                )
                .order_by(Campaign.end_date.asc().nulls_last(), Campaign.start_date.asc(), Campaign.id.asc())
                .with_for_update(skip_locked=True, of=Campaign)
                .first()
            )
            if campaign is None:
                return
            campaign_id = campaign.id
            target = (CampaignStatus.ACTIVE if campaign.status == CampaignStatus.SCHEDULED.value
                      else CampaignStatus.REVIEW)
            try:
                campaign_lifecycle.transition_campaign(
                    db, campaign_id, target, now=now, automatic=True,
                    validate_configuration=validate_configuration, issue_snapshots=issue_snapshots,
                )
                db.commit()
            except Exception as error:
                db.rollback()
                logger.error("Automatic campaign %s transition to %s failed (%s)",
                             campaign_id, target.value, type(error).__name__)
                # Reacquire after rollback. Never attach stale failures to an operator
                # transition or an activation completed by another replica.
                failed = db.query(Campaign).filter(Campaign.id == campaign_id).with_for_update().one_or_none()
                if failed is not None and failed.status == (
                    CampaignStatus.SCHEDULED.value if target == CampaignStatus.ACTIVE else CampaignStatus.ACTIVE.value
                ) and not failed.is_archived:
                    if failed.lifecycle_attempts == 0:
                        db.add(CampaignOperationAudit(
                            campaign_id=failed.id, category="transition_failure", actor_user_id=None,
                            is_automatic=True, occurred_at=datetime.now(timezone.utc),
                            previous_status=failed.status, resulting_status=failed.status, issued_count=0,
                        ))
                    attempts = failed.lifecycle_attempts + 1
                    failed.lifecycle_attempts = attempts
                    failed.lifecycle_error = (str(error)[:2000] if isinstance(error, campaign_lifecycle.CampaignLifecycleError)
                                              else "Technical lifecycle failure; retry is scheduled")
                    failed.lifecycle_retry_at = datetime.now(timezone.utc) + timedelta(
                        seconds=min(3600, 15 * (2 ** min(attempts - 1, 8)))
                    )
                    db.commit()


def serve(stop: Event, validate_configuration, issue_snapshots):
    while not stop.is_set():
        try:
            run_due_transitions(validate_configuration, issue_snapshots)
        except Exception as error:
            logger.error("Campaign lifecycle worker iteration failed (%s)", type(error).__name__)
        stop.wait(POLL_SECONDS)


if __name__ == "__main__":
    from main import issue_activation_snapshots, validate_campaign_configuration

    serve(Event(), validate_campaign_configuration, issue_activation_snapshots)

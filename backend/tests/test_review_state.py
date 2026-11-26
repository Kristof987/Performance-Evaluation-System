"""Review ends filling for good: no issuing or new pairs there, and an active deadline can only move later."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import models
import schemas
from database import SessionLocal
from services import campaign_service, campaign_setup_service
from tests.test_assigned_questionnaires import World


@pytest.fixture
def db():
    session = SessionLocal()
    session.commit = session.flush
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def update(world, **dates):
    payload = schemas.CampaignUpdate(name=world.campaign.name, description=None, comment=None, **dates)
    return campaign_service.update_campaign(campaign_id=world.campaign.id, campaign_update=payload,
                                            db=world.db, actor=world.users[0])


def expect(status_code, call, *args, **kwargs):
    with pytest.raises(HTTPException) as error:
        call(*args, **kwargs)
    assert error.value.status_code == status_code
    return error.value.detail


def deadline_audits(db, campaign):
    return db.query(models.CampaignOperationAudit).filter_by(campaign_id=campaign.id,
                                                             category="deadline_extension").count()


def test_an_active_deadline_can_be_extended_and_is_audited(db):
    world = World(db)
    later = world.campaign.end_date + timedelta(days=3)
    update(world, start_date=world.campaign.start_date, end_date=later)
    assert world.campaign.end_date == later
    assert deadline_audits(db, world.campaign) == 1


@pytest.mark.parametrize("change", ["earlier", "past", "start", "removed"])
def test_an_active_campaign_rejects_other_date_changes(db, change):
    world = World(db)
    now = datetime.now(timezone.utc)
    start, end = world.campaign.start_date, world.campaign.end_date
    if change == "earlier":
        end = end - timedelta(days=1)
    elif change == "past":
        world.campaign.end_date = now - timedelta(hours=1)
        db.flush()
        end = now - timedelta(minutes=5)
    elif change == "start":
        start = start - timedelta(days=1)
    else:
        end = None
    expect(409, update, world, start_date=start, end_date=end)
    assert deadline_audits(db, world.campaign) == 0


def test_an_overdue_active_campaign_can_be_reopened_with_a_new_deadline(db):
    world = World(db)
    world.campaign.end_date = datetime.now(timezone.utc) - timedelta(hours=1)
    db.flush()
    update(world, start_date=world.campaign.start_date, end_date=datetime.now(timezone.utc) + timedelta(days=1))
    world.save([{"question_id": "required", "value": "Late but welcome"}], submit=True)


@pytest.mark.parametrize("status, paused_from", [("review", None), ("paused", "review")])
def test_review_locks_issuing_and_the_evaluation_plan(db, status, paused_from):
    world = World(db)
    world.campaign.status, world.campaign.is_active = status, False
    world.campaign.paused_from_status = paused_from
    db.flush()
    expect(409, campaign_setup_service.issue_ready_campaign_evaluations,
           campaign_id=world.campaign.id, db=db, manager=world.users[0])
    expect(409, campaign_service.require_mutable_campaign_plan, world.campaign)
    assert campaign_service.ensure_campaign_issued(world.campaign.id, db, commit=False) == []

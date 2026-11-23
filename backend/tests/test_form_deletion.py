from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

import models
import schemas
from database import SessionLocal
from api.forms import delete_form, delete_form_template, get_forms, restore_form, update_form
from services.form_service import selectable_forms


@pytest.fixture
def db():
    session = SessionLocal()
    session.commit = session.flush
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def form(db, name=None):
    item = models.Form(name=name or f"Form {uuid4().hex}", description=None, questions=[])
    db.add(item)
    db.flush()
    return item


def campaign_using(db, item, status):
    role = models.CompanyRole(name=f"Role {uuid4().hex}")
    db.add(role)
    db.flush()
    group = models.CompanyGroup(name=f"Group {uuid4().hex}")
    db.add(group)
    user = db.query(models.User).first()
    campaign = models.Campaign(name=f"Campaign {uuid4().hex[:8]}", start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
                               status=status, created_by=user.id)
    db.add(campaign)
    db.flush()
    db.add(models.CampaignEvaluationRule(campaign_id=campaign.id, company_group_id=group.id, evaluator_role_id=role.id,
                                         evaluatee_role_id=role.id, form_id=item.id))
    db.flush()
    return campaign


def test_unused_form_is_deleted(db):
    item = form(db)
    assert delete_form(item.id, db, None) == {"deleted": True, "archived": False}
    assert db.get(models.Form, item.id) is None


def test_form_of_a_closed_campaign_is_archived_not_deleted(db):
    item = form(db)
    campaign_using(db, item, models.CampaignStatus.CLOSED.value)
    assert delete_form(item.id, db, None) == {"deleted": False, "archived": True}
    db.refresh(item)
    assert item.archived_at is not None
    listed = {row.id: row for row in get_forms(db, None)}
    assert listed[item.id].archived_at is not None and listed[item.id].used_in_campaigns


@pytest.mark.parametrize("status", ["draft", "scheduled", "active", "paused", "review"])
def test_form_of_a_running_campaign_cannot_be_removed(db, status):
    item = form(db)
    campaign = campaign_using(db, item, status)
    with pytest.raises(HTTPException) as error:
        delete_form(item.id, db, None)
    assert error.value.status_code == 409
    assert campaign.name in error.value.detail
    db.refresh(item)
    assert item.archived_at is None


def test_archived_form_must_be_restored_before_editing(db):
    item = form(db)
    campaign_using(db, item, models.CampaignStatus.CLOSED.value)
    delete_form(item.id, db, None)
    payload = schemas.FormUpdate(name=item.name, description=None, questions=[])
    with pytest.raises(HTTPException) as error:
        update_form(item.id, payload, db, None)
    assert error.value.status_code == 409
    restored = restore_form(item.id, db, None)
    assert restored.archived_at is None and restored.used_in_campaigns


def test_archived_forms_are_only_offered_to_campaigns_that_use_them(db):
    archived = form(db)
    owner = campaign_using(db, archived, models.CampaignStatus.CLOSED.value)
    delete_form(archived.id, db, None)
    other = campaign_using(db, form(db), models.CampaignStatus.DRAFT.value)
    assert archived.id in {item.id for item in selectable_forms(owner.id, db)}
    assert archived.id not in {item.id for item in selectable_forms(other.id, db)}


def test_template_is_deleted(db):
    template = models.FormTemplate(name=f"Template {uuid4().hex}", description=None, questions=[])
    db.add(template)
    db.flush()
    assert delete_form_template(template.id, db, None) == {"deleted": True}
    assert db.get(models.FormTemplate, template.id) is None

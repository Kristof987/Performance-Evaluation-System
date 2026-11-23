from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

import models
from services import reporting_service
from services import section_scoring_service as scoring
from database import SessionLocal
from main import snapshot_assignment_roles
from api.people import delete_company_role
from services.people_service import ensure_group_membership_mutable, get_or_create_company_role


@pytest.fixture
def db():
    session = SessionLocal()
    session.commit = session.flush
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def company_role(db, name=None):
    role = models.CompanyRole(name=name or f"Role {uuid4().hex}")
    db.add(role)
    db.flush()
    return role


def employee(db, role):
    suffix = uuid4().hex
    system_role = db.query(models.SystemRole).first()
    user = models.User(username=suffix, email=f"{suffix}@example.com", password_hash="", system_role_id=system_role.id, is_active=True)
    db.add(user)
    db.flush()
    person = models.Employee(user_id=user.id, full_name=f"Person {suffix[:6]}", company_role_id=role.id, is_active=True)
    db.add(person)
    db.flush()
    return person


def campaign(db, status, creator):
    item = models.Campaign(name=f"Campaign {uuid4().hex}", start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
                           status=status, created_by=creator.user_id)
    db.add(item)
    db.flush()
    return item


def assignment(db, campaign_id, group_id, evaluator, evaluatee, *, issued=True):
    status = db.query(models.FormStatus).first()
    if status is None:
        status = models.FormStatus(name="Not started")
        db.add(status)
        db.flush()
    row = models.FilledForm(campaign_id=campaign_id, company_group_id=group_id, evaluator_id=evaluator.id,
                            evaluatee_id=evaluatee.id, status_id=status.id, answers=[],
                            form_snapshot={"schema_version": 2, "questions": []} if issued else None)
    db.add(row)
    db.flush()
    if issued:
        snapshot_assignment_roles(row, db)
    return row


def evaluation(evaluator_id, evaluatee_id, *, evaluator_role=None, evaluatee_role=None):
    return scoring.EvaluationSections(1, 1, evaluator_id, evaluatee_id, 1, None, frozenset({7}), {7: 0.5}, {},
                                      evaluator_role, evaluatee_role)


def test_issued_roles_win_over_current_roles():
    current = {10: 1, 20: 1}
    snapshotted = evaluation(10, 20, evaluator_role=2, evaluatee_role=3)
    assert scoring.role_of(snapshotted, current) == 3
    assert scoring.role_of(snapshotted, current, evaluator=True) == 2
    assert scoring.role_of(evaluation(10, 20), current) == 1


def test_promotion_after_closed_campaign_keeps_history(db):
    engineer, lead = company_role(db), company_role(db)
    peter, anna = employee(db, engineer), employee(db, engineer)
    group = models.CompanyGroup(name=f"Group {uuid4().hex}")
    db.add(group)
    db.flush()
    closed = campaign(db, models.CampaignStatus.CLOSED.value, anna)
    row = assignment(db, closed.id, group.id, anna, peter)
    assert (row.evaluator_company_role_id, row.evaluatee_company_role_id) == (engineer.id, engineer.id)

    ensure_group_membership_mutable(None, peter.id, db, role_change=True)
    peter.company_role_id = lead.id
    db.flush()
    current = {peter.id: lead.id, anna.id: engineer.id}
    assert reporting_service.assignment_role_id(row, current) == engineer.id
    # Leaving the group is allowed once the campaign is closed.
    ensure_group_membership_mutable(group.id, peter.id, db)


def test_running_campaign_still_protects_planned_rows_and_groups(db):
    role = company_role(db)
    peter, anna = employee(db, role), employee(db, role)
    group = models.CompanyGroup(name=f"Group {uuid4().hex}")
    db.add(group)
    db.flush()
    active = campaign(db, models.CampaignStatus.ACTIVE.value, anna)
    assignment(db, active.id, group.id, anna, peter)
    ensure_group_membership_mutable(None, peter.id, db, role_change=True)  # issued rows froze the role
    with pytest.raises(HTTPException) as error:
        ensure_group_membership_mutable(group.id, peter.id, db)
    assert error.value.status_code == 409

    assignment(db, active.id, group.id, peter, anna, issued=False)
    with pytest.raises(HTTPException) as error:
        ensure_group_membership_mutable(None, peter.id, db, role_change=True)
    assert error.value.status_code == 409


def test_company_role_delete_archive_and_revive(db):
    actor_role = company_role(db)
    actor = employee(db, actor_role)
    user = db.get(models.User, actor.user_id)

    unused = company_role(db)
    delete_company_role(unused.id, db, user)
    assert db.get(models.CompanyRole, unused.id) is None

    in_use = company_role(db)
    holder = employee(db, in_use)
    with pytest.raises(HTTPException) as error:
        delete_company_role(in_use.id, db, user)
    assert error.value.status_code == 409

    group = models.CompanyGroup(name=f"Group {uuid4().hex}")
    db.add(group)
    db.flush()
    closed = campaign(db, models.CampaignStatus.CLOSED.value, actor)
    assignment(db, closed.id, group.id, actor, holder)
    holder.company_role_id = actor_role.id
    db.flush()
    usage = {item["id"]: item for item in delete_company_role(in_use.id, db, user)}
    assert usage[in_use.id]["archived"] is True and usage[in_use.id]["used_in_campaigns"] is True

    assert get_or_create_company_role(in_use.name.upper(), db).id == in_use.id
    assert in_use.archived_at is None

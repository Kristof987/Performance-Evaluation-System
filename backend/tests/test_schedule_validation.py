from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

import models
from database import SessionLocal
from services.campaign_service import validate_campaign_configuration


@pytest.fixture
def db():
    session = SessionLocal()
    session.commit = session.flush
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def make_campaign(db):
    suffix = uuid4().hex
    role = models.CompanyRole(name=f"Engineer {suffix}")
    group = models.CompanyGroup(name=f"Engineering {suffix}")
    form = models.Form(name=f"Peer form {suffix}", questions=[
        {"type": "question", "question": {"id": "q1", "text": "How well?", "type": "Scale", "scale_min": 1, "scale_max": 5, "required": True}},
    ])
    system_role = models.SystemRole(name=f"Planner {suffix}")
    db.add_all([role, group, form, system_role])
    db.flush()
    owner = models.User(username=f"planner-{suffix}", email=f"{suffix}@example.com", password_hash="test-only",
                        system_role_id=system_role.id)
    anna = models.Employee(full_name=f"Anna {suffix}", company_role_id=role.id)
    bela = models.Employee(full_name=f"Bela {suffix}", company_role_id=role.id)
    db.add(owner)
    db.flush()
    start = datetime.now(timezone.utc) + timedelta(days=1)
    campaign = models.Campaign(name=f"Campaign {suffix}", start_date=start, end_date=start + timedelta(days=7),
                               created_by=owner.id)
    db.add_all([anna, bela, campaign])
    db.flush()
    db.execute(models.employee_company_groups.insert(), [
        {"employee_id": anna.id, "company_group_id": group.id},
        {"employee_id": bela.id, "company_group_id": group.id},
    ])
    db.execute(models.campaign_company_groups.insert().values(campaign_id=campaign.id, company_group_id=group.id))
    db.add(models.CampaignEvaluationRule(campaign_id=campaign.id, company_group_id=group.id,
                                         evaluator_role_id=role.id, evaluatee_role_id=role.id, form_id=form.id))
    db.flush()
    return campaign, group, form, anna, bela


def add_assignment(db, campaign, group, evaluator, evaluatee, form_id):
    db.add(models.FilledForm(campaign_id=campaign.id, company_group_id=group.id, evaluator_id=evaluator.id,
                             evaluatee_id=evaluatee.id, form_id=form_id, answers=[]))
    db.flush()


def test_self_pair_without_self_form_points_to_self_evaluations(db):
    campaign, group, form, anna, bela = make_campaign(db)
    add_assignment(db, campaign, group, anna, bela, form.id)
    add_assignment(db, campaign, group, anna, anna, None)

    errors = validate_campaign_configuration(campaign, db)

    assert errors == [f"Self-evaluation for {anna.full_name} needs a questionnaire selected on the Self-evaluations tab"]


def test_self_pair_with_self_form_is_valid(db):
    campaign, group, form, anna, bela = make_campaign(db)
    db.add(models.CampaignEmployeeSelfEvaluation(campaign_id=campaign.id, employee_id=anna.id, form_id=form.id))
    add_assignment(db, campaign, group, anna, bela, form.id)
    add_assignment(db, campaign, group, anna, anna, form.id)

    assert validate_campaign_configuration(campaign, db) == []


def test_peer_pair_without_rule_names_both_employees(db):
    campaign, group, form, anna, bela = make_campaign(db)
    db.query(models.CampaignEvaluationRule).filter(models.CampaignEvaluationRule.campaign_id == campaign.id).delete()
    add_assignment(db, campaign, group, anna, bela, None)

    errors = validate_campaign_configuration(campaign, db)

    assert len(errors) == 1
    assert errors[0].startswith(f"Evaluation {anna.full_name} → {bela.full_name} needs a saved questionnaire")

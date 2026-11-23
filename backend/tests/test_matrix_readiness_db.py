"""Matrix saving through the database: planning without forms, rule-driven forms, and issued work kept intact."""
from datetime import date
from uuid import uuid4

import pytest
from fastapi import HTTPException

import models
import schemas
from database import SessionLocal
from main import (
    build_campaign_evaluation_matrix,
    issue_activation_snapshots,
    update_campaign_evaluation_matrix,
    validate_campaign_configuration,
)


@pytest.fixture
def db():
    session = SessionLocal()
    # Exercise the real query/save path in one transaction; never commit test records.
    session.commit = session.flush
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def add(db, item):
    db.add(item)
    db.flush()
    return item


def test_plan_follows_rules_and_issued_form_survives_rule_change(db):
    suffix = uuid4().hex[:8]
    role = add(db, models.CompanyRole(name=f"Matrix role {suffix}"))
    system_role = db.query(models.SystemRole).first() or add(db, models.SystemRole(name=f"System {suffix}"))
    group = add(db, models.CompanyGroup(name=f"Matrix group {suffix}"))
    question = [{"id": "q", "text": "Feedback", "type": "Text", "required": True}]
    form = add(db, models.Form(name=f"Matrix form {suffix}", questions=question))
    replacement = add(db, models.Form(name=f"Matrix replacement {suffix}", questions=question))
    actor = add(db, models.User(username=f"hr-{suffix}", email=f"hr-{suffix}@example.com", password_hash="",
                                system_role_id=system_role.id, is_active=True))
    people = [add(db, models.Employee(full_name=f"Person {index} {suffix}", company_role_id=role.id, is_active=True))
              for index in range(2)]
    campaign = add(db, models.Campaign(name=f"Matrix campaign {suffix}", start_date=date.today(), created_by=actor.id))
    db.execute(models.campaign_company_groups.insert().values(campaign_id=campaign.id, company_group_id=group.id))
    for person in people:
        db.execute(models.employee_company_groups.insert().values(employee_id=person.id, company_group_id=group.id))
    db.flush()
    payload = schemas.CampaignEvaluationMatrixUpdate(assignments=[
        schemas.CampaignEvaluationMatrixUpdateItem(company_group_id=group.id, evaluator_id=people[0].id, evaluatee_id=people[1].id)
    ])

    # Without a rule the pair can still be planned, but scheduling reports the missing questionnaire.
    assert update_campaign_evaluation_matrix(campaign.id, payload, db, manager=actor)["created_count"] == 1
    planned = db.query(models.FilledForm).filter_by(campaign_id=campaign.id).one()
    assert planned.form_id is None
    assert any("needs a saved questionnaire" in error for error in validate_campaign_configuration(campaign, db))

    # Saving the rule assigns its form to the planned pair.
    rule = add(db, models.CampaignEvaluationRule(campaign_id=campaign.id, company_group_id=group.id,
                                                 evaluator_role_id=role.id, evaluatee_role_id=role.id, form_id=form.id))
    assert update_campaign_evaluation_matrix(campaign.id, payload, db, manager=actor)["created_count"] == 0
    db.refresh(planned)
    assert planned.form_id == form.id
    assert build_campaign_evaluation_matrix(campaign.id, db)["groups"][0]["assignments"][0]["form_id"] == form.id
    assert not any("questionnaire" in error for error in validate_campaign_configuration(campaign, db))

    # Once issued, a later rule change does not rewrite the questionnaire someone is already filling in.
    assert issue_activation_snapshots(campaign, db) == []
    db.flush()
    rule.form_id = replacement.id
    db.flush()
    assert update_campaign_evaluation_matrix(campaign.id, payload, db, manager=actor)["created_count"] == 0
    db.refresh(planned)
    assert planned.form_id == form.id
    assert planned.form_snapshot["form_id"] == form.id
    # Issued work cannot be dropped from the plan.
    with pytest.raises(HTTPException) as error:
        update_campaign_evaluation_matrix(campaign.id, schemas.CampaignEvaluationMatrixUpdate(assignments=[]), db, manager=actor)
    assert error.value.status_code == 409

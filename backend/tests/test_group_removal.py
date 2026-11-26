"""Removing a group from a campaign before launch takes its dependent setup with it."""
from uuid import uuid4

import pytest
from fastapi import HTTPException

import models
import schemas
from database import SessionLocal
from services.campaign_setup_service import update_campaign_groups
from tests.test_schedule_validation import add_assignment, make_campaign


@pytest.fixture
def db():
    session = SessionLocal()
    session.commit = session.flush
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def second_group(db, campaign, *members):
    group = models.CompanyGroup(name=f"Sales {uuid4().hex}")
    db.add(group)
    db.flush()
    db.execute(models.campaign_company_groups.insert().values(campaign_id=campaign.id, company_group_id=group.id))
    for person in members:
        db.execute(models.employee_company_groups.insert().values(employee_id=person.id, company_group_id=group.id))
    db.flush()
    return group


def assignments(db, campaign):
    return {(row.company_group_id, row.evaluator_id, row.evaluatee_id)
            for row in db.query(models.FilledForm).filter_by(campaign_id=campaign.id)}


def test_draft_group_removal_cascades_and_keeps_shared_pairs(db):
    campaign, group, form, anna, bela = make_campaign(db)
    sales = second_group(db, campaign, anna)
    carl = models.Employee(full_name=f"Carl {uuid4().hex}", company_role_id=anna.company_role_id)
    db.add(carl)
    db.flush()
    db.execute(models.employee_company_groups.insert().values(employee_id=carl.id, company_group_id=group.id))
    add_assignment(db, campaign, group, anna, bela, form.id)   # Bela leaves with the group: removed.
    add_assignment(db, campaign, group, anna, anna, form.id)   # Anna stays in Sales: moves there.
    db.add(models.CampaignEmployeeSelfEvaluation(campaign_id=campaign.id, employee_id=anna.id, form_id=form.id))
    db.add(models.CampaignEmployeeSelfEvaluation(campaign_id=campaign.id, employee_id=bela.id, form_id=form.id))
    db.flush()

    result = update_campaign_groups(campaign_id=campaign.id, payload=schemas.CampaignGroupsUpdate(group_ids=[sales.id]),
                                    db=db, manager=db.query(models.User).filter_by(id=campaign.created_by).one())

    assert result["assigned_group_ids"] == [sales.id]
    assert db.query(models.CampaignEvaluationRule).filter_by(campaign_id=campaign.id).count() == 0
    assert assignments(db, campaign) == {(sales.id, anna.id, anna.id)}
    assert {row.employee_id for row in db.query(models.CampaignEmployeeSelfEvaluation)
            .filter_by(campaign_id=campaign.id)} == {anna.id}


def test_issued_evaluations_still_block_removal(db):
    campaign, group, form, anna, bela = make_campaign(db)
    sales = second_group(db, campaign, anna)
    add_assignment(db, campaign, group, anna, bela, form.id)
    db.query(models.FilledForm).filter_by(campaign_id=campaign.id).update({"form_snapshot": {"schema_version": 2, "questions": []}})
    with pytest.raises(HTTPException) as error:
        update_campaign_groups(campaign_id=campaign.id, payload=schemas.CampaignGroupsUpdate(group_ids=[sales.id]),
                               db=db, manager=db.query(models.User).filter_by(id=campaign.created_by).one())
    assert error.value.status_code == 409


def test_running_campaign_keeps_requiring_an_empty_group(db):
    campaign, group, _form, anna, _bela = make_campaign(db)
    sales = second_group(db, campaign, anna)
    campaign.status = models.CampaignStatus.ACTIVE.value
    db.flush()
    with pytest.raises(HTTPException) as error:
        update_campaign_groups(campaign_id=campaign.id, payload=schemas.CampaignGroupsUpdate(group_ids=[sales.id]),
                               db=db, manager=db.query(models.User).filter_by(id=campaign.created_by).one())
    assert "form rules" in error.value.detail

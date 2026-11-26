"""Written feedback: HR reads every employee's; a group leader only their members', under the reviewer threshold."""
from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

import models
from database import SessionLocal
from services import permissions as permission_service
from services import question_analytics_service, reporting_service, workspace_settings_service


@pytest.fixture
def db(monkeypatch):
    session = SessionLocal()
    session.commit = session.flush
    monkeypatch.setattr(workspace_settings_service, "privacy_thresholds", lambda _db: (2, 2))
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def add(db, item):
    db.add(item)
    db.flush()
    return item


SNAPSHOT = {"schema_version": 2, "questions": [{"type": "question", "question": {"id": "t", "type": "Text", "text": "Comment"}}]}


class World:
    def __init__(self, db, status="review"):
        self.db = db
        suffix = uuid4().hex
        system_role = db.query(models.SystemRole).first() or add(db, models.SystemRole(name=f"Role {suffix}"))
        role = add(db, models.CompanyRole(name=f"Feedback role {suffix}"))
        form = add(db, models.Form(name=f"Feedback form {suffix}", questions=[]))
        self.groups = [add(db, models.CompanyGroup(name=f"{name} {suffix}")) for name in ("Led", "Other")]
        self.people = []
        for index in range(6):
            user = add(db, models.User(username=f"f{index}-{suffix}", email=f"f{index}-{suffix}@example.com", password_hash="",
                                       system_role_id=system_role.id, is_active=True))
            self.people.append(add(db, models.Employee(user_id=user.id, full_name=f"Person {index}", company_role_id=role.id, is_active=True)))
        self.lead, self.one_reviewer, self.reviewer, self.rated, self.other, self.other_rated = self.people
        led, other = self.groups
        db.execute(models.employee_company_groups.insert(), [
            {"employee_id": person.id, "company_group_id": led.id} for person in self.people[:4]] + [
            {"employee_id": person.id, "company_group_id": other.id} for person in self.people[4:]])
        db.execute(models.company_group_leaders.insert().values(employee_id=self.lead.id, company_group_id=led.id))
        self.campaign = add(db, models.Campaign(name=f"Feedback {suffix}", status=status, is_active=False,
                                                start_date=datetime(2090, 1, 1, tzinfo=timezone.utc), created_by=self.lead.user_id))
        db.execute(models.campaign_company_groups.insert(), [{"campaign_id": self.campaign.id, "company_group_id": group.id} for group in self.groups])
        for group, evaluator, evaluatee, text in [
            (led, self.reviewer, self.rated, "Clear plans"), (led, self.one_reviewer, self.rated, "Always helpful"),
            (led, self.reviewer, self.one_reviewer, "Only one view"), (led, self.rated, self.rated, "My own words"),
            (led, self.rated, self.lead, "About the lead"), (led, self.reviewer, self.lead, "Also the lead"),
            (other, self.other, self.other_rated, "Elsewhere"), (other, self.other_rated, self.other_rated, "Own elsewhere"),
        ]:
            add(db, models.FilledForm(campaign_id=self.campaign.id, form_id=form.id, company_group_id=group.id,
                                      evaluator_id=evaluator.id, evaluatee_id=evaluatee.id, finish_date=date(2090, 2, 1),
                                      answers=[{"question_id": "t", "value": text}], form_snapshot=SNAPSHOT))
        self.key = next(iter(question_analytics_service._collect(reporting_service.campaign_report_rows(self.campaign.id, db), db)[0]))

    def as_hr(self, monkeypatch):
        monkeypatch.setattr(permission_service, "has_permission", lambda _a, _db, *names: bool({"reports.read", "campaigns.manage"} & set(names)))
        reporting_service._team_groups.set(None)
        return self.lead.user

    def as_lead(self, monkeypatch):
        monkeypatch.setattr(permission_service, "has_permission", lambda _a, _db, *names: "reports.read_team" in names)
        reporting_service.enter_report_scope(self.lead.user, self.db)
        return self.lead.user

    def feedback(self, actor, employee=None, kind="peer", key=True):
        return reporting_service.build_written_feedback(self.campaign.id, self.key if key else None, kind, actor, self.db,
                                                        employee_id=employee.id if employee else None)


def test_hr_reads_every_employee(db, monkeypatch):
    world = World(db)
    actor = world.as_hr(monkeypatch)
    assert world.feedback(actor, world.rated)["responses"] == ["Always helpful", "Clear plans"]
    assert world.feedback(actor, world.one_reviewer)["responses"] == ["Only one view"]
    assert world.feedback(actor, world.other_rated)["responses"] == ["Elsewhere"]


def test_a_group_leader_reads_their_members_without_reviewers(db, monkeypatch):
    world = World(db)
    actor = world.as_lead(monkeypatch)
    result = world.feedback(actor, world.rated)
    assert (result["availability"], result["responses"]) == ("available", ["Always helpful", "Clear plans"])
    assert world.feedback(actor, world.rated, "self")["responses"] == ["My own words"]


def test_a_group_leader_needs_enough_colleagues(db, monkeypatch):
    world = World(db)
    actor = world.as_lead(monkeypatch)
    result = world.feedback(actor, world.one_reviewer)
    assert (result["availability"], result["responses"]) == ("suppressed", [])


@pytest.mark.parametrize("target", ["other_rated", "lead"])
def test_a_group_leader_cannot_read_other_groups_or_themself(db, monkeypatch, target):
    world = World(db)
    actor = world.as_lead(monkeypatch)
    with pytest.raises(HTTPException) as error:
        world.feedback(actor, getattr(world, target))
    assert error.value.status_code == 404


def test_a_group_leader_sees_only_members_in_the_directory(db, monkeypatch):
    world = World(db)
    actor = world.as_lead(monkeypatch)
    directory = world.feedback(actor, key=False)["evaluatees"]
    assert {item["evaluatee_id"] for item in directory} == {world.one_reviewer.id, world.rated.id}


def test_a_group_leader_waits_for_review(db, monkeypatch):
    world = World(db, status="active")
    actor = world.as_lead(monkeypatch)
    with pytest.raises(HTTPException) as error:
        world.feedback(actor, world.rated)
    assert error.value.status_code == 409

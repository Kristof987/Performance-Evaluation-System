from datetime import date, datetime, timezone
from uuid import uuid4

import pytest

import models
import report_dashboard_service
import reporting_service
from database import SessionLocal


@pytest.fixture
def db():
    session = SessionLocal()
    session.commit = session.flush
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def permissions(monkeypatch):
    granted = {"reports.read", "campaigns.manage"}
    monkeypatch.setattr(reporting_service, "_has_permission", lambda _actor, _db, permission: permission in granted)
    return granted


def add(db, item):
    db.add(item)
    db.flush()
    return item


class World:
    def __init__(self, db):
        self.db = db
        suffix = uuid4().hex
        system_role = db.query(models.SystemRole).first() or add(db, models.SystemRole(name=f"Role {suffix}"))
        self.role = add(db, models.CompanyRole(name=f"Dashboard role {suffix}"))
        self.actor = add(db, models.User(username=f"hr-{suffix}", email=f"hr-{suffix}@example.com", password_hash="",
                                         system_role_id=system_role.id, is_active=True))
        self.done = db.query(models.FormStatus).filter(models.FormStatus.name == "Completed").first() or add(db, models.FormStatus(name="Completed"))
        self.open = db.query(models.FormStatus).filter(models.FormStatus.name == "Not started").first() or add(db, models.FormStatus(name="Not started"))
        self.section_a = add(db, models.Section(scope_key="default", name=f"Alpha {suffix}", normalized_name=f"alpha {suffix}"))
        self.section_b = add(db, models.Section(scope_key="default", name=f"Beta {suffix}", normalized_name=f"beta {suffix}"))
        self.form = add(db, models.Form(name=f"Form {suffix}", questions=[]))
        self.groups = [add(db, models.CompanyGroup(name=f"{name} {suffix}")) for name in ("Sales", "Support")]
        self.people = [self.person(suffix, index) for index in range(6)]
        members = [(self.groups[0], self.people[:3]), (self.groups[1], self.people[3:])]
        db.execute(models.employee_company_groups.insert(), [
            {"employee_id": person.id, "company_group_id": group.id} for group, people in members for person in people])

    def person(self, suffix, index):
        user = add(self.db, models.User(username=f"p{index}-{suffix}", email=f"p{index}-{suffix}@example.com", password_hash="",
                                        system_role_id=self.actor.system_role_id, is_active=True))
        return add(self.db, models.Employee(user_id=user.id, full_name=f"Person {index}", company_role_id=self.role.id, is_active=True))

    def campaign(self, year, status="closed"):
        item = add(self.db, models.Campaign(name=f"Campaign {year} {uuid4().hex[:6]}", status=status, is_active=False,
                                            start_date=datetime(year, 1, 1, tzinfo=timezone.utc), created_by=self.actor.id))
        self.db.execute(models.campaign_company_groups.insert(), [
            {"campaign_id": item.id, "company_group_id": group.id} for group in self.groups])
        return item

    def snapshot(self):
        return {"schema_version": 2, "questions": [
            {"type": "section", "section_id": section.id, "section": {"id": section.id, "name": section.name},
             "questions": [{"id": f"q{section.id}", "type": "Scale 1-5", "text": "How well?"}]}
            for section in (self.section_a, self.section_b)]}

    def review(self, campaign, group, evaluator, evaluatee, alpha, beta, *, completed=True):
        answers = [{"question_id": f"q{self.section_a.id}", "value": alpha}, {"question_id": f"q{self.section_b.id}", "value": beta}]
        add(self.db, models.FilledForm(campaign_id=campaign.id, form_id=self.form.id, company_group_id=group.id,
                                       evaluator_id=evaluator.id, evaluatee_id=evaluatee.id,
                                       status_id=(self.done if completed else self.open).id,
                                       finish_date=date(2091, 2, 1) if completed else None,
                                       answers=answers if completed else [], form_snapshot=self.snapshot()))

    def rate_everyone(self, campaign, alpha, beta):
        for group_index, group in enumerate(self.groups):
            people = self.people[group_index * 3:group_index * 3 + 3]
            for evaluator in people:
                for evaluatee in people:
                    if evaluator is not evaluatee:
                        self.review(campaign, group, evaluator, evaluatee, alpha[group_index], beta[group_index])


def test_dashboard_combines_matrix_deltas_and_trend(db, permissions):
    world = World(db)
    old = world.campaign(2090)
    world.rate_everyone(old, alpha=(3, 2), beta=(3, 2))
    current = world.campaign(2091)
    world.rate_everyone(current, alpha=(5, 3), beta=(4, 2))
    world.review(current, world.groups[0], world.people[0], world.people[1], 1, 1, completed=False)
    world.campaign(2092, status="active")  # A later, still running campaign is not history.

    result = report_dashboard_service.build_campaign_dashboard(current.id, world.actor, db)

    assert result["previous_campaign"]["id"] == old.id
    assert result["completion"] == {"completed_evaluations": 12, "total_evaluations": 13, "rate": 92, "previous_rate": 100}
    alpha, beta = result["sections"]
    assert (alpha["id"], alpha["score"], alpha["previous_score"]) == (world.section_a.id, 4.0, 2.5)
    assert (beta["score"], beta["previous_score"]) == (3.0, 2.5)
    assert result["overall"]["score"] == 3.5 and result["overall"]["previous_score"] == 2.5
    sales, support = result["groups"]
    assert sales["completion_rate"] == 86 and support["completion_rate"] == 100
    assert sales["sections"][world.section_a.id] == {"score": 5.0, "availability": "available"}
    assert support["sections"][world.section_b.id]["score"] == 2.0
    assert sales["overall"]["score"] == 4.5 and sales["overall"]["previous_score"] == 3.0
    assert [point["campaign"]["id"] for point in result["trend"]] == [old.id, current.id]
    assert result["trend"][0]["groups"][world.groups[1].id] == 2.0
    assert result["trend"][1]["sections"][world.section_a.id] == 4.0
    assert result["trend"][0]["group_sections"][world.groups[0].id][world.section_b.id] == 3.0


def test_dashboard_applies_privacy_suppression(db, permissions):
    permissions.discard("campaigns.manage")
    world = World(db)
    current = world.campaign(2093)
    # Only one evaluated employee in Support: below the aggregate threshold.
    for evaluator in world.people[:3]:
        for evaluatee in world.people[:3]:
            if evaluator is not evaluatee:
                world.review(current, world.groups[0], evaluator, evaluatee, 4, 4)
    world.review(current, world.groups[1], world.people[4], world.people[3], 2, 2)
    world.review(current, world.groups[1], world.people[5], world.people[3], 2, 2)

    result = report_dashboard_service.build_campaign_dashboard(current.id, world.actor, db)

    support = result["groups"][1]
    assert support["overall"]["score"] is None and support["overall"]["availability"] == "suppressed"
    assert all(cell["score"] is None for cell in support["sections"].values())
    assert result["trend"][-1]["groups"][world.groups[1].id] is None
    assert set(result["trend"][-1]["group_sections"][world.groups[1].id].values()) == {None}
    assert result["previous_campaign"] is None and result["overall"]["previous_score"] is None

"""Completion status is reported per evaluator and never reveals who evaluates whom (requirement 7.4)."""
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

import models
import schemas
from database import SessionLocal
from services.campaign_setup_service import build_campaign_evaluation_matrix
from api.campaigns import get_campaign_completion_status


@pytest.fixture
def db():
    session = SessionLocal()
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




class World:
    """Anna has 3 evaluations (1 done, 1 started, 1 not started), Béla 1 done, Cecil 1 not started."""

    def __init__(self, db):
        self.db = db
        suffix = uuid4().hex[:8]
        self.suffix = suffix
        role = add(db, models.CompanyRole(name=f"Role {suffix}"))
        system_role = db.query(models.SystemRole).first() or add(db, models.SystemRole(name=f"System {suffix}"))
        self.actor = add(db, models.User(username=f"hr-{suffix}", email=f"hr-{suffix}@example.com", password_hash="",
                                         system_role_id=system_role.id, is_active=True))
        self.group = add(db, models.CompanyGroup(name=f"Group {suffix}"))
        self.form = add(db, models.Form(name=f"Form {suffix}", questions=[]))
        self.people = {}
        for index, name in enumerate(["Anna", "Bela", "Cecil", "Dora"]):
            user = add(db, models.User(username=f"u{index}-{suffix}", email=f"{name.lower()}-{suffix}@example.com",
                                       password_hash="", system_role_id=system_role.id, is_active=True))
            self.people[name] = add(db, models.Employee(user_id=user.id, full_name=f"{name} {suffix}",
                                                        company_role_id=role.id, is_active=True))
        now = datetime.now(timezone.utc)
        self.campaign = add(db, models.Campaign(name=f"Campaign {suffix}", status="active", is_active=True,
                                                start_date=now - timedelta(days=7), end_date=now - timedelta(hours=1),
                                                created_by=self.actor.id))
        db.execute(models.campaign_company_groups.insert().values(campaign_id=self.campaign.id, company_group_id=self.group.id))
        anna, bela, cecil, dora = self.people.values()
        self.evaluation(anna, bela, "Completed", done=True)
        self.evaluation(anna, cecil, "In progress")
        self.evaluation(anna, dora, "Not started")
        self.evaluation(bela, anna, "Completed", done=True)
        self.evaluation(cecil, dora, "Not started")
        # Planned (not yet issued) assignments are not part of the completion view.
        self.evaluation(dora, anna, "Not started", issued=False)

    def evaluation(self, evaluator, evaluatee, status_name, *, done=False, issued=True):
        return add(self.db, models.FilledForm(
            campaign_id=self.campaign.id, form_id=self.form.id, company_group_id=self.group.id,
            evaluator_id=evaluator.id, evaluatee_id=evaluatee.id,
            finish_date=date.today() if done else None, answers=[{"secret": "do not leak"}] if status_name != "Not started" else [],
            form_snapshot={"schema_version": 2, "questions": []} if issued else None))

    def request(self, **overrides):
        params = {"campaign_id": self.campaign.id, "search": None, "status": None,
                  "overdue_only": False, "sort": "outstanding", "order": "desc", "page": 1, "page_size": 25,
                  "db": self.db, "actor": self.actor}
        params.update(overrides)
        return get_campaign_completion_status(**params)

    def row(self, result, name):
        return next(row for row in result["rows"] if row["evaluator_name"].startswith(name))


def test_progress_is_counted_per_evaluator(db):
    world = World(db)
    result = world.request()
    assert result["summary"]["total_evaluations"] == 5
    assert result["summary"]["completed"] == 2
    assert result["summary"]["in_progress"] == 1
    assert result["summary"]["not_started"] == 2
    assert result["summary"]["overdue"] == 3
    assert result["summary"]["completion_rate"] == 40
    assert result["summary"]["evaluators"] == 3
    assert result["summary"]["evaluators_done"] == 1
    anna = world.row(result, "Anna")
    assert (anna["total"], anna["completed"], anna["in_progress"], anna["not_started"], anna["outstanding"], anna["overdue"]) == (3, 1, 1, 1, 2, 2)
    assert anna["status_label"] == "In progress"
    assert world.row(result, "Bela")["status_label"] == "Completed"
    assert world.row(result, "Cecil")["status_label"] == "Not started"
    assert [row["evaluator_name"].split()[0] for row in result["rows"]] == ["Anna", "Cecil", "Bela"]


def test_who_evaluates_whom_is_never_returned(db):
    world = World(db)
    result = world.request()
    for row in result["rows"]:
        assert not any("evaluatee" in key for key in row)
        schemas.CompletionStatusRow.model_validate(row)
    text = str(result)
    assert "do not leak" not in text
    # Dora only appears as an evaluatee, so her name must not show up anywhere in the response.
    assert "Dora" not in text
    with pytest.raises(Exception):
        schemas.CompletionStatusRow.model_validate({**result["rows"][0], "evaluatee_name": "x"})


def test_search_filters_and_pagination(db):
    world = World(db)
    assert world.request(search="anna")["pagination"]["total_items"] == 1
    # Searching for someone who is only evaluated finds nothing: evaluatees are not searchable.
    assert world.request(search="dora")["pagination"]["total_items"] == 0
    assert [row["evaluator_name"].split()[0] for row in world.request(status="completed")["rows"]] == ["Bela"]
    assert {row["evaluator_name"].split()[0] for row in world.request(overdue_only=True)["rows"]} == {"Anna", "Cecil"}
    paged = world.request(sort="evaluator", order="asc", page_size=1, page=2)
    assert paged["pagination"] == {"page": 2, "page_size": 1, "total_items": 3, "total_pages": 3}
    assert paged["rows"][0]["evaluator_name"].startswith("Bela")


def test_evaluation_matrix_does_not_show_progress_per_pair(db):
    world = World(db)
    matrix = build_campaign_evaluation_matrix(world.campaign.id, db)
    assignments = [assignment for group in matrix["groups"] for assignment in group["assignments"]]
    assert assignments
    for assignment in assignments:
        assert set(assignment) == {"evaluator_id", "evaluatee_id", "form_id", "filled_form_id", "issued"}


def test_missing_campaign(db):
    world = World(db)
    with pytest.raises(HTTPException) as missing:
        world.request(campaign_id=999999999)
    assert missing.value.status_code == 404

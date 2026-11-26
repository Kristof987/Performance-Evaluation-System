from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from services import answers_service
import models
from services import reporting_service
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


PERMISSIONS = {"reports.read", "campaigns.manage"}


@pytest.fixture(autouse=True)
def permissions(monkeypatch):
    monkeypatch.setattr(reporting_service, "_has_permission", lambda _actor, _db, permission: permission in PERMISSIONS)


def add(db, item):
    db.add(item)
    db.flush()
    return item


class World:
    def __init__(self, db, names, status="closed"):
        self.db = db
        suffix = uuid4().hex[:8]
        role = add(db, models.CompanyRole(name=f"Role {suffix}"))
        system_role = db.query(models.SystemRole).first() or add(db, models.SystemRole(name=f"System {suffix}"))
        self.actor = add(db, models.User(username=f"hr-{suffix}", email=f"hr-{suffix}@example.com", password_hash="",
                                         system_role_id=system_role.id, is_active=True))
        self.done = db.query(models.FormStatus).filter_by(name="Completed").first() or add(db, models.FormStatus(name="Completed"))
        self.open = db.query(models.FormStatus).filter_by(name="Not started").first() or add(db, models.FormStatus(name="Not started"))
        self.section = add(db, models.Section(scope_key="default", name=f"Teamwork {suffix}", normalized_name=f"teamwork {suffix}"))
        self.form = add(db, models.Form(name=f"Peer form {suffix}", questions=[]))
        self.group = add(db, models.CompanyGroup(name=f"Group {suffix}"))
        self.people = []
        for index, name in enumerate(names):
            user = add(db, models.User(username=f"u{index}-{suffix}", email=f"u{index}-{suffix}@example.com", password_hash="",
                                       system_role_id=system_role.id, is_active=True))
            self.people.append(add(db, models.Employee(user_id=user.id, full_name=f"{name} {suffix}", company_role_id=role.id, is_active=True)))
        self.campaign = add(db, models.Campaign(name=f"Campaign {suffix}", status=status, is_active=status == "active",
                                                start_date=datetime(2090, 1, 1, tzinfo=timezone.utc), created_by=self.actor.id))
        db.execute(models.campaign_company_groups.insert().values(campaign_id=self.campaign.id, company_group_id=self.group.id))

    def snapshot(self):
        return {"schema_version": 2, "questions": [
            {"type": "section", "section_id": self.section.id, "section": {"id": self.section.id, "name": self.section.name},
             "questions": [{"id": "rating", "type": "Scale", "scale_min": 1, "scale_max": 5, "text": "Works well with others"},
                           {"id": "pick", "type": "Multiple choice", "text": "Strong areas",
                            "options": [{"id": "o1", "label": "Planning"}, {"id": "o2", "label": "Support"}, {"id": "o3", "label": "Focus"}]}]},
            {"type": "question", "question": {"id": "comment", "type": "Text", "text": "What should they keep doing?"}}]}

    def review(self, evaluator, rating=4, comment="Keeps the team calm.", *, submitted=True, picks=("o3", "o1")):
        answers = [{"question_id": "rating", "value": rating}, {"question_id": "pick", "value": list(picks)},
                   {"question_id": "comment", "value": comment}] if submitted else []
        return add(self.db, models.FilledForm(campaign_id=self.campaign.id, form_id=self.form.id, company_group_id=self.group.id,
                                              evaluator_id=evaluator.id, evaluatee_id=self.people[0].id,
                                              status_id=(self.done if submitted else self.open).id,
                                              finish_date=date(2090, 2, 1) if submitted else None,
                                              form_snapshot=self.snapshot(), answers=answers))


def test_index_counts_self_and_colleague_questionnaires(db):
    world = World(db, ["Anna", "Béla", "Cecil"])
    anna, bela, cecil = world.people
    world.review(anna)
    world.review(bela)
    world.review(cecil, submitted=False)
    index = answers_service.build_answers_index(world.campaign.id, world.actor, db)
    row = next(item for item in index["employees"] if item["employee_id"] == anna.id)
    assert row == {"employee_id": anna.id, "employee_name": anna.full_name, "self_assigned": True, "self_submitted": True,
                   "peer_assigned": 2, "peer_submitted": 1}
    assert index["min_peer_reviewers"] == 2


def test_colleague_answers_are_hidden_below_the_threshold(db):
    world = World(db, ["Anna", "Béla", "Cecil"])
    anna, bela, cecil = world.people
    world.review(anna, comment="I plan well.")
    world.review(bela)
    world.review(cecil, submitted=False)
    result = answers_service.build_employee_answers(world.campaign.id, anna.id, world.actor, db)
    assert result["peer_availability"] == "suppressed"
    assert [item["kind"] for item in result["questionnaires"]] == ["self"]
    assert result["questionnaires"][0]["sections"][-1]["answers"][0]["text_answer"] == "I plan well."


def test_released_questionnaires_are_whole_and_carry_no_reviewer_identity(db):
    world = World(db, ["Anna", "Béla", "Cecil"])
    anna, bela, cecil = world.people
    world.review(bela, 5, "Always helps.")
    world.review(cecil, 3, "Could share more.")
    result = answers_service.build_employee_answers(world.campaign.id, anna.id, world.actor, db)
    assert result["peer_availability"] == "available"
    peers = result["questionnaires"]
    assert [item["label"] for item in peers] == ["Evaluator 1", "Evaluator 2"]
    pairs = {(item["sections"][0]["answers"][0]["rating"], item["sections"][1]["answers"][0]["text_answer"]) for item in peers}
    assert pairs == {(5, "Always helps."), (3, "Could share more.")}
    section, other = peers[0]["sections"]
    assert section["section_name"] == world.section.name and other["section_name"] == "Other questions"
    assert section["answers"][1]["choices"] == ["Planning", "Focus"]
    serialized = repr(result)
    for person in (bela, cecil):
        assert person.full_name not in serialized
    assert "2090" not in serialized


def test_unanswered_questions_are_marked(db):
    world = World(db, ["Anna", "Béla", "Cecil"])
    anna, bela, cecil = world.people
    world.review(bela, rating=9, comment="  ")
    world.review(cecil)
    result = answers_service.build_employee_answers(world.campaign.id, anna.id, world.actor, db)
    flat = [answer for item in result["questionnaires"] for section in item["sections"] for answer in section["answers"]]
    assert sum(not answer["answered"] for answer in flat) == 2


def test_requires_campaign_management_and_an_issued_campaign(db, monkeypatch):
    world = World(db, ["Anna", "Béla"], status="draft")
    with pytest.raises(HTTPException) as draft:
        answers_service.build_answers_index(world.campaign.id, world.actor, db)
    assert draft.value.status_code == 409
    world.campaign.status = "active"
    db.flush()
    assert answers_service.build_answers_index(world.campaign.id, world.actor, db)["employees"] == []
    monkeypatch.setattr(reporting_service, "_has_permission", lambda _a, _d, permission: permission == "reports.read")
    with pytest.raises(HTTPException) as denied:
        answers_service.build_employee_answers(world.campaign.id, world.people[0].id, world.actor, db)
    assert denied.value.status_code == 403


def test_unknown_employee_is_not_found(db):
    world = World(db, ["Anna"])
    outsider = World(db, ["Zoe"]).people[0]
    with pytest.raises(HTTPException) as missing:
        answers_service.build_employee_answers(world.campaign.id, outsider.id, world.actor, db)
    assert missing.value.status_code == 404


def test_rating_carries_its_value_label(db):
    world = World(db, ["Anna", "Béla", "Cecil"])
    anna, bela, cecil = world.people
    labelled = world.snapshot()
    labelled["questions"][0]["questions"][0]["scale_labels"] = ["Never", "Rarely", "Sometimes", "Often", "Always"]
    for reviewer in (bela, cecil):
        world.review(reviewer, 4).form_snapshot = labelled
    db.flush()
    result = answers_service.build_employee_answers(world.campaign.id, anna.id, world.actor, db)
    assert {item["sections"][0]["answers"][0]["rating_label"] for item in result["questionnaires"]} == {"Often"}

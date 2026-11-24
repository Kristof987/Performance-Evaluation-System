"""Filling in an assigned questionnaire: drafts, submission, validation, availability and the issued snapshot."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

import models
import schemas
from database import SessionLocal
from api.evaluations import get_assigned_questionnaire, update_assigned_questionnaire
from services.campaign_service import issue_activation_snapshots


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


def status(db, name):
    return db.query(models.FormStatus).filter_by(name=name).first() or add(db, models.FormStatus(name=name))


class World:
    def __init__(self, db):
        self.db = db
        suffix = uuid4().hex[:8]
        role = add(db, models.CompanyRole(name=f"Role {suffix}"))
        system_role = db.query(models.SystemRole).first() or add(db, models.SystemRole(name=f"System {suffix}"))
        self.form = add(db, models.Form(name=f"Questionnaire {suffix}", questions=[
            {"id": "required", "text": "Feedback", "type": "Text", "required": True},
            {"id": "score", "text": "Original rating", "type": "Numerical scale", "scale_min": 1, "scale_max": 5, "required": False},
        ]))
        status(db, "Not started")
        self.users, self.people = [], []
        for index in range(2):
            user = add(db, models.User(username=f"q{index}-{suffix}", email=f"q{index}-{suffix}@example.com",
                                       password_hash="", system_role_id=system_role.id, is_active=True))
            self.users.append(user)
            self.people.append(add(db, models.Employee(user_id=user.id, full_name=f"Person {index} {suffix}",
                                                       company_role_id=role.id, is_active=True)))
        now = datetime.now(timezone.utc)
        self.campaign = add(db, models.Campaign(name=f"Campaign {suffix}", status="active", is_active=True,
                                                start_date=now - timedelta(days=1), end_date=now + timedelta(days=2),
                                                created_by=self.users[0].id))
        self.filled = add(db, models.FilledForm(campaign_id=self.campaign.id, evaluator_id=self.people[0].id,
                                                evaluatee_id=self.people[1].id, form_id=self.form.id,
                                                status_id=status(db, "Not started").id, answers=[]))
        assert issue_activation_snapshots(self.campaign, db) == []
        db.flush()

    def get(self, index=0):
        return get_assigned_questionnaire(self.users[index].id, self.filled.id, self.db,
                                          actor=self.users[index], employee=self.people[index])

    def save(self, answers, submit=False):
        return update_assigned_questionnaire(self.users[0].id, self.filled.id,
                                             schemas.AssignedQuestionnaireUpdate(answers=answers, submit=submit), self.db,
                                             actor=self.users[0], employee=self.people[0])


def expect(status_code, call, *args, **kwargs):
    with pytest.raises(HTTPException) as error:
        call(*args, **kwargs)
    assert error.value.status_code == status_code


def test_draft_then_submission_locks_the_questionnaire(db):
    world = World(db)
    world.save([{"question_id": "score", "value": 4}])
    assert world.get()["answers"] == [{"question_id": "score", "value": 4}]
    assert db.get(models.FormStatus, world.filled.status_id).name == "In progress"
    # A required question is still unanswered.
    expect(400, world.save, [{"question_id": "score", "value": 4}], submit=True)
    response = world.save([{"question_id": "required", "value": "Good work"}], submit=True)
    assert response["evaluation"]["finish_date"] is not None
    with pytest.raises(HTTPException) as locked:
        world.save([{"question_id": "required", "value": "Change"}])
    assert locked.value.status_code in {403, 409}


def test_rejects_other_people_and_invalid_answers(db):
    world = World(db)
    expect(404, world.get, 1)
    for answer in ({"question_id": "missing", "value": "x"}, {"question_id": "score", "value": 9},
                   {"question_id": "required", "value": "   "}):
        expect(400, world.save, [answer])


@pytest.mark.parametrize("change", ["paused", "draft", "review", "archived", "not_started_yet", "deadline_passed"])
def test_only_available_while_the_campaign_runs(db, change):
    world = World(db)
    if change == "archived":
        world.campaign.is_archived = True
    elif change == "not_started_yet":
        world.campaign.start_date = datetime.now(timezone.utc) + timedelta(days=1)
    elif change == "deadline_passed":
        world.campaign.end_date = datetime.now(timezone.utc) - timedelta(minutes=1)
    else:
        world.campaign.status = change
    db.flush()
    with pytest.raises(HTTPException) as error:
        world.save([])
    assert error.value.status_code in {403, 404}


def test_review_keeps_submitted_answers_readable_and_hides_unfinished_ones(db):
    world = World(db)
    world.save([{"question_id": "required", "value": "Fine"}], submit=True)
    world.campaign.status = "review"
    db.flush()
    evaluation = world.get()["evaluation"]
    assert evaluation["finish_date"] is not None and evaluation["can_edit"] is False

    unfinished = World(db)
    unfinished.campaign.status = "review"
    db.flush()
    expect(404, unfinished.get)


def test_issued_snapshot_survives_later_form_edits(db):
    world = World(db)
    assert world.filled.form_snapshot["questions"][1]["text"] == "Original rating"
    world.form.questions = [{"id": "score", "text": "Changed rating", "type": "Numerical scale", "scale_min": 1, "scale_max": 10}]
    db.flush()
    questions = world.get()["questions"]
    assert [question["text"] for question in questions] == ["Feedback", "Original rating"]
    # Validation follows the issued 1-5 scale, not the edited 1-10 one.
    expect(400, world.save, [{"question_id": "score", "value": 8}])
    world.save([{"question_id": "required", "value": "Fine"}, {"question_id": "score", "value": 5}], submit=True)

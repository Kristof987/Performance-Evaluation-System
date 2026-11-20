from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

import campaign_reminder_service as reminders
import email_service
import models
from database import SessionLocal


@pytest.fixture
def db(monkeypatch):
    session = SessionLocal()
    session.commit = session.flush
    sent: list[tuple[str, str, str, str]] = []
    monkeypatch.setenv("SMTP_HOST", "mailpit")
    monkeypatch.setattr(email_service, "send", lambda *message: sent.append(message))
    session.sent = sent
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def person(db, name="Peter Example"):
    suffix = uuid4().hex
    role = db.query(models.SystemRole).first()
    user = models.User(username=suffix, email=f"{suffix}@example.com", password_hash="", system_role_id=role.id, is_active=True)
    company_role = models.CompanyRole(name=f"Role {suffix}")
    db.add_all([user, company_role])
    db.flush()
    employee = models.Employee(user_id=user.id, full_name=name, company_role_id=company_role.id, is_active=True)
    db.add(employee)
    db.flush()
    return employee


def campaign_with_open_evaluations(db, *, end_in_days=10, started_days_ago=5):
    now = datetime.now(timezone.utc)
    evaluator, evaluatee = person(db), person(db, "Anna Example")
    campaign = models.Campaign(name=f"Q4 {uuid4().hex[:6]}", start_date=now - timedelta(days=started_days_ago),
                               end_date=now + timedelta(days=end_in_days), status="active", created_by=evaluator.user_id)
    db.add(campaign)
    db.flush()
    status = db.query(models.FormStatus).filter(models.FormStatus.name == "Not started").first()
    if status is None:
        status = models.FormStatus(name="Not started")
        db.add(status)
        db.flush()
    for target in (evaluatee, evaluator):
        db.add(models.FilledForm(campaign_id=campaign.id, evaluator_id=evaluator.id, evaluatee_id=target.id,
                                 status_id=status.id, answers=[], form_snapshot={"schema_version": 2, "questions": []}))
    db.flush()
    return campaign, evaluator


def test_templates_render_in_english_and_escape_html():
    subject, text, html = email_service.render("campaign_reminder", {
        "first_name": "<Peter>", "campaign_name": "Q4 & review", "open_count": 2, "evaluation_word": "evaluations",
        "deadline": "15 December 2026, 17:00", "time_left": "3 days left", "link": "http://localhost:5173/evaluations",
        "sender_name": "Mirra"})
    assert subject == "Reminder: 2 evaluations left in Q4 & review"
    assert "Hi <Peter>," in text and "3 days left" in text
    assert "&lt;Peter&gt;" in html and "Q4 &amp; review" in html and "<Peter>" not in html
    launch_subject, _text, _html = email_service.render("campaign_launch", {
        "first_name": "Anna", "campaign_name": "Q4", "open_count": 1, "evaluation_word": "evaluation",
        "deadline": "1 December 2026, 17:00", "time_left": "", "link": "x", "sender_name": "Mirra"})
    assert launch_subject == "Q4: your evaluations are open"


def test_launch_email_goes_out_once(db):
    campaign, evaluator = campaign_with_open_evaluations(db)
    reminders.send_due_emails(db)
    reminders.send_due_emails(db)
    mine = [message for message in db.sent if message[0] == db.get(models.User, evaluator.user_id).email]
    assert len(mine) == 1 and mine[0][1] == f"{campaign.name}: your evaluations are open"
    assert "2 evaluations" in mine[0][2]


def test_only_latest_due_reminder_is_sent(db):
    campaign, evaluator = campaign_with_open_evaluations(db, end_in_days=2)
    campaign.launch_email_enabled = False
    campaign.custom_reminders = True
    for days in (7, 3, 1):
        db.add(models.CampaignReminder(campaign_id=campaign.id, days_before_end=days))
    db.flush()
    reminders.send_due_emails(db)
    reminders.send_due_emails(db)
    sent = db.query(models.EmailDelivery).filter_by(campaign_id=campaign.id, employee_id=evaluator.id).all()
    # 7 and 3 days before the end are both due, but only the closer one (3) is sent; 1 day is not due yet.
    assert [(item.kind, item.reminder_days) for item in sent] == [("reminder", 3)]
    assert "2 days left" in db.sent[-1][2]


def test_reminder_before_campaign_start_is_skipped(db):
    campaign, _evaluator = campaign_with_open_evaluations(db, end_in_days=2, started_days_ago=1)
    campaign.launch_email_enabled = False
    campaign.custom_reminders = True
    db.add(models.CampaignReminder(campaign_id=campaign.id, days_before_end=5))
    db.flush()
    reminders.send_due_emails(db)
    assert db.sent == []


def test_manual_reminder_has_a_cooldown_and_needs_active_campaign(db):
    campaign, evaluator = campaign_with_open_evaluations(db)
    actor = db.get(models.User, evaluator.user_id)
    assert reminders.send_manual(campaign, actor, None, db) == {"sent": 1, "failed": 0, "skipped_recently_reminded": 0}
    assert reminders.send_manual(campaign, actor, None, db) == {"sent": 0, "failed": 0, "skipped_recently_reminded": 1}
    campaign.status = "closed"
    with pytest.raises(HTTPException) as error:
        reminders.send_manual(campaign, actor, None, db)
    assert error.value.status_code == 409


def test_nothing_is_claimed_without_smtp(db, monkeypatch):
    campaign, _evaluator = campaign_with_open_evaluations(db)
    monkeypatch.delenv("SMTP_HOST")
    with pytest.raises(HTTPException) as error:
        reminders.send_manual(campaign, db.query(models.User).first(), None, db)
    assert error.value.status_code == 503


def set_defaults(db, days, launch=True):
    import workspace_settings_service

    row = workspace_settings_service._locked_row(db)
    row.default_reminder_days, row.default_launch_email = days, launch
    db.flush()


def test_workspace_defaults_apply_until_a_campaign_customizes(db):
    set_defaults(db, [5, 3])
    campaign, evaluator = campaign_with_open_evaluations(db, end_in_days=4)
    campaign.launch_email_enabled = False
    assert reminders.effective_reminders(campaign, db) == [(5, None), (3, None)]
    reminders.send_due_emails(db)
    assert [item.reminder_days for item in db.query(models.EmailDelivery).filter_by(campaign_id=campaign.id)] == [5]

    # The first own change copies the defaults; a reminder that already went out is not sent again.
    reminders.customize_reminders(campaign, db.get(models.User, evaluator.user_id), db)
    assert [days for days, _id in reminders.effective_reminders(campaign, db)] == [5, 3]
    set_defaults(db, [1])
    assert [days for days, _id in reminders.effective_reminders(campaign, db)] == [5, 3]
    reminders.send_due_emails(db)
    assert len(db.sent) == 1


def test_recipient_list_and_selected_manual_send(db):
    campaign, evaluator = campaign_with_open_evaluations(db)
    other = person(db, "Zoe Other")
    status = db.query(models.FormStatus).filter(models.FormStatus.name == "Not started").first()
    db.add(models.FilledForm(campaign_id=campaign.id, evaluator_id=other.id, evaluatee_id=evaluator.id, status_id=status.id,
                             answers=[], form_snapshot={"schema_version": 2, "questions": []}))
    db.flush()
    listed = reminders.recipient_list(campaign, db)
    assert [(item["employee_id"], item["not_started"]) for item in listed] == [(evaluator.id, 2), (other.id, 1)]
    actor = db.get(models.User, evaluator.user_id)
    assert reminders.send_manual(campaign, actor, [other.id], db)["sent"] == 1
    assert [message[0] for message in db.sent] == [db.get(models.User, other.user_id).email]
    assert {item["employee_id"]: item["recently_reminded"] for item in reminders.recipient_list(campaign, db)} == {
        evaluator.id: False, other.id: True}

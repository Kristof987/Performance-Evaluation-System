from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from integrations import auth0_management as service
import models
import schemas
from database import SessionLocal
from main import app
from api.people import create_people_employee, resend_employee_invitation, update_people_employee
from services.account_service import record_sign_in, sign_in_status


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
def configured(monkeypatch):
    monkeypatch.setenv("AUTH0_DOMAIN", "tenant.example.com")
    monkeypatch.setenv("AUTH0_CLIENT_ID", "client-test")
    monkeypatch.setenv("AUTH0_DB_CONNECTION", "Username-Password-Authentication")


@pytest.fixture
def not_configured(monkeypatch):
    for key in ("AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_DB_CONNECTION"):
        monkeypatch.delenv(key, raising=False)


def make_user(db, email=None):
    suffix = uuid4().hex
    role = db.query(models.SystemRole).filter(models.SystemRole.name == "Employee").first()
    if role is None:
        role = models.SystemRole(name="Employee")
        db.add(role)
        db.flush()
    company_role = models.CompanyRole(name=f"Engineer {suffix}")
    db.add(company_role)
    db.flush()
    user = models.User(username=f"user-{suffix}", email=email or f"{suffix}@example.com", password_hash="",
                       system_role_id=role.id, is_active=True)
    db.add(user)
    db.flush()
    db.add(models.Employee(user_id=user.id, full_name=f"Anna {suffix}", company_role_id=company_role.id, is_active=True))
    db.flush()
    db.refresh(user)
    return user


def response(status, body=None):
    return httpx.Response(status, json=body if body is not None else {})


def test_invitation_creates_links_and_emails(db, configured):
    user, actor = make_user(db), make_user(db)
    with patch.object(service.httpx.Client, "post", return_value=response(200, {"_id": "abc123"})) as signup, \
            patch.object(service.httpx.Client, "request", return_value=response(200)) as email:
        service.invite_user(user, actor, db)
    assert (user.invitation_status, user.invitation_error) == ("sent", None)
    assert user.auth0_user_id == "auth0|abc123"
    assert user.invitation_sent_at is not None
    assert email.call_args.kwargs["json"]["email"] == user.email
    password = signup.call_args.kwargs["json"]["password"]
    assert len(password) >= 40 and any(c.isupper() for c in password) and any(c.isdigit() for c in password)
    stored = [str(value) for value in (user.password_hash, user.invitation_error, user.auth0_user_id)]
    events = db.query(models.SettingsAuditEvent).filter(models.SettingsAuditEvent.actor_user_id == actor.id).all()
    assert [event.category for event in events] == ["accounts"]
    assert all(password not in text for text in stored + [events[0].summary, str(events[0].details)])


def test_generated_passwords_are_random():
    assert service._generated_password() != service._generated_password()


def test_existing_auth0_account_fails_without_email(db, configured):
    user, actor = make_user(db), make_user(db)
    with patch.object(service.httpx.Client, "post", return_value=response(400, {"code": "invalid_signup"})), \
            patch.object(service.httpx.Client, "request") as email:
        service.invite_user(user, actor, db)
    assert (user.invitation_status, user.invitation_error, user.auth0_user_id) == ("failed", "account_exists", None)
    email.assert_not_called()


def test_password_policy_rejection_is_retried_once(db, configured):
    user, actor = make_user(db), make_user(db)
    replies = [response(400, {"code": "invalid_password"}), response(200, {"_id": "retry"})]
    with patch.object(service.httpx.Client, "post", side_effect=replies) as signup, \
            patch.object(service.httpx.Client, "request", return_value=response(200)):
        service.invite_user(user, actor, db)
    assert signup.call_count == 2
    assert user.invitation_status == "sent"


def test_timeout_is_stored_as_generic_failure(db, configured):
    user, actor = make_user(db), make_user(db)
    with patch.object(service.httpx.Client, "post", side_effect=httpx.ConnectTimeout("secret detail")):
        service.invite_user(user, actor, db)
    assert (user.invitation_status, user.invitation_error) == ("failed", "provider_unavailable")


def test_email_failure_keeps_link_and_resend_only_emails(db, configured):
    user, actor = make_user(db), make_user(db)
    with patch.object(service.httpx.Client, "post", return_value=response(200, {"_id": "kept"})), \
            patch.object(service.httpx.Client, "request", return_value=response(500)):
        service.invite_user(user, actor, db)
    assert (user.invitation_status, user.invitation_error, user.auth0_user_id) == ("failed", "email_failed", "auth0|kept")
    with patch.object(service.httpx.Client, "post") as signup, \
            patch.object(service.httpx.Client, "request", return_value=response(200)):
        service.invite_user(user, actor, db)
    signup.assert_not_called()
    assert user.invitation_status == "sent"


def test_not_configured_skips_auth0(db, not_configured):
    user, actor = make_user(db), make_user(db)
    with patch.object(service.httpx.Client, "post") as signup:
        service.invite_user(user, actor, db)
    signup.assert_not_called()
    assert (user.invitation_status, user.invitation_error) == ("not_sent", "not_configured")


def test_resend_cooldown(db, configured):
    user, actor = make_user(db), make_user(db)
    user.auth0_user_id, user.invitation_status = f"auth0|{uuid4().hex}", "sent"
    user.invitation_sent_at = datetime.now(timezone.utc)
    db.flush()
    with pytest.raises(HTTPException) as error:
        service.invite_user(user, actor, db, enforce_cooldown=True)
    assert error.value.status_code == 429
    user.invitation_sent_at = datetime.now(timezone.utc) - timedelta(seconds=61)
    db.flush()
    with patch.object(service.httpx.Client, "request", return_value=response(200)):
        service.invite_user(user, actor, db, enforce_cooldown=True)
    assert user.invitation_status == "sent"


def test_resend_endpoint_requires_configuration(db, not_configured):
    user, actor = make_user(db), make_user(db)
    with pytest.raises(HTTPException) as error:
        resend_employee_invitation(user.employee.id, db=db, actor=actor)
    assert error.value.status_code == 503
    with pytest.raises(HTTPException) as missing:
        resend_employee_invitation(10**9, db=db, actor=actor)
    assert missing.value.status_code == 404


def test_create_employee_invites_and_rejects_case_duplicates(db, configured):
    actor = make_user(db)
    email = f"New.{uuid4().hex}@Example.com"
    payload = schemas.PeopleEmployeeCreate(name="Kiss  Anna", email=email, role="Engineer", group_ids=[])
    with patch.object(service.httpx.Client, "post", return_value=response(200, {"_id": "new"})), \
            patch.object(service.httpx.Client, "request", return_value=response(200)):
        created = create_people_employee(payload, db=db, actor=actor, _group_manager=actor)
    assert created["email"] == email.lower()
    assert created["sign_in_status"] == "invited"
    duplicate = schemas.PeopleEmployeeCreate(name="Other", email=email.upper(), role="Engineer", group_ids=[])
    with pytest.raises(HTTPException) as error:
        create_people_employee(duplicate, db=db, actor=actor, _group_manager=actor)
    assert error.value.status_code == 409


def test_linked_email_cannot_change(db):
    user, actor = make_user(db), make_user(db)
    user.auth0_user_id = f"auth0|{uuid4().hex}"
    db.flush()
    role = db.get(models.CompanyRole, user.employee.company_role_id)
    update = schemas.PeopleEmployeeUpdate(name=user.employee.full_name, email=f"changed-{uuid4().hex}@example.com",
                                          role=role.name, group_ids=[])
    with pytest.raises(HTTPException) as error:
        update_people_employee(user.employee.id, update, db=db, _employee_manager=actor, _group_manager=actor)
    assert error.value.status_code == 409
    same = schemas.PeopleEmployeeUpdate(name="Renamed", email=user.email.upper(), role=role.name, group_ids=[])
    assert update_people_employee(user.employee.id, same, db=db, _employee_manager=actor,
                                  _group_manager=actor)["full_name"] == "Renamed"


def test_sign_in_status_and_sign_in_recording(db):
    user = make_user(db)
    assert sign_in_status(user) == "not_invited"
    user.invitation_status = "failed"
    assert sign_in_status(user) == "failed"
    user.invitation_status = "sent"
    assert sign_in_status(user) == "invited"
    user.auth0_user_id = f"auth0|{uuid4().hex}"
    record_sign_in(user, db)
    assert user.last_login is not None and sign_in_status(user) == "active"
    first = user.last_login
    record_sign_in(user, db)
    assert user.last_login == first  # Not rewritten within five minutes.


def test_invitation_route_requires_authentication():
    client = TestClient(app)
    assert client.post("/people/employees/1/invitation").status_code == 401
    client.close()

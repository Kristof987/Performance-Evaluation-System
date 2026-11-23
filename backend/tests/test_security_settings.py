from unittest.mock import patch
from uuid import uuid4
from datetime import timedelta

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from integrations import auth0_management as service
from main import app
from api.me import get_my_security
import models
from database import SessionLocal


@pytest.fixture(autouse=True)
def auth0_config(monkeypatch):
    for key in ("AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_DB_CONNECTION"):
        monkeypatch.delenv(key, raising=False)
    yield


@pytest.fixture
def reset_account():
    db = SessionLocal()
    db.commit = db.flush
    models.PasswordResetRequest.__table__.create(bind=db.connection(), checkfirst=True)
    role = models.SystemRole(name=f"Reset-{uuid4().hex}")
    db.add(role)
    db.flush()
    user = models.User(username=f"reset-{uuid4().hex}", email=f"{uuid4().hex}@example.com",
                       password_hash="test-only", system_role_id=role.id,
                       is_active=True, auth0_user_id=f"auth0|{uuid4().hex}")
    db.add(user)
    db.flush()
    try:
        yield user, db
    finally:
        db.rollback()
        db.close()


def database_config(monkeypatch):
    monkeypatch.setenv("AUTH0_DOMAIN", "settings.example.com")
    monkeypatch.setenv("AUTH0_CLIENT_ID", "test-client")
    monkeypatch.setenv("AUTH0_DB_CONNECTION", "test-database")


def test_not_configured_hides_controls():
    user = models.User(id=1, auth0_user_id="auth0|test", email="test@example.com")
    with patch.object(service.httpx.Client, "request") as request:
        result = get_my_security(user)
    assert result["password_reset_available"] is False
    request.assert_not_called()


def test_reset_requires_configuration():
    with pytest.raises(HTTPException) as error:
        service.send_password_reset(1, "auth0|test", "test@example.com", None)
    assert error.value.status_code == 503


def test_reset_success_and_rate_limit(monkeypatch, reset_account):
    database_config(monkeypatch)
    user, db = reset_account
    with patch.object(service.httpx.Client, "request", return_value=httpx.Response(200)) as request:
        service.send_password_reset(user.id, user.auth0_user_id, user.email, db)
        with pytest.raises(HTTPException) as error:
            service.send_password_reset(user.id, user.auth0_user_id, user.email, db)
    assert error.value.status_code == 429
    assert request.call_count == 1
    assert request.call_args.kwargs["json"]["connection"] == "test-database"


def test_provider_error_is_not_exposed(monkeypatch, reset_account):
    database_config(monkeypatch)
    user, db = reset_account
    with patch.object(service.httpx.Client, "request", return_value=httpx.Response(400, text="private-provider-data")):
        with pytest.raises(HTTPException) as error:
            service.send_password_reset(user.id, user.auth0_user_id, user.email, db)
    assert error.value.status_code == 502
    assert "private-provider-data" not in str(error.value.detail)


def test_social_and_development_cannot_reset(monkeypatch):
    database_config(monkeypatch)
    with patch.object(service.httpx.Client, "request") as request:
        for subject in (None, "google-oauth2|test"):
            with pytest.raises(HTTPException) as error:
                service.send_password_reset(1, subject, "test@example.com", None)
            assert error.value.status_code == 409
    request.assert_not_called()


def test_reset_cooldown_expires(monkeypatch, reset_account):
    database_config(monkeypatch)
    user, db = reset_account
    with patch.object(service.httpx.Client, "request", return_value=httpx.Response(200)) as request:
        service.send_password_reset(user.id, user.auth0_user_id, user.email, db)
        stored = db.get(models.PasswordResetRequest, user.id)
        stored.requested_at -= timedelta(seconds=61)
        db.flush()
        service.send_password_reset(user.id, user.auth0_user_id, user.email, db)
    assert request.call_count == 2


def test_auth0_timeout_is_generic(monkeypatch, reset_account):
    database_config(monkeypatch)
    user, db = reset_account
    with patch.object(service.httpx.Client, "request", side_effect=httpx.ReadTimeout("private endpoint details")):
        with pytest.raises(HTTPException) as error:
            service.send_password_reset(user.id, user.auth0_user_id, user.email, db)
    assert error.value.status_code == 502
    assert "private" not in error.value.detail


def test_security_routes_require_authentication():
    client = TestClient(app)
    assert client.get("/me/security").status_code == 401
    assert client.post("/me/security/password-reset").status_code == 401
    client.close()

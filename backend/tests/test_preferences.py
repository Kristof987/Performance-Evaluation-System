from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import models
from database import SessionLocal
from api.dependencies import get_current_user, get_db
from main import app


@pytest.fixture
def account():
    db = SessionLocal()
    db.commit = db.flush
    # PostgreSQL DDL stays inside this test's rollback, including on unmigrated test databases.
    models.UserPreferences.__table__.create(bind=db.connection(), checkfirst=True)
    role = models.SystemRole(name=f"Preferences-{uuid4().hex}")
    db.add(role)
    db.flush()
    user = models.User(username=f"prefs-{uuid4().hex}", email=f"{uuid4().hex}@example.com",
                       password_hash="test-only", system_role_id=role.id, is_active=True)
    db.add(user)
    for name in ("settings.read", "settings.manage_self"):
        permission = db.query(models.SystemPermission).filter_by(name=name).first()
        if permission is None:
            permission = models.SystemPermission(name=name)
            db.add(permission)
            db.flush()
        db.execute(models.system_role_permissions.insert().values(
            system_role_id=role.id, permission_id=permission.id,
        ))
    db.flush()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    try:
        yield user, db, client
    finally:
        app.dependency_overrides.clear()
        client.close()
        db.rollback()
        db.close()


def test_defaults_and_partial_persistence(account):
    user, db, client = account
    defaults = client.get("/me/preferences")
    assert defaults.status_code == 200
    assert defaults.json()["theme"] == "system"
    assert db.get(models.UserPreferences, user.id) is None
    saved = client.patch("/me/preferences", json={"theme": "dark"})
    assert saved.status_code == 200
    assert saved.json()["theme"] == "dark"
    assert set(saved.json()) == {"theme", "language", "date_format", "updated_at"}
    assert saved.json()["updated_at"] is not None
    assert client.patch("/me/preferences", json={"date_format": "iso"}).status_code == 200
    stored = client.get("/me/preferences").json()
    assert (stored["theme"], stored["date_format"]) == ("dark", "iso")


@pytest.mark.parametrize("changes", [
    {"theme": "invalid"}, {"reminder_days_before_deadline": 3}, {"notify_deadline_reminder": True},
    {"theme": None}, {"user_id": 7}, {"notify_new_assignment": False},
])
def test_invalid_and_unknown_fields_rejected(account, changes):
    assert account[2].patch("/me/preferences", json=changes).status_code == 422


def test_patch_requires_manage_self(account):
    user, db, client = account
    permission = db.query(models.SystemPermission).filter_by(name="settings.manage_self").one()
    db.execute(models.system_role_permissions.delete().where(
        models.system_role_permissions.c.system_role_id == user.system_role_id,
        models.system_role_permissions.c.permission_id == permission.id,
    ))
    db.flush()
    assert client.get("/me/preferences").status_code == 200
    assert client.patch("/me/preferences", json={"theme": "dark"}).status_code == 403

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from services import ai_generation_service
import models
from services import reporting_service
import schemas
from services import workspace_settings_service as service
from services.ai_workflow_service import capabilities
from database import SessionLocal
from main import app, require_permission


@pytest.fixture
def db():
    session = SessionLocal()
    session.commit = session.flush
    # Each test starts from "no workspace row", i.e. the defaults.
    session.query(models.WorkspaceSettings).delete()
    session.flush()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def permission(db, name):
    found = db.query(models.SystemPermission).filter(models.SystemPermission.name == name).first()
    if found is None:
        found = models.SystemPermission(name=name)
        db.add(found)
        db.flush()
    return found


def make_user(db, *permissions):
    suffix = uuid4().hex
    role = models.SystemRole(name=f"Role {suffix}")
    db.add(role)
    db.flush()
    for name in permissions:
        db.execute(models.system_role_permissions.insert().values(system_role_id=role.id,
                                                                  permission_id=permission(db, name).id))
    user = models.User(username=f"user-{suffix}", email=f"{suffix}@example.com", password_hash="test-only",
                       system_role_id=role.id, is_active=True)
    db.add(user)
    db.flush()
    return user


def granted(db, role_id):
    return {name for (name,) in db.query(models.SystemPermission.name).join(
        models.system_role_permissions,
        models.system_role_permissions.c.permission_id == models.SystemPermission.id,
    ).filter(models.system_role_permissions.c.system_role_id == role_id)}


def test_defaults_without_a_settings_row(db):
    settings = service.get_settings(db)
    assert (settings.min_individual_peer_reviewers, settings.min_aggregate_evaluatees) == (2, 2)
    assert settings.ai_enabled is True and settings.ai_model is None


def test_update_is_partial_and_audited(db):
    admin = make_user(db, "workspace.manage")
    service.update_settings(admin, schemas.WorkspaceSettingsUpdate(min_individual_peer_reviewers=3), db)
    service.update_settings(admin, schemas.WorkspaceSettingsUpdate(ai_enabled=False, ai_model=" gpt-test "), db)
    settings = service.get_settings(db)
    assert settings.min_individual_peer_reviewers == 3
    assert settings.min_aggregate_evaluatees == 2
    assert settings.ai_enabled is False and settings.ai_model == "gpt-test"
    events = db.query(models.SettingsAuditEvent).filter(models.SettingsAuditEvent.actor_user_id == admin.id) \
        .order_by(models.SettingsAuditEvent.id).all()
    assert [event.category for event in events] == ["privacy", "ai"]
    assert events[0].details == {"min_individual_peer_reviewers": {"from": 2, "to": 3}}


@pytest.mark.parametrize("payload", [
    {"min_individual_peer_reviewers": 1},
    {"min_aggregate_evaluatees": 21},
    {"ai_model": "bad model name"},
    {"unknown": True},
])
def test_invalid_updates_are_rejected(payload):
    with pytest.raises(ValidationError):
        schemas.WorkspaceSettingsUpdate.model_validate(payload)


def test_report_access_loads_privacy_thresholds(db):
    admin = make_user(db, "workspace.manage")
    reader = make_user(db, "reports.read")
    service.update_settings(admin, schemas.WorkspaceSettingsUpdate(
        min_individual_peer_reviewers=4, min_aggregate_evaluatees=5), db)
    reporting_service.require_reports_access(None, reader, db)
    assert reporting_service.min_individual_peer_reviewers() == 4
    assert reporting_service.min_aggregate_evaluatees() == 5


def test_permission_matrix_update_and_audit(db):
    admin = make_user(db, "permissions.manage", "settings.read")
    other = make_user(db, "reports.read")
    service.update_permission_matrix(admin, schemas.PermissionMatrixUpdate(roles=[
        schemas.PermissionMatrixRoleUpdate(role_id=other.system_role_id, permissions=["audit.read"]),
    ]), db)
    assert granted(db, other.system_role_id) == {"audit.read"}
    assert granted(db, admin.system_role_id) == {"permissions.manage", "settings.read"}
    event = db.query(models.SettingsAuditEvent).filter(models.SettingsAuditEvent.actor_user_id == admin.id).one()
    assert event.category == "permissions"
    assert event.details["changes"][0]["added"] == ["audit.read"]
    assert event.details["changes"][0]["removed"] == ["reports.read"]


@pytest.mark.parametrize("remaining", [["settings.read"], ["permissions.manage"]])
def test_permission_matrix_prevents_self_lockout(db, remaining):
    admin = make_user(db, "permissions.manage", "settings.read")
    with pytest.raises(HTTPException) as error:
        service.update_permission_matrix(admin, schemas.PermissionMatrixUpdate(roles=[
            schemas.PermissionMatrixRoleUpdate(role_id=admin.system_role_id, permissions=remaining),
        ]), db)
    assert error.value.status_code == 409


def test_permission_matrix_rejects_unknown_names(db):
    admin = make_user(db, "permissions.manage", "settings.read")
    with pytest.raises(HTTPException) as error:
        service.update_permission_matrix(admin, schemas.PermissionMatrixUpdate(roles=[
            schemas.PermissionMatrixRoleUpdate(role_id=admin.system_role_id,
                                               permissions=["permissions.manage", "settings.read", "made.up"]),
        ]), db)
    assert error.value.status_code == 400


def test_require_permission_accepts_any_listed_permission(db):
    user = make_user(db, "workspace.manage")
    assert require_permission("permissions.manage", "workspace.manage")(user=user, db=db) is user
    with pytest.raises(HTTPException) as error:
        require_permission("permissions.manage")(user=user, db=db)
    assert error.value.status_code == 403


def test_audit_log_merges_sources_and_paginates(db):
    admin = make_user(db, "workspace.manage", "audit.read")
    start = datetime.now(timezone.utc) + timedelta(days=1)
    campaign = models.Campaign(name=f"Audit {uuid4().hex}", start_date=start, end_date=start + timedelta(days=5),
                               created_by=admin.id)
    db.add(campaign)
    db.flush()
    db.add(models.CampaignLifecycleHistory(campaign_id=campaign.id, previous_status="draft", new_status="scheduled",
                                           transitioned_at=datetime.now(timezone.utc) + timedelta(days=400),
                                           actor_user_id=admin.id, is_automatic=False))
    db.add(models.SettingsAuditEvent(category="ai", actor_user_id=admin.id, summary="AI toggled",
                                     occurred_at=datetime.now(timezone.utc) + timedelta(days=399), details={}))
    db.flush()

    log = service.audit_log(db, category=None, campaign_id=None, limit=1, offset=0)
    assert [entry.category for entry in log.entries] == ["lifecycle"]
    assert log.entries[0].campaign_name == campaign.name
    assert log.entries[0].actor_name == admin.username
    assert log.has_more is True

    second = service.audit_log(db, category=None, campaign_id=None, limit=1, offset=1)
    assert second.entries[0].summary == "AI toggled"

    only_campaign = service.audit_log(db, category=None, campaign_id=campaign.id, limit=10, offset=0)
    assert {entry.category for entry in only_campaign.entries} == {"lifecycle"}

    only_ai = service.audit_log(db, category="ai", campaign_id=None, limit=10, offset=0)
    assert all(entry.category == "ai" for entry in only_ai.entries)


def test_ai_switch_and_capabilities(db):
    admin = make_user(db, "workspace.manage")
    generator = make_user(db, "ai_analysis.generate")
    approver = make_user(db, "ai_analysis.approve")
    assert capabilities(generator, db, archived=False) == {
        "can_manage": True, "can_generate": True, "can_approve": False, "ai_enabled": True}
    assert capabilities(approver, db, archived=False)["can_approve"] is True
    service.update_settings(admin, schemas.WorkspaceSettingsUpdate(ai_enabled=False), db)
    assert capabilities(generator, db, archived=False)["can_generate"] is False
    with pytest.raises(HTTPException) as error:
        service.require_ai_enabled(db)
    assert error.value.status_code == 409


def test_model_override_wins_over_environment(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_ANALYSIS_MODEL", "env-model")
    assert ai_generation_service._configuration()[1] == "env-model"
    with ai_generation_service.model_override("workspace-model"):
        assert ai_generation_service._configuration()[1] == "workspace-model"
    assert ai_generation_service._configuration("explicit-model")[1] == "explicit-model"


def test_workspace_routes_require_authentication():
    client = TestClient(app)
    assert client.get("/workspace/settings").status_code == 401
    assert client.patch("/workspace/settings", json={}).status_code == 401
    assert client.get("/workspace/permissions").status_code == 401
    assert client.put("/workspace/permissions", json={"roles": []}).status_code == 401
    assert client.get("/workspace/audit").status_code == 401
    client.close()

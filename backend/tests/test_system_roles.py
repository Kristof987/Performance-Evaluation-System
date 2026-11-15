from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

import models
import reporting_service
import schemas
import workspace_settings_service as service
from database import SessionLocal
from main import set_group_leaders


@pytest.fixture
def db():
    session = SessionLocal()
    session.commit = session.flush
    token = reporting_service._team_groups.set(None)
    try:
        yield session
    finally:
        reporting_service._team_groups.reset(token)
        session.rollback()
        session.close()


def permission(db, name):
    found = db.query(models.SystemPermission).filter(models.SystemPermission.name == name).first()
    if found is None:
        found = models.SystemPermission(name=name)
        db.add(found)
        db.flush()
    return found


def make_role(db, *permissions):
    role = models.SystemRole(name=f"Role {uuid4().hex}")
    db.add(role)
    db.flush()
    for name in permissions:
        db.execute(models.system_role_permissions.insert().values(system_role_id=role.id,
                                                                  permission_id=permission(db, name).id))
    return role


def make_user(db, role, *, employee=True):
    suffix = uuid4().hex
    user = models.User(username=f"user-{suffix}", email=f"{suffix}@example.com", password_hash="test-only",
                       system_role_id=role.id, is_active=True)
    db.add(user)
    db.flush()
    if employee:
        company_role = models.CompanyRole(name=f"Company {suffix}")
        db.add(company_role)
        db.flush()
        db.add(models.Employee(user_id=user.id, full_name=f"Person {suffix}", company_role_id=company_role.id,
                               is_active=True))
        db.flush()
        db.refresh(user)
    return user


def test_admin_can_promote_but_not_beyond_own_permissions(db):
    admin = make_user(db, make_role(db, "roles.assign", "permissions.manage", "reports.read"))
    target = make_user(db, make_role(db))
    service.change_user_system_role(admin, target, admin.system_role_id, db)
    assert target.system_role_id == admin.system_role_id
    event = db.query(models.SettingsAuditEvent).filter(models.SettingsAuditEvent.actor_user_id == admin.id).one()
    assert event.category == "permissions" and event.details["user_id"] == target.id

    stronger = make_role(db, "roles.assign", "workspace.manage")
    with pytest.raises(HTTPException) as error:
        service.change_user_system_role(admin, make_user(db, make_role(db)), stronger.id, db)
    assert error.value.status_code == 403


def test_role_change_guards_self_and_last_permission_manager(db):
    admin = make_user(db, make_role(db, "roles.assign", "permissions.manage"))
    with pytest.raises(HTTPException) as error:
        service.change_user_system_role(admin, admin, make_role(db).id, db)
    assert error.value.status_code == 409

    # Deactivate every other permission manager so the target is the last one besides the actor.
    other_managers = (db.query(models.User)
                      .join(models.system_role_permissions,
                            models.system_role_permissions.c.system_role_id == models.User.system_role_id)
                      .join(models.SystemPermission,
                            models.SystemPermission.id == models.system_role_permissions.c.permission_id)
                      .filter(models.SystemPermission.name == "permissions.manage").all())
    for user in other_managers:
        user.is_active = False
    target = make_user(db, make_role(db, "permissions.manage"))
    with pytest.raises(HTTPException) as error:
        service.change_user_system_role(admin, target, make_role(db).id, db)
    assert error.value.status_code == 409


def test_create_and_delete_custom_role(db):
    admin = make_user(db, make_role(db, "permissions.manage", "settings.read"))
    template = make_role(db, "reports.read", "settings.read")
    name = f"Team lead {uuid4().hex[:8]}"
    matrix = service.create_system_role(admin, schemas.SystemRoleCreate(name=f"  {name} ", copy_from_role_id=template.id), db)
    created = next(role for role in matrix.roles if role.name == name)
    assert created.permissions == ["reports.read", "settings.read"] and created.built_in is False

    with pytest.raises(HTTPException) as error:
        service.create_system_role(admin, schemas.SystemRoleCreate(name=name.upper()), db)
    assert error.value.status_code == 400

    make_user(db, db.get(models.SystemRole, created.id))
    with pytest.raises(HTTPException) as error:
        service.delete_system_role(admin, created.id, db)
    assert error.value.status_code == 409


def test_built_in_roles_cannot_be_deleted(db):
    admin = make_user(db, make_role(db, "permissions.manage", "settings.read"))
    employee_role = db.query(models.SystemRole).filter(models.SystemRole.name == "Employee").first()
    if employee_role is None:
        pytest.skip("Seeded Employee role is not available")
    with pytest.raises(HTTPException) as error:
        service.delete_system_role(admin, employee_role.id, db)
    assert error.value.status_code == 409


def test_team_scope_is_limited_to_led_groups(db):
    lead = make_user(db, make_role(db, "reports.read_team"))
    colleague = make_user(db, make_role(db))
    outsider = make_user(db, make_role(db))
    led = models.CompanyGroup(name=f"Led {uuid4().hex}")
    other = models.CompanyGroup(name=f"Other {uuid4().hex}")
    db.add_all([led, other])
    db.flush()
    set_group_leaders(led.id, [lead.employee.id], db)
    campaign = models.Campaign(name=f"Campaign {uuid4().hex}", start_date=datetime(2026, 1, 1, tzinfo=timezone.utc), status="closed",
                               created_by=lead.id)
    db.add(campaign)
    db.flush()
    db.execute(models.campaign_company_groups.insert().values(campaign_id=campaign.id, company_group_id=led.id))
    db.execute(models.employee_company_groups.insert(), [
        {"employee_id": colleague.employee.id, "company_group_id": led.id},
        {"employee_id": lead.employee.id, "company_group_id": led.id},
        {"employee_id": outsider.employee.id, "company_group_id": other.id},
    ])

    assert reporting_service.enter_report_scope(lead, db) == frozenset({led.id})
    # The lead is never part of their own team scope.
    assert reporting_service.team_employee_ids(campaign.id, frozenset({led.id}), lead, db) == {colleague.employee.id}
    assert campaign.id in {item["id"] for item in reporting_service.list_report_campaigns(lead, db)}

    reporting_service.require_team_group(campaign.id, led.id, lead, db)
    reporting_service.require_team_employee(campaign.id, colleague.employee.id, lead, db)
    for check, scope_id in [(reporting_service.require_team_group, other.id),
                            (reporting_service.require_team_employee, outsider.employee.id),
                            (reporting_service.require_team_employee, lead.employee.id)]:
        with pytest.raises(HTTPException) as error:
            check(campaign.id, scope_id, lead, db)
        assert error.value.status_code == 403


def test_team_permission_alone_does_not_open_campaign_reports(db):
    lead = make_user(db, make_role(db, "reports.read_team"))
    with pytest.raises(HTTPException) as error:
        reporting_service.require_reports_access(None, lead, db)
    assert error.value.status_code == 403
    nobody = make_user(db, make_role(db))
    with pytest.raises(HTTPException):
        reporting_service.enter_report_scope(nobody, db)

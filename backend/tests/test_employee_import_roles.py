"""Importing employees: the System Role column is optional, and only role assigners may fill it in."""
import io
from types import SimpleNamespace
from uuid import uuid4

import pytest
from openpyxl import Workbook

import models
from database import SessionLocal
from services import invitation_service, people_import_service, permissions

HR = {"employees.manage", "evaluations.submit", "settings.read"}
ASSIGNER = HR | {"roles.assign", "reports.read_team"}


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
def roles(db, monkeypatch):
    """The built-in roles with fixed permissions, an importer whose permissions each test chooses, and no Auth0."""
    by_name = {role.name: role for role in db.query(models.SystemRole).all()}
    importer_role = models.SystemRole(name=f"Importer {uuid4().hex[:8]}")
    db.add(importer_role)
    db.flush()
    granted = {by_name["Employee"].id: {"evaluations.submit", "settings.read"},
               by_name["Manager"].id: {"evaluations.submit", "settings.read", "reports.read_team"},
               by_name["Admin"].id: {"permissions.manage", "roles.assign", "employees.manage"},
               importer_role.id: set(HR)}
    monkeypatch.setattr(permissions, "role_permissions", lambda _db, role_id: granted.get(role_id, set()))
    monkeypatch.setattr(invitation_service, "invite_user",
                        lambda user, _actor, _db: SimpleNamespace(invitation_status="sent", email=user.email))
    importer = models.User(username=f"importer-{uuid4().hex}", email=f"{uuid4().hex}@example.com",
                           password_hash="", system_role_id=importer_role.id, is_active=True)
    db.add(importer)
    db.flush()
    return SimpleNamespace(by_name=by_name, importer=importer, grant=lambda permissions: granted.update({importer_role.id: permissions}))


def upload(*rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(people_import_service.EMPLOYEE_IMPORT_HEADERS)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return SimpleNamespace(file=buffer, filename="employees.xlsx")


def person(role=None):
    email = f"{uuid4().hex}@example.com"
    return ["New Person", email, "Engineer", role], email


def system_role_of(db, email):
    return db.query(models.SystemRole.name).join(models.User, models.User.system_role_id == models.SystemRole.id).filter(
        models.User.email == email).scalar()


@pytest.mark.parametrize("value", [None, "Employee", "employee"])
def test_hr_without_role_assignment_imports_employees(db, roles, value):
    row, email = person(value)
    result = people_import_service.import_people_employees(file=upload(row), db=db, actor=roles.importer)
    assert result["errors"] == [] and result["created_count"] == 1
    assert system_role_of(db, email) == "Employee"


def test_hr_without_role_assignment_cannot_import_other_roles(db, roles):
    row, email = person("Manager")
    result = people_import_service.import_people_employees(file=upload(row), db=db, actor=roles.importer)
    assert result["created_count"] == 0
    assert "not allowed to assign" in result["errors"][0] and "Leave the column empty" in result["errors"][0]
    assert system_role_of(db, email) is None


def test_role_assigners_import_roles_they_fully_hold(db, roles):
    roles.grant(set(ASSIGNER))
    row, email = person("Manager")
    assert people_import_service.import_people_employees(file=upload(row), db=db, actor=roles.importer)["errors"] == []
    assert system_role_of(db, email) == "Manager"

    stronger, _ = person("Admin")
    result = people_import_service.import_people_employees(file=upload(stronger), db=db, actor=roles.importer)
    assert result["created_count"] == 0 and "not allowed to assign" in result["errors"][0]


def test_unknown_roles_are_named(db, roles):
    row, _ = person("Wizard")
    result = people_import_service.import_people_employees(file=upload(row), db=db, actor=roles.importer)
    assert result["errors"] == ["Row 2: Employee System Role “Wizard” does not exist."]

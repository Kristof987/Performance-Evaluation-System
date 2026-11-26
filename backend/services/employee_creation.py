"""Shared persistence for employees entered by HR or imported from a spreadsheet."""

from sqlalchemy import func
from sqlalchemy.orm import Session

import models

DEFAULT_SYSTEM_ROLE = "Employee"


def get_or_create_company_role(role_name: str, db: Session):
    company_role = (
        db.query(models.CompanyRole)
        .filter(func.lower(models.CompanyRole.name) == role_name.lower())
        .first()
    )
    if company_role is None:
        company_role = models.CompanyRole(name=role_name)
        db.add(company_role)
        db.flush()
    elif company_role.archived_at is not None:
        # Typing an archived role's name brings it back instead of creating a near-duplicate.
        company_role.archived_at = None
    return company_role


def employee_username(name: str, email: str, used: set[str]) -> str:
    # The login uses user IDs; username remains unique even when display names repeat.
    for candidate in (name, email):
        if candidate not in used:
            used.add(candidate)
            return candidate
    suffix = 2
    while True:
        candidate = f"{email}-{suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        suffix += 1


def add_employee(name, email, company_role, system_role, used_usernames, db: Session):
    name = " ".join(name.split())
    user = models.User(username=employee_username(name, email, used_usernames), email=email,
                       password_hash="", system_role_id=system_role.id, is_active=True)
    person = models.Employee(user=user, full_name=name, company_role_id=company_role.id, is_active=True)
    db.add(person)
    return person

"""Shared persistence for employees entered by HR or imported from a spreadsheet."""

from itertools import chain, count

from fastapi import HTTPException
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


def default_system_role(db: Session) -> models.SystemRole:
    """The system role of a new employee whose row or form names none."""
    role = db.query(models.SystemRole).filter(func.lower(models.SystemRole.name) == DEFAULT_SYSTEM_ROLE.lower()).first()
    if role is None:
        raise HTTPException(status_code=500, detail="Employee system role is unavailable")
    return role


def employee_username(name: str, email: str, used: set[str]) -> str:
    # The login uses user IDs; username remains unique even when display names repeat: name, email, email-2, ...
    username = next(candidate for candidate in chain((name, email), (f"{email}-{n}" for n in count(2))) if candidate not in used)
    used.add(username)
    return username


def add_employee(name, email, company_role, system_role, used_usernames, db: Session):
    name = " ".join(name.split())
    user = models.User(username=employee_username(name, email, used_usernames), email=email,
                       password_hash="", system_role_id=system_role.id, is_active=True)
    person = models.Employee(user=user, full_name=name, company_role_id=company_role.id, is_active=True)
    db.add(person)
    return person

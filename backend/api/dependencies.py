"""Shared request dependencies of the API layer.

Every endpoint declares what it needs with FastAPI's Depends(): a database session, the
signed-in user (verified Auth0 token), the linked employee profile, or a permission.
Authentication and authorization therefore happen in one place, before any business logic runs.
"""
from typing import Callable

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jwt.exceptions import InvalidTokenError
from sqlalchemy.orm import Session

import models
from database import SessionLocal
from integrations.auth0 import bearer_scheme, get_verified_auth0_sub


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
                     db: Session = Depends(get_db)) -> models.User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Bearer credentials required", headers={"WWW-Authenticate": "Bearer"})
    try:
        algorithm = jwt.get_unverified_header(credentials.credentials).get("alg")
    except InvalidTokenError:
        algorithm = None
    # Auth0 is the only way in: no other token type is accepted.
    if algorithm == "RS256":
        sub = get_verified_auth0_sub(credentials)
        user = db.query(models.User).filter(models.User.auth0_user_id == sub).first()
    else:
        raise HTTPException(status_code=401, detail="Invalid bearer credentials", headers={"WWW-Authenticate": "Bearer"})
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid bearer credentials", headers={"WWW-Authenticate": "Bearer"})
    return user


def get_current_employee(user: models.User = Depends(get_current_user)) -> models.Employee:
    employee = user.employee
    if employee is None or not employee.is_active:
        raise HTTPException(status_code=403, detail="No active employee profile is linked to this account")
    return employee


def require_permission(*permission_names: str) -> Callable[..., models.User]:
    """Use as Depends(require_permission("campaigns.manage")); several names mean any of them."""
    def check_permission(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)) -> models.User:
        grant = (
            db.query(models.SystemPermission.id)
            .select_from(models.User)
            .join(models.SystemRole, models.SystemRole.id == models.User.system_role_id)
            .join(models.system_role_permissions,
                  models.system_role_permissions.c.system_role_id == models.SystemRole.id)
            .join(models.SystemPermission,
                  models.SystemPermission.id == models.system_role_permissions.c.permission_id)
            .filter(models.User.id == user.id)
            .filter(models.User.is_active.is_(True))
            .filter(models.SystemPermission.name.in_(permission_names))
            .first()
        )
        if grant is None:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return check_permission


def reject_conflicting_requester(requester_user_id: int | None, actor: models.User):
    if requester_user_id is not None and requester_user_id != actor.id:
        raise HTTPException(status_code=403, detail="Requester does not match authenticated user")

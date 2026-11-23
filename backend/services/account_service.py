"""User accounts: sign-in tracking, invitation status, e-mail checks and the account profile."""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from integrations import auth0_management
from services import workspace_settings_service
from business_calendar import BUSINESS_TIMEZONE


def record_sign_in(user: models.User, db: Session) -> None:
    """The app calls /auth/me on every start; store it as the last sign-in, at most every 5 minutes."""
    now = datetime.now(timezone.utc)
    if user.last_login is None or now - user.last_login > timedelta(minutes=5):
        user.last_login = now
        db.commit()


def sign_in_status(user: models.User | None) -> str:
    if user is None:
        return "not_invited"
    if user.auth0_user_id and user.last_login is not None:
        return "active"
    if user.invitation_status in {"sent", "failed"}:
        return "invited" if user.invitation_status == "sent" else "failed"
    return "not_invited"


def account_fields(user: models.User | None, db: Session) -> dict:
    system_role = db.get(models.SystemRole, user.system_role_id) if user else None
    return {"sign_in_status": sign_in_status(user),
            "sign_in_linked": bool(user and user.auth0_user_id),
            "invitation_sent_at": user.invitation_sent_at if user else None,
            "invitation_error": user.invitation_error if user else None,
            "system_role_id": system_role.id if system_role else None,
            "system_role_name": system_role.name if system_role else None}


INVITATION_ERROR_MESSAGES = {
    "account_exists": "an Auth0 account already exists with this email",
    "provider_unavailable": "Auth0 was unavailable; resend the invitation later",
    "email_failed": "the account was created but the email could not be sent; resend the invitation",
    "signup_rejected": "Auth0 rejected the sign-up; check that sign-ups are enabled on the connection",
    "invalid_provider_response": "Auth0 returned an unexpected response",
    "external_identity": "this account signs in with an external provider",
}


def invitation_error_message(code: str | None) -> str:
    return INVITATION_ERROR_MESSAGES.get(code or "", "the invitation could not be sent")


def normalized_email(email: str) -> str:
    return email.strip().lower()


def email_taken(email: str, db: Session, *, except_user_id: int | None = None) -> bool:
    query = db.query(models.User.id).filter(func.lower(models.User.email) == normalized_email(email))
    if except_user_id is not None:
        query = query.filter(models.User.id != except_user_id)
    return query.first() is not None


def get_auth_me(*, user: models.User, db: Session):
    roles = (
        db.query(
            models.SystemRole.name.label("system_role_name"),
            models.CompanyRole.name.label("company_role_name"),
        )
        .select_from(models.User)
        .join(models.SystemRole, models.SystemRole.id == models.User.system_role_id)
        .outerjoin(models.Employee, models.Employee.user_id == models.User.id)
        .outerjoin(models.CompanyRole, models.CompanyRole.id == models.Employee.company_role_id)
        .filter(models.User.id == user.id)
        .one_or_none()
    )
    if roles is None:
        raise HTTPException(status_code=500, detail="Account role configuration is unavailable")
    permissions = (
        db.query(models.SystemPermission.name)
        .join(models.system_role_permissions,
              models.system_role_permissions.c.permission_id == models.SystemPermission.id)
        .filter(models.system_role_permissions.c.system_role_id == user.system_role_id)
        .order_by(models.SystemPermission.name)
        .all()
    )
    record_sign_in(user, db)
    employee = user.employee
    return {"id": user.id, "username": user.username, "email": user.email,
            "system_role_id": user.system_role_id, "system_role_name": roles.system_role_name,
            "permissions": [name for (name,) in permissions],
            "is_active": user.is_active, "ai_enabled": workspace_settings_service.ai_enabled(db),
            "timezone": BUSINESS_TIMEZONE.key,
            "employee": {"id": employee.id, "full_name": employee.full_name,
                         "company_role_id": employee.company_role_id,
                         "company_role_name": roles.company_role_name,
                         "is_active": employee.is_active,
                         "profile_image_url": employee.profile_image_url} if employee else None}


def account_profile(user_id: int, db: Session):
    result = (
        db.query(
            models.User,
            models.Employee,
            models.CompanyRole.name.label("company_role"),
            models.SystemRole.name.label("system_role"),
        )
        .outerjoin(models.Employee, models.Employee.user_id == models.User.id)
        .outerjoin(models.CompanyRole, models.CompanyRole.id == models.Employee.company_role_id)
        .join(models.SystemRole, models.SystemRole.id == models.User.system_role_id)
        .filter(models.User.id == user_id)
        .filter(models.User.is_active.is_(True))
        .first()
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Account profile not found")

    user, employee, company_role, system_role = result
    memberships = (
        db.query(models.CompanyGroup)
        .join(models.employee_company_groups, models.employee_company_groups.c.company_group_id == models.CompanyGroup.id)
        .filter(models.employee_company_groups.c.employee_id == employee.id)
        .order_by(models.CompanyGroup.name.asc())
        .all()
    ) if employee else []
    member_counts = dict(db.query(
        models.employee_company_groups.c.company_group_id, func.count(models.Employee.id),
    ).join(models.Employee, models.Employee.id == models.employee_company_groups.c.employee_id)
      .filter(models.Employee.is_active.is_(True))
      .group_by(models.employee_company_groups.c.company_group_id).all()) if memberships else {}
    return {
        "id": user.id,
        "username": user.username,
        "full_name": employee.full_name if employee else None,
        "email": user.email,
        "company_role": company_role,
        "system_role": system_role,
        "groups": [
            {"id": group.id, "name": group.name, "description": group.description,
             "member_count": member_counts.get(group.id, 0)}
            for group in memberships
        ],
        "is_active": user.is_active,
        "last_login": user.last_login,
        "profile_image_url": employee.profile_image_url if employee else None,
    }


def own_employee(actor: models.User) -> models.Employee:
    if actor.employee is None or not actor.employee.is_active:
        raise HTTPException(status_code=409, detail="An active employee profile is required for a profile photo")
    return actor.employee


def get_my_security(*, actor: models.User):
    subject = actor.auth0_user_id or ""
    provider = subject.split("|", 1)[0]
    return {
        "sign_in_method": "auth0",
        "identity_provider": "Auth0 database" if provider == "auth0" else provider,
        "password_reset_available": bool(subject and subject.startswith("auth0|"))
        and auth0_management.password_reset_available(),
        "last_login": actor.last_login,
        "timezone": BUSINESS_TIMEZONE.key,
    }

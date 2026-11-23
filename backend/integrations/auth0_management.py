"""Auth0 password reset and employee sign-in invitations; provider responses and credentials stay server-side."""

import os
import re
import secrets
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from services import workspace_settings_service


def domain_url() -> str:
    domain = os.getenv("AUTH0_DOMAIN", "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]", domain) or ".." in domain:
        raise HTTPException(status_code=503, detail="Identity provider is not configured")
    return f"https://{domain}"


def password_reset_available() -> bool:
    return bool(os.getenv("AUTH0_DOMAIN") and os.getenv("AUTH0_CLIENT_ID")
                and os.getenv("AUTH0_DB_CONNECTION"))


def provider_request(method: str, url: str, **kwargs) -> httpx.Response:
    try:
        with httpx.Client(timeout=5.0, follow_redirects=False) as client:
            response = client.request(method, url, **kwargs)
        if not 200 <= response.status_code < 300:
            raise HTTPException(status_code=502, detail="Identity provider request failed. Try again later.")
        return response
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Identity provider is temporarily unavailable") from None


def send_password_reset(user_id: int, subject: str | None, email: str, db: Session) -> None:
    if not subject or not subject.startswith("auth0|"):
        raise HTTPException(status_code=409, detail="Password changes are managed by your sign-in provider")
    if not password_reset_available():
        raise HTTPException(status_code=503, detail="Password reset is not configured")
    # The account lock also serializes first requests across different workers.
    db.query(models.User).filter(models.User.id == user_id).with_for_update().one()
    now = datetime.now(timezone.utc)
    request = db.get(models.PasswordResetRequest, user_id)
    if request and (now - request.requested_at).total_seconds() < 60:
        raise HTTPException(status_code=429, detail="Wait 60 seconds before requesting another reset email",
                            headers={"Retry-After": "60"})
    if request is None:
        db.add(models.PasswordResetRequest(user_id=user_id, requested_at=now))
    else:
        request.requested_at = now
    db.commit()
    provider_request("POST", f"{domain_url()}/dbconnections/change_password", json={
        "client_id": os.environ["AUTH0_CLIENT_ID"], "email": email,
        "connection": os.environ["AUTH0_DB_CONNECTION"],
    })


INVITATION_COOLDOWN_SECONDS = 60
_RETRYABLE_PASSWORD_CODES = {"invalid_password", "password_strength_error", "password_dictionary_error",
                             "password_no_user_info_error", "password_leaked"}
_EXISTING_ACCOUNT_CODES = {"invalid_signup", "user_exists", "username_exists"}


class InvitationFailure(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _generated_password() -> str:
    # Never stored, logged or shown: the employee sets their own password from the email.
    return secrets.token_urlsafe(30) + "Aa1!"


def _signup(email: str) -> str:
    """Create the Auth0 database user and return its subject (auth0|...)."""
    for attempt in range(2):
        try:
            with httpx.Client(timeout=5.0, follow_redirects=False) as client:
                response = client.post(f"{domain_url()}/dbconnections/signup", json={
                    "client_id": os.environ["AUTH0_CLIENT_ID"], "email": email,
                    "password": _generated_password(), "connection": os.environ["AUTH0_DB_CONNECTION"],
                })
        except httpx.HTTPError:
            raise InvitationFailure("provider_unavailable") from None
        try:
            body = response.json()
        except ValueError:
            body = {}
        body = body if isinstance(body, dict) else {}
        if 200 <= response.status_code < 300:
            identifier = body.get("_id")
            if not isinstance(identifier, str) or not identifier.strip():
                raise InvitationFailure("invalid_provider_response")
            return f"auth0|{identifier}"
        code = body.get("code") or body.get("name")
        if code in _RETRYABLE_PASSWORD_CODES and attempt == 0:
            continue  # A rare random password can still miss a strict policy; try once more.
        if code in _EXISTING_ACCOUNT_CODES:
            raise InvitationFailure("account_exists")
        if response.status_code == 429 or response.status_code >= 500:
            raise InvitationFailure("provider_unavailable")
        raise InvitationFailure("signup_rejected")
    raise InvitationFailure("signup_rejected")


def _send_set_password_email(email: str) -> None:
    try:
        provider_request("POST", f"{domain_url()}/dbconnections/change_password", json={
            "client_id": os.environ["AUTH0_CLIENT_ID"], "email": email,
            "connection": os.environ["AUTH0_DB_CONNECTION"],
        })
    except HTTPException:
        raise InvitationFailure("email_failed") from None


def invite_user(user: models.User, actor: models.User, db: Session, *, enforce_cooldown: bool = False) -> models.User:
    """Create the employee's Auth0 login, link it and send the "set your password" email.

    Failures are stored on the user instead of raised, so creating the employee always succeeds.
    """
    user = db.query(models.User).filter(models.User.id == user.id).populate_existing().with_for_update().one()
    now = datetime.now(timezone.utc)
    if (enforce_cooldown and user.invitation_status == "sent" and user.invitation_sent_at is not None
            and (now - user.invitation_sent_at).total_seconds() < INVITATION_COOLDOWN_SECONDS):
        raise HTTPException(status_code=429, detail="Wait 60 seconds before sending another invitation",
                            headers={"Retry-After": str(INVITATION_COOLDOWN_SECONDS)})
    name = user.employee.full_name if user.employee else user.username
    if not password_reset_available():
        user.invitation_status, user.invitation_error = "not_sent", "not_configured"
        db.commit()
        return user
    try:
        if user.auth0_user_id is None:
            user.auth0_user_id = _signup(user.email)
            db.flush()  # Keep the link even if the email below fails; a resend then only emails.
        elif not user.auth0_user_id.startswith("auth0|"):
            raise InvitationFailure("external_identity")
        _send_set_password_email(user.email)
        user.invitation_status, user.invitation_sent_at, user.invitation_error = "sent", now, None
        workspace_settings_service.record_audit(db, "accounts", actor, f"Sign-in invitation sent to {name}",
                                                {"user_id": user.id})
    except InvitationFailure as failure:
        user.invitation_status, user.invitation_error = "failed", failure.code
        workspace_settings_service.record_audit(db, "accounts", actor,
                                                f"Sign-in invitation to {name} failed ({failure.code})",
                                                {"user_id": user.id, "error": failure.code})
    db.commit()
    return user

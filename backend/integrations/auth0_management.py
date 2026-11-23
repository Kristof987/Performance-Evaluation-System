"""Auth0 password reset and employee sign-in invitations; provider responses and credentials stay server-side."""

import os
import re
import secrets
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

import models


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


def create_login(email: str) -> str:
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


def send_set_password_email(email: str) -> None:
    try:
        provider_request("POST", f"{domain_url()}/dbconnections/change_password", json={
            "client_id": os.environ["AUTH0_CLIENT_ID"], "email": email,
            "connection": os.environ["AUTH0_DB_CONNECTION"],
        })
    except HTTPException:
        raise InvitationFailure("email_failed") from None

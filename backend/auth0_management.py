"""Self-service Auth0 operations; provider responses and credentials stay server-side."""

import os
import re
from datetime import datetime, timezone
from threading import Lock
from time import monotonic
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

import models


class TokenResponse(BaseModel):
    access_token: str = Field(min_length=1)
    expires_in: int = Field(gt=0)


class AuthenticationMethod(BaseModel):
    type: str


_token_lock = Lock()
_token_cache: tuple[tuple[str, str, str], str, float] | None = None


def domain_url() -> str:
    domain = os.getenv("AUTH0_DOMAIN", "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]", domain) or ".." in domain:
        raise HTTPException(status_code=503, detail="Identity provider is not configured")
    return f"https://{domain}"


def management_available() -> bool:
    return bool(os.getenv("AUTH0_DOMAIN") and os.getenv("AUTH0_MGMT_CLIENT_ID")
                and os.getenv("AUTH0_MGMT_CLIENT_SECRET"))


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


def management_token() -> str:
    global _token_cache
    base = domain_url()
    config = (base, os.getenv("AUTH0_MGMT_CLIENT_ID", ""), os.getenv("AUTH0_MGMT_CLIENT_SECRET", ""))
    if not management_available():
        raise HTTPException(status_code=503, detail="MFA is managed by your organization")
    with _token_lock:
        if _token_cache and _token_cache[0] == config and _token_cache[2] > monotonic():
            return _token_cache[1]
        response = provider_request("POST", f"{base}/oauth/token", json={
            "grant_type": "client_credentials", "client_id": config[1], "client_secret": config[2],
            "audience": f"{base}/api/v2/",
        })
        try:
            token = TokenResponse.model_validate(response.json())
        except (ValueError, ValidationError):
            raise HTTPException(status_code=502, detail="Identity provider returned an invalid response") from None
        _token_cache = (config, token.access_token, monotonic() + max(0, token.expires_in - 30))
        return token.access_token


def enrolled_factors(subject: str) -> list[str]:
    response = provider_request(
        "GET", f"{domain_url()}/api/v2/users/{quote(subject, safe='')}/authentication-methods",
        headers={"Authorization": f"Bearer {management_token()}"},
    )
    try:
        methods = [AuthenticationMethod.model_validate(value) for value in response.json()]
    except (TypeError, ValueError, ValidationError):
        raise HTTPException(status_code=502, detail="Identity provider returned an invalid response") from None
    # No device names, phone numbers or recovery data are exposed.
    return sorted({method.type for method in methods if method.type != "password"})


def reset_factors(subject: str) -> None:
    if not management_available():
        raise HTTPException(status_code=503, detail="MFA is managed by your organization")
    provider_request(
        "DELETE", f"{domain_url()}/api/v2/users/{quote(subject, safe='')}/authenticators",
        headers={"Authorization": f"Bearer {management_token()}"},
    )


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

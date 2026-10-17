"""Validate Auth0 API access tokens without relying on client-supplied identity."""

import os
import re
from functools import lru_cache
from urllib.parse import urlsplit

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError, PyJWKClientError


bearer_scheme = HTTPBearer(auto_error=False)


@lru_cache(maxsize=1)
def auth0_settings() -> tuple[PyJWKClient, str, str]:
    domain = os.getenv("AUTH0_DOMAIN", "").strip()
    audience = os.getenv("AUTH0_AUDIENCE", "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]", domain) or ".." in domain:
        raise RuntimeError("AUTH0_DOMAIN must be a valid hostname without a scheme or path")
    parsed_audience = urlsplit(audience)
    if (parsed_audience.scheme != "https" or not parsed_audience.netloc
            or parsed_audience.fragment or any(char.isspace() for char in audience)):
        raise RuntimeError("AUTH0_AUDIENCE must be a nonempty HTTPS URL")
    return (
        PyJWKClient(f"https://{domain}/.well-known/jwks.json", cache_jwk_set=True, lifespan=300, timeout=5),
        f"https://{domain}/",
        audience,
    )


def get_verified_auth0_sub(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Bearer credentials required", headers={"WWW-Authenticate": "Bearer"})

    jwks_client, issuer, audience = auth0_settings()
    try:
        header = jwt.get_unverified_header(credentials.credentials)
        if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str) or not header["kid"]:
            raise InvalidTokenError("Unexpected signing algorithm or missing key ID")
        signing_key = jwks_client.get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["RS256"],
            audience=audience,
            issuer=issuer,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except (InvalidTokenError, PyJWKClientError):
        raise HTTPException(status_code=401, detail="Invalid bearer credentials", headers={"WWW-Authenticate": "Bearer"}) from None

    subject = claims["sub"]
    if not isinstance(subject, str) or not subject.strip():
        raise HTTPException(status_code=401, detail="Invalid bearer credentials", headers={"WWW-Authenticate": "Bearer"})
    return subject

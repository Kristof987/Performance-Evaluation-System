from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

import main


def test_only_auth0_tokens_are_accepted():
    # The former development identity used HS256 tokens; any such token is now rejected outright.
    token = jwt.encode({"sub": "1", "iss": "compass-development", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                       "x" * 32, algorithm="HS256")
    with pytest.raises(HTTPException) as rejected:
        main.get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token), db=None)
    assert rejected.value.status_code == 401


def test_there_is_no_password_free_login_route():
    assert not any(getattr(route, "path", None) == "/login" for route in main.app.routes)

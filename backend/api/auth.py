"""Authentication endpoint: who the signed-in user is and what they may do."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
import schemas
from api.dependencies import get_current_user, get_db
from services import account_service

router = APIRouter()


@router.get("/auth/me", response_model=schemas.AuthMeResponse)
def get_auth_me(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return account_service.get_auth_me(user=user, db=db)

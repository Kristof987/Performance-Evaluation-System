"""Stored notification choices, without assuming an email delivery service exists."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from services import permissions
import schemas


EVENT_FIELDS = {
    "new_assignment": "notify_new_assignment",
    "results_available": "notify_results_available",
    "campaign_status": "notify_campaign_status",
}


def get_preferences(user_id: int, db: Session) -> schemas.PreferencesResponse:
    row = db.get(models.UserPreferences, user_id)
    return schemas.PreferencesResponse.model_validate(row) if row else schemas.PreferencesResponse()


def update_preferences(user: models.User, update: schemas.PreferencesUpdate,
                       db: Session) -> schemas.PreferencesResponse:
    changes = update.model_dump(exclude_unset=True)
    if "notify_campaign_status" in changes and not permissions.has_permission(user, db, "campaigns.manage"):
        raise HTTPException(status_code=403, detail="Campaign notifications require campaign management permission")
    # Serialize first-write creation and subsequent patches for the same account.
    db.query(models.User).filter(models.User.id == user.id).with_for_update().one()
    row = db.get(models.UserPreferences, user.id)
    if row is None:
        row = models.UserPreferences(user_id=user.id)
        db.add(row)
    for name, value in changes.items():
        setattr(row, name, value)
    db.commit()
    db.refresh(row)
    return schemas.PreferencesResponse.model_validate(row)


def should_notify(user_id: int, event: str, db: Session) -> bool:
    field = EVENT_FIELDS.get(event)
    user = db.get(models.User, user_id)
    if not field or user is None or not user.is_active:
        return False
    if event == "campaign_status" and not permissions.has_permission(user, db, "campaigns.manage"):
        return False
    return getattr(get_preferences(user_id, db), field)

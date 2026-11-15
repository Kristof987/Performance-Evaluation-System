"""Stored notification choices, without assuming an email delivery service exists."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
import schemas


EVENT_FIELDS = {
    "new_assignment": "notify_new_assignment",
    "deadline_reminder": "notify_deadline_reminder",
    "results_available": "notify_results_available",
    "campaign_status": "notify_campaign_status",
}


def can_manage_campaigns(user: models.User, db: Session) -> bool:
    return db.query(models.SystemPermission.id).join(
        models.system_role_permissions,
        models.system_role_permissions.c.permission_id == models.SystemPermission.id,
    ).filter(
        models.system_role_permissions.c.system_role_id == user.system_role_id,
        models.SystemPermission.name == "campaigns.manage",
    ).first() is not None


def get_preferences(user_id: int, db: Session) -> schemas.PreferencesResponse:
    row = db.get(models.UserPreferences, user_id)
    return schemas.PreferencesResponse.model_validate(row) if row else schemas.PreferencesResponse()


def update_preferences(user: models.User, update: schemas.PreferencesUpdate,
                       db: Session) -> schemas.PreferencesResponse:
    changes = update.model_dump(exclude_unset=True)
    if "notify_campaign_status" in changes and not can_manage_campaigns(user, db):
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
    if event == "campaign_status" and not can_manage_campaigns(user, db):
        return False
    return getattr(get_preferences(user_id, db), field)

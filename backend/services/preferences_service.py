"""Personal appearance preferences."""

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

import models
import schemas


def get_preferences(user_id: int, db: Session) -> schemas.PreferencesResponse:
    row = db.get(models.UserPreferences, user_id)
    return schemas.PreferencesResponse.model_validate(row) if row else schemas.PreferencesResponse()


def update_preferences(user: models.User, update: schemas.PreferencesUpdate,
                       db: Session) -> schemas.PreferencesResponse:
    changes = update.model_dump(exclude_unset=True)
    if changes:
        statement = insert(models.UserPreferences).values(user_id=user.id, **changes)
        db.execute(statement.on_conflict_do_update(
            index_elements=["user_id"], set_={**changes, "updated_at": func.now()},
        ))
        db.commit()
    return get_preferences(user.id, db)

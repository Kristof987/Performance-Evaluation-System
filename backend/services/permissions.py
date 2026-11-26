"""The one place that answers "may this user do X?" from the system-role permission grants."""
from sqlalchemy.orm import Session

import models


def permission_names(user: models.User, db: Session) -> set[str]:
    """Names of every permission granted to the user's system role."""
    rows = (db.query(models.SystemPermission.name)
            .join(models.system_role_permissions,
                  models.system_role_permissions.c.permission_id == models.SystemPermission.id)
            .filter(models.system_role_permissions.c.system_role_id == user.system_role_id)
            .all())
    return {name for (name,) in rows}


def has_permission(user: models.User, db: Session, *names: str) -> bool:
    """True if the user is active and holds any of the named permissions."""
    return bool(user.is_active and permission_names(user, db) & set(names))

"""The one place that answers "may this user do X?" from the system-role permission grants."""
from sqlalchemy.orm import Session

import models

_grants = models.system_role_permissions.c


def role_permissions(db: Session, role_id: int | None) -> set[str]:
    """Names of every permission granted to a system role."""
    return {name for (name,) in db.query(models.SystemPermission.name)
            .join(models.system_role_permissions, _grants.permission_id == models.SystemPermission.id)
            .filter(_grants.system_role_id == role_id)}


def permission_names(user: models.User, db: Session) -> set[str]:
    """Names of every permission granted to the user's system role."""
    return role_permissions(db, user.system_role_id)


def has_permission(user: models.User, db: Session, *names: str) -> bool:
    """True if the user is active and holds any of the named permissions."""
    return bool(user.is_active and permission_names(user, db) & set(names))


def other_active_holder(db: Session, name: str, user_id: int) -> bool:
    """True if an active user other than user_id holds the named permission."""
    return db.query(models.User.id).join(models.system_role_permissions, _grants.system_role_id == models.User.system_role_id) \
        .join(models.SystemPermission, models.SystemPermission.id == _grants.permission_id) \
        .filter(models.SystemPermission.name == name, models.User.is_active.is_(True), models.User.id != user_id) \
        .first() is not None

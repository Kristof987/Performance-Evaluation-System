"""Workspace-wide settings: privacy thresholds, AI features, permission grants and the audit log."""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import schemas


SCOPE = "default"
DEFAULT_MIN_INDIVIDUAL_PEER_REVIEWERS = 2
DEFAULT_MIN_AGGREGATE_EVALUATEES = 2

PERMISSION_DESCRIPTIONS = {
    "employees.read": "View employees",
    "employees.manage": "Create and edit employees",
    "groups.read": "View company groups",
    "groups.manage": "Create and edit company groups",
    "roles.assign": "Assign system roles to users",
    "campaigns.read": "View campaigns",
    "campaigns.manage": "Create, configure and run campaigns",
    "forms.read": "View questionnaires",
    "forms.manage": "Create and edit questionnaires",
    "sections.read": "View the Section catalogue",
    "sections.manage": "Create, rename and archive Sections",
    "evaluations.read_assigned": "See evaluations assigned to me",
    "evaluations.submit": "Fill in and submit evaluations",
    "reports.read": "View campaign reports",
    "ai_analysis.generate": "Generate and edit AI analysis drafts",
    "ai_analysis.approve": "Approve AI analyses",
    "settings.read": "Open personal settings",
    "settings.manage_self": "Change personal settings",
    "workspace.manage": "Change workspace privacy and AI settings",
    "permissions.manage": "Change role permissions",
    "audit.read": "View the audit log",
}


def _row(db: Session) -> models.WorkspaceSettings | None:
    return db.get(models.WorkspaceSettings, SCOPE)


def get_settings(db: Session) -> schemas.WorkspaceSettingsResponse:
    row = _row(db)
    return schemas.WorkspaceSettingsResponse(
        min_individual_peer_reviewers=row.min_individual_peer_reviewers if row else DEFAULT_MIN_INDIVIDUAL_PEER_REVIEWERS,
        min_aggregate_evaluatees=row.min_aggregate_evaluatees if row else DEFAULT_MIN_AGGREGATE_EVALUATEES,
        ai_enabled=row.ai_enabled if row else True,
        ai_model=row.ai_model if row else None,
        updated_at=row.updated_at if row else None,
    )


def privacy_thresholds(db: Session) -> tuple[int, int]:
    """Return (minimum peer reviewers, minimum evaluated employees) for suppression."""
    settings = get_settings(db)
    return settings.min_individual_peer_reviewers, settings.min_aggregate_evaluatees


def ai_enabled(db: Session) -> bool:
    return get_settings(db).ai_enabled


def ai_model(db: Session) -> str | None:
    return get_settings(db).ai_model


def require_ai_enabled(db: Session) -> None:
    if not ai_enabled(db):
        raise HTTPException(status_code=409, detail="AI features are turned off in workspace settings")


def record_audit(db: Session, category: str, actor: models.User, summary: str, details: dict) -> None:
    db.add(models.SettingsAuditEvent(category=category, actor_user_id=actor.id, summary=summary[:500],
                                     details=details, occurred_at=datetime.now(timezone.utc)))


def _locked_row(db: Session) -> models.WorkspaceSettings:
    row = db.query(models.WorkspaceSettings).filter(models.WorkspaceSettings.scope_key == SCOPE).with_for_update().first()
    if row is None:
        row = models.WorkspaceSettings(scope_key=SCOPE, min_individual_peer_reviewers=DEFAULT_MIN_INDIVIDUAL_PEER_REVIEWERS,
                                       min_aggregate_evaluatees=DEFAULT_MIN_AGGREGATE_EVALUATEES, ai_enabled=True)
        db.add(row)
        db.flush()
    return row


def update_settings(actor: models.User, update: schemas.WorkspaceSettingsUpdate, db: Session) -> schemas.WorkspaceSettingsResponse:
    changes = update.model_dump(exclude_unset=True)
    if "ai_model" in changes:
        changes["ai_model"] = changes["ai_model"] or None  # An empty model means the environment default.
    row = _locked_row(db)
    previous = {name: getattr(row, name) for name in changes}
    changed = {name: value for name, value in changes.items() if previous[name] != value}
    for name, value in changed.items():
        setattr(row, name, value)
    row.updated_by_user_id = actor.id
    privacy = {name for name in changed if name.startswith("min_")}
    if privacy:
        record_audit(db, "privacy", actor, "Privacy thresholds changed: " + ", ".join(
            f"{name} {previous[name]} → {changed[name]}" for name in sorted(privacy)),
            {name: {"from": previous[name], "to": changed[name]} for name in privacy})
    ai = set(changed) - privacy
    if ai:
        record_audit(db, "ai", actor, "AI settings changed: " + ", ".join(
            f"{name} {previous[name]!r} → {changed[name]!r}" for name in sorted(ai)),
            {name: {"from": previous[name], "to": changed[name]} for name in ai})
    db.commit()
    return get_settings(db)


def permission_matrix(db: Session) -> schemas.PermissionMatrixResponse:
    roles = db.query(models.SystemRole).order_by(models.SystemRole.id).all()
    permissions = db.query(models.SystemPermission).order_by(models.SystemPermission.name).all()
    grants = db.query(models.system_role_permissions.c.system_role_id,
                      models.system_role_permissions.c.permission_id).all()
    names = {permission.id: permission.name for permission in permissions}
    user_counts = dict(db.query(models.User.system_role_id, func.count(models.User.id))
                       .filter(models.User.is_active.is_(True)).group_by(models.User.system_role_id).all())
    return schemas.PermissionMatrixResponse(
        roles=[schemas.PermissionMatrixRole(
            id=role.id, name=role.name, active_users=user_counts.get(role.id, 0),
            permissions=sorted(names[permission_id] for role_id, permission_id in grants if role_id == role.id),
        ) for role in roles],
        permissions=[schemas.PermissionMatrixPermission(
            name=permission.name,
            description=permission.description or PERMISSION_DESCRIPTIONS.get(permission.name, permission.name),
        ) for permission in permissions],
    )


def update_permission_matrix(actor: models.User, update: schemas.PermissionMatrixUpdate,
                             db: Session) -> schemas.PermissionMatrixResponse:
    # Serialize concurrent edits of the matrix behind one lock.
    _locked_row(db)
    roles = {role.id: role for role in db.query(models.SystemRole).all()}
    permissions = {permission.name: permission.id for permission in db.query(models.SystemPermission).all()}
    requested: dict[int, set[str]] = {}
    for item in update.roles:
        if item.role_id not in roles:
            raise HTTPException(status_code=400, detail=f"Unknown system role {item.role_id}")
        if item.role_id in requested:
            raise HTTPException(status_code=400, detail="Each role can appear only once")
        unknown = set(item.permissions) - permissions.keys()
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown permissions: {', '.join(sorted(unknown))}")
        requested[item.role_id] = set(item.permissions)

    current: dict[int, set[str]] = {role_id: set() for role_id in roles}
    by_id = {permission_id: name for name, permission_id in permissions.items()}
    for role_id, permission_id in db.query(models.system_role_permissions.c.system_role_id,
                                           models.system_role_permissions.c.permission_id).all():
        current[role_id].add(by_id[permission_id])
    final = {role_id: requested.get(role_id, granted) for role_id, granted in current.items()}

    # Guard against locking everyone out of this page.
    if "permissions.manage" not in final.get(actor.system_role_id, set()):
        raise HTTPException(status_code=409, detail="You cannot remove permission management from your own role")
    if "settings.read" not in final.get(actor.system_role_id, set()):
        raise HTTPException(status_code=409, detail="You cannot remove Settings access from your own role")

    changes = []
    for role_id, granted in final.items():
        added, removed = granted - current[role_id], current[role_id] - granted
        for name in added:
            db.execute(models.system_role_permissions.insert().values(system_role_id=role_id, permission_id=permissions[name]))
        if removed:
            db.execute(models.system_role_permissions.delete().where(
                models.system_role_permissions.c.system_role_id == role_id,
                models.system_role_permissions.c.permission_id.in_([permissions[name] for name in removed]),
            ))
        if added or removed:
            changes.append({"role": roles[role_id].name, "added": sorted(added), "removed": sorted(removed)})
    if changes:
        summary = "; ".join(
            f"{change['role']}: " + ", ".join([f"+{name}" for name in change["added"]] + [f"-{name}" for name in change["removed"]])
            for change in changes)
        record_audit(db, "permissions", actor, f"Permissions changed — {summary}", {"changes": changes})
    db.commit()
    return permission_matrix(db)


AUDIT_CATEGORIES = ("lifecycle", "archive", "operation", "privacy", "ai", "permissions")


def audit_log(db: Session, *, category: str | None, campaign_id: int | None,
              limit: int, offset: int) -> schemas.AuditLogResponse:
    """Merge every audit source, newest first. Each source is capped at offset+limit rows."""
    window = offset + limit + 1
    campaign_names = {}
    entries: list[schemas.AuditLogEntry] = []

    def wanted(name: str) -> bool:
        return category is None or category == name

    def campaign_label(identifier: int | None) -> str | None:
        if identifier is None:
            return None
        if identifier not in campaign_names:
            campaign = db.get(models.Campaign, identifier)
            campaign_names[identifier] = campaign.name if campaign else f"Deleted campaign #{identifier}"
        return campaign_names[identifier]

    if wanted("lifecycle"):
        query = db.query(models.CampaignLifecycleHistory)
        if campaign_id is not None:
            query = query.filter(models.CampaignLifecycleHistory.campaign_id == campaign_id)
        for row in query.order_by(models.CampaignLifecycleHistory.transitioned_at.desc()).limit(window):
            entries.append(schemas.AuditLogEntry(
                id=f"lifecycle-{row.id}", category="lifecycle", occurred_at=row.transitioned_at,
                actor_user_id=row.actor_user_id, is_automatic=row.is_automatic, campaign_id=row.campaign_id,
                summary=f"Status changed from {row.previous_status} to {row.new_status}"))
    if wanted("archive"):
        query = db.query(models.CampaignArchiveEvent)
        if campaign_id is not None:
            query = query.filter(models.CampaignArchiveEvent.campaign_id == campaign_id)
        for row in query.order_by(models.CampaignArchiveEvent.occurred_at.desc()).limit(window):
            entries.append(schemas.AuditLogEntry(
                id=f"archive-{row.id}", category="archive", occurred_at=row.occurred_at,
                actor_user_id=row.actor_user_id, is_automatic=False, campaign_id=row.campaign_id,
                summary=f"Campaign {row.action}d"))
    if wanted("operation"):
        query = db.query(models.CampaignOperationAudit)
        if campaign_id is not None:
            query = query.filter(models.CampaignOperationAudit.campaign_id == campaign_id)
        labels = {"snapshot_issuance": "Questionnaires issued", "transition_failure": "Status change failed",
                  "delete": "Campaign deleted"}
        for row in query.order_by(models.CampaignOperationAudit.occurred_at.desc()).limit(window):
            summary = labels.get(row.category, row.category)
            if row.category == "snapshot_issuance":
                summary += f" ({row.issued_count})"
            entries.append(schemas.AuditLogEntry(
                id=f"operation-{row.id}", category="operation", occurred_at=row.occurred_at,
                actor_user_id=row.actor_user_id, is_automatic=row.is_automatic, campaign_id=row.campaign_id,
                summary=summary))
    if campaign_id is None:
        query = db.query(models.SettingsAuditEvent)
        if category is not None:
            query = query.filter(models.SettingsAuditEvent.category == category)
        if category is None or category in {"privacy", "ai", "permissions"}:
            for row in query.order_by(models.SettingsAuditEvent.occurred_at.desc()).limit(window):
                entries.append(schemas.AuditLogEntry(
                    id=f"settings-{row.id}", category=row.category, occurred_at=row.occurred_at,
                    actor_user_id=row.actor_user_id, is_automatic=False, campaign_id=None, summary=row.summary))

    entries.sort(key=lambda entry: (entry.occurred_at, entry.id), reverse=True)
    page = entries[offset:offset + limit]
    actor_ids = {entry.actor_user_id for entry in page if entry.actor_user_id is not None}
    actors = {}
    if actor_ids:
        for user, employee in db.query(models.User, models.Employee).outerjoin(
                models.Employee, models.Employee.user_id == models.User.id).filter(models.User.id.in_(actor_ids)):
            actors[user.id] = employee.full_name if employee else user.username
    for entry in page:
        entry.campaign_name = campaign_label(entry.campaign_id)
        entry.actor_name = actors.get(entry.actor_user_id) if entry.actor_user_id is not None else None
    return schemas.AuditLogResponse(entries=page, has_more=len(entries) > offset + limit)

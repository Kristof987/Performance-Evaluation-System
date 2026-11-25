"""Workspace administration: settings, default reminders, permissions and the audit log."""

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

import models
import schemas
from api.dependencies import get_db, require_permission
from integrations import email_service
from services import campaign_reminder_service, workspace_settings_service

router = APIRouter()


@router.get("/workspace/settings", response_model=schemas.AIWorkspaceStatus)
def get_workspace_settings(db: Session = Depends(get_db),
                           _actor: models.User = Depends(require_permission("workspace.manage"))):
    return workspace_settings_service.ai_workspace_status(db)


@router.patch("/workspace/settings", response_model=schemas.AIWorkspaceStatus)
def patch_workspace_settings(update: schemas.WorkspaceSettingsUpdate, db: Session = Depends(get_db),
                             actor: models.User = Depends(require_permission("workspace.manage"))):
    workspace_settings_service.update_settings(actor, update, db)
    return workspace_settings_service.ai_workspace_status(db)


@router.get("/workspace/email-reminders", response_model=schemas.WorkspaceReminderDefaults)
def get_workspace_reminder_defaults(db: Session = Depends(get_db),
                                    _actor: models.User = Depends(require_permission("workspace.manage"))):
    days, launch = campaign_reminder_service.workspace_reminder_defaults(db)
    return {"default_reminder_days": days, "default_launch_email": launch,
            "email_configured": email_service.configured()}


@router.put("/workspace/email-reminders", response_model=schemas.WorkspaceReminderDefaults)
def put_workspace_reminder_defaults(update: schemas.WorkspaceReminderDefaultsUpdate, db: Session = Depends(get_db),
                                    actor: models.User = Depends(require_permission("workspace.manage"))):
    return workspace_settings_service.put_workspace_reminder_defaults(update=update, db=db, actor=actor)


@router.get("/workspace/permissions", response_model=schemas.PermissionMatrixResponse)
def get_permission_matrix(db: Session = Depends(get_db),
                          _actor: models.User = Depends(require_permission("permissions.manage", "workspace.manage"))):
    return workspace_settings_service.permission_matrix(db)


@router.put("/workspace/permissions", response_model=schemas.PermissionMatrixResponse)
def put_permission_matrix(update: schemas.PermissionMatrixUpdate, db: Session = Depends(get_db),
                          actor: models.User = Depends(require_permission("permissions.manage"))):
    return workspace_settings_service.update_permission_matrix(actor, update, db)


@router.post("/workspace/permissions/roles", response_model=schemas.PermissionMatrixResponse)
def post_system_role(create: schemas.SystemRoleCreate, db: Session = Depends(get_db),
                     actor: models.User = Depends(require_permission("permissions.manage"))):
    return workspace_settings_service.create_system_role(actor, create, db)


@router.delete("/workspace/permissions/roles/{role_id}", response_model=schemas.PermissionMatrixResponse)
def delete_system_role(role_id: int, db: Session = Depends(get_db),
                       actor: models.User = Depends(require_permission("permissions.manage"))):
    return workspace_settings_service.delete_system_role(actor, role_id, db)


@router.get("/workspace/audit", response_model=schemas.AuditLogResponse)
def get_audit_log(
    category: Literal["lifecycle", "archive", "operation", "privacy", "ai", "permissions", "accounts", "notifications"] | None = Query(default=None),
    campaign_id: int | None = Query(default=None, gt=0),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=10_000),
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("audit.read")),
):
    return workspace_settings_service.audit_log(db, category=category, campaign_id=campaign_id,
                                                limit=limit, offset=offset)

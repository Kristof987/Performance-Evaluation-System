from copy import deepcopy
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
import os
import secrets
from uuid import uuid4
from typing import Callable, Literal

import jwt
from jwt.exceptions import InvalidTokenError
from fastapi import FastAPI, Depends, HTTPException, Query, Response, UploadFile, File
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from openpyxl import load_workbook
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import and_, asc, case, desc, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session, aliased

from database import engine, Base, SessionLocal
from auth0 import bearer_scheme, get_verified_auth0_sub
from business_calendar import business_today as campaign_today, business_date, campaign_instant
import campaign_lifecycle
import models
import form_snapshot_service
import reporting_service
import question_analytics_service
import evaluation_quality_service
import ai_workflow_service
import ai_aggregate_workflow_service
import ai_generation_jobs
import ai_form_generation_service
from ai_analysis_models import EmployeeAIAnalysis
from ai_generation_service import AnalysisGenerationError
import schemas
import auth0_management
import preferences_service
import workspace_settings_service
import profile_photo_service

#Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    stop, worker = ai_generation_jobs.start_worker()
    try:
        yield
    finally:
        stop.set()
        worker.join(timeout=1)


app = FastAPI(lifespan=lifespan)

FRONTEND_URL = os.getenv("FRONTEND_URL")

allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

if FRONTEND_URL:
    allowed_origins.append(FRONTEND_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

email_validator = TypeAdapter(schemas.EmailStr)
development_token_key = secrets.token_bytes(32)
EMPLOYEE_IMPORT_HEADERS = [
    "Employee Name",
    "Employee Email Address",
    "Employee Company Role",
    "Employee System Role",
]
GROUP_IMPORT_HEADERS = ["Group Name", "Group Description"]


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
                     db: Session = Depends(get_db)) -> models.User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Bearer credentials required", headers={"WWW-Authenticate": "Bearer"})
    try:
        algorithm = jwt.get_unverified_header(credentials.credentials).get("alg")
    except InvalidTokenError:
        algorithm = None
    if algorithm == "HS256" and development_login_enabled():
        try:
            claims = jwt.decode(credentials.credentials, development_token_key, algorithms=["HS256"],
                                issuer="compass-development", options={"require": ["exp", "iss", "sub"]})
            subject = claims["sub"]
            if not isinstance(subject, str) or not subject.isdecimal() or int(subject) <= 0:
                raise InvalidTokenError("Invalid development identity")
        except InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid bearer credentials", headers={"WWW-Authenticate": "Bearer"}) from None
        user = db.query(models.User).filter(models.User.id == int(subject)).first()
    elif algorithm == "RS256":
        sub = get_verified_auth0_sub(credentials)
        user = db.query(models.User).filter(models.User.auth0_user_id == sub).first()
    else:
        raise HTTPException(status_code=401, detail="Invalid bearer credentials", headers={"WWW-Authenticate": "Bearer"})
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid bearer credentials", headers={"WWW-Authenticate": "Bearer"})
    return user


def get_current_employee(user: models.User = Depends(get_current_user)) -> models.Employee:
    employee = user.employee
    if employee is None or not employee.is_active:
        raise HTTPException(status_code=403, detail="No active employee profile is linked to this account")
    return employee


def require_permission(*permission_names: str) -> Callable[..., models.User]:
    """Use as Depends(require_permission("campaigns.manage")); several names mean any of them."""
    def check_permission(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)) -> models.User:
        grant = (
            db.query(models.SystemPermission.id)
            .select_from(models.User)
            .join(models.SystemRole, models.SystemRole.id == models.User.system_role_id)
            .join(models.system_role_permissions,
                  models.system_role_permissions.c.system_role_id == models.SystemRole.id)
            .join(models.SystemPermission,
                  models.SystemPermission.id == models.system_role_permissions.c.permission_id)
            .filter(models.User.id == user.id)
            .filter(models.User.is_active.is_(True))
            .filter(models.SystemPermission.name.in_(permission_names))
            .first()
        )
        if grant is None:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return check_permission


def record_sign_in(user: models.User, db: Session) -> None:
    """The app calls /auth/me on every start; store it as the last sign-in, at most every 5 minutes."""
    now = datetime.now(timezone.utc)
    if user.last_login is None or now - user.last_login > timedelta(minutes=5):
        user.last_login = now
        db.commit()


def sign_in_status(user: models.User | None) -> str:
    if user is None:
        return "not_invited"
    if user.auth0_user_id and user.last_login is not None:
        return "active"
    if user.invitation_status in {"sent", "failed"}:
        return "invited" if user.invitation_status == "sent" else "failed"
    return "not_invited"


def account_fields(user: models.User | None, db: Session) -> dict:
    system_role = db.get(models.SystemRole, user.system_role_id) if user else None
    return {"sign_in_status": sign_in_status(user),
            "sign_in_linked": bool(user and user.auth0_user_id),
            "invitation_sent_at": user.invitation_sent_at if user else None,
            "invitation_error": user.invitation_error if user else None,
            "system_role_id": system_role.id if system_role else None,
            "system_role_name": system_role.name if system_role else None}


INVITATION_ERROR_MESSAGES = {
    "account_exists": "an Auth0 account already exists with this email",
    "provider_unavailable": "Auth0 was unavailable; resend the invitation later",
    "email_failed": "the account was created but the email could not be sent; resend the invitation",
    "signup_rejected": "Auth0 rejected the sign-up; check that sign-ups are enabled on the connection",
    "invalid_provider_response": "Auth0 returned an unexpected response",
    "external_identity": "this account signs in with an external provider",
}


def invitation_error_message(code: str | None) -> str:
    return INVITATION_ERROR_MESSAGES.get(code or "", "the invitation could not be sent")


def normalized_email(email: str) -> str:
    return email.strip().lower()


def email_taken(email: str, db: Session, *, except_user_id: int | None = None) -> bool:
    query = db.query(models.User.id).filter(func.lower(models.User.email) == normalized_email(email))
    if except_user_id is not None:
        query = query.filter(models.User.id != except_user_id)
    return query.first() is not None


def group_member_counts(group_ids: list[int], db: Session) -> dict[int, int]:
    if not group_ids:
        return {}
    return dict(db.query(models.employee_company_groups.c.company_group_id, func.count())
                .filter(models.employee_company_groups.c.company_group_id.in_(group_ids))
                .group_by(models.employee_company_groups.c.company_group_id).all())


def group_leader_ids(group_ids: list[int] | None, db: Session) -> dict[int, list[int]]:
    leaders = models.company_group_leaders.c
    query = db.query(leaders.company_group_id, leaders.employee_id)
    if group_ids is not None:
        query = query.filter(leaders.company_group_id.in_(group_ids))
    result: dict[int, list[int]] = {}
    for group_id, employee_id in query.order_by(leaders.employee_id).all():
        result.setdefault(group_id, []).append(employee_id)
    return result


def set_group_leaders(group_id: int, leader_ids: list[int], db: Session) -> list[int]:
    """Leaders need not be members: a manager can lead a team without being evaluated in it."""
    wanted = sorted(set(leader_ids))
    if wanted:
        found = {employee_id for (employee_id,) in db.query(models.Employee.id)
                 .filter(models.Employee.id.in_(wanted), models.Employee.is_active.is_(True)).all()}
        if found != set(wanted):
            raise HTTPException(status_code=400, detail="Invalid group leader selection")
    db.execute(models.company_group_leaders.delete().where(
        models.company_group_leaders.c.company_group_id == group_id))
    for employee_id in wanted:
        db.execute(models.company_group_leaders.insert().values(company_group_id=group_id, employee_id=employee_id))
    return wanted


@app.get("/auth/me", response_model=schemas.AuthMeResponse)
def get_auth_me(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    roles = (
        db.query(
            models.SystemRole.name.label("system_role_name"),
            models.CompanyRole.name.label("company_role_name"),
        )
        .select_from(models.User)
        .join(models.SystemRole, models.SystemRole.id == models.User.system_role_id)
        .outerjoin(models.Employee, models.Employee.user_id == models.User.id)
        .outerjoin(models.CompanyRole, models.CompanyRole.id == models.Employee.company_role_id)
        .filter(models.User.id == user.id)
        .one_or_none()
    )
    if roles is None:
        raise HTTPException(status_code=500, detail="Account role configuration is unavailable")
    permissions = (
        db.query(models.SystemPermission.name)
        .join(models.system_role_permissions,
              models.system_role_permissions.c.permission_id == models.SystemPermission.id)
        .filter(models.system_role_permissions.c.system_role_id == user.system_role_id)
        .order_by(models.SystemPermission.name)
        .all()
    )
    record_sign_in(user, db)
    employee = user.employee
    return {"id": user.id, "username": user.username, "email": user.email,
            "system_role_id": user.system_role_id, "system_role_name": roles.system_role_name,
            "permissions": [name for (name,) in permissions],
            "is_active": user.is_active,
            "employee": {"id": employee.id, "full_name": employee.full_name,
                         "company_role_id": employee.company_role_id,
                         "company_role_name": roles.company_role_name,
                         "is_active": employee.is_active,
                         "profile_image_url": employee.profile_image_url} if employee else None}


def development_login_enabled() -> bool:
    return os.getenv("COMPASS_ENV", "production").lower() == "development" and os.getenv("COMPASS_DEV_LOGIN_ENABLED", "false").lower() == "true"


def require_development_login():
    # Both settings must be explicitly enabled on the backend; neither is a credential.
    if not development_login_enabled():
        raise HTTPException(status_code=404, detail="Development login is unavailable")


@app.post("/login", response_model=schemas.DevelopmentLoginResponse)
def login(user_login: schemas.UserLogin, db: Session = Depends(get_db)):
    require_development_login()
    name = " ".join(user_login.name.split()).lower()
    if not name:
        raise HTTPException(status_code=400, detail="Enter your full name, username or email")
    matches = (
        db.query(models.User, models.Employee, models.CompanyRole.name.label("role_name"), models.SystemRole.name.label("system_role_name"))
        .outerjoin(models.Employee, models.Employee.user_id == models.User.id)
        .outerjoin(models.CompanyRole, models.CompanyRole.id == models.Employee.company_role_id)
        .join(models.SystemRole, models.SystemRole.id == models.User.system_role_id)
        .filter(or_(
            func.lower(func.trim(models.Employee.full_name)) == name,
            func.lower(func.trim(models.User.username)) == name,
            func.lower(func.trim(models.User.email)) == name,
        ))
        .filter(models.User.is_active.is_(True))
        .limit(2)
        .all()
    )

    if not matches:
        raise HTTPException(status_code=404, detail="No active user matches that name, username or email")
    if len(matches) > 1:
        raise HTTPException(status_code=409, detail="Multiple users match. Enter your unique username or email")

    user, employee, role_name, system_role_name = matches[0]
    if employee is None or not employee.is_active:
        raise HTTPException(status_code=403, detail="An active employee profile is required for development access")

    user.last_login = func.now()
    db.commit()
    db.refresh(user)

    return {
        **user.__dict__,
        "access_token": jwt.encode({"sub": str(user.id), "iss": "compass-development",
                                    "exp": datetime.now(timezone.utc) + timedelta(hours=8)},
                                   development_token_key, algorithm="HS256"),
        "employee_id": employee.id if employee else None,
        "full_name": employee.full_name if employee else None,
        "company_role_id": employee.company_role_id if employee else None,
        "profile_image_url": employee.profile_image_url if employee else None,
        "role_name": (system_role_name if system_role_name.strip().lower() == "hr" or "manager" in system_role_name.strip().lower()
                      else role_name or system_role_name),
    }


@app.get("/people", response_model=schemas.PeopleResponse)
def get_people(db: Session = Depends(get_db),
               _employee_reader: models.User = Depends(require_permission("employees.read")),
               _group_reader: models.User = Depends(require_permission("groups.read"))):
    employees = (
        db.query(models.Employee)
        .order_by(models.Employee.is_active.desc(), models.Employee.full_name.asc())
        .all()
    )
    roles_by_id = {
        role.id: role.name
        for role in db.query(models.CompanyRole).all()
    }
    groups = db.query(models.CompanyGroup).order_by(models.CompanyGroup.name.asc()).all()
    groups_by_id = {group.id: group for group in groups}
    group_member_counts = {group.id: 0 for group in groups}
    group_ids_by_employee_id = {employee.id: [] for employee in employees}

    memberships = db.query(
        models.employee_company_groups.c.employee_id,
        models.employee_company_groups.c.company_group_id,
    ).all()
    for membership in memberships:
        group = groups_by_id.get(membership.company_group_id)
        if group is None:
            continue
        group_member_counts[group.id] = group_member_counts.get(group.id, 0) + 1
        if membership.employee_id in group_ids_by_employee_id:
            group_ids_by_employee_id[membership.employee_id].append(group.id)

    leader_ids_by_group = group_leader_ids(None, db)

    def serialize_group(group: models.CompanyGroup):
        return {
            "id": group.id,
            "name": group.name,
            "description": group.description,
            "member_count": group_member_counts.get(group.id, 0),
            "leader_ids": leader_ids_by_group.get(group.id, []),
        }

    return {
        "employees": [
            {
                "id": employee.id,
                "user_id": employee.user_id,
                "username": employee.user.username if employee.user else employee.full_name,
                "full_name": employee.full_name,
                "email": employee.user.email if employee.user else "",
                "company_role_id": employee.company_role_id,
                "role_name": roles_by_id.get(employee.company_role_id, "Unknown role"),
                "groups": [
                    serialize_group(groups_by_id[group_id])
                    for group_id in group_ids_by_employee_id.get(employee.id, [])
                    if group_id in groups_by_id
                ],
                "is_active": employee.is_active,
                "profile_image_url": employee.profile_image_url,
                **account_fields(employee.user, db),
            }
            for employee in employees
        ],
        "groups": [serialize_group(group) for group in groups],
        "company_roles": [{"id": role_id, "name": name}
                          for role_id, name in sorted(roles_by_id.items(), key=lambda item: item[1].lower())],
        "system_roles": [{"id": role.id, "name": role.name, "description": role.description}
                         for role in db.query(models.SystemRole).order_by(models.SystemRole.id).all()],
    }


@app.get("/users/{user_id}/account-settings/profile", response_model=schemas.AccountSettingsProfile)
def get_account_settings_profile(user_id: int, db: Session = Depends(get_db),
                                 actor: models.User = Depends(require_permission("settings.read"))):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Account profile not found")
    return account_profile(actor.id, db)


@app.get("/me/account-settings/profile", response_model=schemas.AccountSettingsProfile)
def get_my_account_settings_profile(db: Session = Depends(get_db),
                                    actor: models.User = Depends(require_permission("settings.read"))):
    return account_profile(actor.id, db)


def account_profile(user_id: int, db: Session):
    result = (
        db.query(
            models.User,
            models.Employee,
            models.CompanyRole.name.label("company_role"),
            models.SystemRole.name.label("system_role"),
        )
        .outerjoin(models.Employee, models.Employee.user_id == models.User.id)
        .outerjoin(models.CompanyRole, models.CompanyRole.id == models.Employee.company_role_id)
        .join(models.SystemRole, models.SystemRole.id == models.User.system_role_id)
        .filter(models.User.id == user_id)
        .filter(models.User.is_active.is_(True))
        .first()
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Account profile not found")

    user, employee, company_role, system_role = result
    memberships = (
        db.query(models.CompanyGroup)
        .join(models.employee_company_groups, models.employee_company_groups.c.company_group_id == models.CompanyGroup.id)
        .filter(models.employee_company_groups.c.employee_id == employee.id)
        .order_by(models.CompanyGroup.name.asc())
        .all()
    ) if employee else []
    member_counts = dict(db.query(
        models.employee_company_groups.c.company_group_id, func.count(models.Employee.id),
    ).join(models.Employee, models.Employee.id == models.employee_company_groups.c.employee_id)
      .filter(models.Employee.is_active.is_(True))
      .group_by(models.employee_company_groups.c.company_group_id).all()) if memberships else {}
    return {
        "id": user.id,
        "username": user.username,
        "full_name": employee.full_name if employee else None,
        "email": user.email,
        "company_role": company_role,
        "system_role": system_role,
        "groups": [
            {"id": group.id, "name": group.name, "description": group.description,
             "member_count": member_counts.get(group.id, 0)}
            for group in memberships
        ],
        "is_active": user.is_active,
        "last_login": user.last_login,
        "profile_image_url": employee.profile_image_url if employee else None,
    }


def own_employee(actor: models.User) -> models.Employee:
    if actor.employee is None or not actor.employee.is_active:
        raise HTTPException(status_code=409, detail="An active employee profile is required for a profile photo")
    return actor.employee


@app.put("/me/profile-photo", response_model=schemas.ProfilePhotoResponse)
def upload_my_profile_photo(file: UploadFile = File(...), db: Session = Depends(get_db),
                            actor: models.User = Depends(require_permission("settings.manage_self"))):
    # Only ever the caller's own employee: the route has no ID that could point at someone else.
    data = file.file.read(profile_photo_service.MAX_UPLOAD_BYTES + 1)
    url = profile_photo_service.save_photo(own_employee(actor), data, db)
    return {"profile_image_url": url}


@app.delete("/me/profile-photo", response_model=schemas.ProfilePhotoResponse)
def delete_my_profile_photo(db: Session = Depends(get_db),
                            actor: models.User = Depends(require_permission("settings.manage_self"))):
    profile_photo_service.remove_photo(own_employee(actor), db)
    return {"profile_image_url": None}


@app.get("/photos/{photo_id}.jpg", include_in_schema=False)
def get_profile_photo(photo_id: str, db: Session = Depends(get_db)):
    photo = profile_photo_service.find_servable_photo(photo_id, db)
    if photo is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    return Response(content=photo.content, media_type=photo.content_type, headers={
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
    })


@app.get("/me/security", response_model=schemas.SecuritySettingsResponse)
def get_my_security(actor: models.User = Depends(require_permission("settings.read"))):
    subject = actor.auth0_user_id
    provider = subject.split("|", 1)[0] if subject else "development"
    return {
        "sign_in_method": "auth0" if subject else "development",
        "identity_provider": "Auth0 database" if provider == "auth0" else provider,
        "password_reset_available": bool(subject and subject.startswith("auth0|"))
        and auth0_management.password_reset_available(),
        "last_login": actor.last_login,
        "timezone": os.getenv("APP_TIMEZONE", "Europe/Budapest"),
    }


@app.post("/me/security/password-reset", response_model=schemas.SettingsActionResponse)
def reset_my_password(db: Session = Depends(get_db),
                      actor: models.User = Depends(require_permission("settings.manage_self"))):
    auth0_management.send_password_reset(actor.id, actor.auth0_user_id, actor.email, db)
    return {"message": "If your account uses a password, a reset link was sent."}


@app.get("/me/preferences", response_model=schemas.PreferencesResponse)
def get_my_preferences(db: Session = Depends(get_db),
                       actor: models.User = Depends(require_permission("settings.read"))):
    return preferences_service.get_preferences(actor.id, db)


@app.patch("/me/preferences", response_model=schemas.PreferencesResponse)
def patch_my_preferences(update: schemas.PreferencesUpdate, db: Session = Depends(get_db),
                         actor: models.User = Depends(require_permission("settings.manage_self"))):
    return preferences_service.update_preferences(actor, update, db)


def ai_workspace_status(db: Session) -> schemas.AIWorkspaceStatus:
    settings = workspace_settings_service.get_settings(db)
    return schemas.AIWorkspaceStatus(
        **settings.model_dump(),
        default_model=os.getenv("OPENAI_ANALYSIS_MODEL", "").strip() or None,
        api_key_configured=bool(os.getenv("OPENAI_API_KEY", "").strip()),
    )


@app.get("/workspace/settings", response_model=schemas.AIWorkspaceStatus)
def get_workspace_settings(db: Session = Depends(get_db),
                           _actor: models.User = Depends(require_permission("workspace.manage"))):
    return ai_workspace_status(db)


@app.patch("/workspace/settings", response_model=schemas.AIWorkspaceStatus)
def patch_workspace_settings(update: schemas.WorkspaceSettingsUpdate, db: Session = Depends(get_db),
                             actor: models.User = Depends(require_permission("workspace.manage"))):
    workspace_settings_service.update_settings(actor, update, db)
    return ai_workspace_status(db)


@app.get("/workspace/permissions", response_model=schemas.PermissionMatrixResponse)
def get_permission_matrix(db: Session = Depends(get_db),
                          _actor: models.User = Depends(require_permission("permissions.manage", "workspace.manage"))):
    return workspace_settings_service.permission_matrix(db)


@app.put("/workspace/permissions", response_model=schemas.PermissionMatrixResponse)
def put_permission_matrix(update: schemas.PermissionMatrixUpdate, db: Session = Depends(get_db),
                          actor: models.User = Depends(require_permission("permissions.manage"))):
    return workspace_settings_service.update_permission_matrix(actor, update, db)


@app.post("/workspace/permissions/roles", response_model=schemas.PermissionMatrixResponse)
def post_system_role(create: schemas.SystemRoleCreate, db: Session = Depends(get_db),
                     actor: models.User = Depends(require_permission("permissions.manage"))):
    return workspace_settings_service.create_system_role(actor, create, db)


@app.delete("/workspace/permissions/roles/{role_id}", response_model=schemas.PermissionMatrixResponse)
def delete_system_role(role_id: int, db: Session = Depends(get_db),
                       actor: models.User = Depends(require_permission("permissions.manage"))):
    return workspace_settings_service.delete_system_role(actor, role_id, db)


@app.get("/workspace/audit", response_model=schemas.AuditLogResponse)
def get_audit_log(
    category: Literal["lifecycle", "archive", "operation", "privacy", "ai", "permissions", "accounts"] | None = Query(default=None),
    campaign_id: int | None = Query(default=None, gt=0),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=10_000),
    db: Session = Depends(get_db),
    _actor: models.User = Depends(require_permission("audit.read")),
):
    return workspace_settings_service.audit_log(db, category=category, campaign_id=campaign_id,
                                                limit=limit, offset=offset)


def get_or_create_company_role(role_name: str, db: Session):
    company_role = (
        db.query(models.CompanyRole)
        .filter(func.lower(models.CompanyRole.name) == role_name.lower())
        .first()
    )
    if company_role is None:
        company_role = models.CompanyRole(name=role_name)
        db.add(company_role)
        db.flush()
    return company_role


def employee_username(name: str, email: str, used: set[str]) -> str:
    # The login uses user IDs; username remains unique even when display names repeat.
    for candidate in (name, email):
        if candidate not in used:
            used.add(candidate)
            return candidate
    suffix = 2
    while True:
        candidate = f"{email}-{suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        suffix += 1


@app.post("/people/employees", response_model=schemas.PeopleEmployeeResponse)
def create_people_employee(employee: schemas.PeopleEmployeeCreate, db: Session = Depends(get_db),
                           actor: models.User = Depends(require_permission("employees.manage")),
                           _group_manager: models.User = Depends(require_permission("groups.manage"))):
    name = " ".join(employee.name.split())
    role_name = employee.role.strip()
    if name == "" or role_name == "":
        raise HTTPException(status_code=400, detail="Name and role are required")

    email = normalized_email(employee.email)
    if email_taken(email, db):
        raise HTTPException(status_code=409, detail="Employee email already exists")

    group_ids = sorted(set(employee.group_ids))
    groups = []
    if len(group_ids) > 0:
        groups = (
            db.query(models.CompanyGroup)
            .filter(models.CompanyGroup.id.in_(group_ids))
            .order_by(models.CompanyGroup.name.asc())
            .all()
        )
        if len(groups) != len(group_ids):
            raise HTTPException(status_code=400, detail="Invalid group selection")

    used = {username for (username,) in db.query(models.User.username).all()}
    try:
        company_role = get_or_create_company_role(role_name, db)
        system_role = db.query(models.SystemRole).filter(models.SystemRole.name == "Employee").first()
        if system_role is None:
            raise HTTPException(status_code=500, detail="Employee system role is unavailable")
        new_user = models.User(
            username=employee_username(name, email, used),
            email=email,
            password_hash="",
            system_role_id=system_role.id,
            is_active=True,
        )
        db.add(new_user)
        db.flush()
        new_employee = models.Employee(user_id=new_user.id, full_name=name, company_role_id=company_role.id, is_active=True)
        db.add(new_employee)
        db.flush()
        for group in groups:
            db.execute(
                models.employee_company_groups.insert().values(
                    employee_id=new_employee.id,
                    company_group_id=group.id,
                )
            )
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Employee email or username already exists") from error
    except Exception:
        db.rollback()
        raise
    new_user = auth0_management.invite_user(new_user, actor, db)
    counts = group_member_counts([group.id for group in groups], db)

    return {
        "id": new_employee.id,
        "user_id": new_user.id,
        "username": new_user.username,
        "full_name": new_employee.full_name,
        "email": new_user.email,
        "company_role_id": new_employee.company_role_id,
        "role_name": company_role.name,
        "groups": [
            {
                "id": group.id,
                "name": group.name,
                "description": group.description,
                "member_count": counts.get(group.id, 0),
            }
            for group in groups
        ],
        "is_active": new_employee.is_active,
        **account_fields(new_user, db),
    }


@app.put("/people/employees/{employee_id}", response_model=schemas.PeopleEmployeeResponse)
def update_people_employee(employee_id: int, employee: schemas.PeopleEmployeeUpdate, db: Session = Depends(get_db),
                           _employee_manager: models.User = Depends(require_permission("employees.manage")),
                           _group_manager: models.User = Depends(require_permission("groups.manage"))):
    person = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if person is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    user = person.user
    if user is None:
        raise HTTPException(status_code=409, detail="An account must be linked before updating an employee email")

    name = " ".join(employee.name.split())
    role_name = employee.role.strip()
    if name == "" or role_name == "":
        raise HTTPException(status_code=400, detail="Name and role are required")

    email = normalized_email(employee.email)
    if email_taken(email, db, except_user_id=user.id):
        raise HTTPException(status_code=409, detail="Employee email already exists")
    if user.auth0_user_id and email != normalized_email(user.email):
        # Auth0 still has the old address; changing only ours would send invitations and resets astray.
        raise HTTPException(status_code=409, detail="The email cannot be changed after the sign-in account is created")

    company_role = get_or_create_company_role(role_name, db)
    group_ids = sorted(set(employee.group_ids))
    groups = []
    if len(group_ids) > 0:
        groups = (
            db.query(models.CompanyGroup)
            .filter(models.CompanyGroup.id.in_(group_ids))
            .order_by(models.CompanyGroup.name.asc())
            .all()
        )
        if len(groups) != len(group_ids):
            raise HTTPException(status_code=400, detail="Invalid group selection")

    current_group_ids = {group_id for (group_id,) in db.query(models.employee_company_groups.c.company_group_id)
        .filter(models.employee_company_groups.c.employee_id == employee_id).all()}
    affected_campaigns = scheduled_campaigns_for_groups(current_group_ids | set(group_ids), db)
    for removed_group_id in current_group_ids - set(group_ids):
        ensure_group_membership_mutable(removed_group_id, employee_id, db)
    if person.company_role_id != company_role.id:
        ensure_group_membership_mutable(None, employee_id, db, role_change=True)

    person.full_name = name
    user.email = email
    person.company_role_id = company_role.id

    db.execute(
        models.employee_company_groups.delete().where(
            models.employee_company_groups.c.employee_id == employee_id
        )
    )
    for group in groups:
        db.execute(
            models.employee_company_groups.insert().values(
                employee_id=employee_id,
                company_group_id=group.id,
            )
        )

    db.flush()
    for campaign in affected_campaigns:
        validate_scheduled_campaign(campaign, db)
    db.commit()
    db.refresh(person)
    counts = group_member_counts([group.id for group in groups], db)

    return {
        "id": person.id,
        "user_id": user.id,
        "username": user.username,
        "full_name": person.full_name,
        "email": user.email,
        "company_role_id": person.company_role_id,
        "role_name": company_role.name,
        "groups": [
            {
                "id": group.id,
                "name": group.name,
                "description": group.description,
                "member_count": counts.get(group.id, 0),
            }
            for group in groups
        ],
        "is_active": person.is_active,
        "profile_image_url": person.profile_image_url,
        **account_fields(user, db),
    }


@app.put("/people/employees/{employee_id}/system-role", response_model=schemas.SystemRoleOption)
def update_people_employee_system_role(employee_id: int, update: schemas.EmployeeSystemRoleUpdate,
                                       db: Session = Depends(get_db),
                                       actor: models.User = Depends(require_permission("roles.assign"))):
    person = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if person is None or person.user is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    role = workspace_settings_service.change_user_system_role(actor, person.user, update.system_role_id, db)
    return {"id": role.id, "name": role.name, "description": role.description}


@app.post("/people/employees/{employee_id}/invitation", response_model=schemas.PeopleEmployeeResponse)
def resend_employee_invitation(employee_id: int, db: Session = Depends(get_db),
                               actor: models.User = Depends(require_permission("employees.manage"))):
    person = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if person is None or person.user is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    if not person.is_active or not person.user.is_active:
        raise HTTPException(status_code=409, detail="Inactive employees cannot be invited")
    if not auth0_management.password_reset_available():
        raise HTTPException(status_code=503, detail="Sign-in invitations are not configured on the server")
    user = auth0_management.invite_user(person.user, actor, db, enforce_cooldown=True)
    group_ids = [group_id for (group_id,) in db.query(models.employee_company_groups.c.company_group_id)
                 .filter(models.employee_company_groups.c.employee_id == person.id)]
    groups = db.query(models.CompanyGroup).filter(models.CompanyGroup.id.in_(group_ids)) \
        .order_by(models.CompanyGroup.name.asc()).all() if group_ids else []
    counts = group_member_counts(group_ids, db)
    role = db.get(models.CompanyRole, person.company_role_id)
    return {
        "id": person.id, "user_id": user.id, "username": user.username, "full_name": person.full_name,
        "email": user.email, "company_role_id": person.company_role_id,
        "role_name": role.name if role else "Unknown role",
        "groups": [{"id": group.id, "name": group.name, "description": group.description,
                    "member_count": counts.get(group.id, 0)} for group in groups],
        "is_active": person.is_active,
        "profile_image_url": person.profile_image_url,
        **account_fields(user, db),
    }


@app.post("/people/groups", response_model=schemas.PeopleGroupResponse)
def create_people_group(group: schemas.PeopleGroupCreate, db: Session = Depends(get_db),
                        _group_manager: models.User = Depends(require_permission("groups.manage"))):
    name = group.name.strip()
    description = group.description.strip() if group.description is not None else None
    if name == "":
        raise HTTPException(status_code=400, detail="Group name is required")

    existing_group = (
        db.query(models.CompanyGroup)
        .filter(func.lower(models.CompanyGroup.name) == name.lower())
        .first()
    )
    if existing_group is not None:
        raise HTTPException(status_code=400, detail="Group name already exists")

    new_group = models.CompanyGroup(name=name, description=description)
    db.add(new_group)
    db.flush()
    leader_ids = set_group_leaders(new_group.id, group.leader_ids or [], db)
    db.commit()
    db.refresh(new_group)
    return {
        "id": new_group.id,
        "name": new_group.name,
        "description": new_group.description,
        "member_count": 0,
        "leader_ids": leader_ids,
    }


@app.put("/people/groups/{group_id}", response_model=schemas.PeopleGroupResponse)
def update_people_group(group_id: int, group: schemas.PeopleGroupUpdate, db: Session = Depends(get_db),
                        _group_manager: models.User = Depends(require_permission("groups.manage"))):
    existing_group = db.query(models.CompanyGroup).filter(models.CompanyGroup.id == group_id).first()
    if existing_group is None:
        raise HTTPException(status_code=404, detail="Group not found")

    name = group.name.strip()
    description = group.description.strip() if group.description is not None else None
    if name == "":
        raise HTTPException(status_code=400, detail="Group name is required")

    duplicate_group = (
        db.query(models.CompanyGroup)
        .filter(models.CompanyGroup.id != group_id)
        .filter(func.lower(models.CompanyGroup.name) == name.lower())
        .first()
    )
    if duplicate_group is not None:
        raise HTTPException(status_code=400, detail="Group name already exists")

    existing_group.name = name
    existing_group.description = description
    if group.leader_ids is not None:
        set_group_leaders(group_id, group.leader_ids, db)
    db.commit()
    db.refresh(existing_group)

    member_count = (
        db.query(models.employee_company_groups)
        .filter(models.employee_company_groups.c.company_group_id == group_id)
        .count()
    )
    return {
        "id": existing_group.id,
        "name": existing_group.name,
        "description": existing_group.description,
        "member_count": member_count,
        "leader_ids": group_leader_ids([group_id], db).get(group_id, []),
    }


@app.post("/people/groups/{group_id}/members", response_model=schemas.PeopleGroupResponse)
def add_people_group_member(group_id: int, member: schemas.PeopleGroupMemberCreate, db: Session = Depends(get_db),
                            _group_manager: models.User = Depends(require_permission("groups.manage"))):
    group = db.query(models.CompanyGroup).filter(models.CompanyGroup.id == group_id).first()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")

    person = db.query(models.Employee).filter(models.Employee.id == member.employee_id).first()
    if person is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    existing_membership = (
        db.query(models.employee_company_groups)
        .filter(models.employee_company_groups.c.employee_id == member.employee_id)
        .filter(models.employee_company_groups.c.company_group_id == group_id)
        .first()
    )
    if existing_membership is not None:
        raise HTTPException(status_code=400, detail="Employee is already in this group")

    affected_campaigns = scheduled_campaigns_for_groups({group_id}, db)
    db.execute(
        models.employee_company_groups.insert().values(
            employee_id=member.employee_id,
            company_group_id=group_id,
        )
    )
    for campaign in affected_campaigns:
        validate_scheduled_campaign(campaign, db)
    db.commit()

    member_count = (
        db.query(models.employee_company_groups)
        .filter(models.employee_company_groups.c.company_group_id == group_id)
        .count()
    )
    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "member_count": member_count,
    }


@app.delete(
    "/people/groups/{group_id}/members/{employee_id}",
    response_model=schemas.PeopleGroupResponse,
)
def remove_people_group_member(
    group_id: int,
    employee_id: int,
    db: Session = Depends(get_db),
    _group_manager: models.User = Depends(require_permission("groups.manage")),
):
    group = db.query(models.CompanyGroup).filter(models.CompanyGroup.id == group_id).first()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")

    person = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if person is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    affected_campaigns = scheduled_campaigns_for_groups({group_id}, db)
    ensure_group_membership_mutable(group_id, employee_id, db)

    delete_result = db.execute(
        models.employee_company_groups.delete()
        .where(models.employee_company_groups.c.employee_id == employee_id)
        .where(models.employee_company_groups.c.company_group_id == group_id)
    )
    if delete_result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Employee is not in this group")

    for campaign in affected_campaigns:
        validate_scheduled_campaign(campaign, db)
    db.commit()

    member_count = (
        db.query(models.employee_company_groups)
        .filter(models.employee_company_groups.c.company_group_id == group_id)
        .count()
    )
    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "member_count": member_count,
    }


@app.post("/people/groups/import", response_model=schemas.PeopleGroupImportResponse)
def import_people_groups(file: UploadFile = File(...), db: Session = Depends(get_db),
                         _group_manager: models.User = Depends(require_permission("groups.manage"))):
    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload the provided .xlsx group template.")

    try:
        workbook = load_workbook(file.file, data_only=True)
        worksheet = workbook.active
    except Exception:
        raise HTTPException(status_code=400, detail="The uploaded Excel file could not be read.")

    headers = [worksheet.cell(1, column).value for column in range(1, len(GROUP_IMPORT_HEADERS) + 1)]
    if headers != GROUP_IMPORT_HEADERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid template columns. Expected: {', '.join(GROUP_IMPORT_HEADERS)}.",
        )

    errors = []
    rows = []
    seen_names = set()
    existing_names = {
        name.lower()
        for (name,) in db.query(models.CompanyGroup.name).all()
    }

    for row_number in range(2, worksheet.max_row + 1):
        values = [worksheet.cell(row_number, column).value for column in range(1, 3)]
        if all(value is None or str(value).strip() == "" for value in values):
            continue

        name = str(values[0]).strip() if values[0] is not None else ""
        description = str(values[1]).strip() if values[1] is not None else ""

        if name == "":
            errors.append(f"Row {row_number}: Group Name is required.")

        name_key = name.lower()
        if name_key != "" and name_key in seen_names:
            errors.append(f"Row {row_number}: Group Name is duplicated in the file.")
        if name_key != "" and name_key in existing_names:
            errors.append(f"Row {row_number}: Group Name already exists in the database.")

        seen_names.add(name_key)
        rows.append((name, description))

    if len(rows) == 0:
        errors.append("The uploaded template does not contain any group rows.")

    if len(errors) > 0:
        return {"created_count": 0, "errors": errors}

    for name, description in rows:
        db.add(
            models.CompanyGroup(
                name=name,
                description=description if description != "" else None,
            )
        )

    db.commit()
    return {"created_count": len(rows), "errors": []}


@app.post("/people/employees/import", response_model=schemas.PeopleEmployeeImportResponse)
def import_people_employees(file: UploadFile = File(...), db: Session = Depends(get_db),
                            actor: models.User = Depends(require_permission("employees.manage")),
                            _role_assigner: models.User = Depends(require_permission("roles.assign"))):
    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload the provided .xlsx employee template.")

    try:
        workbook = load_workbook(file.file, data_only=True)
        worksheet = workbook.active
    except Exception:
        raise HTTPException(status_code=400, detail="The uploaded Excel file could not be read.")

    headers = [worksheet.cell(1, column).value for column in range(1, len(EMPLOYEE_IMPORT_HEADERS) + 1)]
    if headers != EMPLOYEE_IMPORT_HEADERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid template columns. Expected: {', '.join(EMPLOYEE_IMPORT_HEADERS)}.",
        )

    errors = []
    rows = []
    seen_emails = set()
    used_usernames = {username for (username,) in db.query(models.User.username).all()}
    existing_emails = {
        email.lower()
        for (email,) in db.query(models.User.email).all()
    }
    actor_permissions = workspace_settings_service.role_permissions(db, actor.system_role_id)
    # Importing must not hand out more access than the importer holds.
    system_roles = {role.name.casefold(): role for role in db.query(models.SystemRole).all()
                    if workspace_settings_service.role_permissions(db, role.id) <= actor_permissions}

    for row_number in range(2, worksheet.max_row + 1):
        values = [worksheet.cell(row_number, column).value for column in range(1, 5)]
        if all(value is None or str(value).strip() == "" for value in values):
            continue

        name = str(values[0]).strip() if values[0] is not None else ""
        email = str(values[1]).strip() if values[1] is not None else ""
        company_role_name = str(values[2]).strip() if values[2] is not None else ""
        system_role_name = str(values[3]).strip() if values[3] is not None else ""

        if name == "":
            errors.append(f"Row {row_number}: Employee Name is required.")
        if email == "":
            errors.append(f"Row {row_number}: Employee Email Address is required.")
        else:
            try:
                email_validator.validate_python(email)
            except ValidationError:
                errors.append(f"Row {row_number}: Employee Email Address is not a valid email.")
        if company_role_name == "":
            errors.append(f"Row {row_number}: Employee Company Role is required.")
        if system_role_name == "":
            errors.append(f"Row {row_number}: Employee System Role is required.")
        elif system_role_name.casefold() not in system_roles:
            errors.append(f"Row {row_number}: Employee System Role must be an existing system role you are allowed to assign.")

        email_key = email.lower()
        if email_key != "" and email_key in seen_emails:
            errors.append(f"Row {row_number}: Employee Email Address is duplicated in the file.")
        if email_key != "" and email_key in existing_emails:
            errors.append(f"Row {row_number}: Employee Email Address already exists in the database.")

        seen_emails.add(email_key)
        rows.append((row_number, name, email_key, company_role_name, system_role_name))

    if len(rows) == 0:
        errors.append("The uploaded template does not contain any employee rows.")

    if len(errors) > 0:
        return {"created_count": 0, "errors": errors}

    created: list[tuple[int, models.User]] = []
    try:
        for row_number, name, email, company_role_name, system_role_name in rows:
            company_role = get_or_create_company_role(company_role_name, db)
            system_role = system_roles[system_role_name.casefold()]
            new_user = models.User(
                    username=employee_username(" ".join(name.split()), email, used_usernames),
                    email=email,
                    password_hash="",
                    system_role_id=system_role.id,
                    is_active=True,
                )
            db.add(new_user)
            db.flush()
            db.add(models.Employee(user_id=new_user.id, full_name=" ".join(name.split()),
                                   company_role_id=company_role.id, is_active=True))
            created.append((row_number, new_user))
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Employee email or username already exists") from error
    except Exception:
        db.rollback()
        raise

    # Employees are already saved; a failed invitation can be resent from the People page.
    invitations_sent, invitation_errors = 0, []
    for row_number, new_user in created:
        invited = auth0_management.invite_user(new_user, actor, db)
        if invited.invitation_status == "sent":
            invitations_sent += 1
        elif invited.invitation_status == "failed":
            invitation_errors.append(f"Row {row_number} ({invited.email}): {invitation_error_message(invited.invitation_error)}")
    return {"created_count": len(rows), "errors": [], "invitations_sent": invitations_sent,
            "invitation_errors": invitation_errors}


def get_campaign_form_ids(campaign_id: int, db: Session):
    rule_form_ids = {
        form_id
        for (form_id,) in db.query(models.CampaignEvaluationRule.form_id)
        .filter(models.CampaignEvaluationRule.campaign_id == campaign_id)
        .distinct()
        .all()
    }
    filled_form_ids = {
        form_id
        for (form_id,) in db.query(models.FilledForm.form_id)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .distinct()
        .all()
    }

    return sorted((rule_form_ids | filled_form_ids) - {None})


def get_campaign_participant_count(campaign_id: int, db: Session):
    evaluator_ids = {
        employee_id
        for (employee_id,) in db.query(models.FilledForm.evaluator_id)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .distinct()
        .all()
    }
    evaluatee_ids = {
        employee_id
        for (employee_id,) in db.query(models.FilledForm.evaluatee_id)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .distinct()
        .all()
    }

    return len(evaluator_ids | evaluatee_ids)


def get_campaign_participants(campaign_id: int, db: Session):
    assigned_group_ids = get_campaign_assigned_group_ids(campaign_id, db)
    if len(assigned_group_ids) == 0:
        return []

    rows = (
        db.query(models.Employee, models.User, models.CompanyRole, models.CompanyGroup)
        .outerjoin(models.User, models.User.id == models.Employee.user_id)
        .join(models.CompanyRole, models.CompanyRole.id == models.Employee.company_role_id)
        .join(models.employee_company_groups, models.employee_company_groups.c.employee_id == models.Employee.id)
        .join(models.CompanyGroup, models.CompanyGroup.id == models.employee_company_groups.c.company_group_id)
        .filter(models.employee_company_groups.c.company_group_id.in_(assigned_group_ids))
        .filter(models.Employee.is_active.is_(True))
        .filter(or_(models.Employee.user_id.is_(None), models.User.is_active.is_(True)))
        .order_by(models.Employee.full_name.asc(), models.CompanyGroup.name.asc())
        .all()
    )

    participants_by_id = {}
    evaluations_left_by_user_id = dict(
        db.query(models.FilledForm.evaluator_id, func.count(models.FilledForm.id))
        .filter(models.FilledForm.campaign_id == campaign_id)
        .filter(models.FilledForm.finish_date.is_(None))
        .filter(issued_snapshot_filter())
        .group_by(models.FilledForm.evaluator_id)
        .all()
    )
    for employee, user, role, group in rows:
        participant = participants_by_id.setdefault(
            employee.id,
            {
                "employee_id": employee.id,
                "name": employee.full_name,
                "email": user.email if user else None,
                "profile_image_url": employee.profile_image_url,
                "role_name": role.name,
                "groups": [],
                "evaluations_left": evaluations_left_by_user_id.get(employee.id, 0),
            },
        )
        participant["groups"].append(group.name)

    return list(participants_by_id.values())


def campaign_lifecycle_status(campaign: models.Campaign, today: date) -> str:
    return {
        models.CampaignStatus.DRAFT.value: "Disabled",
        models.CampaignStatus.SCHEDULED.value: "Scheduled",
        models.CampaignStatus.ACTIVE.value: "Ongoing",
        models.CampaignStatus.PAUSED.value: "Disabled",
        models.CampaignStatus.REVIEW.value: "Completed",
        models.CampaignStatus.CLOSED.value: "Completed",
    }[campaign.status]


def campaign_payload(campaign: models.Campaign, today: date, issued: int = 0, submitted: int = 0) -> dict:
    return {**campaign.__dict__, "start_date": business_date(campaign.start_date),
            "end_date": business_date(campaign.end_date), "start_at": campaign_instant(campaign.start_date),
            "end_at": campaign_instant(campaign.end_date), "campaign_status": campaign.status,
            "current_date": today, "lifecycle_status": campaign_lifecycle_status(campaign, today),
            "activation_error": campaign.lifecycle_error if campaign.status == models.CampaignStatus.SCHEDULED.value else None,
            "activation_retry_at": campaign.lifecycle_retry_at if campaign.status == models.CampaignStatus.SCHEDULED.value else None,
            "activation_attempts": campaign.lifecycle_attempts if campaign.status == models.CampaignStatus.SCHEDULED.value else 0,
             "issued_forms_count": issued, "submitted_forms_count": submitted}


def require_mutable_campaign_configuration(campaign: models.Campaign) -> None:
    if campaign.is_archived:
        raise HTTPException(status_code=409, detail="Archived campaign configuration cannot be changed")
    if campaign.status in {models.CampaignStatus.PAUSED.value, models.CampaignStatus.REVIEW.value,
                           models.CampaignStatus.CLOSED.value}:
        raise HTTPException(status_code=409, detail="Campaign configuration is locked in this lifecycle status")


def require_mutable_campaign_plan(campaign: models.Campaign) -> None:
    if campaign.is_archived or campaign.status == models.CampaignStatus.CLOSED.value:
        raise HTTPException(status_code=409, detail="Campaign plan is locked in this lifecycle status")


def unissued_snapshot_filter():
    # Older planned rows may contain JSON null; new rows use SQL NULL.
    return or_(models.FilledForm.form_snapshot.is_(None), models.FilledForm.form_snapshot == JSONB.NULL)


def issued_snapshot_filter():
    return and_(models.FilledForm.form_snapshot.isnot(None), models.FilledForm.form_snapshot != JSONB.NULL)


def ensure_campaign_issued(campaign_id: int, db: Session, *, commit: bool = True,
                           actor_user_id: int | None = None):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    now = datetime.now(timezone.utc)
    if (campaign is None or campaign.legacy_issuance_blocked
            or campaign.status not in {models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value}
            or campaign.is_archived or campaign.start_date > now
            or (campaign.status == models.CampaignStatus.ACTIVE.value
                and campaign.end_date is not None and campaign.end_date <= now)):
        return []

    errors = issue_activation_snapshots(campaign, db, actor_user_id=actor_user_id, require_all=False)
    if commit:
        db.commit()
    return errors


def unschedule_if_incomplete(campaign: models.Campaign, db: Session, actor_user_id: int) -> None:
    if campaign.status == models.CampaignStatus.SCHEDULED.value and validate_campaign_configuration(campaign, db):
        campaign_lifecycle.transition_campaign(
            db, campaign.id, models.CampaignStatus.DRAFT,
            now=datetime.now(timezone.utc), actor_user_id=actor_user_id,
        )


def issue_activation_snapshots(campaign: models.Campaign, db: Session,
                               *, actor_user_id: int | None = None, require_all: bool = True) -> list[str]:
    """Issue only untouched planned rows; caller owns the campaign lock and transaction."""
    errors = []
    issued_count = 0
    group_members = {}
    self_form_ids = None
    for assignment in db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign.id,
        unissued_snapshot_filter(),
    ).order_by(models.FilledForm.id).all():
        # Historical answers cannot be reconstructed from today's editable form.
        if assignment.finish_date is not None or assignment.answers:
            continue
        if assignment.form_id is None:
            if require_all:
                errors.append(f"Assignment {assignment.id}: select a form before issuance")
            continue
        if not require_all:
            if assignment.company_group_id not in group_members:
                group_members[assignment.company_group_id] = {
                    person.id: person for person, _role in get_group_employees(assignment.company_group_id, db)
                } if assignment.company_group_id is not None else {}
            members = group_members[assignment.company_group_id]
            evaluator = members.get(assignment.evaluator_id)
            evaluatee = members.get(assignment.evaluatee_id)
            if evaluator is None or evaluatee is None:
                errors.append(f"Assignment {assignment.id}: employees are not active members of the selected group")
                continue
            if assignment.evaluator_id == assignment.evaluatee_id:
                if self_form_ids is None:
                    self_form_ids = {row.employee_id: row.form_id for row in db.query(models.CampaignEmployeeSelfEvaluation)
                                     .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign.id)}
                expected = self_form_ids.get(assignment.evaluator_id)
            else:
                expected = get_form_id_for_employee_pair(
                    campaign.id, assignment.company_group_id, evaluator, evaluatee, db)
            if expected != assignment.form_id:
                errors.append(f"Assignment {assignment.id}: saved questionnaire no longer matches the pair's role assignment")
                continue
        form = db.query(models.Form).filter(models.Form.id == assignment.form_id).first()
        if form is None:
            errors.append(f"Assignment {assignment.id}: source form no longer exists")
            continue
        problems = form_issuance_errors(form.questions if isinstance(form.questions, list) else [], db)
        if problems:
            errors.append(f"Assignment {assignment.id} ({form.name}): {' '.join(problems)}")
            continue
        assignment.form_snapshot = form_snapshot_service.create_form_snapshot(form, db)
        assignment.snapshot_status = "verified"
        issued_count += 1

    campaign_lifecycle.record_snapshot_issuance(db, campaign, issued_count, actor_user_id=actor_user_id)
    return errors


def assignment_is_immutable(assignment):
    # Existing answers without a snapshot are historical and must also stay untouched.
    return assignment.form_snapshot is not None or assignment.finish_date is not None or bool(assignment.answers)


def ensure_group_membership_mutable(group_id: int | None, employee_id: int, db: Session, *, role_change: bool = False):
    assignment_query = db.query(models.FilledForm).filter(
        or_(models.FilledForm.evaluator_id == employee_id, models.FilledForm.evaluatee_id == employee_id),
    )
    if group_id is not None:
        assignment_query = assignment_query.filter(models.FilledForm.company_group_id == group_id)
    existing_assignments = assignment_query.all()
    campaign_ids = {assignment.campaign_id for assignment in existing_assignments}
    campaigns = (db.query(models.Campaign).filter(models.Campaign.id.in_(campaign_ids))
                 .order_by(models.Campaign.id).with_for_update().all()) if campaign_ids else []
    if any(campaign.status in {
        models.CampaignStatus.ACTIVE.value, models.CampaignStatus.PAUSED.value,
        models.CampaignStatus.REVIEW.value, models.CampaignStatus.CLOSED.value,
    } for campaign in campaigns):
        raise HTTPException(status_code=409, detail="Employees with active or historical campaign assignments cannot be removed or change roles")
    if any(assignment_is_immutable(assignment) for assignment in existing_assignments):
        detail = "Employee role cannot change while this group has issued evaluations" if role_change else "Employee cannot be removed from this group while issued evaluations reference them"
        raise HTTPException(status_code=409, detail=detail)


@app.get("/users/{user_id}/assigned-evaluations", response_model=list[schemas.AssignedEvaluationResponse])
def get_assigned_evaluations(user_id: int, db: Session = Depends(get_db),
                             actor: models.User = Depends(require_permission("evaluations.read_assigned")),
                             employee: models.Employee = Depends(get_current_employee)):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Assigned evaluations not found")
    return list_employee_evaluations(employee, db)


def issued_employee_questions(filled_form: models.FilledForm) -> list[dict]:
    snapshot = filled_form.form_snapshot
    if isinstance(snapshot, dict) and isinstance(snapshot.get("questions"), list):
        return snapshot["questions"]
    # Historical issued snapshots may contain the question list directly.
    return snapshot if isinstance(snapshot, list) else []


def questionnaire_can_edit(campaign: models.Campaign, filled_form: models.FilledForm, now: datetime) -> bool:
    return (filled_form.finish_date is None
            and campaign.status in {models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value}
            and not campaign.is_archived and campaign.start_date <= now
            and isinstance(filled_form.form_snapshot, (dict, list)))


def list_employee_evaluations(employee: models.Employee, db: Session) -> list[dict]:

    rows = (
        db.query(
            models.FilledForm,
            models.Campaign,
            models.Form,
            models.FormStatus,
            models.Employee,
        )
        .join(models.Campaign, models.Campaign.id == models.FilledForm.campaign_id)
        .join(models.Form, models.Form.id == models.FilledForm.form_id)
        .join(models.FormStatus, models.FormStatus.id == models.FilledForm.status_id)
        .join(models.Employee, models.Employee.id == models.FilledForm.evaluatee_id)
        .filter(models.FilledForm.evaluator_id == employee.id)
        .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
        .order_by(
            models.FilledForm.finish_date.isnot(None).asc(),
            models.Campaign.end_date.asc().nullslast(),
            models.FilledForm.created_at.desc(),
        )
        .all()
    )

    today = campaign_today()
    now = datetime.now(timezone.utc)
    evaluations = []
    for filled_form, campaign, form, status, evaluatee in rows:
        if campaign.status not in {models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value} or campaign.is_archived:
            continue
        can_edit = questionnaire_can_edit(campaign, filled_form, now)
        if filled_form.finish_date is None and not can_edit:
            continue
        questions = issued_employee_questions(filled_form)
        answers = filled_form.answers if isinstance(filled_form.answers, list) else []
        issued_questions = list(form_snapshot_service.iter_snapshot_questions(questions))
        question_ids = {question.get("id") for question in issued_questions if isinstance(question.get("id"), str)}
        answered_count = len({answer.get("question_id") for answer in answers if isinstance(answer, dict) and answer.get("question_id") in question_ids})

        evaluations.append({
            "id": filled_form.id,
            "evaluator_id": filled_form.evaluator_id,
            "campaign_id": campaign.id,
            "campaign_name": campaign.name,
            "campaign_start_date": business_date(campaign.start_date),
            "campaign_start_at": campaign_instant(campaign.start_date),
            "campaign_end_at": campaign_instant(campaign.end_date),
            "is_overdue": campaign_lifecycle.is_overdue(filled_form, campaign, now=now),
            "can_edit": can_edit,
            "campaign_is_active": campaign.is_active,
            "campaign_status": campaign.status,
            "campaign_lifecycle_status": campaign_lifecycle_status(campaign, today),
            "current_date": today,
            "form_id": form.id,
            "form_name": form_snapshot_service.snapshot_form_name(filled_form, form),
            "form_description": form_snapshot_service.snapshot_form_description(filled_form, form),
            "evaluatee_id": evaluatee.id,
            "evaluatee_name": evaluatee.full_name,
            "status_name": status.name,
            "due_date": business_date(campaign.end_date),
            "finish_date": filled_form.finish_date,
            "question_count": len(issued_questions),
            "answered_count": answered_count,
            "created_at": filled_form.created_at,
        })

    return evaluations


@app.get("/users/{user_id}/assigned-evaluations/{evaluation_id}", response_model=schemas.AssignedQuestionnaireResponse)
def get_assigned_questionnaire(user_id: int, evaluation_id: int, db: Session = Depends(get_db),
                               actor: models.User = Depends(require_permission("evaluations.read_assigned")),
                               employee: models.Employee = Depends(get_current_employee)):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    return employee_questionnaire(employee, evaluation_id, db)


def employee_questionnaire(employee: models.Employee, evaluation_id: int, db: Session) -> dict:
    if db.query(models.FilledForm.id).filter(
        models.FilledForm.id == evaluation_id, models.FilledForm.evaluator_id == employee.id,
    ).first() is None:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    evaluation = next((item for item in list_employee_evaluations(employee, db) if item["id"] == evaluation_id), None)
    if evaluation is None:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    filled_form = db.query(models.FilledForm).filter(
        models.FilledForm.id == evaluation_id, models.FilledForm.evaluator_id == employee.id,
    ).first()
    if filled_form is None:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    if not isinstance(filled_form.form_snapshot, (dict, list)):
        raise HTTPException(status_code=403, detail="This questionnaire has not been issued")
    return {"evaluation": evaluation, "questions": issued_employee_questions(filled_form), "answers": filled_form.answers}


@app.put("/users/{user_id}/assigned-evaluations/{evaluation_id}", response_model=schemas.AssignedQuestionnaireResponse)
def update_assigned_questionnaire(user_id: int, evaluation_id: int, payload: schemas.AssignedQuestionnaireUpdate,
                                  db: Session = Depends(get_db),
                                  actor: models.User = Depends(require_permission("evaluations.submit")),
                                  employee: models.Employee = Depends(get_current_employee)):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    campaign_id = db.query(models.FilledForm.campaign_id).filter(
        models.FilledForm.id == evaluation_id, models.FilledForm.evaluator_id == employee.id,
    ).scalar()
    if campaign_id is None:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).populate_existing().with_for_update().one()
    questionnaire = employee_questionnaire(employee, evaluation_id, db)
    evaluation = questionnaire["evaluation"]
    if not evaluation["can_edit"]:
        raise HTTPException(status_code=403, detail="This questionnaire is not currently available")
    if evaluation["finish_date"] is not None:
        raise HTTPException(status_code=409, detail="This questionnaire has already been submitted")

    questions = list(form_snapshot_service.iter_snapshot_questions(questionnaire["questions"]))
    by_id = {question.get("id"): question for question in questions}
    seen = set()
    for answer in payload.answers:
        question_id = answer.get("question_id")
        if not isinstance(question_id, str) or question_id not in by_id or question_id in seen or set(answer) != {"question_id", "value"}:
            raise HTTPException(status_code=400, detail="Unknown or duplicate questionnaire answer")
        seen.add(question_id)
        question = by_id[question_id]
        value = answer["value"]
        kind = question.get("type")
        options = question.get("options", question.get("choices", []))
        choices = [option if isinstance(option, str) else next((option[key] for key in ("id", "value", "label") if option.get(key) is not None), None) for option in options if isinstance(option, (str, dict))] if isinstance(options, list) else []
        if kind in {"Scale", "Numerical scale", "Scale 1-5", "Scale 1-10"}:
            minimum = question.get("scale_min", 1)
            maximum = question.get("scale_max", 10 if kind == "Scale 1-10" else 5)
            valid = isinstance(value, int) and not isinstance(value, bool) and isinstance(minimum, int) and not isinstance(minimum, bool) and isinstance(maximum, int) and not isinstance(maximum, bool) and minimum <= value <= maximum
        elif kind == "Single choice":
            valid = isinstance(value, str) and value in choices
        elif kind == "Multiple choice":
            valid = isinstance(value, list) and len(value) > 0 and len(value) == len(set(str(item) for item in value)) and all(isinstance(item, str) and item in choices for item in value)
        elif kind == "Text":
            valid = isinstance(value, str) and value.strip() != ""
        elif kind == "Number":
            valid = isinstance(value, (int, float)) and not isinstance(value, bool)
        elif kind == "Date":
            try:
                valid = isinstance(value, str) and len(value) == 10 and date.fromisoformat(value).isoformat() == value
            except ValueError:
                valid = False
        else:
            valid = False
        if not valid:
            if kind in {"Scale", "Numerical scale", "Scale 1-5", "Scale 1-10"}:
                detail = f"Rating for question {question_id} must be a whole number from {minimum} to {maximum}"
            elif kind in {"Single choice", "Multiple choice"}:
                detail = f"Select valid issued options for question {question_id}"
            else:
                detail = f"Invalid answer for question {question_id}"
            raise HTTPException(status_code=400, detail=detail)
    if payload.submit and (not questions or any(question.get("required") and question.get("id") not in seen for question in questions)):
        raise HTTPException(status_code=400, detail="Answer all required questions before submitting")

    filled_form = db.query(models.FilledForm).filter(
        models.FilledForm.id == evaluation_id, models.FilledForm.evaluator_id == employee.id,
    ).with_for_update().first()
    if filled_form is None:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    if filled_form.finish_date is not None or filled_form.form_snapshot is None:
        raise HTTPException(status_code=409, detail="This questionnaire is no longer available for editing")
    if not questionnaire_can_edit(campaign, filled_form, datetime.now(timezone.utc)):
        raise HTTPException(status_code=403, detail="This questionnaire is not currently available")
    filled_form.answers = payload.answers
    status_name = "Completed" if payload.submit else "In progress"
    status = db.query(models.FormStatus).filter(func.lower(models.FormStatus.name) == status_name.lower()).first()
    if status is None:
        status = models.FormStatus(name=status_name)
        db.add(status)
        db.flush()
    filled_form.status_id = status.id
    if payload.submit:
        filled_form.finish_date = campaign_today()
    db.commit()
    return employee_questionnaire(employee, evaluation_id, db)


@app.get("/users/{user_id}/employee-dashboard", response_model=schemas.EmployeeDashboardResponse)
def get_employee_dashboard(user_id: int, db: Session = Depends(get_db),
                           actor: models.User = Depends(require_permission("evaluations.read_assigned")),
                           employee: models.Employee = Depends(get_current_employee)):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Assigned evaluations not found")
    evaluations = list_employee_evaluations(employee, db)
    restricted_campaigns = (db.query(models.Campaign.id, models.Campaign.name, models.Campaign.status)
                            .join(models.FilledForm, models.FilledForm.campaign_id == models.Campaign.id)
                            .filter(models.FilledForm.evaluator_id == employee.id,
                                    models.Campaign.status.in_([
                                        models.CampaignStatus.PAUSED.value, models.CampaignStatus.CLOSED.value,
                                     ]))
                             .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
                             .distinct().all())
    open_evaluations = [evaluation for evaluation in evaluations if evaluation["finish_date"] is None]
    completed_evaluations = [evaluation for evaluation in evaluations if evaluation["finish_date"] is not None]
    active_campaign = (
        db.query(models.Campaign)
        .join(models.FilledForm, models.FilledForm.campaign_id == models.Campaign.id)
        .filter(models.FilledForm.evaluator_id == employee.id)
        .filter(models.Campaign.status.in_([
            models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value,
        ]))
        .filter(models.Campaign.is_archived.is_(False))
        .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
        .order_by((models.Campaign.status == models.CampaignStatus.ACTIVE.value).desc(),
                  models.Campaign.end_date.asc().nullslast(), models.Campaign.start_date.asc())
        .first()
    )
    next_campaign = None
    if active_campaign is None:
        next_campaign = (
            db.query(models.Campaign)
            .join(models.FilledForm, models.FilledForm.campaign_id == models.Campaign.id)
            .filter(models.FilledForm.evaluator_id == employee.id)
            .filter(models.Campaign.start_date >= datetime.now(timezone.utc))
            .filter(models.Campaign.status == models.CampaignStatus.ACTIVE.value)
            .filter(models.Campaign.is_archived.is_(False))
            .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
            .order_by(models.Campaign.start_date.asc())
            .first()
        )

    campaign_date_label = ("Campaign deadline" if active_campaign.status == models.CampaignStatus.REVIEW.value
                           else "Campaign ends") if active_campaign is not None else "Next campaign"
    campaign_date = (
        business_date(active_campaign.end_date)
        if active_campaign is not None
        else business_date(next_campaign.start_date) if next_campaign is not None else None
    )
    campaign_date_empty_text = "No deadline" if active_campaign is not None else "Not announced yet"
    latest_result = completed_evaluations[0] if len(completed_evaluations) > 0 else None

    return {
        "current_date": campaign_today(),
        "evaluations": evaluations,
        "restricted_campaigns": [{"campaign_id": row.id, "campaign_name": row.name,
                                   "campaign_status": row.status} for row in restricted_campaigns],
        "open_count": len(open_evaluations),
        "completed_count": len(completed_evaluations),
        "next_review_date": campaign_date,
        "campaign_date_label": campaign_date_label,
        "campaign_date": campaign_date,
        "campaign_date_empty_text": campaign_date_empty_text,
        "latest_result": latest_result,
        "history": [
            {
                "id": evaluation["id"],
                "title": evaluation["form_name"],
                "subtitle": evaluation["campaign_name"],
                "status": "Submitted" if evaluation["finish_date"] is not None else evaluation["status_name"],
                "occurred_at": evaluation["finish_date"] or evaluation["created_at"],
            }
            for evaluation in evaluations[:3]
        ],
    }


@app.get("/dashboard", response_model=schemas.DashboardResponse)
def get_dashboard(campaign_id: int | None = Query(default=None), db: Session = Depends(get_db),
                  _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaigns = (
        db.query(models.Campaign)
        .order_by(models.Campaign.is_archived.asc(),
                  case((models.Campaign.status == models.CampaignStatus.ACTIVE.value, 0),
                       (models.Campaign.status == models.CampaignStatus.REVIEW.value, 1),
                       (models.Campaign.status == models.CampaignStatus.PAUSED.value, 2),
                       (models.Campaign.status == models.CampaignStatus.SCHEDULED.value, 3),
                       (models.Campaign.status == models.CampaignStatus.DRAFT.value, 4), else_=5),
                  models.Campaign.start_date.desc())
        .all()
    )
    today = campaign_today()
    selected_campaign = None
    if campaign_id is not None:
        selected_campaign = next((campaign for campaign in campaigns if campaign.id == campaign_id), None)
        if selected_campaign is None:
            raise HTTPException(status_code=404, detail="Campaign not found")

    if selected_campaign is None and len(campaigns) > 0:
        selected_campaign = campaigns[0]

    upcoming_campaigns = (
        db.query(models.Campaign)
        .filter(models.Campaign.status == models.CampaignStatus.SCHEDULED.value,
                models.Campaign.is_archived.is_(False),
                models.Campaign.start_date >= datetime.now(timezone.utc))
        .order_by(models.Campaign.start_date.asc())
        .limit(3)
        .all()
    )

    upcoming_reviews = [
        {
            "campaign_id": campaign.id,
            "name": campaign.name,
            "start_date": business_date(campaign.start_date),
            "participant_count": get_campaign_participant_count(campaign.id, db),
            "form_count": len(get_campaign_form_ids(campaign.id, db)),
        }
        for campaign in upcoming_campaigns
    ]
    upcoming_deadlines = sorted(
        [
            {
                "campaign_id": campaign.id,
                "name": campaign.name,
                "deadline_type": "Starts",
                "date": business_date(campaign.start_date),
            }
            for campaign in campaigns
            if campaign.status == models.CampaignStatus.SCHEDULED.value and not campaign.is_archived
            and campaign.start_date > datetime.now(timezone.utc)
        ]
        + [
            {
                "campaign_id": campaign.id,
                "name": campaign.name,
                "deadline_type": "Ends",
                "date": business_date(campaign.end_date),
            }
            for campaign in campaigns
            if campaign.status == models.CampaignStatus.ACTIVE.value and not campaign.is_archived
            and campaign.end_date is not None and campaign.end_date > datetime.now(timezone.utc)
        ],
        key=lambda item: (item["date"], item["deadline_type"], item["name"], item["campaign_id"]),
    )[:8]
    campaign_summaries = [
        {
            "id": campaign.id,
            "name": campaign.name,
            "is_active": campaign.is_active,
            "start_date": business_date(campaign.start_date),
            "end_date": business_date(campaign.end_date),
            "current_date": today,
            "lifecycle_status": campaign_lifecycle_status(campaign, today),
            "campaign_status": campaign.status,
            "is_archived": campaign.is_archived,
        }
        for campaign in campaigns
    ]

    if selected_campaign is None:
        return {
            "current_date": today,
            "campaigns": campaign_summaries,
            "selected_campaign_id": None,
            "metrics": None,
            "forms": [],
            "participants": [],
            "upcoming_reviews": upcoming_reviews,
            "upcoming_deadlines": upcoming_deadlines,
        }

    assignments = (
        db.query(models.FilledForm)
        .filter(models.FilledForm.campaign_id == selected_campaign.id)
        .all()
    )
    planned_count = sum(1 for assignment in assignments if assignment.form_snapshot is None and assignment.finish_date is None and not assignment.answers)
    assignment_count = len(assignments) - planned_count
    submitted_count = sum(1 for assignment in assignments if assignment.finish_date is not None)
    overdue_assignments = [
        assignment
        for assignment in assignments
        if assignment.form_snapshot is not None
        and campaign_lifecycle.is_overdue(assignment, selected_campaign, now=datetime.now(timezone.utc))
    ]
    form_ids = get_campaign_form_ids(selected_campaign.id, db)
    overdue_form_ids = {assignment.form_id for assignment in overdue_assignments}
    next_campaign = next((campaign for campaign in upcoming_campaigns if campaign.id != selected_campaign.id), None)

    status_names = dict(db.query(models.FormStatus.id, models.FormStatus.name).all())
    in_progress_count = sum(assignment.finish_date is None and not (assignment.form_snapshot is None and not assignment.answers)
                            and (bool(assignment.answers) or normalize_form_status(status_names.get(assignment.status_id), None)[0] == "in_progress")
                            for assignment in assignments)
    metrics = {
        "assignment_count": assignment_count,
        "planned_count": planned_count,
        "submitted_count": submitted_count,
        "completion_rate": round((submitted_count / assignment_count) * 100) if assignment_count > 0 else 0,
        "awaiting_submission_count": assignment_count - submitted_count,
        "not_started_count": max(0, assignment_count - submitted_count - in_progress_count),
        "in_progress_count": in_progress_count,
        "overdue_count": len(overdue_assignments),
        "overdue_forms_count": len(overdue_form_ids),
        "upcoming_reviews_count": len(upcoming_reviews),
        "next_review_date": business_date(next_campaign.start_date) if next_campaign is not None else None,
    }

    forms = []
    for form_id in form_ids:
        form = db.query(models.Form).filter(models.Form.id == form_id).first()
        if form is None:
            continue

        form_assignments = [assignment for assignment in assignments if assignment.form_id == form_id]
        form_submitted_count = sum(1 for assignment in form_assignments if assignment.finish_date is not None)
        form_overdue_count = sum(1 for assignment in form_assignments if assignment in overdue_assignments)
        group_names = [
            name
            for (name,) in db.query(models.CompanyGroup.name)
            .join(models.CampaignEvaluationRule, models.CampaignEvaluationRule.company_group_id == models.CompanyGroup.id)
            .filter(models.CampaignEvaluationRule.campaign_id == selected_campaign.id)
            .filter(models.CampaignEvaluationRule.form_id == form_id)
            .distinct()
            .all()
        ]

        forms.append({
            "form_id": form.id,
            "name": form.name,
            "audience": ", ".join(group_names) if len(group_names) > 0 else "No groups assigned",
            "submitted_count": form_submitted_count,
            "assignment_count": len(form_assignments),
            "due_date": business_date(selected_campaign.end_date),
            "overdue_count": form_overdue_count,
        })

    return {
        "current_date": today,
        "campaigns": campaign_summaries,
        "selected_campaign_id": selected_campaign.id,
        "metrics": metrics,
        "forms": forms,
        "participants": get_campaign_participants(selected_campaign.id, db),
        "upcoming_reviews": upcoming_reviews,
        "upcoming_deadlines": upcoming_deadlines,
    }


def normalize_form_status(status_name: str | None, finish_date: date | None) -> tuple[str, str]:
    if finish_date is not None:
        return "completed", "Completed"
    normalized = (status_name or "Not started").strip().lower()
    if normalized in {"completed", "submitted"}:
        return "completed", "Completed"
    if normalized in {"in progress", "in_progress", "started"}:
        return "in_progress", "In progress"
    return "not_started", "Not started"


@app.get("/campaigns/{campaign_id}/completion-status", response_model=schemas.CompletionStatusResponse)
def get_campaign_completion_status(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    search: str | None = Query(default=None),
    status: str | None = Query(default=None),
    questionnaire_id: int | None = Query(default=None),
    overdue_only: bool = Query(default=False),
    sort: str = Query(default="due_date"),
    order: str = Query(default="asc"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("campaigns.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    today = campaign_today()
    evaluator = aliased(models.Employee)
    evaluatee = aliased(models.Employee)
    evaluator_account = aliased(models.User)
    evaluatee_account = aliased(models.User)
    rows = (
        db.query(
            models.FilledForm.id,
            models.FilledForm.evaluator_id,
            evaluator.full_name.label("evaluator_name"),
            evaluator_account.email.label("evaluator_email"),
            models.FilledForm.evaluatee_id,
            evaluatee.full_name.label("evaluatee_name"),
            evaluatee_account.email.label("evaluatee_email"),
            models.FilledForm.form_id.label("questionnaire_id"),
            models.Form.name.label("questionnaire_name"),
            models.FormStatus.name.label("status_name"),
            models.FilledForm.finish_date,
            models.FilledForm.company_group_id,
        )
        .join(evaluator, evaluator.id == models.FilledForm.evaluator_id)
        .join(evaluatee, evaluatee.id == models.FilledForm.evaluatee_id)
        .outerjoin(evaluator_account, evaluator_account.id == evaluator.user_id)
        .outerjoin(evaluatee_account, evaluatee_account.id == evaluatee.user_id)
        .join(models.Form, models.Form.id == models.FilledForm.form_id)
        .join(models.FormStatus, models.FormStatus.id == models.FilledForm.status_id)
        .filter(models.FilledForm.campaign_id == campaign.id)
        .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
        .all()
    )

    def to_item(row):
        status_key, status_label = normalize_form_status(row.status_name, row.finish_date)
        due_date = business_date(campaign.end_date)
        is_overdue = row.finish_date is None and campaign_lifecycle.is_overdue(row, campaign, now=datetime.now(timezone.utc))
        return {
            "id": row.id,
            "evaluator_id": row.evaluator_id,
            "evaluator_name": row.evaluator_name,
            "evaluator_email": row.evaluator_email,
            "evaluatee_id": row.evaluatee_id,
            "evaluatee_name": row.evaluatee_name,
            "evaluatee_email": row.evaluatee_email,
            "questionnaire_id": row.questionnaire_id,
            "questionnaire_name": row.questionnaire_name,
            "status_name": row.status_name,
            "status_key": status_key,
            "status_label": status_label,
            "due_date": due_date,
            "completed_at": row.finish_date,
            "is_overdue": is_overdue,
            "is_self_evaluation": row.evaluator_id == row.evaluatee_id,
            "duplicate_key": (row.evaluator_id, row.evaluatee_id, row.questionnaire_id, row.company_group_id),
        }

    all_items = [to_item(row) for row in rows]
    duplicate_keys = {item["duplicate_key"] for item in all_items if sum(1 for other in all_items if other["duplicate_key"] == item["duplicate_key"]) > 1}
    completed = sum(1 for item in all_items if item["status_key"] == "completed")
    not_started = sum(1 for item in all_items if item["status_key"] == "not_started")
    in_progress = sum(1 for item in all_items if item["status_key"] == "in_progress")
    overdue = sum(1 for item in all_items if item["is_overdue"])
    total = len(all_items)
    summary = {
        "total_evaluations": total,
        "not_started": not_started,
        "in_progress": in_progress,
        "completed": completed,
        "overdue": overdue,
        "completion_rate": round((completed / total) * 100) if total > 0 else 0,
        "outstanding": total - completed,
    }
    questionnaires = sorted(
        {item["questionnaire_id"]: {"id": item["questionnaire_id"], "name": item["questionnaire_name"]} for item in all_items}.values(),
        key=lambda item: (item["name"].lower(), item["id"]),
    )

    filtered = all_items
    if search is not None and search.strip() != "":
        term = search.strip().lower()
        filtered = [item for item in filtered if term in item["evaluator_name"].lower() or term in item["evaluator_email"].lower() or term in item["evaluatee_name"].lower() or term in item["evaluatee_email"].lower()]
    if status is not None and status.strip() != "":
        status_key = status.strip().lower().replace("-", "_").replace(" ", "_")
        filtered = [item for item in filtered if item["status_key"] == status_key]
    if questionnaire_id is not None:
        filtered = [item for item in filtered if item["questionnaire_id"] == questionnaire_id]
    if overdue_only:
        filtered = [item for item in filtered if item["is_overdue"]]

    reverse = order.lower() == "desc"
    sort_key_map = {
        "due_date": lambda item: (item["status_key"] == "completed", item["due_date"] or date.max, item["evaluator_name"].lower(), item["id"]),
        "status": lambda item: ({"not_started": 0, "in_progress": 1, "completed": 2}.get(item["status_key"], 3), item["is_overdue"] is False, item["id"]),
        "evaluator": lambda item: (item["evaluator_name"].lower(), item["evaluatee_name"].lower(), item["id"]),
        "evaluatee": lambda item: (item["evaluatee_name"].lower(), item["evaluator_name"].lower(), item["id"]),
        "completed_at": lambda item: (item["completed_at"] or date.max, item["id"]),
    }
    filtered = sorted(filtered, key=sort_key_map.get(sort, sort_key_map["due_date"]), reverse=reverse)
    total_items = len(filtered)
    total_pages = max(1, (total_items + page_size - 1) // page_size)
    page = min(page, total_pages)
    page_start = (page - 1) * page_size
    page_rows = filtered[page_start:page_start + page_size]
    for item in page_rows:
        item.pop("status_key", None)
        item.pop("duplicate_key", None)

    return {
        "campaign": {
            "id": campaign.id,
            "name": campaign.name,
            "is_active": campaign.is_active,
            "start_date": business_date(campaign.start_date),
            "end_date": business_date(campaign.end_date),
            "current_date": today,
            "lifecycle_status": campaign_lifecycle_status(campaign, today),
            "campaign_status": campaign.status,
            "is_archived": campaign.is_archived,
        },
        "summary": summary,
        "rows": page_rows,
        "questionnaires": questionnaires,
        "pagination": {"page": page, "page_size": page_size, "total_items": total_items, "total_pages": total_pages},
        "duplicate_assignment_count": len(duplicate_keys),
    }


@app.get("/reports/campaigns", response_model=list[schemas.ReportCampaignOption])
def get_report_campaigns(requester_user_id: int | None = Query(default=None), db: Session = Depends(get_db),
                         actor: models.User = Depends(require_permission("reports.read", "reports.read_team"))):
    reject_conflicting_requester(requester_user_id, actor)
    return reporting_service.list_report_campaigns(actor, db)


@app.get("/reports/campaigns/{campaign_id}/overview", response_model=schemas.CampaignReportOverviewResponse)
def get_campaign_report_overview(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return reporting_service.build_campaign_report_overview(campaign_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/evaluation-quality", response_model=schemas.EvaluationQualityResponse)
def get_campaign_evaluation_quality(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return evaluation_quality_service.build_evaluation_quality(campaign_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/sections/{section_id}/comparison", response_model=schemas.ReportSectionCohortComparison)
def get_report_section_cohort_comparison(
    campaign_id: int,
    section_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return reporting_service.build_section_cohort_comparison(campaign_id, section_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/rating-distribution", response_model=schemas.ReportRatingDistributionResponse)
def get_campaign_rating_distribution(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return question_analytics_service.build_rating_distribution_report(campaign_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/questions", response_model=schemas.ReportQuestionsResponse)
def get_campaign_report_questions(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    group_id: int | None = Query(default=None),
    role_id: int | None = Query(default=None),
    employee_id: int | None = Query(default=None),
    perspective: str = Query(default="evaluatee"),
    evaluation_type: Literal["peer", "self"] = Query(default="peer"),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    if sum(value is not None for value in (group_id, role_id, employee_id)) > 1:
        raise HTTPException(status_code=400, detail="Select one Reports scope at a time")
    if perspective not in {"evaluatee", "evaluator"} or (perspective == "evaluator" and role_id is None):
        raise HTTPException(status_code=400, detail="Invalid question analytics perspective")
    # Team leads may explore questions for a group they lead or one of its employees only.
    if employee_id is not None:
        reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    elif group_id is not None:
        reporting_service.require_team_group(campaign_id, group_id, actor, db)
    else:
        reporting_service.enter_report_scope(actor, db)
        if reporting_service._team_groups.get() is not None:
            raise HTTPException(status_code=403, detail="Campaign-wide question analytics require full report access")
    return question_analytics_service.build_question_report(
        campaign_id, actor, db, group_id=group_id, role_id=role_id, employee_id=employee_id,
        perspective=perspective, evaluation_type=evaluation_type,
    )


@app.get("/reports/campaigns/{campaign_id}/written-feedback", response_model=schemas.ReportWrittenFeedbackResponse | schemas.ReportWrittenFeedbackIndexResponse)
def get_campaign_written_feedback(
    campaign_id: int,
    question_key: str | None = Query(default=None, pattern=r"^[0-9a-f]{64}$"),
    evaluation_type: Literal["peer", "self"] = Query(default="peer"),
    section_id: int | None = Query(default=None, gt=0),
    employee_id: int | None = Query(default=None, gt=0),
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return reporting_service.build_written_feedback(
        campaign_id, question_key, evaluation_type, actor, db,
        employee_id=employee_id, section_id=section_id,
    )


@app.get("/reports/campaigns/{campaign_id}/groups")
def get_campaign_report_groups(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    reporting_service.enter_report_scope(actor, db)
    return reporting_service.build_groups_overview(campaign_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/groups/{group_id}")
def get_campaign_report_group_detail(
    campaign_id: int,
    group_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    reporting_service.require_team_group(campaign_id, group_id, actor, db)
    return reporting_service.build_group_detail(campaign_id, group_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/roles")
def get_campaign_report_roles(
    campaign_id: int,
    perspective: str = Query(default="evaluatee"),
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return reporting_service.build_roles_overview(campaign_id, actor, db, perspective)


@app.get("/reports/campaigns/{campaign_id}/roles/{role_id}")
def get_campaign_report_role_detail(
    campaign_id: int,
    role_id: int,
    perspective: str = Query(default="evaluatee"),
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read")),
):
    reject_conflicting_requester(requester_user_id, actor)
    return reporting_service.build_role_detail(campaign_id, role_id, actor, db, perspective)


@app.get("/reports/campaigns/{campaign_id}/employees")
def get_campaign_report_employees(
    campaign_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    reporting_service.enter_report_scope(actor, db)
    return reporting_service.build_employee_reports_overview(campaign_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/employees/{employee_id}")
def get_campaign_report_employee_detail(
    campaign_id: int,
    employee_id: int,
    requester_user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reject_conflicting_requester(requester_user_id, actor)
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return reporting_service.build_employee_report_detail(campaign_id, employee_id, actor, db)


@app.get("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis")
def get_employee_ai_analyses(
    campaign_id: int, employee_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return ai_workflow_service.list_analyses(db, campaign_id, employee_id, actor=actor)


@app.post("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/generate", status_code=202)
def generate_employee_ai_report(
    campaign_id: int, employee_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("ai_analysis.generate")),
):
    return ai_generation_jobs.start(db, campaign_id, "employee", employee_id, actor=actor)


@app.get("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/generation-job")
def employee_ai_generation_job(
    campaign_id: int, employee_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return ai_generation_jobs.status(db, campaign_id, "employee", employee_id, actor=actor)


@app.get("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/generation-job/{job_id}")
def employee_ai_generation_job_status(
    campaign_id: int, employee_id: int, job_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("reports.read", "reports.read_team")),
):
    reporting_service.require_team_employee(campaign_id, employee_id, actor, db)
    return ai_generation_jobs.status(db, campaign_id, "employee", employee_id, actor=actor, job_id=job_id)


@app.put("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/{analysis_id}")
def edit_employee_ai_report(
    campaign_id: int, employee_id: int, analysis_id: int, payload: EmployeeAIAnalysis,
    db: Session = Depends(get_db), actor: models.User = Depends(require_permission("ai_analysis.generate")),
):
    try:
        return ai_workflow_service.edit(db, campaign_id, employee_id, analysis_id, payload, actor=actor)
    except AnalysisGenerationError:
        raise HTTPException(status_code=422, detail="Edited analysis contains unsupported evidence or numerical claims") from None


@app.post("/reports/campaigns/{campaign_id}/employees/{employee_id}/ai-analysis/{analysis_id}/approve")
def approve_employee_ai_report(
    campaign_id: int, employee_id: int, analysis_id: int, db: Session = Depends(get_db),
    actor: models.User = Depends(require_permission("ai_analysis.approve")),
):
    return ai_workflow_service.approve(db, campaign_id, employee_id, analysis_id, actor=actor)


def _register_aggregate_ai_routes(scope_type: str, route: str) -> None:
    """Keep all three aggregate scopes on the same authorized HR workflow."""
    read_permissions = ("reports.read", "reports.read_team") if scope_type == "group" else ("reports.read",)

    def authorize_read(campaign_id: int, scope_id: int | None, actor: models.User, db: Session) -> None:
        if scope_type == "group":
            reporting_service.require_team_group(campaign_id, scope_id or 0, actor, db)

    def history(campaign_id: int, scope_id: int | None = None, db: Session = Depends(get_db),
                actor: models.User = Depends(require_permission(*read_permissions))):
        authorize_read(campaign_id, scope_id, actor, db)
        return ai_aggregate_workflow_service.list_analyses(db, campaign_id, scope_type, scope_id, actor=actor)

    def generate(campaign_id: int, scope_id: int | None = None, db: Session = Depends(get_db),
                 actor: models.User = Depends(require_permission("ai_analysis.generate"))):
        return ai_generation_jobs.start(db, campaign_id, scope_type, scope_id, actor=actor)

    def latest_job(campaign_id: int, scope_id: int | None = None, db: Session = Depends(get_db),
                   actor: models.User = Depends(require_permission(*read_permissions))):
        authorize_read(campaign_id, scope_id, actor, db)
        return ai_generation_jobs.status(db, campaign_id, scope_type, scope_id, actor=actor)

    def job_status(campaign_id: int, job_id: int, scope_id: int | None = None,
                   db: Session = Depends(get_db),
                   actor: models.User = Depends(require_permission(*read_permissions))):
        authorize_read(campaign_id, scope_id, actor, db)
        return ai_generation_jobs.status(db, campaign_id, scope_type, scope_id, actor=actor, job_id=job_id)

    def edit(campaign_id: int, analysis_id: int, payload: EmployeeAIAnalysis,
             scope_id: int | None = None, db: Session = Depends(get_db),
             actor: models.User = Depends(require_permission("ai_analysis.generate"))):
        try:
            return ai_aggregate_workflow_service.edit(db, campaign_id, scope_type, scope_id,
                                                        analysis_id, payload, actor=actor)
        except AnalysisGenerationError:
            raise HTTPException(status_code=422, detail="Edited analysis contains unsupported evidence or numerical claims") from None

    def approve(campaign_id: int, analysis_id: int, scope_id: int | None = None,
                db: Session = Depends(get_db),
                actor: models.User = Depends(require_permission("ai_analysis.approve"))):
        return ai_aggregate_workflow_service.approve(db, campaign_id, scope_type, scope_id, analysis_id, actor=actor)

    app.add_api_route(route, history, methods=["GET"], name=f"get_{scope_type}_ai_analysis")
    app.add_api_route(f"{route}/generate", generate, methods=["POST"], status_code=202,
                      name=f"generate_{scope_type}_ai_analysis")
    app.add_api_route(f"{route}/generation-job", latest_job, methods=["GET"], name=f"latest_{scope_type}_ai_generation_job")
    app.add_api_route(f"{route}/generation-job/{{job_id}}", job_status, methods=["GET"],
                      name=f"get_{scope_type}_ai_generation_job")
    app.add_api_route(f"{route}/{{analysis_id}}", edit, methods=["PUT"], name=f"edit_{scope_type}_ai_analysis")
    app.add_api_route(f"{route}/{{analysis_id}}/approve", approve, methods=["POST"], name=f"approve_{scope_type}_ai_analysis")


_register_aggregate_ai_routes("campaign", "/reports/campaigns/{campaign_id}/ai-analysis")
_register_aggregate_ai_routes("group", "/reports/campaigns/{campaign_id}/groups/{scope_id}/ai-analysis")
_register_aggregate_ai_routes("role", "/reports/campaigns/{campaign_id}/roles/{scope_id}/ai-analysis")


def reject_conflicting_requester(requester_user_id: int | None, actor: models.User):
    if requester_user_id is not None and requester_user_id != actor.id:
        raise HTTPException(status_code=403, detail="Requester does not match authenticated user")


def normalize_section_name(name: str) -> tuple[str, str]:
    display = " ".join(name.strip().split())
    if not display or len(display) > 120:
        raise HTTPException(status_code=400, detail="Section name must contain 1 to 120 characters")
    normalized = display.casefold()
    if len(normalized) > 120:
        raise HTTPException(status_code=400, detail="Normalized section name must contain at most 120 characters")
    return display, normalized


@app.get("/sections", response_model=list[schemas.SectionResponse])
def get_sections(include_archived: bool = Query(default=True), requester_user_id: int | None = Query(default=None),
                 db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.read"))):
    reject_conflicting_requester(requester_user_id, actor)
    query = db.query(models.Section).filter(models.Section.scope_key == "default")
    if not include_archived:
        query = query.filter(models.Section.is_archived.is_(False))
    return query.order_by(models.Section.is_archived.asc(), models.Section.name.asc()).all()


@app.post("/sections", response_model=schemas.SectionResponse, status_code=201)
def create_section(payload: schemas.SectionCreate, requester_user_id: int | None = Query(default=None),
                   db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.manage"))):
    reject_conflicting_requester(requester_user_id, actor)
    name, normalized = normalize_section_name(payload.name)
    section = models.Section(scope_key="default", name=name, normalized_name=normalized)
    db.add(section)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) != "uq_section_scope_name":
            raise
        raise HTTPException(status_code=409, detail="A section with this name already exists") from error
    db.refresh(section)
    return section


@app.put("/sections/{section_id}", response_model=schemas.SectionResponse)
def update_section(section_id: int, payload: schemas.SectionUpdate, requester_user_id: int | None = Query(default=None),
                   db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.manage"))):
    reject_conflicting_requester(requester_user_id, actor)
    section = db.query(models.Section).filter(models.Section.id == section_id, models.Section.scope_key == "default").first()
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")
    section.name, section.normalized_name = normalize_section_name(payload.name)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) != "uq_section_scope_name":
            raise
        raise HTTPException(status_code=409, detail="A section with this name already exists") from error
    db.refresh(section)
    return section


@app.post("/sections/{section_id}/archive", response_model=schemas.SectionResponse)
def archive_section(section_id: int, requester_user_id: int | None = Query(default=None),
                    db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.manage"))):
    reject_conflicting_requester(requester_user_id, actor)
    return set_section_archived(section_id, True, db)


@app.post("/sections/{section_id}/restore", response_model=schemas.SectionResponse)
def restore_section(section_id: int, requester_user_id: int | None = Query(default=None),
                    db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.manage"))):
    reject_conflicting_requester(requester_user_id, actor)
    return set_section_archived(section_id, False, db)


def set_section_archived(section_id: int, archived: bool, db: Session):
    section = db.query(models.Section).filter(models.Section.id == section_id, models.Section.scope_key == "default").first()
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")
    section.is_archived = archived
    db.commit()
    db.refresh(section)
    return section


@app.get("/campaigns", response_model=list[schemas.CampaignResponse])
def get_campaigns(db: Session = Depends(get_db),
                   _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaigns = (
        db.query(models.Campaign)
        .order_by(models.Campaign.is_archived.asc(),
                  case((models.Campaign.status == models.CampaignStatus.ACTIVE.value, 0),
                       (models.Campaign.status == models.CampaignStatus.SCHEDULED.value, 1),
                       (models.Campaign.status == models.CampaignStatus.REVIEW.value, 2),
                       (models.Campaign.status == models.CampaignStatus.PAUSED.value, 3),
                       (models.Campaign.status == models.CampaignStatus.DRAFT.value, 4), else_=5),
                  models.Campaign.start_date.desc())
        .all()
    )
    today = campaign_today()
    issued_counts = dict(
        db.query(models.FilledForm.campaign_id, func.count(models.FilledForm.id))
        .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
        .group_by(models.FilledForm.campaign_id)
        .all()
    )
    submitted_counts = dict(
        db.query(models.FilledForm.campaign_id, func.count(models.FilledForm.id))
        .filter(models.FilledForm.finish_date.isnot(None))
        .group_by(models.FilledForm.campaign_id)
        .all()
    )

    return [
        campaign_payload(campaign, today, issued_counts.get(campaign.id, 0), submitted_counts.get(campaign.id, 0))
        for campaign in campaigns
    ]


@app.get("/campaigns/{campaign_id}", response_model=schemas.CampaignResponse)
def get_campaign(campaign_id: int, db: Session = Depends(get_db),
                 _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaign = (
        db.query(models.Campaign)
        .filter(models.Campaign.id == campaign_id)
        .first()
    )

    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")

    today = campaign_today()
    issued_forms_count = (
        db.query(models.FilledForm)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
        .count()
    )

    submitted_forms_count = db.query(models.FilledForm).filter(
            models.FilledForm.campaign_id == campaign_id,
            models.FilledForm.finish_date.isnot(None),
        ).count()
    return campaign_payload(campaign, today, issued_forms_count, submitted_forms_count)


@app.get("/campaigns/{campaign_id}/operational-metrics", response_model=schemas.CampaignOperationalMetrics)
def get_campaign_operational_metrics(campaign_id: int, db: Session = Depends(get_db),
                                     _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    rows = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)),
    ).all()
    now = datetime.now(timezone.utc)
    submitted = sum(row.finish_date is not None for row in rows)
    total = len(rows)
    return {"campaign_id": campaign_id, "campaign_status": campaign.status, "total": total,
            "submitted": submitted, "incomplete": total - submitted,
            "completion_rate": round(submitted * 100 / total) if total else 0,
            "overdue": sum(campaign_lifecycle.is_overdue(row, campaign, now=now) for row in rows)}


@app.get("/campaigns/{campaign_id}/deletion-eligibility", response_model=schemas.CampaignDeletionEligibility)
def get_campaign_deletion_eligibility(campaign_id: int, db: Session = Depends(get_db),
                                      _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    reason = campaign_lifecycle.deletion_blocker(db, campaign)
    return {"campaign_id": campaign_id, "can_delete": reason is None, "reason": reason}


def change_campaign_archive(campaign_id: int, archived: bool, db: Session, actor: models.User):
    try:
        campaign = campaign_lifecycle.set_campaign_archived(
            db, campaign_id, archived, actor_user_id=actor.id, now=datetime.now(timezone.utc))
        db.commit()
    except campaign_lifecycle.CampaignLifecycleError as error:
        db.rollback()
        raise HTTPException(status_code=404 if str(error) == "Campaign not found" else 409, detail=str(error)) from error
    db.refresh(campaign)
    return campaign_payload(campaign, campaign_today())


@app.post("/campaigns/{campaign_id}/archive", response_model=schemas.CampaignResponse)
def archive_campaign(campaign_id: int, db: Session = Depends(get_db),
                     actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_archive(campaign_id, True, db, actor)


@app.post("/campaigns/{campaign_id}/unarchive", response_model=schemas.CampaignResponse)
def unarchive_campaign(campaign_id: int, db: Session = Depends(get_db),
                       actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_archive(campaign_id, False, db, actor)


@app.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: int, db: Session = Depends(get_db),
                     manager: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).populate_existing().with_for_update().one_or_none()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    reason = campaign_lifecycle.deletion_blocker(db, campaign)
    if reason is not None:
        raise HTTPException(status_code=409, detail=reason)
    db.add(models.CampaignOperationAudit(
        campaign_id=campaign.id, category="delete", actor_user_id=manager.id,
        is_automatic=False, occurred_at=datetime.now(timezone.utc),
        previous_status=campaign.status, resulting_status=None, issued_count=0,
    ))
    # All these rows are campaign-owned; forms, groups, employees and users are shared.
    db.query(models.FilledForm).filter(models.FilledForm.campaign_id == campaign_id).delete(synchronize_session=False)
    db.query(models.CampaignEvaluationRule).filter(models.CampaignEvaluationRule.campaign_id == campaign_id).delete(synchronize_session=False)
    db.query(models.CampaignEmployeeSelfEvaluation).filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id).delete(synchronize_session=False)
    db.execute(models.campaign_company_groups.delete().where(models.campaign_company_groups.c.campaign_id == campaign_id))
    db.query(models.CampaignLifecycleHistory).filter(models.CampaignLifecycleHistory.campaign_id == campaign_id).delete(synchronize_session=False)
    db.delete(campaign)
    db.commit()
    return {"deleted": True}


def duplicate_campaign_name(db: Session, name: str, exclude_id: int | None = None) -> bool:
    normalized = func.lower(func.regexp_replace(models.Campaign.name, r"^[[:space:]]+|[[:space:]]+$", "", "g"))
    requested = func.lower(func.regexp_replace(name, r"^[[:space:]]+|[[:space:]]+$", "", "g"))
    query = db.query(models.Campaign.id).filter(normalized == requested)
    if exclude_id is not None:
        query = query.filter(models.Campaign.id != exclude_id)
    return query.first() is not None


def validate_campaign_configuration(campaign: models.Campaign, db: Session) -> list[str]:
    """Validate the complete saved schedule, without changing or issuing assignments."""
    errors = []
    group_ids = get_campaign_assigned_group_ids(campaign.id, db)
    if not group_ids:
        errors.append("Select at least one campaign group")
    members = {group_id: {employee.id: employee for employee, _ in get_group_employees(group_id, db)}
               for group_id in group_ids}
    group_names = dict(db.query(models.CompanyGroup.id, models.CompanyGroup.name)
                       .filter(models.CompanyGroup.id.in_(group_ids)).all())
    role_ids = {person.company_role_id for people in members.values() for person in people.values()}
    role_names = dict(db.query(models.CompanyRole.id, models.CompanyRole.name)
                      .filter(models.CompanyRole.id.in_(role_ids)).all())
    if not any(members.values()):
        errors.append("Selected groups need active employees")
    rules = {(rule.company_group_id, rule.evaluator_role_id, rule.evaluatee_role_id): rule.form_id
             for rule in db.query(models.CampaignEvaluationRule).filter(models.CampaignEvaluationRule.campaign_id == campaign.id)}
    self_forms = {row.employee_id: row.form_id for row in db.query(models.CampaignEmployeeSelfEvaluation)
                  .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign.id)}
    assignments = db.query(models.FilledForm).filter(models.FilledForm.campaign_id == campaign.id).all()
    form_ids = {row.form_id for row in assignments if row.form_id is not None}
    forms = {form.id: form for form in db.query(models.Form).filter(models.Form.id.in_(form_ids)).all()} if form_ids else {}
    for form_id in form_ids:
        form = forms.get(form_id)
        if form is None:
            errors.append(f"Form {form_id} does not exist")
        else:
            errors.extend(f"Form {form.name}: {error}" for error in form_issuance_errors(form.questions, db))
    for group_id, people in members.items():
        if not people:
            errors.append(f"Group {group_names.get(group_id, group_id)} has no active employees")
    participants = {employee_id for people in members.values() for employee_id in people}
    for employee_id in self_forms:
        if employee_id not in participants:
            errors.append(f"Self-evaluation participant {employee_id} is not in a selected group")
    if not assignments:
        errors.append("Select at least one evaluation assignment")
    seen = set()
    for row in assignments:
        pair = (row.evaluator_id, row.evaluatee_id)
        if pair in seen:
            errors.append(f"Duplicate evaluation pair {pair}")
        seen.add(pair)
        if row.company_group_id not in members or row.evaluator_id not in members[row.company_group_id] or row.evaluatee_id not in members[row.company_group_id]:
            errors.append(f"Assignment {row.id} is outside an active selected group")
            continue
        evaluator = members[row.company_group_id][row.evaluator_id]
        evaluatee = members[row.company_group_id][row.evaluatee_id]
        is_self = row.evaluator_id == row.evaluatee_id
        expected = (self_forms.get(row.evaluator_id) if is_self else
                    rules.get((row.company_group_id, evaluator.company_role_id, evaluatee.company_role_id)))
        if expected is None and is_self:
            # Self rows take their form from the Self-evaluations tab, not from role rules.
            errors.append(f"Self-evaluation for {evaluator.full_name} needs a questionnaire selected on the Self-evaluations tab")
        elif expected is None:
            errors.append(
                f"Evaluation {evaluator.full_name} → {evaluatee.full_name} needs a saved questionnaire for "
                f"{role_names.get(evaluator.company_role_id, evaluator.company_role_id)} → "
                f"{role_names.get(evaluatee.company_role_id, evaluatee.company_role_id)}")
        elif expected != row.form_id and not assignment_is_immutable(row):
            errors.append(f"Evaluation {evaluator.full_name} → {evaluatee.full_name} does not match its saved form selection")
    return errors


def validate_scheduled_campaign(campaign: models.Campaign, db: Session) -> None:
    if campaign.status == models.CampaignStatus.SCHEDULED.value:
        try:
            campaign_lifecycle.validate_date_edit(
                campaign, campaign.start_date, campaign.end_date, now=datetime.now(timezone.utc),
                validate_configuration=lambda _campaign, _start, _end: validate_campaign_configuration(campaign, db),
            )
        except campaign_lifecycle.CampaignLifecycleError as error:
            db.rollback()
            raise HTTPException(status_code=409, detail=str(error)) from error


def campaigns_referencing_form(form_id: int, db: Session) -> list[models.Campaign]:
    ids = {row[0] for model in (models.CampaignEvaluationRule, models.CampaignEmployeeSelfEvaluation, models.FilledForm)
           for row in db.query(model.campaign_id).filter(model.form_id == form_id).distinct().all()}
    return [db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().one()
            for campaign_id in sorted(ids)]


def scheduled_campaigns_for_groups(group_ids: set[int], db: Session) -> list[models.Campaign]:
    if not group_ids:
        return []
    ids = [row[0] for row in db.query(models.campaign_company_groups.c.campaign_id).join(
        models.Campaign, models.Campaign.id == models.campaign_company_groups.c.campaign_id,
    ).filter(models.campaign_company_groups.c.company_group_id.in_(group_ids),
             models.Campaign.status == models.CampaignStatus.SCHEDULED.value).distinct().all()]
    return [db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().one()
            for campaign_id in sorted(ids)]


def change_campaign_schedule(campaign_id: int, target: models.CampaignStatus, db: Session, actor: models.User):
    try:
        campaign = campaign_lifecycle.transition_campaign(
            db, campaign_id, target, now=datetime.now(timezone.utc), actor_user_id=actor.id,
            validate_configuration=validate_campaign_configuration,
        )
        db.commit()
    except campaign_lifecycle.CampaignLifecycleError as error:
        db.rollback()
        raise HTTPException(status_code=404 if str(error) == "Campaign not found" else 409, detail=str(error)) from error
    db.refresh(campaign)
    return campaign_payload(campaign, campaign_today())


@app.post("/campaigns/{campaign_id}/pause", response_model=schemas.CampaignResponse)
def pause_campaign(campaign_id: int, db: Session = Depends(get_db),
                   actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_schedule(campaign_id, models.CampaignStatus.PAUSED, db, actor)


@app.post("/campaigns/{campaign_id}/resume", response_model=schemas.CampaignResponse)
def resume_campaign(campaign_id: int, db: Session = Depends(get_db),
                    actor: models.User = Depends(require_permission("campaigns.manage"))):
    try:
        campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).populate_existing().with_for_update().one_or_none()
        if campaign is None:
            raise campaign_lifecycle.CampaignLifecycleError("Campaign not found")
        now = datetime.now(timezone.utc)
        target = (models.CampaignStatus.REVIEW if campaign.paused_from_status == models.CampaignStatus.REVIEW.value
                  or (campaign.end_date is not None and now >= campaign.end_date) else models.CampaignStatus.ACTIVE)
        campaign = campaign_lifecycle.transition_campaign(db, campaign_id, target, now=now, actor_user_id=actor.id)
        ensure_campaign_issued(campaign_id, db, commit=False, actor_user_id=actor.id)
        db.commit()
    except campaign_lifecycle.CampaignLifecycleError as error:
        db.rollback()
        raise HTTPException(status_code=404 if str(error) == "Campaign not found" else 409, detail=str(error)) from error
    db.refresh(campaign)
    return campaign_payload(campaign, campaign_today())


@app.post("/campaigns/{campaign_id}/review", response_model=schemas.CampaignResponse)
def review_campaign(campaign_id: int, db: Session = Depends(get_db),
                    actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_schedule(campaign_id, models.CampaignStatus.REVIEW, db, actor)


@app.post("/campaigns/{campaign_id}/close", response_model=schemas.CampaignResponse)
def close_campaign(campaign_id: int, db: Session = Depends(get_db),
                   actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_schedule(campaign_id, models.CampaignStatus.CLOSED, db, actor)


@app.post("/campaigns/{campaign_id}/schedule", response_model=schemas.CampaignResponse)
def schedule_campaign(campaign_id: int, db: Session = Depends(get_db),
                      actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_schedule(campaign_id, models.CampaignStatus.SCHEDULED, db, actor)


@app.post("/campaigns/{campaign_id}/unschedule", response_model=schemas.CampaignResponse)
def unschedule_campaign(campaign_id: int, db: Session = Depends(get_db),
                        actor: models.User = Depends(require_permission("campaigns.manage"))):
    return change_campaign_schedule(campaign_id, models.CampaignStatus.DRAFT, db, actor)


@app.post("/campaigns", response_model=schemas.CampaignResponse)
def create_campaign(campaign: schemas.CampaignCreate, db: Session = Depends(get_db),
                    actor: models.User = Depends(require_permission("campaigns.manage"))):
    if not campaign.name.strip():
        raise HTTPException(status_code=400, detail="Campaign name is required")
    try:
        start_at, end_at = campaign_instant(campaign.start_date), campaign_instant(campaign.end_date)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if end_at is not None and (end_at < start_at or (end_at == start_at and not (type(campaign.start_date) is date and type(campaign.end_date) is date))):
        raise HTTPException(status_code=400, detail="End date cannot be earlier than start date")

    if campaign.created_by is not None and campaign.created_by != actor.id:
        raise HTTPException(status_code=403, detail="Campaign creator does not match authenticated user")

    if duplicate_campaign_name(db, campaign.name):
        raise HTTPException(status_code=409, detail="A campaign with this name already exists.")

    new_campaign = models.Campaign(
        name=campaign.name.strip(),
        description=campaign.description,
        start_date=start_at,
        end_date=end_at,
        is_active=False,
        status=models.CampaignStatus.DRAFT.value,
        comment=campaign.comment,
        created_by=actor.id,
    )

    db.add(new_campaign)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) == "uq_campaigns_normalized_name":
            raise HTTPException(status_code=409, detail="A campaign with this name already exists.") from error
        raise
    db.refresh(new_campaign)

    return campaign_payload(new_campaign, campaign_today())


@app.put("/campaigns/{campaign_id}", response_model=schemas.CampaignResponse)
def update_campaign(campaign_id: int, campaign_update: schemas.CampaignUpdate, db: Session = Depends(get_db),
                     manager: models.User = Depends(require_permission("campaigns.manage"))):
    if not campaign_update.name.strip():
        raise HTTPException(status_code=400, detail="Campaign name is required")
    campaign = (
        db.query(models.Campaign)
        .filter(models.Campaign.id == campaign_id)
        .with_for_update()
        .first()
    )

    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_mutable_campaign_configuration(campaign)

    if duplicate_campaign_name(db, campaign_update.name, campaign_id):
        raise HTTPException(status_code=409, detail="A campaign with this name already exists.")

    issued_forms_count = (
        db.query(models.FilledForm)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .filter(or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)))
        .count()
    )

    supplied = campaign_update.model_fields_set
    if "is_active" in supplied and campaign_update.is_active != campaign.is_active:
        raise HTTPException(status_code=409, detail="Use the campaign lifecycle to change availability")
    start_at, end_at = campaign.start_date, campaign.end_date
    try:
        if "start_date" in supplied:
            if campaign_update.start_date is None:
                raise ValueError("Start date cannot be null")
            requested = campaign_instant(campaign_update.start_date)
            if isinstance(campaign_update.start_date, date) and not isinstance(campaign_update.start_date, datetime) and business_date(start_at) == campaign_update.start_date:
                requested = start_at
            start_at = requested
        if "end_date" in supplied:
            requested = campaign_instant(campaign_update.end_date)
            if type(campaign_update.end_date) is date and business_date(end_at) == campaign_update.end_date:
                requested = end_at
            end_at = requested
        if "start_at" in supplied:
            if campaign_update.start_at is None:
                raise ValueError("Start timestamp cannot be null")
            precise = campaign_instant(campaign_update.start_at)
            if "start_date" in supplied and (
                campaign_instant(campaign_update.start_date) != precise if isinstance(campaign_update.start_date, datetime)
                else business_date(precise) != campaign_update.start_date
            ):
                raise ValueError("Start date and timestamp disagree")
            start_at = precise
        if "end_at" in supplied:
            precise = campaign_instant(campaign_update.end_at)
            if "end_date" in supplied and (
                campaign_instant(campaign_update.end_date) != precise if isinstance(campaign_update.end_date, datetime)
                else business_date(precise) != campaign_update.end_date
            ):
                raise ValueError("End date and timestamp disagree")
            end_at = precise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    date_only_equal = type(campaign_update.start_date) is date and type(campaign_update.end_date) is date
    if end_at is not None and (end_at < start_at or (end_at == start_at and (start_at != campaign.start_date or end_at != campaign.end_date) and not date_only_equal)):
        raise HTTPException(status_code=400, detail="End date cannot be earlier than start date")

    if (start_at, end_at) != (campaign.start_date, campaign.end_date):
        try:
            campaign_lifecycle.validate_date_edit(campaign, start_at, end_at, now=datetime.now(timezone.utc),
                                                   validate_configuration=lambda _campaign, _start, _end: validate_campaign_configuration(campaign, db))
        except campaign_lifecycle.CampaignLifecycleError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    if (
        issued_forms_count > 0
        and campaign.end_date is not None
        and end_at is not None
        and end_at < campaign.end_date
    ):
        raise HTTPException(status_code=400, detail="End date cannot be moved earlier after questionnaires have been issued")

    campaign.name = campaign_update.name.strip()
    campaign.description = campaign_update.description
    if campaign.start_date != start_at:
        campaign.start_date = start_at
    if campaign.end_date != end_at:
        campaign.end_date = end_at
    campaign.comment = campaign_update.comment

    try:
        db.flush()
        validate_scheduled_campaign(campaign, db)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) == "uq_campaigns_normalized_name":
            raise HTTPException(status_code=409, detail="A campaign with this name already exists.") from error
        raise
    issued_forms_count = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        or_(issued_snapshot_filter(), models.FilledForm.finish_date.isnot(None)),
    ).count()
    db.refresh(campaign)

    submitted_forms_count = db.query(models.FilledForm).filter(
            models.FilledForm.campaign_id == campaign_id,
            models.FilledForm.finish_date.isnot(None),
        ).count()
    return campaign_payload(campaign, campaign_today(), issued_forms_count, submitted_forms_count)


@app.get("/campaigns/{campaign_id}/groups", response_model=schemas.CampaignGroupsResponse)
def get_campaign_groups(campaign_id: int, db: Session = Depends(get_db),
                        _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")

    groups = db.query(models.CompanyGroup).order_by(models.CompanyGroup.name.asc()).all()
    assigned_group_ids = [
        group_id
        for (group_id,) in db.query(models.campaign_company_groups.c.company_group_id)
        .filter(models.campaign_company_groups.c.campaign_id == campaign_id)
        .all()
    ]

    return {
        "available_groups": groups,
        "assigned_group_ids": assigned_group_ids,
    }


@app.put("/campaigns/{campaign_id}/groups", response_model=schemas.CampaignGroupsResponse)
def update_campaign_groups(campaign_id: int, payload: schemas.CampaignGroupsUpdate, db: Session = Depends(get_db),
                           manager: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_mutable_campaign_configuration(campaign)

    unique_group_ids = sorted(set(payload.group_ids))
    if len(unique_group_ids) > 0:
        matching_count = (
            db.query(models.CompanyGroup)
            .filter(models.CompanyGroup.id.in_(unique_group_ids))
            .count()
        )
        if matching_count != len(unique_group_ids):
            raise HTTPException(status_code=400, detail="One or more groups do not exist")

    removed_ids = set(get_campaign_assigned_group_ids(campaign_id, db)) - set(unique_group_ids)
    if removed_ids:
        has_rules = db.query(models.CampaignEvaluationRule.id).filter(
            models.CampaignEvaluationRule.campaign_id == campaign_id,
            models.CampaignEvaluationRule.company_group_id.in_(removed_ids),
        ).first() is not None
        group_assignments = db.query(models.FilledForm).filter(
            models.FilledForm.campaign_id == campaign_id,
            models.FilledForm.company_group_id.in_(removed_ids),
        ).all()
        has_evaluations = any(assignment_is_immutable(record) for record in group_assignments)
        if has_evaluations:
            raise HTTPException(status_code=409, detail="Groups with issued evaluations cannot be removed")
        if has_rules:
            raise HTTPException(status_code=409, detail="Remove saved form rules before deselecting these groups")
        remaining_members = {group_id: {person.id: person for person, _ in get_group_employees(group_id, db)}
                             for group_id in unique_group_ids}
        occupied = {(row.evaluator_id, row.evaluatee_id) for row in db.query(models.FilledForm).filter(
            models.FilledForm.campaign_id == campaign_id,
            ~models.FilledForm.company_group_id.in_(removed_ids),
        ).all()}
        for record in group_assignments:
            pair = (record.evaluator_id, record.evaluatee_id)
            if pair in occupied:
                raise HTTPException(status_code=409, detail="Overlapping groups already contain this evaluation pair")
            target = next((group_id for group_id, members in remaining_members.items()
                           if record.evaluator_id in members and record.evaluatee_id in members), None)
            if target is None:
                raise HTTPException(status_code=409, detail="Selected pairs must remain in a campaign group; use setup to replan them")
            record.company_group_id = target
            occupied.add(pair)
            if record.evaluator_id != record.evaluatee_id:
                record.form_id = get_form_id_for_employee_pair(
                    campaign_id, target, remaining_members[target][record.evaluator_id],
                    remaining_members[target][record.evaluatee_id], db)

    db.execute(
        models.campaign_company_groups.delete().where(
            models.campaign_company_groups.c.campaign_id == campaign_id
        )
    )
    for group_id in unique_group_ids:
        db.execute(
            models.campaign_company_groups.insert().values(
                campaign_id=campaign_id,
                company_group_id=group_id,
            )
        )
    db.flush()
    unschedule_if_incomplete(campaign, db, manager.id)
    db.commit()

    groups = db.query(models.CompanyGroup).order_by(models.CompanyGroup.name.asc()).all()
    return {
        "available_groups": groups,
        "assigned_group_ids": unique_group_ids,
    }


def get_campaign_assigned_group_ids(campaign_id: int, db: Session):
    return [
        group_id
        for (group_id,) in db.query(models.campaign_company_groups.c.company_group_id)
        .filter(models.campaign_company_groups.c.campaign_id == campaign_id)
        .all()
    ]


def get_group_roles(group_id: int, db: Session):
    return (
        db.query(models.CompanyRole)
        .join(models.Employee, models.Employee.company_role_id == models.CompanyRole.id)
        .join(models.employee_company_groups, models.employee_company_groups.c.employee_id == models.Employee.id)
        .outerjoin(models.User, models.User.id == models.Employee.user_id)
        .filter(models.employee_company_groups.c.company_group_id == group_id)
        .filter(models.Employee.is_active.is_(True))
        .filter(or_(models.Employee.user_id.is_(None), models.User.is_active.is_(True)))
        .distinct()
        .order_by(models.CompanyRole.name.asc())
        .all()
    )


def get_group_employees(group_id: int, db: Session):
    return (
        db.query(models.Employee, models.CompanyRole)
        .join(models.CompanyRole, models.CompanyRole.id == models.Employee.company_role_id)
        .join(models.employee_company_groups, models.employee_company_groups.c.employee_id == models.Employee.id)
        .outerjoin(models.User, models.User.id == models.Employee.user_id)
        .filter(models.employee_company_groups.c.company_group_id == group_id)
        .filter(models.Employee.is_active.is_(True))
        .filter(or_(models.Employee.user_id.is_(None), models.User.is_active.is_(True)))
        .order_by(models.Employee.full_name.asc())
        .all()
    )


def get_self_evaluation_participants(campaign_id: int, db: Session, group_ids: list[int] | None = None):
    participants = {}
    for group_id in (get_campaign_assigned_group_ids(campaign_id, db) if group_ids is None else group_ids):
        group = db.query(models.CompanyGroup).filter(models.CompanyGroup.id == group_id).first()
        for employee, role in get_group_employees(group_id, db):
            row = participants.setdefault(employee.id, {
                "employee_id": employee.id,
                "employee_name": employee.full_name,
                "role_name": role.name,
                "group_names": [],
            })
            row["group_names"].append(group.name)
    return participants


def build_campaign_self_evaluations(campaign_id: int, db: Session, group_ids: list[int] | None = None):
    participants = get_self_evaluation_participants(campaign_id, db, group_ids)
    mappings = {
        row.employee_id: row.form_id
        for row in db.query(models.CampaignEmployeeSelfEvaluation)
        .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id).all()
    }
    issued = {}
    for row in db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        models.FilledForm.evaluator_id == models.FilledForm.evaluatee_id,
    ).all():
        if assignment_is_immutable(row):
            issued.setdefault(row.evaluator_id, row.form_id)
    forms = db.query(models.Form).order_by(models.Form.name.asc()).all()
    return {
        "forms": [{"id": form.id, "name": form.name} for form in forms],
        "participants": [
            {**participant, "form_id": issued.get(employee_id, mappings.get(employee_id)), "locked": employee_id in issued}
            for employee_id, participant in sorted(participants.items(), key=lambda item: (item[1]["employee_name"], item[0]))
        ],
    }


@app.get("/campaigns/{campaign_id}/self-evaluations", response_model=schemas.CampaignSelfEvaluationsResponse)
def get_campaign_self_evaluations(campaign_id: int, db: Session = Depends(get_db),
                                  _reader: models.User = Depends(require_permission("campaigns.read"))):
    if db.query(models.Campaign.id).filter(models.Campaign.id == campaign_id).first() is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return build_campaign_self_evaluations(campaign_id, db)


@app.put("/campaigns/{campaign_id}/self-evaluations", response_model=schemas.CampaignSelfEvaluationsResponse)
def update_campaign_self_evaluations(campaign_id: int, payload: schemas.CampaignSelfEvaluationsUpdate, db: Session = Depends(get_db),
                                      manager: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_mutable_campaign_plan(campaign)
    participants = get_self_evaluation_participants(campaign_id, db)
    form_ids = {form_id for (form_id,) in db.query(models.Form.id).all()}
    desired = {}
    for assignment in payload.assignments:
        if assignment.employee_id not in participants:
            raise HTTPException(status_code=400, detail="Employee is not an active campaign participant")
        if assignment.employee_id in desired:
            raise HTTPException(status_code=400, detail="Duplicate self-evaluation assignment")
        if assignment.form_id is not None and assignment.form_id not in form_ids:
            raise HTTPException(status_code=400, detail="Self-evaluation form does not exist")
        desired[assignment.employee_id] = assignment.form_id

    issued = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        models.FilledForm.evaluator_id == models.FilledForm.evaluatee_id,
    ).all()
    for record in issued:
        if assignment_is_immutable(record) and record.evaluator_id in participants and desired.get(record.evaluator_id) != record.form_id:
            raise HTTPException(status_code=409, detail="Issued self-evaluations cannot be changed or removed")

    existing = {
        row.employee_id: row
        for row in db.query(models.CampaignEmployeeSelfEvaluation)
        .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id).all()
    }
    for employee_id, mapping in existing.items():
        # Retain historical assignments for employees no longer participating.
        if employee_id not in participants:
            continue
        form_id = desired.get(employee_id)
        if form_id is None:
            db.delete(mapping)
        else:
            mapping.form_id = form_id
    for employee_id, form_id in desired.items():
        if form_id is not None and employee_id not in existing:
            db.add(models.CampaignEmployeeSelfEvaluation(
                campaign_id=campaign_id, employee_id=employee_id, form_id=form_id,
            ))
    for record in issued:
        if assignment_is_immutable(record) or record.evaluator_id not in participants:
            continue
        form_id = desired.get(record.evaluator_id)
        record.form_id = form_id
    db.flush()
    unschedule_if_incomplete(campaign, db, manager.id)
    db.commit()
    return build_campaign_self_evaluations(campaign_id, db)


def build_campaign_rule_matrix(campaign_id: int, db: Session, group_ids: list[int] | None = None):
    assigned_group_ids = get_campaign_assigned_group_ids(campaign_id, db) if group_ids is None else group_ids
    groups = []
    if len(assigned_group_ids) > 0:
        groups = (
            db.query(models.CompanyGroup)
            .filter(models.CompanyGroup.id.in_(assigned_group_ids))
            .order_by(models.CompanyGroup.name.asc())
            .all()
        )

    existing_rules = {
        (rule.company_group_id, rule.evaluator_role_id, rule.evaluatee_role_id): rule
        for rule in db.query(models.CampaignEvaluationRule)
        .filter(models.CampaignEvaluationRule.campaign_id == campaign_id)
        .all()
    }
    locked_role_pairs = issued_role_pair_keys(campaign_id, db)
    planned = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        models.FilledForm.company_group_id.in_(assigned_group_ids),
        models.FilledForm.evaluator_id != models.FilledForm.evaluatee_id,
    ).all() if assigned_group_ids else []
    employee_ids = {employee_id for row in planned for employee_id in (row.evaluator_id, row.evaluatee_id)}
    employee_roles = dict(db.query(models.Employee.id, models.Employee.company_role_id).filter(
        models.Employee.id.in_(employee_ids)).all()) if employee_ids else {}
    required_pairs = {
        (row.company_group_id, employee_roles[row.evaluator_id], employee_roles[row.evaluatee_id])
        for row in planned if not assignment_is_immutable(row)
        and row.evaluator_id in employee_roles and row.evaluatee_id in employee_roles
    }

    matrices = []
    for group in groups:
        roles = get_group_roles(group.id, db)
        role_pairs = []
        for evaluator_role in roles:
            for evaluatee_role in roles:
                rule = existing_rules.get((group.id, evaluator_role.id, evaluatee_role.id))
                role_pairs.append({
                    "evaluator_role_id": evaluator_role.id,
                    "evaluator_role_name": evaluator_role.name,
                    "evaluatee_role_id": evaluatee_role.id,
                    "evaluatee_role_name": evaluatee_role.name,
                    "form_id": rule.form_id if rule is not None else None,
                    "rule_id": rule.id if rule is not None else None,
                    "locked": rule is not None and (group.id, evaluator_role.id, evaluatee_role.id) in locked_role_pairs,
                    "required": (group.id, evaluator_role.id, evaluatee_role.id) in required_pairs,
                })
        matrices.append({
            "group_id": group.id,
            "group_name": group.name,
            "role_pairs": role_pairs,
            "required_count": sum(pair["required"] for pair in role_pairs),
            "configured_required_count": sum(pair["required"] and pair["form_id"] is not None for pair in role_pairs),
        })

    forms = db.query(models.Form).order_by(models.Form.name.asc()).all()
    return {
        "forms": [{"id": form.id, "name": form.name} for form in forms],
        "groups": matrices,
    }


def issued_role_pair_keys(campaign_id: int, db: Session):
    assignments = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        models.FilledForm.company_group_id.isnot(None),
        models.FilledForm.evaluator_id != models.FilledForm.evaluatee_id,
    ).all()
    issued = [assignment for assignment in assignments if assignment_is_immutable(assignment)]
    employee_ids = {employee_id for assignment in issued for employee_id in (assignment.evaluator_id, assignment.evaluatee_id)}
    roles = {person.id: person.company_role_id for person in db.query(models.Employee).filter(models.Employee.id.in_(employee_ids)).all()} if employee_ids else {}
    return {
        (assignment.company_group_id, roles[assignment.evaluator_id], roles[assignment.evaluatee_id])
        for assignment in issued
        if assignment.evaluator_id in roles and assignment.evaluatee_id in roles
    }


def get_or_create_default_form_status(db: Session):
    status = (
        db.query(models.FormStatus)
        .filter(func.lower(models.FormStatus.name) == "not started")
        .first()
    )
    if status is not None:
        return status

    status = models.FormStatus(name="Not started")
    db.add(status)
    db.flush()
    return status


def get_form_id_for_employee_pair(campaign_id: int, group_id: int, evaluator, evaluatee, db: Session):
    rule = (
        db.query(models.CampaignEvaluationRule)
        .filter(models.CampaignEvaluationRule.campaign_id == campaign_id)
        .filter(models.CampaignEvaluationRule.company_group_id == group_id)
        .filter(models.CampaignEvaluationRule.evaluator_role_id == evaluator.company_role_id)
        .filter(models.CampaignEvaluationRule.evaluatee_role_id == evaluatee.company_role_id)
        .first()
    )
    return rule.form_id if rule is not None else None


def build_campaign_evaluation_matrix(campaign_id: int, db: Session, issuance_errors=None, group_ids: list[int] | None = None):
    assigned_group_ids = get_campaign_assigned_group_ids(campaign_id, db) if group_ids is None else group_ids
    groups = []
    if len(assigned_group_ids) > 0:
        groups = (
            db.query(models.CompanyGroup)
            .filter(models.CompanyGroup.id.in_(assigned_group_ids))
            .order_by(models.CompanyGroup.name.asc())
            .all()
        )

    status_names = {status.id: status.name for status in db.query(models.FormStatus).all()}
    filled_forms_by_pair = {}
    for filled_form in (
        db.query(models.FilledForm)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .filter(models.FilledForm.company_group_id.isnot(None))
        .all()
    ):
        key = (filled_form.company_group_id, filled_form.evaluator_id, filled_form.evaluatee_id)
        existing = filled_forms_by_pair.get(key)
        if existing is None or assignment_is_immutable(filled_form) and not assignment_is_immutable(existing):
            filled_forms_by_pair[key] = filled_form

    matrices = []
    for group in groups:
        employee_rows = get_group_employees(group.id, db)
        active_member_ids = {person.id for person, _role in employee_rows}
        employees_by_id = {person.id: (person, role) for person, role in employee_rows}
        group_assignments = [row for row in filled_forms_by_pair.values() if row.company_group_id == group.id and assignment_is_immutable(row)]
        historical_employee_ids = {employee_id for row in group_assignments for employee_id in (row.evaluator_id, row.evaluatee_id)} - set(employees_by_id)
        if historical_employee_ids:
            for person, role in db.query(models.Employee, models.CompanyRole).join(
                models.CompanyRole, models.CompanyRole.id == models.Employee.company_role_id,
            ).filter(models.Employee.id.in_(historical_employee_ids)).all():
                employees_by_id[person.id] = (person, role)
        employee_rows = sorted(employees_by_id.values(), key=lambda item: (item[0].full_name.lower(), item[0].id))
        employees = [person for person, _role in employee_rows]
        matrices.append({
            "group_id": group.id,
            "group_name": group.name,
            "employees": [
                {
                    "id": person.id,
                    "name": person.full_name,
                    "role_id": role.id,
                    "role_name": role.name,
                    "active": person.id in active_member_ids and person.is_active,
                }
                for person, role in employee_rows
            ],
            "assignments": [
                {
                    "evaluator_id": evaluator.id,
                    "evaluatee_id": evaluatee.id,
                    "form_id": filled_form.form_id,
                    "filled_form_id": filled_form.id,
                    "issued": assignment_is_immutable(filled_form),
                    "is_completed": filled_form.finish_date is not None,
                    "status_name": status_names.get(filled_form.status_id, "Not started") if assignment_is_immutable(filled_form) else "Planned",
                    "has_answers": bool(filled_form.answers),
                }
                for evaluator in employees
                for evaluatee in employees
                for filled_form in [filled_forms_by_pair.get((group.id, evaluator.id, evaluatee.id))]
                if filled_form is not None
            ],
        })

    return {"groups": matrices, "issuance_errors": issuance_errors or []}


@app.get("/campaigns/{campaign_id}/evaluation-rules", response_model=schemas.CampaignEvaluationRulesResponse)
def get_campaign_evaluation_rules(campaign_id: int, db: Session = Depends(get_db),
                                  _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return build_campaign_rule_matrix(campaign_id, db)


@app.put("/campaigns/{campaign_id}/evaluation-rules", response_model=schemas.CampaignEvaluationRulesResponse)
def update_campaign_evaluation_rules(campaign_id: int, payload: schemas.CampaignEvaluationRulesUpdate, db: Session = Depends(get_db),
                                      manager: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_mutable_campaign_plan(campaign)

    assigned_group_ids = set(get_campaign_assigned_group_ids(campaign_id, db))
    form_ids = {form_id for (form_id,) in db.query(models.Form.id).all()}
    valid_role_pairs_by_group = {}
    for group_id in assigned_group_ids:
        role_ids = {role.id for role in get_group_roles(group_id, db)}
        valid_role_pairs_by_group[group_id] = {
            (evaluator_role_id, evaluatee_role_id)
            for evaluator_role_id in role_ids
            for evaluatee_role_id in role_ids
        }

    seen_pairs = set()
    for rule in payload.rules:
        if rule.company_group_id not in assigned_group_ids:
            raise HTTPException(status_code=400, detail="Rule group is not assigned to this campaign")
        if rule.form_id not in form_ids:
            raise HTTPException(status_code=400, detail="Rule form does not exist")
        pair = (rule.evaluator_role_id, rule.evaluatee_role_id)
        if pair not in valid_role_pairs_by_group.get(rule.company_group_id, set()):
            raise HTTPException(status_code=400, detail="Rule role pair is not valid for the selected group")
        unique_key = (rule.company_group_id, rule.evaluator_role_id, rule.evaluatee_role_id)
        if unique_key in seen_pairs:
            raise HTTPException(status_code=400, detail="Duplicate rule for the same group and role pair")
        seen_pairs.add(unique_key)

    selected_rules = {(rule.company_group_id, rule.evaluator_role_id, rule.evaluatee_role_id): rule.form_id for rule in payload.rules}
    existing_rules = {
        (rule.company_group_id, rule.evaluator_role_id, rule.evaluatee_role_id): rule
        for rule in db.query(models.CampaignEvaluationRule).filter(models.CampaignEvaluationRule.campaign_id == campaign_id).all()
    }
    for key in issued_role_pair_keys(campaign_id, db):
        current = existing_rules.get(key)
        if current is not None and selected_rules.get(key) != current.form_id:
            raise HTTPException(status_code=409, detail="Form rules used by issued evaluations cannot be changed or removed")

    for key, rule in existing_rules.items():
        if key not in selected_rules:
            db.delete(rule)
        else:
            rule.form_id = selected_rules[key]
    for key, form_id in selected_rules.items():
        if key not in existing_rules:
            group_id, evaluator_role_id, evaluatee_role_id = key
            db.add(models.CampaignEvaluationRule(
                campaign_id=campaign_id,
                company_group_id=group_id,
                evaluator_role_id=evaluator_role_id,
                evaluatee_role_id=evaluatee_role_id,
                form_id=form_id,
            ))
    for assignment in db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        unissued_snapshot_filter(),
        models.FilledForm.company_group_id.isnot(None),
    ).all():
        if assignment.finish_date is not None or assignment.answers or assignment.evaluator_id == assignment.evaluatee_id:
            continue
        evaluator = db.query(models.Employee).filter(models.Employee.id == assignment.evaluator_id).first()
        evaluatee = db.query(models.Employee).filter(models.Employee.id == assignment.evaluatee_id).first()
        form_id = selected_rules.get((assignment.company_group_id, evaluator.company_role_id, evaluatee.company_role_id)) if evaluator and evaluatee else None
        assignment.form_id = form_id
    db.flush()
    unschedule_if_incomplete(campaign, db, manager.id)
    db.commit()

    return build_campaign_rule_matrix(campaign_id, db)


@app.get("/campaigns/{campaign_id}/evaluation-matrix", response_model=schemas.CampaignEvaluationMatrixResponse)
def get_campaign_evaluation_matrix(campaign_id: int, db: Session = Depends(get_db),
                                   _reader: models.User = Depends(require_permission("campaigns.read"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")

    return build_campaign_evaluation_matrix(campaign_id, db)


def validate_matrix_issued_assignments(existing_by_pair, scoped_pairs, selected_pairs, requested_tasks, existing_tasks):
    issued_pairs = {pair for pair, form in existing_by_pair.items() if assignment_is_immutable(form)}
    if issued_pairs.intersection(scoped_pairs) - selected_pairs:
        raise HTTPException(status_code=409, detail="Issued evaluations cannot be removed from the matrix. Reload and keep their selections")

    new_tasks = set()
    for group_id, evaluator_id, evaluatee_id, _form_id in requested_tasks:
        if (group_id, evaluator_id, evaluatee_id) in existing_by_pair:
            continue
        task = (evaluator_id, evaluatee_id)
        if task in existing_tasks or task in new_tasks:
            raise HTTPException(status_code=409, detail="This evaluation already exists in another group; select it in only one group")
        new_tasks.add(task)


@app.put("/campaigns/{campaign_id}/evaluation-matrix", response_model=schemas.CampaignEvaluationMatrixUpdateResponse)
def update_campaign_evaluation_matrix(campaign_id: int, payload: schemas.CampaignEvaluationMatrixUpdate, db: Session = Depends(get_db),
                                       manager: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_mutable_campaign_plan(campaign)

    assigned_group_ids = set(get_campaign_assigned_group_ids(campaign_id, db))
    group_members_by_group = {
        group_id: {user.id: user for user, _role in get_group_employees(group_id, db)}
        for group_id in assigned_group_ids
    }
    scoped_group_user_pairs = {
        (group_id, evaluator_id, evaluatee_id)
        for group_id, members in group_members_by_group.items()
        for evaluator_id in members.keys()
        for evaluatee_id in members.keys()
    }
    existing_forms = db.query(models.FilledForm).filter(models.FilledForm.campaign_id == campaign_id).all()
    self_form_ids = {
        row.employee_id: row.form_id
        for row in db.query(models.CampaignEmployeeSelfEvaluation)
        .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id).all()
    }
    existing_self_forms = {form.evaluator_id: form for form in existing_forms if form.evaluator_id == form.evaluatee_id and assignment_is_immutable(form)}
    existing_by_pair = {}
    for filled_form in existing_forms:
        if filled_form.company_group_id is None:
            continue
        key = (filled_form.company_group_id, filled_form.evaluator_id, filled_form.evaluatee_id)
        if key in existing_by_pair:
            raise HTTPException(status_code=409, detail="Duplicate issued evaluations exist for a matrix pair; resolve them before saving")
        existing_by_pair[key] = filled_form
    scoped_group_user_pairs.update(pair for pair, assignment in existing_by_pair.items() if assignment_is_immutable(assignment))

    seen_assignments = set()
    desired_assignments = set()
    for assignment in payload.assignments:
        if assignment.company_group_id not in assigned_group_ids:
            raise HTTPException(status_code=400, detail="Assignment group is not assigned to this campaign")

        unique_group_pair = (assignment.company_group_id, assignment.evaluator_id, assignment.evaluatee_id)
        existing = existing_by_pair.get(unique_group_pair)
        if existing is not None and assignment_is_immutable(existing):
            if unique_group_pair in seen_assignments:
                raise HTTPException(status_code=400, detail="Duplicate matrix assignment")
            seen_assignments.add(unique_group_pair)
            desired_assignments.add((*unique_group_pair, existing.form_id))
            continue

        group_members = group_members_by_group.get(assignment.company_group_id, {})
        evaluator = group_members.get(assignment.evaluator_id)
        evaluatee = group_members.get(assignment.evaluatee_id)
        if evaluator is None or evaluatee is None:
            raise HTTPException(status_code=400, detail="Assignment employees must be active members of the selected group")

        if unique_group_pair in seen_assignments:
            raise HTTPException(status_code=400, detail="Duplicate matrix assignment")
        seen_assignments.add(unique_group_pair)

        if assignment.evaluator_id == assignment.evaluatee_id:
            if assignment.evaluator_id in existing_self_forms:
                # Another group already issued this employee's single campaign-wide task.
                continue
            form_id = self_form_ids.get(assignment.evaluator_id)
            desired_assignments.add((*unique_group_pair, form_id))
            continue
        form_id = get_form_id_for_employee_pair(campaign_id, assignment.company_group_id, evaluator, evaluatee, db)
        desired_assignments.add((*unique_group_pair, form_id))

    # Multiple groups can contain the same person, but only one diagonal task may be issued.
    self_tasks = {}
    for task in sorted(desired_assignments, key=lambda item: (item[0], item[1], item[2])):
        group_id, evaluator_id, evaluatee_id, form_id = task
        if evaluator_id != evaluatee_id or (group_id, evaluator_id, evaluatee_id) in existing_by_pair and assignment_is_immutable(existing_by_pair[(group_id, evaluator_id, evaluatee_id)]):
            continue
        if evaluator_id in self_tasks:
            desired_assignments.remove(task)
        else:
            self_tasks[evaluator_id] = form_id

    selected_people_pairs = set()
    for _group_id, evaluator_id, evaluatee_id, _form_id in desired_assignments:
        pair = (evaluator_id, evaluatee_id)
        if pair in selected_people_pairs:
            raise HTTPException(status_code=409, detail="Only one assignment per evaluator/evaluatee pair is allowed in a campaign")
        selected_people_pairs.add(pair)

    # Duplicate pairs are forbidden even when different groups specify different forms.
    existing_tasks = {
        (form.evaluator_id, form.evaluatee_id)
        for form in existing_forms
        if assignment_is_immutable(form)
    }
    validate_matrix_issued_assignments(
        existing_by_pair, scoped_group_user_pairs, seen_assignments, desired_assignments, existing_tasks
    )

    desired_by_pair = {(group_id, evaluator_id, evaluatee_id): form_id for group_id, evaluator_id, evaluatee_id, form_id in desired_assignments}
    removed_count = 0
    for pair, existing in existing_by_pair.items():
        if assignment_is_immutable(existing):
            continue
        if campaign.legacy_issuance_blocked and desired_by_pair.get(pair) != existing.form_id:
            raise HTTPException(status_code=409, detail="Historical planned assignments cannot be changed through migrated-campaign issuance")
        if pair not in desired_by_pair:
            db.delete(existing)
            removed_count += 1
        else:
            existing.form_id = desired_by_pair[pair]

    remaining_pairs = {(form.evaluator_id, form.evaluatee_id) for form in existing_forms if campaign.legacy_issuance_blocked or assignment_is_immutable(form) or (form.company_group_id, form.evaluator_id, form.evaluatee_id) in desired_by_pair}
    for group_id, evaluator_id, evaluatee_id, form_id in desired_assignments:
        if (group_id, evaluator_id, evaluatee_id) not in existing_by_pair and (evaluator_id, evaluatee_id) in remaining_pairs:
            raise HTTPException(status_code=409, detail="This evaluator/evaluatee pair already has an assignment in this campaign")
        remaining_pairs.add((evaluator_id, evaluatee_id))

    status = get_or_create_default_form_status(db)

    created_count = 0
    created_records = []
    for group_id, evaluator_id, evaluatee_id, form_id in desired_assignments:
        if (group_id, evaluator_id, evaluatee_id) in existing_by_pair:
            continue
        form = db.query(models.Form).filter(models.Form.id == form_id).first() if form_id is not None else None
        if form_id is not None and form is None:
            raise HTTPException(status_code=400, detail="Assignment form does not exist")
        record = models.FilledForm(
            campaign_id=campaign_id,
            company_group_id=group_id,
            evaluator_id=evaluator_id,
            evaluatee_id=evaluatee_id,
            form_id=form_id,
            status_id=status.id,
            finish_date=None,
            answers=[],
            form_snapshot=None,
            snapshot_status=None,
        )
        db.add(record)
        created_records.append(record)
        created_count += 1

    if campaign.legacy_issuance_blocked and campaign.status in {
        models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value,
    } and created_records:
        raise HTTPException(status_code=409, detail="New pairs in migrated campaigns require a verified issuance path")
    db.flush()
    unschedule_if_incomplete(campaign, db, manager.id)
    db.commit()
    matrix = build_campaign_evaluation_matrix(campaign_id, db)
    return {
        **matrix,
        "created_count": created_count,
        "removed_count": removed_count,
        "kept_completed_count": sum(form.finish_date is not None for form in existing_forms),
    }


@app.post("/campaigns/{campaign_id}/issue-planned", response_model=schemas.CampaignEvaluationMatrixResponse)
def issue_ready_campaign_evaluations(campaign_id: int, db: Session = Depends(get_db),
                                     manager: models.User = Depends(require_permission("campaigns.manage"))):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.is_archived or campaign.status not in {
        models.CampaignStatus.ACTIVE.value, models.CampaignStatus.REVIEW.value,
    } or campaign.legacy_issuance_blocked:
        raise HTTPException(status_code=409, detail="Only active or review campaigns with verified provenance can issue planned evaluations")
    now = datetime.now(timezone.utc)
    if campaign.status == models.CampaignStatus.ACTIVE.value and (
        campaign.start_date > now or campaign.end_date is not None and campaign.end_date <= now
    ):
        raise HTTPException(status_code=409, detail="The active campaign window has ended; move to Review before issuing")

    planned = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id, unissued_snapshot_filter(),
        models.FilledForm.finish_date.is_(None), models.FilledForm.answers == [],
    ).order_by(models.FilledForm.id).all()
    if not planned:
        raise HTTPException(status_code=409, detail="No planned evaluations are waiting for issuance")
    group_ids = set(get_campaign_assigned_group_ids(campaign_id, db))
    members = {group_id: {person.id: person for person, _ in get_group_employees(group_id, db)}
               for group_id in group_ids}
    self_forms = {row.employee_id: row.form_id for row in db.query(models.CampaignEmployeeSelfEvaluation)
                  .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id)}
    for row in planned:
        group_members = members.get(row.company_group_id, {})
        evaluator = group_members.get(row.evaluator_id)
        evaluatee = group_members.get(row.evaluatee_id)
        if evaluator is None or evaluatee is None:
            raise HTTPException(status_code=409, detail="Planned evaluation employees must belong to an active selected group")
        expected = self_forms.get(row.evaluator_id) if row.evaluator_id == row.evaluatee_id else get_form_id_for_employee_pair(
            campaign_id, row.company_group_id, evaluator, evaluatee, db)
        if expected is None:
            raise HTTPException(status_code=409, detail="Assign questionnaires to all planned evaluation pairs before issuing")
        if row.form_id != expected:
            raise HTTPException(status_code=409, detail="A planned evaluation has a stale questionnaire; save its role assignments before issuing")

    errors = issue_activation_snapshots(campaign, db, actor_user_id=manager.id)
    if errors:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cannot issue planned evaluations: " + "; ".join(errors))
    db.commit()
    return build_campaign_evaluation_matrix(campaign_id, db)


@app.get("/campaigns/{campaign_id}/setup-preview", response_model=schemas.CampaignSetupPreviewResponse)
def get_campaign_setup_preview(campaign_id: int, group_ids: list[int] = Query(default=[]),
                               db: Session = Depends(get_db),
                               _reader: models.User = Depends(require_permission("campaigns.read"))):
    if db.query(models.Campaign.id).filter(models.Campaign.id == campaign_id).first() is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if len(group_ids) != len(set(group_ids)) or db.query(models.CompanyGroup.id).filter(models.CompanyGroup.id.in_(group_ids)).count() != len(group_ids):
        raise HTTPException(status_code=400, detail="Selected groups must exist and be unique")
    return {
        "rules": build_campaign_rule_matrix(campaign_id, db, group_ids),
        "self_evaluations": build_campaign_self_evaluations(campaign_id, db, group_ids),
        "matrix": build_campaign_evaluation_matrix(campaign_id, db, group_ids=group_ids),
    }


@app.put("/campaigns/{campaign_id}/setup", response_model=schemas.CampaignEvaluationMatrixResponse)
def update_campaign_setup(campaign_id: int, payload: schemas.CampaignSetupUpdate, db: Session = Depends(get_db),
                          manager: models.User = Depends(require_permission("campaigns.manage"))):
    """Replace a draft/scheduled configuration in one transaction, without issuing forms."""
    try:
        if payload.memberships:
            grant = db.query(models.SystemPermission.id).select_from(models.User).join(
                models.SystemRole, models.SystemRole.id == models.User.system_role_id,
            ).join(models.system_role_permissions,
                   models.system_role_permissions.c.system_role_id == models.SystemRole.id).join(
                models.SystemPermission, models.SystemPermission.id == models.system_role_permissions.c.permission_id,
            ).filter(models.User.id == manager.id, models.SystemPermission.name == "groups.manage").first()
            if grant is None:
                raise HTTPException(status_code=403, detail="Group membership changes require groups.manage")
        campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
        if campaign is None:
            raise HTTPException(status_code=404, detail="Campaign not found")
        require_mutable_campaign_configuration(campaign)
        if campaign.status not in {models.CampaignStatus.DRAFT.value, models.CampaignStatus.SCHEDULED.value}:
            raise HTTPException(status_code=409, detail="Only draft and scheduled campaigns can replace their setup")

        group_ids = set(payload.group_ids)
        if len(group_ids) != len(payload.group_ids) or db.query(models.CompanyGroup.id).filter(models.CompanyGroup.id.in_(group_ids)).count() != len(group_ids):
            raise HTTPException(status_code=400, detail="Groups must exist and be unique")

        previous_groups = set(get_campaign_assigned_group_ids(campaign_id, db))
        removed_groups = previous_groups - group_ids
        membership_keys = set()
        affected = {}
        for change in payload.memberships:
            key = (change.company_group_id, change.employee_id)
            if key in membership_keys or change.company_group_id not in (group_ids | previous_groups):
                raise HTTPException(status_code=400, detail="Membership changes must be unique and belong to a campaign group")
            membership_keys.add(key)
            if db.query(models.Employee.id).filter(models.Employee.id == change.employee_id).first() is None:
                raise HTTPException(status_code=400, detail="Membership employee does not exist")
        if membership_keys:
            affected = {row.id: row for row in scheduled_campaigns_for_groups(
                {group_id for group_id, _ in membership_keys}, db) if row.id != campaign_id}
        for change in payload.memberships:
            membership = models.employee_company_groups.select().where(
                models.employee_company_groups.c.company_group_id == change.company_group_id,
                models.employee_company_groups.c.employee_id == change.employee_id,
            )
            exists = db.execute(membership).first() is not None
            if change.included and not exists:
                db.execute(models.employee_company_groups.insert().values(
                    company_group_id=change.company_group_id, employee_id=change.employee_id))
            elif not change.included and exists:
                immutable = db.query(models.FilledForm).filter(
                    models.FilledForm.company_group_id == change.company_group_id,
                    or_(models.FilledForm.evaluator_id == change.employee_id,
                        models.FilledForm.evaluatee_id == change.employee_id),
                ).all()
                if any(assignment_is_immutable(row) for row in immutable):
                    raise HTTPException(status_code=409, detail="Issued evaluations prevent removing this member")
                db.execute(models.employee_company_groups.delete().where(
                    models.employee_company_groups.c.company_group_id == change.company_group_id,
                    models.employee_company_groups.c.employee_id == change.employee_id))

        members = {group_id: {person.id: person for person, _ in get_group_employees(group_id, db)} for group_id in group_ids}
        participants = {employee_id for people in members.values() for employee_id in people}
        form_ids = {row[0] for row in db.query(models.Form.id).all()}
        rules = {}
        for item in payload.rules:
            if item.company_group_id in removed_groups:
                continue
            key = (item.company_group_id, item.evaluator_role_id, item.evaluatee_role_id)
            roles = {person.company_role_id for person in members.get(item.company_group_id, {}).values()}
            if key in rules or item.evaluator_role_id not in roles or item.evaluatee_role_id not in roles or item.form_id not in form_ids:
                raise HTTPException(status_code=400, detail="Invalid or duplicate role rule")
            rules[key] = item.form_id
        self_forms = {}
        existing_self = {row.employee_id: row for row in db.query(models.CampaignEmployeeSelfEvaluation)
                         .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id)}
        for item in payload.self_evaluations:
            if item.employee_id not in participants and item.employee_id in existing_self and removed_groups:
                continue
            if item.employee_id in self_forms or item.employee_id not in participants or (item.form_id is not None and item.form_id not in form_ids):
                raise HTTPException(status_code=400, detail="Invalid or duplicate self-evaluation")
            if item.form_id is not None:
                self_forms[item.employee_id] = item.form_id

        selected = {}
        selected_people = set()
        for item in payload.assignments:
            if item.company_group_id in removed_groups:
                continue
            key = (item.company_group_id, item.evaluator_id, item.evaluatee_id)
            pair = (item.evaluator_id, item.evaluatee_id)
            if key in selected or pair in selected_people or item.evaluator_id not in members.get(item.company_group_id, {}) or item.evaluatee_id not in members[item.company_group_id]:
                raise HTTPException(status_code=400, detail="Invalid or duplicate matrix assignment")
            selected_people.add(pair)
            evaluator = members[item.company_group_id][item.evaluator_id]
            evaluatee = members[item.company_group_id][item.evaluatee_id]
            form_id = (self_forms.get(item.evaluator_id) if item.evaluator_id == item.evaluatee_id else
                       rules.get((item.company_group_id, evaluator.company_role_id, evaluatee.company_role_id)))
            selected[key] = form_id

        existing_assignments = db.query(models.FilledForm).filter(models.FilledForm.campaign_id == campaign_id).all()
        existing_pairs = set()
        for row in existing_assignments:
            key = (row.company_group_id, row.evaluator_id, row.evaluatee_id)
            if key in existing_pairs:
                raise HTTPException(status_code=409, detail="Duplicate historical matrix assignments must be resolved")
            existing_pairs.add(key)
            if assignment_is_immutable(row) and (key not in selected or selected[key] != row.form_id):
                raise HTTPException(status_code=409, detail="Issued evaluations cannot be changed or removed")
            if campaign.legacy_issuance_blocked and not assignment_is_immutable(row) and (key not in selected or selected[key] != row.form_id):
                raise HTTPException(status_code=409, detail="Historical planned assignments cannot be changed")
        relocated = {}
        for row in existing_assignments:
            if row.company_group_id not in removed_groups or assignment_is_immutable(row) or campaign.legacy_issuance_blocked:
                continue
            pair = (row.evaluator_id, row.evaluatee_id)
            if any((other.evaluator_id, other.evaluatee_id) == pair and other.id != row.id for other in existing_assignments):
                continue
            candidates = [key for key in selected if key[1:] == pair]
            if not candidates and pair not in selected_people:
                for group_id in sorted(group_ids):
                    people = members[group_id]
                    if pair[0] not in people or pair[1] not in people:
                        continue
                    form_id = (self_forms.get(pair[0]) if pair[0] == pair[1] else rules.get(
                        (group_id, people[pair[0]].company_role_id, people[pair[1]].company_role_id)))
                    target = (group_id, *pair)
                    selected[target] = form_id
                    selected_people.add(pair)
                    candidates = [target]
                    break
            if candidates:
                relocated[row.id] = candidates[0]
        existing_rules = {(row.company_group_id, row.evaluator_role_id, row.evaluatee_role_id): row for row in
                          db.query(models.CampaignEvaluationRule).filter(models.CampaignEvaluationRule.campaign_id == campaign_id)}
        for key in issued_role_pair_keys(campaign_id, db):
            if key in existing_rules and rules.get(key) != existing_rules[key].form_id:
                raise HTTPException(status_code=409, detail="Issued form rules cannot be changed or removed")
        for row in existing_assignments:
            if assignment_is_immutable(row) and row.evaluator_id == row.evaluatee_id and self_forms.get(row.evaluator_id) != row.form_id:
                raise HTTPException(status_code=409, detail="Issued self-evaluations cannot be changed")

        for row in existing_assignments:
            if not assignment_is_immutable(row) and not campaign.legacy_issuance_blocked:
                key = relocated.get(row.id, (row.company_group_id, row.evaluator_id, row.evaluatee_id))
                if key not in selected:
                    db.delete(row)
                else:
                    row.company_group_id = key[0]
                    row.form_id = selected[key]
        for key, row in existing_rules.items():
            if key not in rules:
                db.delete(row)
            else:
                row.form_id = rules[key]
        for key, form_id in rules.items():
            if key not in existing_rules:
                db.add(models.CampaignEvaluationRule(campaign_id=campaign_id, company_group_id=key[0],
                                                     evaluator_role_id=key[1], evaluatee_role_id=key[2], form_id=form_id))
        for employee_id, row in existing_self.items():
            if employee_id not in self_forms:
                db.delete(row)
            else:
                row.form_id = self_forms[employee_id]
        for employee_id, form_id in self_forms.items():
            if employee_id not in existing_self:
                db.add(models.CampaignEmployeeSelfEvaluation(campaign_id=campaign_id, employee_id=employee_id, form_id=form_id))
        db.execute(models.campaign_company_groups.delete().where(models.campaign_company_groups.c.campaign_id == campaign_id))
        for group_id in sorted(group_ids):
            db.execute(models.campaign_company_groups.insert().values(campaign_id=campaign_id, company_group_id=group_id))
        retained_pairs = existing_pairs | set(relocated.values())
        status = get_or_create_default_form_status(db) if selected.keys() - retained_pairs else None
        for key, form_id in selected.items():
            if key not in retained_pairs:
                db.add(models.FilledForm(campaign_id=campaign_id, company_group_id=key[0], evaluator_id=key[1],
                                         evaluatee_id=key[2], form_id=form_id, status_id=status.id,
                                         finish_date=None, answers=[], form_snapshot=None, snapshot_status=None))
        db.flush()
        unschedule_if_incomplete(campaign, db, manager.id)
        for other in affected.values():
            validate_scheduled_campaign(other, db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return build_campaign_evaluation_matrix(campaign_id, db)


@app.get("/forms", response_model=list[schemas.FormResponse])
def get_forms(db: Session = Depends(get_db),
              _reader: models.User = Depends(require_permission("forms.read"))):
    return db.query(models.Form).order_by(models.Form.id.desc()).all()


@app.post("/forms/ai/generate", response_model=schemas.FormAIGenerateResponse)
def generate_form_draft(request: schemas.FormAIGenerateRequest, db: Session = Depends(get_db),
                        _manager: models.User = Depends(require_permission("forms.manage"))):
    workspace_settings_service.require_ai_enabled(db)

    def validation_errors(draft: dict) -> list[str]:
        if not all(section["section_id"] is not None for section in draft["sections"]):
            return []  # Proposed sections have no DB IDs until HR approves them.
        blocks = [{"type": "section", "section_id": section["section_id"], "questions": section["questions"]}
                  for section in draft["sections"]]
        blocks.extend({"type": "question", "question": question} for question in draft["standalone_questions"])
        errors = form_issuance_errors(blocks, db)
        feedback = []
        for error in errors:
            if "option" in error.lower():
                feedback.append("Choice questions need at least two distinct, labeled options")
            elif "scale" in error.lower() or "maximum" in error.lower():
                feedback.append("Rating scales need integer endpoints 1 and 5 with higher values better")
            elif "section" in error.lower():
                feedback.append("Every section must be nonempty and reference a unique existing Section")
            elif "id" in error.lower():
                feedback.append("Every question needs a unique ID")
            else:
                feedback.append("Every question must meet the form issuance rules")
        return list(dict.fromkeys(feedback))

    return ai_form_generation_service.generate(request, db, validate_draft=validation_errors)


@app.get("/form-templates", response_model=list[schemas.FormTemplateResponse])
def get_form_templates(db: Session = Depends(get_db),
                       _reader: models.User = Depends(require_permission("forms.read"))):
    return db.query(models.FormTemplate).order_by(models.FormTemplate.id.asc()).all()


def clone_template_questions(questions: list[dict]):
    cloned_questions = deepcopy(questions)
    for question in iter_form_questions(cloned_questions):
        question["id"] = str(uuid4())
    return cloned_questions


def iter_form_questions(structure):
    yield from form_snapshot_service.iter_snapshot_questions(structure)


def validate_choice_question_options(question: dict, question_index: int):
    question_type = question.get("type")
    if question_type not in {"Single choice", "Multiple choice"}:
        return

    options = question.get("options")
    if not isinstance(options, list):
        raise HTTPException(
            status_code=400,
            detail=f"Question {question_index + 1} needs at least two answer options",
        )

    normalized_ids = []
    normalized_labels = []
    for option_index, option in enumerate(options):
        if not isinstance(option, dict):
            raise HTTPException(
                status_code=400,
                detail=f"Question {question_index + 1} option {option_index + 1} is invalid",
            )
        option_id = option.get("id")
        option_label = option.get("label")
        if not isinstance(option_id, str) or option_id.strip() == "":
            raise HTTPException(
                status_code=400,
                detail=f"Question {question_index + 1} option {option_index + 1} needs an id",
            )
        if not isinstance(option_label, str) or option_label.strip() == "":
            raise HTTPException(
                status_code=400,
                detail=f"Question {question_index + 1} option {option_index + 1} needs a label",
            )
        normalized_ids.append(option_id.strip())
        normalized_labels.append(option_label.strip().lower())

    if len(normalized_labels) < 2:
        raise HTTPException(
            status_code=400,
            detail=f"Question {question_index + 1} needs at least two answer options",
        )
    if len(set(normalized_ids)) != len(normalized_ids):
        raise HTTPException(status_code=400, detail=f"Question {question_index + 1} has duplicate option ids")
    if len(set(normalized_labels)) != len(normalized_labels):
        raise HTTPException(status_code=400, detail=f"Question {question_index + 1} has duplicate option labels")


def validate_question_definitions(questions: list[dict], db: Session | None = None):
    if not isinstance(questions, list):
        raise HTTPException(status_code=400, detail="Questions must be a list")
    is_block_structure = any(isinstance(item, dict) and item.get("type") in {"section", "question"} for item in questions)
    if is_block_structure:
        seen_sections = set()
        seen_questions = set()
        for block_index, block in enumerate(questions):
            if not isinstance(block, dict):
                raise HTTPException(status_code=400, detail=f"Block {block_index + 1} is invalid")
            if block.get("type") == "section":
                section_id = block.get("section_id")
                if not isinstance(section_id, int) or section_id in seen_sections:
                    raise HTTPException(status_code=400, detail="Section references must be valid and unique within a form")
                seen_sections.add(section_id)
                section = db.query(models.Section).filter(models.Section.id == section_id, models.Section.scope_key == "default").first() if db is not None else True
                if not section:
                    raise HTTPException(status_code=400, detail=f"Section {section_id} is unavailable to this account")
                nested = block.get("questions")
                if not isinstance(nested, list):
                    raise HTTPException(status_code=400, detail=f"Section {section_id} questions must be a list")
                for question in nested:
                    if not isinstance(question, dict):
                        raise HTTPException(status_code=400, detail=f"Section {section_id} contains an invalid question")
                    _validate_structured_question(question, seen_questions, db)
            elif block.get("type") == "question":
                question = block.get("question")
                if not isinstance(question, dict):
                    raise HTTPException(status_code=400, detail=f"Question block {block_index + 1} is invalid")
                _validate_structured_question(question, seen_questions, db)
            else:
                raise HTTPException(status_code=400, detail=f"Block {block_index + 1} has an unknown type")
        return
    for index, question in enumerate(questions):
        if not isinstance(question, dict):
            raise HTTPException(status_code=400, detail=f"Question {index + 1} is invalid")
        validate_choice_question_options(question, index)
        validate_legacy_dimension_metadata(question)


def validate_legacy_dimension_metadata(question: dict):
    """Accept well-formed stored metadata verbatim; never resolve it through a catalog."""
    id_fields = [question[field] for field in ("dimension_id", "dimensionId") if field in question]
    raw = question.get("dimension")
    if not id_fields and raw is None:
        return
    if question.get("type") not in {"Scale", "Numerical scale", "Scale 1-5", "Scale 1-10"}:
        raise HTTPException(status_code=400, detail="Only rating questions can carry legacy dimension metadata")
    if any(type(value) is not int or value <= 0 for value in id_fields) or len(set(id_fields)) > 1:
        raise HTTPException(status_code=400, detail="Invalid legacy dimension ID")
    if raw is not None:
        if isinstance(raw, str):
            valid = bool(raw.strip())
        elif isinstance(raw, dict):
            identifier = raw.get("id")
            name = raw.get("name")
            valid = ((identifier is None or type(identifier) is int and identifier > 0)
                     and (name is None or isinstance(name, str) and bool(name.strip()))
                     and (identifier is not None or name is not None)
                     and (not id_fields or identifier is None or identifier == id_fields[0]))
        else:
            valid = False
        if not valid:
            raise HTTPException(status_code=400, detail="Invalid legacy dimension metadata")


def form_issuance_errors(structure: list[dict], db: Session | None = None) -> list[str]:
    """Readiness is deliberately separate from draft persistence."""
    try:
        validate_question_definitions(structure, db)
    except HTTPException as error:
        return [str(error.detail)]
    errors: list[str] = []
    questions = list(iter_form_questions(structure))
    seen_ids: set[str] = set()
    if not questions:
        errors.append("A form must contain at least one question.")
    for block in structure if isinstance(structure, list) else []:
        if isinstance(block, dict) and block.get("type") == "section" and not block.get("questions"):
            section = db.query(models.Section).filter(models.Section.id == block.get("section_id")).first() if db is not None else None
            errors.append(f"{section.name if section else 'Section'} must contain at least one question.")
    for index, question in enumerate(questions, start=1):
        name = question.get("text") if isinstance(question.get("text"), str) and question["text"].strip() else f"Question {index}"
        question_id = question.get("id")
        if not isinstance(question_id, str) or not question_id.strip() or question_id in seen_ids:
            errors.append(f"{name} needs a unique question ID.")
        else:
            seen_ids.add(question_id)
        if not isinstance(question.get("text"), str) or not question["text"].strip():
            errors.append(f"{name} needs question text.")
        if question.get("type") not in {"Scale", "Numerical scale", "Scale 1-5", "Scale 1-10", "Single choice", "Multiple choice", "Text", "Number", "Date"}:
            errors.append(f"{name} has an unsupported question type.")
        if question.get("type") in {"Scale", "Numerical scale", "Scale 1-5", "Scale 1-10"}:
            minimum = question.get("scale_min", 1 if question.get("type") in {"Scale 1-5", "Scale 1-10"} else None)
            maximum = question.get("scale_max", 5 if question.get("type") == "Scale 1-5" else 10 if question.get("type") == "Scale 1-10" else None)
            if type(minimum) is not int or type(maximum) is not int or maximum <= minimum:
                errors.append(f"{name} needs integer scale limits with a maximum greater than its minimum.")
            if question.get("scale_direction", "higher_is_better") != "higher_is_better":
                errors.append(f"{name} must score higher values as better.")
            if any(label in question and question[label] is not None and not isinstance(question[label], str) for label in ("min_label", "max_label")):
                errors.append(f"{name} has an invalid endpoint label.")
        if question.get("type") in {"Single choice", "Multiple choice"}:
            options = question.get("options")
            valid = isinstance(options, list) and len(options) >= 2 and all(
                isinstance(option, dict)
                and isinstance(option.get("id"), str)
                and option["id"].strip()
                and isinstance(option.get("label"), str)
                and option["label"].strip()
                for option in options
            )
            if valid:
                option_ids = [option["id"].strip() for option in options]
                option_labels = [option["label"].strip().casefold() for option in options]
                valid = len(option_ids) == len(set(option_ids)) and len(option_labels) == len(set(option_labels))
            if not valid:
                errors.append(f'{name} must contain at least two valid answer options.')
    return errors


def _validate_structured_question(question: dict, seen_ids: set, db: Session | None):
    question_id = question.get("id")
    if not isinstance(question_id, str) or not question_id.strip() or question_id in seen_ids:
        raise HTTPException(status_code=400, detail="Question IDs must be present and unique")
    seen_ids.add(question_id)
    validate_legacy_dimension_metadata(question)
    # A structured form is an editable draft. Choice completeness is enforced by
    # form_issuance_errors instead of preventing an HR user from saving progress.
    if question.get("type") in {"Scale", "Numerical scale", "Scale 1-5", "Scale 1-10"}:
        minimum = question.get("scale_min", 1 if question.get("type") == "Scale 1-5" else None)
        maximum = question.get("scale_max", 5 if question.get("type") == "Scale 1-5" else 10 if question.get("type") == "Scale 1-10" else None)
        if not isinstance(minimum, (int, float)) or not isinstance(maximum, (int, float)) or maximum <= minimum:
            raise HTTPException(status_code=400, detail=f"Scale question {question_id} needs a maximum greater than its minimum")
        direction = question.get("scale_direction", "higher_is_better")
        if direction != "higher_is_better":
            raise HTTPException(status_code=400, detail=f"Scale question {question_id} must score higher values as better")
        for field in ("min_label", "max_label"):
            if field in question and question[field] is not None and not isinstance(question[field], str):
                raise HTTPException(status_code=400, detail=f"Scale question {question_id} has an invalid endpoint label")


def validate_form_like_payload(payload: schemas.FormCreate, model, db: Session, item_id: int | None = None):
    name = payload.name.strip()
    if name == "":
        raise HTTPException(status_code=400, detail="Name is required")

    existing_query = db.query(model).filter(func.lower(model.name) == name.lower())
    if item_id is not None:
        existing_query = existing_query.filter(model.id != item_id)
    if existing_query.first() is not None:
        raise HTTPException(status_code=400, detail="Name already exists")

    questions = deepcopy(payload.questions)
    validate_question_definitions(questions, db)

    return {
        "name": name,
        "description": payload.description.strip() if payload.description is not None else None,
        "questions": questions,
    }


@app.post("/forms", response_model=schemas.FormResponse)
def create_form(form: schemas.FormCreate, db: Session = Depends(get_db),
                _manager: models.User = Depends(require_permission("forms.manage"))):
    values = validate_form_like_payload(form, models.Form, db)
    if form.source_template_id is not None:
        template = db.query(models.FormTemplate).filter(models.FormTemplate.id == form.source_template_id).first()
        if template is None:
            raise HTTPException(status_code=404, detail="Template not found")
        values["questions"] = clone_template_questions(template.questions)
    new_form = models.Form(**values)
    db.add(new_form)
    db.commit()
    db.refresh(new_form)
    return new_form


@app.get("/forms/{form_id}/validation", response_model=schemas.FormValidationResponse)
def get_form_issuance_validation(form_id: int, db: Session = Depends(get_db),
                                 _reader: models.User = Depends(require_permission("forms.read"))):
    form = db.query(models.Form).filter(models.Form.id == form_id).first()
    if form is None:
        raise HTTPException(status_code=404, detail="Form not found")
    errors = form_issuance_errors(form.questions if isinstance(form.questions, list) else [], db)
    return {"valid_for_issuance": not errors, "errors": errors}


@app.post("/form-templates", response_model=schemas.FormTemplateResponse)
def create_form_template(template: schemas.FormCreate, db: Session = Depends(get_db),
                         _manager: models.User = Depends(require_permission("forms.manage"))):
    new_template = models.FormTemplate(**validate_form_like_payload(template, models.FormTemplate, db))
    db.add(new_template)
    db.commit()
    db.refresh(new_template)
    return new_template


@app.put("/forms/{form_id}", response_model=schemas.FormResponse)
def update_form(form_id: int, form_update: schemas.FormUpdate, db: Session = Depends(get_db),
                  _manager: models.User = Depends(require_permission("forms.manage"))):
    # Editing a shared source Form must not silently issue campaign questionnaires.
    campaigns = campaigns_referencing_form(form_id, db)
    for campaign in campaigns:
        require_mutable_campaign_configuration(campaign)
        if campaign.status == models.CampaignStatus.ACTIVE.value and db.query(models.FilledForm.id).filter(
            models.FilledForm.campaign_id == campaign.id, models.FilledForm.form_id == form_id,
            unissued_snapshot_filter(),
        ).first() is not None:
            raise HTTPException(status_code=409, detail="Issue planned active campaign assignments before editing their source form")
    form = db.query(models.Form).filter(models.Form.id == form_id).first()
    if form is None:
        raise HTTPException(status_code=404, detail="Form not found")
    values = validate_form_like_payload(form_update, models.Form, db, form_id)
    form.name = values["name"]
    form.description = values["description"]
    form.questions = values["questions"]
    db.flush()
    for campaign in campaigns:
        validate_scheduled_campaign(campaign, db)
    db.commit()
    db.refresh(form)
    return form


@app.put("/form-templates/{template_id}", response_model=schemas.FormTemplateResponse)
def update_form_template(template_id: int, template_update: schemas.FormUpdate, db: Session = Depends(get_db),
                         _manager: models.User = Depends(require_permission("forms.manage"))):
    template = db.query(models.FormTemplate).filter(models.FormTemplate.id == template_id).first()
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    values = validate_form_like_payload(template_update, models.FormTemplate, db, template_id)
    template.name = values["name"]
    template.description = values["description"]
    template.questions = values["questions"]
    db.commit()
    db.refresh(template)
    return template


@app.delete("/forms/{form_id}")
def delete_form(form_id: int, db: Session = Depends(get_db),
                  _manager: models.User = Depends(require_permission("forms.manage"))):
    if any(campaign.is_archived or campaign.status in {models.CampaignStatus.SCHEDULED.value, models.CampaignStatus.PAUSED.value,
                               models.CampaignStatus.REVIEW.value, models.CampaignStatus.CLOSED.value}
           for campaign in campaigns_referencing_form(form_id, db)):
        raise HTTPException(status_code=409, detail="A locked campaign still uses this form")
    form = db.query(models.Form).filter(models.Form.id == form_id).first()
    if form is None:
        raise HTTPException(status_code=404, detail="Form not found")

    db.delete(form)
    db.commit()
    return {"deleted": True}


@app.delete("/form-templates/{template_id}")
def delete_form_template(template_id: int, db: Session = Depends(get_db),
                         _manager: models.User = Depends(require_permission("forms.manage"))):
    template = db.query(models.FormTemplate).filter(models.FormTemplate.id == template_id).first()
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    db.delete(template)
    db.commit()
    return {"deleted": True}

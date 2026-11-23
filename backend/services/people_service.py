"""Business logic of the organisation: employees, company roles, groups, group leaders and imports."""

from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
import schemas
from integrations import auth0_management
from services import (
    account_service,
    campaign_service,
    invitation_service,
    people_import_service,
    workspace_settings_service,
)

email_validator = TypeAdapter(schemas.EmailStr)


EMPLOYEE_IMPORT_HEADERS = [
    "Employee Name",
    "Employee Email Address",
    "Employee Company Role",
    "Employee System Role",
]


GROUP_IMPORT_HEADERS = ["Group Name", "Group Description"]


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


def get_people(*, db: Session):
    employees = (
        db.query(models.Employee)
        .order_by(models.Employee.is_active.desc(), models.Employee.full_name.asc())
        .all()
    )
    company_roles = db.query(models.CompanyRole).all()
    roles_by_id = {role.id: role.name for role in company_roles}
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
                **account_service.account_fields(employee.user, db),
            }
            for employee in employees
        ],
        "groups": [serialize_group(group) for group in groups],
        "company_roles": [{"id": role.id, "name": role.name}
                          for role in sorted(company_roles, key=lambda item: item.name.lower()) if role.archived_at is None],
        "system_roles": [{"id": role.id, "name": role.name, "description": role.description}
                         for role in db.query(models.SystemRole).order_by(models.SystemRole.id).all()],
    }


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
    elif company_role.archived_at is not None:
        # Typing an archived role's name brings it back instead of creating a near-duplicate.
        company_role.archived_at = None
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


def create_people_employee(*, employee: schemas.PeopleEmployeeCreate, db: Session, actor: models.User):
    name = " ".join(employee.name.split())
    role_name = employee.role.strip()
    if name == "" or role_name == "":
        raise HTTPException(status_code=400, detail="Name and role are required")

    email = account_service.normalized_email(employee.email)
    if account_service.email_taken(email, db):
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
    new_user = invitation_service.invite_user(new_user, actor, db)
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
        **account_service.account_fields(new_user, db),
    }


def update_people_employee(*, employee_id: int, employee: schemas.PeopleEmployeeUpdate, db: Session):
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

    email = account_service.normalized_email(employee.email)
    if account_service.email_taken(email, db, except_user_id=user.id):
        raise HTTPException(status_code=409, detail="Employee email already exists")
    if user.auth0_user_id and email != account_service.normalized_email(user.email):
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
    affected_campaigns = campaign_service.scheduled_campaigns_for_groups(current_group_ids | set(group_ids), db)
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
        campaign_service.validate_scheduled_campaign(campaign, db)
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
        **account_service.account_fields(user, db),
    }


def company_role_usage(db: Session) -> list[dict]:
    employee_counts = dict(db.query(models.Employee.company_role_id, func.count(models.Employee.id))
                           .group_by(models.Employee.company_role_id).all())
    used = set()
    for column in (models.FilledForm.evaluator_company_role_id, models.FilledForm.evaluatee_company_role_id,
                   models.CampaignEvaluationRule.evaluator_role_id, models.CampaignEvaluationRule.evaluatee_role_id):
        used.update(role_id for (role_id,) in db.query(column).filter(column.isnot(None)).distinct().all())
    return [{"id": role.id, "name": role.name, "employee_count": employee_counts.get(role.id, 0),
             "used_in_campaigns": role.id in used, "archived": role.archived_at is not None}
            for role in db.query(models.CompanyRole).order_by(func.lower(models.CompanyRole.name)).all()]


def delete_company_role(*, role_id: int, db: Session, actor: models.User):
    """Unused roles are deleted; roles that campaigns refer to are archived so their reports keep the name."""
    role = db.query(models.CompanyRole).filter(models.CompanyRole.id == role_id).with_for_update().first()
    if role is None:
        raise HTTPException(status_code=404, detail="Company role not found")
    usage = next(item for item in company_role_usage(db) if item["id"] == role_id)
    if usage["employee_count"]:
        count = usage["employee_count"]
        raise HTTPException(status_code=409, detail=f"Move the {count} employee{'s' if count != 1 else ''} with this role to another role first")
    if usage["used_in_campaigns"]:
        if role.archived_at is None:
            role.archived_at = datetime.now(timezone.utc)
        summary = f"Company role archived: {role.name}"
    else:
        db.delete(role)
        summary = f"Company role deleted: {role.name}"
    workspace_settings_service.record_audit(db, "accounts", actor, summary, {"role": role.name})
    db.commit()
    return company_role_usage(db)


def update_people_employee_system_role(*, employee_id: int, update: schemas.EmployeeSystemRoleUpdate, db: Session, actor: models.User):
    person = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if person is None or person.user is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    role = workspace_settings_service.change_user_system_role(actor, person.user, update.system_role_id, db)
    return {"id": role.id, "name": role.name, "description": role.description}


def resend_employee_invitation(*, employee_id: int, db: Session, actor: models.User):
    person = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if person is None or person.user is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    if not person.is_active or not person.user.is_active:
        raise HTTPException(status_code=409, detail="Inactive employees cannot be invited")
    if not auth0_management.password_reset_available():
        raise HTTPException(status_code=503, detail="Sign-in invitations are not configured on the server")
    user = invitation_service.invite_user(person.user, actor, db, enforce_cooldown=True)
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
        **account_service.account_fields(user, db),
    }


def create_people_group(*, group: schemas.PeopleGroupCreate, db: Session):
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


def update_people_group(*, group_id: int, group: schemas.PeopleGroupUpdate, db: Session):
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


def add_people_group_member(*, group_id: int, member: schemas.PeopleGroupMemberCreate, db: Session):
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

    affected_campaigns = campaign_service.scheduled_campaigns_for_groups({group_id}, db)
    db.execute(
        models.employee_company_groups.insert().values(
            employee_id=member.employee_id,
            company_group_id=group_id,
        )
    )
    for campaign in affected_campaigns:
        campaign_service.validate_scheduled_campaign(campaign, db)
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


def remove_people_group_member(*, group_id: int, employee_id: int, db: Session):
    group = db.query(models.CompanyGroup).filter(models.CompanyGroup.id == group_id).first()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")

    person = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if person is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    affected_campaigns = campaign_service.scheduled_campaigns_for_groups({group_id}, db)
    ensure_group_membership_mutable(group_id, employee_id, db)

    delete_result = db.execute(
        models.employee_company_groups.delete()
        .where(models.employee_company_groups.c.employee_id == employee_id)
        .where(models.employee_company_groups.c.company_group_id == group_id)
    )
    if delete_result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Employee is not in this group")

    for campaign in affected_campaigns:
        campaign_service.validate_scheduled_campaign(campaign, db)
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


def import_people_groups(*, file: UploadFile, db: Session):
    import_rows = people_import_service.read_import_rows(file.file, file.filename, GROUP_IMPORT_HEADERS, "group")

    errors = []
    rows = []
    seen_names = set()
    existing_names = {
        name.lower()
        for (name,) in db.query(models.CompanyGroup.name).all()
    }

    for row_number, values in import_rows:
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


def import_people_employees(*, file: UploadFile, db: Session, actor: models.User):
    import_rows = people_import_service.read_import_rows(file.file, file.filename, EMPLOYEE_IMPORT_HEADERS, "employee")

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

    for row_number, values in import_rows:
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
        invited = invitation_service.invite_user(new_user, actor, db)
        if invited.invitation_status == "sent":
            invitations_sent += 1
        elif invited.invitation_status == "failed":
            invitation_errors.append(f"Row {row_number} ({invited.email}): {account_service.invitation_error_message(invited.invitation_error)}")
    return {"created_count": len(rows), "errors": [], "invitations_sent": invitations_sent,
            "invitation_errors": invitation_errors}


def ensure_group_membership_mutable(group_id: int | None, employee_id: int, db: Session, *, role_change: bool = False):
    """Issued evaluations freeze group and company role, so history survives promotions and moves.

    Only a running campaign still needs the person where it planned them.
    """
    assignment_query = db.query(models.FilledForm).filter(
        or_(models.FilledForm.evaluator_id == employee_id, models.FilledForm.evaluatee_id == employee_id),
    )
    if group_id is not None:
        assignment_query = assignment_query.filter(models.FilledForm.company_group_id == group_id)
    existing_assignments = assignment_query.all()
    campaign_ids = {assignment.campaign_id for assignment in existing_assignments}
    campaigns = {campaign.id: campaign for campaign in (db.query(models.Campaign).filter(models.Campaign.id.in_(campaign_ids))
                 .order_by(models.Campaign.id).with_for_update().all() if campaign_ids else [])}
    running = {models.CampaignStatus.ACTIVE.value, models.CampaignStatus.PAUSED.value, models.CampaignStatus.REVIEW.value}

    def campaign_status(assignment):
        campaign = campaigns.get(assignment.campaign_id)
        return campaign.status if campaign else None

    if role_change:
        # An unissued row in a running campaign would be issued later with a form chosen for the old role.
        if any(campaign_status(assignment) in running and not campaign_service.assignment_is_immutable(assignment)
               for assignment in existing_assignments):
            raise HTTPException(status_code=409, detail="Employee role cannot change while a running campaign still has unissued evaluations for them")
        return
    if any(campaign_status(assignment) in running for assignment in existing_assignments):
        raise HTTPException(status_code=409, detail="Employees cannot be removed from a group while a running campaign evaluates them there")
    if any(campaign_service.assignment_is_immutable(assignment) and campaign_status(assignment) != models.CampaignStatus.CLOSED.value
           for assignment in existing_assignments):
        raise HTTPException(status_code=409, detail="Employee cannot be removed from this group while issued evaluations reference them")


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

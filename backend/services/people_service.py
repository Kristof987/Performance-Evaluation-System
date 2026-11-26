"""Business logic of the organisation: employees, company roles, groups, group leaders and imports."""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

import models
import schemas
from integrations import auth0_management
from services import (
    account_service,
    campaign_service,
    invitation_service,
    workspace_settings_service,
)

from services.employee_creation import DEFAULT_SYSTEM_ROLE, add_employee, get_or_create_company_role
from services.people_import_service import (
    EMPLOYEE_IMPORT_HEADERS, GROUP_IMPORT_HEADERS, import_people_employees, import_people_groups,
)


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


def group_response(group, count, leaders):
    return {"id": group.id, "name": group.name, "description": group.description,
            "member_count": count, "leader_ids": leaders}


def group_responses(groups, db):
    ids = [group.id for group in groups]
    counts = group_member_counts(ids, db)
    leaders = group_leader_ids(ids, db) if ids else {}
    return [group_response(group, counts.get(group.id, 0), leaders.get(group.id, [])) for group in groups]


def employee_response(person, role, system_role, groups):
    user = person.user
    return {
        "id": person.id, "user_id": person.user_id, "full_name": person.full_name,
        "username": user.username if user else person.full_name, "email": user.email if user else "",
        "company_role_id": person.company_role_id, "role_name": role.name if role else "Unknown role",
        "groups": groups, "is_active": person.is_active, "profile_image_url": person.profile_image_url,
        **account_service.account_fields(user, system_role),
    }


def saved_employee_response(person, db):
    memberships = models.employee_company_groups
    groups = (db.query(models.CompanyGroup).join(memberships)
              .filter(memberships.c.employee_id == person.id).order_by(models.CompanyGroup.name).all())
    system_role = db.get(models.SystemRole, person.user.system_role_id) if person.user else None
    return employee_response(person, db.get(models.CompanyRole, person.company_role_id),
                             system_role, group_responses(groups, db))


def get_people(*, db: Session):
    employees = (db.query(models.Employee).options(selectinload(models.Employee.user))
                 .order_by(models.Employee.is_active.desc(), models.Employee.full_name).all())
    roles = {role.id: role for role in db.query(models.CompanyRole).all()}
    system_roles = {role.id: role for role in db.query(models.SystemRole).order_by(models.SystemRole.id)}
    groups = db.query(models.CompanyGroup).order_by(models.CompanyGroup.name).all()
    memberships = models.employee_company_groups.c
    groups_by_employee = {}
    counts = {}
    for employee_id, group_id in db.query(memberships.employee_id, memberships.company_group_id):
        groups_by_employee.setdefault(employee_id, []).append(group_id)
        counts[group_id] = counts.get(group_id, 0) + 1
    leaders = group_leader_ids(None, db)
    summaries = {group.id: group_response(group, counts.get(group.id, 0), leaders.get(group.id, []))
                 for group in groups}
    return {
        "employees": [employee_response(person, roles.get(person.company_role_id),
                                        system_roles.get(person.user.system_role_id) if person.user else None,
                                        [summaries[group_id] for group_id in groups_by_employee.get(person.id, [])
                                         if group_id in summaries])
                      for person in employees],
        "groups": list(summaries.values()),
        "company_roles": [{"id": role.id, "name": role.name}
                          for role in sorted(roles.values(), key=lambda item: item.name.lower()) if role.archived_at is None],
        "system_roles": [{"id": role.id, "name": role.name, "description": role.description}
                         for role in system_roles.values()],
    }


def selected_group_ids(ids, db):
    wanted = set(ids)
    if wanted and db.query(models.CompanyGroup.id).filter(models.CompanyGroup.id.in_(wanted)).count() != len(wanted):
        raise HTTPException(status_code=400, detail="Invalid group selection")
    return wanted


def update_memberships(person, added: set[int], removed: set[int], db: Session, *, role_groups=None):
    memberships = models.employee_company_groups
    affected = added | removed if role_groups is None else role_groups
    campaigns = campaign_service.scheduled_campaigns_for_groups(affected, db)
    if role_groups is not None:
        ensure_group_membership_mutable(None, person.id, db, role_change=True)
    for group_id in sorted(removed):
        ensure_group_membership_mutable(group_id, person.id, db)
    if removed:
        result = db.execute(memberships.delete().where(memberships.c.employee_id == person.id,
                                                       memberships.c.company_group_id.in_(removed)))
        if result.rowcount != len(removed):
            raise HTTPException(status_code=404, detail="Employee is not in this group")
    if added:
        db.execute(memberships.insert(), [{"employee_id": person.id, "company_group_id": group_id}
                                         for group_id in sorted(added)])
    db.flush()
    for campaign in campaigns:
        campaign_service.validate_scheduled_campaign(campaign, db)


def create_people_employee(*, employee: schemas.PeopleEmployeeCreate, db: Session, actor: models.User):
    name = " ".join(employee.name.split())
    role_name = employee.role.strip()
    if name == "" or role_name == "":
        raise HTTPException(status_code=400, detail="Name and role are required")

    email = account_service.normalized_email(employee.email)
    if account_service.email_taken(email, db):
        raise HTTPException(status_code=409, detail="Employee email already exists")

    group_ids = selected_group_ids(employee.group_ids, db)
    used = {username for (username,) in db.query(models.User.username).all()}
    try:
        company_role = get_or_create_company_role(role_name, db)
        system_role = db.query(models.SystemRole).filter(models.SystemRole.name == DEFAULT_SYSTEM_ROLE).first()
        if system_role is None:
            raise HTTPException(status_code=500, detail="Employee system role is unavailable")
        person = add_employee(name, email, company_role, system_role, used, db)
        db.flush()
        update_memberships(person, group_ids, set(), db)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Employee email or username already exists") from error
    except Exception:
        db.rollback()
        raise
    invitation_service.invite_user(person.user, actor, db)
    return saved_employee_response(person, db)


def update_people_employee(*, employee_id: int, employee: schemas.PeopleEmployeeUpdate, db: Session):
    person = db.query(models.Employee).filter(models.Employee.id == employee_id).with_for_update().first()
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
    wanted = selected_group_ids(employee.group_ids, db)
    memberships = models.employee_company_groups.c
    current = {group_id for (group_id,) in db.query(memberships.company_group_id)
               .filter(memberships.employee_id == person.id)}
    role_changed = person.company_role_id != company_role.id
    person.full_name = name
    user.email = email
    person.company_role_id = company_role.id
    if role_changed or current != wanted:
        update_memberships(person, wanted - current, current - wanted, db,
                           role_groups=current | wanted if role_changed else None)
    db.commit()
    return saved_employee_response(person, db)


CAMPAIGN_ROLE_COLUMNS = (
    models.FilledForm.evaluator_company_role_id, models.FilledForm.evaluatee_company_role_id,
    models.CampaignEvaluationRule.evaluator_role_id, models.CampaignEvaluationRule.evaluatee_role_id,
)


def company_role_usage(db: Session) -> list[dict]:
    employee_counts = dict(db.query(models.Employee.company_role_id, func.count(models.Employee.id))
                           .group_by(models.Employee.company_role_id).all())
    used = set()
    for column in CAMPAIGN_ROLE_COLUMNS:
        used.update(role_id for (role_id,) in db.query(column).filter(column.isnot(None)).distinct().all())
    return [{"id": role.id, "name": role.name, "employee_count": employee_counts.get(role.id, 0),
             "used_in_campaigns": role.id in used, "archived": role.archived_at is not None}
            for role in db.query(models.CompanyRole).order_by(func.lower(models.CompanyRole.name)).all()]


def delete_company_role(*, role_id: int, db: Session, actor: models.User):
    """Unused roles are deleted; roles that campaigns refer to are archived so their reports keep the name."""
    role = db.query(models.CompanyRole).filter(models.CompanyRole.id == role_id).with_for_update().first()
    if role is None:
        raise HTTPException(status_code=404, detail="Company role not found")
    count = db.query(models.Employee.id).filter_by(company_role_id=role_id).count()
    if count:
        raise HTTPException(status_code=409, detail=f"Move the {count} employee{'s' if count != 1 else ''} with this role to another role first")
    if any(db.query(column).filter(column == role_id).first() for column in CAMPAIGN_ROLE_COLUMNS):
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
    invitation_service.invite_user(person.user, actor, db, enforce_cooldown=True)
    return saved_employee_response(person, db)


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
    return group_response(new_group, 0, leader_ids)


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

    return group_responses([existing_group], db)[0]


def add_people_group_member(*, group_id: int, member: schemas.PeopleGroupMemberCreate, db: Session):
    group = db.query(models.CompanyGroup).filter(models.CompanyGroup.id == group_id).first()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")

    person = db.query(models.Employee).filter(models.Employee.id == member.employee_id).with_for_update().first()
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

    update_memberships(person, {group_id}, set(), db)
    db.commit()

    return group_responses([group], db)[0]


def remove_people_group_member(*, group_id: int, employee_id: int, db: Session):
    group = db.query(models.CompanyGroup).filter(models.CompanyGroup.id == group_id).first()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")

    person = db.query(models.Employee).filter(models.Employee.id == employee_id).with_for_update().first()
    if person is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    update_memberships(person, set(), {group_id}, db)
    db.commit()

    return group_responses([group], db)[0]


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

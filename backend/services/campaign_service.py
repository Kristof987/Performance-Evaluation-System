"""Campaign business rules: configuration checks, scheduling validation and issued work."""

from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

import models
import schemas
from business_calendar import business_date, campaign_instant
from business_calendar import business_today as campaign_today
from services import (
    campaign_lifecycle,
    campaign_reminder_service,
    form_service,
    form_snapshot_service,
    people_service,
)


def assignment_is_immutable(assignment):
    """Issued: answering and submitting both need the issued snapshot, so it alone decides."""
    return assignment.form_snapshot is not None


def validate_campaign_configuration(campaign: models.Campaign, db: Session) -> list[str]:
    """Validate the complete saved schedule, without changing or issuing assignments."""
    errors = []
    group_ids = get_campaign_assigned_group_ids(campaign.id, db)
    if not group_ids:
        errors.append("Select at least one campaign group")
    members = {group_id: {employee.id: employee for employee, _ in people_service.get_group_employees(group_id, db)}
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
    for form in db.query(models.Form).filter(models.Form.id.in_(form_ids)).order_by(models.Form.id).all() if form_ids else []:
        errors.extend(f"Form {form.name}: {error}" for error in form_service.form_issuance_errors(form.questions, db))
    for group_id, people in members.items():
        if not people:
            errors.append(f"Group {group_names.get(group_id, group_id)} has no active employees")
    participants = {employee_id for people in members.values() for employee_id in people}
    for employee_id in self_forms:
        if employee_id not in participants:
            errors.append(f"Self-evaluation participant {employee_id} is not in a selected group")
    if not assignments:
        errors.append("Select at least one evaluation assignment")
    for row in assignments:  # The database keeps each evaluator/evaluatee pair unique per campaign.
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


def scheduled_campaigns_for_groups(group_ids: set[int], db: Session) -> list[models.Campaign]:
    if not group_ids:
        return []
    ids = [row[0] for row in db.query(models.campaign_company_groups.c.campaign_id).join(
        models.Campaign, models.Campaign.id == models.campaign_company_groups.c.campaign_id,
    ).filter(models.campaign_company_groups.c.company_group_id.in_(group_ids),
             models.Campaign.status == models.CampaignStatus.SCHEDULED.value).distinct().all()]
    return [db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().one()
            for campaign_id in sorted(ids)]


def get_campaign_assigned_group_ids(campaign_id: int, db: Session):
    return [
        group_id
        for (group_id,) in db.query(models.campaign_company_groups.c.company_group_id)
        .filter(models.campaign_company_groups.c.campaign_id == campaign_id)
        .all()
    ]


def require_mutable_campaign_configuration(campaign: models.Campaign) -> None:
    if campaign.is_archived:
        raise HTTPException(status_code=409, detail="Archived campaign configuration cannot be changed")
    if campaign.status in {models.CampaignStatus.PAUSED.value, models.CampaignStatus.REVIEW.value,
                           models.CampaignStatus.CLOSED.value}:
        raise HTTPException(status_code=409, detail="Campaign configuration is locked in this lifecycle status")


def unissued_snapshot_filter():
    return models.FilledForm.form_snapshot.is_(None)


def campaigns_referencing_form(form_id: int, db: Session) -> list[models.Campaign]:
    ids = {row[0] for model in (models.CampaignEvaluationRule, models.CampaignEmployeeSelfEvaluation, models.FilledForm)
           for row in db.query(model.campaign_id).filter(model.form_id == form_id).distinct().all()}
    return [db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().one()
            for campaign_id in sorted(ids)]


def forms_used_by_campaigns(db: Session, campaign_id: int | None = None) -> set[int]:
    """Form ids referred to by campaign rules, self-evaluations or assignments (optionally of one campaign)."""
    used: set[int] = set()
    for model in (models.CampaignEvaluationRule, models.CampaignEmployeeSelfEvaluation, models.FilledForm):
        query = db.query(model.form_id).filter(model.form_id.isnot(None))
        if campaign_id is not None:
            query = query.filter(model.campaign_id == campaign_id)
        used.update(form_id for (form_id,) in query.distinct())
    return used


def get_campaign_form_ids(campaign_id: int, db: Session):
    """Forms of the campaign's role rules and assignments (self-evaluation settings alone do not count)."""
    form_ids = {form_id for model in (models.CampaignEvaluationRule, models.FilledForm)
                for (form_id,) in db.query(model.form_id).filter(model.campaign_id == campaign_id).distinct()}
    return sorted(form_ids - {None})


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


def form_counts(campaign_id: int, db: Session) -> tuple[int, int]:
    """(issued, submitted) questionnaires of a campaign."""
    issued, submitted = db.query(func.count(models.FilledForm.id), func.count(models.FilledForm.finish_date)).filter(
        models.FilledForm.campaign_id == campaign_id, issued_snapshot_filter()).one()
    return issued, submitted


def campaign_payload(campaign: models.Campaign, today: date, issued: int = 0, submitted: int = 0) -> dict:
    return {**campaign.__dict__, "start_date": business_date(campaign.start_date),
            "end_date": business_date(campaign.end_date), "start_at": campaign_instant(campaign.start_date),
            "end_at": campaign_instant(campaign.end_date), "campaign_status": campaign.status,
            "current_date": today,
            "activation_error": campaign.lifecycle_error if campaign.status == models.CampaignStatus.SCHEDULED.value else None,
            "activation_retry_at": campaign.lifecycle_retry_at if campaign.status == models.CampaignStatus.SCHEDULED.value else None,
            "activation_attempts": campaign.lifecycle_attempts if campaign.status == models.CampaignStatus.SCHEDULED.value else 0,
             "issued_forms_count": issued, "submitted_forms_count": submitted}


def require_mutable_campaign_plan(campaign: models.Campaign) -> None:
    # New pairs could never be issued once filling has ended in Review.
    if (campaign.is_archived or campaign.status in {models.CampaignStatus.REVIEW.value, models.CampaignStatus.CLOSED.value}
            or campaign.paused_from_status == models.CampaignStatus.REVIEW.value):
        raise HTTPException(status_code=409, detail="Campaign plan is locked in this lifecycle status")


def issued_snapshot_filter():
    return models.FilledForm.form_snapshot.isnot(None)


def ensure_campaign_issued(campaign_id: int, db: Session, *, commit: bool = True,
                           actor_user_id: int | None = None):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    now = datetime.now(timezone.utc)
    if (campaign is None
            or campaign.status != models.CampaignStatus.ACTIVE.value
            or campaign.is_archived or campaign.start_date > now
            or (campaign.end_date is not None and campaign.end_date <= now)):
        return []

    errors = issue_activation_snapshots(campaign, db, actor_user_id=actor_user_id)
    if commit:
        db.commit()
    return errors


def unschedule_if_incomplete(campaign: models.Campaign, db: Session, actor_user_id: int) -> None:
    if campaign.status == models.CampaignStatus.SCHEDULED.value and validate_campaign_configuration(campaign, db):
        campaign_lifecycle.transition_campaign(
            db, campaign.id, models.CampaignStatus.DRAFT,
            now=datetime.now(timezone.utc), actor_user_id=actor_user_id,
        )


def issue_activation_snapshots(campaign: models.Campaign, db: Session, *, actor_user_id: int | None = None) -> list[str]:
    """Issue every planned row that still matches the setup; caller owns the campaign lock and transaction.

    Rows without a questionnaire are left planned; rows whose people left the group or whose
    role rule changed since planning are reported and left planned too.
    """
    errors = []
    issued_count = 0
    group_members = {}
    self_form_ids = {row.employee_id: row.form_id for row in db.query(models.CampaignEmployeeSelfEvaluation)
                     .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign.id)}
    for assignment in db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign.id,
        unissued_snapshot_filter(),
    ).order_by(models.FilledForm.id).all():
        if assignment.form_id is None:
            continue
        if assignment.company_group_id not in group_members:
            group_members[assignment.company_group_id] = {
                person.id: person for person, _role in people_service.get_group_employees(assignment.company_group_id, db)
            } if assignment.company_group_id is not None else {}
        members = group_members[assignment.company_group_id]
        evaluator = members.get(assignment.evaluator_id)
        evaluatee = members.get(assignment.evaluatee_id)
        if evaluator is None or evaluatee is None:
            errors.append(f"Assignment {assignment.id}: employees are not active members of the selected group")
            continue
        expected = (self_form_ids.get(assignment.evaluator_id) if assignment.evaluator_id == assignment.evaluatee_id
                    else get_form_id_for_employee_pair(campaign.id, assignment.company_group_id, evaluator, evaluatee, db))
        if expected != assignment.form_id:
            errors.append(f"Assignment {assignment.id}: saved questionnaire no longer matches the pair's role assignment")
            continue
        form = db.get(models.Form, assignment.form_id)
        problems = form_service.form_issuance_errors(form.questions, db)
        if problems:
            errors.append(f"Assignment {assignment.id} ({form.name}): {' '.join(problems)}")
            continue
        assignment.form_snapshot = form_snapshot_service.create_form_snapshot(form, db)
        assignment.snapshot_status = "verified"
        snapshot_assignment_roles(assignment, db)
        issued_count += 1

    campaign_lifecycle.record_snapshot_issuance(db, campaign, issued_count, actor_user_id=actor_user_id)
    return errors


def snapshot_assignment_roles(assignment: models.FilledForm, db: Session) -> None:
    """Freeze both company roles when an assignment is issued."""
    assignment.evaluator_company_role_id = db.get(models.Employee, assignment.evaluator_id).company_role_id
    assignment.evaluatee_company_role_id = db.get(models.Employee, assignment.evaluatee_id).company_role_id


def get_campaign_completion_status(*, campaign_id: int, search: str | None = None, status: str | None = None, overdue_only: bool = False, sort: str = "outstanding", order: str = "desc", page: int = 1, page_size: int = 25, db: Session):
    """Progress per evaluator. Who evaluates whom is never part of this view (requirement 7.4)."""
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    today = campaign_today()
    now = datetime.now(timezone.utc)
    rows = (
        db.query(
            models.FilledForm.id,
            models.FilledForm.evaluator_id,
            models.FilledForm.evaluatee_id,
            models.FilledForm.form_id,
            models.FilledForm.company_group_id,
            models.FilledForm.finish_date,
            models.Employee.full_name.label("evaluator_name"),
            models.User.email.label("evaluator_email"),
            models.FilledForm.answers,
        )
        .join(models.Employee, models.Employee.id == models.FilledForm.evaluator_id)
        .outerjoin(models.User, models.User.id == models.Employee.user_id)
        .filter(models.FilledForm.campaign_id == campaign.id)
        .filter(issued_snapshot_filter())
        .all()
    )

    due_date = business_date(campaign.end_date)
    people: dict[int, dict] = {}
    for row in rows:
        status_key = campaign_lifecycle.status_of(row)
        person = people.setdefault(row.evaluator_id, {
            "evaluator_id": row.evaluator_id,
            "evaluator_name": row.evaluator_name,
            "evaluator_email": row.evaluator_email,
            "total": 0, "not_started": 0, "in_progress": 0, "completed": 0, "overdue": 0,
            "due_date": due_date, "last_completed_at": None,
        })
        person["total"] += 1
        person[status_key] += 1
        if row.finish_date is None and campaign_lifecycle.is_overdue(row, campaign, now=now):
            person["overdue"] += 1
        if row.finish_date is not None and (person["last_completed_at"] is None or row.finish_date > person["last_completed_at"]):
            person["last_completed_at"] = row.finish_date

    def progress_key(person: dict) -> str:
        if person["completed"] == person["total"]:
            return "completed"
        if person["completed"] == 0 and person["in_progress"] == 0:
            return "not_started"
        return "in_progress"

    labels = {"not_started": "Not started", "in_progress": "In progress", "completed": "Completed"}
    all_people = []
    for person in people.values():
        person["outstanding"] = person["total"] - person["completed"]
        person["status_key"] = progress_key(person)
        person["status_label"] = labels[person["status_key"]]
        all_people.append(person)

    total = len(rows)
    completed = sum(person["completed"] for person in all_people)
    summary = {
        "total_evaluations": total,
        "not_started": sum(person["not_started"] for person in all_people),
        "in_progress": sum(person["in_progress"] for person in all_people),
        "completed": completed,
        "overdue": sum(person["overdue"] for person in all_people),
        "completion_rate": round((completed / total) * 100) if total > 0 else 0,
        "outstanding": total - completed,
        "evaluators": len(all_people),
        "evaluators_done": sum(1 for person in all_people if person["status_key"] == "completed"),
    }

    filtered = all_people
    if search is not None and search.strip() != "":
        term = search.strip().lower()
        filtered = [person for person in filtered
                    if term in person["evaluator_name"].lower() or term in (person["evaluator_email"] or "").lower()]
    if status is not None and status.strip() != "":
        status_key = status.strip().lower().replace("-", "_").replace(" ", "_")
        filtered = [person for person in filtered if person["status_key"] == status_key]
    if overdue_only:
        filtered = [person for person in filtered if person["overdue"] > 0]

    reverse = order.lower() == "desc"
    name = lambda person: (person["evaluator_name"].lower(), person["evaluator_id"])
    sort_key_map = {
        "outstanding": lambda person: (person["outstanding"], person["overdue"], *name(person)),
        "evaluator": name,
        "completed": lambda person: (person["completed"], *name(person)),
        "status": lambda person: ({"not_started": 0, "in_progress": 1, "completed": 2}[person["status_key"]], *name(person)),
        "last_completed_at": lambda person: (person["last_completed_at"] or date.min, *name(person)),
    }
    filtered = sorted(filtered, key=sort_key_map.get(sort, sort_key_map["outstanding"]), reverse=reverse)
    total_items = len(filtered)
    total_pages = max(1, (total_items + page_size - 1) // page_size)
    page = min(page, total_pages)
    page_start = (page - 1) * page_size
    page_rows = [{key: value for key, value in person.items() if key != "status_key"}
                 for person in filtered[page_start:page_start + page_size]]

    return {
        "campaign": {
            "id": campaign.id,
            "name": campaign.name,
            "is_active": campaign.is_active,
            "start_date": business_date(campaign.start_date),
            "end_date": business_date(campaign.end_date),
            "current_date": today,
            "campaign_status": campaign.status,
            "is_archived": campaign.is_archived,
        },
        "summary": summary,
        "rows": page_rows,
        "pagination": {"page": page, "page_size": page_size, "total_items": total_items, "total_pages": total_pages},
    }


def get_campaigns(*, db: Session):
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
    counts = {campaign_id: (issued, submitted) for campaign_id, issued, submitted in db.query(
        models.FilledForm.campaign_id, func.count(models.FilledForm.id), func.count(models.FilledForm.finish_date),
    ).filter(issued_snapshot_filter()).group_by(models.FilledForm.campaign_id)}
    return [campaign_payload(campaign, today, *counts.get(campaign.id, (0, 0))) for campaign in campaigns]


def get_campaign(*, campaign_id: int, db: Session):
    campaign = db.get(models.Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign_payload(campaign, campaign_today(), *form_counts(campaign_id, db))


def get_campaign_operational_metrics(*, campaign_id: int, db: Session):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    rows = db.query(models.FilledForm).filter(models.FilledForm.campaign_id == campaign_id, issued_snapshot_filter()).all()
    now = datetime.now(timezone.utc)
    submitted = sum(row.finish_date is not None for row in rows)
    total = len(rows)
    return {"campaign_id": campaign_id, "campaign_status": campaign.status, "total": total,
            "submitted": submitted, "incomplete": total - submitted,
            "completion_rate": round(submitted * 100 / total) if total else 0,
            "overdue": sum(campaign_lifecycle.is_overdue(row, campaign, now=now) for row in rows)}


def get_campaign_deletion_eligibility(*, campaign_id: int, db: Session):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    reason = campaign_lifecycle.deletion_blocker(db, campaign)
    return {"campaign_id": campaign_id, "can_delete": reason is None, "reason": reason}


def _lifecycle_change(db: Session, change) -> dict:
    """Commit a lifecycle change; its errors become 404 (unknown campaign) or 409."""
    try:
        campaign = change()
        db.commit()
    except campaign_lifecycle.CampaignLifecycleError as error:
        db.rollback()
        raise HTTPException(status_code=404 if str(error) == "Campaign not found" else 409, detail=str(error)) from error
    db.refresh(campaign)
    return campaign_payload(campaign, campaign_today())


def change_campaign_archive(campaign_id: int, archived: bool, db: Session, actor: models.User):
    return _lifecycle_change(db, lambda: campaign_lifecycle.set_campaign_archived(
        db, campaign_id, archived, actor_user_id=actor.id, now=datetime.now(timezone.utc)))


def delete_campaign(*, campaign_id: int, db: Session, manager: models.User):
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


def change_campaign_schedule(campaign_id: int, target: models.CampaignStatus, db: Session, actor: models.User):
    return _lifecycle_change(db, lambda: campaign_lifecycle.transition_campaign(
        db, campaign_id, target, now=datetime.now(timezone.utc), actor_user_id=actor.id,
        validate_configuration=validate_campaign_configuration))


def resume_campaign(*, campaign_id: int, db: Session, actor: models.User):
    def resume():
        campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).populate_existing().with_for_update().one_or_none()
        if campaign is None:
            raise campaign_lifecycle.CampaignLifecycleError("Campaign not found")
        now = datetime.now(timezone.utc)
        target = (models.CampaignStatus.REVIEW if campaign.paused_from_status == models.CampaignStatus.REVIEW.value
                  or (campaign.end_date is not None and now >= campaign.end_date) else models.CampaignStatus.ACTIVE)
        campaign = campaign_lifecycle.transition_campaign(db, campaign_id, target, now=now, actor_user_id=actor.id)
        ensure_campaign_issued(campaign_id, db, commit=False, actor_user_id=actor.id)
        return campaign
    return _lifecycle_change(db, resume)


def _campaign_dates(start, end) -> tuple[datetime, datetime | None]:
    try:
        start_at, end_at = campaign_instant(start), campaign_instant(end)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if start_at is None:
        raise HTTPException(status_code=400, detail="Start date cannot be null")
    if end_at is not None and end_at <= start_at:
        raise HTTPException(status_code=400, detail="End date cannot be earlier than start date")
    return start_at, end_at


def create_campaign(*, campaign: schemas.CampaignCreate, db: Session, actor: models.User):
    if not campaign.name.strip():
        raise HTTPException(status_code=400, detail="Campaign name is required")
    start_at, end_at = _campaign_dates(campaign.start_date, campaign.end_date)
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
        launch_email_enabled=campaign_reminder_service.workspace_reminder_defaults(db)[1],
    )
    db.add(new_campaign)
    db.commit()
    db.refresh(new_campaign)
    return campaign_payload(new_campaign, campaign_today())


def update_campaign(*, campaign_id: int, campaign_update: schemas.CampaignUpdate, db: Session,
                    actor: models.User | None = None):
    if not campaign_update.name.strip():
        raise HTTPException(status_code=400, detail="Campaign name is required")
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_mutable_campaign_configuration(campaign)
    if duplicate_campaign_name(db, campaign_update.name, campaign_id):
        raise HTTPException(status_code=409, detail="A campaign with this name already exists.")

    supplied = campaign_update.model_fields_set
    start_at, end_at = _campaign_dates(
        campaign_update.start_date if "start_date" in supplied else campaign.start_date,
        campaign_update.end_date if "end_date" in supplied else campaign.end_date)
    if (start_at, end_at) != (campaign.start_date, campaign.end_date):
        try:
            campaign_lifecycle.validate_date_edit(campaign, start_at, end_at, now=datetime.now(timezone.utc),
                                                   validate_configuration=lambda _campaign, _start, _end: validate_campaign_configuration(campaign, db))
        except campaign_lifecycle.CampaignLifecycleError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
    if campaign.end_date is not None and end_at is not None and end_at < campaign.end_date and form_counts(campaign_id, db)[0]:
        raise HTTPException(status_code=400, detail="End date cannot be moved earlier after questionnaires have been issued")

    if campaign.status == models.CampaignStatus.ACTIVE.value and end_at != campaign.end_date:
        db.add(models.CampaignOperationAudit(
            campaign_id=campaign.id, category="deadline_extension", actor_user_id=actor.id if actor else None,
            is_automatic=False, occurred_at=datetime.now(timezone.utc),
            previous_status=campaign.status, resulting_status=campaign.status))

    campaign.name = campaign_update.name.strip()
    campaign.description = campaign_update.description
    campaign.start_date, campaign.end_date = start_at, end_at
    campaign.comment = campaign_update.comment
    db.flush()
    validate_scheduled_campaign(campaign, db)
    db.commit()
    db.refresh(campaign)
    return campaign_payload(campaign, campaign_today(), *form_counts(campaign_id, db))


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

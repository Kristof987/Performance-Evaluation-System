"""Campaign business rules: configuration checks, scheduling validation and issued work."""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from services import campaign_lifecycle, form_service, people_service
from sqlalchemy import or_
from sqlalchemy.dialects.postgresql import JSONB


def assignment_is_immutable(assignment):
    # Existing answers without a snapshot are historical and must also stay untouched.
    return assignment.form_snapshot is not None or assignment.finish_date is not None or bool(assignment.answers)


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
    forms = {form.id: form for form in db.query(models.Form).filter(models.Form.id.in_(form_ids)).all()} if form_ids else {}
    for form_id in form_ids:
        form = forms.get(form_id)
        if form is None:
            errors.append(f"Form {form_id} does not exist")
        else:
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
    # Older planned rows may contain JSON null; new rows use SQL NULL.
    return or_(models.FilledForm.form_snapshot.is_(None), models.FilledForm.form_snapshot == JSONB.NULL)


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

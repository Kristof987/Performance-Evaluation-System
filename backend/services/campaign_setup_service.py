"""Who evaluates whom: groups, role-pair rules, the evaluation matrix and self-evaluations of a campaign."""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

import models
import schemas
from services import campaign_service, form_service, people_service, reporting_service


def get_campaign_groups(*, campaign_id: int, db: Session):
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


def update_campaign_groups(*, campaign_id: int, payload: schemas.CampaignGroupsUpdate, db: Session, manager: models.User):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign_service.require_mutable_campaign_configuration(campaign)

    unique_group_ids = sorted(set(payload.group_ids))
    if len(unique_group_ids) > 0:
        matching_count = (
            db.query(models.CompanyGroup)
            .filter(models.CompanyGroup.id.in_(unique_group_ids))
            .count()
        )
        if matching_count != len(unique_group_ids):
            raise HTTPException(status_code=400, detail="One or more groups do not exist")

    removed_ids = set(campaign_service.get_campaign_assigned_group_ids(campaign_id, db)) - set(unique_group_ids)
    if removed_ids:
        has_rules = db.query(models.CampaignEvaluationRule.id).filter(
            models.CampaignEvaluationRule.campaign_id == campaign_id,
            models.CampaignEvaluationRule.company_group_id.in_(removed_ids),
        ).first() is not None
        group_assignments = db.query(models.FilledForm).filter(
            models.FilledForm.campaign_id == campaign_id,
            models.FilledForm.company_group_id.in_(removed_ids),
        ).all()
        has_evaluations = any(campaign_service.assignment_is_immutable(record) for record in group_assignments)
        if has_evaluations:
            raise HTTPException(status_code=409, detail="Groups with issued evaluations cannot be removed")
        if has_rules:
            raise HTTPException(status_code=409, detail="Remove saved form rules before deselecting these groups")
        remaining_members = {group_id: {person.id: person for person, _ in people_service.get_group_employees(group_id, db)}
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
                record.form_id = campaign_service.get_form_id_for_employee_pair(
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
    campaign_service.unschedule_if_incomplete(campaign, db, manager.id)
    db.commit()

    groups = db.query(models.CompanyGroup).order_by(models.CompanyGroup.name.asc()).all()
    return {
        "available_groups": groups,
        "assigned_group_ids": unique_group_ids,
    }


def get_self_evaluation_participants(campaign_id: int, db: Session, group_ids: list[int] | None = None):
    participants = {}
    for group_id in (campaign_service.get_campaign_assigned_group_ids(campaign_id, db) if group_ids is None else group_ids):
        group = db.query(models.CompanyGroup).filter(models.CompanyGroup.id == group_id).first()
        for employee, role in people_service.get_group_employees(group_id, db):
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
        if campaign_service.assignment_is_immutable(row):
            issued.setdefault(row.evaluator_id, row.form_id)
    forms = form_service.selectable_forms(campaign_id, db)
    return {
        "forms": [{"id": form.id, "name": form.name} for form in forms],
        "participants": [
            {**participant, "form_id": issued.get(employee_id, mappings.get(employee_id)), "locked": employee_id in issued}
            for employee_id, participant in sorted(participants.items(), key=lambda item: (item[1]["employee_name"], item[0]))
        ],
    }


def get_campaign_self_evaluations(*, campaign_id: int, db: Session):
    if db.query(models.Campaign.id).filter(models.Campaign.id == campaign_id).first() is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return build_campaign_self_evaluations(campaign_id, db)


def update_campaign_self_evaluations(*, campaign_id: int, payload: schemas.CampaignSelfEvaluationsUpdate, db: Session, manager: models.User):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign_service.require_mutable_campaign_plan(campaign)
    participants = get_self_evaluation_participants(campaign_id, db)
    form_ids = {form_id for (form_id,) in db.query(models.Form.id).filter(models.Form.archived_at.is_(None))}
    desired = {}
    for assignment in payload.assignments:
        if assignment.employee_id not in participants:
            raise HTTPException(status_code=400, detail="Employee is not an active campaign participant")
        if assignment.employee_id in desired:
            raise HTTPException(status_code=400, detail="Duplicate self-evaluation assignment")
        if assignment.form_id is not None and assignment.form_id not in form_ids:
            raise HTTPException(status_code=400, detail="Self-evaluation form does not exist or is archived")
        desired[assignment.employee_id] = assignment.form_id

    issued = db.query(models.FilledForm).filter(
        models.FilledForm.campaign_id == campaign_id,
        models.FilledForm.evaluator_id == models.FilledForm.evaluatee_id,
    ).all()
    for record in issued:
        if campaign_service.assignment_is_immutable(record) and record.evaluator_id in participants and desired.get(record.evaluator_id) != record.form_id:
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
        if campaign_service.assignment_is_immutable(record) or record.evaluator_id not in participants:
            continue
        form_id = desired.get(record.evaluator_id)
        record.form_id = form_id
    db.flush()
    campaign_service.unschedule_if_incomplete(campaign, db, manager.id)
    db.commit()
    return build_campaign_self_evaluations(campaign_id, db)


def build_campaign_rule_matrix(campaign_id: int, db: Session, group_ids: list[int] | None = None):
    assigned_group_ids = campaign_service.get_campaign_assigned_group_ids(campaign_id, db) if group_ids is None else group_ids
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
        for row in planned if not campaign_service.assignment_is_immutable(row)
        and row.evaluator_id in employee_roles and row.evaluatee_id in employee_roles
    }

    matrices = []
    for group in groups:
        roles = people_service.get_group_roles(group.id, db)
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

    forms = form_service.selectable_forms(campaign_id, db)
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
    issued = [assignment for assignment in assignments if campaign_service.assignment_is_immutable(assignment)]
    employee_ids = {employee_id for assignment in issued for employee_id in (assignment.evaluator_id, assignment.evaluatee_id)}
    roles = {person.id: person.company_role_id for person in db.query(models.Employee).filter(models.Employee.id.in_(employee_ids)).all()} if employee_ids else {}
    keys = set()
    for assignment in issued:
        evaluator_role = reporting_service.assignment_role_id(assignment, roles, evaluator=True)
        evaluatee_role = reporting_service.assignment_role_id(assignment, roles)
        if evaluator_role is not None and evaluatee_role is not None:
            keys.add((assignment.company_group_id, evaluator_role, evaluatee_role))
    return keys


def build_campaign_evaluation_matrix(campaign_id: int, db: Session, issuance_errors=None, group_ids: list[int] | None = None):
    assigned_group_ids = campaign_service.get_campaign_assigned_group_ids(campaign_id, db) if group_ids is None else group_ids
    groups = []
    if len(assigned_group_ids) > 0:
        groups = (
            db.query(models.CompanyGroup)
            .filter(models.CompanyGroup.id.in_(assigned_group_ids))
            .order_by(models.CompanyGroup.name.asc())
            .all()
        )

    filled_forms_by_pair = {}
    for filled_form in (
        db.query(models.FilledForm)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .filter(models.FilledForm.company_group_id.isnot(None))
        .all()
    ):
        key = (filled_form.company_group_id, filled_form.evaluator_id, filled_form.evaluatee_id)
        existing = filled_forms_by_pair.get(key)
        if existing is None or campaign_service.assignment_is_immutable(filled_form) and not campaign_service.assignment_is_immutable(existing):
            filled_forms_by_pair[key] = filled_form

    matrices = []
    for group in groups:
        employee_rows = people_service.get_group_employees(group.id, db)
        active_member_ids = {person.id for person, _role in employee_rows}
        employees_by_id = {person.id: (person, role) for person, role in employee_rows}
        group_assignments = [row for row in filled_forms_by_pair.values() if row.company_group_id == group.id and campaign_service.assignment_is_immutable(row)]
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
                    # Only whether it is locked: per-pair progress would turn the planning
                    # matrix into a "who evaluates whom" completion view (requirement 7.4).
                    "issued": campaign_service.assignment_is_immutable(filled_form),
                }
                for evaluator in employees
                for evaluatee in employees
                for filled_form in [filled_forms_by_pair.get((group.id, evaluator.id, evaluatee.id))]
                if filled_form is not None
            ],
        })

    return {"groups": matrices, "issuance_errors": issuance_errors or []}


def get_campaign_evaluation_rules(*, campaign_id: int, db: Session):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return build_campaign_rule_matrix(campaign_id, db)


def update_campaign_evaluation_rules(*, campaign_id: int, payload: schemas.CampaignEvaluationRulesUpdate, db: Session, manager: models.User):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign_service.require_mutable_campaign_plan(campaign)

    assigned_group_ids = set(campaign_service.get_campaign_assigned_group_ids(campaign_id, db))
    form_ids = {form_id for (form_id,) in db.query(models.Form.id).filter(models.Form.archived_at.is_(None))}
    valid_role_pairs_by_group = {}
    for group_id in assigned_group_ids:
        role_ids = {role.id for role in people_service.get_group_roles(group_id, db)}
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
            raise HTTPException(status_code=400, detail="Rule form does not exist or is archived")
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
        campaign_service.unissued_snapshot_filter(),
        models.FilledForm.company_group_id.isnot(None),
    ).all():
        if assignment.finish_date is not None or assignment.answers or assignment.evaluator_id == assignment.evaluatee_id:
            continue
        evaluator = db.query(models.Employee).filter(models.Employee.id == assignment.evaluator_id).first()
        evaluatee = db.query(models.Employee).filter(models.Employee.id == assignment.evaluatee_id).first()
        form_id = selected_rules.get((assignment.company_group_id, evaluator.company_role_id, evaluatee.company_role_id)) if evaluator and evaluatee else None
        assignment.form_id = form_id
    db.flush()
    campaign_service.unschedule_if_incomplete(campaign, db, manager.id)
    db.commit()

    return build_campaign_rule_matrix(campaign_id, db)


def get_campaign_evaluation_matrix(*, campaign_id: int, db: Session):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")

    return build_campaign_evaluation_matrix(campaign_id, db)


def validate_matrix_issued_assignments(existing_by_pair, scoped_pairs, selected_pairs, requested_tasks, existing_tasks):
    issued_pairs = {pair for pair, form in existing_by_pair.items() if campaign_service.assignment_is_immutable(form)}
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


def update_campaign_evaluation_matrix(*, campaign_id: int, payload: schemas.CampaignEvaluationMatrixUpdate, db: Session, manager: models.User):
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign_service.require_mutable_campaign_plan(campaign)

    assigned_group_ids = set(campaign_service.get_campaign_assigned_group_ids(campaign_id, db))
    group_members_by_group = {
        group_id: {user.id: user for user, _role in people_service.get_group_employees(group_id, db)}
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
    existing_self_forms = {form.evaluator_id: form for form in existing_forms if form.evaluator_id == form.evaluatee_id and campaign_service.assignment_is_immutable(form)}
    existing_by_pair = {}
    for filled_form in existing_forms:
        if filled_form.company_group_id is None:
            continue
        key = (filled_form.company_group_id, filled_form.evaluator_id, filled_form.evaluatee_id)
        if key in existing_by_pair:
            raise HTTPException(status_code=409, detail="Duplicate issued evaluations exist for a matrix pair; resolve them before saving")
        existing_by_pair[key] = filled_form
    scoped_group_user_pairs.update(pair for pair, assignment in existing_by_pair.items() if campaign_service.assignment_is_immutable(assignment))

    seen_assignments = set()
    desired_assignments = set()
    for assignment in payload.assignments:
        if assignment.company_group_id not in assigned_group_ids:
            raise HTTPException(status_code=400, detail="Assignment group is not assigned to this campaign")

        unique_group_pair = (assignment.company_group_id, assignment.evaluator_id, assignment.evaluatee_id)
        existing = existing_by_pair.get(unique_group_pair)
        if existing is not None and campaign_service.assignment_is_immutable(existing):
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
        form_id = campaign_service.get_form_id_for_employee_pair(campaign_id, assignment.company_group_id, evaluator, evaluatee, db)
        desired_assignments.add((*unique_group_pair, form_id))

    # Multiple groups can contain the same person, but only one diagonal task may be issued.
    self_tasks = {}
    for task in sorted(desired_assignments, key=lambda item: (item[0], item[1], item[2])):
        group_id, evaluator_id, evaluatee_id, form_id = task
        if evaluator_id != evaluatee_id or (group_id, evaluator_id, evaluatee_id) in existing_by_pair and campaign_service.assignment_is_immutable(existing_by_pair[(group_id, evaluator_id, evaluatee_id)]):
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
        if campaign_service.assignment_is_immutable(form)
    }
    validate_matrix_issued_assignments(
        existing_by_pair, scoped_group_user_pairs, seen_assignments, desired_assignments, existing_tasks
    )

    desired_by_pair = {(group_id, evaluator_id, evaluatee_id): form_id for group_id, evaluator_id, evaluatee_id, form_id in desired_assignments}
    removed_count = 0
    for pair, existing in existing_by_pair.items():
        if campaign_service.assignment_is_immutable(existing):
            continue
        if campaign.legacy_issuance_blocked and desired_by_pair.get(pair) != existing.form_id:
            raise HTTPException(status_code=409, detail="Historical planned assignments cannot be changed through migrated-campaign issuance")
        if pair not in desired_by_pair:
            db.delete(existing)
            removed_count += 1
        else:
            existing.form_id = desired_by_pair[pair]

    remaining_pairs = {(form.evaluator_id, form.evaluatee_id) for form in existing_forms if campaign.legacy_issuance_blocked or campaign_service.assignment_is_immutable(form) or (form.company_group_id, form.evaluator_id, form.evaluatee_id) in desired_by_pair}
    for group_id, evaluator_id, evaluatee_id, form_id in desired_assignments:
        if (group_id, evaluator_id, evaluatee_id) not in existing_by_pair and (evaluator_id, evaluatee_id) in remaining_pairs:
            raise HTTPException(status_code=409, detail="This evaluator/evaluatee pair already has an assignment in this campaign")
        remaining_pairs.add((evaluator_id, evaluatee_id))

    status = campaign_service.get_or_create_default_form_status(db)

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
    campaign_service.unschedule_if_incomplete(campaign, db, manager.id)
    db.commit()
    matrix = build_campaign_evaluation_matrix(campaign_id, db)
    return {
        **matrix,
        "created_count": created_count,
        "removed_count": removed_count,
        "kept_completed_count": sum(form.finish_date is not None for form in existing_forms),
    }


def issue_ready_campaign_evaluations(*, campaign_id: int, db: Session, manager: models.User):
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
        models.FilledForm.campaign_id == campaign_id, campaign_service.unissued_snapshot_filter(),
        models.FilledForm.finish_date.is_(None), models.FilledForm.answers == [],
    ).order_by(models.FilledForm.id).all()
    if not planned:
        raise HTTPException(status_code=409, detail="No planned evaluations are waiting for issuance")
    group_ids = set(campaign_service.get_campaign_assigned_group_ids(campaign_id, db))
    members = {group_id: {person.id: person for person, _ in people_service.get_group_employees(group_id, db)}
               for group_id in group_ids}
    self_forms = {row.employee_id: row.form_id for row in db.query(models.CampaignEmployeeSelfEvaluation)
                  .filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign_id)}
    for row in planned:
        group_members = members.get(row.company_group_id, {})
        evaluator = group_members.get(row.evaluator_id)
        evaluatee = group_members.get(row.evaluatee_id)
        if evaluator is None or evaluatee is None:
            raise HTTPException(status_code=409, detail="Planned evaluation employees must belong to an active selected group")
        expected = self_forms.get(row.evaluator_id) if row.evaluator_id == row.evaluatee_id else campaign_service.get_form_id_for_employee_pair(
            campaign_id, row.company_group_id, evaluator, evaluatee, db)
        if expected is None:
            raise HTTPException(status_code=409, detail="Assign questionnaires to all planned evaluation pairs before issuing")
        if row.form_id != expected:
            raise HTTPException(status_code=409, detail="A planned evaluation has a stale questionnaire; save its role assignments before issuing")

    errors = campaign_service.issue_activation_snapshots(campaign, db, actor_user_id=manager.id)
    if errors:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cannot issue planned evaluations: " + "; ".join(errors))
    db.commit()
    return build_campaign_evaluation_matrix(campaign_id, db)


def get_campaign_setup_preview(*, campaign_id: int, group_ids: list[int] = [], db: Session):
    if db.query(models.Campaign.id).filter(models.Campaign.id == campaign_id).first() is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if len(group_ids) != len(set(group_ids)) or db.query(models.CompanyGroup.id).filter(models.CompanyGroup.id.in_(group_ids)).count() != len(group_ids):
        raise HTTPException(status_code=400, detail="Selected groups must exist and be unique")
    return {
        "rules": build_campaign_rule_matrix(campaign_id, db, group_ids),
        "self_evaluations": build_campaign_self_evaluations(campaign_id, db, group_ids),
        "matrix": build_campaign_evaluation_matrix(campaign_id, db, group_ids=group_ids),
    }


def update_campaign_setup(*, campaign_id: int, payload: schemas.CampaignSetupUpdate, db: Session, manager: models.User):
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
        campaign_service.require_mutable_campaign_configuration(campaign)
        if campaign.status not in {models.CampaignStatus.DRAFT.value, models.CampaignStatus.SCHEDULED.value}:
            raise HTTPException(status_code=409, detail="Only draft and scheduled campaigns can replace their setup")

        group_ids = set(payload.group_ids)
        if len(group_ids) != len(payload.group_ids) or db.query(models.CompanyGroup.id).filter(models.CompanyGroup.id.in_(group_ids)).count() != len(group_ids):
            raise HTTPException(status_code=400, detail="Groups must exist and be unique")

        previous_groups = set(campaign_service.get_campaign_assigned_group_ids(campaign_id, db))
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
            affected = {row.id: row for row in campaign_service.scheduled_campaigns_for_groups(
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
                if any(campaign_service.assignment_is_immutable(row) for row in immutable):
                    raise HTTPException(status_code=409, detail="Issued evaluations prevent removing this member")
                db.execute(models.employee_company_groups.delete().where(
                    models.employee_company_groups.c.company_group_id == change.company_group_id,
                    models.employee_company_groups.c.employee_id == change.employee_id))

        members = {group_id: {person.id: person for person, _ in people_service.get_group_employees(group_id, db)} for group_id in group_ids}
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
            if campaign_service.assignment_is_immutable(row) and (key not in selected or selected[key] != row.form_id):
                raise HTTPException(status_code=409, detail="Issued evaluations cannot be changed or removed")
            if campaign.legacy_issuance_blocked and not campaign_service.assignment_is_immutable(row) and (key not in selected or selected[key] != row.form_id):
                raise HTTPException(status_code=409, detail="Historical planned assignments cannot be changed")
        relocated = {}
        for row in existing_assignments:
            if row.company_group_id not in removed_groups or campaign_service.assignment_is_immutable(row) or campaign.legacy_issuance_blocked:
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
            if campaign_service.assignment_is_immutable(row) and row.evaluator_id == row.evaluatee_id and self_forms.get(row.evaluator_id) != row.form_id:
                raise HTTPException(status_code=409, detail="Issued self-evaluations cannot be changed")

        for row in existing_assignments:
            if not campaign_service.assignment_is_immutable(row) and not campaign.legacy_issuance_blocked:
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
        status = campaign_service.get_or_create_default_form_status(db) if selected.keys() - retained_pairs else None
        for key, form_id in selected.items():
            if key not in retained_pairs:
                db.add(models.FilledForm(campaign_id=campaign_id, company_group_id=key[0], evaluator_id=key[1],
                                         evaluatee_id=key[2], form_id=form_id, status_id=status.id,
                                         finish_date=None, answers=[], form_snapshot=None, snapshot_status=None))
        db.flush()
        campaign_service.unschedule_if_incomplete(campaign, db, manager.id)
        for other in affected.values():
            campaign_service.validate_scheduled_campaign(other, db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return build_campaign_evaluation_matrix(campaign_id, db)

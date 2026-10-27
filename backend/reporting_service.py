from collections import defaultdict
from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import campaign_lifecycle
from business_calendar import business_date


COMPLETED_STATUSES = {"completed", "submitted"}
MIN_AGGREGATE_EVALUATEES = 2
MIN_INDIVIDUAL_PEER_REVIEWERS = 2
REPORTABLE_CAMPAIGN_STATUSES = tuple(status.value for status in campaign_lifecycle.REPORTABLE_STATUSES)


def status_key(status_name: str | None, finish_date: date | None) -> str:
    if finish_date is not None:
        return "completed"
    normalized = (status_name or "Not started").strip().lower()
    if normalized in COMPLETED_STATUSES:
        return "completed"
    if normalized in {"in progress", "in_progress", "started"}:
        return "in_progress"
    return "not_started"


def require_reports_access(campaign_id: int | None, actor: models.User, db: Session) -> models.Campaign | None:
    grant = (
        db.query(models.User.id)
        .join(models.SystemRole, models.SystemRole.id == models.User.system_role_id)
        .join(models.system_role_permissions,
              models.system_role_permissions.c.system_role_id == models.SystemRole.id)
        .join(models.SystemPermission,
              models.SystemPermission.id == models.system_role_permissions.c.permission_id)
        .filter(models.User.id == actor.id)
        .filter(models.User.is_active.is_(True))
        .filter(models.SystemPermission.name == "reports.read")
        .first()
    )
    if grant is None:
        raise HTTPException(status_code=403, detail="User is not authorized to view reports")

    if campaign_id is None:
        return None
    # Hold a shared row lock while reading results so Pause cannot commit mid-report.
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update(read=True).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not campaign_lifecycle.reporting_allowed(campaign):
        raise HTTPException(status_code=409, detail="Reports are available only for campaigns in review or closed status")
    return campaign


def _report_campaign_option(campaign: models.Campaign) -> dict[str, Any]:
    return {
        "id": campaign.id,
        "name": campaign.name,
        "start_date": business_date(campaign.start_date),
        "end_date": business_date(campaign.end_date),
        "is_active": campaign.is_active,
        "campaign_status": campaign.status,
        "is_archived": campaign.is_archived,
    }


def list_report_campaigns(actor: models.User, db: Session) -> list[dict[str, Any]]:
    require_reports_access(None, actor, db)
    return [
        _report_campaign_option(campaign)
        for campaign in db.query(models.Campaign)
        .order_by(models.Campaign.start_date.desc(), models.Campaign.id.desc())
        .all()
    ]


def campaign_report_rows(campaign_id: int, db: Session) -> list[Any]:
    return (
        db.query(models.FilledForm, models.Form, models.FormStatus.name.label("status_name"))
        .join(models.Form, models.Form.id == models.FilledForm.form_id)
        .join(models.FormStatus, models.FormStatus.id == models.FilledForm.status_id)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .all()
    )


def assigned_campaign_groups(campaign_id: int, db: Session) -> list[models.CompanyGroup]:
    assigned_group_rows = db.execute(
        models.campaign_company_groups.select().where(models.campaign_company_groups.c.campaign_id == campaign_id)
    ).fetchall()
    assigned_group_ids = [row.company_group_id for row in assigned_group_rows]
    if not assigned_group_ids:
        return []
    return db.query(models.CompanyGroup).filter(models.CompanyGroup.id.in_(assigned_group_ids)).order_by(models.CompanyGroup.name.asc()).all()


def membership_maps(db: Session) -> tuple[dict[int, set[int]], dict[int, set[int]]]:
    memberships = db.execute(models.employee_company_groups.select()).fetchall()
    members_by_group: dict[int, set[int]] = defaultdict(set)
    groups_by_employee: dict[int, set[int]] = defaultdict(set)
    for membership in memberships:
        members_by_group[membership.company_group_id].add(membership.employee_id)
        groups_by_employee[membership.employee_id].add(membership.company_group_id)
    return members_by_group, groups_by_employee


def users_by_id(db: Session) -> dict[int, Any]:
    rows = (
        db.query(models.Employee, models.CompanyRole)
        .join(models.CompanyRole, models.CompanyRole.id == models.Employee.company_role_id)
        .all()
    )
    return {employee.id: (employee, role) for employee, role in rows}


def _section_report_data(rows: list[Any], db: Session):
    import section_scoring_service

    scored = [result for filled_form, _form, status in rows
              if (result := section_scoring_service.score_evaluation(filled_form, status_name=status)) is not None]
    section_ids = {section_id for evaluation in scored for section_id in evaluation.section_ids}
    names = {section.id: section.name for section in db.query(models.Section).filter(models.Section.id.in_(section_ids)).all()} if section_ids else {}
    for filled_form, _form, status in sorted(rows, key=lambda row: row[0].id):
        if status_key(status, filled_form.finish_date) != "completed":
            continue
        snapshot = filled_form.form_snapshot
        if not isinstance(snapshot, dict):
            continue
        blocks = snapshot.get("questions")
        if not isinstance(blocks, list):
            continue
        for block in blocks:
            if not isinstance(block, dict) or block.get("type") != "section":
                continue
            section_id, metadata = block.get("section_id"), block.get("section")
            if isinstance(section_id, int) and section_id in section_ids and section_id not in names and isinstance(metadata, dict) and isinstance(metadata.get("name"), str) and metadata["name"].strip():
                names[section_id] = metadata["name"]
    return scored, names


def _section_score_rows(aggregate, scored, names: dict[int, str]):
    rows = []
    for section_id, result in aggregate.sections.items():
        peer_evaluators = len({item.evaluator_id for item in scored if item.evaluator_id != item.evaluatee_id and section_id in item.sections}) if result.availability == "available" else 0
        rows.append({
            "id": section_id,
            "name": names.get(section_id) or "Archived section",
            "average_score": result.score,
            "availability": result.availability,
            "evaluatee_count": result.contributor_count,
            "evaluator_count": peer_evaluators,
        })
    return sorted(rows, key=lambda item: (item["name"].lower(), item["id"]))


def build_campaign_report_overview(campaign_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    import section_scoring_service
    from question_analytics_service import _definition

    campaign = require_reports_access(campaign_id, actor, db)
    assert campaign is not None

    rows = campaign_report_rows(campaign.id, db)
    total = len({filled_form.id for filled_form, _, _ in rows})
    completed_rows = [row for row in rows if status_key(row[2], row[0].finish_date) == "completed"]
    completed = len({filled_form.id for filled_form, _, _ in completed_rows})
    peer_completed_rows = [row for row in completed_rows if row[0].evaluator_id != row[0].evaluatee_id]
    self_completed = len({row[0].id for row in completed_rows if row[0].evaluator_id == row[0].evaluatee_id})
    assigned_evaluatees = {row[0].evaluatee_id for row in rows}
    evaluated_by_peers = {row[0].evaluatee_id for row in peer_completed_rows}

    scored, names = _section_report_data(rows, db)
    campaign_performance = section_scoring_service.campaign_scores(scored, campaign.id)
    group_roles = {employee_id: role.id for employee_id, (_employee, role) in users_by_id(db).items()}
    group_performance = section_scoring_service.group_scores(scored, campaign.id, group_roles)
    section_scores = _section_score_rows(campaign_performance, scored, names)
    issued_questions: dict[int, set[str]] = defaultdict(set)
    seen_assignments: set[int] = set()
    for assignment, _form, _status in rows:
        if assignment.id in seen_assignments:
            continue
        seen_assignments.add(assignment.id)
        for section_id, questions in section_scoring_service.iter_snapshot_sections(assignment.form_snapshot):
            for question in questions:
                if not isinstance(question, dict):
                    continue
                definition = _definition(question, section_id)
                if definition is not None:
                    issued_questions[section_id].add(definition[0])
    for section in section_scores:
        section["question_count"] = len(issued_questions[section["id"]])
    overall = campaign_performance.overall

    assigned_group_rows = db.execute(
        models.campaign_company_groups.select().where(models.campaign_company_groups.c.campaign_id == campaign.id)
    ).fetchall()
    assigned_group_ids = [row.company_group_id for row in assigned_group_rows]
    groups = db.query(models.CompanyGroup).filter(models.CompanyGroup.id.in_(assigned_group_ids)).order_by(models.CompanyGroup.name.asc()).all() if assigned_group_ids else []
    memberships = db.execute(models.employee_company_groups.select()).fetchall()
    members_by_group: dict[int, set[int]] = defaultdict(set)
    for membership in memberships:
        members_by_group[membership.company_group_id].add(membership.employee_id)

    group_summaries = []
    for group in groups:
        group_rows = [row for row in rows if row[0].company_group_id == group.id]
        group_completed_rows = [row for row in group_rows if status_key(row[2], row[0].finish_date) == "completed"]
        group_result = group_performance.get(group.id)
        group_overall = group_result.overall if group_result else None
        group_average = group_overall.score if group_overall else None
        group_total = len({row[0].id for row in group_rows})
        group_completed = len({row[0].id for row in group_completed_rows})
        group_summaries.append(
            {
                "group_id": group.id,
                "group_name": group.name,
                "employee_count": len(members_by_group[group.id]),
                "total_evaluations": group_total,
                "completed_evaluations": group_completed,
                "completion_rate": round((group_completed / group_total) * 100) if group_total > 0 else 0,
                "average_score": group_average,
                "score_availability": group_overall.availability if group_overall else "no_data",
                "average_score_context": "Peer feedback · equally weighted reportable Sections" if group_average is not None else "Insufficient peer feedback" if group_overall and group_overall.availability == "suppressed" else "No scored peer Sections",
            }
        )

    configured_self = db.query(func.count(models.CampaignEmployeeSelfEvaluation.employee_id)).filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign.id).scalar() or 0

    return {
        "campaign": _report_campaign_option(campaign),
        "kpis": {
            "total_evaluations": total,
            "completed_evaluations": completed,
            "completion_rate": round((completed / total) * 100) if total > 0 else 0,
            "submitted_evaluations": completed,
            "employees_evaluated": len(evaluated_by_peers),
            "overall_score": overall.score,
            "overall_score_label": f"{overall.score:.2f}" if overall.score is not None else "Not available",
            "overall_score_context": "Peer feedback · equally weighted reportable Sections" if overall.score is not None else "Insufficient peer feedback" if overall.availability == "suppressed" else "No scored peer Sections",
            "overall_score_scale": "1-5" if overall.score is not None else None,
            "overall_availability": overall.availability,
        },
        "sections": section_scores,
        "groups": group_summaries,
        "employees": {
            "participating_employees": len(assigned_evaluatees),
            "employees_with_completed_peer_feedback": len(evaluated_by_peers),
            "employees_awaiting_peer_feedback": len(assigned_evaluatees - evaluated_by_peers),
            "configured_self_evaluations": configured_self,
            "completed_self_evaluations": self_completed,
        },
        "notes": {
            "completed_definition": "Completion counts submitted assignments with finish_date or Completed/Submitted status; the denominator includes planned, issued and draft assignments.",
            "answer_storage": "Section scores use submitted answers matched to questions in issued Form snapshots.",
            "question_identity": "Question IDs and Section IDs come from each immutable issued snapshot.",
            "historical_versions": "Only submitted schema-v2 Section snapshots contribute performance scores; legacy evaluations remain in workflow counts.",
            "section_policy": "Section rating answers are normalized to 1-5; questions, peer evaluators, evaluated employees and Sections are equally weighted at their respective levels.",
            "self_evaluation_policy": "Default performance analytics exclude self-evaluations where evaluator_id equals evaluatee_id.",
            "participant_deduplication": "Campaign employee counts deduplicate by stable employee id.",
            "group_attribution": "Group summaries use FilledForm.company_group_id, the assignment attribution captured when the matrix is saved.",
            "confidentiality": f"Section scores require at least {MIN_AGGREGATE_EVALUATEES} evaluated employees; group slices with a smaller complementary cohort are also suppressed.",
        },
    }


def build_section_cohort_comparison(campaign_id: int, section_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    import section_scoring_service

    require_reports_access(campaign_id, actor, db)
    rows = campaign_report_rows(campaign_id, db)
    scored, _names = _section_report_data(rows, db)
    if not any(section_id in evaluation.section_ids for evaluation in scored):
        raise HTTPException(status_code=404, detail="Section not found in campaign report")
    role_map = {employee_id: role.id for employee_id, (_employee, role) in users_by_id(db).items()}
    groups = section_scoring_service.group_scores(scored, campaign_id, role_map)
    roles = section_scoring_service.role_scores(scored, campaign_id, role_map)
    group_names = {group.id: group.name for group in assigned_campaign_groups(campaign_id, db)}
    role_names = {role.id: role.name for role in db.query(models.CompanyRole).all()}
    group_rows = [{"id": group_id, "name": group_names[group_id], "average_score": result.sections[section_id].score}
                  for group_id, result in groups.items() if group_id in group_names and section_id in result.sections
                  and result.sections[section_id].availability == "available"]
    # Match the role overview's all-or-nothing release for a Section with any suppressed role cell.
    role_safe = not any(section_id in result.sections and result.sections[section_id].availability == "suppressed" for result in roles.values())
    role_rows = ([{"id": role_id, "name": role_names[role_id], "average_score": result.sections[section_id].score}
                  for role_id, result in roles.items() if role_id in role_names and section_id in result.sections
                  and result.sections[section_id].availability == "available"] if role_safe else [])
    return {"section_id": section_id,
            "groups": sorted(group_rows, key=lambda item: item["name"].casefold()),
            "roles": sorted(role_rows, key=lambda item: item["name"].casefold()) if len(role_rows) >= 2 else []}


def build_groups_overview(campaign_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    import section_scoring_service

    campaign = require_reports_access(campaign_id, actor, db)
    assert campaign is not None
    rows = campaign_report_rows(campaign.id, db)
    completed_rows = [row for row in rows if status_key(row[2], row[0].finish_date) == "completed"]
    groups = assigned_campaign_groups(campaign.id, db)
    members_by_group, _ = membership_maps(db)
    scored, _names = _section_report_data(rows, db)
    group_roles = {employee_id: role.id for employee_id, (_employee, role) in users_by_id(db).items()}
    group_results = section_scoring_service.group_scores(scored, campaign.id, group_roles)
    participating = set()
    reportable_groups = 0
    group_summaries = []
    for group in groups:
        participating.update(members_by_group[group.id])
        group_rows = [row for row in rows if row[0].company_group_id == group.id]
        group_completed_rows = [row for row in completed_rows if row[0].company_group_id == group.id]
        result = group_results.get(group.id)
        overall = result.overall if result else None
        average = overall.score if overall else None
        if average is not None:
            reportable_groups += 1
        total = len({row[0].id for row in group_rows})
        completed = len({row[0].id for row in group_completed_rows})
        group_summaries.append({
            "group_id": group.id,
            "group_name": group.name,
            "description": group.description,
            "employee_count": len(members_by_group[group.id]),
            "total_evaluations": total,
            "completed_evaluations": completed,
            "completion_rate": round((completed / total) * 100) if total > 0 else None,
            "average_score": average,
            "average_score_context": "Peer score · equally weighted Sections" if average is not None else "Insufficient peer feedback" if overall and overall.availability == "suppressed" else "No scored peer Sections",
            "score_availability": overall.availability if overall else "no_data",
            "reportable_sections": sum(section.availability == "available" for section in result.sections.values()) if result else 0,
        })
    return {
        "campaign": _report_campaign_option(campaign),
        "kpis": {
            "groups_in_campaign": len(groups),
            "participating_employees": len(participating),
            "completed_evaluations": len({row[0].id for row in completed_rows}),
            "groups_with_reportable_results": reportable_groups,
        },
        "groups": group_summaries,
        "notes": {"scoring": "Section peer scores use submitted schema-v2 snapshots and normalized 1-5 ratings.", "group_attribution": "Group scores use the group stored with each evaluation assignment.", "confidentiality": f"At least {MIN_AGGREGATE_EVALUATEES} evaluated employees must contribute per Section; small complementary cohorts are suppressed."},
    }


def build_group_detail(campaign_id: int, group_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    import section_scoring_service

    overview = build_groups_overview(campaign_id, actor, db)
    group_summary = next((group for group in overview["groups"] if group["group_id"] == group_id), None)
    if group_summary is None:
        raise HTTPException(status_code=404, detail="Group report not found")
    rows = campaign_report_rows(campaign_id, db)
    group_rows = [row for row in rows if row[0].company_group_id == group_id]
    completed_rows = [row for row in group_rows if status_key(row[2], row[0].finish_date) == "completed"]
    scored, names = _section_report_data(rows, db)
    group_scored = [evaluation for evaluation in scored if evaluation.company_group_id == group_id]
    employees_by_id = users_by_id(db)
    role_map = {employee_id: role.id for employee_id, (_employee, role) in employees_by_id.items()}
    group_result = section_scoring_service.group_scores(scored, campaign_id, role_map).get(group_id) or section_scoring_service.campaign_scores([], campaign_id)
    group_sections = _section_score_rows(group_result, group_scored, names)
    members_by_group, _ = membership_maps(db)
    member_ids = members_by_group[group_id]
    attributed_evaluatees = {evaluation.evaluatee_id for evaluation in group_scored}
    role_cohort_ids = member_ids | attributed_evaluatees
    role_counts: dict[int, dict[str, Any]] = {}
    for employee_id in role_cohort_ids:
        employee_role = employees_by_id.get(employee_id)
        if employee_role is None:
            continue
        _, role = employee_role
        item = role_counts.setdefault(role.id, {"role_id": role.id, "role_name": role.name, "employee_count": 0, "completed_evaluations_received": 0, "average_score": None})
        item["employee_count"] += 1
    role_results = section_scoring_service.role_scores(group_scored, campaign_id, role_map)
    for role_item in role_counts.values():
        role_member_ids = {employee_id for employee_id in role_cohort_ids if employees_by_id.get(employee_id) and employees_by_id[employee_id][1].id == role_item["role_id"]}
        role_rows = [row for row in completed_rows if row[0].evaluatee_id in role_member_ids]
        role_item["completed_evaluations_received"] = len({row[0].id for row in role_rows})
        role_result = role_results.get(role_item["role_id"])
        if role_result:
            role_scored = [item for item in group_scored if role_map.get(item.evaluatee_id) == role_item["role_id"]]
            role_result = section_scoring_service.suppress_small_complements(role_result, scored, role_scored)
        role_visible = role_result if all(section.availability != "suppressed" for section in group_result.sections.values()) else None
        role_item["average_score"] = role_visible.overall.score if role_visible else None
        role_item["score_availability"] = role_visible.overall.availability if role_visible else "suppressed" if role_result else "no_data"
    employees = []
    for employee_id in sorted(member_ids, key=lambda item: employees_by_id.get(item)[0].full_name.lower() if employees_by_id.get(item) else ""):
        employee_role = employees_by_id.get(employee_id)
        if employee_role is None:
            continue
        employee, role = employee_role
        received = [row for row in completed_rows if row[0].evaluatee_id == employee.id and row[0].evaluator_id != employee.id]
        self_completed = any(row[0].evaluatee_id == employee.id and row[0].evaluator_id == employee.id for row in completed_rows)
        employees.append({
            "employee_id": employee.id,
            "employee_name": employee.full_name,
            "role_name": role.name,
            "reviews_received": len({row[0].id for row in received}),
            "completed_self_evaluation": self_completed,
            "feedback_availability": "Submitted" if len(received) > 0 else "No submitted peer feedback",
        })
    return {
        "campaign": overview["campaign"],
        "group": {"id": group_summary["group_id"], "name": group_summary["group_name"], "description": group_summary["description"]},
        "kpis": {
            "employees": group_summary["employee_count"],
            "completed_evaluations": group_summary["completed_evaluations"],
            "completion_rate": group_summary["completion_rate"],
            "reportable_sections": sum(section["availability"] == "available" for section in group_sections),
            "overall_peer_score": group_result.overall.score,
        },
        "sections": group_sections,
        "roles": sorted(role_counts.values(), key=lambda item: item["role_name"].lower()),
        "employees": employees,
        "notes": overview["notes"],
    }


def normalize_perspective(perspective: str) -> str:
    return "evaluator" if perspective == "evaluator" else "evaluatee"


def build_roles_overview(campaign_id: int, actor: models.User, db: Session, perspective: str = "evaluatee") -> dict[str, Any]:
    import section_scoring_service

    campaign = require_reports_access(campaign_id, actor, db)
    assert campaign is not None
    perspective = normalize_perspective(perspective)
    rows = campaign_report_rows(campaign.id, db)
    scored, names = _section_report_data(rows, db)
    employees_by_id = users_by_id(db)
    role_map = {employee_id: role.id for employee_id, (_employee, role) in employees_by_id.items()}
    role_results = (section_scoring_service.evaluator_role_scores(scored, campaign.id, role_map) if perspective == "evaluator"
                    else section_scoring_service.role_scores(scored, campaign.id, role_map))
    roles = db.query(models.CompanyRole).order_by(models.CompanyRole.name.asc()).all()
    role_summaries = []
    section_candidate: dict[int, list[dict[str, Any]]] = defaultdict(list)
    suppressed_sections = set()
    participating_employees: set[int] = set()
    for role in roles:
        employee_ids = {employee_id for employee_id, (_, employee_role) in employees_by_id.items() if employee_role.id == role.id}
        if perspective == "evaluator":
            role_rows = [row for row in rows if row[0].evaluator_id in employee_ids and row[0].evaluator_id != row[0].evaluatee_id]
            role_scored = [item for item in scored if item.evaluator_id in employee_ids and item.evaluator_id != item.evaluatee_id]
            participating_employees.update(row[0].evaluator_id for row in role_rows)
        else:
            role_rows = [row for row in rows if row[0].evaluatee_id in employee_ids and row[0].evaluator_id != row[0].evaluatee_id]
            role_scored = [item for item in scored if item.evaluatee_id in employee_ids and item.evaluator_id != item.evaluatee_id]
            participating_employees.update(row[0].evaluatee_id for row in role_rows)
        completed = [row for row in role_rows if status_key(row[2], row[0].finish_date) == "completed"]
        result = role_results.get(role.id)
        average = result.overall.score if result else None
        for section in (_section_score_rows(result, role_scored, names) if result else []):
            if section["availability"] == "suppressed":
                suppressed_sections.add(section["id"])
            elif section["availability"] == "available":
                section_candidate[section["id"]].append({"role_id": role.id, "role_name": role.name, "average_score": section["average_score"], "evaluatee_count": section["evaluatee_count"], "evaluator_count": section["evaluator_count"]})
        if employee_ids or role_rows:
            role_summaries.append({
                "role_id": role.id,
                "role_name": role.name,
                "employee_count": len(employee_ids),
                "completed_evaluations": len({row[0].id for row in completed}),
                "available_sections": sum(section.availability == "available" for section in result.sections.values()) if result else 0,
                "average_score": average,
                "score_availability": result.overall.availability if result else "no_data",
                "average_score_context": ("Peer ratings given by this company role" if perspective == "evaluator" else "Peer ratings received by this company role") if average is not None else "Insufficient peer feedback" if result and result.overall.availability == "suppressed" else "No scored peer Sections",
            })
    comparison = next(({"section_id": section_id, "section_name": names.get(section_id, "Archived section"), "roles": items} for section_id, items in sorted(section_candidate.items(), key=lambda pair: (names.get(pair[0], "Archived section").lower(), pair[0])) if len(items) >= 2 and section_id not in suppressed_sections), None)
    return {
        "campaign": _report_campaign_option(campaign),
        "perspective": perspective,
        "kpis": {"roles_in_campaign": len(role_summaries), "participating_employees": len(participating_employees), "completed_evaluations": sum(item["completed_evaluations"] for item in role_summaries), "roles_with_reportable_results": sum(1 for item in role_summaries if item["average_score"] is not None)},
        "roles": role_summaries,
        "section_comparison": comparison,
        "notes": {"scoring": "Normalized Section scores use submitted schema-v2 snapshots and evaluated-employee weighting.", "role_history": "Evaluation records do not snapshot company roles; role breakdowns use current company roles.", "confidentiality": f"A Section requires {MIN_AGGREGATE_EVALUATEES} evaluated employees; evaluator-role results also require {MIN_AGGREGATE_EVALUATEES} distinct peer evaluators."},
    }


def build_role_detail(campaign_id: int, role_id: int, actor: models.User, db: Session, perspective: str = "evaluatee") -> dict[str, Any]:
    import section_scoring_service

    overview = build_roles_overview(campaign_id, actor, db, perspective)
    role_summary = next((role for role in overview["roles"] if role["role_id"] == role_id), None)
    if role_summary is None:
        raise HTTPException(status_code=404, detail="Role report not found")
    perspective = overview["perspective"]
    rows = campaign_report_rows(campaign_id, db)
    employees_by_id = users_by_id(db)
    role_map = {employee_id: role.id for employee_id, (_employee, role) in employees_by_id.items()}
    scored, names = _section_report_data(rows, db)
    role_employee_ids = {employee_id for employee_id, (_, role) in employees_by_id.items() if role.id == role_id}
    if perspective == "evaluator":
        role_rows = [row for row in rows if row[0].evaluator_id in role_employee_ids and row[0].evaluator_id != row[0].evaluatee_id]
        role_scored = [item for item in scored if item.evaluator_id in role_employee_ids and item.evaluator_id != item.evaluatee_id]
    else:
        role_rows = [row for row in rows if row[0].evaluatee_id in role_employee_ids and row[0].evaluator_id != row[0].evaluatee_id]
        role_scored = [item for item in scored if item.evaluatee_id in role_employee_ids and item.evaluator_id != item.evaluatee_id]
    role_result = (section_scoring_service.evaluator_role_scores(scored, campaign_id, role_map) if perspective == "evaluator"
                   else section_scoring_service.role_scores(scored, campaign_id, role_map)).get(role_id)
    section_rows = _section_score_rows(role_result, role_scored, names) if role_result else []
    groups = assigned_campaign_groups(campaign_id, db)
    members_by_group, _ = membership_maps(db)
    group_breakdown = []
    for group in groups:
        group_rows = [row for row in role_rows if row[0].company_group_id == group.id]
        group_scored = [item for item in role_scored if item.company_group_id == group.id]
        group_employee_ids = (members_by_group[group.id] & role_employee_ids) | {
            item.evaluator_id if perspective == "evaluator" else item.evaluatee_id for item in group_scored
        }
        group_result = (section_scoring_service.evaluator_role_scores(group_scored, campaign_id, role_map).get(role_id) if perspective == "evaluator"
                        else section_scoring_service.group_scores(group_scored, campaign_id, role_map).get(group.id))
        if group_result:
            group_result = section_scoring_service.suppress_small_complements(group_result, role_scored, group_scored)
            group_result = section_scoring_service.suppress_small_complements(group_result, scored, group_scored)
        group_visible = group_result if (group_result and all(section.availability != "suppressed" for section in group_result.sections.values())
                                         and (role_result is None or all(section.availability != "suppressed" for section in role_result.sections.values()))) else None
        group_breakdown.append({"group_id": group.id, "group_name": group.name, "employee_count": len(group_employee_ids), "completed_evaluations": len({row[0].id for row in group_rows if status_key(row[2], row[0].finish_date) == "completed"}), "average_score": group_visible.overall.score if group_visible else None, "score_availability": group_visible.overall.availability if group_visible else "suppressed" if group_result else "no_data"})
    return {
        "campaign": overview["campaign"],
        "role": {"id": role_summary["role_id"], "name": role_summary["role_name"]},
        "perspective": perspective,
        "kpis": {
            "employees": role_summary["employee_count"],
            "completed_evaluations": role_summary["completed_evaluations"],
            "reportable_sections": sum(section["availability"] == "available" for section in section_rows),
            "overall_score": role_summary["average_score"],
        },
        "sections": section_rows,
        "groups": group_breakdown,
        "coverage": {"assigned_evaluations": len({row[0].id for row in role_rows}), "completed_evaluations": role_summary["completed_evaluations"]},
        "notes": overview["notes"],
    }


def self_evaluation_status(rows: list[Any], employee_id: int) -> dict[str, Any]:
    self_rows = [row for row in rows if row[0].evaluatee_id == employee_id and row[0].evaluator_id == employee_id]
    if len(self_rows) == 0:
        return {"status": "Not assigned", "assigned": 0, "completed": 0}
    completed = sum(1 for row in self_rows if status_key(row[2], row[0].finish_date) == "completed")
    in_progress = any(status_key(row[2], row[0].finish_date) == "in_progress" for row in self_rows)
    status = "Completed" if completed == len(self_rows) else "In progress" if in_progress or completed > 0 else "Not started"
    return {"status": status, "assigned": len({row[0].id for row in self_rows}), "completed": completed}


def campaign_participant_ids(campaign_id: int, rows: list[Any], db: Session) -> set[int]:
    groups = assigned_campaign_groups(campaign_id, db)
    members_by_group, _ = membership_maps(db)
    participant_ids = {row[0].evaluatee_id for row in rows}
    for group in groups:
        participant_ids.update(members_by_group[group.id])
    return participant_ids


def employee_base_context(campaign_id: int, rows: list[Any], db: Session) -> tuple[dict[int, Any], dict[int, list[str]], set[int]]:
    employees_by_id = users_by_id(db)
    groups = assigned_campaign_groups(campaign_id, db)
    members_by_group, groups_by_employee = membership_maps(db)
    group_names_by_id = {group.id: group.name for group in groups}
    group_names_by_employee: dict[int, list[str]] = defaultdict(list)
    for employee_id, group_ids in groups_by_employee.items():
        for group_id in sorted(group_ids):
            if group_id in group_names_by_id:
                group_names_by_employee[employee_id].append(group_names_by_id[group_id])
    participant_ids = {row[0].evaluatee_id for row in rows}
    for group in groups:
        participant_ids.update(members_by_group[group.id])
    return employees_by_id, group_names_by_employee, participant_ids


def build_employee_reports_overview(campaign_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    import section_scoring_service

    campaign = require_reports_access(campaign_id, actor, db)
    assert campaign is not None
    rows = campaign_report_rows(campaign.id, db)
    employees_by_id, group_names_by_employee, participant_ids = employee_base_context(campaign.id, rows, db)
    completed_peer_rows = [row for row in rows if row[0].evaluator_id != row[0].evaluatee_id and status_key(row[2], row[0].finish_date) == "completed"]
    peer_assigned_by_employee: dict[int, list[Any]] = defaultdict(list)
    peer_completed_by_employee: dict[int, list[Any]] = defaultdict(list)
    for row in rows:
        filled_form = row[0]
        if filled_form.evaluator_id == filled_form.evaluatee_id:
            continue
        peer_assigned_by_employee[filled_form.evaluatee_id].append(row)
        if status_key(row[2], filled_form.finish_date) == "completed":
            peer_completed_by_employee[filled_form.evaluatee_id].append(row)
    scored, _names = _section_report_data(rows, db)
    employees = []
    for employee_id in sorted(participant_ids, key=lambda item: employees_by_id.get(item)[0].full_name.lower() if employees_by_id.get(item) else ""):
        employee_role = employees_by_id.get(employee_id)
        if employee_role is None:
            continue
        employee, role = employee_role
        assigned = len({row[0].id for row in peer_assigned_by_employee[employee_id]})
        completed = len({row[0].id for row in peer_completed_by_employee[employee_id]})
        employee_result = section_scoring_service.employee_scores(scored, campaign.id, employee_id)
        employees.append({
            "employee_id": employee.id,
            "employee_name": employee.full_name,
            "email": employee.user.email if employee.user else None,
            "company_role": role.name,
            "groups": group_names_by_employee.get(employee.id, []),
            "peer_assigned": assigned,
            "peer_completed": completed,
            "self_evaluation": self_evaluation_status(rows, employee.id),
            "performance_summary": {
                "overall_peer_score": employee_result.overall_peer.score,
                "availability": employee_result.overall_peer.availability,
                "reportable_sections": sum(result.availability == "available" for result in employee_result.peer_sections.values()),
            },
        })
    configured_self = sum(item["self_evaluation"]["assigned"] for item in employees)
    completed_self = sum(item["self_evaluation"]["completed"] for item in employees)
    with_peer_feedback = len({row[0].evaluatee_id for row in completed_peer_rows})
    awaiting_peer = len({employee["employee_id"] for employee in employees if employee["peer_assigned"] > 0 and employee["peer_completed"] == 0})
    return {
        "campaign": _report_campaign_option(campaign),
        "kpis": {
            "participating_employees": len(employees),
            "employees_with_peer_feedback": with_peer_feedback,
            "awaiting_peer_feedback": awaiting_peer,
            "completed_self_evaluations": completed_self,
            "assigned_self_evaluations": configured_self,
        },
        "employees": employees,
        "notes": {"employee_participation": "Employees include assigned campaign evaluatees and campaign group members, deduplicated by employee ID.", "scoring": "Submitted schema-v2 snapshot ratings are normalized to 1-5 and aggregated by Section, peer evaluator and employee.", "individual_privacy": f"Individual peer Section scores require at least {MIN_INDIVIDUAL_PEER_REVIEWERS} distinct peer evaluators."},
    }


def build_section_self_peer_comparison(employee_result, names: dict[int, str]) -> list[dict[str, Any]]:
    comparisons = []
    for section_id, peer in employee_result.peer_sections.items():
        self_result = employee_result.self_sections.get(section_id)
        if peer.availability != "available" or self_result is None or self_result.availability != "available":
            continue
        difference = self_result.score - peer.score
        comparisons.append({
            "section_id": section_id,
            "section_name": names.get(section_id, "Archived section"),
            "peer_average": peer.score,
            "self_average": self_result.score,
            "difference": difference,
            "interpretation": "Higher self-rating" if difference > 0.05 else "Lower self-rating" if difference < -0.05 else "Similar ratings",
        })
    return sorted(comparisons, key=lambda item: (item["section_name"].lower(), item["section_id"]))


def build_employee_history(employee_id: int, actor: models.User, db: Session) -> list[dict[str, Any]]:
    import section_scoring_service

    campaigns = (db.query(models.Campaign)
                 .filter(models.Campaign.status.in_(REPORTABLE_CAMPAIGN_STATUSES))
                 .order_by(models.Campaign.start_date.asc(), models.Campaign.id.asc()).all())
    series_by_section: dict[int | None, dict[str, Any]] = {}
    for campaign in campaigns:
        try:
            require_reports_access(campaign.id, actor, db)
        except HTTPException as error:
            if error.status_code != 404:
                raise
            continue
        rows = campaign_report_rows(campaign.id, db)
        scored, names = _section_report_data(rows, db)
        employee_result = section_scoring_service.employee_scores(scored, campaign.id, employee_id)
        reportable_count = sum(result.availability == "available" for result in employee_result.peer_sections.values())
        reportable_ids = {section_id for section_id, result in employee_result.peer_sections.items() if result.availability == "available"}
        overall_evaluators = len({evaluation.evaluator_id for evaluation in scored if evaluation.evaluatee_id == employee_id and evaluation.evaluator_id != employee_id and reportable_ids.intersection(evaluation.sections)})
        for section_id, result in [(None, employee_result.overall_peer), *employee_result.peer_sections.items()]:
            if result.availability != "available":
                continue
            name = "Overall peer score" if section_id is None else names.get(section_id, "Archived section")
            series = series_by_section.setdefault(section_id, {"section_id": section_id, "section_name": name, "points": []})
            series["points"].append({
                "campaign_id": campaign.id,
                "campaign_name": campaign.name,
            "campaign_start_date": business_date(campaign.start_date),
                "average_score": result.score,
                "evaluator_count": result.contributor_count if section_id is not None else overall_evaluators,
                "reportable_sections": reportable_count,
            })
    return sorted((series for series in series_by_section.values() if len(series["points"]) >= 2), key=lambda series: (series["section_id"] is not None, series["section_name"].lower(), series["section_id"] or 0))


def build_employee_report_detail(campaign_id: int, employee_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    import section_scoring_service

    campaign = require_reports_access(campaign_id, actor, db)
    assert campaign is not None
    rows = campaign_report_rows(campaign.id, db)
    employees_by_id, group_names_by_employee, participant_ids = employee_base_context(campaign.id, rows, db)
    employee_role = employees_by_id.get(employee_id)
    if employee_role is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    if employee_id not in participant_ids:
        raise HTTPException(status_code=404, detail="Employee is not part of this campaign report")
    employee, role = employee_role
    peer_rows = [row for row in rows if row[0].evaluatee_id == employee_id and row[0].evaluator_id != employee_id]
    peer_completed_rows = [row for row in peer_rows if status_key(row[2], row[0].finish_date) == "completed"]
    scored, names = _section_report_data(rows, db)
    employee_result = section_scoring_service.employee_scores(scored, campaign.id, employee_id)
    sections = []
    for section_id in employee_result.peer_sections:
        peer = employee_result.peer_sections[section_id]
        self_result = employee_result.self_sections[section_id]
        sections.append({
            "id": section_id,
            "name": names.get(section_id, "Archived section"),
            "peer_score": peer.score,
            "peer_availability": peer.availability,
            "peer_evaluator_count": peer.contributor_count,
            "self_score": self_result.score,
            "self_availability": self_result.availability,
        })
    sections.sort(key=lambda item: (item["name"].lower(), item["id"]))
    if not peer_rows:
        availability = "no_assignments"
    elif not peer_completed_rows:
        availability = "not_submitted"
    elif not any(section_scoring_service.snapshot_section_ids(row[0].form_snapshot) for row in peer_completed_rows):
        availability = "no_sections"
    elif not any(evaluation.sections for evaluation in scored if evaluation.evaluatee_id == employee_id and evaluation.evaluator_id != employee_id):
        availability = "no_ratings"
    elif employee_result.overall_peer.availability == "suppressed":
        availability = "suppressed"
    else:
        availability = "available"
    self_status = self_evaluation_status(rows, employee_id)
    distinct_peer_evaluators = len({row[0].evaluator_id for row in peer_completed_rows})
    return {
        "campaign": _report_campaign_option(campaign),
        "employee": {"id": employee.id, "name": employee.full_name, "email": employee.user.email if employee.user else None, "company_role": role.name, "groups": group_names_by_employee.get(employee.id, [])},
        "kpis": {
            "peer_reviews_received": len({row[0].id for row in peer_completed_rows}),
            "peer_reviews_assigned": len({row[0].id for row in peer_rows}),
            "peer_completion_rate": round((len({row[0].id for row in peer_completed_rows}) / len({row[0].id for row in peer_rows})) * 100) if peer_rows else None,
            "self_evaluation_status": self_status["status"],
            "reportable_sections": sum(result.availability == "available" for result in employee_result.peer_sections.values()),
            "overall_peer_score": employee_result.overall_peer.score,
            "overall_self_score": employee_result.overall_self.score,
        },
        "sections": sections,
        "section_availability": availability,
        "self_peer_comparison": build_section_self_peer_comparison(employee_result, names),
        "coverage": {"peer_assigned": len({row[0].id for row in peer_rows}), "peer_completed": len({row[0].id for row in peer_completed_rows}), "peer_outstanding": max(0, len({row[0].id for row in peer_rows}) - len({row[0].id for row in peer_completed_rows})), "self_evaluation": self_status, "campaign_end_date": business_date(campaign.end_date), "distinct_peer_evaluators": distinct_peer_evaluators if distinct_peer_evaluators >= MIN_INDIVIDUAL_PEER_REVIEWERS else None},
        "history": build_employee_history(employee_id, actor, db),
        "notes": {"scoring": "Peer and self Section scores use submitted schema-v2 snapshots and normalized 1-5 ratings; Overall equally weights reportable Sections.", "individual_privacy": f"Individual peer Section scores require at least {MIN_INDIVIDUAL_PEER_REVIEWERS} distinct peer evaluators; suppressed results never enter Overall or Self comparisons.", "raw_feedback": "Raw written feedback and reviewer identities are not returned by Employee Reports."},
    }

from collections import defaultdict
from contextvars import ContextVar
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from services import permissions
from services import campaign_lifecycle
from services.campaign_lifecycle import status_of
from services import workspace_settings_service
from business_calendar import business_date


REPORTABLE_CAMPAIGN_STATUSES = tuple(status.value for status in campaign_lifecycle.REPORTABLE_STATUSES)


# Suppression thresholds come from workspace settings. They are loaded once per report
# request in require_reports_access, which every report, analytics and AI entry point calls.
_privacy_thresholds: ContextVar[tuple[int, int]] = ContextVar("privacy_thresholds", default=(
    workspace_settings_service.DEFAULT_MIN_INDIVIDUAL_PEER_REVIEWERS,
    workspace_settings_service.DEFAULT_MIN_AGGREGATE_EVALUATEES,
))


def min_individual_peer_reviewers() -> int:
    return _privacy_thresholds.get()[0]


def min_aggregate_evaluatees() -> int:
    return _privacy_thresholds.get()[1]


# Team leads (reports.read_team) see reports only for the groups they lead. Team-enabled routes
# call enter_report_scope first; every other report entry point keeps requiring reports.read.
_team_groups: ContextVar[frozenset[int] | None] = ContextVar("report_team_groups", default=None)


def led_group_ids(actor: models.User, db: Session) -> frozenset[int]:
    if actor.employee is None:
        return frozenset()
    leaders = models.company_group_leaders.c
    return frozenset(group_id for (group_id,) in db.query(leaders.company_group_id)
                     .filter(leaders.employee_id == actor.employee.id).all())


def enter_report_scope(actor: models.User, db: Session) -> frozenset[int] | None:
    """Return None for workspace-wide report access, or the groups a team lead may see."""
    if permissions.has_permission(actor, db, "reports.read"):
        _team_groups.set(None)
        return None
    if not permissions.has_permission(actor, db, "reports.read_team"):
        raise HTTPException(status_code=403, detail="User is not authorized to view reports")
    groups = led_group_ids(actor, db)
    _team_groups.set(groups)
    return groups


def team_employee_ids(campaign_id: int, groups: frozenset[int], actor: models.User, db: Session) -> set[int]:
    """Employees evaluated in, or campaign members of, the given groups; never the lead themself."""
    evaluatees = {evaluatee_id for (evaluatee_id,) in db.query(models.FilledForm.evaluatee_id)
                  .filter(models.FilledForm.campaign_id == campaign_id)
                  .filter(models.FilledForm.company_group_id.in_(groups)).distinct().all()} if groups else set()
    campaign_groups = {group.id for group in assigned_campaign_groups(campaign_id, db)} & groups
    if campaign_groups:
        members = models.employee_company_groups.c
        evaluatees.update(employee_id for (employee_id,) in db.query(members.employee_id)
                          .filter(members.company_group_id.in_(campaign_groups)).all())
    if actor.employee is not None:
        evaluatees.discard(actor.employee.id)
    return evaluatees


def require_team_campaign(campaign_id: int, actor: models.User, db: Session) -> frozenset[int] | None:
    """Campaign-level views: a group leader only for campaigns that include a group they lead."""
    groups = enter_report_scope(actor, db)
    if groups is not None and not groups & {group.id for group in assigned_campaign_groups(campaign_id, db)}:
        raise HTTPException(status_code=404, detail="Campaign report not found")
    return groups


def require_team_group(campaign_id: int, group_id: int, actor: models.User, db: Session) -> None:
    groups = enter_report_scope(actor, db)
    if groups is not None and group_id not in groups:
        raise HTTPException(status_code=403, detail="You can only view reports of groups you lead")
    require_reports_access(campaign_id, actor, db)


def require_team_employee(campaign_id: int, employee_id: int, actor: models.User, db: Session) -> None:
    groups = enter_report_scope(actor, db)
    if groups is not None and employee_id not in team_employee_ids(campaign_id, groups, actor, db):
        raise HTTPException(status_code=403, detail="You can only view reports of employees in groups you lead")
    require_reports_access(campaign_id, actor, db)


def require_reports_access(campaign_id: int | None, actor: models.User, db: Session) -> models.Campaign | None:
    if not permissions.has_permission(actor, db, "reports.read") and not (
            _team_groups.get() is not None and permissions.has_permission(actor, db, "reports.read_team")):
        raise HTTPException(status_code=403, detail="User is not authorized to view reports")
    _privacy_thresholds.set(workspace_settings_service.privacy_thresholds(db))

    if campaign_id is None:
        return None
    campaign = db.get(models.Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not campaign_lifecycle.reporting_allowed(campaign):
        raise HTTPException(status_code=409, detail="Reports are available only for campaigns in review or closed status")
    return campaign


def aggregate_reporting_access(campaign_id: int, actor: models.User, db: Session) -> bool:
    """Management grant permits unsuppressed statistics, never raw submissions.

    Check campaign eligibility here as well as at each report entry point; a
    caller cannot turn on this policy by supplying a role label or query flag.
    """
    require_reports_access(campaign_id, actor, db)
    return permissions.has_permission(actor, db, "campaigns.manage")


def _open_report(campaign_id: int, actor: models.User, db: Session) -> tuple[models.Campaign, list[Any], bool]:
    """Check report access once: the campaign, its assignment rows and whether thresholds are bypassed."""
    campaign = require_reports_access(campaign_id, actor, db)
    return campaign, campaign_report_rows(campaign_id, db), permissions.has_permission(actor, db, "campaigns.manage")


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
    groups = enter_report_scope(actor, db)
    require_reports_access(None, actor, db)
    query = db.query(models.Campaign)
    if groups is not None:
        attributed = db.query(models.FilledForm.campaign_id).filter(models.FilledForm.company_group_id.in_(groups))
        assigned = db.query(models.campaign_company_groups.c.campaign_id).filter(
            models.campaign_company_groups.c.company_group_id.in_(groups))
        query = query.filter(models.Campaign.id.in_(attributed) | models.Campaign.id.in_(assigned))
    return [
        _report_campaign_option(campaign)
        for campaign in query.order_by(models.Campaign.start_date.desc(), models.Campaign.id.desc()).all()
    ]


def campaign_report_rows(campaign_id: int, db: Session) -> list[Any]:
    """One (FilledForm, Form) row per assignment of the campaign."""
    return (
        db.query(models.FilledForm, models.Form)
        .join(models.Form, models.Form.id == models.FilledForm.form_id)
        .filter(models.FilledForm.campaign_id == campaign_id)
        .all()
    )


def build_written_feedback(campaign_id: int, question_key: str | None, evaluation_type: str,
                           actor: models.User, db: Session, *, employee_id: int | None = None,
                           section_id: int | None = None) -> dict[str, Any]:
    """Release submitted issued Text answers without reviewer metadata.

    HR (campaign management) sees every employee once questionnaires are issued. A group
    leader, who discusses the results with HR, sees the members of the groups they lead
    (never themself) once the campaign is in Review or Closed, and colleague answers only
    under the same reviewer threshold as their scores. Identity-hidden presentation does
    not make raw prose anonymous: its content may still reveal its author.
    """
    from services import question_analytics_service

    require_reports_access(None, actor, db)
    campaign = db.get(models.Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if models.CampaignStatus(campaign.status) not in (models.CampaignStatus.ACTIVE, models.CampaignStatus.REVIEW,
                                                      models.CampaignStatus.PAUSED, models.CampaignStatus.CLOSED):
        raise HTTPException(status_code=409, detail="Written feedback is available only after questionnaires are issued")
    team = None if permissions.has_permission(actor, db, "campaigns.manage") else _team_groups.get()
    if team is None and not permissions.has_permission(actor, db, "campaigns.manage"):
        raise HTTPException(status_code=403, detail="Campaign management permission is required")
    if team is not None and not campaign_lifecycle.reporting_allowed(campaign):
        raise HTTPException(status_code=409, detail="Reports are available only for campaigns in review or closed status")
    rows = campaign_report_rows(campaign_id, db)
    targets = campaign_participant_ids(campaign_id, rows, db)
    if team is not None:
        targets &= team_employee_ids(campaign_id, team, actor, db)
    if employee_id is not None and employee_id not in targets:
        raise HTTPException(status_code=404, detail="Employee is not part of this campaign report")
    metadata, observations, issued_scopes = question_analytics_service._collect(rows, db, include_text=question_key is not None)
    if team is not None:
        observations = [item for item in observations if item.evaluatee_id in targets]
        issued_scopes = {key: {scope for scope in scopes if scope[2] in targets} for key, scopes in issued_scopes.items()}
    if question_key is None:
        questions = []
        for key, definition in metadata.items():
            if definition["category"] != "text" or (section_id is not None and definition["section_id"] != section_id):
                continue
            if evaluation_type == "self" and employee_id is None:
                continue
            if not any(issued_type == evaluation_type and (employee_id is None or target == employee_id)
                       for _group, _role, target, issued_type in issued_scopes[key]):
                continue
            count = sum(1 for item in observations if item.key == key
                        and (item.evaluator_id == item.evaluatee_id) == (evaluation_type == "self")
                        and (employee_id is None or item.evaluatee_id == employee_id))
            questions.append({"key": key, "text": definition["text"], "section_id": definition["section_id"],
                              "section_name": definition["section_name"], "response_count": count})
        questions.sort(key=lambda item: (item["section_id"] is None, item["section_name"].casefold(),
                                         item["text"].casefold(), item["key"]))
        # This target directory identifies evaluatees, never who authored a response.
        target_ids = {row[0].evaluatee_id for row in rows if row[0].evaluatee_id in targets} if employee_id is None else set()
        evaluatees = sorted(({"evaluatee_id": person.id, "evaluatee_name": person.full_name}
                            for person in db.query(models.Employee).filter(models.Employee.id.in_(target_ids)).all()),
                           key=lambda person: (person["evaluatee_name"].casefold(), person["evaluatee_id"])) if target_ids else []
        return {"evaluation_type": evaluation_type, "scope": "employee" if employee_id is not None else "campaign",
                "questions": questions, "evaluatees": evaluatees}
    question = metadata.get(question_key)
    if question is None or question["category"] != "text" or (section_id is not None and question["section_id"] != section_id):
        raise HTTPException(status_code=404, detail="Issued Text question not found")

    scope = "employee" if employee_id is not None else "campaign"
    response = {"question_key": question_key, "question_type": "Text", "section_id": question["section_id"],
                "evaluation_type": evaluation_type, "scope": scope,
                "availability": "not_applicable", "response_count": None, "responses": []}
    issued = any(issued_type == evaluation_type and (employee_id is None or target == employee_id)
                 for _group, _role, target, issued_type in issued_scopes[question_key])
    if not issued or (evaluation_type == "self" and employee_id is None):
        return response
    # The canonical collector checks completion, schema-v2 issued snapshots,
    # unique issued question IDs, duplicate answers and nonempty Text values.
    text_items = [item for item in observations if item.key == question_key and isinstance(item.value, str)
                  and (item.evaluator_id == item.evaluatee_id) == (evaluation_type == "self")]
    cohort = [item for item in text_items if employee_id is None or item.evaluatee_id == employee_id]
    if not cohort:
        return {**response, "availability": "no_data", "response_count": 0}
    if team is not None and evaluation_type == "peer" and not question_analytics_service._peer_release_allowed(
            cohort, single_employee=employee_id is not None):
        return {**response, "availability": "suppressed"}

    # Alphabetical order depends on the text alone, never on who submitted it or when.
    bodies = sorted(item.value for item in cohort)
    return {**response, "availability": "available", "response_count": len(bodies), "responses": bodies}


def assigned_campaign_groups(campaign_id: int, db: Session) -> list[models.CompanyGroup]:
    links = models.campaign_company_groups
    return (db.query(models.CompanyGroup).join(links, links.c.company_group_id == models.CompanyGroup.id)
            .filter(links.c.campaign_id == campaign_id).order_by(models.CompanyGroup.name.asc()).all())


def membership_maps(db: Session) -> tuple[dict[int, set[int]], dict[int, set[int]]]:
    memberships = db.execute(models.employee_company_groups.select()).fetchall()
    members_by_group: dict[int, set[int]] = defaultdict(set)
    groups_by_employee: dict[int, set[int]] = defaultdict(set)
    for membership in memberships:
        members_by_group[membership.company_group_id].add(membership.employee_id)
        groups_by_employee[membership.employee_id].add(membership.company_group_id)
    return members_by_group, groups_by_employee


def users_by_id(db: Session) -> dict[int, Any]:
    """Every employee with their (mandatory) company role."""
    rows = (
        db.query(models.Employee, models.CompanyRole)
        .join(models.CompanyRole, models.CompanyRole.id == models.Employee.company_role_id)
        .all()
    )
    return {employee.id: (employee, role) for employee, role in rows}


def assignment_role_id(filled_form: models.FilledForm, role_map: dict[int, int], *, evaluator: bool = False) -> int | None:
    """The company role frozen at issuance, or the current role for still-planned assignments."""
    snapshot = filled_form.evaluator_company_role_id if evaluator else filled_form.evaluatee_company_role_id
    if snapshot is not None:
        return snapshot
    return role_map.get(filled_form.evaluator_id if evaluator else filled_form.evaluatee_id)


def company_role_names(db: Session) -> dict[int, str]:
    return dict(db.query(models.CompanyRole.id, models.CompanyRole.name).all())


UNNAMED_SECTION = "Unnamed section"


def _section_report_data(rows: list[Any], db: Session):
    from services import section_scoring_service

    scored = [result for filled_form, _form in rows
              if (result := section_scoring_service.score_evaluation(filled_form)) is not None]
    section_ids = {section_id for evaluation in scored for section_id in evaluation.section_ids}
    # Reports show the name a Section had when it was issued; a later rename must not relabel history.
    names: dict[int, str] = {}
    for filled_form, _form in sorted(rows, key=lambda row: row[0].id):
        snapshot = filled_form.form_snapshot
        if status_of(filled_form) != "completed" or snapshot.get("schema_version") != 2:
            continue
        for block in snapshot["questions"]:
            name = (block.get("section") or {}).get("name") if block.get("type") == "section" else None
            if name and block["section_id"] in section_ids:
                names.setdefault(block["section_id"], name)
    missing = section_ids - names.keys()
    if missing:
        names.update({section.id: section.name for section in db.query(models.Section).filter(models.Section.id.in_(missing)).all()})
    return scored, names


def _section_score_rows(aggregate, scored, names: dict[int, str]):
    rows = []
    for section_id, result in aggregate.sections.items():
        peer_evaluators = len({item.evaluator_id for item in scored if item.evaluator_id != item.evaluatee_id and section_id in item.sections}) if result.availability == "available" else 0
        rows.append({
            "id": section_id,
            "name": names.get(section_id) or UNNAMED_SECTION,
            "average_score": result.score,
            "availability": result.availability,
            "evaluatee_count": result.contributor_count,
            "evaluator_count": peer_evaluators,
        })
    return sorted(rows, key=lambda item: (item["name"].lower(), item["id"]))


def build_campaign_report_overview(campaign_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    """The campaign-wide figures the campaign AI analysis is built from."""
    from services import section_scoring_service

    campaign, rows, aggregate_access = _open_report(campaign_id, actor, db)
    scored, names = _section_report_data(rows, db)
    performance = section_scoring_service.campaign_scores(scored, campaign.id, aggregate_access=aggregate_access)
    return {
        "campaign": _report_campaign_option(campaign),
        "kpis": {"total_evaluations": len(rows),
                 "completed_evaluations": sum(status_of(row[0]) == "completed" for row in rows),
                 "overall_score": performance.overall.score},
        "employees": {"participating_employees": len({row[0].evaluatee_id for row in rows})},
        "sections": _section_score_rows(performance, scored, names),
    }


def build_group_detail(campaign_id: int, group_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    from services import section_scoring_service

    campaign, rows, aggregate_access = _open_report(campaign_id, actor, db)
    group = next((group for group in assigned_campaign_groups(campaign_id, db) if group.id == group_id), None)
    team_groups = _team_groups.get()
    if group is None or (team_groups is not None and group_id not in team_groups):
        raise HTTPException(status_code=404, detail="Group report not found")
    group_rows = [row for row in rows if row[0].company_group_id == group_id]
    completed_rows = [row for row in group_rows if status_of(row[0]) == "completed"]
    scored, names = _section_report_data(rows, db)
    group_scored = [evaluation for evaluation in scored if evaluation.company_group_id == group_id]
    employees_by_id = users_by_id(db)
    role_map = {employee_id: role.id for employee_id, (_employee, role) in employees_by_id.items()}
    group_result = section_scoring_service.group_scores(scored, campaign_id, aggregate_access=aggregate_access).get(group_id) or section_scoring_service.campaign_scores([], campaign_id)
    group_sections = _section_score_rows(group_result, group_scored, names)
    members_by_group, _ = membership_maps(db)
    member_ids = members_by_group[group_id]
    attributed_evaluatees = {evaluation.evaluatee_id for evaluation in group_scored}
    role_cohort_ids = member_ids | attributed_evaluatees
    role_names = company_role_names(db)
    # People evaluated in this group keep the role they had then; other members show their current role.
    cohort_roles = {employee_id: role.id for employee_id, (_employee, role) in employees_by_id.items() if employee_id in role_cohort_ids}
    for filled_form, _form in sorted(group_rows, key=lambda row: row[0].id):
        if filled_form.evaluatee_company_role_id is not None:
            cohort_roles[filled_form.evaluatee_id] = filled_form.evaluatee_company_role_id
    role_counts: dict[int, dict[str, Any]] = {}
    for employee_id, role_id in cohort_roles.items():
        item = role_counts.setdefault(role_id, {"role_id": role_id, "role_name": role_names.get(role_id, "Unknown role"), "employee_count": 0, "average_score": None})
        item["employee_count"] += 1
    role_results = section_scoring_service.role_scores(group_scored, campaign_id, role_map, aggregate_access=aggregate_access)
    for role_item in role_counts.values():
        role_result = role_results.get(role_item["role_id"])
        if role_result and not aggregate_access:
            role_scored = [item for item in group_scored if section_scoring_service.role_of(item, role_map) == role_item["role_id"]]
            role_result = section_scoring_service.suppress_small_complements(role_result, scored, role_scored)
        role_visible = role_result if aggregate_access or all(section.availability != "suppressed" for section in group_result.sections.values()) else None
        role_item["average_score"] = role_visible.overall.score if role_visible else None
        role_item["score_availability"] = role_visible.overall.availability if role_visible else "suppressed" if role_result else "no_data"
    employees = []
    for employee_id in sorted(member_ids, key=lambda item: employees_by_id[item][0].full_name.lower()):
        employee, role = employees_by_id[employee_id]
        received = [row for row in completed_rows if row[0].evaluatee_id == employee.id and row[0].evaluator_id != employee.id]
        assigned = [row for row in group_rows if row[0].evaluatee_id == employee.id and row[0].evaluator_id != employee.id]
        self_completed = any(row[0].evaluatee_id == employee.id and row[0].evaluator_id == employee.id for row in completed_rows)
        # The employee's campaign-wide peer score, released by the same rules as on the Employees report.
        employee_result = section_scoring_service.employee_scores(scored, campaign_id, employee.id, aggregate_access=aggregate_access).overall_peer
        employees.append({
            "employee_id": employee.id,
            "employee_name": employee.full_name,
            "role_name": role_names.get(cohort_roles.get(employee.id, role.id), role.name),
            "reviews_received": len(received),
            "reviews_assigned": len(assigned),
            "completed_self_evaluation": self_completed,
            "peer_score": employee_result.score if employee_result.availability == "available" else None,
            "score_availability": employee_result.availability,
        })
    return {
        "campaign": _report_campaign_option(campaign),
        "group": {"id": group.id, "name": group.name, "description": group.description},
        "kpis": {
            "employees": len(member_ids),
            "completed_evaluations": len(completed_rows),
            "completion_rate": round(len(completed_rows) / len(group_rows) * 100) if group_rows else None,
            "reportable_sections": sum(section["availability"] == "available" for section in group_sections),
            "overall_peer_score": group_result.overall.score,
        },
        "sections": group_sections,
        "roles": sorted(role_counts.values(), key=lambda item: item["role_name"].lower()),
        "employees": employees,
    }


def self_evaluation_status(rows: list[Any], employee_id: int) -> dict[str, Any]:
    self_rows = [row for row in rows if row[0].evaluatee_id == employee_id and row[0].evaluator_id == employee_id]
    if len(self_rows) == 0:
        return {"status": "Not assigned", "assigned": 0, "completed": 0}
    completed = sum(1 for row in self_rows if status_of(row[0]) == "completed")
    in_progress = any(status_of(row[0]) == "in_progress" for row in self_rows)
    status = "Completed" if completed == len(self_rows) else "In progress" if in_progress or completed > 0 else "Not started"
    return {"status": status, "assigned": len(self_rows), "completed": completed}


def campaign_participant_ids(campaign_id: int, rows: list[Any], db: Session) -> set[int]:
    """Assigned evaluatees plus every member of the campaign's groups."""
    members_by_group, _ = membership_maps(db)
    participant_ids = {row[0].evaluatee_id for row in rows}
    for group in assigned_campaign_groups(campaign_id, db):
        participant_ids.update(members_by_group[group.id])
    return participant_ids


def employee_base_context(campaign_id: int, rows: list[Any], db: Session) -> tuple[dict[int, Any], dict[int, list[str]], set[int]]:
    group_names_by_id = {group.id: group.name for group in assigned_campaign_groups(campaign_id, db)}
    _members, groups_by_employee = membership_maps(db)
    group_names_by_employee = {employee_id: [group_names_by_id[group_id] for group_id in sorted(group_ids) if group_id in group_names_by_id]
                               for employee_id, group_ids in groups_by_employee.items()}
    return users_by_id(db), group_names_by_employee, campaign_participant_ids(campaign_id, rows, db)


def build_employee_reports_overview(campaign_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    from services import report_dashboard_service, section_scoring_service

    campaign, rows, aggregate_access = _open_report(campaign_id, actor, db)
    employees_by_id, group_names_by_employee, participant_ids = employee_base_context(campaign.id, rows, db)
    team_groups = _team_groups.get()
    if team_groups is not None:
        team = team_employee_ids(campaign.id, team_groups, actor, db)
        participant_ids &= team
        rows = [row for row in rows if row[0].evaluatee_id in team]
    peer_rows = [row for row in rows if row[0].evaluator_id != row[0].evaluatee_id]
    completed_peer_rows = [row for row in peer_rows if status_of(row[0]) == "completed"]
    peer_assigned: dict[int, int] = defaultdict(int)
    peer_completed: dict[int, int] = defaultdict(int)
    for filled_form, _form in peer_rows:
        peer_assigned[filled_form.evaluatee_id] += 1
        peer_completed[filled_form.evaluatee_id] += status_of(filled_form) == "completed"

    scored, section_names = _section_report_data(rows, db)
    previous_campaign, previous_scores = report_dashboard_service.previous_employee_scores(campaign, actor, db, set(participant_ids))
    _members, groups_by_employee = membership_maps(db)
    campaign_groups = assigned_campaign_groups(campaign.id, db)
    if team_groups is not None:
        campaign_groups = [group for group in campaign_groups if group.id in team_groups]
    campaign_group_ids = {group.id for group in campaign_groups}
    employees = []
    for employee_id in sorted(participant_ids, key=lambda item: employees_by_id[item][0].full_name.lower()):
        employee, role = employees_by_id[employee_id]
        employee_result = section_scoring_service.employee_scores(scored, campaign.id, employee_id, aggregate_access=aggregate_access)
        employees.append({
            "employee_id": employee.id,
            "employee_name": employee.full_name,
            "email": employee.user.email if employee.user else None,
            "company_role": role.name,
            "groups": group_names_by_employee.get(employee.id, []),
            "peer_assigned": peer_assigned[employee_id],
            "peer_completed": peer_completed[employee_id],
            "self_evaluation": self_evaluation_status(rows, employee.id),
            "performance_summary": {
                "overall_peer_score": employee_result.overall_peer.score,
                "availability": employee_result.overall_peer.availability,
                "reportable_sections": sum(result.availability == "available" for result in employee_result.peer_sections.values()),
                "overall_self_score": employee_result.overall_self.score,
                "previous_overall_peer_score": previous.overall_peer.score
                if (previous := previous_scores.get(employee_id)) and previous.overall_peer.availability == "available" else None,
                "section_scores": {section_id: result.score if result.availability == "available" else None
                                   for section_id, result in employee_result.peer_sections.items()},
            },
            "group_ids": sorted(groups_by_employee.get(employee_id, set()) & campaign_group_ids),
        })
    return {
        "campaign": _report_campaign_option(campaign),
        "kpis": {
            "participating_employees": len(employees),
            "peer_reviews_assigned": len(peer_rows),
            "peer_reviews_completed": len(completed_peer_rows),
            "employees_with_peer_feedback": len({row[0].evaluatee_id for row in completed_peer_rows}),
            "awaiting_peer_feedback": sum(1 for employee in employees if employee["peer_assigned"] > 0 and employee["peer_completed"] == 0),
            "completed_self_evaluations": sum(item["self_evaluation"]["completed"] for item in employees),
            "assigned_self_evaluations": sum(item["self_evaluation"]["assigned"] for item in employees),
        },
        "employees": employees,
        "previous_campaign": _report_campaign_option(previous_campaign) if previous_campaign else None,
        "sections": sorted(({"id": section_id, "name": section_names.get(section_id) or UNNAMED_SECTION}
                            for section_id in {section_id for item in employees for section_id in item["performance_summary"]["section_scores"]}),
                           key=lambda item: (item["name"].casefold(), item["id"])),
        "groups": [{"id": group.id, "name": group.name} for group in campaign_groups],
    }


def build_employee_history(employee_id: int, actor: models.User, db: Session) -> list[dict[str, Any]]:
    from services import section_scoring_service

    require_reports_access(None, actor, db)
    aggregate_access = permissions.has_permission(actor, db, "campaigns.manage")
    team_groups = _team_groups.get()
    campaigns = (db.query(models.Campaign)
                 .filter(models.Campaign.status.in_(REPORTABLE_CAMPAIGN_STATUSES))
                 .order_by(models.Campaign.start_date.asc(), models.Campaign.id.asc()).all())
    series_by_section: dict[int | None, dict[str, Any]] = {}
    for campaign in campaigns:
        if team_groups is not None and employee_id not in team_employee_ids(campaign.id, team_groups, actor, db):
            continue
        scored, names = _section_report_data(campaign_report_rows(campaign.id, db), db)
        employee_result = section_scoring_service.employee_scores(scored, campaign.id, employee_id, aggregate_access=aggregate_access)
        reportable_ids = {section_id for section_id, result in employee_result.peer_sections.items() if result.availability == "available"}
        overall_evaluators = len({evaluation.evaluator_id for evaluation in scored if evaluation.evaluatee_id == employee_id and evaluation.evaluator_id != employee_id and reportable_ids.intersection(evaluation.sections)})
        for section_id, result in [(None, employee_result.overall_peer), *employee_result.peer_sections.items()]:
            if result.availability != "available":
                continue
            name = "Overall peer score" if section_id is None else names.get(section_id, UNNAMED_SECTION)
            series = series_by_section.setdefault(section_id, {"section_id": section_id, "section_name": name, "points": []})
            series["points"].append({
                "campaign_id": campaign.id,
                "campaign_name": campaign.name,
                "campaign_start_date": business_date(campaign.start_date),
                "average_score": result.score,
                "evaluator_count": result.contributor_count if section_id is not None else overall_evaluators,
                "reportable_sections": len(reportable_ids),
            })
    return sorted((series for series in series_by_section.values() if len(series["points"]) >= 2), key=lambda series: (series["section_id"] is not None, series["section_name"].lower(), series["section_id"] or 0))


def build_employee_report_detail(campaign_id: int, employee_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    from services import report_dashboard_service, section_scoring_service

    campaign, rows, aggregate_access = _open_report(campaign_id, actor, db)
    employees_by_id, group_names_by_employee, participant_ids = employee_base_context(campaign.id, rows, db)
    if employee_id not in employees_by_id:
        raise HTTPException(status_code=404, detail="Employee not found")
    if employee_id not in participant_ids:
        raise HTTPException(status_code=404, detail="Employee is not part of this campaign report")
    employee, role = employees_by_id[employee_id]
    peer_rows = [row for row in rows if row[0].evaluatee_id == employee_id and row[0].evaluator_id != employee_id]
    peer_completed_rows = [row for row in peer_rows if status_of(row[0]) == "completed"]
    scored, names = _section_report_data(rows, db)
    employee_result = section_scoring_service.employee_scores(scored, campaign.id, employee_id, aggregate_access=aggregate_access)
    sections = []
    for section_id, peer in employee_result.peer_sections.items():
        self_result = employee_result.self_sections[section_id]
        sections.append({
            "id": section_id,
            "name": names.get(section_id, UNNAMED_SECTION),
            "peer_score": peer.score,
            "peer_availability": peer.availability,
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

    previous_campaign, previous_scores = report_dashboard_service.previous_employee_scores(campaign, actor, db, {employee_id})
    previous = previous_scores.get(employee_id)
    self_status = self_evaluation_status(rows, employee_id)
    distinct_peer_evaluators = len({row[0].evaluator_id for row in peer_completed_rows})
    return {
        "campaign": _report_campaign_option(campaign),
        "employee": {"id": employee.id, "name": employee.full_name, "email": employee.user.email if employee.user else None, "company_role": role.name, "groups": group_names_by_employee.get(employee.id, [])},
        "kpis": {
            "peer_reviews_assigned": len(peer_rows),
            "reportable_sections": sum(result.availability == "available" for result in employee_result.peer_sections.values()),
            "overall_peer_score": employee_result.overall_peer.score,
            "overall_self_score": employee_result.overall_self.score,
        },
        "sections": sections,
        "section_availability": availability,
        "coverage": {"peer_assigned": len(peer_rows), "peer_completed": len(peer_completed_rows), "peer_outstanding": len(peer_rows) - len(peer_completed_rows), "self_evaluation": self_status, "campaign_end_date": business_date(campaign.end_date), "distinct_peer_evaluators": distinct_peer_evaluators if aggregate_access or distinct_peer_evaluators >= min_individual_peer_reviewers() else None},
        "history": build_employee_history(employee_id, actor, db),
        "previous_campaign": _report_campaign_option(previous_campaign) if previous_campaign else None,
        "previous": {
            "overall_peer_score": previous.overall_peer.score if previous.overall_peer.availability == "available" else None,
            "sections": {section_id: result.score if result.availability == "available" else None for section_id, result in previous.peer_sections.items()},
        } if previous else None,
        "benchmarks": report_dashboard_service.employee_benchmarks(campaign, employee_id, rows, actor, db, aggregate_access),
    }

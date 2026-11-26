"""Campaign dashboard: group x section and role x section matrices, previous-campaign deltas and a campaign trend.

Every figure goes through the same scoring and privacy suppression as the other report
endpoints; this module only combines them across campaigns.
"""
from collections import Counter
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from services import permissions, question_analytics_service, reporting_service, section_scoring_service

TREND_LENGTH = 6


def _score(result: section_scoring_service.ScoreResult | None) -> dict[str, Any]:
    if result is None:
        return {"score": None, "availability": "no_data"}
    return {"score": result.score, "availability": result.availability}


def _released(result: section_scoring_service.ScoreResult | None) -> float | None:
    return result.score if result is not None and result.availability == "available" else None


def _rate(completed: int, total: int) -> int | None:
    return round(completed / total * 100) if total else None


def _overall_of(results: dict, key: int) -> float | None:
    return _released(results[key].overall) if key in results else None


def _sections_of(results: dict, key: int, section_ids: list[int]) -> dict[int, float | None]:
    return {section_id: _released(results[key].sections.get(section_id)) if key in results else None for section_id in section_ids}


def _team_scores(scored: list[Any], campaign_id: int, team: frozenset[int]) -> section_scoring_service.AggregateScores:
    """A group leader's groups taken together, with the same thresholds as a single group.

    Besides the usual complement check against the whole campaign, the combined score is
    withheld wherever leaving out one of the led groups would leave too few evaluated
    employees: otherwise the combined and per-group figures could recover a hidden group.
    """
    scoped = [item for item in scored if item.campaign_id == campaign_id]
    cohort = [item for item in scoped if item.company_group_id in team]
    result = section_scoring_service.suppress_small_complements(
        section_scoring_service._aggregate(cohort, reporting_service.min_aggregate_evaluatees()), scoped, cohort)
    for group_id in team:
        result = section_scoring_service.suppress_small_complements(result, cohort, [item for item in cohort if item.company_group_id == group_id])
    return result


def _summarize(campaign: models.Campaign, roles: dict[int, int], aggregate_access: bool, db: Session,
               team: frozenset[int] | None = None) -> dict[str, Any]:
    """One campaign's figures; for a group leader (team) the totals cover only the groups they lead."""
    rows = reporting_service.campaign_report_rows(campaign.id, db)
    totals: Counter = Counter()
    completed: Counter = Counter()
    role_totals: Counter = Counter()
    role_completed: Counter = Counter()
    role_people: dict[int, set[int]] = {}
    for filled_form, _form in rows:
        done = filled_form.finish_date is not None
        for key in (None, filled_form.company_group_id):
            if key is None and team is not None and filled_form.company_group_id not in team:
                continue
            totals[key] += 1
            completed[key] += done
        # Roles are those of the evaluated employee, frozen when the questionnaire was issued.
        role_id = reporting_service.assignment_role_id(filled_form, roles)
        if role_id is not None and team is None:
            role_totals[role_id] += 1
            role_completed[role_id] += done
            role_people.setdefault(role_id, set()).add(filled_form.evaluatee_id)
    scored, names = reporting_service._section_report_data(rows, db)
    company = section_scoring_service.campaign_scores(scored, campaign.id, aggregate_access=aggregate_access)
    return {
        "campaign": campaign,
        "company": company,
        "counts": {key: (completed[key], total) for key, total in totals.items()},
        "role_counts": {key: (role_completed[key], total) for key, total in role_totals.items()},
        "role_people": {key: len(ids) for key, ids in role_people.items()},
        "scores": company if team is None else _team_scores(scored, campaign.id, team),
        "groups": section_scoring_service.group_scores(scored, campaign.id, aggregate_access=aggregate_access),
        # Group leaders get no role views: split by role, small teams would isolate people.
        "roles": {} if team is not None else section_scoring_service.role_scores(scored, campaign.id, roles, aggregate_access=aggregate_access),
        "names": names,
    }


def _history(campaign: models.Campaign, db: Session, team: frozenset[int] | None) -> list[models.Campaign]:
    """Reportable campaigns that started before this one, oldest first; for a group leader only those with a led group."""
    earlier = (db.query(models.Campaign)
               .filter(models.Campaign.status.in_(reporting_service.REPORTABLE_CAMPAIGN_STATUSES))
               .filter((models.Campaign.start_date < campaign.start_date)
                       | ((models.Campaign.start_date == campaign.start_date) & (models.Campaign.id < campaign.id)))
               .order_by(models.Campaign.start_date.desc(), models.Campaign.id.desc())
               .limit(TREND_LENGTH - 1).all())
    return [item for item in reversed(earlier)
            if team is None or team & {group.id for group in reporting_service.assigned_campaign_groups(item.id, db)}]


def build_campaign_dashboard(campaign_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    team = reporting_service.require_team_campaign(campaign_id, actor, db)
    campaign = reporting_service.require_reports_access(campaign_id, actor, db)
    # Group leaders never get the managers' unsuppressed statistics.
    aggregate_access = team is None and permissions.has_permission(actor, db, "campaigns.manage")
    roles = {employee_id: role.id for employee_id, (_employee, role) in reporting_service.users_by_id(db).items()}
    history = _history(campaign, db, team)
    summaries = [_summarize(item, roles, aggregate_access, db, team) for item in [*history, campaign]]
    current = summaries[-1]
    previous = summaries[-2] if len(summaries) > 1 else None
    groups = [group for group in reporting_service.assigned_campaign_groups(campaign.id, db) if team is None or group.id in team]
    members_by_group, _ = reporting_service.membership_maps(db)

    def previous_section(section_id: int) -> float | None:
        return _released(previous["scores"].sections.get(section_id)) if previous else None

    done, total = current["counts"].get(None, (0, 0))
    previous_done, previous_total = previous["counts"].get(None, (0, 0)) if previous else (0, 0)
    section_ids = sorted(current["scores"].sections, key=lambda item: ((current["names"].get(item) or "").casefold(), item))
    group_rows = []
    for group in groups:
        result = current["groups"].get(group.id)
        group_done, group_total = current["counts"].get(group.id, (0, 0))
        group_rows.append({
            "id": group.id,
            "name": group.name,
            "employee_count": len(members_by_group[group.id]),
            "completed_evaluations": group_done,
            "total_evaluations": group_total,
            "completion_rate": _rate(group_done, group_total),
            "overall": {**_score(result.overall if result else None), "previous_score": _overall_of(previous["groups"], group.id) if previous else None},
            "sections": {section_id: _score(result.sections.get(section_id) if result else None) for section_id in section_ids},
        })

    role_names = reporting_service.company_role_names(db)
    role_ids = sorted(current["role_counts"], key=lambda item: (role_names.get(item, "").casefold(), item))
    role_rows = []
    for role_id in role_ids:
        result = current["roles"].get(role_id)
        role_done, role_total = current["role_counts"][role_id]
        role_rows.append({
            "id": role_id,
            "name": role_names.get(role_id, "Unknown role"),
            "employee_count": current["role_people"].get(role_id, 0),
            "completed_evaluations": role_done,
            "total_evaluations": role_total,
            "completion_rate": _rate(role_done, role_total),
            "overall": {**_score(result.overall if result else None), "previous_score": _overall_of(previous["roles"], role_id) if previous else None},
            "sections": {section_id: _score(result.sections.get(section_id) if result else None) for section_id in section_ids},
        })
    return {
        "campaign": reporting_service._report_campaign_option(campaign),
        "previous_campaign": reporting_service._report_campaign_option(previous["campaign"]) if previous else None,
        "completion": {"completed_evaluations": done, "total_evaluations": total, "rate": _rate(done, total),
                       "previous_rate": _rate(previous_done, previous_total) if previous else None},
        "overall": {**_score(current["scores"].overall), "previous_score": _released(previous["scores"].overall) if previous else None},
        "sections": [{"id": section_id, "name": current["names"].get(section_id) or reporting_service.UNNAMED_SECTION,
                      **_score(current["scores"].sections[section_id]), "previous_score": previous_section(section_id)}
                     for section_id in section_ids],
        "groups": group_rows,
        # For a group leader, the whole campaign as a reference point next to their own groups.
        "benchmark": None if team is None else {
            "overall": _score(current["company"].overall),
            "sections": {section_id: _score(current["company"].sections.get(section_id)) for section_id in section_ids},
        },
        "roles": role_rows,
        "trend": [{
            "campaign": reporting_service._report_campaign_option(item["campaign"]),
            "overall": _released(item["scores"].overall),
            "completion_rate": _rate(*item["counts"].get(None, (0, 0))),
            "sections": {section_id: _released(item["scores"].sections.get(section_id)) for section_id in section_ids},
            "groups": {group.id: _overall_of(item["groups"], group.id) for group in groups},
            "group_sections": {group.id: _sections_of(item["groups"], group.id, section_ids) for group in groups},
            "roles": {role_id: _overall_of(item["roles"], role_id) for role_id in role_ids},
            "role_sections": {role_id: _sections_of(item["roles"], role_id, section_ids) for role_id in role_ids},
        } for item in summaries],
    }


MAX_SECTION_GROUPS = 5


def _section_questions(report: dict, section_id: int) -> dict[str, dict]:
    return {item["key"]: item for item in report["questions"] if item["section_id"] == section_id}


def _cell(item: dict | None) -> dict[str, Any]:
    if item is None:
        return {"availability": "no_data", "response_count": 0, "average": None, "distribution": None}
    return {"availability": item["availability"], "response_count": item["response_count"], "average": item["average_normalized"],
            "distribution": item["distribution"] if item["availability"] == "available" else None}


def build_section_questions(campaign_id: int, section_id: int, group_ids: list[int], actor: models.User, db: Session,
                            role_ids: list[int] | None = None) -> dict[str, Any]:
    """One section's questions for the campaign, the compared groups or roles, self ratings and the previous campaign.

    Compared roles are the evaluated employees' roles; they come back in the same "groups" fields as groups do.
    Every slice comes from the question report, so each keeps its own privacy release decision.
    Questions are matched across campaigns by their content key, which only changes when the question does.
    """
    team = reporting_service.require_team_campaign(campaign_id, actor, db)
    campaign = reporting_service.require_reports_access(campaign_id, actor, db)
    role_ids = role_ids or []
    if team is not None and (role_ids or any(group_id not in team for group_id in group_ids)):
        # Group leaders compare their own groups; the campaign-wide columns are the company reference.
        raise HTTPException(status_code=403, detail="You can only view reports of groups you lead")
    if group_ids and role_ids:
        raise HTTPException(status_code=400, detail="Compare either groups or roles, not both")
    if len(group_ids) > MAX_SECTION_GROUPS or len(role_ids) > MAX_SECTION_GROUPS:
        raise HTTPException(status_code=400, detail=f"Compare at most {MAX_SECTION_GROUPS} groups or roles at a time")
    if role_ids:
        names = reporting_service.company_role_names(db)
        if any(role_id not in names for role_id in role_ids):
            raise HTTPException(status_code=404, detail="Role report not found")
        cohorts = [(role_id, names[role_id], {"role_id": role_id}) for role_id in role_ids]
    else:
        groups = {group.id: group for group in reporting_service.assigned_campaign_groups(campaign_id, db)}
        if any(group_id not in groups for group_id in group_ids):
            raise HTTPException(status_code=404, detail="Group report not found")
        cohorts = [(group_id, groups[group_id].name, {"group_id": group_id}) for group_id in group_ids]

    # Collect the campaign once; every slice below is released from the same data by its own rules.
    prepared = question_analytics_service.prepare(campaign_id, actor, db)

    def report(**scope) -> dict[str, dict]:
        return _section_questions(question_analytics_service.build_question_report(campaign_id, actor, db, prepared=prepared, **scope), section_id)

    peer = report()
    if not peer:
        raise HTTPException(status_code=404, detail="Section is not part of this campaign report")
    self_rated = report(evaluation_type="self")
    by_group = {cohort_id: report(**scope) for cohort_id, _name, scope in cohorts}
    history = _history(campaign, db, team)
    previous_campaign = history[-1] if history else None
    previous = (_section_questions(question_analytics_service.build_question_report(previous_campaign.id, actor, db), section_id)
                if previous_campaign is not None else {})
    section_name = next(iter(peer.values()))["section_name"]

    def previous_average(key: str) -> float | None:
        item = previous.get(key)
        return item["average_normalized"] if item and item["availability"] == "available" else None

    return {
        "campaign": reporting_service._report_campaign_option(campaign),
        "previous_campaign": reporting_service._report_campaign_option(previous_campaign) if previous_campaign else None,
        "section": {"id": section_id, "name": section_name},
        "dimension": "roles" if role_ids else "groups",
        "groups": [{"id": cohort_id, "name": name} for cohort_id, name, _scope in cohorts],
        "questions": [{
            "key": key,
            "text": item["text"],
            "type": item["type"],
            "category": item["category"],
            "scale_min": item["scale_min"],
            "scale_max": item["scale_max"],
            **_cell(item),
            "previous_average": previous_average(key),
            "distribution_kind": item["distribution_kind"],
            "distribution": item["distribution"],
            "self": _cell(self_rated.get(key)),
            "groups": {cohort_id: _cell(by_group[cohort_id].get(key)) for cohort_id, _name, _scope in cohorts},
        } for key, item in peer.items()],
    }


def previous_employee_scores(campaign: models.Campaign, actor: models.User, db: Session,
                             employee_ids: set[int]) -> tuple[models.Campaign | None, dict[int, Any]]:
    """Employee scores from the previous reportable campaign, limited to what the actor may see there."""
    team_groups = reporting_service._team_groups.get()
    history = _history(campaign, db, team_groups)
    if not history:
        return None, {}
    previous = history[-1]
    aggregate_access = permissions.has_permission(actor, db, "campaigns.manage")
    if team_groups is not None:
        employee_ids = employee_ids & reporting_service.team_employee_ids(previous.id, team_groups, actor, db)
    scored, _names = reporting_service._section_report_data(reporting_service.campaign_report_rows(previous.id, db), db)
    return previous, {employee_id: section_scoring_service.employee_scores(scored, previous.id, employee_id, aggregate_access=aggregate_access)
                      for employee_id in employee_ids}


def employee_benchmarks(campaign: models.Campaign, employee_id: int, rows: list[Any], actor: models.User, db: Session,
                        aggregate_access: bool) -> dict[str, Any]:
    """Campaign and group averages to compare one employee with.

    Team leads see only their own groups, the same as on the Groups report; the campaign-wide
    average needs full report access.
    """
    team_groups = reporting_service._team_groups.get()
    _members, groups_by_employee = reporting_service.membership_maps(db)
    groups = [group for group in reporting_service.assigned_campaign_groups(campaign.id, db)
              if group.id in groups_by_employee.get(employee_id, set()) and (team_groups is None or group.id in team_groups)]
    group_rows = rows if team_groups is None else [row for row in rows if row[0].company_group_id in team_groups]
    scored, _names = reporting_service._section_report_data(group_rows, db)
    results = section_scoring_service.group_scores(scored, campaign.id, aggregate_access=aggregate_access)

    def profile(result) -> dict[str, Any]:
        return {"overall": _released(result.overall) if result else None,
                "sections": {section_id: _released(score) for section_id, score in result.sections.items()} if result else {}}

    return {
        "campaign": profile(section_scoring_service.campaign_scores(scored, campaign.id, aggregate_access=aggregate_access)) if team_groups is None else None,
        "groups": [{"id": group.id, "name": group.name, **profile(results.get(group.id))} for group in groups],
    }

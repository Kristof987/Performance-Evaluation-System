"""Campaign dashboard: group x section matrix, previous-campaign deltas and a campaign trend.

Every figure goes through the same scoring and privacy suppression as the other report
endpoints; this module only combines them across campaigns.
"""
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

import campaign_lifecycle
import models
import question_analytics_service
import reporting_service
import section_scoring_service

TREND_LENGTH = 6


def _score(result: section_scoring_service.ScoreResult | None) -> dict[str, Any]:
    if result is None:
        return {"score": None, "availability": "no_data"}
    return {"score": result.score, "availability": result.availability}


def _released(result: section_scoring_service.ScoreResult | None) -> float | None:
    return result.score if result is not None and result.availability == "available" else None


def _rate(completed: int, total: int) -> int | None:
    return round(completed / total * 100) if total else None


def _summarize(campaign: models.Campaign, roles: dict[int, int], aggregate_access: bool, db: Session) -> dict[str, Any]:
    rows = reporting_service.campaign_report_rows(campaign.id, db)
    totals: dict[int | None, set[int]] = {}
    completed: dict[int | None, set[int]] = {}
    for filled_form, _form, status in rows:
        for key in (None, filled_form.company_group_id):
            totals.setdefault(key, set()).add(filled_form.id)
            if reporting_service.status_key(status, filled_form.finish_date) == "completed":
                completed.setdefault(key, set()).add(filled_form.id)
    scored, names = reporting_service._section_report_data(rows, db)
    return {
        "campaign": campaign,
        "counts": {key: (len(completed.get(key, ())), len(ids)) for key, ids in totals.items()},
        "scores": section_scoring_service.campaign_scores(scored, campaign.id, aggregate_access=aggregate_access),
        "groups": section_scoring_service.group_scores(scored, campaign.id, roles, aggregate_access=aggregate_access),
        "names": names,
    }


def _history(campaign: models.Campaign, db: Session) -> list[models.Campaign]:
    """Reportable campaigns that started before this one, oldest first."""
    earlier = (db.query(models.Campaign)
               .filter(models.Campaign.status.in_(reporting_service.REPORTABLE_CAMPAIGN_STATUSES))
               .filter((models.Campaign.start_date < campaign.start_date)
                       | ((models.Campaign.start_date == campaign.start_date) & (models.Campaign.id < campaign.id)))
               .order_by(models.Campaign.start_date.desc(), models.Campaign.id.desc())
               .limit(TREND_LENGTH - 1).all())
    return [item for item in reversed(earlier) if campaign_lifecycle.reporting_allowed(item)]


def build_campaign_dashboard(campaign_id: int, actor: models.User, db: Session) -> dict[str, Any]:
    campaign = reporting_service.require_reports_access(campaign_id, actor, db)
    assert campaign is not None
    aggregate_access = reporting_service.aggregate_reporting_access(campaign_id, actor, db)
    roles = {employee_id: role.id for employee_id, (_employee, role) in reporting_service.users_by_id(db).items()}
    summaries = [_summarize(item, roles, aggregate_access, db) for item in [*_history(campaign, db), campaign]]
    current = summaries[-1]
    previous = summaries[-2] if len(summaries) > 1 else None
    groups = reporting_service.assigned_campaign_groups(campaign.id, db)
    members_by_group, _ = reporting_service.membership_maps(db)

    def previous_section(section_id: int) -> float | None:
        return _released(previous["scores"].sections.get(section_id)) if previous else None

    def previous_group(group_id: int) -> float | None:
        return _released(previous["groups"][group_id].overall) if previous and group_id in previous["groups"] else None

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
            "overall": {**_score(result.overall if result else None), "previous_score": previous_group(group.id)},
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
        "trend": [{
            "campaign": reporting_service._report_campaign_option(item["campaign"]),
            "overall": _released(item["scores"].overall),
            "completion_rate": _rate(*item["counts"].get(None, (0, 0))),
            "sections": {section_id: _released(item["scores"].sections.get(section_id)) for section_id in section_ids},
            "groups": {group.id: _released(item["groups"][group.id].overall) if group.id in item["groups"] else None for group in groups},
            "group_sections": {group.id: {section_id: _released(item["groups"][group.id].sections.get(section_id)) if group.id in item["groups"] else None
                                          for section_id in section_ids} for group in groups},
        } for item in summaries],
    }


MAX_SECTION_GROUPS = 5


def _section_questions(report: dict, section_id: int) -> dict[str, dict]:
    return {item["key"]: item for item in report["questions"] if item["section_id"] == section_id}


def _cell(item: dict | None) -> dict[str, Any]:
    if item is None:
        return {"availability": "no_data", "response_count": 0, "average": None}
    return {"availability": item["availability"], "response_count": item["response_count"], "average": item["average_normalized"]}


def build_section_questions(campaign_id: int, section_id: int, group_ids: list[int], actor: models.User, db: Session) -> dict[str, Any]:
    """One section's questions for the campaign, the compared groups, self ratings and the previous campaign.

    Every slice comes from the question report, so each keeps its own privacy release decision.
    Questions are matched across campaigns by their content key, which only changes when the question does.
    """
    campaign = reporting_service.require_reports_access(campaign_id, actor, db)
    assert campaign is not None
    if len(group_ids) > MAX_SECTION_GROUPS:
        raise HTTPException(status_code=400, detail=f"Compare at most {MAX_SECTION_GROUPS} groups at a time")
    groups = {group.id: group for group in reporting_service.assigned_campaign_groups(campaign_id, db)}
    if any(group_id not in groups for group_id in group_ids):
        raise HTTPException(status_code=404, detail="Group report not found")

    peer = _section_questions(question_analytics_service.build_question_report(campaign_id, actor, db), section_id)
    if not peer:
        raise HTTPException(status_code=404, detail="Section is not part of this campaign report")
    self_rated = _section_questions(question_analytics_service.build_question_report(campaign_id, actor, db, evaluation_type="self"), section_id)
    by_group = {group_id: _section_questions(question_analytics_service.build_question_report(campaign_id, actor, db, group_id=group_id), section_id)
                for group_id in group_ids}
    history = _history(campaign, db)
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
        "groups": [{"id": group_id, "name": groups[group_id].name} for group_id in group_ids],
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
            "groups": {group_id: _cell(by_group[group_id].get(key)) for group_id in group_ids},
        } for key, item in peer.items()],
    }


def previous_employee_scores(campaign: models.Campaign, actor: models.User, db: Session,
                             employee_ids: set[int]) -> tuple[models.Campaign | None, dict[int, Any]]:
    """Employee scores from the previous reportable campaign, limited to what the actor may see there."""
    history = _history(campaign, db)
    if not history:
        return None, {}
    previous = history[-1]
    aggregate_access = reporting_service.aggregate_reporting_access(previous.id, actor, db)
    team_groups = reporting_service._team_groups.get()
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
    roles = {person_id: role.id for person_id, (_employee, role) in reporting_service.users_by_id(db).items()}
    results = section_scoring_service.group_scores(scored, campaign.id, roles, aggregate_access=aggregate_access)

    def profile(result) -> dict[str, Any]:
        return {"overall": _released(result.overall) if result else None,
                "sections": {section_id: _released(score) for section_id, score in result.sections.items()} if result else {}}

    return {
        "campaign": profile(section_scoring_service.campaign_scores(scored, campaign.id, aggregate_access=aggregate_access)) if team_groups is None else None,
        "groups": [{"id": group.id, "name": group.name, **profile(results.get(group.id))} for group in groups],
    }

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from statistics import mean
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import form_snapshot_service


COMPLETED_STATUSES = {"completed", "submitted"}
MIN_AGGREGATE_EVALUATEES = 2
MIN_INDIVIDUAL_PEER_REVIEWERS = 2


@dataclass(frozen=True)
class RatingResponse:
    filled_form_id: int
    evaluatee_id: int
    evaluator_id: int
    company_group_id: int | None
    form_id: int
    question_id: str
    question_text: str
    value: int
    scale_min: int
    scale_max: int
    direction: str
    dimension_id: str | None
    dimension_name: str | None


def status_key(status_name: str | None, finish_date: date | None) -> str:
    if finish_date is not None:
        return "completed"
    normalized = (status_name or "Not started").strip().lower()
    if normalized in COMPLETED_STATUSES:
        return "completed"
    if normalized in {"in progress", "in_progress", "started"}:
        return "in_progress"
    return "not_started"


def require_reports_access(campaign_id: int | None, requester_user_id: int, db: Session) -> models.Campaign | None:
    user_role = (
        db.query(models.User, models.CompanyRole.name.label("role_name"))
        .join(models.CompanyRole, models.CompanyRole.id == models.User.company_role_id)
        .filter(models.User.id == requester_user_id)
        .filter(models.User.is_active.is_(True))
        .first()
    )
    if user_role is None:
        raise HTTPException(status_code=403, detail="User is not authorized to view reports")
    _, role_name = user_role
    role = role_name.strip().lower()
    if role != "hr" and "manager" not in role:
        raise HTTPException(status_code=403, detail="User is not authorized to view reports")

    if campaign_id is None:
        return None
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


def list_report_campaigns(requester_user_id: int, db: Session) -> list[dict[str, Any]]:
    require_reports_access(None, requester_user_id, db)
    return [
        {
            "id": campaign.id,
            "name": campaign.name,
            "start_date": campaign.start_date,
            "end_date": campaign.end_date,
            "is_active": campaign.is_active,
        }
        for campaign in db.query(models.Campaign)
        .order_by(models.Campaign.is_active.desc(), models.Campaign.start_date.desc(), models.Campaign.id.desc())
        .all()
    ]


def dimension_metadata(question: dict[str, Any]) -> tuple[str | None, str | None]:
    stable_id = question.get("dimension_id") or question.get("dimensionId")
    if isinstance(stable_id, int):
        raw_name = None
        if isinstance(question.get("dimension"), dict):
            raw_name = question["dimension"].get("name")
        return str(stable_id), raw_name if isinstance(raw_name, str) and raw_name.strip() else f"Dimension {stable_id}"
    raw = question.get("dimension") or question.get("evaluationDimension") or question.get("competency")
    if isinstance(raw, dict):
        raw_id = raw.get("id") or raw.get("key") or raw.get("name")
        raw_name = raw.get("name") or raw.get("label") or raw_id
    else:
        raw_id = question.get("dimension_id") or question.get("dimensionId") or question.get("competency_id") or raw
        raw_name = question.get("dimension_name") or question.get("dimensionName") or question.get("competency_name") or raw_id

    if isinstance(raw_id, int):
        dimension_name = raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else f"Dimension {raw_id}"
        return str(raw_id), dimension_name
    if not isinstance(raw_id, str) or raw_id.strip() == "":
        return None, None
    dimension_id = raw_id.strip().lower().replace(" ", "-")
    dimension_name = raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else raw_id.strip()
    return dimension_id, dimension_name


def scale_for_question(question: dict[str, Any]) -> tuple[int, int] | None:
    kind = question.get("type")
    if kind == "Scale 1-5":
        return 1, 5
    if kind == "Scale 1-10":
        return 1, 10
    return None


def rating_responses(rows: list[Any], peer_only: bool = True) -> list[RatingResponse]:
    responses: list[RatingResponse] = []
    for filled_form, form, status_name in rows:
        if status_key(status_name, filled_form.finish_date) != "completed":
            continue
        if peer_only and filled_form.evaluator_id == filled_form.evaluatee_id:
            continue
        questions = form_snapshot_service.snapshot_questions(filled_form, form)
        answers = filled_form.answers if isinstance(filled_form.answers, list) else []
        answers_by_id = {
            answer.get("question_id"): answer.get("value")
            for answer in answers
            if isinstance(answer, dict) and isinstance(answer.get("question_id"), str)
        }
        for question in questions:
            if not isinstance(question, dict) or not isinstance(question.get("id"), str):
                continue
            scale = scale_for_question(question)
            if scale is None:
                continue
            value = answers_by_id.get(question["id"])
            scale_min, scale_max = scale
            if not isinstance(value, int) or isinstance(value, bool) or value < scale_min or value > scale_max:
                continue
            dimension_id, dimension_name = dimension_metadata(question)
            direction = str(question.get("scale_direction") or question.get("scaleDirection") or "higher_is_better")
            responses.append(
                RatingResponse(
                    filled_form_id=filled_form.id,
                    evaluatee_id=filled_form.evaluatee_id,
                    evaluator_id=filled_form.evaluator_id,
                    company_group_id=filled_form.company_group_id,
                    form_id=filled_form.form_id,
                    question_id=question["id"],
                    question_text=str(question.get("text") or "Untitled rating question"),
                    value=value,
                    scale_min=scale_min,
                    scale_max=scale_max,
                    direction=direction,
                    dimension_id=dimension_id,
                    dimension_name=dimension_name,
                )
            )
    return responses


def compatible_dimension_groups(responses: list[RatingResponse]) -> dict[str, list[RatingResponse]]:
    grouped: dict[str, list[RatingResponse]] = defaultdict(list)
    for response in responses:
        if response.dimension_id is not None:
            grouped[response.dimension_id].append(response)
    compatible = {}
    for dimension_id, items in grouped.items():
        signatures = {(item.scale_min, item.scale_max, item.direction) for item in items}
        if len(signatures) == 1:
            compatible[dimension_id] = items
    return compatible


def average_by_evaluatee(items: list[RatingResponse]) -> float | None:
    values_by_evaluatee: dict[int, list[int]] = defaultdict(list)
    for item in items:
        values_by_evaluatee[item.evaluatee_id].append(item.value)
    if len(values_by_evaluatee) < MIN_AGGREGATE_EVALUATEES:
        return None
    return round(mean(mean(values) for values in values_by_evaluatee.values()), 2)


def average_by_evaluator(items: list[RatingResponse]) -> float | None:
    values_by_evaluator: dict[int, list[int]] = defaultdict(list)
    for item in items:
        values_by_evaluator[item.evaluator_id].append(item.value)
    if len(values_by_evaluator) < MIN_AGGREGATE_EVALUATEES:
        return None
    return round(mean(mean(values) for values in values_by_evaluator.values()), 2)


def average_for_perspective(items: list[RatingResponse], perspective: str) -> float | None:
    if perspective == "evaluator":
        return average_by_evaluator(items)
    return average_by_evaluatee(items)


def privacy_met(items: list[RatingResponse], perspective: str = "evaluatee") -> bool:
    if len({item.evaluatee_id for item in items}) < MIN_AGGREGATE_EVALUATEES:
        return False
    if perspective == "evaluator" and len({item.evaluator_id for item in items}) < MIN_AGGREGATE_EVALUATEES:
        return False
    return True


def individual_privacy_met(items: list[RatingResponse]) -> bool:
    return len({item.evaluator_id for item in items}) >= MIN_INDIVIDUAL_PEER_REVIEWERS


def average_by_reviewer(items: list[RatingResponse]) -> float | None:
    values_by_reviewer: dict[int, list[int]] = defaultdict(list)
    for item in items:
        values_by_reviewer[item.evaluator_id].append(item.value)
    if len(values_by_reviewer) == 0:
        return None
    return round(mean(mean(values) for values in values_by_reviewer.values()), 2)


def build_distribution_source(source_id: str, label: str, source_type: str, items: list[RatingResponse]) -> dict[str, Any]:
    first = items[0]
    counts = {rating: 0 for rating in range(first.scale_min, first.scale_max + 1)}
    for item in items:
        counts[item.value] += 1
    return {
        "id": source_id,
        "label": label,
        "source_type": source_type,
        "scale_min": first.scale_min,
        "scale_max": first.scale_max,
        "response_count": len(items),
        "buckets": [{"rating": rating, "count": count} for rating, count in counts.items()],
    }


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
    memberships = db.execute(models.user_company_groups.select()).fetchall()
    members_by_group: dict[int, set[int]] = defaultdict(set)
    groups_by_user: dict[int, set[int]] = defaultdict(set)
    for membership in memberships:
        members_by_group[membership.company_group_id].add(membership.user_id)
        groups_by_user[membership.user_id].add(membership.company_group_id)
    return members_by_group, groups_by_user


def users_by_id(db: Session) -> dict[int, Any]:
    rows = (
        db.query(models.User, models.CompanyRole)
        .join(models.CompanyRole, models.CompanyRole.id == models.User.company_role_id)
        .all()
    )
    return {user.id: (user, role) for user, role in rows}


def dimension_scores(items: list[RatingResponse], perspective: str = "evaluatee") -> list[dict[str, Any]]:
    scores = []
    for dimension_id, group_items in sorted(compatible_dimension_groups(items).items(), key=lambda pair: (pair[1][0].dimension_name or pair[0]).lower()):
        average = average_for_perspective(group_items, perspective)
        if average is None or not privacy_met(group_items, perspective):
            continue
        first = group_items[0]
        scores.append({
            "id": dimension_id,
            "name": first.dimension_name or dimension_id,
            "average_score": average,
            "response_count": len(group_items),
            "evaluatee_count": len({item.evaluatee_id for item in group_items}),
            "evaluator_count": len({item.evaluator_id for item in group_items}),
            "scale_min": first.scale_min,
            "scale_max": first.scale_max,
        })
    return scores


def distribution_sources(items: list[RatingResponse], perspective: str = "evaluatee") -> list[dict[str, Any]]:
    sources = []
    for dimension_id, group_items in sorted(compatible_dimension_groups(items).items(), key=lambda pair: (pair[1][0].dimension_name or pair[0]).lower()):
        if privacy_met(group_items, perspective):
            sources.append(build_distribution_source(f"dimension:{dimension_id}", group_items[0].dimension_name or dimension_id, "dimension", group_items))
    return sources


def report_notes() -> dict[str, str]:
    return {
        "completed_definition": "An evaluation is completed when finish_date is set or status is Completed/Submitted, matching Completion Status.",
        "answer_storage": "FilledForm.answers stores an array of {question_id, value}; immutable form_snapshot data is used for parsing when available.",
        "question_identity": "Questions are matched by their JSON id within the issued snapshot.",
        "historical_versions": "Reports use immutable FilledForm snapshots when present and fall back to the current Form only for legacy assignments without snapshots.",
        "dimension_policy": "Only scale questions with explicit dimension metadata and the same scale range/direction are aggregated by dimension.",
        "self_evaluation_policy": "Default performance analytics exclude self-evaluations where evaluator_id equals evaluatee_id.",
        "participant_deduplication": "Campaign employee counts deduplicate by stable user id.",
        "group_attribution": "Group summaries use FilledForm.company_group_id, the assignment attribution captured when the matrix is saved.",
        "confidentiality": f"Averages and distributions are suppressed unless at least {MIN_AGGREGATE_EVALUATEES} evaluated employees contribute; evaluator-role analytics also require at least {MIN_AGGREGATE_EVALUATEES} evaluators.",
        "role_history": "The current schema does not store role snapshots per FilledForm, so role analytics use the users' current company role.",
    }


def build_campaign_report_overview(campaign_id: int, requester_user_id: int, db: Session) -> dict[str, Any]:
    campaign = require_reports_access(campaign_id, requester_user_id, db)
    assert campaign is not None

    rows = campaign_report_rows(campaign.id, db)
    total = len({filled_form.id for filled_form, _, _ in rows})
    completed_rows = [row for row in rows if status_key(row[2], row[0].finish_date) == "completed"]
    completed = len({filled_form.id for filled_form, _, _ in completed_rows})
    peer_completed_rows = [row for row in completed_rows if row[0].evaluator_id != row[0].evaluatee_id]
    self_completed = len({row[0].id for row in completed_rows if row[0].evaluator_id == row[0].evaluatee_id})
    assigned_evaluatees = {row[0].evaluatee_id for row in rows}
    evaluated_by_peers = {row[0].evaluatee_id for row in peer_completed_rows}

    responses = rating_responses(rows, peer_only=True)
    dimensions_by_id = compatible_dimension_groups(responses)
    dimension_scores = []
    for dimension_id, items in sorted(dimensions_by_id.items(), key=lambda pair: (pair[1][0].dimension_name or pair[0]).lower()):
        average = average_by_evaluatee(items)
        if average is None:
            continue
        first = items[0]
        dimension_scores.append(
            {
                "id": dimension_id,
                "name": first.dimension_name or dimension_id,
                "average_score": average,
                "response_count": len(items),
                "evaluatee_count": len({item.evaluatee_id for item in items}),
                "scale_min": first.scale_min,
                "scale_max": first.scale_max,
            }
        )

    rating_sources = []
    for dimension_id, items in sorted(dimensions_by_id.items(), key=lambda pair: (pair[1][0].dimension_name or pair[0]).lower()):
        if len({item.evaluatee_id for item in items}) >= MIN_AGGREGATE_EVALUATEES:
            rating_sources.append(build_distribution_source(f"dimension:{dimension_id}", items[0].dimension_name or dimension_id, "dimension", items))

    question_groups: dict[tuple[int, str], list[RatingResponse]] = defaultdict(list)
    for response in responses:
        question_groups[(response.form_id, response.question_id)].append(response)
    for (form_id, question_id), items in sorted(question_groups.items(), key=lambda pair: pair[1][0].question_text.lower()):
        signatures = {(item.scale_min, item.scale_max, item.direction) for item in items}
        if len(signatures) == 1 and len({item.evaluatee_id for item in items}) >= MIN_AGGREGATE_EVALUATEES:
            rating_sources.append(build_distribution_source(f"question:{form_id}:{question_id}", items[0].question_text, "question", items))

    all_dimension_items = [item for items in dimensions_by_id.values() for item in items]
    overall_score = None
    overall_scale = None
    if all_dimension_items and len({(item.scale_min, item.scale_max, item.direction) for item in all_dimension_items}) == 1:
        overall_score = average_by_evaluatee(all_dimension_items)
        if overall_score is not None:
            first = all_dimension_items[0]
            overall_scale = f"{first.scale_min}-{first.scale_max}"

    assigned_group_rows = db.execute(
        models.campaign_company_groups.select().where(models.campaign_company_groups.c.campaign_id == campaign.id)
    ).fetchall()
    assigned_group_ids = [row.company_group_id for row in assigned_group_rows]
    groups = db.query(models.CompanyGroup).filter(models.CompanyGroup.id.in_(assigned_group_ids)).order_by(models.CompanyGroup.name.asc()).all() if assigned_group_ids else []
    memberships = db.execute(models.user_company_groups.select()).fetchall()
    members_by_group: dict[int, set[int]] = defaultdict(set)
    for membership in memberships:
        members_by_group[membership.company_group_id].add(membership.user_id)

    group_summaries = []
    for group in groups:
        group_rows = [row for row in rows if row[0].company_group_id == group.id]
        group_completed_rows = [row for row in group_rows if status_key(row[2], row[0].finish_date) == "completed"]
        group_items = [item for item in all_dimension_items if item.company_group_id == group.id]
        group_average = average_by_evaluatee(group_items) if group_items else None
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
                "average_score_context": "Peer feedback, evaluatee-balanced across configured dimensions" if group_average is not None else "Not available",
            }
        )

    configured_self = db.query(func.count(models.CampaignEmployeeSelfEvaluation.employee_id)).filter(models.CampaignEmployeeSelfEvaluation.campaign_id == campaign.id).scalar() or 0

    return {
        "campaign": {"id": campaign.id, "name": campaign.name, "start_date": campaign.start_date, "end_date": campaign.end_date, "is_active": campaign.is_active},
        "kpis": {
            "total_evaluations": total,
            "completed_evaluations": completed,
            "completion_rate": round((completed / total) * 100) if total > 0 else 0,
            "submitted_evaluations": completed,
            "employees_evaluated": len(evaluated_by_peers),
            "overall_score": overall_score,
            "overall_score_label": f"{overall_score:.2f}" if overall_score is not None else "Not available",
            "overall_score_context": "Peer feedback, evaluatee-balanced across configured dimensions" if overall_score is not None else "No comparable rating data",
            "overall_score_scale": overall_scale,
        },
        "dimensions": dimension_scores,
        "rating_distribution_sources": rating_sources,
        "groups": group_summaries,
        "employees": {
            "participating_employees": len(assigned_evaluatees),
            "employees_with_completed_peer_feedback": len(evaluated_by_peers),
            "employees_awaiting_peer_feedback": len(assigned_evaluatees - evaluated_by_peers),
            "configured_self_evaluations": configured_self,
            "completed_self_evaluations": self_completed,
        },
        "notes": {
            "completed_definition": "An evaluation is completed when finish_date is set or status is Completed/Submitted, matching Completion Status.",
            "answer_storage": "FilledForm.answers stores an array of {question_id, value}; Form.questions stores the question definitions used for parsing.",
            "question_identity": "Questions are matched by their JSON id within each Form. IDs are cloned from templates and remain stable only while a Form question is not replaced by editing.",
            "historical_versions": "Reports use immutable FilledForm snapshots when present and fall back to the current Form only for legacy assignments without snapshots.",
            "dimension_policy": "Only scale questions with explicit dimension metadata and the same scale range/direction are aggregated by dimension.",
            "self_evaluation_policy": "Default performance analytics exclude self-evaluations where evaluator_id equals evaluatee_id.",
            "participant_deduplication": "Campaign employee counts deduplicate by stable user id.",
            "group_attribution": "Group summaries use FilledForm.company_group_id, the assignment attribution captured when the matrix is saved.",
            "confidentiality": f"Averages and distributions are suppressed unless at least {MIN_AGGREGATE_EVALUATEES} evaluated employees contribute.",
        },
    }


def build_groups_overview(campaign_id: int, requester_user_id: int, db: Session) -> dict[str, Any]:
    campaign = require_reports_access(campaign_id, requester_user_id, db)
    assert campaign is not None
    rows = campaign_report_rows(campaign.id, db)
    completed_rows = [row for row in rows if status_key(row[2], row[0].finish_date) == "completed"]
    groups = assigned_campaign_groups(campaign.id, db)
    members_by_group, _ = membership_maps(db)
    responses = rating_responses(rows, peer_only=True)
    compatible_items = [item for items in compatible_dimension_groups(responses).values() for item in items]
    participating = set()
    reportable_groups = 0
    group_summaries = []
    for group in groups:
        participating.update(members_by_group[group.id])
        group_rows = [row for row in rows if row[0].company_group_id == group.id]
        group_completed_rows = [row for row in completed_rows if row[0].company_group_id == group.id]
        group_items = [item for item in compatible_items if item.company_group_id == group.id]
        average = average_by_evaluatee(group_items) if group_items else None
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
            "average_score_context": "Peer feedback, evaluatee-balanced across configured dimensions" if average is not None else "Not available",
        })
    return {
        "campaign": {"id": campaign.id, "name": campaign.name, "start_date": campaign.start_date, "end_date": campaign.end_date, "is_active": campaign.is_active},
        "kpis": {
            "groups_in_campaign": len(groups),
            "participating_employees": len(participating),
            "completed_evaluations": len({row[0].id for row in completed_rows}),
            "groups_with_reportable_results": reportable_groups,
        },
        "groups": group_summaries,
        "notes": report_notes(),
    }


def build_group_detail(campaign_id: int, group_id: int, requester_user_id: int, db: Session) -> dict[str, Any]:
    overview = build_groups_overview(campaign_id, requester_user_id, db)
    group_summary = next((group for group in overview["groups"] if group["group_id"] == group_id), None)
    if group_summary is None:
        raise HTTPException(status_code=404, detail="Group report not found")
    rows = campaign_report_rows(campaign_id, db)
    group_rows = [row for row in rows if row[0].company_group_id == group_id]
    completed_rows = [row for row in group_rows if status_key(row[2], row[0].finish_date) == "completed"]
    group_responses = rating_responses(group_rows, peer_only=True)
    all_responses = rating_responses(rows, peer_only=True)
    group_dimensions = dimension_scores(group_responses)
    campaign_dimensions_by_id = {dimension["id"]: dimension for dimension in dimension_scores(all_responses)}
    for dimension in group_dimensions:
        campaign_dimension = campaign_dimensions_by_id.get(dimension["id"])
        dimension["campaign_average_score"] = campaign_dimension["average_score"] if campaign_dimension and campaign_dimension["scale_min"] == dimension["scale_min"] and campaign_dimension["scale_max"] == dimension["scale_max"] else None
    members_by_group, _ = membership_maps(db)
    users = users_by_id(db)
    member_ids = members_by_group[group_id]
    role_counts: dict[int, dict[str, Any]] = {}
    for user_id in member_ids:
        user_role = users.get(user_id)
        if user_role is None:
            continue
        _, role = user_role
        item = role_counts.setdefault(role.id, {"role_id": role.id, "role_name": role.name, "employee_count": 0, "completed_evaluations_received": 0, "average_score": None})
        item["employee_count"] += 1
    compatible_items = [item for items in compatible_dimension_groups(group_responses).values() for item in items]
    for role_item in role_counts.values():
        role_member_ids = {user_id for user_id in member_ids if users.get(user_id) and users[user_id][1].id == role_item["role_id"]}
        role_rows = [row for row in completed_rows if row[0].evaluatee_id in role_member_ids]
        role_item["completed_evaluations_received"] = len({row[0].id for row in role_rows})
        role_score_items = [item for item in compatible_items if item.evaluatee_id in role_member_ids]
        role_item["average_score"] = average_by_evaluatee(role_score_items) if role_score_items else None
    employees = []
    for user_id in sorted(member_ids, key=lambda item: users.get(item)[0].username.lower() if users.get(item) else ""):
        user_role = users.get(user_id)
        if user_role is None:
            continue
        user, role = user_role
        received = [row for row in completed_rows if row[0].evaluatee_id == user.id and row[0].evaluator_id != user.id]
        self_completed = any(row[0].evaluatee_id == user.id and row[0].evaluator_id == user.id for row in completed_rows)
        employees.append({
            "employee_id": user.id,
            "employee_name": user.username,
            "role_name": role.name,
            "reviews_received": len({row[0].id for row in received}),
            "completed_self_evaluation": self_completed,
            "feedback_availability": "Available" if len(received) > 0 else "No submitted peer feedback",
        })
    return {
        "campaign": overview["campaign"],
        "group": {"id": group_summary["group_id"], "name": group_summary["group_name"], "description": group_summary["description"]},
        "kpis": {
            "employees": group_summary["employee_count"],
            "completed_evaluations": group_summary["completed_evaluations"],
            "completion_rate": group_summary["completion_rate"],
            "reportable_dimensions": len(group_dimensions),
        },
        "dimensions": group_dimensions,
        "rating_distribution_sources": distribution_sources(group_responses),
        "roles": sorted(role_counts.values(), key=lambda item: item["role_name"].lower()),
        "employees": employees,
        "notes": overview["notes"],
    }


def normalize_perspective(perspective: str) -> str:
    return "evaluator" if perspective == "evaluator" else "evaluatee"


def build_roles_overview(campaign_id: int, requester_user_id: int, db: Session, perspective: str = "evaluatee") -> dict[str, Any]:
    campaign = require_reports_access(campaign_id, requester_user_id, db)
    assert campaign is not None
    perspective = normalize_perspective(perspective)
    rows = campaign_report_rows(campaign.id, db)
    responses = rating_responses(rows, peer_only=True)
    users = users_by_id(db)
    roles = db.query(models.CompanyRole).order_by(models.CompanyRole.name.asc()).all()
    role_summaries = []
    dimension_candidate: dict[str, list[dict[str, Any]]] = defaultdict(list)
    participating_employees: set[int] = set()
    for role in roles:
        employee_ids = {user_id for user_id, (_, user_role) in users.items() if user_role.id == role.id}
        if perspective == "evaluator":
            role_rows = [row for row in rows if row[0].evaluator_id in employee_ids and row[0].evaluator_id != row[0].evaluatee_id]
            role_responses = [item for item in responses if item.evaluator_id in employee_ids]
            participating_employees.update(row[0].evaluator_id for row in role_rows)
        else:
            role_rows = [row for row in rows if row[0].evaluatee_id in employee_ids and row[0].evaluator_id != row[0].evaluatee_id]
            role_responses = [item for item in responses if item.evaluatee_id in employee_ids]
            participating_employees.update(row[0].evaluatee_id for row in role_rows)
        completed = [row for row in role_rows if status_key(row[2], row[0].finish_date) == "completed"]
        dims = dimension_scores(role_responses, perspective)
        compatible_items = [item for items in compatible_dimension_groups(role_responses).values() for item in items]
        average = average_for_perspective(compatible_items, perspective) if compatible_items else None
        for dim in dims:
            dimension_candidate[dim["id"]].append({"role_id": role.id, "role_name": role.name, "average_score": dim["average_score"], "response_count": dim["response_count"], "scale_min": dim["scale_min"], "scale_max": dim["scale_max"], "dimension_name": dim["name"]})
        if employee_ids or role_rows:
            role_summaries.append({
                "role_id": role.id,
                "role_name": role.name,
                "employee_count": len(employee_ids),
                "completed_evaluations": len({row[0].id for row in completed}),
                "available_dimensions": len(dims),
                "average_score": average,
                "average_score_context": ("Average ratings given by this role" if perspective == "evaluator" else "Average ratings received by this role") if average is not None else "Not available",
            })
    comparison = next(({"dimension_id": dimension_id, "dimension_name": items[0]["dimension_name"], "roles": items} for dimension_id, items in dimension_candidate.items() if len(items) >= 2), None)
    return {
        "campaign": {"id": campaign.id, "name": campaign.name, "start_date": campaign.start_date, "end_date": campaign.end_date, "is_active": campaign.is_active},
        "perspective": perspective,
        "kpis": {"roles_in_campaign": len(role_summaries), "participating_employees": len(participating_employees), "completed_evaluations": sum(item["completed_evaluations"] for item in role_summaries), "roles_with_reportable_results": sum(1 for item in role_summaries if item["average_score"] is not None)},
        "roles": role_summaries,
        "dimension_comparison": comparison,
        "notes": report_notes(),
    }


def build_role_detail(campaign_id: int, role_id: int, requester_user_id: int, db: Session, perspective: str = "evaluatee") -> dict[str, Any]:
    overview = build_roles_overview(campaign_id, requester_user_id, db, perspective)
    role_summary = next((role for role in overview["roles"] if role["role_id"] == role_id), None)
    if role_summary is None:
        raise HTTPException(status_code=404, detail="Role report not found")
    perspective = overview["perspective"]
    rows = campaign_report_rows(campaign_id, db)
    users = users_by_id(db)
    role_employee_ids = {user_id for user_id, (_, role) in users.items() if role.id == role_id}
    if perspective == "evaluator":
        role_rows = [row for row in rows if row[0].evaluator_id in role_employee_ids and row[0].evaluator_id != row[0].evaluatee_id]
        role_responses = [item for item in rating_responses(rows, peer_only=True) if item.evaluator_id in role_employee_ids]
    else:
        role_rows = [row for row in rows if row[0].evaluatee_id in role_employee_ids and row[0].evaluator_id != row[0].evaluatee_id]
        role_responses = [item for item in rating_responses(rows, peer_only=True) if item.evaluatee_id in role_employee_ids]
    groups = assigned_campaign_groups(campaign_id, db)
    members_by_group, _ = membership_maps(db)
    group_breakdown = []
    for group in groups:
        group_employee_ids = members_by_group[group.id] & role_employee_ids
        group_rows = [row for row in role_rows if row[0].company_group_id == group.id]
        group_items = [item for item in role_responses if item.company_group_id == group.id]
        group_breakdown.append({"group_id": group.id, "group_name": group.name, "employee_count": len(group_employee_ids), "completed_evaluations": len({row[0].id for row in group_rows if status_key(row[2], row[0].finish_date) == "completed"}), "average_score": average_for_perspective(group_items, perspective) if group_items else None})
    dimensions = dimension_scores(role_responses, perspective)
    return {
        "campaign": overview["campaign"],
        "role": {"id": role_summary["role_id"], "name": role_summary["role_name"]},
        "perspective": perspective,
        "kpis": {
            "employees": role_summary["employee_count"],
            "completed_evaluations": role_summary["completed_evaluations"],
            "reportable_dimensions": len(dimensions),
            "overall_score": role_summary["average_score"],
        },
        "dimensions": dimensions,
        "rating_distribution_sources": distribution_sources(role_responses, perspective),
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


def employee_dimension_stats(items: list[RatingResponse], suppress: bool = True) -> list[dict[str, Any]]:
    results = []
    for dimension_id, group_items in sorted(compatible_dimension_groups(items).items(), key=lambda pair: (pair[1][0].dimension_name or pair[0]).lower()):
        first = group_items[0]
        suppressed = suppress and not individual_privacy_met(group_items)
        average = None if suppressed else average_by_reviewer(group_items)
        results.append({
            "id": dimension_id,
            "name": first.dimension_name or dimension_id,
            "average_score": average,
            "suppressed": suppressed,
            "response_count": 0 if suppressed else len(group_items),
            "evaluator_count": 0 if suppressed else len({item.evaluator_id for item in group_items}),
            "scale_min": first.scale_min,
            "scale_max": first.scale_max,
            "direction": first.direction,
        })
    return results


def self_dimension_stats(items: list[RatingResponse]) -> list[dict[str, Any]]:
    results = []
    for dimension_id, group_items in sorted(compatible_dimension_groups(items).items(), key=lambda pair: (pair[1][0].dimension_name or pair[0]).lower()):
        first = group_items[0]
        results.append({
            "id": dimension_id,
            "name": first.dimension_name or dimension_id,
            "average_score": round(mean(item.value for item in group_items), 2),
            "response_count": len(group_items),
            "scale_min": first.scale_min,
            "scale_max": first.scale_max,
            "direction": first.direction,
        })
    return results


def campaign_participant_ids(campaign_id: int, rows: list[Any], db: Session) -> set[int]:
    groups = assigned_campaign_groups(campaign_id, db)
    members_by_group, _ = membership_maps(db)
    participant_ids = {row[0].evaluatee_id for row in rows}
    for group in groups:
        participant_ids.update(members_by_group[group.id])
    return participant_ids


def employee_base_context(campaign_id: int, rows: list[Any], db: Session) -> tuple[dict[int, Any], dict[int, list[str]], set[int]]:
    users = users_by_id(db)
    groups = assigned_campaign_groups(campaign_id, db)
    members_by_group, groups_by_user = membership_maps(db)
    group_names_by_id = {group.id: group.name for group in groups}
    group_names_by_user: dict[int, list[str]] = defaultdict(list)
    for user_id, group_ids in groups_by_user.items():
        for group_id in sorted(group_ids):
            if group_id in group_names_by_id:
                group_names_by_user[user_id].append(group_names_by_id[group_id])
    participant_ids = {row[0].evaluatee_id for row in rows}
    for group in groups:
        participant_ids.update(members_by_group[group.id])
    return users, group_names_by_user, participant_ids


def employee_score_summary(peer_items: list[RatingResponse]) -> dict[str, Any]:
    compatible_items = [item for items in compatible_dimension_groups(peer_items).values() for item in items]
    if not compatible_items or not individual_privacy_met(compatible_items):
        return {"average_score": None, "scale_min": None, "scale_max": None, "suppressed": bool(compatible_items)}
    signatures = {(item.scale_min, item.scale_max, item.direction) for item in compatible_items}
    if len(signatures) != 1:
        return {"average_score": None, "scale_min": None, "scale_max": None, "suppressed": False}
    first = compatible_items[0]
    return {"average_score": average_by_reviewer(compatible_items), "scale_min": first.scale_min, "scale_max": first.scale_max, "suppressed": False}


def employee_dimension_availability(peer_rows: list[Any], peer_items: list[RatingResponse]) -> str:
    if not peer_rows:
        return "no_assignments"
    completed_rows = [row for row in peer_rows if status_key(row[2], row[0].finish_date) == "completed"]
    if not completed_rows:
        return "not_submitted"
    has_configured_dimensions = any(
        dimension_metadata(question)[0] is not None and scale_for_question(question) is not None
        for row in completed_rows
        for question in form_snapshot_service.snapshot_questions(row[0], row[1])
        if isinstance(question, dict)
    )
    if not has_configured_dimensions:
        return "no_dimensions"
    compatible = [item for group in compatible_dimension_groups(peer_items).values() for item in group]
    if not compatible:
        return "no_compatible_responses"
    if not individual_privacy_met(compatible):
        return "suppressed"
    return "available"


def build_employee_reports_overview(campaign_id: int, requester_user_id: int, db: Session) -> dict[str, Any]:
    campaign = require_reports_access(campaign_id, requester_user_id, db)
    assert campaign is not None
    rows = campaign_report_rows(campaign.id, db)
    users, group_names_by_user, participant_ids = employee_base_context(campaign.id, rows, db)
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
    responses = rating_responses(rows, peer_only=True)
    responses_by_employee: dict[int, list[RatingResponse]] = defaultdict(list)
    for response in responses:
        responses_by_employee[response.evaluatee_id].append(response)
    employees = []
    for employee_id in sorted(participant_ids, key=lambda item: users.get(item)[0].username.lower() if users.get(item) else ""):
        user_role = users.get(employee_id)
        if user_role is None:
            continue
        user, role = user_role
        assigned = len({row[0].id for row in peer_assigned_by_employee[employee_id]})
        completed = len({row[0].id for row in peer_completed_by_employee[employee_id]})
        employees.append({
            "employee_id": user.id,
            "employee_name": user.username,
            "email": user.email,
            "company_role": role.name,
            "groups": group_names_by_user.get(user.id, []),
            "peer_assigned": assigned,
            "peer_completed": completed,
            "self_evaluation": self_evaluation_status(rows, user.id),
            "performance_summary": employee_score_summary(responses_by_employee[user.id]),
        })
    configured_self = sum(item["self_evaluation"]["assigned"] for item in employees)
    completed_self = sum(item["self_evaluation"]["completed"] for item in employees)
    with_peer_feedback = len({row[0].evaluatee_id for row in completed_peer_rows})
    awaiting_peer = len({employee["employee_id"] for employee in employees if employee["peer_assigned"] > 0 and employee["peer_completed"] == 0})
    return {
        "campaign": {"id": campaign.id, "name": campaign.name, "start_date": campaign.start_date, "end_date": campaign.end_date, "is_active": campaign.is_active},
        "kpis": {
            "participating_employees": len(employees),
            "employees_with_peer_feedback": with_peer_feedback,
            "awaiting_peer_feedback": awaiting_peer,
            "completed_self_evaluations": completed_self,
            "assigned_self_evaluations": configured_self,
        },
        "employees": employees,
        "notes": {**report_notes(), "employee_participation": "Employee reports include assigned campaign evaluatees and members of groups assigned to the campaign, deduplicated by user id.", "individual_privacy": f"Individual peer scores are suppressed unless at least {MIN_INDIVIDUAL_PEER_REVIEWERS} distinct peer evaluators contributed."},
    }


def build_self_peer_comparison(peer_dimensions: list[dict[str, Any]], self_dimensions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    self_by_signature = {
        (item["id"], item["scale_min"], item["scale_max"], item["direction"]): item
        for item in self_dimensions
    }
    comparisons = []
    for peer in peer_dimensions:
        if peer.get("suppressed") or peer.get("average_score") is None:
            continue
        self_item = self_by_signature.get((peer["id"], peer["scale_min"], peer["scale_max"], peer["direction"]))
        if self_item is None:
            continue
        comparisons.append({
            "dimension_id": peer["id"],
            "dimension_name": peer["name"],
            "peer_average": peer["average_score"],
            "self_average": self_item["average_score"],
            "difference": round(self_item["average_score"] - peer["average_score"], 2),
            "scale_min": peer["scale_min"],
            "scale_max": peer["scale_max"],
        })
    return comparisons


def build_employee_history(employee_id: int, requester_user_id: int, db: Session) -> list[dict[str, Any]]:
    campaigns = db.query(models.Campaign).order_by(models.Campaign.start_date.asc(), models.Campaign.id.asc()).all()
    points_by_dimension: dict[tuple[str, int, int, str], dict[str, Any]] = {}
    for campaign in campaigns:
        try:
            require_reports_access(campaign.id, requester_user_id, db)
        except HTTPException:
            continue
        rows = campaign_report_rows(campaign.id, db)
        employee_items = [item for item in rating_responses(rows, peer_only=True) if item.evaluatee_id == employee_id]
        for stat in employee_dimension_stats(employee_items, suppress=True):
            if stat["suppressed"] or stat["average_score"] is None:
                continue
            key = (stat["id"], stat["scale_min"], stat["scale_max"], stat["direction"])
            series = points_by_dimension.setdefault(key, {"dimension_id": stat["id"], "dimension_name": stat["name"], "scale_min": stat["scale_min"], "scale_max": stat["scale_max"], "points": []})
            series["points"].append({"campaign_id": campaign.id, "campaign_name": campaign.name, "campaign_start_date": campaign.start_date, "average_score": stat["average_score"], "response_count": stat["response_count"], "evaluator_count": stat["evaluator_count"]})
    return [series for series in points_by_dimension.values() if len(series["points"]) >= 2]


def build_employee_report_detail(campaign_id: int, employee_id: int, requester_user_id: int, db: Session) -> dict[str, Any]:
    campaign = require_reports_access(campaign_id, requester_user_id, db)
    assert campaign is not None
    rows = campaign_report_rows(campaign.id, db)
    users, group_names_by_user, participant_ids = employee_base_context(campaign.id, rows, db)
    user_role = users.get(employee_id)
    if user_role is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    if employee_id not in participant_ids:
        raise HTTPException(status_code=404, detail="Employee is not part of this campaign report")
    user, role = user_role
    peer_rows = [row for row in rows if row[0].evaluatee_id == employee_id and row[0].evaluator_id != employee_id]
    peer_completed_rows = [row for row in peer_rows if status_key(row[2], row[0].finish_date) == "completed"]
    self_rows = [row for row in rows if row[0].evaluatee_id == employee_id and row[0].evaluator_id == employee_id]
    peer_items = [item for item in rating_responses(rows, peer_only=True) if item.evaluatee_id == employee_id]
    self_items = [item for item in rating_responses(self_rows, peer_only=False) if item.evaluatee_id == employee_id and item.evaluator_id == employee_id]
    peer_dimensions = employee_dimension_stats(peer_items, suppress=True)
    self_dimensions = self_dimension_stats(self_items)
    self_status = self_evaluation_status(rows, employee_id)
    return {
        "campaign": {"id": campaign.id, "name": campaign.name, "start_date": campaign.start_date, "end_date": campaign.end_date, "is_active": campaign.is_active},
        "employee": {"id": user.id, "name": user.username, "email": user.email, "company_role": role.name, "groups": group_names_by_user.get(user.id, [])},
        "kpis": {
            "peer_reviews_received": len({row[0].id for row in peer_completed_rows}),
            "peer_reviews_assigned": len({row[0].id for row in peer_rows}),
            "peer_completion_rate": round((len({row[0].id for row in peer_completed_rows}) / len({row[0].id for row in peer_rows})) * 100) if peer_rows else None,
            "self_evaluation_status": self_status["status"],
            "reportable_dimensions": len([item for item in peer_dimensions if not item["suppressed"] and item["average_score"] is not None]),
        },
        "dimensions": peer_dimensions,
        "dimension_availability": employee_dimension_availability(peer_rows, peer_items),
        "self_peer_comparison": build_self_peer_comparison(peer_dimensions, self_dimensions),
        "coverage": {"peer_assigned": len({row[0].id for row in peer_rows}), "peer_completed": len({row[0].id for row in peer_completed_rows}), "peer_outstanding": max(0, len({row[0].id for row in peer_rows}) - len({row[0].id for row in peer_completed_rows})), "self_evaluation": self_status, "campaign_end_date": campaign.end_date},
        "history": build_employee_history(employee_id, requester_user_id, db),
        "notes": {**report_notes(), "individual_privacy": f"Individual peer scores are reviewer-balanced and suppressed unless at least {MIN_INDIVIDUAL_PEER_REVIEWERS} distinct peer evaluators contributed.", "raw_feedback": "Raw written feedback and reviewer identities are not returned by Employee Reports."},
    }

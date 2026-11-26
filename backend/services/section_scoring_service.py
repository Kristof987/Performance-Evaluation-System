"""Internal schema-v2 Section scoring. API callers must use Reports authorization.

Only released ScoreResult values may be sent to a client; evaluator-level scores
and unsuppressed employee means are intermediate calculations, not API payloads.
"""

from collections import defaultdict
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from statistics import mean
from typing import Literal

import models
from services import reporting_service

Availability = Literal["available", "no_data", "suppressed"]


@dataclass(frozen=True)
class EvaluationSections:
    assignment_id: int
    campaign_id: int
    evaluator_id: int
    evaluatee_id: int
    company_group_id: int | None
    finish_date: date | None
    section_ids: frozenset[int]
    sections: dict[int, float]
    # The evaluated employee's company role frozen at issuance; None falls back to the current role.
    evaluatee_role_id: int | None = None


def role_of(evaluation: "EvaluationSections", current_roles: Mapping[int, int]) -> int | None:
    if evaluation.evaluatee_role_id is not None:
        return evaluation.evaluatee_role_id
    return current_roles.get(evaluation.evaluatee_id)


@dataclass(frozen=True)
class ScoreResult:
    """Contributor count is reviewers/employees per Section, reportable Sections for Overall."""
    score: float | None
    availability: Availability
    contributor_count: int = 0


@dataclass(frozen=True)
class EmployeeScores:
    evaluatee_id: int
    peer_sections: dict[int, ScoreResult]
    self_sections: dict[int, ScoreResult]
    overall_peer: ScoreResult
    overall_self: ScoreResult


@dataclass(frozen=True)
class AggregateScores:
    sections: dict[int, ScoreResult]
    overall: ScoreResult


def normalize_rating(answer: int, scale_min: int, scale_max: int) -> float | None:
    """Map a rating inside its issued range to the inclusive 1-5 performance scale."""
    if not scale_min <= answer <= scale_max:
        return None
    return 1 + 4 * (answer - scale_min) / (scale_max - scale_min)


def rating_range(question: dict) -> tuple[int, int] | None:
    """An issued Scale question always carries integer limits; other types have none."""
    return (question["scale_min"], question["scale_max"]) if question.get("type") == "Scale" else None


def iter_snapshot_sections(snapshot: dict | None):
    """Yield (stable Section ID, nested questions) in issued block order; unissued records have none."""
    # Pre-v2 list snapshots were kept as schema_version 1 and never contribute Section scores.
    for block in snapshot["questions"] if snapshot and snapshot.get("schema_version") == 2 else []:
        if block.get("type") == "section":
            yield block["section_id"], block["questions"]


def snapshot_section_ids(snapshot: object) -> frozenset[int]:
    return frozenset(section_id for section_id, _questions in iter_snapshot_sections(snapshot))


def score_evaluation(assignment: models.FilledForm) -> EvaluationSections | None:
    """A draft has no Section score; answers were validated against the issued snapshot when saved."""
    if assignment.finish_date is None:
        return None
    blocks = list(iter_snapshot_sections(assignment.form_snapshot))
    values = {answer["question_id"]: answer["value"] for answer in assignment.answers} if blocks else {}
    by_section: dict[int, list[float]] = defaultdict(list)
    for section_id, questions in blocks:
        for question in questions:
            bounds, value = rating_range(question), values.get(question["id"])
            if bounds is not None and value is not None and (rating := normalize_rating(value, *bounds)) is not None:
                by_section[section_id].append(rating)
    return EvaluationSections(
        assignment.id, assignment.campaign_id, assignment.evaluator_id, assignment.evaluatee_id,
        assignment.company_group_id, assignment.finish_date, snapshot_section_ids(assignment.form_snapshot),
        {section_id: mean(ratings) for section_id, ratings in by_section.items()},
        assignment.evaluatee_company_role_id,
    )


def _reviewer_sections(evaluations: Sequence[EvaluationSections], evaluatee_id: int) -> tuple[dict[int, dict[int, float]], dict[int, dict[int, float]]]:
    """Per Section, each reviewer's score of the employee: peers apart from the self-evaluation."""
    peer: dict[int, dict[int, float]] = defaultdict(dict)
    self_scores: dict[int, dict[int, float]] = defaultdict(dict)
    for evaluation in evaluations:
        if evaluation.evaluatee_id == evaluatee_id:
            target = self_scores if evaluation.evaluator_id == evaluatee_id else peer
            for section_id, value in evaluation.sections.items():
                target[section_id][evaluation.evaluator_id] = value
    return peer, self_scores


def _release(value: float | None, count: int, minimum: int) -> ScoreResult:
    if value is None:
        return ScoreResult(None, "no_data")
    if count < minimum:
        return ScoreResult(None, "suppressed")
    return ScoreResult(value, "available", count)


def _overall(sections: Mapping[int, ScoreResult]) -> ScoreResult:
    available = [result.score for result in sections.values() if result.availability == "available" and result.score is not None]
    if available:
        return ScoreResult(mean(available), "available", len(available))
    return ScoreResult(None, "suppressed" if any(result.availability == "suppressed" for result in sections.values()) else "no_data")


def _section_results(section_ids: set[int], values: Mapping[int, Collection[float]], minimum: int) -> dict[int, ScoreResult]:
    results = {}
    for section_id in section_ids:
        scores = values.get(section_id)
        results[section_id] = _release(mean(scores), len(scores), minimum) if scores else _release(None, 0, minimum)
    return results


def employee_scores(evaluations: Sequence[EvaluationSections], campaign_id: int, evaluatee_id: int, *, aggregate_access: bool = False) -> EmployeeScores:
    scoped = [evaluation for evaluation in evaluations if evaluation.campaign_id == campaign_id and evaluation.evaluatee_id == evaluatee_id]
    section_ids = set().union(*(evaluation.section_ids for evaluation in scoped)) if scoped else set()
    peer, self_values = _reviewer_sections(scoped, evaluatee_id)
    peer_sections = _section_results(section_ids, {section_id: list(reviewers.values()) for section_id, reviewers in peer.items()}, 1 if aggregate_access else reporting_service.min_individual_peer_reviewers())
    self_sections = _section_results(section_ids, {section_id: list(reviewers.values()) for section_id, reviewers in self_values.items()}, 1)
    return EmployeeScores(evaluatee_id, peer_sections, self_sections, _overall(peer_sections), _overall(self_sections))


def _aggregate(evaluations: Sequence[EvaluationSections], minimum_evaluatees: int, *, aggregate_access: bool = False) -> AggregateScores:
    values: dict[int, list[float]] = defaultdict(list)
    unsafe_sections: set[int] = set()
    section_ids = set().union(*(evaluation.section_ids for evaluation in evaluations)) if evaluations else set()
    for evaluatee_id in {evaluation.evaluatee_id for evaluation in evaluations}:
        peer, _self = _reviewer_sections(evaluations, evaluatee_id)
        for section_id, reviewers in peer.items():
            values[section_id].append(mean(reviewers.values()))
            # An aggregate and all other employee scores could otherwise recover
            # an individual Section score withheld for having only one reviewer.
            if not aggregate_access and len(reviewers) < reporting_service.min_individual_peer_reviewers():
                unsafe_sections.add(section_id)
    sections = _section_results(section_ids, values, minimum_evaluatees)
    sections = {section_id: ScoreResult(None, "suppressed") if section_id in unsafe_sections and result.availability == "available" else result
                for section_id, result in sections.items()}
    return AggregateScores(sections, _overall(sections))


def campaign_scores(evaluations: Sequence[EvaluationSections], campaign_id: int, *, aggregate_access: bool = False) -> AggregateScores:
    return _aggregate([evaluation for evaluation in evaluations if evaluation.campaign_id == campaign_id], 1 if aggregate_access else reporting_service.min_aggregate_evaluatees(), aggregate_access=aggregate_access)


def _cohort_scores(evaluations: Sequence[EvaluationSections], campaign_id: int, key, *, aggregate_access: bool) -> dict[int, AggregateScores]:
    scoped = [evaluation for evaluation in evaluations if evaluation.campaign_id == campaign_id]
    results = {}
    for cohort_id in {cohort_id for evaluation in scoped if (cohort_id := key(evaluation)) is not None}:
        cohort = [evaluation for evaluation in scoped if key(evaluation) == cohort_id]
        if aggregate_access:
            results[cohort_id] = _aggregate(cohort, 1, aggregate_access=True)
        else:
            results[cohort_id] = suppress_small_complements(
                _aggregate(cohort, reporting_service.min_aggregate_evaluatees()), scoped, cohort)
    return results


def group_scores(evaluations: Sequence[EvaluationSections], campaign_id: int, *, aggregate_access: bool = False) -> dict[int, AggregateScores]:
    """Attribute evaluations to their recorded assignment group, not current memberships."""
    return _cohort_scores(evaluations, campaign_id, lambda evaluation: evaluation.company_group_id, aggregate_access=aggregate_access)


def role_scores(evaluations: Sequence[EvaluationSections], campaign_id: int, evaluatee_roles: Mapping[int, int], *, aggregate_access: bool = False) -> dict[int, AggregateScores]:
    """Use the evaluated employee's company role, never the evaluator's role."""
    return _cohort_scores(evaluations, campaign_id, lambda evaluation: role_of(evaluation, evaluatee_roles), aggregate_access=aggregate_access)


def suppress_small_complements(aggregate: AggregateScores, population: Sequence[EvaluationSections], cohort: Sequence[EvaluationSections]) -> AggregateScores:
    """Withhold a cohort's Section when the campaign outside it has fewer than the minimum evaluatees.

    Group leaders see the campaign average next to their groups; campaign minus cohort would
    otherwise reveal the few people left outside.
    """
    sections = dict(aggregate.sections)
    included_assignments = {item.assignment_id for item in cohort}
    for section_id, result in sections.items():
        if result.availability != "available":
            continue
        remaining = len({item.evaluatee_id for item in population if item.assignment_id not in included_assignments
                         and item.evaluator_id != item.evaluatee_id and section_id in item.sections})
        if 0 < remaining < reporting_service.min_aggregate_evaluatees():
            sections[section_id] = ScoreResult(None, "suppressed")
    return AggregateScores(sections, _overall(sections))

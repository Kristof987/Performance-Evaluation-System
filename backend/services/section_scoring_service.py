"""Internal schema-v2 Section scoring. API callers must use Reports authorization.

Only released ScoreResult values may be sent to a client; evaluator-level scores
and unsuppressed employee means are intermediate calculations, not API payloads.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from math import isfinite
from statistics import mean
from typing import Collection, Literal, Mapping, Sequence


import models
from services import reporting_service


RATING_TYPES = {"Scale"}
Availability = Literal["available", "no_data", "suppressed"]


@dataclass(frozen=True)
class SectionRating:
    section_id: int
    question_id: str
    normalized: float


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


def normalize_rating(answer: int | float, scale_min: int, scale_max: int) -> float | None:
    """Map a valid issued rating range to the inclusive 1-5 performance scale."""
    if (isinstance(answer, bool) or not isinstance(answer, (int, float))
            or isinstance(answer, float) and not isfinite(answer)
            or isinstance(scale_min, bool) or not isinstance(scale_min, int)
            or isinstance(scale_max, bool) or not isinstance(scale_max, int)
            or scale_max <= scale_min or not scale_min <= answer <= scale_max):
        return None
    try:
        result = 1 + 4 * (answer - scale_min) / (scale_max - scale_min)
        return result if isfinite(result) else None
    except (OverflowError, ValueError):
        return None


def _rating_range(question: dict) -> tuple[int, int] | None:
    kind = question.get("type")
    if not isinstance(kind, str) or kind not in RATING_TYPES:
        return None
    if "scale_min" in question or "scale_max" in question:
        if "scale_min" not in question or "scale_max" not in question:
            return None
        minimum, maximum = question["scale_min"], question["scale_max"]
    else:
        minimum, maximum = 1, 5
    if (isinstance(minimum, bool) or not isinstance(minimum, int)
            or isinstance(maximum, bool) or not isinstance(maximum, int) or maximum <= minimum):
        return None
    return minimum, maximum


def iter_snapshot_sections(snapshot: object):
    """Yield (stable Section ID, nested questions) in issued block order."""
    if not isinstance(snapshot, dict) or snapshot.get("schema_version") != 2 or not isinstance(snapshot.get("questions"), list):
        return
    for block in snapshot["questions"]:
        if not isinstance(block, dict) or block.get("type") != "section":
            continue
        section_id = block.get("section_id")
        if isinstance(section_id, bool) or not isinstance(section_id, int) or section_id <= 0:
            continue
        questions = block.get("questions")
        if isinstance(questions, list):
            yield section_id, questions


def snapshot_section_ids(snapshot: object) -> frozenset[int]:
    return frozenset(section_id for section_id, _questions in iter_snapshot_sections(snapshot))


def extract_section_ratings(snapshot: object, answers: object) -> list[SectionRating]:
    """Traverse issued Section blocks only; never consult today's source Form."""
    if (not isinstance(snapshot, dict) or snapshot.get("schema_version") != 2
            or not isinstance(snapshot.get("questions"), list) or not isinstance(answers, list)):
        return []

    question_ids: Counter[str] = Counter()
    blocks = snapshot["questions"]
    for block in blocks:
        if not isinstance(block, dict):
            continue
        questions = (block.get("questions") if block.get("type") == "section" else
                     [block.get("question")] if block.get("type") == "question" else [])
        if not isinstance(questions, list):
            continue
        for question in questions:
            if isinstance(question, dict) and isinstance(question.get("id"), str) and question["id"].strip():
                question_ids[question["id"]] += 1

    values: dict[str, object] = {}
    repeated_answers: set[str] = set()
    for answer in answers:
        if not isinstance(answer, dict) or not isinstance(answer.get("question_id"), str):
            continue
        question_id = answer["question_id"]
        if question_id in values:
            repeated_answers.add(question_id)
        values[question_id] = answer.get("value")

    ratings = []
    for section_id, questions in iter_snapshot_sections(snapshot):
        for question in questions:
            if not isinstance(question, dict):
                continue
            question_id = question.get("id")
            if (not isinstance(question_id, str) or question_ids[question_id] != 1
                    or question_id in repeated_answers or question_id not in values):
                continue
            bounds = _rating_range(question)
            value = values[question_id]
            if bounds is None or isinstance(value, bool) or not isinstance(value, int):
                continue
            normalized = normalize_rating(value, *bounds)
            if normalized is not None:
                ratings.append(SectionRating(section_id, question_id, normalized))
    return ratings


def score_evaluation(assignment: models.FilledForm) -> EvaluationSections | None:
    """A draft or a record without an issued v2 snapshot has no Section score."""
    if assignment.finish_date is None:
        return None
    by_section: dict[int, list[float]] = defaultdict(list)
    for rating in extract_section_ratings(assignment.form_snapshot, assignment.answers):
        by_section[rating.section_id].append(rating.normalized)
    return EvaluationSections(
        assignment.id, assignment.campaign_id, assignment.evaluator_id, assignment.evaluatee_id,
        assignment.company_group_id, assignment.finish_date, snapshot_section_ids(assignment.form_snapshot),
        {section_id: mean(values) for section_id, values in by_section.items()},
        getattr(assignment, "evaluatee_company_role_id", None),
    )


def _reviewer_sections(evaluations: Sequence[EvaluationSections], evaluatee_id: int) -> tuple[dict[int, dict[int, float]], dict[int, dict[int, float]]]:
    # Latest submitted record wins per evaluator and Section; never weight duplicate records twice.
    peer: dict[int, dict[int, tuple[date, int, float]]] = defaultdict(dict)
    self_scores: dict[int, dict[int, tuple[date, int, float]]] = defaultdict(dict)
    for evaluation in evaluations:
        if evaluation.evaluatee_id != evaluatee_id:
            continue
        target = self_scores if evaluation.evaluator_id == evaluatee_id else peer
        for section_id, value in evaluation.sections.items():
            previous = target[section_id].get(evaluation.evaluator_id)
            candidate = (evaluation.finish_date or date.min, evaluation.assignment_id, value)
            if previous is None or candidate[:2] > previous[:2]:
                target[section_id][evaluation.evaluator_id] = candidate
    return ({section_id: {reviewer: item[2] for reviewer, item in reviewers.items()} for section_id, reviewers in peer.items()},
            {section_id: {reviewer: item[2] for reviewer, item in reviewers.items()} for section_id, reviewers in self_scores.items()})


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


def group_scores(evaluations: Sequence[EvaluationSections], campaign_id: int, *, aggregate_access: bool = False) -> dict[int, AggregateScores]:
    """Attribute evaluations to their recorded assignment group, not current memberships."""
    scoped = [evaluation for evaluation in evaluations if evaluation.campaign_id == campaign_id]
    results = {}
    for group_id in {evaluation.company_group_id for evaluation in scoped if evaluation.company_group_id is not None}:
        cohort = [evaluation for evaluation in scoped if evaluation.company_group_id == group_id]
        if aggregate_access:
            results[group_id] = _aggregate(cohort, 1, aggregate_access=True)
        else:
            results[group_id] = suppress_small_complements(
                _aggregate(cohort, reporting_service.min_aggregate_evaluatees()), scoped, cohort)
    return results


def role_scores(evaluations: Sequence[EvaluationSections], campaign_id: int, evaluatee_roles: Mapping[int, int], *, aggregate_access: bool = False) -> dict[int, AggregateScores]:
    """Use the evaluated employee's company role, never the evaluator's role."""
    scoped = [evaluation for evaluation in evaluations if evaluation.campaign_id == campaign_id]
    results = {}
    for role_id in {role for evaluation in scoped if (role := role_of(evaluation, evaluatee_roles)) is not None}:
        cohort = [evaluation for evaluation in scoped if role_of(evaluation, evaluatee_roles) == role_id]
        if aggregate_access:
            results[role_id] = _aggregate(cohort, 1, aggregate_access=True)
        else:
            results[role_id] = suppress_small_complements(
                _aggregate(cohort, reporting_service.min_aggregate_evaluatees()), scoped, cohort)
    return results


def suppress_small_complements(aggregate: AggregateScores, population: Sequence[EvaluationSections], cohort: Sequence[EvaluationSections]) -> AggregateScores:
    """Withhold a cohort's Section when the campaign outside it has fewer than the minimum evaluatees.

    Group leaders see the campaign average next to their groups; campaign minus cohort would
    otherwise reveal the few people left outside.
    """
    sections = dict(aggregate.sections)
    for section_id, result in sections.items():
        if result.availability != "available":
            continue
        included_assignments = {item.assignment_id for item in cohort}
        remaining = len({item.evaluatee_id for item in population if item.assignment_id not in included_assignments
                         and item.evaluator_id != item.evaluatee_id and section_id in item.sections})
        if 0 < remaining < reporting_service.min_aggregate_evaluatees():
            sections[section_id] = ScoreResult(None, "suppressed")
    return AggregateScores(sections, _overall(sections))

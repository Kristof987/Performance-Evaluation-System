"""The scoring and anonymity rules behind every report, tested without a database."""
from datetime import date
from itertools import count

import pytest

from services import reporting_service
from services import section_scoring_service as scoring

SECTION = 1
CAMPAIGN = 7
_ids = count(1)


@pytest.fixture(autouse=True)
def thresholds(monkeypatch):
    monkeypatch.setattr(reporting_service, "min_individual_peer_reviewers", lambda: 2)
    monkeypatch.setattr(reporting_service, "min_aggregate_evaluatees", lambda: 2)


def review(evaluator, evaluatee, score, *, group=1):
    return scoring.EvaluationSections(
        assignment_id=next(_ids), campaign_id=CAMPAIGN, evaluator_id=evaluator, evaluatee_id=evaluatee,
        company_group_id=group, finish_date=date(2026, 1, 1), section_ids=frozenset({SECTION}),
        sections={SECTION: score})


@pytest.mark.parametrize(("answer", "low", "high", "expected"), [
    (1, 1, 5, 1.0), (5, 1, 5, 5.0), (10, 1, 10, 5.0), (1, 1, 10, 1.0), (2, 1, 3, 3.0), (0, 0, 10, 1.0), (5, 0, 10, 3.0),
])
def test_every_scale_is_projected_onto_one_to_five(answer, low, high, expected):
    assert scoring.normalize_rating(answer, low, high) == pytest.approx(expected)


@pytest.mark.parametrize(("answer", "low", "high"), [(6, 1, 5), (3, 5, 5)])
def test_out_of_range_or_invalid_ratings_are_ignored(answer, low, high):
    assert scoring.normalize_rating(answer, low, high) is None


def test_single_peer_reviewer_is_hidden_unless_full_access():
    evaluations = [review(10, 1, 4.0)]
    hidden = scoring.employee_scores(evaluations, CAMPAIGN, 1)
    assert hidden.peer_sections[SECTION].availability == "suppressed"
    assert hidden.overall_peer.score is None
    assert scoring.employee_scores(evaluations, CAMPAIGN, 1, aggregate_access=True).peer_sections[SECTION].score == 4.0


def test_self_evaluation_is_kept_apart_from_peer_scores():
    evaluations = [review(10, 1, 4.0), review(11, 1, 2.0), review(1, 1, 5.0)]
    scores = scoring.employee_scores(evaluations, CAMPAIGN, 1)
    assert scores.peer_sections[SECTION].score == pytest.approx(3.0)
    assert scores.peer_sections[SECTION].contributor_count == 2
    assert scores.self_sections[SECTION].score == 5.0


def test_each_evaluated_employee_weighs_the_same_in_an_aggregate():
    # Employee 1 has three 5.0 reviews, employee 2 one 1.0 review: 3.0, not the per-review mean of 4.0.
    evaluations = [review(10, 1, 5.0), review(11, 1, 5.0), review(12, 1, 5.0), review(13, 2, 1.0)]
    result = scoring.campaign_scores(evaluations, CAMPAIGN, aggregate_access=True)
    assert result.sections[SECTION].score == pytest.approx(3.0)


def test_aggregate_needs_enough_evaluated_employees():
    one_person = [review(10, 1, 4.0), review(11, 1, 2.0)]
    assert scoring.campaign_scores(one_person, CAMPAIGN).sections[SECTION].availability == "suppressed"
    two_people = one_person + [review(12, 2, 5.0), review(13, 2, 3.0)]
    assert scoring.campaign_scores(two_people, CAMPAIGN).sections[SECTION].score == pytest.approx(3.5)


def test_slice_is_hidden_when_its_complement_would_isolate_one_person():
    # Five evaluated employees; a slice of four would let "total minus slice" reveal the fifth.
    population = [review(100 + person, person, 4.0) for person in range(1, 6)]
    four = population[:4]
    aggregate = scoring.AggregateScores({SECTION: scoring.ScoreResult(4.0, "available", 4)}, scoring.ScoreResult(4.0, "available", 1))
    assert scoring.suppress_small_complements(aggregate, population, four).sections[SECTION].availability == "suppressed"
    three = population[:3]
    assert scoring.suppress_small_complements(aggregate, population, three).sections[SECTION].availability == "available"

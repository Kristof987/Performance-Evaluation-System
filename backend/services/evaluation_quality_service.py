"""Conservative, anonymous campaign-level peer evaluation quality observations.

These descriptive heuristics never adjust scores or assert reviewer intent.
Preliminary releases are categorical; exact evidence is reserved for closed campaigns.
"""

from collections import Counter, defaultdict
from datetime import date
from statistics import mean, pstdev

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from services import campaign_lifecycle
from services import question_analytics_service
from services import reporting_service
from services.section_scoring_service import normalize_rating


# Descriptive engineering heuristics, not statistical significance, confidence,
# misconduct labels, or adjustments to an employee's performance score.
MIN_PEOPLE = 5
MIN_RATINGS = 30
MIN_MATCHED = 20
MIN_BUCKET_PEOPLE = 3
MIN_SUBMISSION_RATINGS = 6
MIN_REVIEWER_RATINGS = 8
MIN_REVIEWER_EVALUATEES = 3
MIN_FLAGGED_REVIEWERS = 3
MAX_CONTRIBUTION = 0.25
FINDING_CATEGORIES = (
    "uniform_rating_pattern", "higher_rating_tendency", "lower_rating_tendency",
    "peer_rating_disagreement", "rating_distribution_concentration",
)


def _observations(rows, db):
    """One valid latest issued rating per reviewer, evaluatee and semantic question."""
    definitions, raw, _issued = question_analytics_service._collect(rows, db)
    assignments = {assignment.id: assignment for assignment, _form, _status in rows}
    latest = {}
    for item in raw:
        if item.evaluator_id == item.evaluatee_id:
            continue
        metadata = definitions[item.key]
        if metadata["category"] != "rating":
            continue
        normalized = normalize_rating(item.value, metadata["scale_min"], metadata["scale_max"])
        if normalized is None:
            continue
        key = (item.evaluator_id, item.evaluatee_id, item.key)
        assignment = assignments[item.assignment_id]
        order = (assignment.finish_date is not None,
                 assignment.finish_date or (assignment.created_at.date() if assignment.created_at else date.min),
                 item.assignment_id)
        if key not in latest or order > latest[key][0]:
            latest[key] = (order, item, normalized)
    return [(item, value) for _order, item, value in latest.values()], definitions


def _matched(observations):
    by_target = defaultdict(list)
    for item, value in observations:
        by_target[(item.evaluatee_id, item.key)].append((item, value))
    matched = []
    for group in by_target.values():
        # A reviewer must have two OTHER independent peer ratings to compare.
        if len(group) < 3:
            continue
        total = sum(value for _item, value in group)
        for item, value in group:
            matched.append((item, value, value - (total - value) / (len(group) - 1)))
    return matched, by_target


def _suppressed(campaign, analysis_status, data_status, status, message, peer_reviews, assigned_reviews):
    return {
        "campaign": reporting_service._report_campaign_option(campaign),
        "analysis_status": analysis_status, "data_status": data_status,
        "completed_peer_reviews": peer_reviews, "assigned_peer_reviews": assigned_reviews,
        "peer_reviews_analyzed": peer_reviews,
        "rating_observations": 0 if data_status == "no_data" else None,
        "findings_count": 0,
        "findings_by_category": {key: [] for key in FINDING_CATEGORIES},
        "statistics": {"mean_normalized": None, "standard_deviation": None,
                       "maximum_percentage": None, "modal_percentage": None, "distribution": []},
        "coverage": {"status": status, "message": message, "matched_observations": None,
                     "comparable_employees": None,
                     "detectors": {key: "insufficient" for key in FINDING_CATEGORIES}},
    }


def build_evaluation_quality(campaign_id: int, actor: models.User, db: Session) -> dict:
    # Unlike other Reports destinations, quality observations may be released after
    # issuance during Active/Paused. This grant authorizes aggregate completion
    # counts and coarse categories, never raw answers or reviewer-level evidence.
    reporting_service.require_reports_access(None, actor, db)
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).with_for_update(read=True).first()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not reporting_service._has_permission(actor, db, "campaigns.manage"):
        raise HTTPException(status_code=403, detail="Campaign management permission is required")

    lifecycle = models.CampaignStatus(campaign.status)
    reportable = lifecycle in (*campaign_lifecycle.REPORTABLE_STATUSES,
                               models.CampaignStatus.ACTIVE, models.CampaignStatus.PAUSED)
    if not reportable or (campaign.is_archived and lifecycle == models.CampaignStatus.PAUSED):
        return _suppressed(campaign, "unavailable", "no_data", "no_completed",
                           "Questionnaires have not been issued for quality analysis, or this paused campaign is archived.", 0, 0)

    analysis_status = "final" if lifecycle == models.CampaignStatus.CLOSED else "preliminary"
    rows = reporting_service.campaign_report_rows(campaign_id, db)
    assigned = len({row[0].id for row in rows if row[0].evaluator_id != row[0].evaluatee_id})
    peer_rows = [row for row in rows if row[0].evaluator_id != row[0].evaluatee_id
                   and reporting_service.status_key(row[2], row[0].finish_date) == "completed"]
    reviews = len({row[0].id for row in peer_rows})
    if not reviews:
        return _suppressed(campaign, "unavailable", "no_data", "no_completed", "No completed peer reviews.", 0, assigned)

    observations, definitions = _observations(peer_rows, db)
    if not observations:
        return _suppressed(campaign, "unavailable", "no_data", "no_completed",
                           "No valid issued-snapshot peer ratings are available for analysis.", reviews, assigned)
    matched, groups = _matched(observations)
    evaluators = {item.evaluator_id for item, _value in observations}
    evaluatees = {item.evaluatee_id for item, _value in observations}
    comparable = {item.evaluatee_id for item, _value, _difference in matched}
    matched_reviewers = {item.evaluator_id for item, _value, _difference in matched}
    counts_by_reviewer = Counter(item.evaluator_id for item, _value in observations)
    counts_by_evaluatee = Counter(item.evaluatee_id for item, _value in observations)
    matched_by_reviewer = Counter(item.evaluator_id for item, _value, _difference in matched)
    matched_by_evaluatee = Counter(item.evaluatee_id for item, _value, _difference in matched)
    if (len(observations) < MIN_RATINGS or len(matched) < MIN_MATCHED
            or min(len(evaluators), len(evaluatees), len(comparable), len(matched_reviewers)) < MIN_PEOPLE
            or any(count > len(observations) * MAX_CONTRIBUTION for count in (*counts_by_reviewer.values(), *counts_by_evaluatee.values()))
            or any(count > len(matched) * MAX_CONTRIBUTION for count in (*matched_by_reviewer.values(), *matched_by_evaluatee.values()))):
        return _suppressed(campaign, analysis_status, "insufficient_data", "insufficient",
                           "Insufficient independent peer coverage for anonymous findings.", reviews, assigned)

    # Exact bucket counts are released only when every occupied bucket has
    # several independent reviewers and evaluatees, not merely several answers.
    bins = defaultdict(list)
    for item, value in observations:
        bins[min(4, int(value) - 1)].append(item)
    if analysis_status == "final" and any(len({item.evaluator_id for item in bucket}) < MIN_BUCKET_PEOPLE
           or len({item.evaluatee_id for item in bucket}) < MIN_BUCKET_PEOPLE
           or any(count > len(bucket) * 0.5 for count in Counter(item.evaluator_id for item in bucket).values())
           or any(count > len(bucket) * 0.5 for count in Counter(item.evaluatee_id for item in bucket).values())
           for bucket in bins.values()):
        return _suppressed(campaign, analysis_status, "insufficient_data", "insufficient",
                           "Rating distribution cannot be released anonymously.", reviews, assigned)

    values = [value for _item, value in observations]
    maximum_percentage = 100 * sum(item.value == definitions[item.key]["scale_max"]
                                   for item, _value in observations) / len(values)
    modal_percentage = 100 * max(len(bucket) for bucket in bins.values()) / len(values)
    standard_deviation = pstdev(values)
    by_submission = defaultdict(list)
    for item, value in observations:
        by_submission[item.assignment_id].append((item, value))
    eligible_submissions = []
    uniform = []
    for entries in by_submission.values():
        if len(entries) < MIN_SUBMISSION_RATINGS:
            continue
        rating_values = [value for _item, value in entries]
        original_values = {item.value for item, _value in entries}
        deviation = pstdev(rating_values)
        modal_share = max(Counter(min(4, int(value) - 1) for value in rating_values).values()) / len(entries)
        maximum_share = sum(item.value == definitions[item.key]["scale_max"] for item, _value in entries) / len(entries)
        summary = (entries[0][0].evaluator_id, entries[0][0].evaluatee_id,
                   len(original_values), deviation, modal_share, maximum_share)
        eligible_submissions.append(summary)
        if len(original_values) <= 2 and (deviation <= 0.35 or modal_share >= 0.85):
            uniform.append(summary)

    differences = defaultdict(list)
    for item, _value, difference in matched:
        differences[item.evaluator_id].append((item.evaluatee_id, difference))
    directional = defaultdict(list)
    eligible_directional = set()
    for reviewer, entries in differences.items():
        if len(entries) < MIN_REVIEWER_RATINGS or len({person for person, _diff in entries}) < MIN_REVIEWER_EVALUATEES:
            continue
        eligible_directional.add(reviewer)
        average = mean(diff for _person, diff in entries)
        if abs(average) >= 1 and sum(diff * average > 0 for _person, diff in entries) / len(entries) >= 0.75:
            directional["higher" if average > 0 else "lower"].append(reviewer)

    comparable_groups = [(target, group) for target, group in groups.items() if len(group) >= 3]
    divergent = [(target, group) for target, group in comparable_groups
                 if max(value for _item, value in group) - min(value for _item, value in group) >= 2]
    findings = {key: [] for key in FINDING_CATEGORIES}
    uniform_eligible = (len(eligible_submissions) >= MIN_PEOPLE
                        and len({entry[0] for entry in eligible_submissions}) >= MIN_PEOPLE
                        and len({entry[1] for entry in eligible_submissions}) >= MIN_PEOPLE
                        and all(count <= len(eligible_submissions) * MAX_CONTRIBUTION
                                for attribute in (0, 1)
                                for count in Counter(entry[attribute] for entry in eligible_submissions).values()))
    disagreement_eligible = (len(comparable_groups) >= MIN_PEOPLE
                             and len({target[0] for target, _group in comparable_groups}) >= MIN_PEOPLE
                             and len({item.evaluator_id for _target, group in comparable_groups
                                      for item, _value in group}) >= MIN_PEOPLE)
    detectors = {
        "uniform_rating_pattern": "analyzed" if uniform_eligible else "insufficient",
        "higher_rating_tendency": "analyzed" if len(eligible_directional) >= MIN_PEOPLE else "insufficient",
        "lower_rating_tendency": "analyzed" if len(eligible_directional) >= MIN_PEOPLE else "insufficient",
        "peer_rating_disagreement": "analyzed" if disagreement_eligible else "insufficient",
        "rating_distribution_concentration": "analyzed",
    }

    def add(category, title, description, method, rule, statistics, eligible_count):
        findings[category].append({"category": category, "title": title, "description": description,
                                   "scope": "campaign", "section_name": None,
                                   "eligible_observations": eligible_count, "statistics": statistics,
                                   "method": method, "rule": rule, "informational": True})

    if (uniform_eligible
            and len({entry[0] for entry in uniform}) >= MIN_FLAGGED_REVIEWERS
            and len({entry[1] for entry in uniform}) >= MIN_FLAGGED_REVIEWERS):
        add("uniform_rating_pattern", "Repeated rating patterns", "Several peer submissions show concentrated ratings across their questions.",
            "Each eligible submission compares distinct original rating values, normalized spread, modal bin and issued-scale maxima; only campaign aggregates are shown.",
            "At least 3 reviewers and 3 evaluatees have submissions with 6 valid ratings, at most 2 distinct original values and normalized SD at most 0.35 or modal bin at least 85%.",
            {"mean_distinct_original_values": round(mean(entry[2] for entry in eligible_submissions), 1),
             "mean_normalized_standard_deviation": round(mean(entry[3] for entry in eligible_submissions), 2),
             "mean_modal_percentage": round(100 * mean(entry[4] for entry in eligible_submissions), 1),
             "mean_issued_maximum_percentage": round(100 * mean(entry[5] for entry in eligible_submissions), 1)},
            sum(len(entries) for entries in by_submission.values() if len(entries) >= MIN_SUBMISSION_RATINGS))
    for direction in ("higher", "lower"):
        if detectors[direction + "_rating_tendency"] == "analyzed" and len(directional[direction]) >= MIN_FLAGGED_REVIEWERS:
            add(direction + "_rating_tendency", "Consistently " + direction + " peer ratings",
                "Several peer reviews differ in the same direction from independent ratings of matching questions.",
                "Leave-one-out comparison with at least two other peers rating the same evaluatee and semantic question.",
                "At least 3 reviewers each have 8 matches across 3 evaluatees, mean difference at least 1 point and 75% in the same direction.",
                {"mean_absolute_peer_difference": round(mean(abs(diff) for _item, _value, diff in matched), 2),
                 "large_difference_percentage": round(100 * sum(abs(diff) >= 1 for _item, _value, diff in matched) / len(matched), 1)},
                len(matched))
    if (disagreement_eligible and len({target[0] for target, _group in divergent}) >= MIN_PEOPLE and len(divergent) >= MIN_PEOPLE
            and len({item.evaluator_id for _target, group in divergent for item, _value in group}) >= MIN_PEOPLE):
        add("peer_rating_disagreement", "Broad peer disagreement", "Peer ratings vary substantially on several matching questions.",
            "Range of normalized ratings from independent peers for the same evaluatee and question.",
            "At least 5 matching question groups across 5 evaluatees each have 3 reviewers and a range of at least 2 points.",
            {"wide_range_group_percentage": round(100 * len(divergent) / len(comparable_groups), 1),
             "mean_group_range": round(mean(max(value for _item, value in group) - min(value for _item, value in group)
                                            for _target, group in comparable_groups), 2)}, len(matched))
    if maximum_percentage >= 80 or modal_percentage >= 85 or standard_deviation <= 0.35:
        add("rating_distribution_concentration", "Concentrated rating distribution", "Peer ratings concentrate at the issued maximum or within a narrow normalized range.",
            "Campaign-wide issued-scale maxima and normalized rating-bin concentration and spread.",
            "At least 80% of answers equal their issued scale maximum, or modal normalized bin at least 85%, or normalized SD at most 0.35.",
            {"issued_maximum_percentage": round(maximum_percentage, 1),
             "modal_percentage": round(modal_percentage, 1),
             "normalized_standard_deviation": round(standard_deviation, 2)}, len(values))

    if analysis_status == "preliminary":
        # Repeated requests can difference exact mutable aggregates. Release only
        # broad categories, with no numeric fingerprints, bucket counts or rules.
        # Category transitions and other authorized Reports pages can still reveal
        # information over time; this is not a cross-report anonymity guarantee.
        preliminary_titles = {
            "uniform_rating_pattern": "Uniform rating patterns",
            "higher_rating_tendency": "Higher rating tendencies",
            "lower_rating_tendency": "Lower rating tendencies",
            "peer_rating_disagreement": "Peer rating disagreement",
            "rating_distribution_concentration": "Campaign rating concentration",
        }
        findings = {category: [{"category": category, "title": preliminary_titles[category],
                                "description": preliminary_titles[category] + " have been observed among completed evaluations.",
                                "scope": "campaign", "section_name": None, "eligible_observations": None,
                                "statistics": {}, "method": "Campaign-level peer rating check",
                                "rule": "Only eligible, independent completed peer evaluations are considered.",
                                "informational": True} for _finding in entries]
                    for category, entries in findings.items()}
        return {"campaign": reporting_service._report_campaign_option(campaign),
                "analysis_status": analysis_status, "data_status": "analyzed",
                "completed_peer_reviews": reviews, "assigned_peer_reviews": assigned,
                "peer_reviews_analyzed": len({item.assignment_id for item, _value in observations}),
                "rating_observations": None, "findings_count": sum(map(len, findings.values())),
                "findings_by_category": findings,
                "statistics": {"mean_normalized": None, "standard_deviation": None,
                               "maximum_percentage": None, "modal_percentage": None, "distribution": []},
                "coverage": {"status": "analyzed", "message": "Categorical preliminary observations only; exact evidence is withheld until closure.",
                             "matched_observations": None, "comparable_employees": None,
                             "detectors": detectors}}
    labels = ("1-<2", "2-<3", "3-<4", "4-<5", "5")
    distribution = [{"label": label, "count": len(bins[index]),
                     "percentage": round(100 * len(bins[index]) / len(values), 1)}
                    for index, label in enumerate(labels)]
    return {"campaign": reporting_service._report_campaign_option(campaign),
            "analysis_status": analysis_status, "data_status": "analyzed",
            "completed_peer_reviews": reviews, "assigned_peer_reviews": assigned,
            "peer_reviews_analyzed": reviews, "rating_observations": len(values),
            "findings_count": sum(map(len, findings.values())), "findings_by_category": findings,
            "statistics": {"mean_normalized": round(mean(values), 2),
                           "standard_deviation": round(standard_deviation, 2),
                           "maximum_percentage": round(maximum_percentage, 1),
                           "modal_percentage": round(modal_percentage, 1),
                           "distribution": distribution},
            "coverage": {"status": "analyzed", "message": "Anonymous campaign-level peer patterns only; informational, not score adjustments.",
                         "matched_observations": len(matched), "comparable_employees": len(comparable),
                         "detectors": detectors}}

"""Authorized aggregate AI inputs, derived only from released Reports values.

Aggregate evidence references identify released report metrics, not individual
answers. The source fingerprint binds each metric snapshot to the exact campaign
assignments and current membership/role interpretation used at construction.
"""

from hashlib import sha256
import json

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
import question_analytics_service
import reporting_service
from ai_analysis_models import AggregateAnalysisContext, AggregateEvidence, AggregateStatistic


def _fingerprint(db: Session, campaign_id: int, report: dict, questions: list[dict]) -> str:
    digest = sha256(b"aggregate-ai-source-v1\n")
    rows = reporting_service.campaign_report_rows(campaign_id, db)
    for assignment, _form, status in sorted(rows, key=lambda row: row[0].id):
        completed = reporting_service.status_key(status, assignment.finish_date) == "completed"
        source = [assignment.id, assignment.company_group_id, assignment.evaluator_id, assignment.evaluatee_id,
                  assignment.form_id, status, assignment.finish_date.isoformat() if assignment.finish_date else None,
                  assignment.form_snapshot if completed else None, assignment.answers if completed else None]
        digest.update(json.dumps(source, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode())
        digest.update(b"\n")
    for table, order in ((models.employee_company_groups, ("employee_id", "company_group_id")),
                         (models.campaign_company_groups, ("campaign_id", "company_group_id"))):
        fields = [getattr(table.c, name) for name in order]
        statement = table.select().order_by(*fields)
        if table is models.campaign_company_groups:
            statement = statement.where(table.c.campaign_id == campaign_id)
        digest.update(json.dumps([tuple(row) for row in db.execute(statement)], separators=(",", ":")).encode())
    employee_ids = {row[0].evaluatee_id for row in rows} | {row[0].evaluator_id for row in rows}
    roles = db.query(models.Employee.id, models.Employee.company_role_id).filter(models.Employee.id.in_(employee_ids)).order_by(models.Employee.id).all() if employee_ids else []
    digest.update(json.dumps([tuple(item) for item in roles], separators=(",", ":")).encode())
    rules = db.query(models.CampaignEvaluationRule).filter(models.CampaignEvaluationRule.campaign_id == campaign_id).order_by(models.CampaignEvaluationRule.id).all()
    digest.update(json.dumps([(rule.id, rule.company_group_id, rule.evaluatee_role_id, rule.evaluator_role_id, rule.form_id)
                              for rule in rules], separators=(",", ":")).encode())
    digest.update(json.dumps([report, questions], sort_keys=True, ensure_ascii=True, default=str).encode())
    return digest.hexdigest()


def _build(db: Session, campaign_id: int, scope_type: str, scope_id: int | None, actor: models.User) -> AggregateAnalysisContext:
    reporting_service.require_reports_access(campaign_id, actor, db)
    aggregate_access = reporting_service.aggregate_reporting_access(campaign_id, actor, db)
    if scope_type == "campaign":
        report = reporting_service.build_campaign_report_overview(campaign_id, actor, db)
        label = report["campaign"]["name"]
        total, completed = report["kpis"]["total_evaluations"], report["kpis"]["completed_evaluations"]
        cohort_count = report["employees"]["participating_employees"]
    elif scope_type == "group":
        report = reporting_service.build_group_detail(campaign_id, scope_id, actor, db)
        label = report["group"]["name"]
        group_rows = [row for row in reporting_service.campaign_report_rows(campaign_id, db)
                      if row[0].company_group_id == scope_id]
        total = len({row[0].id for row in group_rows})
        completed = report["kpis"]["completed_evaluations"]
        cohort_count = len({employee["employee_id"] for employee in report["employees"]})
    else:
        # CompanyRole is the evaluation dimension; SystemRole is solely RBAC.
        configured = db.query(models.CampaignEvaluationRule.id).filter(
            models.CampaignEvaluationRule.campaign_id == campaign_id,
            models.CampaignEvaluationRule.evaluatee_role_id == scope_id,
        ).first()
        if configured is None:
            raise HTTPException(status_code=404, detail="Campaign evaluatee-role report not found")
        report = reporting_service.build_role_detail(campaign_id, scope_id, actor, db, "evaluatee")
        label = report["role"]["name"]
        roles = reporting_service.users_by_id(db)
        cohort = {employee_id for employee_id, (_, role) in roles.items() if role.id == scope_id}
        role_rows = [row for row in reporting_service.campaign_report_rows(campaign_id, db)
                     if row[0].evaluatee_id in cohort and row[0].evaluator_id != row[0].evaluatee_id]
        total = len({row[0].id for row in role_rows})
        completed = report["kpis"]["completed_evaluations"]
        cohort_count = len({row[0].evaluatee_id for row in role_rows})

    minimum = reporting_service.MIN_AGGREGATE_EVALUATEES
    if cohort_count < minimum and not aggregate_access:
        return AggregateAnalysisContext(
            campaign_id=campaign_id, scope_type=scope_type, scope_id=scope_id, scope_label=label,
            payload={"scope": scope_type, "reportable_metrics": []}, evidence=[], statistics=[],
            comparison_evidence=[], source_fingerprint=_fingerprint(db, campaign_id, report, []),
        )
    peer_questions = question_analytics_service.build_question_report(
        campaign_id, actor, db, group_id=scope_id if scope_type == "group" else None,
        role_id=scope_id if scope_type == "role" else None, evaluation_type="peer",
    )["questions"]
    self_questions = question_analytics_service.build_question_report(
        campaign_id, actor, db, group_id=scope_id if scope_type == "group" else None,
        role_id=scope_id if scope_type == "role" else None, evaluation_type="self",
    )["questions"]
    scope_key = f"aggregate:{campaign_id}:{scope_type}:{scope_id or 0}"
    evidence: list[AggregateEvidence] = []
    statistics: list[AggregateStatistic] = []
    comparison_evidence: list[list[str]] = []
    payload: dict = {"scope": scope_type, "subject": "the evaluated cohort, not an individual employee",
                     "scope_label": label, "reportable_metrics": []}

    def add_metric(suffix: str, category: str, kind: str, title: str, section_name: str | None,
                   detail: dict, values: list[tuple[str, float | int, str, int | None]]) -> str:
        identifier = f"{scope_key}:{suffix}"
        evidence.append(AggregateEvidence(evidence_id=identifier, category=category, scope=kind,
                                          question_text=title, section_name=section_name, details=detail))
        ids = {}
        for field, value, unit, denominator in values:
            statistic_id = f"{identifier}:{field}"
            statistics.append(AggregateStatistic(statistic_id=statistic_id, value=value, unit=unit,
                                                  description=f"{title} {field.replace('_', ' ')}",
                                                  evidence_ids=[identifier], denominator=denominator))
            ids[field] = statistic_id
        payload["reportable_metrics"].append({"evidence_id": identifier, "category": category,
                                                "type": kind, "title": title, "section_name": section_name,
                                                "values": detail, "statistic_ids": ids})
        return identifier

    section_rows = report["sections"]
    available_sections = [row for row in section_rows if row["availability"] == "available"
                          and row["average_score"] is not None and (aggregate_access or row["evaluator_count"] >= minimum)]
    for row in available_sections:
        add_metric(f"section:{row['id']}:peer", "peer", "section", row["name"], row["name"],
                   {"average_normalized": round(row["average_score"], 2),
                    "contributor_count": row["evaluatee_count"], "evaluator_count": row["evaluator_count"]},
                   [("average_normalized", round(row["average_score"], 2), "normalized", 5),
                    ("contributor_count", row["evaluatee_count"], "count", None),
                    ("evaluator_count", row["evaluator_count"], "count", None)])
    overall = report["kpis"].get("overall_score") if scope_type == "campaign" else report["kpis"].get("overall_peer_score" if scope_type == "group" else "overall_score")
    if (overall is not None and available_sections and len(available_sections) == len(section_rows)
            and all(row["availability"] == "available" for row in section_rows)):
        add_metric("overall:peer", "peer", "overall", "Overall peer Section score", None,
                   {"average_normalized": round(overall, 2), "reportable_sections": len(available_sections),
                    "section_scores": [{"section_name": row["name"], "average_normalized": round(row["average_score"], 2),
                                        "contributor_count": row["evaluatee_count"]} for row in available_sections]},
                   [("average_normalized", round(overall, 2), "normalized", 5),
                    ("reportable_sections", len(available_sections), "count", None)])

    peer_by_key = {item["key"]: item for item in peer_questions if item["availability"] == "available" and item["category"] == "rating"}
    self_by_key = {item["key"]: item for item in self_questions if item["availability"] == "available" and item["category"] == "rating"}
    for category, questions in (("peer", peer_by_key), ("self", self_by_key)):
        for key, item in sorted(questions.items()):
            detail = {"average_normalized": item["average_normalized"], "answer_count": item["response_count"],
                      "scale_min": item["scale_min"], "scale_max": item["scale_max"],
                      "original_distribution": item["distribution"]}
            values = [("average_normalized", item["average_normalized"], "normalized", 5),
                      ("answer_count", item["response_count"], "count", None)]
            for bin_ in item["distribution"] or []:
                values.append((f"rating_{bin_['label']}_count", bin_["count"], "count", None))
                values.append((f"rating_{bin_['label']}_percentage", bin_["percentage"], "percentage", None))
            add_metric(f"question:{key}:{category}", category, "question", item["text"], item["section_name"], detail, values)
    comparable_keys = peer_by_key.keys() & self_by_key.keys()
    comparable_observations = (question_analytics_service._collect(
        reporting_service.campaign_report_rows(campaign_id, db), db)[1] if comparable_keys else [])
    for key in sorted(comparable_keys):
        scoped = [item for item in comparable_observations if item.key == key
                  and (scope_type != "group" or item.group_id == scope_id)
                  and (scope_type != "role" or item.role_id == scope_id)]
        peer_subjects = {item.evaluatee_id for item in scoped if item.evaluator_id != item.evaluatee_id}
        self_subjects = {item.evaluatee_id for item in scoped if item.evaluator_id == item.evaluatee_id}
        if peer_subjects != self_subjects or not peer_subjects or (len(peer_subjects) < minimum and not aggregate_access):
            continue
        peer, self_result = peer_by_key[key], self_by_key[key]
        peer_id, self_id = f"{scope_key}:question:{key}:peer", f"{scope_key}:question:{key}:self"
        comparison_evidence.append([peer_id, self_id])
        delta = round(self_result["average_normalized"] - peer["average_normalized"], 2)
        statistic_id = f"{scope_key}:question:{key}:self_minus_peer"
        statistics.append(AggregateStatistic(statistic_id=statistic_id, value=delta, unit="difference",
                                              description=f"{peer['text']} self-minus-peer normalized difference",
                                              evidence_ids=[peer_id, self_id]))
        payload["reportable_metrics"].append({"type": "comparison", "title": peer["text"],
                                                "evidence_ids": [peer_id, self_id], "self_minus_peer": delta,
                                                "statistic_ids": {"self_minus_peer": statistic_id}})
    # Non-manager releases still guard singleton complements; the management
    # grant permits aggregate counts but does not authorize individual answers.
    assignments = reporting_service.campaign_report_rows(campaign_id, db)
    all_participants = {row[0].evaluatee_id for row in assignments}
    if evidence and (aggregate_access or scope_type == "campaign" or len(all_participants - (
        {row[0].evaluatee_id for row in assignments if row[0].company_group_id == scope_id} if scope_type == "group"
        else {row[0].evaluatee_id for row in assignments if row[0].evaluatee_id in cohort}
    )) != 1):
        rate = round(100 * completed / total) if total else 0
        add_metric("completion", "aggregate", "completion", "Submitted evaluation completion", None,
                   {"eligible_employee_count": cohort_count, "total_evaluations": total,
                    "completed_evaluations": completed, "completion_rate": rate},
                   [("eligible_employee_count", cohort_count, "count", None),
                    ("total_evaluations", total, "count", None), ("completed_evaluations", completed, "count", None),
                    ("completion_rate", rate, "percentage", None)])
    fingerprint = _fingerprint(db, campaign_id, report, [peer_questions, self_questions])
    return AggregateAnalysisContext(campaign_id=campaign_id, scope_type=scope_type, scope_id=scope_id,
                                    scope_label=label, payload=payload, evidence=evidence, statistics=statistics,
                                    comparison_evidence=comparison_evidence, source_fingerprint=fingerprint)


def build_group_analysis_context(db: Session, campaign_id: int, group_id: int, *, actor: models.User) -> AggregateAnalysisContext:
    return _build(db, campaign_id, "group", group_id, actor)


def build_role_analysis_context(db: Session, campaign_id: int, role_id: int, *, actor: models.User) -> AggregateAnalysisContext:
    return _build(db, campaign_id, "role", role_id, actor)


def build_campaign_analysis_context(db: Session, campaign_id: int, *, actor: models.User) -> AggregateAnalysisContext:
    return _build(db, campaign_id, "campaign", None, actor)

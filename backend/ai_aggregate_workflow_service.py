"""Versioned HR workflow for campaign, assigned group, and evaluatee-role AI reports."""

from datetime import datetime, timedelta, timezone
from hashlib import sha256

from fastapi import HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

import models
import reporting_service
from ai_aggregate_service import (
    build_campaign_analysis_context, build_group_analysis_context, build_role_analysis_context,
)
from ai_analysis_models import AggregateAnalysisContext, EmployeeAIAnalysis
from ai_generation_service import (
    AnalysisGenerationError, generate_aggregate_ai_analysis_from_context, validate_aggregate_ai_analysis,
)
from ai_workflow_service import _lock_campaign, can_manage


def _context(db: Session, campaign_id: int, scope_type: str, scope_id: int | None,
             actor: models.User) -> AggregateAnalysisContext:
    if scope_type == "campaign" and scope_id is None:
        return build_campaign_analysis_context(db, campaign_id, actor=actor)
    if scope_type == "group" and scope_id is not None:
        return build_group_analysis_context(db, campaign_id, scope_id, actor=actor)
    if scope_type == "role" and scope_id is not None:
        return build_role_analysis_context(db, campaign_id, scope_id, actor=actor)
    raise HTTPException(status_code=404, detail="Analysis scope not found")


def _writable(db: Session, campaign_id: int, actor: models.User) -> None:
    if not can_manage(actor, db):
        raise HTTPException(status_code=403, detail="Analysis management permission required")
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    if campaign.is_archived:
        raise HTTPException(status_code=409, detail="Archived campaigns allow historical viewing only")


def _query(db: Session, context: AggregateAnalysisContext):
    return db.query(models.AggregateAIAnalysis).filter(
        models.AggregateAIAnalysis.campaign_id == context.campaign_id,
        models.AggregateAIAnalysis.scope_type == context.scope_type,
        models.AggregateAIAnalysis.scope_id == context.scope_id,
    )


def _record(db: Session, context: AggregateAnalysisContext, analysis_id: int) -> models.AggregateAIAnalysis:
    record = _query(db, context).filter(models.AggregateAIAnalysis.id == analysis_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Analysis version not found")
    return record


def _version(db: Session, context: AggregateAnalysisContext) -> int:
    return (_query(db, context).with_entities(func.max(models.AggregateAIAnalysis.version)).scalar() or 0) + 1


def _citations(analysis: EmployeeAIAnalysis) -> set[str]:
    return {citation for finding in [analysis.overall_assessment, *analysis.strengths, *analysis.development_areas]
            for citation in finding.supporting_evidence_ids}


def _evidence_summary(context: AggregateAnalysisContext, analysis: EmployeeAIAnalysis) -> dict:
    cited = _citations(analysis)
    result = {}
    for item in context.evidence:
        if item.evidence_id not in cited:
            continue
        details = item.details
        summary = {"category": item.category, "question_text": item.question_text,
                   "section_name": item.section_name, "question_statistics": [], "section_statistics": []}
        if item.scope == "question":
            summary["question_statistics"] = [{
                "question_text": item.question_text, "average_normalized": details["average_normalized"],
                "answer_count": details["answer_count"], "scale_min": details["scale_min"],
                "scale_max": details["scale_max"], "min_label": None, "max_label": None,
                "original_distribution": [{"original_value": int(bin_["label"]), "count": bin_["count"]}
                                          for bin_ in details["original_distribution"]],
            }]
        elif item.scope in {"section", "overall"}:
            summary["section_statistics"] = [{"section_name": item.section_name or item.question_text,
                                              "average_normalized": details["average_normalized"],
                                              "contributor_count": details.get("contributor_count")}]
            if item.scope == "overall":
                summary["section_statistics"].extend(details["section_scores"])
        elif item.scope == "completion":
            summary["completion_statistics"] = [
                {"label": "Eligible employees", "value": details["eligible_employee_count"]},
                {"label": "Assigned evaluations", "value": details["total_evaluations"]},
                {"label": "Completed evaluations", "value": details["completed_evaluations"]},
                {"label": "Completion rate", "value": f"{details['completion_rate']}%"},
            ]
        result[item.evidence_id] = summary
    if result.keys() != cited:
        raise AnalysisGenerationError("invalid_analysis_evidence")
    return result


def _serialize(record: models.AggregateAIAnalysis, fingerprint: str) -> dict:
    return {"id": record.id, "campaign_id": record.campaign_id, "scope_type": record.scope_type,
            "scope_id": record.scope_id, "version": record.version, "parent_analysis_id": record.parent_analysis_id,
            "status": record.status, "is_current_approved": record.is_current_approved,
            "outdated": record.source_fingerprint != fingerprint, "analysis": record.analysis,
            "evidence": record.evidence_summary, "model_identifier": record.model_identifier,
            "generated_at": record.generated_at, "generated_by_user_id": record.generated_by_user_id,
            "edited_at": record.edited_at, "edited_by_user_id": record.edited_by_user_id,
            "approved_at": record.approved_at, "approved_by_user_id": record.approved_by_user_id,
            "schema_version": record.schema_version}


def list_analyses(db: Session, campaign_id: int, scope_type: str, scope_id: int | None, *, actor: models.User) -> dict:
    try:
        context = _context(db, campaign_id, scope_type, scope_id, actor)
    except HTTPException as error:
        if error.status_code != 404 or scope_type not in {"group", "role"} or scope_id is None:
            raise
        reporting_service.require_reports_access(campaign_id, actor, db)
        historical = db.query(models.AggregateAIAnalysis).filter(
            models.AggregateAIAnalysis.campaign_id == campaign_id,
            models.AggregateAIAnalysis.scope_type == scope_type,
            models.AggregateAIAnalysis.scope_id == scope_id,
        ).order_by(models.AggregateAIAnalysis.version.desc()).all()
        if not historical:
            raise error
        return {"versions": [_serialize(record, "") for record in historical],
                "can_manage": False, "has_eligible_evidence": False,
                "scope_label": f"Historical {scope_type} report"}
    records = _query(db, context).order_by(models.AggregateAIAnalysis.version.desc()).all()
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    return {"versions": [_serialize(record, context.source_fingerprint) for record in records],
            "can_manage": can_manage(actor, db) and not campaign.is_archived,
            "has_eligible_evidence": bool(context.evidence), "scope_label": context.scope_label}


def generate(db: Session, campaign_id: int, scope_type: str, scope_id: int | None, *, actor: models.User) -> dict:
    initial = _context(db, campaign_id, scope_type, scope_id, actor)
    _writable(db, campaign_id, actor)
    db.rollback()
    lock_key = int.from_bytes(sha256(f"compass:aggregate-ai:{campaign_id}:{scope_type}:{scope_id}".encode()).digest()[:8],
                              "big", signed=True)
    with db.get_bind().connect() as lease:
        acquired = lease.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": lock_key}).scalar()
        lease.commit()
        if not acquired:
            raise HTTPException(status_code=409, detail="Analysis generation is already in progress")
        try:
            context = _context(db, campaign_id, scope_type, scope_id, actor)
            _writable(db, campaign_id, actor)
            if not context.evidence:
                raise AnalysisGenerationError("insufficient_analysis_data")
            recent = _query(db, context).filter(models.AggregateAIAnalysis.parent_analysis_id.is_(None)).order_by(
                models.AggregateAIAnalysis.generated_at.desc()).first()
            if recent and recent.generated_at > datetime.now(timezone.utc) - timedelta(seconds=30):
                raise HTTPException(status_code=409, detail="Please wait before regenerating this analysis")
            fingerprint = context.source_fingerprint
            db.rollback()  # Never retain Reports' campaign lock during a paid provider call.
            analysis, model = generate_aggregate_ai_analysis_from_context(context)
            _lock_campaign(db, campaign_id)
            fresh = _context(db, campaign_id, scope_type, scope_id, actor)
            _writable(db, campaign_id, actor)
            if fingerprint != fresh.source_fingerprint:
                raise HTTPException(status_code=409, detail="Report sources changed; generate again")
            record = models.AggregateAIAnalysis(
                campaign_id=campaign_id, scope_type=scope_type, scope_id=scope_id,
                version=_version(db, context), status="draft", is_current_approved=False,
                analysis=analysis.model_dump(mode="json"), evidence_summary=_evidence_summary(context, analysis),
                model_identifier=model, generated_at=datetime.now(timezone.utc), generated_by_user_id=actor.id,
                source_fingerprint=fingerprint, schema_version=1,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            return _serialize(record, fingerprint)
        except Exception:
            db.rollback()
            raise
        finally:
            lease.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": lock_key})
            lease.commit()


def edit(db: Session, campaign_id: int, scope_type: str, scope_id: int | None, analysis_id: int,
         content: EmployeeAIAnalysis, *, actor: models.User) -> dict:
    _context(db, campaign_id, scope_type, scope_id, actor)
    _writable(db, campaign_id, actor)
    db.rollback()
    _lock_campaign(db, campaign_id)
    context = _context(db, campaign_id, scope_type, scope_id, actor)
    _writable(db, campaign_id, actor)
    record = _record(db, context, analysis_id)
    if record.status != "draft":
        raise HTTPException(status_code=409, detail="Approved versions are read-only")
    if record.version != _version(db, context) - 1:
        raise HTTPException(status_code=409, detail="Only the latest Draft version can be edited")
    if record.source_fingerprint != context.source_fingerprint or not context.evidence:
        raise HTTPException(status_code=409, detail="Outdated analysis; regenerate before editing")
    validated = validate_aggregate_ai_analysis(context, content)
    new_record = models.AggregateAIAnalysis(
        campaign_id=campaign_id, scope_type=scope_type, scope_id=scope_id,
        version=_version(db, context), parent_analysis_id=record.id, status="draft", is_current_approved=False,
        analysis=validated.model_dump(mode="json"), evidence_summary=_evidence_summary(context, validated),
        model_identifier=record.model_identifier, generated_at=record.generated_at,
        generated_by_user_id=record.generated_by_user_id, edited_at=datetime.now(timezone.utc),
        edited_by_user_id=actor.id, source_fingerprint=context.source_fingerprint, schema_version=1,
    )
    db.add(new_record)
    db.commit()
    db.refresh(new_record)
    return _serialize(new_record, context.source_fingerprint)


def approve(db: Session, campaign_id: int, scope_type: str, scope_id: int | None,
            analysis_id: int, *, actor: models.User) -> dict:
    _context(db, campaign_id, scope_type, scope_id, actor)
    _writable(db, campaign_id, actor)
    db.rollback()
    _lock_campaign(db, campaign_id)
    context = _context(db, campaign_id, scope_type, scope_id, actor)
    _writable(db, campaign_id, actor)
    record = _record(db, context, analysis_id)
    if record.status != "draft":
        raise HTTPException(status_code=409, detail="Only Draft versions can be approved")
    if record.source_fingerprint != context.source_fingerprint or not context.evidence:
        raise HTTPException(status_code=409, detail="Outdated analysis; regenerate before approval")
    try:
        validate_aggregate_ai_analysis(context, EmployeeAIAnalysis.model_validate(record.analysis))
    except (AnalysisGenerationError, ValueError):
        raise HTTPException(status_code=409, detail="Analysis evidence is no longer valid; regenerate") from None
    prior = _query(db, context).filter(models.AggregateAIAnalysis.is_current_approved.is_(True)).first()
    if prior is not None:
        prior.is_current_approved = False
        db.flush()
    record.status = "approved"
    record.is_current_approved = True
    record.approved_at = datetime.now(timezone.utc)
    record.approved_by_user_id = actor.id
    db.commit()
    db.refresh(record)
    return _serialize(record, context.source_fingerprint)

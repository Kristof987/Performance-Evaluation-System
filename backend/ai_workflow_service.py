"""Authorized, versioned HR review of individual analyses (no employee publication)."""

from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json

from fastapi import HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

import models
import reporting_service
from ai_analysis_models import EmployeeAIAnalysis, EmployeeAnalysisContext
from ai_analysis_service import build_employee_analysis_context
from ai_generation_service import (
    AnalysisGenerationError, _prompt_data, _verify_analysis,
    generate_employee_ai_analysis_from_context,
)


def can_manage(actor: models.User, db: Session) -> bool:
    return db.query(models.User.id).join(models.SystemRole, models.SystemRole.id == models.User.system_role_id).join(
        models.system_role_permissions, models.system_role_permissions.c.system_role_id == models.SystemRole.id,
    ).join(models.SystemPermission, models.SystemPermission.id == models.system_role_permissions.c.permission_id).filter(
        models.User.id == actor.id, models.User.is_active.is_(True),
        models.SystemPermission.name == "campaigns.manage",
    ).first() is not None


def _writable(context: EmployeeAnalysisContext, db: Session, actor: models.User) -> None:
    if not can_manage(actor, db):
        raise HTTPException(status_code=403, detail="Analysis management permission required")
    campaign = db.query(models.Campaign).filter(models.Campaign.id == context.campaign_id).first()
    if campaign.is_archived:
        raise HTTPException(status_code=409, detail="Archived campaigns allow historical viewing only")


def _fingerprint(db: Session, campaign_id: int, employee_id: int) -> str:
    """Hash the complete submitted source set, including issued snapshots and answers.

    Invalid historical submissions are included: fixing their content must make older
    analyses stale too. Draft answers are excluded exactly as in Phase 1.
    """
    digest = sha256(b"employee-ai-source-v1\n")
    rows = db.query(models.FilledForm, models.FormStatus.name).join(
        models.FormStatus, models.FormStatus.id == models.FilledForm.status_id,
    ).filter(models.FilledForm.campaign_id == campaign_id, models.FilledForm.evaluatee_id == employee_id).order_by(models.FilledForm.id).all()
    for form, status in rows:
        if status.strip().lower() not in reporting_service.COMPLETED_STATUSES or form.finish_date is None:
            continue
        source = [form.id, form.evaluator_id, form.evaluatee_id, form.company_group_id, form.form_id,
                  form.finish_date.isoformat(), status.strip().lower(), form.form_snapshot, form.answers]
        digest.update(json.dumps(source, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def _version(db: Session, campaign_id: int, employee_id: int) -> int:
    return (db.query(func.max(models.EmployeeAIAnalysis.version)).filter(
        models.EmployeeAIAnalysis.campaign_id == campaign_id,
        models.EmployeeAIAnalysis.evaluatee_employee_id == employee_id,
    ).scalar() or 0) + 1


def _record(db: Session, campaign_id: int, employee_id: int, analysis_id: int) -> models.EmployeeAIAnalysis:
    item = db.query(models.EmployeeAIAnalysis).filter(
        models.EmployeeAIAnalysis.id == analysis_id, models.EmployeeAIAnalysis.campaign_id == campaign_id,
        models.EmployeeAIAnalysis.evaluatee_employee_id == employee_id,
    ).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Analysis version not found")
    return item


def _citations(analysis: EmployeeAIAnalysis) -> set[str]:
    return {evidence_id for finding in [analysis.overall_assessment, *analysis.strengths, *analysis.development_areas]
            for evidence_id in finding.supporting_evidence_ids}


def _evidence_summary(context: EmployeeAnalysisContext, analysis: EmployeeAIAnalysis) -> dict:
    """Freeze only cited, reportable aggregates and self feedback; never raw peer answers."""
    written = {item.reference.evidence_id: item.response_text for item in context.qualitative_evidence
               if item.reference.category == "self"}
    result = {}
    for ref in context.evidence_references:
        if ref.evidence_id not in _citations(analysis):
            continue
        detail = {"question_text": ref.question_text, "section_name": ref.section_name, "category": ref.category,
                  "question_statistics": [], "section_statistics": []}
        if ref.category == "self":
            detail.update({"original_value": ref.original_value, "normalized_value": ref.normalized_value})
            if ref.evidence_id in written:
                detail["response_text"] = written[ref.evidence_id]
        for question in context.questions:
            score = question.peer if ref.category == "peer" else question.self_evaluation
            if score.availability == "available" and ref.evidence_id in score.evidence_ids:
                detail["question_statistics"].append({
                    "question_text": question.question_text, "average_normalized": score.average_normalized,
                    "answer_count": score.answer_count,
                    "original_distribution": [bin_.model_dump() for bin_ in score.original_distribution],
                    "scale_min": question.scale_min, "scale_max": question.scale_max,
                    "min_label": question.min_label, "max_label": question.max_label,
                })
        for section in context.sections:
            score = section.peer if ref.category == "peer" else section.self_evaluation
            if score.availability == "available" and ref.evidence_id in score.evidence_ids:
                detail["section_statistics"].append({"section_name": section.section_name,
                                                     "average_normalized": score.average_normalized,
                                                     "contributor_count": score.answer_count})
        result[ref.evidence_id] = detail
    if result.keys() != _citations(analysis):
        raise AnalysisGenerationError("invalid_analysis_evidence")
    return result


def _serialize(item: models.EmployeeAIAnalysis, fingerprint: str) -> dict:
    return {"id": item.id, "campaign_id": item.campaign_id, "evaluatee_employee_id": item.evaluatee_employee_id,
            "version": item.version, "parent_analysis_id": item.parent_analysis_id, "status": item.status,
            "is_current_approved": item.is_current_approved, "outdated": item.source_fingerprint != fingerprint,
            "analysis": item.analysis, "evidence": item.evidence_summary, "model_identifier": item.model_identifier,
            "generated_at": item.generated_at, "generated_by_user_id": item.generated_by_user_id,
            "edited_at": item.edited_at, "edited_by_user_id": item.edited_by_user_id,
            "approved_at": item.approved_at, "approved_by_user_id": item.approved_by_user_id,
            "schema_version": item.schema_version}


def list_analyses(db: Session, campaign_id: int, employee_id: int, *, actor: models.User) -> dict:
    context = build_employee_analysis_context(db, campaign_id, employee_id, actor=actor)
    fingerprint = _fingerprint(db, campaign_id, employee_id)
    records = db.query(models.EmployeeAIAnalysis).filter(
        models.EmployeeAIAnalysis.campaign_id == campaign_id,
        models.EmployeeAIAnalysis.evaluatee_employee_id == employee_id,
    ).order_by(models.EmployeeAIAnalysis.version.desc()).all()
    campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
    return {"versions": [_serialize(item, fingerprint) for item in records],
            "can_manage": can_manage(actor, db) and not campaign.is_archived,
            "has_eligible_evidence": bool(context.evidence_references)}


def _lock_campaign(db: Session, campaign_id: int) -> None:
    db.query(models.Campaign).filter(models.Campaign.id == campaign_id).populate_existing().with_for_update().one()


def generate(db: Session, campaign_id: int, employee_id: int, *, actor: models.User) -> dict:
    context = build_employee_analysis_context(db, campaign_id, employee_id, actor=actor)
    _writable(context, db, actor)
    # Phase 1's shared campaign lock must not remain held while waiting on OpenAI.
    db.rollback()
    lock_key = int.from_bytes(sha256(f"compass:employee-ai:{campaign_id}:{employee_id}".encode()).digest()[:8], "big", signed=True)
    with db.get_bind().connect() as lease:
        acquired = lease.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": lock_key}).scalar()
        lease.commit()
        if not acquired:
            raise HTTPException(status_code=409, detail="Analysis generation is already in progress")
        try:
            context = build_employee_analysis_context(db, campaign_id, employee_id, actor=actor)
            _writable(context, db, actor)
            previous = db.query(models.EmployeeAIAnalysis.generated_at).filter(
                models.EmployeeAIAnalysis.campaign_id == campaign_id,
                models.EmployeeAIAnalysis.evaluatee_employee_id == employee_id,
                models.EmployeeAIAnalysis.parent_analysis_id.is_(None),
            ).order_by(models.EmployeeAIAnalysis.generated_at.desc()).first()
            if previous and previous[0] > datetime.now(timezone.utc) - timedelta(seconds=30):
                raise HTTPException(status_code=409, detail="Please wait before regenerating this analysis")
            fingerprint = _fingerprint(db, campaign_id, employee_id)
            db.rollback()
            analysis, model = generate_employee_ai_analysis_from_context(context)
            _lock_campaign(db, campaign_id)
            fresh = build_employee_analysis_context(db, campaign_id, employee_id, actor=actor)
            _writable(fresh, db, actor)
            if _fingerprint(db, campaign_id, employee_id) != fingerprint:
                raise HTTPException(status_code=409, detail="Submitted evaluations changed; generate again")
            now = datetime.now(timezone.utc)
            record = models.EmployeeAIAnalysis(
                campaign_id=campaign_id, evaluatee_employee_id=employee_id, version=_version(db, campaign_id, employee_id),
                status="draft", is_current_approved=False, analysis=analysis.model_dump(mode="json"),
                evidence_summary=_evidence_summary(context, analysis), model_identifier=model,
                generated_at=now, generated_by_user_id=actor.id, source_fingerprint=fingerprint, schema_version=1,
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


def edit(db: Session, campaign_id: int, employee_id: int, analysis_id: int,
         content: EmployeeAIAnalysis, *, actor: models.User) -> dict:
    initial = build_employee_analysis_context(db, campaign_id, employee_id, actor=actor)
    _writable(initial, db, actor)
    db.rollback()
    _lock_campaign(db, campaign_id)
    context = build_employee_analysis_context(db, campaign_id, employee_id, actor=actor)
    _writable(context, db, actor)
    record = _record(db, campaign_id, employee_id, analysis_id)
    if record.status != "draft":
        raise HTTPException(status_code=409, detail="Approved versions are read-only")
    if record.version != _version(db, campaign_id, employee_id) - 1:
        raise HTTPException(status_code=409, detail="Only the latest Draft version can be edited")
    fingerprint = _fingerprint(db, campaign_id, employee_id)
    if record.source_fingerprint != fingerprint:
        raise HTTPException(status_code=409, detail="Outdated analysis; regenerate before editing")
    _payload, categories, statistics = _prompt_data(context)
    validated = _verify_analysis(content, categories, context, statistics)
    now = datetime.now(timezone.utc)
    new_record = models.EmployeeAIAnalysis(
        campaign_id=campaign_id, evaluatee_employee_id=employee_id, version=_version(db, campaign_id, employee_id),
        parent_analysis_id=record.id, status="draft", is_current_approved=False,
        analysis=validated.model_dump(mode="json"), evidence_summary=_evidence_summary(context, validated),
        model_identifier=record.model_identifier, generated_at=record.generated_at,
        generated_by_user_id=record.generated_by_user_id, edited_at=now, edited_by_user_id=actor.id,
        source_fingerprint=fingerprint, schema_version=1,
    )
    db.add(new_record)
    db.commit()
    db.refresh(new_record)
    return _serialize(new_record, fingerprint)


def approve(db: Session, campaign_id: int, employee_id: int, analysis_id: int, *, actor: models.User) -> dict:
    initial = build_employee_analysis_context(db, campaign_id, employee_id, actor=actor)
    _writable(initial, db, actor)
    db.rollback()
    _lock_campaign(db, campaign_id)
    context = build_employee_analysis_context(db, campaign_id, employee_id, actor=actor)
    _writable(context, db, actor)
    record = _record(db, campaign_id, employee_id, analysis_id)
    if record.status != "draft":
        raise HTTPException(status_code=409, detail="Only Draft versions can be approved")
    fingerprint = _fingerprint(db, campaign_id, employee_id)
    if record.source_fingerprint != fingerprint:
        raise HTTPException(status_code=409, detail="Outdated analysis; regenerate before approval")
    try:
        content = EmployeeAIAnalysis.model_validate(record.analysis)
        _payload, categories, statistics = _prompt_data(context)
        _verify_analysis(content, categories, context, statistics)
    except Exception as error:
        if isinstance(error, (AnalysisGenerationError, ValueError)):
            raise HTTPException(status_code=409, detail="Analysis evidence is no longer valid; regenerate") from None
        raise
    prior = db.query(models.EmployeeAIAnalysis).filter(
        models.EmployeeAIAnalysis.campaign_id == campaign_id,
        models.EmployeeAIAnalysis.evaluatee_employee_id == employee_id,
        models.EmployeeAIAnalysis.is_current_approved.is_(True),
    ).first()
    if prior is not None:
        prior.is_current_approved = False
        db.flush()
    record.status = "approved"
    record.is_current_approved = True
    record.approved_at = datetime.now(timezone.utc)
    record.approved_by_user_id = actor.id
    db.commit()
    db.refresh(record)
    return _serialize(record, fingerprint)

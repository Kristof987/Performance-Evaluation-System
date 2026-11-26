"""AI generation runs in a background job, so leaving the page cannot cancel a paid request.

The backend runs as one process with one worker thread: jobs are taken one at a time, and a
partial unique index allows only one queued or running job per subject. A job that was running
when the process stopped is marked failed at the next start instead of being sent again, because
the outcome of its paid request is unknown.
"""

from datetime import datetime, timezone
import logging
from threading import Event, Thread

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from services import reporting_service
from services import workspace_settings_service
from services.ai_analysis_service import build_employee_analysis_context
from services.ai_generation_service import AnalysisGenerationError, model_override
from services.ai_workflow_service import _writable, generate as generate_employee
from services.ai_aggregate_workflow_service import _context as aggregate_context, _writable as aggregate_writable, generate as generate_aggregate
from database import SessionLocal


logger = logging.getLogger(__name__)
ACTIVE = ("queued", "running")


def _subject_query(db: Session, campaign_id: int, scope_type: str, scope_id: int | None):
    if scope_type not in {"employee", "group", "role", "campaign"} or (scope_id is None) != (scope_type == "campaign"):
        raise HTTPException(status_code=404, detail="Analysis scope not found")
    return db.query(models.AIAnalysisGenerationJob).filter(
        models.AIAnalysisGenerationJob.campaign_id == campaign_id,
        models.AIAnalysisGenerationJob.scope_type == scope_type,
        models.AIAnalysisGenerationJob.scope_id == scope_id,
    )


def _check_can_generate(db: Session, campaign_id: int, scope_type: str, scope_id: int | None, actor: models.User) -> None:
    if scope_type == "employee":
        context = build_employee_analysis_context(db, campaign_id, scope_id, actor=actor)
        _writable(context, db, actor)
        has_evidence = bool(context.evidence_references)
    else:
        context = aggregate_context(db, campaign_id, scope_type, scope_id, actor)
        aggregate_writable(db, campaign_id, actor)
        has_evidence = bool(context.evidence)
    if not has_evidence:
        raise HTTPException(status_code=422, detail="insufficient_analysis_data")


def _serialize(job: models.AIAnalysisGenerationJob) -> dict:
    return {"id": job.id, "status": job.status, "analysis_id": job.analysis_id,
            "error_code": job.error_code, "created_at": job.created_at,
            "started_at": job.started_at, "finished_at": job.finished_at}


def start(db: Session, campaign_id: int, scope_type: str, scope_id: int | None, *, actor: models.User) -> dict:
    _subject_query(db, campaign_id, scope_type, scope_id)
    _check_can_generate(db, campaign_id, scope_type, scope_id, actor)
    workspace_settings_service.require_ai_enabled(db)
    active = _subject_query(db, campaign_id, scope_type, scope_id).filter(models.AIAnalysisGenerationJob.status.in_(ACTIVE))
    if (existing := active.first()) is not None:
        return _serialize(existing)
    job = models.AIAnalysisGenerationJob(
        campaign_id=campaign_id, scope_type=scope_type, scope_id=scope_id,
        status="queued", requested_by_user_id=actor.id, created_at=datetime.now(timezone.utc),
    )
    db.add(job)
    try:
        db.commit()
    except IntegrityError:  # A second click raced the first one: show the job that won.
        db.rollback()
        return _serialize(active.one())
    db.refresh(job)
    return _serialize(job)


def status(db: Session, campaign_id: int, scope_type: str, scope_id: int | None,
           *, actor: models.User, job_id: int | None = None) -> dict | None:
    """Polled every few seconds; the route has already checked who may see this subject."""
    reporting_service.require_reports_access(campaign_id, actor, db)
    query = _subject_query(db, campaign_id, scope_type, scope_id)
    job = (query.filter(models.AIAnalysisGenerationJob.id == job_id).first() if job_id is not None
           else query.order_by(models.AIAnalysisGenerationJob.id.desc()).first())
    if job_id is not None and job is None:
        raise HTTPException(status_code=404, detail="Generation job not found")
    return _serialize(job) if job else None


def _finish(db: Session, job_id: int, error_code: str) -> None:
    job = db.get(models.AIAnalysisGenerationJob, job_id)
    if job is not None and job.status == "running":  # A saved result has already marked it succeeded.
        job.status = "failed"
        job.error_code = error_code
        job.finished_at = datetime.now(timezone.utc)
        db.commit()


def _error_code(error: Exception) -> str:
    if isinstance(error, AnalysisGenerationError):
        return error.code
    if isinstance(error, HTTPException):
        return {403: "authorization_changed", 404: "scope_unavailable", 409: "generation_conflict",
                422: "insufficient_analysis_data"}.get(error.status_code, "analysis_generation_failed")
    return "analysis_generation_failed"


def _execute(job_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.get(models.AIAnalysisGenerationJob, job_id)
        actor = db.get(models.User, job.requested_by_user_id)
        if actor is None:
            raise HTTPException(status_code=403, detail="Requesting user is no longer available")
        settings = workspace_settings_service.get_settings(db)
        if not settings.ai_enabled:  # Switched off after the job was queued.
            raise AnalysisGenerationError("analysis_disabled")
        with model_override(settings.ai_model):
            if job.scope_type == "employee":
                generate_employee(db, job.campaign_id, job.scope_id, actor=actor, job_id=job_id)
            else:
                generate_aggregate(db, job.campaign_id, job.scope_type, job.scope_id, actor=actor, job_id=job_id)
    except Exception as error:
        db.rollback()
        if not isinstance(error, (AnalysisGenerationError, HTTPException)):
            logger.warning("AI generation worker failed: category=unexpected_error")
        _finish(db, job_id, _error_code(error))
    finally:
        db.close()


def _next_job(db: Session) -> int | None:
    job = db.query(models.AIAnalysisGenerationJob).filter(
        models.AIAnalysisGenerationJob.status == "queued").order_by(models.AIAnalysisGenerationJob.id).first()
    if job is None:
        db.rollback()
        return None
    job.status = "running"
    job.started_at = datetime.now(timezone.utc)
    db.commit()
    return job.id


def _recover_interrupted() -> None:
    """A job left running by a stopped process is failed, never sent to the provider twice."""
    with SessionLocal() as db:
        db.query(models.AIAnalysisGenerationJob).filter(models.AIAnalysisGenerationJob.status == "running").update(
            {"status": "failed", "error_code": "worker_interrupted", "finished_at": datetime.now(timezone.utc)})
        db.commit()


def _loop(stop: Event) -> None:
    try:
        _recover_interrupted()
    except Exception:
        logger.warning("AI generation worker recovery failed: category=database_unavailable")
    while not stop.is_set():
        job_id = None
        try:
            with SessionLocal() as db:
                job_id = _next_job(db)
            if job_id is not None:
                _execute(job_id)
        except Exception:
            logger.warning("AI generation worker loop failed: category=database_unavailable")
        if job_id is None:
            stop.wait(2)


def start_worker() -> tuple[Event, Thread]:
    stop = Event()
    worker = Thread(target=_loop, args=(stop,), name="ai-analysis-jobs", daemon=True)
    worker.start()
    return stop, worker

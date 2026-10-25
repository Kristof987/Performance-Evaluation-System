"""Durable, subject-scoped AI generation queue; browser navigation cannot cancel work.

Multiple backend processes may run workers: SKIP LOCKED claims exactly one queued
job, while a partial unique index prevents a second active job per subject. A
running job is never replayed after a crash: it fails after its lease expires,
avoiding another paid request whose first outcome may be unknown.
"""

from datetime import datetime, timedelta, timezone
import logging
from threading import Event, Thread
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
import reporting_service
from ai_analysis_service import build_employee_analysis_context
from ai_generation_service import AnalysisGenerationError
from ai_workflow_service import _writable, generate as generate_employee
from ai_aggregate_workflow_service import _context as aggregate_context, _writable as aggregate_writable, generate as generate_aggregate
from database import SessionLocal


logger = logging.getLogger(__name__)
_RUN_LEASE = timedelta(minutes=10)  # Two bounded provider calls plus DB construction.
_QUEUE_LIMIT = timedelta(minutes=30)


def _subject_query(db: Session, campaign_id: int, scope_type: str, scope_id: int | None):
    if scope_type not in {"employee", "group", "role", "campaign"} or (scope_id is None) != (scope_type == "campaign"):
        raise HTTPException(status_code=404, detail="Analysis scope not found")
    return db.query(models.AIAnalysisGenerationJob).filter(
        models.AIAnalysisGenerationJob.campaign_id == campaign_id,
        models.AIAnalysisGenerationJob.scope_type == scope_type,
        models.AIAnalysisGenerationJob.scope_id == scope_id,
    )


def _authorize(db: Session, campaign_id: int, scope_type: str, scope_id: int | None,
               actor: models.User, *, write: bool) -> None:
    if scope_type == "employee":
        context = build_employee_analysis_context(db, campaign_id, scope_id, actor=actor)
        if write:
            _writable(context, db, actor)
            if not context.evidence_references:
                raise HTTPException(status_code=422, detail="insufficient_analysis_data")
    else:
        context = aggregate_context(db, campaign_id, scope_type, scope_id, actor)
        if write:
            aggregate_writable(db, campaign_id, actor)
            if not context.evidence:
                raise HTTPException(status_code=422, detail="insufficient_analysis_data")


def _serialize(job: models.AIAnalysisGenerationJob) -> dict:
    return {"id": job.id, "status": job.status, "analysis_id": job.analysis_id,
            "error_code": job.error_code, "created_at": job.created_at,
            "started_at": job.started_at, "finished_at": job.finished_at}


def start(db: Session, campaign_id: int, scope_type: str, scope_id: int | None, *, actor: models.User) -> dict:
    _subject_query(db, campaign_id, scope_type, scope_id)
    _authorize(db, campaign_id, scope_type, scope_id, actor, write=True)
    existing = _subject_query(db, campaign_id, scope_type, scope_id).filter(
        models.AIAnalysisGenerationJob.status.in_(("queued", "running")),
    ).first()
    if existing:
        return _serialize(existing)
    job = models.AIAnalysisGenerationJob(
        campaign_id=campaign_id, scope_type=scope_type, scope_id=scope_id,
        status="queued", requested_by_user_id=actor.id, created_at=datetime.now(timezone.utc),
    )
    db.add(job)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _subject_query(db, campaign_id, scope_type, scope_id).filter(
            models.AIAnalysisGenerationJob.status.in_(("queued", "running")),
        ).first()
        if existing is None:
            raise
        return _serialize(existing)
    db.refresh(job)
    return _serialize(job)


def status(db: Session, campaign_id: int, scope_type: str, scope_id: int | None,
           *, actor: models.User, job_id: int | None = None) -> dict | None:
    query = _subject_query(db, campaign_id, scope_type, scope_id)
    try:
        _authorize(db, campaign_id, scope_type, scope_id, actor, write=False)
    except HTTPException as error:
        # An assigned group/role can be removed after a job was accepted. Only
        # its already-persisted subject job remains visible to Reports readers.
        if error.status_code != 404 or scope_type not in {"group", "role"}:
            raise
        reporting_service.require_reports_access(campaign_id, actor, db)
        if query.first() is None:
            raise error
    job = (query.filter(models.AIAnalysisGenerationJob.id == job_id).first() if job_id is not None
           else query.order_by(models.AIAnalysisGenerationJob.id.desc()).first())
    if job_id is not None and job is None:
        raise HTTPException(status_code=404, detail="Generation job not found")
    return _serialize(job) if job else None


def _expire(db: Session, now: datetime) -> None:
    stale = db.query(models.AIAnalysisGenerationJob).filter(
        ((models.AIAnalysisGenerationJob.status == "running") &
         ((models.AIAnalysisGenerationJob.lease_expires_at < now) |
          models.AIAnalysisGenerationJob.lease_expires_at.is_(None))) |
        ((models.AIAnalysisGenerationJob.status == "queued") &
         (models.AIAnalysisGenerationJob.created_at < now - _QUEUE_LIMIT)),
    ).with_for_update(skip_locked=True).all()
    for job in stale:
        job.error_code = "worker_interrupted" if job.status == "running" else "generation_queue_expired"
        job.status = "failed"
        job.finished_at = now
        job.worker_token = None
        job.lease_expires_at = None
    db.commit()


def _claim(db: Session) -> tuple[int, str] | None:
    job = db.query(models.AIAnalysisGenerationJob).filter(
        models.AIAnalysisGenerationJob.status == "queued",
    ).order_by(models.AIAnalysisGenerationJob.id).with_for_update(skip_locked=True).first()
    if job is None:
        db.rollback()
        return None
    token = str(uuid4())
    now = datetime.now(timezone.utc)
    job.status = "running"
    job.started_at = now
    job.lease_expires_at = now + _RUN_LEASE
    job.worker_token = token
    job_id = job.id
    db.commit()
    return job_id, token


def _fail(db: Session, job_id: int, token: str, code: str) -> None:
    job = db.query(models.AIAnalysisGenerationJob).filter(
        models.AIAnalysisGenerationJob.id == job_id,
    ).with_for_update().first()
    if job is not None and job.status == "running" and job.worker_token == token:
        job.status = "failed"
        job.error_code = code
        job.finished_at = datetime.now(timezone.utc)
        job.lease_expires_at = None
        job.worker_token = None
        db.commit()
    else:
        db.rollback()  # A successful result and its job state may already have committed.


def _execute(job_id: int, token: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(models.AIAnalysisGenerationJob, job_id)
        if job is None or job.status != "running" or job.worker_token != token:
            return
        actor = db.get(models.User, job.requested_by_user_id)
        if actor is None:
            raise HTTPException(status_code=403, detail="Requesting user is no longer available")
        if job.scope_type == "employee":
            generate_employee(db, job.campaign_id, job.scope_id, actor=actor, job_id=job_id, worker_token=token)
        else:
            generate_aggregate(db, job.campaign_id, job.scope_type, job.scope_id,
                               actor=actor, job_id=job_id, worker_token=token)
    except AnalysisGenerationError as error:
        db.rollback()
        _fail(db, job_id, token, error.code if error.code in {
            "analysis_timeout", "analysis_rate_limited", "analysis_provider_unavailable",
            "invalid_analysis_output", "invalid_analysis_evidence", "invalid_analysis_claim",
            "analysis_refused_or_empty", "analysis_not_configured", "invalid_analysis_configuration",
            "analysis_context_too_large", "insufficient_analysis_data", "invalid_analysis_context",
        } else "analysis_generation_failed")
    except HTTPException as error:
        db.rollback()
        _fail(db, job_id, token, {403: "authorization_changed", 404: "scope_unavailable",
                                  409: "generation_conflict", 422: "insufficient_analysis_data"}.get(error.status_code,
                                                                                                 "analysis_generation_failed"))
    except Exception:
        db.rollback()
        logger.warning("AI generation worker failed: category=unexpected_error")
        _fail(db, job_id, token, "analysis_generation_failed")
    finally:
        db.close()


def _loop(stop: Event) -> None:
    while not stop.is_set():
        claimed = None
        try:
            with SessionLocal() as db:
                _expire(db, datetime.now(timezone.utc))
                claimed = _claim(db)
            if claimed:
                _execute(*claimed)
        except Exception:
            logger.warning("AI generation worker loop failed: category=database_unavailable")
        if not claimed:
            stop.wait(2)


def start_worker() -> tuple[Event, Thread]:
    stop = Event()
    worker = Thread(target=_loop, args=(stop,), name="ai-analysis-jobs", daemon=True)
    worker.start()
    return stop, worker

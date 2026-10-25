"""Opt-in local-only storage for rejected AI validation attempts.

Artifacts contain HR data. Do not import this module into an API route.
"""

import json
import os
import re
import stat
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4


_NAME = re.compile(r"^job-(?:\d+|direct)-attempt-[12]-[a-f0-9]{32}\.json$")
_LIFETIME = timedelta(hours=24)


class ArtifactInputError(ValueError):
    """Safe, data-free description of a local artifact input error."""


def enabled() -> bool:
    # Fail closed unless the operator explicitly identifies a local development run.
    return (os.getenv("COMPASS_RUNTIME_ENV") == "local"
            and os.getenv("COMPASS_AI_DIAGNOSTICS") == "1"
            and os.getenv("APP_ENV", "").lower() not in {"production", "prod", "staging"}
            and os.getenv("ENVIRONMENT", "").lower() not in {"production", "prod", "staging"}
            and not os.getenv("KUBERNETES_SERVICE_HOST"))


def _directory() -> Path:
    if not enabled():
        raise RuntimeError("Local AI diagnostics are disabled")
    base = Path(tempfile.gettempdir()).resolve()
    if os.name == "nt" and not base.is_relative_to(Path.home().resolve()):
        raise RuntimeError("Local diagnostics require a per-user temporary directory")
    directory = base / "compass-ai-diagnostics"
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        pass
    if directory.is_symlink() or not directory.is_dir():
        raise RuntimeError("Unsafe local diagnostics directory")
    if os.name != "nt" and (directory.stat().st_mode & 0o077 or directory.stat().st_uid != os.getuid()):
        raise RuntimeError("Local diagnostics directory is not private or owned by this user")
    return directory


def _expire(directory: Path) -> None:
    cutoff = (datetime.now(timezone.utc) - _LIFETIME).timestamp()
    for path in directory.iterdir():
        if _NAME.fullmatch(path.name) and path.is_file() and not path.is_symlink() and path.stat().st_mtime < cutoff:
            path.unlink()


def capture(job_id: int | None, attempt: int, artifact: dict) -> None:
    if not enabled():
        return
    directory = _directory()
    _expire(directory)
    content = json.dumps(artifact, ensure_ascii=False, indent=2).encode("utf-8")
    if len(content) > 2_000_000:
        raise RuntimeError("Local AI diagnostics artifact exceeds size limit")
    path = directory / f"job-{job_id if job_id is not None else 'direct'}-attempt-{attempt}-{uuid4().hex}.json"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
        if os.name != "nt" and stat.S_IMODE(path.stat().st_mode) != 0o600:
            path.unlink()
            raise RuntimeError("Local diagnostics artifact is not private")
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def load(name: str) -> dict:
    directory = _directory()
    _expire(directory)
    supplied = Path(name)
    if not _NAME.fullmatch(supplied.name):
        raise ArtifactInputError("Expected a job-<id>-attempt-<n>-<uuid>.json artifact")
    path = supplied if supplied.is_absolute() else directory / supplied
    if path.is_symlink() or not path.is_file() or path.resolve().parent != directory:
        raise ArtifactInputError("Artifact is unavailable or outside the private diagnostics directory")
    if os.name != "nt" and (path.stat().st_mode & 0o077 or path.stat().st_uid != os.getuid()):
        raise ArtifactInputError("Artifact permissions are not private")
    with path.open("r", encoding="utf-8") as stream:
        return json.load(stream)


def replay(name: str) -> dict:
    """Validate the captured response and registry offline; no DB or provider calls."""
    from decimal import Decimal

    from ai_analysis_models import GeneratedAnalysis
    from ai_generation_service import (AnalysisGenerationError, _AuthorizedFact, _Statistic,
                                       _failure_detail, _resolve_generated_analysis, _verify_with_comparisons)

    artifact = load(name)
    if artifact.get("format") != 1:
        raise ArtifactInputError("Unsupported diagnostic artifact format")
    analysis = GeneratedAnalysis.model_validate(artifact["generated_output"])
    registry = {handle: _AuthorizedFact(
        identifier=item["identifier"], kind=item["kind"], scope=item["scope"],
        subject=item["subject"], description=item["description"], limitation=item["limitation"],
        evidence_ids=frozenset(item["evidence_ids"]), statistic_ids=tuple(item["statistic_ids"]),
        statistic_values=tuple(Decimal(value) for value in item["statistic_values"]),
        operands=tuple(item["operands"]), direction=item["direction"],
    ) for handle, item in artifact["registry"].items()}
    categories = artifact["categories"]
    statistics = {identifier: _Statistic(
        Decimal(item["value"]), item["unit"], frozenset(item["evidence_ids"]),
        item["description"], item["denominator"],
    ) for identifier, item in artifact["statistics"].items()}
    performance = artifact.get("performance_evidence_ids")

    def validate(canonical):
        if performance is not None and not set(performance).intersection(
                canonical.overall_assessment.supporting_evidence_ids):
            raise AnalysisGenerationError("invalid_analysis_evidence", category="missing_performance_evidence",
                                          diagnostic={"section": "overall_assessment", "finding_index": 0,
                                                      "validator": "_verify_aggregate_analysis",
                                                      "rule": "missing_performance_evidence",
                                                      "reason": "The overall finding selects no released performance evidence.",
                                                      "required_fact": "released question, section or overall performance fact"})
        return _verify_with_comparisons(canonical, categories, statistics, [], {}, {},
                                        registry={fact.identifier: fact for fact in registry.values()},
                                        require_fact_ids=True)

    try:
        _resolve_generated_analysis(analysis, registry, validate)
    except AnalysisGenerationError as error:
        return {"accepted": False, "job_id": artifact["job_id"], "attempt": artifact["attempt"],
                "category": error.category, "failure": _failure_detail(error, analysis, registry)}
    return {"accepted": True, "job_id": artifact["job_id"], "attempt": artifact["attempt"]}


if __name__ == "__main__":
    import argparse
    from decimal import InvalidOperation

    from pydantic import ValidationError

    parser = argparse.ArgumentParser(description="Replay a local AI validation artifact without OpenAI or database access")
    parser.add_argument("artifact", help="Artifact filename or full path within the private diagnostics directory")
    args = parser.parse_args()
    try:
        result = replay(args.artifact)
    except ArtifactInputError as error:
        parser.exit(2, f"Replay unavailable: {error}\n")
    except RuntimeError:
        parser.exit(2, "Replay unavailable: local diagnostic mode is disabled or its directory is unsafe\n")
    except (ValidationError, InvalidOperation, ValueError, KeyError, TypeError):
        parser.exit(2, "Replay unavailable: captured artifact is invalid or incompatible with the current schema\n")
    except OSError:
        parser.exit(2, "Replay unavailable: artifact could not be read\n")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result["accepted"] else 1)

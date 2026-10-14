from copy import deepcopy
from typing import Any

from sqlalchemy.orm import Session

import models


def normalize_dimension_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


def scope_key_for_user(_user: models.User | None = None) -> str:
    # The current schema has no company/tenant table. Keep scope explicit so a future
    # organization model can replace this without changing question JSON shape.
    return "default"


def dimension_payload(dimension: models.PerformanceDimension) -> dict[str, Any]:
    return {
        "id": dimension.id,
        "name": dimension.name,
        "is_active": dimension.is_active,
    }


def create_form_snapshot(form: models.Form, db: Session) -> dict[str, Any]:
    questions = deepcopy(form.questions if isinstance(form.questions, list) else [])
    for question in questions:
        if not isinstance(question, dict):
            continue
        dimension_id = question.get("dimension_id") or question.get("dimensionId")
        if dimension_id is None and isinstance(question.get("dimension"), dict):
            dimension_id = question["dimension"].get("id")
        if isinstance(dimension_id, int):
            dimension = db.query(models.PerformanceDimension).filter(models.PerformanceDimension.id == dimension_id).first()
            if dimension is not None:
                question["dimension_id"] = dimension.id
                question["dimension"] = dimension_payload(dimension)
        question.setdefault("scale_direction", "higher_is_better")
    return {
        "schema_version": 1,
        "source": "issued_form_snapshot",
        "form_id": form.id,
        "form_name": form.name,
        "form_description": form.description,
        "questions": questions,
    }


def snapshot_questions(filled_form: models.FilledForm, form: models.Form | None = None) -> list[dict[str, Any]]:
    snapshot = filled_form.form_snapshot if isinstance(filled_form.form_snapshot, dict) else None
    if snapshot is not None and isinstance(snapshot.get("questions"), list):
        return snapshot["questions"]
    return form.questions if form is not None and isinstance(form.questions, list) else []


def snapshot_form_name(filled_form: models.FilledForm, form: models.Form) -> str:
    snapshot = filled_form.form_snapshot if isinstance(filled_form.form_snapshot, dict) else None
    name = snapshot.get("form_name") if snapshot is not None else None
    return name if isinstance(name, str) and name.strip() else form.name


def snapshot_form_description(filled_form: models.FilledForm, form: models.Form) -> str | None:
    snapshot = filled_form.form_snapshot if isinstance(filled_form.form_snapshot, dict) else None
    if snapshot is not None and "form_description" in snapshot:
        description = snapshot.get("form_description")
        return description if isinstance(description, str) else None
    return form.description

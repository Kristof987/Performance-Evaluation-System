from copy import deepcopy
from typing import Any

from sqlalchemy.orm import Session

import models


def create_form_snapshot(form: models.Form, db: Session) -> dict[str, Any]:
    """Freeze a validated form for issuing, with each Section's name at that moment."""
    questions = deepcopy(form.questions)
    for block in questions:
        if block["type"] == "section":
            section = db.get(models.Section, block["section_id"])
            block["section"] = {"id": section.id, "name": section.name}
    for question in iter_snapshot_questions(questions):
        question.setdefault("scale_direction", "higher_is_better")
    return {
        "schema_version": 2,
        "source": "issued_form_snapshot",
        "form_id": form.id,
        "form_name": form.name,
        "form_description": form.description,
        "questions": questions,
    }


def iter_snapshot_questions(structure: list[dict[str, Any]]):
    """Traverse validated blocks in display order without discarding their grouping."""
    for item in structure:
        if item["type"] == "section":
            yield from item["questions"]
        else:
            yield item["question"]


def snapshot_form_name(filled_form: models.FilledForm, form: models.Form) -> str:
    # Pre-v2 snapshots have no name; they show the form's current one.
    return (filled_form.form_snapshot or {}).get("form_name") or form.name


def snapshot_form_description(filled_form: models.FilledForm, form: models.Form) -> str | None:
    snapshot = filled_form.form_snapshot or {}
    return snapshot["form_description"] if "form_description" in snapshot else form.description

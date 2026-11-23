from copy import deepcopy
from typing import Any

from sqlalchemy.orm import Session

import models


def create_form_snapshot(form: models.Form, db: Session) -> dict[str, Any]:
    questions = deepcopy(form.questions if isinstance(form.questions, list) else [])
    for block in questions:
        if isinstance(block, dict) and block.get("type") == "section" and isinstance(block.get("section_id"), int):
            section = db.query(models.Section).filter(models.Section.id == block["section_id"]).first()
            if section is not None:
                block["section"] = {"id": section.id, "name": section.name}
    for question in iter_snapshot_questions(questions):
        if not isinstance(question, dict):
            continue
        # The deep copy retains any self-contained legacy JSON metadata unchanged.
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
    """Traverse issued blocks in display order without discarding their grouping."""
    for item in structure:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "section":
            for question in item.get("questions", []):
                if isinstance(question, dict):
                    yield question
        elif item.get("type") == "question" and isinstance(item.get("question"), dict):
            yield item["question"]
        elif "text" in item:  # Previously issued flat questionnaires.
            yield item


def snapshot_questions(filled_form: models.FilledForm, form: models.Form | None = None) -> list[dict[str, Any]]:
    snapshot = filled_form.form_snapshot if isinstance(filled_form.form_snapshot, dict) else None
    if snapshot is not None:
        return snapshot["questions"] if isinstance(snapshot.get("questions"), list) else []
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

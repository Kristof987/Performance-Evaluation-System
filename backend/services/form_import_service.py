"""Turning the form Excel template into an editor draft.

Nothing is saved here: the result opens in the form editor, and the editor's normal save
validates and stores it. Sections are matched by name; unknown ones are reported so the
editor can create them for someone allowed to manage sections.
"""
from typing import Any, BinaryIO
from uuid import uuid4

from sqlalchemy.orm import Session

import models
from services import people_import_service, permissions
from services.form_service import MAX_LABELLED_SCALE_POINTS

FORM_HEADERS = ["Form Name", "Form Description"]
QUESTION_HEADERS = ["Section", "Question Text", "Question Type", "Required", "Help Text",
                    "Scale Min", "Scale Max", "Lowest Label", "Highest Label", "Options"]
QUESTION_TYPES = {"numerical scale": "Scale", "scale": "Scale", "text": "Text",
                  "single choice": "Single choice", "multiple choice": "Multiple choice"}
CHOICE_TYPES = {"Single choice", "Multiple choice"}
MAX_FORM_QUESTIONS = 200
MAX_NAME_LENGTH = 120


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return " ".join(str(value).split())


def _integer(value: Any) -> int | None:
    if value is None or _text(value) == "":
        return None
    try:
        number = float(str(value).strip())
    except ValueError:
        return None
    return int(number) if number.is_integer() else None


def _required(value: Any) -> bool | None:
    text = _text(value).casefold()
    if text in {"", "yes", "y", "true", "1"}:
        return True
    if text in {"no", "n", "false", "0"}:
        return False
    return None


def _question(row_number: int, cells: list[Any], errors: list[str]) -> dict[str, Any] | None:
    _section, text, kind, required, help_text, minimum, maximum, low_label, high_label, options = cells
    where = f"Questions row {row_number}"
    question_text = _text(text)
    question_type = QUESTION_TYPES.get(_text(kind).casefold())
    is_required = _required(required)
    problems = []
    if not question_text:
        problems.append("Question Text is required.")
    if question_type is None:
        problems.append("Question Type must be Numerical scale, Text, Single choice or Multiple choice.")
    if is_required is None:
        problems.append("Required must be Yes or No.")
    question: dict[str, Any] = {"id": str(uuid4()), "text": question_text, "type": question_type, "required": bool(is_required),
                                "helpText": _text(help_text), "scale_direction": None, "scale_min": None, "scale_max": None,
                                "min_label": None, "max_label": None, "options": None}
    if question_type == "Scale":
        low = 1 if _text(minimum) == "" else _integer(minimum)
        high = 5 if _text(maximum) == "" else _integer(maximum)
        if low is None or high is None:
            problems.append("Scale Min and Scale Max must be whole numbers.")
        elif high <= low:
            problems.append("Scale Max must be greater than Scale Min.")
        question.update(scale_direction="higher_is_better", scale_min=low, scale_max=high,
                        min_label=_text(low_label), max_label=_text(high_label))
        point_labels = [_text(label) for label in str(options or "").split(";")] if _text(options) else []
        if point_labels and low is not None and high is not None and high > low:
            points = high - low + 1
            if _text(low_label) or _text(high_label):
                problems.append("Use either Lowest/Highest Label or Options (one label per value), not both.")
            elif points > MAX_LABELLED_SCALE_POINTS:
                problems.append(f"Every value can be labelled only on scales of at most {MAX_LABELLED_SCALE_POINTS} values.")
            elif len(point_labels) != points or not all(point_labels):
                problems.append(f"Options must give exactly {points} labels for a {low}–{high} scale, one per value, separated by semicolons.")
            else:
                question.update(scale_labels=point_labels, min_label=point_labels[0], max_label=point_labels[-1])
    if question_type in CHOICE_TYPES:
        labels = [_text(label) for label in str(options or "").split(";")]
        labels = [label for label in labels if label]
        if len(labels) < 2:
            problems.append("Choice questions need at least two Options, separated by semicolons.")
        elif len({label.casefold() for label in labels}) != len(labels):
            problems.append("Options must be different from each other.")
        question["options"] = [{"id": str(uuid4()), "label": label} for label in labels]
    errors.extend(f"{where}: {problem}" for problem in problems)
    return None if problems else question


def parse_form_workbook(upload: BinaryIO, filename: str | None, actor: models.User, db: Session) -> dict[str, Any]:
    workbook = people_import_service.open_import_workbook(upload, filename, "form")
    try:
        form_rows = people_import_service.sheet_rows(workbook, FORM_HEADERS, 1, "The Form sheet must contain one form: fill in row 2 only.")
        question_rows = people_import_service.sheet_rows(
            workbook, QUESTION_HEADERS, MAX_FORM_QUESTIONS, f"A form can contain at most {MAX_FORM_QUESTIONS} questions.",
            skip_sheets=frozenset({"example"}))
    finally:
        workbook.close()

    errors: list[str] = []
    name = _text(form_rows[0][1][0]) if form_rows else ""
    description = _text(form_rows[0][1][1]) if form_rows else ""
    if not name:
        errors.append("Form row 2: Form Name is required.")
    elif len(name) > MAX_NAME_LENGTH:
        errors.append(f"Form row 2: Form Name can be at most {MAX_NAME_LENGTH} characters.")
    if not question_rows:
        errors.append("The Questions sheet does not contain any questions.")

    catalog = {section.normalized_name: section for section in db.query(models.Section).filter(models.Section.scope_key == "default").all()}
    can_create_sections = permissions.has_permission(actor, db, "sections.manage")
    blocks: list[dict[str, Any]] = []
    section_blocks: dict[str, dict[str, Any]] = {}
    for row_number, cells in question_rows:
        question = _question(row_number, cells, errors)
        section_name = _text(cells[0])
        if not section_name:
            if question:
                blocks.append({"type": "question", "question": question})
            continue
        key = section_name.casefold()
        if key not in section_blocks:
            existing = catalog.get(key)
            if len(section_name) > MAX_NAME_LENGTH:
                errors.append(f"Questions row {row_number}: Section names can be at most {MAX_NAME_LENGTH} characters.")
            elif existing is not None and existing.is_archived:
                errors.append(f"Questions row {row_number}: Section “{existing.name}” is archived. Restore it or use another section.")
            elif existing is None and not can_create_sections:
                errors.append(f"Questions row {row_number}: Section “{section_name}” does not exist, and you are not allowed to create sections.")
            block = {"type": "section", "name": existing.name if existing else section_name,
                     "section_id": existing.id if existing else None, "questions": []}
            section_blocks[key] = block
            blocks.append(block)
        if question:
            section_blocks[key]["questions"].append(question)

    if errors:
        return {"errors": errors, "form": None}
    return {"errors": [], "form": {"name": name, "description": description, "blocks": blocks}}

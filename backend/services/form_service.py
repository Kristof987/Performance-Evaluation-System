"""Questionnaire validation: question definitions, choice options, scale labels and issuance readiness."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from services import form_snapshot_service


def iter_form_questions(structure):
    yield from form_snapshot_service.iter_snapshot_questions(structure)


def validate_choice_question_options(question: dict, question_index: int):
    question_type = question.get("type")
    if question_type not in {"Single choice", "Multiple choice"}:
        return

    options = question.get("options")
    if not isinstance(options, list):
        raise HTTPException(
            status_code=400,
            detail=f"Question {question_index + 1} needs at least two answer options",
        )

    normalized_ids = []
    normalized_labels = []
    for option_index, option in enumerate(options):
        if not isinstance(option, dict):
            raise HTTPException(
                status_code=400,
                detail=f"Question {question_index + 1} option {option_index + 1} is invalid",
            )
        option_id = option.get("id")
        option_label = option.get("label")
        if not isinstance(option_id, str) or option_id.strip() == "":
            raise HTTPException(
                status_code=400,
                detail=f"Question {question_index + 1} option {option_index + 1} needs an id",
            )
        if not isinstance(option_label, str) or option_label.strip() == "":
            raise HTTPException(
                status_code=400,
                detail=f"Question {question_index + 1} option {option_index + 1} needs a label",
            )
        normalized_ids.append(option_id.strip())
        normalized_labels.append(option_label.strip().lower())

    if len(normalized_labels) < 2:
        raise HTTPException(
            status_code=400,
            detail=f"Question {question_index + 1} needs at least two answer options",
        )
    if len(set(normalized_ids)) != len(normalized_ids):
        raise HTTPException(status_code=400, detail=f"Question {question_index + 1} has duplicate option ids")
    if len(set(normalized_labels)) != len(normalized_labels):
        raise HTTPException(status_code=400, detail=f"Question {question_index + 1} has duplicate option labels")


def validate_question_definitions(questions: list[dict], db: Session | None = None):
    if not isinstance(questions, list):
        raise HTTPException(status_code=400, detail="Questions must be a list")
    is_block_structure = any(isinstance(item, dict) and item.get("type") in {"section", "question"} for item in questions)
    if is_block_structure:
        seen_sections = set()
        seen_questions = set()
        for block_index, block in enumerate(questions):
            if not isinstance(block, dict):
                raise HTTPException(status_code=400, detail=f"Block {block_index + 1} is invalid")
            if block.get("type") == "section":
                section_id = block.get("section_id")
                if not isinstance(section_id, int) or section_id in seen_sections:
                    raise HTTPException(status_code=400, detail="Section references must be valid and unique within a form")
                seen_sections.add(section_id)
                section = db.query(models.Section).filter(models.Section.id == section_id, models.Section.scope_key == "default").first() if db is not None else True
                if not section:
                    raise HTTPException(status_code=400, detail=f"Section {section_id} is unavailable to this account")
                nested = block.get("questions")
                if not isinstance(nested, list):
                    raise HTTPException(status_code=400, detail=f"Section {section_id} questions must be a list")
                for question in nested:
                    if not isinstance(question, dict):
                        raise HTTPException(status_code=400, detail=f"Section {section_id} contains an invalid question")
                    _validate_structured_question(question, seen_questions, db)
            elif block.get("type") == "question":
                question = block.get("question")
                if not isinstance(question, dict):
                    raise HTTPException(status_code=400, detail=f"Question block {block_index + 1} is invalid")
                _validate_structured_question(question, seen_questions, db)
            else:
                raise HTTPException(status_code=400, detail=f"Block {block_index + 1} has an unknown type")
        return
    for index, question in enumerate(questions):
        if not isinstance(question, dict):
            raise HTTPException(status_code=400, detail=f"Question {index + 1} is invalid")
        validate_choice_question_options(question, index)
        validate_legacy_dimension_metadata(question)


def validate_legacy_dimension_metadata(question: dict):
    """Accept well-formed stored metadata verbatim; never resolve it through a catalog."""
    id_fields = [question[field] for field in ("dimension_id", "dimensionId") if field in question]
    raw = question.get("dimension")
    if not id_fields and raw is None:
        return
    if question.get("type") not in {"Scale", "Numerical scale", "Scale 1-5", "Scale 1-10"}:
        raise HTTPException(status_code=400, detail="Only rating questions can carry legacy dimension metadata")
    if any(type(value) is not int or value <= 0 for value in id_fields) or len(set(id_fields)) > 1:
        raise HTTPException(status_code=400, detail="Invalid legacy dimension ID")
    if raw is not None:
        if isinstance(raw, str):
            valid = bool(raw.strip())
        elif isinstance(raw, dict):
            identifier = raw.get("id")
            name = raw.get("name")
            valid = ((identifier is None or type(identifier) is int and identifier > 0)
                     and (name is None or isinstance(name, str) and bool(name.strip()))
                     and (identifier is not None or name is not None)
                     and (not id_fields or identifier is None or identifier == id_fields[0]))
        else:
            valid = False
        if not valid:
            raise HTTPException(status_code=400, detail="Invalid legacy dimension metadata")


def form_issuance_errors(structure: list[dict], db: Session | None = None) -> list[str]:
    """Readiness is deliberately separate from draft persistence."""
    try:
        validate_question_definitions(structure, db)
    except HTTPException as error:
        return [str(error.detail)]
    errors: list[str] = []
    questions = list(iter_form_questions(structure))
    seen_ids: set[str] = set()
    if not questions:
        errors.append("A form must contain at least one question.")
    for block in structure if isinstance(structure, list) else []:
        if isinstance(block, dict) and block.get("type") == "section" and not block.get("questions"):
            section = db.query(models.Section).filter(models.Section.id == block.get("section_id")).first() if db is not None else None
            errors.append(f"{section.name if section else 'Section'} must contain at least one question.")
    for index, question in enumerate(questions, start=1):
        name = question.get("text") if isinstance(question.get("text"), str) and question["text"].strip() else f"Question {index}"
        question_id = question.get("id")
        if not isinstance(question_id, str) or not question_id.strip() or question_id in seen_ids:
            errors.append(f"{name} needs a unique question ID.")
        else:
            seen_ids.add(question_id)
        if not isinstance(question.get("text"), str) or not question["text"].strip():
            errors.append(f"{name} needs question text.")
        if question.get("type") not in {"Scale", "Numerical scale", "Scale 1-5", "Scale 1-10", "Single choice", "Multiple choice", "Text", "Number", "Date"}:
            errors.append(f"{name} has an unsupported question type.")
        if question.get("type") in {"Scale", "Numerical scale", "Scale 1-5", "Scale 1-10"}:
            minimum = question.get("scale_min", 1 if question.get("type") in {"Scale 1-5", "Scale 1-10"} else None)
            maximum = question.get("scale_max", 5 if question.get("type") == "Scale 1-5" else 10 if question.get("type") == "Scale 1-10" else None)
            if type(minimum) is not int or type(maximum) is not int or maximum <= minimum:
                errors.append(f"{name} needs integer scale limits with a maximum greater than its minimum.")
            if question.get("scale_direction", "higher_is_better") != "higher_is_better":
                errors.append(f"{name} must score higher values as better.")
            if any(label in question and question[label] is not None and not isinstance(question[label], str) for label in ("min_label", "max_label")):
                errors.append(f"{name} has an invalid endpoint label.")
            labels = question.get("scale_labels")
            if labels is not None and type(minimum) is int and type(maximum) is int and maximum > minimum:
                points = maximum - minimum + 1
                if points > MAX_LABELLED_SCALE_POINTS:
                    errors.append(f"{name} can label every value only on scales of at most {MAX_LABELLED_SCALE_POINTS} values.")
                elif (not isinstance(labels, list) or len(labels) != points
                      or not all(isinstance(label, str) and label.strip() for label in labels)):
                    errors.append(f"{name} needs a label for every scale value.")
                elif any(len(label.strip()) > MAX_SCALE_LABEL_LENGTH for label in labels):
                    errors.append(f"{name} has a scale label longer than {MAX_SCALE_LABEL_LENGTH} characters.")
        if question.get("type") in {"Single choice", "Multiple choice"}:
            options = question.get("options")
            valid = isinstance(options, list) and len(options) >= 2 and all(
                isinstance(option, dict)
                and isinstance(option.get("id"), str)
                and option["id"].strip()
                and isinstance(option.get("label"), str)
                and option["label"].strip()
                for option in options
            )
            if valid:
                option_ids = [option["id"].strip() for option in options]
                option_labels = [option["label"].strip().casefold() for option in options]
                valid = len(option_ids) == len(set(option_ids)) and len(option_labels) == len(set(option_labels))
            if not valid:
                errors.append(f'{name} must contain at least two valid answer options.')
    return errors


# Labelling every value of a scale (a behaviourally anchored scale) only makes sense for short scales.
MAX_LABELLED_SCALE_POINTS = 11


MAX_SCALE_LABEL_LENGTH = 120


def _validate_structured_question(question: dict, seen_ids: set, db: Session | None):
    question_id = question.get("id")
    if not isinstance(question_id, str) or not question_id.strip() or question_id in seen_ids:
        raise HTTPException(status_code=400, detail="Question IDs must be present and unique")
    seen_ids.add(question_id)
    validate_legacy_dimension_metadata(question)
    # A structured form is an editable draft. Choice completeness is enforced by
    # form_issuance_errors instead of preventing an HR user from saving progress.
    if question.get("type") in {"Scale", "Numerical scale", "Scale 1-5", "Scale 1-10"}:
        minimum = question.get("scale_min", 1 if question.get("type") == "Scale 1-5" else None)
        maximum = question.get("scale_max", 5 if question.get("type") == "Scale 1-5" else 10 if question.get("type") == "Scale 1-10" else None)
        if not isinstance(minimum, (int, float)) or not isinstance(maximum, (int, float)) or maximum <= minimum:
            raise HTTPException(status_code=400, detail=f"Scale question {question_id} needs a maximum greater than its minimum")
        direction = question.get("scale_direction", "higher_is_better")
        if direction != "higher_is_better":
            raise HTTPException(status_code=400, detail=f"Scale question {question_id} must score higher values as better")
        for field in ("min_label", "max_label"):
            if field in question and question[field] is not None and not isinstance(question[field], str):
                raise HTTPException(status_code=400, detail=f"Scale question {question_id} has an invalid endpoint label")
        labels = question.get("scale_labels")
        # A draft may still have blank labels; form_issuance_errors requires every one before issuing.
        if labels is not None and (not isinstance(labels, list) or len(labels) > 200
                                   or not all(isinstance(label, str) for label in labels)):
            raise HTTPException(status_code=400, detail=f"Scale question {question_id} has invalid value labels")

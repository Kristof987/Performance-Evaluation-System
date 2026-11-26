"""Questionnaire validation: question definitions, choice options, scale labels and issuance readiness."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from services import form_snapshot_service
from services import campaign_service
from copy import deepcopy
from datetime import datetime
from datetime import timezone
from sqlalchemy import func
from sqlalchemy import or_
from uuid import uuid4
import schemas


def iter_form_questions(structure):
    yield from form_snapshot_service.iter_snapshot_questions(structure)


def validate_question_definitions(questions: list[dict], db: Session | None = None):
    if not isinstance(questions, list):
        raise HTTPException(status_code=400, detail="Questions must be a list")
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
        if question.get("type") not in {"Scale", "Single choice", "Multiple choice", "Text"}:
            errors.append(f"{name} has an unsupported question type.")
        if question.get("type") == "Scale":
            minimum, maximum = question.get("scale_min"), question.get("scale_max")
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
    # A structured form is an editable draft. Choice completeness is enforced by
    # form_issuance_errors instead of preventing an HR user from saving progress.
    if question.get("type") == "Scale":
        minimum, maximum = question.get("scale_min"), question.get("scale_max")
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


def selectable_forms(campaign_id: int, db: Session) -> list[models.Form]:
    """Forms a campaign can pick from: active ones, plus any archived one it already uses (so its name still shows)."""
    used = campaign_service.forms_used_by_campaigns(db, campaign_id)
    return (db.query(models.Form)
            .filter(or_(models.Form.archived_at.is_(None), models.Form.id.in_(used or {-1})))
            .order_by(models.Form.name.asc()).all())


def get_forms(*, db: Session):
    used = campaign_service.forms_used_by_campaigns(db)
    return [schemas.FormResponse.model_validate(form).model_copy(update={"used_in_campaigns": form.id in used})
            for form in db.query(models.Form).order_by(models.Form.id.desc()).all()]


def get_form_templates(*, db: Session):
    return db.query(models.FormTemplate).order_by(models.FormTemplate.id.asc()).all()


def clone_template_questions(questions: list[dict]):
    cloned_questions = deepcopy(questions)
    for question in iter_form_questions(cloned_questions):
        question["id"] = str(uuid4())
    return cloned_questions


def form_section_ids(questions: object) -> set[int]:
    return {block["section_id"] for block in questions if isinstance(block, dict) and block.get("type") == "section"
            and isinstance(block.get("section_id"), int)} if isinstance(questions, list) else set()


def reject_newly_archived_sections(questions: list[dict], previous_questions: object, db: Session) -> None:
    """Archived Sections cannot be added to questionnaires; ones already in a questionnaire may stay."""
    added = form_section_ids(questions) - form_section_ids(previous_questions)
    if not added:
        return
    archived = db.query(models.Section.name).filter(models.Section.id.in_(added), models.Section.is_archived.is_(True)).order_by(models.Section.name).all()
    if archived:
        names = ", ".join(f"“{name}”" for (name,) in archived)
        raise HTTPException(status_code=400, detail=f"Archived sections cannot be added to a questionnaire: {names}. Restore them or choose another section.")


def validate_form_like_payload(payload: schemas.FormCreate, model, db: Session, item_id: int | None = None):
    name = payload.name.strip()
    if name == "":
        raise HTTPException(status_code=400, detail="Name is required")

    existing_query = db.query(model).filter(func.lower(model.name) == name.lower())
    if item_id is not None:
        existing_query = existing_query.filter(model.id != item_id)
    if existing_query.first() is not None:
        raise HTTPException(status_code=400, detail="Name already exists")

    questions = deepcopy(payload.questions)
    validate_question_definitions(questions, db)
    previous = db.query(model.questions).filter(model.id == item_id).scalar() if item_id is not None else None
    reject_newly_archived_sections(questions, previous, db)

    return {
        "name": name,
        "description": payload.description.strip() if payload.description is not None else None,
        "questions": questions,
    }


def create_form(*, form: schemas.FormCreate, db: Session):
    values = validate_form_like_payload(form, models.Form, db)
    if form.source_template_id is not None:
        template = db.query(models.FormTemplate).filter(models.FormTemplate.id == form.source_template_id).first()
        if template is None:
            raise HTTPException(status_code=404, detail="Template not found")
        values["questions"] = clone_template_questions(template.questions)
        reject_newly_archived_sections(values["questions"], None, db)
    new_form = models.Form(**values)
    db.add(new_form)
    db.commit()
    db.refresh(new_form)
    return new_form


def create_form_template(*, template: schemas.FormCreate, db: Session):
    new_template = models.FormTemplate(**validate_form_like_payload(template, models.FormTemplate, db))
    db.add(new_template)
    db.commit()
    db.refresh(new_template)
    return new_template


def update_form(*, form_id: int, form_update: schemas.FormUpdate, db: Session):
    campaigns = campaign_service.campaigns_referencing_form(form_id, db)
    for campaign in campaigns:
        campaign_service.require_mutable_campaign_configuration(campaign)
        if campaign.status == models.CampaignStatus.ACTIVE.value and db.query(models.FilledForm.id).filter(
            models.FilledForm.campaign_id == campaign.id, models.FilledForm.form_id == form_id,
            campaign_service.unissued_snapshot_filter(),
        ).first() is not None:
            raise HTTPException(status_code=409, detail="Issue planned active campaign assignments before editing their source form")
    form = db.query(models.Form).filter(models.Form.id == form_id).first()
    if form is None:
        raise HTTPException(status_code=404, detail="Form not found")
    if form.archived_at is not None:
        raise HTTPException(status_code=409, detail="Restore this form before editing it")
    values = validate_form_like_payload(form_update, models.Form, db, form_id)
    form.name = values["name"]
    form.description = values["description"]
    form.questions = values["questions"]
    db.flush()
    for campaign in campaigns:
        campaign_service.validate_scheduled_campaign(campaign, db)
    db.commit()
    db.refresh(form)
    return schemas.FormResponse.model_validate(form).model_copy(update={"used_in_campaigns": bool(campaigns)})


def update_form_template(*, template_id: int, template_update: schemas.FormUpdate, db: Session):
    template = db.query(models.FormTemplate).filter(models.FormTemplate.id == template_id).first()
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    values = validate_form_like_payload(template_update, models.FormTemplate, db, template_id)
    template.name = values["name"]
    template.description = values["description"]
    template.questions = values["questions"]
    db.commit()
    db.refresh(template)
    return template


def delete_form(*, form_id: int, db: Session):
    """Unused forms are deleted. Forms that only finished campaigns refer to are archived, so their history stays."""
    form = db.query(models.Form).filter(models.Form.id == form_id).with_for_update().first()
    if form is None:
        raise HTTPException(status_code=404, detail="Form not found")
    campaigns = campaign_service.campaigns_referencing_form(form_id, db)
    running = [campaign for campaign in campaigns
               if not campaign.is_archived and campaign.status != models.CampaignStatus.CLOSED.value]
    if running:
        names = ", ".join(f"“{campaign.name}”" for campaign in running[:3]) + (" and others" if len(running) > 3 else "")
        raise HTTPException(status_code=409, detail=f"This form is used by {names}. Remove it from "
                            f"{'that campaign' if len(running) == 1 else 'those campaigns'} first, or wait until "
                            f"{'it closes' if len(running) == 1 else 'they close'}.")
    if campaigns:
        if form.archived_at is None:
            form.archived_at = datetime.now(timezone.utc)
        db.commit()
        return {"deleted": False, "archived": True}
    db.delete(form)
    db.commit()
    return {"deleted": True, "archived": False}


def restore_form(*, form_id: int, db: Session):
    form = db.query(models.Form).filter(models.Form.id == form_id).first()
    if form is None:
        raise HTTPException(status_code=404, detail="Form not found")
    form.archived_at = None
    db.commit()
    db.refresh(form)
    return schemas.FormResponse.model_validate(form).model_copy(
        update={"used_in_campaigns": form.id in campaign_service.forms_used_by_campaigns(db)})


def delete_form_template(*, template_id: int, db: Session):
    template = db.query(models.FormTemplate).filter(models.FormTemplate.id == template_id).first()
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    db.delete(template)
    db.commit()
    return {"deleted": True}

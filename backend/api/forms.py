"""Questionnaires and templates: CRUD, validation, archiving, Excel import and AI-generated drafts."""

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

import models
import schemas
from api.dependencies import get_db, require_permission
from services import (
    ai_form_generation_service,
    form_import_service,
    form_service,
    workspace_settings_service,
)

router = APIRouter()


@router.get("/forms", response_model=list[schemas.FormResponse])
def get_forms(db: Session = Depends(get_db),
              _reader: models.User = Depends(require_permission("forms.read"))):
    return form_service.get_forms(db=db)


@router.post("/forms/ai/generate", response_model=schemas.FormAIGenerateResponse)
def generate_form_draft(request: schemas.FormAIGenerateRequest, db: Session = Depends(get_db),
                        manager: models.User = Depends(require_permission("forms.manage"))):
    workspace_settings_service.require_ai_enabled(db)

    def validation_errors(draft: dict) -> list[str]:
        if not all(section["section_id"] is not None for section in draft["sections"]):
            return []  # Proposed sections have no DB IDs until HR approves them.
        blocks = [{"type": "section", "section_id": section["section_id"], "questions": section["questions"]}
                  for section in draft["sections"]]
        blocks.extend({"type": "question", "question": question} for question in draft["standalone_questions"])
        errors = form_service.form_issuance_errors(blocks, db)
        feedback = []
        for error in errors:
            if "option" in error.lower():
                feedback.append("Choice questions need at least two distinct, labeled options")
            elif "scale" in error.lower() or "maximum" in error.lower():
                feedback.append("Rating scales need integer endpoints 1 and 5 with higher values better")
            elif "section" in error.lower():
                feedback.append("Every section must be nonempty and reference a unique existing Section")
            elif "id" in error.lower():
                feedback.append("Every question needs a unique ID")
            else:
                feedback.append("Every question must meet the form issuance rules")
        return list(dict.fromkeys(feedback))

    return ai_form_generation_service.generate(request, db, validate_draft=validation_errors, actor=manager)


@router.get("/form-templates", response_model=list[schemas.FormTemplateResponse])
def get_form_templates(db: Session = Depends(get_db),
                       _reader: models.User = Depends(require_permission("forms.read"))):
    return form_service.get_form_templates(db=db)


@router.post("/forms/import", response_model=schemas.FormImportResponse)
def import_form_from_excel(file: UploadFile = File(...), db: Session = Depends(get_db),
                           actor: models.User = Depends(require_permission("forms.manage"))):
    """Read a filled-in form template into a draft; the editor saves it as a form or a template."""
    return form_import_service.parse_form_workbook(file.file, file.filename, actor, db)


@router.post("/forms", response_model=schemas.FormResponse)
def create_form(form: schemas.FormCreate, db: Session = Depends(get_db),
                _manager: models.User = Depends(require_permission("forms.manage"))):
    return form_service.create_form(form=form, db=db)


@router.post("/form-templates", response_model=schemas.FormTemplateResponse)
def create_form_template(template: schemas.FormCreate, db: Session = Depends(get_db),
                         _manager: models.User = Depends(require_permission("forms.manage"))):
    return form_service.create_form_template(template=template, db=db)


@router.put("/forms/{form_id}", response_model=schemas.FormResponse)
def update_form(form_id: int, form_update: schemas.FormUpdate, db: Session = Depends(get_db),
                  _manager: models.User = Depends(require_permission("forms.manage"))):
    # Editing a shared source Form must not silently issue campaign questionnaires.
    return form_service.update_form(form_id=form_id, form_update=form_update, db=db)


@router.put("/form-templates/{template_id}", response_model=schemas.FormTemplateResponse)
def update_form_template(template_id: int, template_update: schemas.FormUpdate, db: Session = Depends(get_db),
                         _manager: models.User = Depends(require_permission("forms.manage"))):
    return form_service.update_form_template(template_id=template_id, template_update=template_update, db=db)


@router.delete("/forms/{form_id}", response_model=schemas.FormDeleteResponse)
def delete_form(form_id: int, db: Session = Depends(get_db),
                  _manager: models.User = Depends(require_permission("forms.manage"))):
    """Unused forms are deleted. Forms that only finished campaigns refer to are archived, so their history stays."""
    return form_service.delete_form(form_id=form_id, db=db)


@router.post("/forms/{form_id}/restore", response_model=schemas.FormResponse)
def restore_form(form_id: int, db: Session = Depends(get_db),
                 _manager: models.User = Depends(require_permission("forms.manage"))):
    return form_service.restore_form(form_id=form_id, db=db)


@router.delete("/form-templates/{template_id}")
def delete_form_template(template_id: int, db: Session = Depends(get_db),
                         _manager: models.User = Depends(require_permission("forms.manage"))):
    return form_service.delete_form_template(template_id=template_id, db=db)

"""Sections: named groups of questions that are reused across questionnaires and scored together."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

import models
import schemas
from api.dependencies import get_db, require_permission
from services import section_service

router = APIRouter()


@router.get("/sections", response_model=list[schemas.SectionResponse])
def get_sections(include_archived: bool = Query(default=True),
                 db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.read"))):
    return section_service.get_sections(include_archived=include_archived, db=db)


@router.post("/sections", response_model=schemas.SectionResponse, status_code=201)
def create_section(payload: schemas.SectionCreate,
                   db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.manage"))):
    return section_service.create_section(payload=payload, db=db)


@router.put("/sections/{section_id}", response_model=schemas.SectionResponse)
def update_section(section_id: int, payload: schemas.SectionUpdate,
                   db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.manage"))):
    return section_service.update_section(section_id=section_id, payload=payload, db=db)


@router.post("/sections/{section_id}/archive", response_model=schemas.SectionResponse)
def archive_section(section_id: int,
                    db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.manage"))):
    return section_service.set_section_archived(section_id, True, db)


@router.post("/sections/{section_id}/restore", response_model=schemas.SectionResponse)
def restore_section(section_id: int,
                    db: Session = Depends(get_db), actor: models.User = Depends(require_permission("sections.manage"))):
    return section_service.set_section_archived(section_id, False, db)

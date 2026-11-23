"""Section names, uniqueness and archiving."""

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
import schemas


def normalize_section_name(name: str) -> tuple[str, str]:
    display = " ".join(name.strip().split())
    if not display or len(display) > 120:
        raise HTTPException(status_code=400, detail="Section name must contain 1 to 120 characters")
    normalized = display.casefold()
    if len(normalized) > 120:
        raise HTTPException(status_code=400, detail="Normalized section name must contain at most 120 characters")
    return display, normalized


def get_sections(*, include_archived: bool = True, db: Session):
    query = db.query(models.Section).filter(models.Section.scope_key == "default")
    if not include_archived:
        query = query.filter(models.Section.is_archived.is_(False))
    return query.order_by(models.Section.is_archived.asc(), models.Section.name.asc()).all()


def create_section(*, payload: schemas.SectionCreate, db: Session):
    name, normalized = normalize_section_name(payload.name)
    section = models.Section(scope_key="default", name=name, normalized_name=normalized)
    db.add(section)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) != "uq_section_scope_name":
            raise
        raise HTTPException(status_code=409, detail="A section with this name already exists") from error
    db.refresh(section)
    return section


def update_section(*, section_id: int, payload: schemas.SectionUpdate, db: Session):
    section = db.query(models.Section).filter(models.Section.id == section_id, models.Section.scope_key == "default").first()
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")
    section.name, section.normalized_name = normalize_section_name(payload.name)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) != "uq_section_scope_name":
            raise
        raise HTTPException(status_code=409, detail="A section with this name already exists") from error
    db.refresh(section)
    return section


def set_section_archived(section_id: int, archived: bool, db: Session):
    section = db.query(models.Section).filter(models.Section.id == section_id, models.Section.scope_key == "default").first()
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")
    section.is_archived = archived
    db.commit()
    db.refresh(section)
    return section

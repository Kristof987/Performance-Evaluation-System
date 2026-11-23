from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import models
from services import reporting_service
from database import SessionLocal
from services.form_service import reject_newly_archived_sections


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def section(db, *, archived=False):
    name = f"Section {uuid4().hex}"
    item = models.Section(scope_key="default", name=name, normalized_name=name.casefold(), is_archived=archived)
    db.add(item)
    db.flush()
    return item


def block(section_id):
    return {"type": "section", "section_id": section_id, "questions": []}


def test_archived_sections_cannot_be_added_but_may_stay(db):
    active, archived = section(db), section(db, archived=True)
    reject_newly_archived_sections([block(active.id)], None, db)
    with pytest.raises(HTTPException) as error:
        reject_newly_archived_sections([block(active.id), block(archived.id)], None, db)
    assert error.value.status_code == 400 and archived.name in error.value.detail
    # A questionnaire that already used the Section can still be saved.
    reject_newly_archived_sections([block(archived.id)], [block(archived.id)], db)


def test_reports_use_the_issued_section_name(db, monkeypatch):
    item = section(db)
    issued_name = item.name
    item.name = f"Renamed {uuid4().hex}"
    db.flush()
    other = section(db)
    snapshot = {"schema_version": 2, "questions": [
        {"type": "section", "section_id": item.id, "section": {"id": item.id, "name": issued_name}, "questions": []},
        {"type": "section", "section_id": other.id, "questions": []},
    ]}
    row = (SimpleNamespace(id=1, form_snapshot=snapshot, finish_date=object()), None, "Completed")
    evaluation = SimpleNamespace(section_ids=frozenset({item.id, other.id}))
    from services import section_scoring_service
    monkeypatch.setattr(section_scoring_service, "score_evaluation", lambda *_args, **_kwargs: evaluation)
    monkeypatch.setattr(reporting_service, "status_key", lambda *_args: "completed")
    _scored, names = reporting_service._section_report_data([row], db)
    assert names[item.id] == issued_name
    assert names[other.id] == other.name  # No issued name: fall back to the catalog.

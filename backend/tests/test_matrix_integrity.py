"""Saving the evaluation matrix never drops issued work (a pair is unique per campaign in the database)."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from services.campaign_setup_service import validate_matrix_issued_assignments


def issued():
    return SimpleNamespace(form_snapshot={"schema_version": 2, "questions": []}, finish_date=None, answers=[])


def test_issued_work_cannot_be_omitted_even_if_unfinished():
    existing = {(1, 10, 20): issued()}
    with pytest.raises(HTTPException) as error:
        validate_matrix_issued_assignments(existing, set(existing), set())
    assert error.value.status_code == 409


def test_existing_issued_work_is_kept_even_if_rule_form_changed():
    existing = {(1, 10, 20): issued()}
    validate_matrix_issued_assignments(existing, set(existing), set(existing))


def test_records_outside_the_saved_scope_are_not_touched():
    validate_matrix_issued_assignments({(2, 10, 20): issued()}, {(1, 10, 20)}, set())

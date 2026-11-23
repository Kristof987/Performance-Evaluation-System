"""Saving the evaluation matrix: issued work is never dropped and a pair exists in one group only."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from services.campaign_setup_service import validate_matrix_issued_assignments


def issued():
    return SimpleNamespace(form_snapshot={"schema_version": 2, "questions": []}, finish_date=None, answers=[])


def test_issued_work_cannot_be_omitted_even_if_unfinished():
    existing = {(1, 10, 20): issued()}
    with pytest.raises(HTTPException) as error:
        validate_matrix_issued_assignments(existing, set(existing), set(), set(), {(10, 20)})
    assert error.value.status_code == 409


def test_existing_issued_work_is_kept_even_if_rule_form_changed():
    existing = {(1, 10, 20): issued()}
    validate_matrix_issued_assignments(existing, set(existing), set(existing), {(1, 10, 20, 5)}, {(10, 20)})


def test_records_outside_the_saved_scope_are_not_touched():
    existing = {(2, 10, 20): issued()}
    validate_matrix_issued_assignments(existing, {(1, 10, 20)}, set(), set(), {(10, 20)})


def test_pair_already_in_another_group_is_rejected():
    with pytest.raises(HTTPException) as error:
        validate_matrix_issued_assignments({}, set(), set(), {(2, 10, 20, 5)}, {(10, 20)})
    assert error.value.status_code == 409


@pytest.mark.parametrize("forms", [(5, 5), (5, 6)])
def test_same_pair_in_two_groups_is_rejected_whatever_the_form(forms):
    with pytest.raises(HTTPException):
        validate_matrix_issued_assignments({}, set(), set(), {(1, 10, 20, forms[0]), (2, 10, 20, forms[1])}, set())


def test_different_pairs_across_groups_are_allowed():
    validate_matrix_issued_assignments({}, set(), set(), {(1, 10, 20, 5), (2, 10, 30, 6)}, set())

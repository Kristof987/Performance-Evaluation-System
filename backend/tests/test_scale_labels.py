import pytest
from fastapi import HTTPException

from main import _validate_structured_question, form_issuance_errors


def scale(**extra):
    return {"id": "q1", "text": "Meets deadlines", "type": "Scale", "required": True, "scale_min": 1, "scale_max": 3, **extra}


def test_endpoint_labels_alone_stay_valid():
    assert form_issuance_errors([{"type": "question", "question": scale(min_label="Low", max_label="High")}]) == []


def test_every_value_needs_a_label_before_issuing():
    assert form_issuance_errors([{"type": "question", "question": scale(scale_labels=["Late", "On time", "Early"])}]) == []
    assert form_issuance_errors([{"type": "question", "question": scale(scale_labels=["Late", " ", "Early"])}]) == [
        "Meets deadlines needs a label for every scale value."]
    assert form_issuance_errors([{"type": "question", "question": scale(scale_labels=["Late", "Early"])}]) == [
        "Meets deadlines needs a label for every scale value."]
    assert form_issuance_errors([{"type": "question", "question": scale(scale_max=20, scale_labels=["x"] * 20)}]) == [
        "Meets deadlines can label every value only on scales of at most 11 values."]


def test_drafts_may_keep_blank_labels_but_not_malformed_ones():
    _validate_structured_question(scale(scale_labels=["", "", ""]), set(), None)
    with pytest.raises(HTTPException):
        _validate_structured_question(scale(scale_labels="Late; Early"), set(), None)
    with pytest.raises(HTTPException):
        _validate_structured_question(scale(scale_labels=[1, 2, 3]), set(), None)

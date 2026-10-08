from uuid import uuid4

import pytest
from fastapi import HTTPException

import models
import schemas
from database import SessionLocal
from main import create_form, create_form_template, update_form, validate_form_like_payload


def unique_name(prefix: str) -> str:
    return f"{prefix} {uuid4()}"


def choice_question(question_type: str = "Single choice", options: list[dict] | None = None):
    return {
        "id": str(uuid4()),
        "text": "Choose one option" if question_type == "Single choice" else "Choose options",
        "type": question_type,
        "required": True,
        "helpText": "",
        "options": options
        if options is not None
        else [
            {"id": str(uuid4()), "label": "First option"},
            {"id": str(uuid4()), "label": "Second option"},
            {"id": str(uuid4()), "label": "Third option"},
        ],
    }


def test_choice_question_options_persist_in_order_for_forms_and_templates():
    db = SessionLocal()
    try:
        single_choice = choice_question(
            "Single choice",
            [
                {"id": "single-a", "label": "Very satisfied"},
                {"id": "single-b", "label": "Satisfied"},
                {"id": "single-c", "label": "Neutral"},
                {"id": "single-d", "label": "Dissatisfied"},
            ],
        )
        form = create_form(
            schemas.FormCreate(
                name=unique_name("Choice form"),
                description="",
                questions=[single_choice],
            ),
            db,
        )

        updated_options = [
            {"id": "single-c", "label": "Neutral"},
            {"id": "single-a", "label": "Extremely satisfied"},
            {"id": "single-d", "label": "Dissatisfied"},
        ]
        update_form(
            form.id,
            schemas.FormUpdate(
                name=form.name,
                description=form.description,
                questions=[{**single_choice, "options": updated_options}],
            ),
            db,
        )

        db.expire_all()
        reloaded = db.query(models.Form).filter(models.Form.id == form.id).one()
        assert reloaded.questions[0]["options"] == updated_options

        template = create_form_template(
            schemas.FormCreate(
                name=unique_name("Choice template"),
                description="",
                questions=[choice_question("Multiple choice")],
            ),
            db,
        )
        db.expire_all()
        reloaded_template = db.query(models.FormTemplate).filter(models.FormTemplate.id == template.id).one()
        assert [option["label"] for option in reloaded_template.questions[0]["options"]] == [
            "First option",
            "Second option",
            "Third option",
        ]
    finally:
        db.close()


@pytest.mark.parametrize(
    "options, expected_detail",
    [
        ([{"id": "one", "label": "Only one"}], "needs at least two answer options"),
        ([{"id": "one", "label": ""}, {"id": "two", "label": "Valid"}], "needs a label"),
        ([{"id": "same", "label": "A"}, {"id": "same", "label": "B"}], "duplicate option ids"),
        ([{"id": "one", "label": "Same"}, {"id": "two", "label": " same "}], "duplicate option labels"),
        (["Legacy option", {"id": "two", "label": "Valid"}], "is invalid"),
    ],
)
def test_choice_question_definition_validation_rejects_invalid_options(options, expected_detail):
    db = SessionLocal()
    try:
        payload = schemas.FormCreate(
            name=unique_name("Invalid choice form"),
            description="",
            questions=[choice_question("Single choice", options)],
        )
        with pytest.raises(HTTPException) as error:
            validate_form_like_payload(payload, models.Form, db)
        assert expected_detail in error.value.detail
    finally:
        db.close()


def test_template_to_form_clone_deep_copies_choice_options():
    db = SessionLocal()
    try:
        template = create_form_template(
            schemas.FormCreate(
                name=unique_name("Choice clone template"),
                description="",
                questions=[
                    choice_question(
                        "Single choice",
                        [
                            {"id": "option-a", "label": "A"},
                            {"id": "option-b", "label": "B"},
                        ],
                    )
                ],
            ),
            db,
        )
        form = create_form(
            schemas.FormCreate(
                name=unique_name("Choice cloned form"),
                description="",
                source_template_id=template.id,
            ),
            db,
        )

        form_questions = db.query(models.Form).filter(models.Form.id == form.id).one().questions
        form_questions[0]["options"][0]["label"] = "Changed in form"
        update_form(
            form.id,
            schemas.FormUpdate(name=form.name, description=form.description, questions=form_questions),
            db,
        )

        db.expire_all()
        reloaded_template = db.query(models.FormTemplate).filter(models.FormTemplate.id == template.id).one()
        reloaded_form = db.query(models.Form).filter(models.Form.id == form.id).one()
        assert reloaded_template.questions[0]["options"][0]["label"] == "A"
        assert reloaded_form.questions[0]["options"][0]["label"] == "Changed in form"
    finally:
        db.close()

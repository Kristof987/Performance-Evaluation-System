from copy import deepcopy
from uuid import uuid4

import pytest

import models
import schemas
from database import SessionLocal
from api.forms import create_form, create_form_template, update_form
from services.form_service import form_issuance_errors


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


def block(question: dict) -> dict:
    return {"type": "question", "question": question}


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
                questions=[block(single_choice)],
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
                questions=[block({**single_choice, "options": updated_options})],
            ),
            db,
        )

        db.expire_all()
        reloaded = db.query(models.Form).filter(models.Form.id == form.id).one()
        assert reloaded.questions[0]["question"]["options"] == updated_options

        template = create_form_template(
            schemas.FormCreate(
                name=unique_name("Choice template"),
                description="",
                questions=[block(choice_question("Multiple choice"))],
            ),
            db,
        )
        db.expire_all()
        reloaded_template = db.query(models.FormTemplate).filter(models.FormTemplate.id == template.id).one()
        assert [option["label"] for option in reloaded_template.questions[0]["question"]["options"]] == [
            "First option",
            "Second option",
            "Third option",
        ]
    finally:
        db.close()


@pytest.mark.parametrize(
    "options",
    [
        [{"id": "one", "label": "Only one"}],
        [{"id": "one", "label": ""}, {"id": "two", "label": "Valid"}],
        [{"id": "same", "label": "A"}, {"id": "same", "label": "B"}],
        [{"id": "one", "label": "Same"}, {"id": "two", "label": " same "}],
    ],
)
def test_invalid_choice_options_block_issuance(options):
    errors = form_issuance_errors([block(choice_question("Single choice", options))])
    assert any("at least two valid answer options" in error for error in errors)


def test_template_to_form_clone_deep_copies_choice_options():
    db = SessionLocal()
    try:
        template = create_form_template(
            schemas.FormCreate(
                name=unique_name("Choice clone template"),
                description="",
                questions=[
                    block(choice_question(
                        "Single choice",
                        [
                            {"id": "option-a", "label": "A"},
                            {"id": "option-b", "label": "B"},
                        ],
                    ))
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

        # Like the API, send a new JSON document: editing the loaded list in place would hide the change from the ORM.
        form_questions = deepcopy(db.query(models.Form).filter(models.Form.id == form.id).one().questions)
        form_questions[0]["question"]["options"][0]["label"] = "Changed in form"
        update_form(
            form.id,
            schemas.FormUpdate(name=form.name, description=form.description, questions=form_questions),
            db,
        )

        db.expire_all()
        reloaded_template = db.query(models.FormTemplate).filter(models.FormTemplate.id == template.id).one()
        reloaded_form = db.query(models.Form).filter(models.Form.id == form.id).one()
        assert reloaded_template.questions[0]["question"]["options"][0]["label"] == "A"
        assert reloaded_form.questions[0]["question"]["options"][0]["label"] == "Changed in form"
    finally:
        db.close()

import io
from uuid import uuid4

import pytest
from fastapi import HTTPException
from openpyxl import Workbook

from services import form_import_service
import models
from database import SessionLocal


@pytest.fixture
def db():
    session = SessionLocal()
    session.commit = session.flush
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def actor(db, monkeypatch):
    permissions = {"forms.manage", "sections.manage"}
    monkeypatch.setattr(form_import_service.permissions, "role_permissions", lambda _db, _role: permissions)
    user = models.User(username=f"forms-{uuid4().hex}", email=f"{uuid4().hex}@example.com", password_hash="", system_role_id=None, is_active=True)
    user.granted = permissions
    return user


def section(db, name, archived=False):
    item = models.Section(scope_key="default", name=name, normalized_name=name.casefold(), is_archived=archived)
    db.add(item)
    db.flush()
    return item


def workbook(form_rows, question_rows):
    book = Workbook()
    form = book.active
    form.title = "Form"
    form.append(form_import_service.FORM_HEADERS)
    for row in form_rows:
        form.append(row)
    questions = book.create_sheet("Questions")
    questions.append(form_import_service.QUESTION_HEADERS)
    for row in question_rows:
        questions.append(row)
    book.create_sheet("Instructions").append(["Read me"])
    book.active = 2
    buffer = io.BytesIO()
    book.save(buffer)
    buffer.seek(0)
    return buffer


def parse(db, actor, form_rows, question_rows):
    return form_import_service.parse_form_workbook(workbook(form_rows, question_rows), "form.xlsx", actor, db)


def test_rows_become_blocks_in_order_with_sections_matched_by_name(db, actor):
    existing = section(db, f"Teamwork {uuid4().hex[:6]}")
    new_name = f"Growth {uuid4().hex[:6]}"
    result = parse(db, actor, [["Quarterly review", "Peer feedback"]], [
        [existing.name.upper(), "Shares knowledge", "Numerical scale", "Yes", "Think of the last quarter", None, None, "Rarely", "Always", None],
        [None, "Anything else?", "Text", "No", None, None, None, None, None, None],
        [new_name, "Learns new skills", "Single choice", None, None, None, None, None, None, "Never; Sometimes ;Often;"],
        [existing.name, "Helps others", "scale", "y", None, 0, 10, None, None, None],
    ])

    assert result["errors"] == []
    form = result["form"]
    assert (form["name"], form["description"]) == ("Quarterly review", "Peer feedback")
    first, standalone, created = form["blocks"]
    assert (first["section_id"], first["name"]) == (existing.id, existing.name)
    assert [question["text"] for question in first["questions"]] == ["Shares knowledge", "Helps others"]
    scale = first["questions"][0]
    assert (scale["type"], scale["scale_min"], scale["scale_max"], scale["min_label"], scale["required"]) == ("Scale", 1, 5, "Rarely", True)
    assert (first["questions"][1]["scale_min"], first["questions"][1]["scale_max"]) == (0, 10)
    assert standalone["type"] == "question" and standalone["question"]["required"] is False
    assert (created["section_id"], created["name"]) == (None, new_name)
    assert [option["label"] for option in created["questions"][0]["options"]] == ["Never", "Sometimes", "Often"]


def test_every_problem_is_reported_with_its_row(db, actor):
    archived = section(db, f"Old {uuid4().hex[:6]}", archived=True)
    result = parse(db, actor, [[None, None]], [
        [None, None, "Rating", "Maybe", None, None, None, None, None, None],
        [None, "Pick one", "Multiple choice", "Yes", None, None, None, None, None, "Only"],
        [None, "Pick again", "Single choice", "Yes", None, None, None, None, None, "A; a"],
        [None, "Rate", "Numerical scale", "Yes", None, 5, 3, None, None, None],
        [archived.name, "Old one", "Text", "Yes", None, None, None, None, None, None],
    ])

    assert result["form"] is None
    assert result["errors"] == [
        "Form row 2: Form Name is required.",
        "Questions row 2: Question Text is required.",
        "Questions row 2: Question Type must be Numerical scale, Text, Single choice or Multiple choice.",
        "Questions row 2: Required must be Yes or No.",
        "Questions row 3: Choice questions need at least two Options, separated by semicolons.",
        "Questions row 4: Options must be different from each other.",
        "Questions row 5: Scale Max must be greater than Scale Min.",
        f"Questions row 6: Section “{archived.name}” is archived. Restore it or use another section.",
    ]


def test_new_sections_need_permission(db, actor):
    actor.granted.discard("sections.manage")
    result = parse(db, actor, [["Form", None]], [[f"Brand new {uuid4().hex[:6]}", "Q", "Text", "Yes", None, None, None, None, None, None]])
    assert "you are not allowed to create sections" in result["errors"][0]


def test_question_limit(db, actor, monkeypatch):
    monkeypatch.setattr(form_import_service, "MAX_FORM_QUESTIONS", 2)
    rows = [[None, f"Q{index}", "Text", "Yes", None, None, None, None, None, None] for index in range(3)]
    with pytest.raises(HTTPException) as error:
        parse(db, actor, [["Form", None]], rows)
    assert "at most 2 questions" in error.value.detail


def test_the_example_sheet_is_never_imported(db, actor):
    book = Workbook()
    form = book.active
    form.title = "Form"
    form.append(form_import_service.FORM_HEADERS)
    form.append(["Form", None])
    example = book.create_sheet("Example")
    example.append(form_import_service.QUESTION_HEADERS)
    example.append([None, "Sample", "Text", "Yes", None, None, None, None, None, None])
    buffer = io.BytesIO()
    book.save(buffer)
    buffer.seek(0)
    with pytest.raises(HTTPException) as error:
        form_import_service.parse_form_workbook(buffer, "form.xlsx", actor, db)
    assert "Invalid template columns" in error.value.detail


def test_scale_options_label_every_value(db, actor):
    result = parse(db, actor, [["Anchored", None]], [
        [None, "Meets deadlines", "Numerical scale", "Yes", None, 1, 4, None, None, "Often late; Sometimes late; Usually on time; Always on time"],
        [None, "Wrong count", "Numerical scale", "Yes", None, 1, 5, None, None, "Low; High"],
        [None, "Both kinds", "Numerical scale", "Yes", None, 1, 2, "Low", None, "Low; High"],
        [None, "Too long", "Numerical scale", "Yes", None, 0, 20, None, None, "; ".join(str(value) for value in range(21))],
    ])
    assert result["errors"] == [
        "Questions row 3: Options must give exactly 5 labels for a 1–5 scale, one per value, separated by semicolons.",
        "Questions row 4: Use either Lowest/Highest Label or Options (one label per value), not both.",
        "Questions row 5: Every value can be labelled only on scales of at most 11 values.",
    ]
    ok = parse(db, actor, [["Anchored", None]], [
        [None, "Meets deadlines", "Numerical scale", "Yes", None, 1, 4, None, None, "Often late; Sometimes late; Usually on time; Always on time"],
    ])
    question = ok["form"]["blocks"][0]["question"]
    assert question["scale_labels"] == ["Often late", "Sometimes late", "Usually on time", "Always on time"]
    assert (question["min_label"], question["max_label"]) == ("Often late", "Always on time")

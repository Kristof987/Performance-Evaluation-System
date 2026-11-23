import io
import zipfile

import pytest
from fastapi import HTTPException
from openpyxl import Workbook

from services import people_import_service
from main import EMPLOYEE_IMPORT_HEADERS, GROUP_IMPORT_HEADERS


def workbook_bytes(rows, *, data_sheet_first=True, active_instructions=False):
    workbook = Workbook()
    data = workbook.active
    data.title = "Employees"
    for row in rows:
        data.append(row)
    instructions = workbook.create_sheet("Instructions", 0 if not data_sheet_first else None)
    instructions.append(["How to fill in this template"])
    if active_instructions:
        workbook.active = workbook.sheetnames.index("Instructions")
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def read(data, headers=EMPLOYEE_IMPORT_HEADERS, filename="people.xlsx"):
    return people_import_service.read_import_rows(io.BytesIO(data), filename, headers, "employee")


def test_rows_are_read_from_the_template_sheet_whichever_tab_was_saved():
    data = workbook_bytes([EMPLOYEE_IMPORT_HEADERS, ["Anna", "anna@example.com", "Engineer", "Employee"], [None, None, None, None],
                           ["Béla", "bela@example.com", "Sales", "Employee"]], data_sheet_first=False, active_instructions=True)

    assert read(data) == [(2, ["Anna", "anna@example.com", "Engineer", "Employee"]), (4, ["Béla", "bela@example.com", "Sales", "Employee"])]


def test_short_rows_are_padded_and_group_template_is_found():
    data = workbook_bytes([GROUP_IMPORT_HEADERS, ["Platform"]])

    assert read(data, GROUP_IMPORT_HEADERS) == [(2, ["Platform", None])]


def test_wrong_columns_name_the_expected_headers():
    with pytest.raises(HTTPException) as error:
        read(workbook_bytes([["Name", "Email"]]))
    assert error.value.status_code == 400 and "Employee Name" in error.value.detail


def test_non_xlsx_and_unreadable_files_are_rejected():
    with pytest.raises(HTTPException) as wrong_type:
        read(b"name,email", filename="people.csv")
    with pytest.raises(HTTPException) as broken:
        read(b"not a zip")
    assert (wrong_type.value.status_code, broken.value.status_code) == (400, 400)


def test_large_uploads_are_refused_before_parsing(monkeypatch):
    monkeypatch.setattr(people_import_service, "MAX_IMPORT_BYTES", 1000)
    with pytest.raises(HTTPException) as error:
        read(workbook_bytes([EMPLOYEE_IMPORT_HEADERS] + [[f"P{i}", f"p{i}@example.com", "R", "Employee"] for i in range(200)]))
    assert error.value.status_code == 413


def test_archives_that_expand_too_far_are_refused():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("xl/worksheets/sheet1.xml", b"0" * (people_import_service.MAX_IMPORT_EXPANDED_BYTES + 1))
    with pytest.raises(HTTPException) as error:
        read(buffer.getvalue())
    assert error.value.status_code == 413


def test_row_limit(monkeypatch):
    monkeypatch.setattr(people_import_service, "MAX_IMPORT_ROWS", 3)
    rows = [[f"P{i}", f"p{i}@example.com", "R", "Employee"] for i in range(4)]
    assert len(read(workbook_bytes([EMPLOYEE_IMPORT_HEADERS] + rows[:3]))) == 3
    with pytest.raises(HTTPException) as error:
        read(workbook_bytes([EMPLOYEE_IMPORT_HEADERS] + rows))
    assert error.value.status_code == 400 and "at most 3 rows" in error.value.detail

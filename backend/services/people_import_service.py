"""Reading the People import templates safely.

An .xlsx file is a zip archive, so both the upload and what it expands to are capped before
openpyxl parses it, and only a bounded number of rows is read.
"""
import io
import zipfile
from typing import Any, BinaryIO

from fastapi import HTTPException
from openpyxl import load_workbook

MAX_IMPORT_BYTES = 2 * 1024 * 1024
MAX_IMPORT_EXPANDED_BYTES = 30 * 1024 * 1024
MAX_IMPORT_ROWS = 1000


def open_import_workbook(upload: BinaryIO, filename: str | None, template: str):
    """Check the upload's type and size, then open it read-only. The caller closes the workbook."""
    if not (filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail=f"Please upload the provided .xlsx {template} template.")
    data = upload.read(MAX_IMPORT_BYTES + 1)
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail=f"The file is larger than {MAX_IMPORT_BYTES // (1024 * 1024)} MB. Split it into smaller files.")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            expanded = sum(item.file_size for item in archive.infolist())
        if expanded > MAX_IMPORT_EXPANDED_BYTES:
            raise HTTPException(status_code=413, detail="The file is too large once unpacked. Split it into smaller files.")
        return load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="The uploaded Excel file could not be read.")


def sheet_rows(workbook, headers: list[str], max_rows: int = MAX_IMPORT_ROWS, limit_message: str | None = None,
               skip_sheets: frozenset[str] = frozenset()) -> list[tuple[int, list[Any]]]:
    """(row number, cell values) for each non-empty data row of the sheet whose first row is these headers.

    The sheet is found by its header row, so an extra sheet (such as the instructions) or the
    workbook having been saved on another tab does not matter.
    """
    for worksheet in workbook.worksheets:
        if worksheet.title.casefold() in skip_sheets:
            continue
        first = next(worksheet.iter_rows(min_row=1, max_row=1, max_col=len(headers), values_only=True), ())
        if [str(value).strip() if value is not None else None for value in first] == headers:
            break
    else:
        raise HTTPException(status_code=400, detail=f"Invalid template columns. Expected: {', '.join(headers)}.")
    rows = []
    for row_number, values in enumerate(worksheet.iter_rows(min_row=2, max_col=len(headers), values_only=True), start=2):
        cells = list(values) + [None] * (len(headers) - len(values))
        if all(value is None or str(value).strip() == "" for value in cells):
            continue
        if len(rows) == max_rows:
            raise HTTPException(status_code=400, detail=limit_message or f"A file can contain at most {max_rows} rows. Split it into smaller files.")
        rows.append((row_number, cells))
    return rows


def read_import_rows(upload: BinaryIO, filename: str | None, headers: list[str], template: str) -> list[tuple[int, list[Any]]]:
    workbook = open_import_workbook(upload, filename, template)
    try:
        return sheet_rows(workbook, headers, MAX_IMPORT_ROWS)
    finally:
        workbook.close()

"""Reading the People import templates safely.

An .xlsx file is a zip archive, so both the upload and what it expands to are capped before
openpyxl parses it, and only a bounded number of rows is read.
"""
import io
import zipfile
from typing import Any, BinaryIO

from fastapi import HTTPException, UploadFile
from openpyxl import load_workbook
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from services import account_service, invitation_service, permissions
from services.employee_creation import DEFAULT_SYSTEM_ROLE, add_employee, get_or_create_company_role

email_validator = TypeAdapter(EmailStr)

EMPLOYEE_IMPORT_HEADERS = [
    "Employee Name",
    "Employee Email Address",
    "Employee Company Role",
    "Employee System Role",
]
GROUP_IMPORT_HEADERS = ["Group Name", "Group Description"]

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


def import_people_groups(*, file: UploadFile, db: Session):
    import_rows = read_import_rows(file.file, file.filename, GROUP_IMPORT_HEADERS, "group")

    errors = []
    rows = []
    seen_names = set()
    existing_names = {
        name.lower()
        for (name,) in db.query(models.CompanyGroup.name).all()
    }

    for row_number, values in import_rows:
        name = str(values[0]).strip() if values[0] is not None else ""
        description = str(values[1]).strip() if values[1] is not None else ""

        if name == "":
            errors.append(f"Row {row_number}: Group Name is required.")

        name_key = name.lower()
        if name_key != "" and name_key in seen_names:
            errors.append(f"Row {row_number}: Group Name is duplicated in the file.")
        if name_key != "" and name_key in existing_names:
            errors.append(f"Row {row_number}: Group Name already exists in the database.")

        seen_names.add(name_key)
        rows.append((name, description))

    if len(rows) == 0:
        errors.append("The uploaded template does not contain any group rows.")

    if len(errors) > 0:
        return {"created_count": 0, "errors": errors}

    for name, description in rows:
        db.add(
            models.CompanyGroup(
                name=name,
                description=description if description != "" else None,
            )
        )

    db.commit()
    return {"created_count": len(rows), "errors": []}


def import_people_employees(*, file: UploadFile, db: Session, actor: models.User):
    import_rows = read_import_rows(file.file, file.filename, EMPLOYEE_IMPORT_HEADERS, "employee")

    errors = []
    rows = []
    seen_emails = set()
    used_usernames = {username for (username,) in db.query(models.User.username).all()}
    existing_emails = {
        email.lower()
        for (email,) in db.query(models.User.email).all()
    }
    actor_permissions = permissions.role_permissions(db, actor.system_role_id)
    all_roles = {role.name.casefold(): role for role in db.query(models.SystemRole).all()}
    default_role = all_roles.get(DEFAULT_SYSTEM_ROLE.casefold())
    if default_role is None:
        raise HTTPException(status_code=500, detail="Employee system role is unavailable")
    # Like adding one person, an empty System Role means Employee. Any other role is a role
    # assignment, so it needs roles.assign and never more access than the importer holds.
    can_assign = "roles.assign" in actor_permissions
    system_roles = {name: role for name, role in all_roles.items()
                    if can_assign and permissions.role_permissions(db, role.id) <= actor_permissions}
    system_roles[DEFAULT_SYSTEM_ROLE.casefold()] = default_role

    for row_number, values in import_rows:
        name = str(values[0]).strip() if values[0] is not None else ""
        email = str(values[1]).strip() if values[1] is not None else ""
        company_role_name = str(values[2]).strip() if values[2] is not None else ""
        system_role_name = str(values[3]).strip() if values[3] is not None else ""

        if name == "":
            errors.append(f"Row {row_number}: Employee Name is required.")
        if email == "":
            errors.append(f"Row {row_number}: Employee Email Address is required.")
        else:
            try:
                email_validator.validate_python(email)
            except ValidationError:
                errors.append(f"Row {row_number}: Employee Email Address is not a valid email.")
        if company_role_name == "":
            errors.append(f"Row {row_number}: Employee Company Role is required.")
        if system_role_name == "":
            system_role_name = DEFAULT_SYSTEM_ROLE
        elif system_role_name.casefold() not in all_roles:
            errors.append(f"Row {row_number}: Employee System Role “{system_role_name}” does not exist.")
        elif system_role_name.casefold() not in system_roles:
            errors.append(f"Row {row_number}: You are not allowed to assign the “{system_role_name}” system role. "
                          f"Leave the column empty to add the employee as {DEFAULT_SYSTEM_ROLE}.")

        email_key = email.lower()
        if email_key != "" and email_key in seen_emails:
            errors.append(f"Row {row_number}: Employee Email Address is duplicated in the file.")
        if email_key != "" and email_key in existing_emails:
            errors.append(f"Row {row_number}: Employee Email Address already exists in the database.")

        seen_emails.add(email_key)
        rows.append((row_number, name, email_key, company_role_name, system_role_name))

    if len(rows) == 0:
        errors.append("The uploaded template does not contain any employee rows.")

    if len(errors) > 0:
        return {"created_count": 0, "errors": errors}

    created: list[tuple[int, models.User]] = []
    try:
        for row_number, name, email, company_role_name, system_role_name in rows:
            company_role = get_or_create_company_role(company_role_name, db)
            system_role = system_roles[system_role_name.casefold()]
            person = add_employee(name, email, company_role, system_role, used_usernames, db)
            created.append((row_number, person.user))
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Employee email or username already exists") from error
    except Exception:
        db.rollback()
        raise

    # Employees are already saved; a failed invitation can be resent from the People page.
    invitations_sent, invitation_errors = 0, []
    for row_number, new_user in created:
        invited = invitation_service.invite_user(new_user, actor, db)
        if invited.invitation_status == "sent":
            invitations_sent += 1
        elif invited.invitation_status == "failed":
            invitation_errors.append(f"Row {row_number} ({invited.email}): {account_service.invitation_error_message(invited.invitation_error)}")
    return {"created_count": len(rows), "errors": [], "invitations_sent": invitations_sent,
            "invitation_errors": invitation_errors}

"""People administration: employees, invitations, company roles, groups and Excel imports."""

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

import models
import schemas
from api.dependencies import get_db, require_permission
from services import people_service

router = APIRouter()


@router.get("/people", response_model=schemas.PeopleResponse)
def get_people(db: Session = Depends(get_db),
               _employee_reader: models.User = Depends(require_permission("employees.read")),
               _group_reader: models.User = Depends(require_permission("groups.read"))):
    return people_service.get_people(db=db)


@router.post("/people/employees", response_model=schemas.PeopleEmployeeResponse)
def create_people_employee(employee: schemas.PeopleEmployeeCreate, db: Session = Depends(get_db),
                           actor: models.User = Depends(require_permission("employees.manage")),
                           _group_manager: models.User = Depends(require_permission("groups.manage"))):
    return people_service.create_people_employee(employee=employee, db=db, actor=actor)


@router.put("/people/employees/{employee_id}", response_model=schemas.PeopleEmployeeResponse)
def update_people_employee(employee_id: int, employee: schemas.PeopleEmployeeUpdate, db: Session = Depends(get_db),
                           _employee_manager: models.User = Depends(require_permission("employees.manage")),
                           _group_manager: models.User = Depends(require_permission("groups.manage"))):
    return people_service.update_people_employee(employee_id=employee_id, employee=employee, db=db)


@router.get("/people/company-roles", response_model=list[schemas.CompanyRoleUsage])
def get_company_roles(db: Session = Depends(get_db),
                      _reader: models.User = Depends(require_permission("employees.read"))):
    return people_service.company_role_usage(db)


@router.delete("/people/company-roles/{role_id}", response_model=list[schemas.CompanyRoleUsage])
def delete_company_role(role_id: int, db: Session = Depends(get_db),
                        actor: models.User = Depends(require_permission("employees.manage"))):
    """Unused roles are deleted; roles that campaigns refer to are archived so their reports keep the name."""
    return people_service.delete_company_role(role_id=role_id, db=db, actor=actor)


@router.put("/people/employees/{employee_id}/system-role", response_model=schemas.SystemRoleOption)
def update_people_employee_system_role(employee_id: int, update: schemas.EmployeeSystemRoleUpdate,
                                       db: Session = Depends(get_db),
                                       actor: models.User = Depends(require_permission("roles.assign"))):
    return people_service.update_people_employee_system_role(employee_id=employee_id, update=update, db=db, actor=actor)


@router.post("/people/employees/{employee_id}/invitation", response_model=schemas.PeopleEmployeeResponse)
def resend_employee_invitation(employee_id: int, db: Session = Depends(get_db),
                               actor: models.User = Depends(require_permission("employees.manage"))):
    return people_service.resend_employee_invitation(employee_id=employee_id, db=db, actor=actor)


@router.post("/people/groups", response_model=schemas.PeopleGroupResponse)
def create_people_group(group: schemas.PeopleGroupCreate, db: Session = Depends(get_db),
                        _group_manager: models.User = Depends(require_permission("groups.manage"))):
    return people_service.create_people_group(group=group, db=db)


@router.put("/people/groups/{group_id}", response_model=schemas.PeopleGroupResponse)
def update_people_group(group_id: int, group: schemas.PeopleGroupUpdate, db: Session = Depends(get_db),
                        _group_manager: models.User = Depends(require_permission("groups.manage"))):
    return people_service.update_people_group(group_id=group_id, group=group, db=db)


@router.post("/people/groups/{group_id}/members", response_model=schemas.PeopleGroupResponse)
def add_people_group_member(group_id: int, member: schemas.PeopleGroupMemberCreate, db: Session = Depends(get_db),
                            _group_manager: models.User = Depends(require_permission("groups.manage"))):
    return people_service.add_people_group_member(group_id=group_id, member=member, db=db)


@router.delete(
    "/people/groups/{group_id}/members/{employee_id}",
    response_model=schemas.PeopleGroupResponse,
)
def remove_people_group_member(
    group_id: int,
    employee_id: int,
    db: Session = Depends(get_db),
    _group_manager: models.User = Depends(require_permission("groups.manage")),
):
    return people_service.remove_people_group_member(group_id=group_id, employee_id=employee_id, db=db)


@router.post("/people/groups/import", response_model=schemas.PeopleGroupImportResponse)
def import_people_groups(file: UploadFile = File(...), db: Session = Depends(get_db),
                         _group_manager: models.User = Depends(require_permission("groups.manage"))):
    return people_service.import_people_groups(file=file, db=db)


@router.post("/people/employees/import", response_model=schemas.PeopleEmployeeImportResponse)
def import_people_employees(file: UploadFile = File(...), db: Session = Depends(get_db),
                            actor: models.User = Depends(require_permission("employees.manage"))):
    return people_service.import_people_employees(file=file, db=db, actor=actor)

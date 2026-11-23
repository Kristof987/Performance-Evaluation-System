"""An employee's own evaluation work: assigned questionnaires, saving drafts, submitting and the home page."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from api.dependencies import get_current_employee, get_db, require_permission
from services import evaluation_service

router = APIRouter()


@router.get("/users/{user_id}/assigned-evaluations", response_model=list[schemas.AssignedEvaluationResponse])
def get_assigned_evaluations(user_id: int, db: Session = Depends(get_db),
                             actor: models.User = Depends(require_permission("evaluations.read_assigned")),
                             employee: models.Employee = Depends(get_current_employee)):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Assigned evaluations not found")
    return evaluation_service.list_employee_evaluations(employee, db)


@router.get("/users/{user_id}/assigned-evaluations/{evaluation_id}", response_model=schemas.AssignedQuestionnaireResponse)
def get_assigned_questionnaire(user_id: int, evaluation_id: int, db: Session = Depends(get_db),
                               actor: models.User = Depends(require_permission("evaluations.read_assigned")),
                               employee: models.Employee = Depends(get_current_employee)):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Assigned evaluation not found")
    return evaluation_service.employee_questionnaire(employee, evaluation_id, db)


@router.put("/users/{user_id}/assigned-evaluations/{evaluation_id}", response_model=schemas.AssignedQuestionnaireResponse)
def update_assigned_questionnaire(user_id: int, evaluation_id: int, payload: schemas.AssignedQuestionnaireUpdate,
                                  db: Session = Depends(get_db),
                                  actor: models.User = Depends(require_permission("evaluations.submit")),
                                  employee: models.Employee = Depends(get_current_employee)):
    return evaluation_service.update_assigned_questionnaire(user_id=user_id, evaluation_id=evaluation_id, payload=payload, db=db, actor=actor, employee=employee)


@router.get("/users/{user_id}/employee-dashboard", response_model=schemas.EmployeeDashboardResponse)
def get_employee_dashboard(user_id: int, db: Session = Depends(get_db),
                           actor: models.User = Depends(require_permission("evaluations.read_assigned")),
                           employee: models.Employee = Depends(get_current_employee)):
    return evaluation_service.get_employee_dashboard(user_id=user_id, db=db, actor=actor, employee=employee)

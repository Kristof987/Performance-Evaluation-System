from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, EmailStr


class FormStatusCreate(BaseModel):
    name: str

class CampaignEvaluationRuleCreate(BaseModel):
    campaign_id: int
    company_group_id: int
    evaluator_role_id: int
    evaluatee_role_id: int
    form_id: int

class CampaignEvaluationRuleCreate(BaseModel):
    campaign_id: int
    company_group_id: int
    evaluator_role_id: int
    evaluatee_role_id: int
    form_id: int


class CampaignEvaluationRuleResponse(BaseModel):
    id: int
    campaign_id: int
    company_group_id: int
    evaluator_role_id: int
    evaluatee_role_id: int
    form_id: int
    updated_at: datetime

    model_config = {
        "from_attributes": True
    }

class CampaignEvaluationRuleResponse(BaseModel):
    id: int
    campaign_id: int
    company_group_id: int
    evaluator_role_id: int
    evaluatee_role_id: int
    form_id: int
    updated_at: datetime

    model_config = {
        "from_attributes": True
    }

class FormStatusResponse(BaseModel):
    id: int
    name: str

    model_config = {
        "from_attributes": True
    }


class FilledFormCreate(BaseModel):
    campaign_id: int
    evaluator_id: int
    evaluatee_id: int
    form_id: int
    status_id: int
    finish_date: date | None = None
    answers: list[dict[str, Any]]


class FilledFormResponse(BaseModel):
    id: int
    campaign_id: int
    evaluator_id: int
    evaluatee_id: int
    form_id: int
    status_id: int
    finish_date: date | None
    answers: list[dict[str, Any]]
    created_at: datetime

    model_config = {
        "from_attributes": True
    }

# --------------------
# Company Role
# --------------------

class CompanyRoleCreate(BaseModel):
    name: str
    description: str | None = None


class CompanyRoleResponse(BaseModel):
    id: int
    name: str
    description: str | None

    model_config = {
        "from_attributes": True
    }


# --------------------
# System Permission
# --------------------

class SystemPermissionCreate(BaseModel):
    name: str
    description: str | None = None


class SystemPermissionResponse(BaseModel):
    id: int
    name: str
    description: str | None

    model_config = {
        "from_attributes": True
    }


# --------------------
# System Role
# --------------------

class SystemRoleCreate(BaseModel):
    name: str
    description: str | None = None


class SystemRoleResponse(BaseModel):
    id: int
    name: str
    description: str | None

    model_config = {
        "from_attributes": True
    }


# --------------------
# User
# --------------------

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    company_role_id: int
    system_role_id: int


class UserLogin(BaseModel):
    username: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: EmailStr
    company_role_id: int
    system_role_id: int
    profile_image_url: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_login: datetime | None

    model_config = {
        "from_attributes": True
    }

class CampaignCreate(BaseModel):
    name: str
    description: str | None = None
    start_date: date
    end_date: date | None = None
    is_active: bool = True
    comment: str | None = None
    created_by: int


class CampaignResponse(BaseModel):
    id: int
    name: str
    description: str | None
    start_date: date
    end_date: date | None
    is_active: bool
    comment: str | None
    created_by: int

    model_config = {
        "from_attributes": True
    }

class CompanyGroupCreate(BaseModel):
    name: str
    description: str | None = None


class CompanyGroupResponse(BaseModel):
    id: int
    name: str
    description: str | None

    model_config = {
        "from_attributes": True
    }

class FormCreate(BaseModel):
    name: str
    description: str | None = None
    questions: list[dict[str, Any]]


class FormResponse(BaseModel):
    id: int
    name: str
    description: str | None
    questions: list[dict[str, Any]]

    model_config = {
        "from_attributes": True
    }


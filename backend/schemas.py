from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field


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
    role_name: str | None = None
    system_role_id: int
    profile_image_url: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_login: datetime | None

    model_config = {
        "from_attributes": True
    }


class AssignedEvaluationResponse(BaseModel):
    id: int
    campaign_id: int
    campaign_name: str
    form_id: int
    form_name: str
    form_description: str | None
    evaluatee_id: int
    evaluatee_name: str
    status_name: str
    due_date: date | None
    finish_date: date | None
    question_count: int
    answered_count: int
    created_at: datetime


class EmployeeDashboardHistoryItem(BaseModel):
    id: int
    title: str
    subtitle: str
    status: str
    occurred_at: date | datetime | None = None


class EmployeeDashboardResponse(BaseModel):
    evaluations: list[AssignedEvaluationResponse]
    open_count: int
    completed_count: int
    next_review_date: date | None = None
    campaign_date_label: str
    campaign_date: date | None = None
    campaign_date_empty_text: str
    latest_result: AssignedEvaluationResponse | None = None
    history: list[EmployeeDashboardHistoryItem]


class PeopleGroupResponse(BaseModel):
    id: int
    name: str
    description: str | None
    member_count: int = 0


class PeopleEmployeeResponse(BaseModel):
    id: int
    username: str
    email: EmailStr
    company_role_id: int
    role_name: str
    groups: list[PeopleGroupResponse]
    is_active: bool


class PeopleResponse(BaseModel):
    employees: list[PeopleEmployeeResponse]
    groups: list[PeopleGroupResponse]


class PeopleEmployeeCreate(BaseModel):
    name: str
    email: EmailStr
    role: str
    group_ids: list[int] = Field(default_factory=list)


class PeopleEmployeeUpdate(BaseModel):
    name: str
    email: EmailStr
    role: str
    group_ids: list[int] = Field(default_factory=list)


class PeopleEmployeeImportResponse(BaseModel):
    created_count: int
    errors: list[str] = Field(default_factory=list)


class PeopleGroupImportResponse(BaseModel):
    created_count: int
    errors: list[str] = Field(default_factory=list)


class PeopleGroupCreate(BaseModel):
    name: str
    description: str | None = None


class PeopleGroupUpdate(BaseModel):
    name: str
    description: str | None = None


class PeopleGroupMemberCreate(BaseModel):
    user_id: int

class CampaignCreate(BaseModel):
    name: str
    description: str | None = None
    start_date: date
    end_date: date | None = None
    is_active: bool = True
    comment: str | None = None
    created_by: int


class CampaignUpdate(BaseModel):
    name: str
    description: str | None = None
    start_date: date
    end_date: date | None = None
    is_active: bool = True
    comment: str | None = None


class CampaignResponse(BaseModel):
    id: int
    name: str
    description: str | None
    start_date: date
    end_date: date | None
    is_active: bool
    comment: str | None
    created_by: int
    issued_forms_count: int = 0

    model_config = {
        "from_attributes": True
    }


class CampaignGroupsUpdate(BaseModel):
    group_ids: list[int] = Field(default_factory=list)


class DashboardCampaignSummary(BaseModel):
    id: int
    name: str
    is_active: bool


class DashboardMetricSummary(BaseModel):
    assignment_count: int
    submitted_count: int
    completion_rate: int
    awaiting_submission_count: int
    not_started_count: int
    in_progress_count: int
    overdue_count: int
    overdue_forms_count: int
    upcoming_reviews_count: int
    next_review_date: date | None = None


class DashboardFormSummary(BaseModel):
    form_id: int
    name: str
    audience: str
    submitted_count: int
    assignment_count: int
    due_date: date | None = None
    overdue_count: int


class DashboardUpcomingReview(BaseModel):
    campaign_id: int
    name: str
    start_date: date
    participant_count: int
    form_count: int


class DashboardResponse(BaseModel):
    campaigns: list[DashboardCampaignSummary]
    selected_campaign_id: int | None
    metrics: DashboardMetricSummary | None
    forms: list[DashboardFormSummary]
    upcoming_reviews: list[DashboardUpcomingReview]

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


class CampaignGroupsResponse(BaseModel):
    available_groups: list[CompanyGroupResponse]
    assigned_group_ids: list[int]


class CampaignRuleFormOption(BaseModel):
    id: int
    name: str


class CampaignRolePairRule(BaseModel):
    evaluator_role_id: int
    evaluator_role_name: str
    evaluatee_role_id: int
    evaluatee_role_name: str
    form_id: int | None = None
    rule_id: int | None = None


class CampaignGroupRuleMatrix(BaseModel):
    group_id: int
    group_name: str
    role_pairs: list[CampaignRolePairRule]


class CampaignEvaluationRulesResponse(BaseModel):
    forms: list[CampaignRuleFormOption]
    groups: list[CampaignGroupRuleMatrix]


class CampaignEvaluationRuleUpdateItem(BaseModel):
    company_group_id: int
    evaluator_role_id: int
    evaluatee_role_id: int
    form_id: int


class CampaignEvaluationRulesUpdate(BaseModel):
    rules: list[CampaignEvaluationRuleUpdateItem] = Field(default_factory=list)

class FormCreate(BaseModel):
    name: str
    description: str | None = None
    questions: list[dict[str, Any]]


class FormUpdate(BaseModel):
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


class FormTemplateResponse(BaseModel):
    id: int
    name: str
    description: str | None
    questions: list[dict[str, Any]]

    model_config = {
        "from_attributes": True
    }


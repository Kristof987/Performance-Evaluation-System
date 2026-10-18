from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from business_calendar import business_date
from models import CampaignStatus


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
    company_group_id: int | None = None
    evaluator_id: int
    evaluatee_id: int
    form_id: int
    status_id: int
    finish_date: date | None = None
    answers: list[dict[str, Any]]


class FilledFormResponse(BaseModel):
    id: int
    campaign_id: int
    company_group_id: int | None = None
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
    name: str


class UserResponse(BaseModel):
    id: int
    username: str
    employee_id: int | None = None
    full_name: str | None = None
    email: EmailStr
    company_role_id: int | None = None
    role_name: str | None = None
    system_role_id: int
    profile_image_url: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_login: datetime | None

    model_config = {
        "from_attributes": True
    }


class AuthEmployeeResponse(BaseModel):
    id: int
    full_name: str
    company_role_id: int
    company_role_name: str
    is_active: bool

    model_config = {"from_attributes": True}


class AuthMeResponse(BaseModel):
    id: int
    username: str
    email: EmailStr
    system_role_id: int
    system_role_name: str
    permissions: list[str]
    is_active: bool
    employee: AuthEmployeeResponse | None

    model_config = {"from_attributes": True}


class AssignedEvaluationResponse(BaseModel):
    id: int
    evaluator_id: int
    campaign_id: int
    campaign_name: str
    campaign_start_date: date
    campaign_start_at: datetime
    campaign_is_active: bool
    campaign_lifecycle_status: Literal["Scheduled", "Ongoing", "Completed", "Disabled"]
    current_date: date
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


class AssignedQuestionnaireResponse(BaseModel):
    evaluation: AssignedEvaluationResponse
    questions: list[dict[str, Any]]
    answers: list[dict[str, Any]]


class AssignedQuestionnaireUpdate(BaseModel):
    answers: list[dict[str, Any]]
    submit: bool = False


class EmployeeDashboardHistoryItem(BaseModel):
    id: int
    title: str
    subtitle: str
    status: str
    occurred_at: date | datetime | None = None


class EmployeeDashboardResponse(BaseModel):
    current_date: date
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
    user_id: int | None
    username: str
    full_name: str | None = None
    email: str
    company_role_id: int | None = None
    role_name: str
    groups: list[PeopleGroupResponse]
    is_active: bool


class PeopleResponse(BaseModel):
    employees: list[PeopleEmployeeResponse]
    groups: list[PeopleGroupResponse]


class AccountSettingsProfile(BaseModel):
    id: int
    username: str
    full_name: str | None = None
    email: EmailStr
    company_role: str | None
    system_role: str | None = None
    groups: list[PeopleGroupResponse]
    is_active: bool
    last_login: datetime | None = None


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
    employee_id: int

class CampaignCreate(BaseModel):
    name: str
    description: str | None = None
    start_date: date | datetime
    end_date: date | datetime | None = None
    is_active: bool = True
    comment: str | None = None
    created_by: int | None = None


class CampaignUpdate(BaseModel):
    name: str
    description: str | None = None
    start_date: date | datetime | None = None
    end_date: date | datetime | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
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
    submitted_forms_count: int = 0
    current_date: date
    lifecycle_status: Literal["Scheduled", "Ongoing", "Completed", "Disabled"]
    campaign_status: CampaignStatus
    start_at: datetime
    end_at: datetime | None
    is_archived: bool

    model_config = {
        "from_attributes": True
    }


class CampaignGroupsUpdate(BaseModel):
    group_ids: list[int] = Field(default_factory=list)


class DashboardCampaignSummary(BaseModel):
    id: int
    name: str
    is_active: bool
    start_date: date
    end_date: date | None = None
    current_date: date
    lifecycle_status: Literal["Scheduled", "Ongoing", "Completed", "Disabled"]


class DashboardMetricSummary(BaseModel):
    assignment_count: int
    planned_count: int = 0
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


class DashboardParticipantSummary(BaseModel):
    employee_id: int
    name: str
    email: EmailStr | None
    profile_image_url: str | None = None
    role_name: str
    groups: list[str]
    evaluations_left: int = 0


class DashboardUpcomingReview(BaseModel):
    campaign_id: int
    name: str
    start_date: date
    participant_count: int
    form_count: int


class DashboardUpcomingDeadline(BaseModel):
    campaign_id: int
    name: str
    deadline_type: str
    date: date


class DashboardResponse(BaseModel):
    current_date: date
    campaigns: list[DashboardCampaignSummary]
    selected_campaign_id: int | None
    metrics: DashboardMetricSummary | None
    forms: list[DashboardFormSummary]
    participants: list[DashboardParticipantSummary]
    upcoming_reviews: list[DashboardUpcomingReview]
    upcoming_deadlines: list[DashboardUpcomingDeadline]


class CompletionStatusSummary(BaseModel):
    total_evaluations: int
    not_started: int
    in_progress: int
    completed: int
    overdue: int
    completion_rate: int
    outstanding: int


class CompletionStatusQuestionnaireFilter(BaseModel):
    id: int
    name: str


class CompletionStatusRow(BaseModel):
    id: int
    evaluator_id: int
    evaluator_name: str
    evaluator_email: EmailStr | None
    evaluatee_id: int
    evaluatee_name: str
    evaluatee_email: EmailStr | None
    questionnaire_id: int
    questionnaire_name: str
    status_name: str
    status_label: str
    due_date: date | None = None
    completed_at: date | None = None
    is_overdue: bool = False
    is_self_evaluation: bool = False


class CompletionStatusPagination(BaseModel):
    page: int
    page_size: int
    total_items: int
    total_pages: int


class CompletionStatusResponse(BaseModel):
    campaign: DashboardCampaignSummary
    summary: CompletionStatusSummary
    rows: list[CompletionStatusRow]
    questionnaires: list[CompletionStatusQuestionnaireFilter]
    pagination: CompletionStatusPagination
    duplicate_assignment_count: int = 0


class ReportCampaignOption(BaseModel):
    id: int
    name: str
    start_date: date
    end_date: date | None = None
    is_active: bool

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def preserve_legacy_calendar_date(cls, value):
        return business_date(value)


class ReportKpiSummary(BaseModel):
    total_evaluations: int
    completed_evaluations: int
    completion_rate: int
    submitted_evaluations: int
    employees_evaluated: int
    overall_score: float | None = None
    overall_score_label: str
    overall_score_context: str
    overall_score_scale: str | None = None
    overall_availability: Literal["available", "no_data", "suppressed"]


class ReportSectionScore(BaseModel):
    id: int
    name: str
    average_score: float | None = None
    availability: Literal["available", "no_data", "suppressed"]
    evaluatee_count: int
    evaluator_count: int


class ReportGroupSummary(BaseModel):
    group_id: int
    group_name: str
    employee_count: int
    total_evaluations: int
    completed_evaluations: int
    completion_rate: int
    average_score: float | None = None
    score_availability: Literal["available", "no_data", "suppressed"]
    average_score_context: str


class ReportEmployeeOverview(BaseModel):
    participating_employees: int
    employees_with_completed_peer_feedback: int
    employees_awaiting_peer_feedback: int
    configured_self_evaluations: int
    completed_self_evaluations: int


class ReportDataNotes(BaseModel):
    completed_definition: str
    answer_storage: str
    question_identity: str
    historical_versions: str
    section_policy: str
    self_evaluation_policy: str
    participant_deduplication: str
    group_attribution: str
    confidentiality: str


class CampaignReportOverviewResponse(BaseModel):
    campaign: ReportCampaignOption
    kpis: ReportKpiSummary
    sections: list[ReportSectionScore]
    groups: list[ReportGroupSummary]
    employees: ReportEmployeeOverview
    notes: ReportDataNotes


class ReportQuestionBucket(BaseModel):
    label: str
    count: int
    percentage: float


class ReportQuestionResult(BaseModel):
    key: str
    text: str
    type: str
    category: Literal["rating", "choice", "text"]
    section_id: int | None
    section_name: str
    required: bool
    required_modes: list[Literal["required", "optional"]]
    scale_min: int | None = None
    scale_max: int | None = None
    availability: Literal["available", "no_data", "suppressed"]
    response_count: int | None
    average_normalized: float | None = None
    distribution_kind: Literal["original", "options"] | None = None
    distribution: list[ReportQuestionBucket] | None = None


class ReportQuestionsResponse(BaseModel):
    evaluation_type: Literal["peer", "self"]
    questions: list[ReportQuestionResult]
    notes: dict[str, str]


class SectionCreate(BaseModel):
    name: str


class SectionUpdate(BaseModel):
    name: str


class SectionResponse(BaseModel):
    id: int
    name: str
    is_archived: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

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


class CampaignSelfEvaluationAssignment(BaseModel):
    employee_id: int
    form_id: int | None


class CampaignSelfEvaluationsUpdate(BaseModel):
    assignments: list[CampaignSelfEvaluationAssignment] = Field(default_factory=list)


class CampaignSelfEvaluationParticipant(BaseModel):
    employee_id: int
    employee_name: str
    role_name: str
    group_names: list[str]
    form_id: int | None
    locked: bool


class CampaignRuleFormOption(BaseModel):
    id: int
    name: str


class CampaignSelfEvaluationsResponse(BaseModel):
    forms: list[CampaignRuleFormOption]
    participants: list[CampaignSelfEvaluationParticipant]


class CampaignRolePairRule(BaseModel):
    evaluator_role_id: int
    evaluator_role_name: str
    evaluatee_role_id: int
    evaluatee_role_name: str
    form_id: int | None = None
    rule_id: int | None = None
    locked: bool = False


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


class CampaignEvaluationMatrixEmployee(BaseModel):
    id: int
    name: str
    role_id: int
    role_name: str
    active: bool = True


class CampaignEvaluationMatrixAssignment(BaseModel):
    evaluator_id: int
    evaluatee_id: int
    form_id: int
    filled_form_id: int
    issued: bool = False
    is_completed: bool = False
    status_name: str
    has_answers: bool = False


class CampaignGroupEvaluationMatrix(BaseModel):
    group_id: int
    group_name: str
    employees: list[CampaignEvaluationMatrixEmployee]
    assignments: list[CampaignEvaluationMatrixAssignment]


class CampaignEvaluationMatrixResponse(BaseModel):
    groups: list[CampaignGroupEvaluationMatrix]
    issuance_errors: list[str] = Field(default_factory=list)


class CampaignEvaluationMatrixUpdateItem(BaseModel):
    company_group_id: int
    evaluator_id: int
    evaluatee_id: int


class CampaignEvaluationMatrixUpdate(BaseModel):
    assignments: list[CampaignEvaluationMatrixUpdateItem] = Field(default_factory=list)


class CampaignSetupMembershipChange(BaseModel):
    company_group_id: int
    employee_id: int
    included: bool


class CampaignSetupUpdate(BaseModel):
    group_ids: list[int]
    rules: list[CampaignEvaluationRuleUpdateItem]
    self_evaluations: list[CampaignSelfEvaluationAssignment]
    assignments: list[CampaignEvaluationMatrixUpdateItem]
    memberships: list[CampaignSetupMembershipChange] = Field(default_factory=list)


class CampaignEvaluationMatrixUpdateResponse(CampaignEvaluationMatrixResponse):
    created_count: int = 0
    removed_count: int = 0
    kept_completed_count: int = 0

class FormCreate(BaseModel):
    name: str
    description: str | None = None
    questions: list[dict[str, Any]] = Field(default_factory=list)
    source_template_id: int | None = None


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


class FormValidationResponse(BaseModel):
    valid_for_issuance: bool
    errors: list[str] = Field(default_factory=list)

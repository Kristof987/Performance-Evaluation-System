from enum import Enum

from sqlalchemy import (
    Boolean,
    LargeBinary,
    Column,
    DateTime,
    Date,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    Index,
    text,
)
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from database import Base


class CampaignStatus(str, Enum):
    DRAFT = "draft"
    SCHEDULED = "scheduled"
    ACTIVE = "active"
    PAUSED = "paused"
    REVIEW = "review"
    CLOSED = "closed"

class CampaignEvaluationRule(Base):
    __tablename__ = "campaign_evaluation_rules"

    id = Column(Integer, primary_key=True, index=True)

    campaign_id = Column(
        Integer,
        ForeignKey("campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )

    company_group_id = Column(
        Integer,
        ForeignKey("company_groups.id", ondelete="CASCADE"),
        nullable=False,
    )

    evaluator_role_id = Column(
        Integer,
        ForeignKey("company_roles.id"),
        nullable=False,
    )

    evaluatee_role_id = Column(
        Integer,
        ForeignKey("company_roles.id"),
        nullable=False,
    )

    form_id = Column(
        Integer,
        ForeignKey("forms.id"),
        nullable=False,
    )

    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "campaign_id",
            "company_group_id",
            "evaluator_role_id",
            "evaluatee_role_id",
            name="uq_campaign_group_evaluation_rule",
        ),
    )

employee_company_groups = Table(
    "employee_company_groups",
    Base.metadata,

    Column(
        "employee_id",
        Integer,
        ForeignKey("employees.id", ondelete="CASCADE"),
        primary_key=True,
    ),

    Column(
        "company_group_id",
        Integer,
        ForeignKey("company_groups.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)

campaign_company_groups = Table(
    "campaign_company_groups",
    Base.metadata,

    Column(
        "campaign_id",
        Integer,
        ForeignKey("campaigns.id", ondelete="CASCADE"),
        primary_key=True,
    ),

    Column(
        "company_group_id",
        Integer,
        ForeignKey("company_groups.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)

company_group_leaders = Table(
    "company_group_leaders",
    Base.metadata,
    Column("company_group_id", Integer, ForeignKey("company_groups.id", ondelete="CASCADE"), primary_key=True),
    Column("employee_id", Integer, ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True),
)

class FormStatus(Base):
    __tablename__ = "form_statuses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)


class FilledForm(Base):
    __tablename__ = "filled_forms"

    id = Column(Integer, primary_key=True, index=True)

    campaign_id = Column(
        Integer,
        ForeignKey("campaigns.id"),
        nullable=False,
    )

    company_group_id = Column(
        Integer,
        ForeignKey("company_groups.id"),
        nullable=True,
    )

    evaluator_id = Column(
        Integer,
        ForeignKey("employees.id"),
        nullable=False,
    )

    evaluatee_id = Column(
        Integer,
        ForeignKey("employees.id"),
        nullable=False,
    )

    # Company roles at issuance, so reports keep history when people are promoted later.
    # NULL while the assignment is still planned: until then the current role applies.
    evaluator_company_role_id = Column(Integer, ForeignKey("company_roles.id"), nullable=True)
    evaluatee_company_role_id = Column(Integer, ForeignKey("company_roles.id"), nullable=True)

    form_id = Column(
        Integer,
        ForeignKey("forms.id"),
        nullable=True,
    )

    status_id = Column(
        Integer,
        ForeignKey("form_statuses.id"),
        nullable=False,
    )

    finish_date = Column(
        Date,
        nullable=True,
    )

    answers = Column(
        JSONB,
        nullable=False,
    )

    form_snapshot = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )

    snapshot_status = Column(
        String,
        nullable=True,
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class PasswordResetRequest(Base):
    __tablename__ = "password_reset_requests"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    requested_at = Column(DateTime(timezone=True), nullable=False)


class UserPreferences(Base):
    __tablename__ = "user_preferences"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    theme = Column(String(8), nullable=False, server_default="system")
    language = Column(String(2), nullable=False, server_default="en")
    date_format = Column(String(8), nullable=False, server_default="locale")
    notify_new_assignment = Column(Boolean, nullable=False, server_default=text("true"))
    notify_results_available = Column(Boolean, nullable=False, server_default=text("true"))
    notify_campaign_status = Column(Boolean, nullable=False, server_default=text("true"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("theme IN ('system', 'light', 'dark')", name="ck_user_preferences_theme"),
        CheckConstraint("language IN ('en', 'hu')", name="ck_user_preferences_language"),
        CheckConstraint("date_format IN ('locale', 'iso')", name="ck_user_preferences_date_format"),
    )


class ProfilePhoto(Base):
    """An employee's current photo; a new upload gets a new random ID so old URLs stop working."""
    __tablename__ = "profile_photos"

    id = Column(String(32), primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, unique=True)
    content = Column(LargeBinary, nullable=False)
    content_type = Column(String(32), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class WorkspaceSettings(Base):
    """One row per workspace scope; a missing row means every default applies."""
    __tablename__ = "workspace_settings"

    scope_key = Column(String(32), primary_key=True, default="default")
    min_individual_peer_reviewers = Column(Integer, nullable=False, server_default="2")
    min_aggregate_evaluatees = Column(Integer, nullable=False, server_default="2")
    ai_enabled = Column(Boolean, nullable=False, server_default=text("true"))
    ai_model = Column(String(100), nullable=True)
    # Reminder emails every campaign uses unless HR sets its own (days before the end date).
    default_reminder_days = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    default_launch_email = Column(Boolean, nullable=False, server_default=text("true"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    updated_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    __table_args__ = (
        CheckConstraint("min_individual_peer_reviewers BETWEEN 2 AND 20", name="ck_workspace_min_peer_reviewers"),
        CheckConstraint("min_aggregate_evaluatees BETWEEN 2 AND 20", name="ck_workspace_min_aggregate_evaluatees"),
    )


class SettingsAuditEvent(Base):
    __tablename__ = "settings_audit_events"

    id = Column(Integer, primary_key=True)
    category = Column(String(16), nullable=False)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    summary = Column(String(500), nullable=False)
    details = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))

    __table_args__ = (
        CheckConstraint("category IN ('privacy', 'ai', 'permissions', 'accounts', 'notifications')", name="ck_settings_audit_category"),
    )


class EmployeeAIAnalysis(Base):
    __tablename__ = "employee_ai_analyses"

    id = Column(Integer, primary_key=True)
    generation_job_id = Column(Integer, ForeignKey("ai_analysis_generation_jobs.id", name="fk_employee_ai_generation_job"), nullable=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    evaluatee_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    version = Column(Integer, nullable=False)
    parent_analysis_id = Column(Integer, ForeignKey("employee_ai_analyses.id"), nullable=True)
    status = Column(String(16), nullable=False, default="draft")
    is_current_approved = Column(Boolean, nullable=False, default=False)
    analysis = Column(JSONB, nullable=False)
    evidence_summary = Column(JSONB, nullable=False)
    model_identifier = Column(String(120), nullable=False)
    generated_at = Column(DateTime(timezone=True), nullable=False)
    generated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    source_fingerprint = Column(String(64), nullable=False)
    schema_version = Column(Integer, nullable=False, default=1)
    prompt_version = Column(String(120), nullable=True)
    generation_parameters = Column(JSONB, nullable=True)
    token_usage = Column(JSONB, nullable=True)

    __table_args__ = (
        UniqueConstraint("generation_job_id", name="uq_employee_ai_generation_job"),
        UniqueConstraint("campaign_id", "evaluatee_employee_id", "version", name="uq_employee_ai_analysis_version"),
        Index("uq_employee_ai_current_approved", "campaign_id", "evaluatee_employee_id", unique=True,
              postgresql_where=text("is_current_approved")),
        CheckConstraint("version > 0 AND schema_version = 1", name="ck_employee_ai_version_schema"),
        CheckConstraint("status IN ('draft', 'approved')", name="ck_employee_ai_status"),
        CheckConstraint("NOT is_current_approved OR status = 'approved'", name="ck_employee_ai_current_status"),
        CheckConstraint("(status = 'draft' AND approved_at IS NULL AND approved_by_user_id IS NULL) OR "
                        "(status = 'approved' AND approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL)",
                        name="ck_employee_ai_approval_fields"),
    )


class AggregateAIAnalysis(Base):
    __tablename__ = "aggregate_ai_analyses"

    id = Column(Integer, primary_key=True)
    generation_job_id = Column(Integer, ForeignKey("ai_analysis_generation_jobs.id", name="fk_aggregate_ai_generation_job"), nullable=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    scope_type = Column(String(16), nullable=False)
    scope_id = Column(Integer, nullable=True)
    version = Column(Integer, nullable=False)
    parent_analysis_id = Column(Integer, ForeignKey("aggregate_ai_analyses.id"), nullable=True)
    status = Column(String(16), nullable=False, default="draft")
    is_current_approved = Column(Boolean, nullable=False, default=False)
    analysis = Column(JSONB, nullable=False)
    evidence_summary = Column(JSONB, nullable=False)
    model_identifier = Column(String(120), nullable=False)
    generated_at = Column(DateTime(timezone=True), nullable=False)
    generated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    source_fingerprint = Column(String(64), nullable=False)
    schema_version = Column(Integer, nullable=False, default=1)
    prompt_version = Column(String(120), nullable=True)
    generation_parameters = Column(JSONB, nullable=True)
    token_usage = Column(JSONB, nullable=True)

    __table_args__ = (
        UniqueConstraint("generation_job_id", name="uq_aggregate_ai_generation_job"),
        UniqueConstraint("campaign_id", "scope_type", "scope_id", "version", name="uq_aggregate_ai_version"),
        Index("ix_aggregate_ai_subject", "campaign_id", "scope_type", "scope_id"),
        Index("uq_aggregate_ai_current_approved", "campaign_id", "scope_type", "scope_id", unique=True,
              postgresql_where=text("is_current_approved")),
        Index("uq_aggregate_ai_campaign_version", "campaign_id", "version", unique=True,
              postgresql_where=text("scope_type = 'campaign'")),
        Index("uq_aggregate_ai_campaign_approved", "campaign_id", unique=True,
              postgresql_where=text("scope_type = 'campaign' AND is_current_approved")),
        CheckConstraint("(scope_type = 'campaign' AND scope_id IS NULL) OR "
                        "(scope_type IN ('group', 'role') AND scope_id IS NOT NULL AND scope_id > 0)",
                        name="ck_aggregate_ai_scope"),
        CheckConstraint("version > 0 AND schema_version = 1", name="ck_aggregate_ai_version_schema"),
        CheckConstraint("status IN ('draft', 'approved')", name="ck_aggregate_ai_status"),
        CheckConstraint("NOT is_current_approved OR status = 'approved'", name="ck_aggregate_ai_current_status"),
        CheckConstraint("(status = 'draft' AND approved_at IS NULL AND approved_by_user_id IS NULL) OR "
                        "(status = 'approved' AND approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL)",
                        name="ck_aggregate_ai_approval_fields"),
    )


class AIPromptVersion(Base):
    """The exact prompt text behind a prompt version hash."""
    __tablename__ = "ai_prompt_versions"

    version = Column(String(120), primary_key=True)
    name = Column(String(60), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AIAnalysisGenerationJob(Base):
    __tablename__ = "ai_analysis_generation_jobs"

    id = Column(Integer, primary_key=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    scope_type = Column(String(16), nullable=False)
    scope_id = Column(Integer, nullable=True)
    status = Column(String(16), nullable=False)
    requested_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    lease_expires_at = Column(DateTime(timezone=True), nullable=True)
    worker_token = Column(String(36), nullable=True)
    analysis_id = Column(Integer, nullable=True)
    error_code = Column(String(64), nullable=True)

    __table_args__ = (
        CheckConstraint("(scope_type = 'campaign' AND scope_id IS NULL) OR "
                        "(scope_type IN ('employee', 'group', 'role') AND scope_id IS NOT NULL AND scope_id > 0)",
                        name="ck_ai_generation_scope"),
        CheckConstraint("status IN ('queued', 'running', 'succeeded', 'failed')", name="ck_ai_generation_status"),
        CheckConstraint("(status IN ('queued', 'running') AND finished_at IS NULL) OR "
                        "(status IN ('succeeded', 'failed') AND finished_at IS NOT NULL)", name="ck_ai_generation_finished"),
        CheckConstraint("status <> 'succeeded' OR analysis_id IS NOT NULL", name="ck_ai_generation_result"),
        Index("ix_ai_generation_subject_latest", "campaign_id", "scope_type", "scope_id", "id"),
        Index("uq_ai_generation_active_subject", "campaign_id", "scope_type", "scope_id", unique=True,
              postgresql_where=text("status IN ('queued', 'running') AND scope_id IS NOT NULL")),
        Index("uq_ai_generation_active_campaign", "campaign_id", unique=True,
              postgresql_where=text("status IN ('queued', 'running') AND scope_type = 'campaign'")),
    )


class CampaignEmployeeSelfEvaluation(Base):
    __tablename__ = "campaign_employee_self_evaluations"

    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True)
    form_id = Column(Integer, ForeignKey("forms.id"), nullable=False)


class Form(Base):
    __tablename__ = "forms"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    questions = Column(JSONB, nullable=False)
    # Set when a form that past campaigns refer to is "deleted": hidden from lists and pickers, kept for history.
    archived_at = Column(DateTime(timezone=True), nullable=True)


class FormTemplate(Base):
    __tablename__ = "form_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    questions = Column(JSONB, nullable=False)


class Section(Base):
    __tablename__ = "sections"

    id = Column(Integer, primary_key=True, index=True)
    # The current application has no Company entity; retain an explicit scope key
    # until company tenancy is introduced rather than implying a nonexistent FK.
    scope_key = Column(String, nullable=False, default="default")
    name = Column(String(120), nullable=False)
    normalized_name = Column(String(120), nullable=False)
    is_archived = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("scope_key", "normalized_name", name="uq_section_scope_name"),
    )

system_role_permissions = Table(
    "system_role_permissions",
    Base.metadata,
    Column(
        "system_role_id",
        Integer,
        ForeignKey("system_roles.id"),
        primary_key=True,
    ),
    Column(
        "permission_id",
        Integer,
        ForeignKey("system_permissions.id"),
        primary_key=True,
    ),
)


class CompanyRole(Base):
    __tablename__ = "company_roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)
    # Archived roles disappear from pickers but keep their name in historical reports.
    archived_at = Column(DateTime(timezone=True), nullable=True)


class SystemRole(Base):
    __tablename__ = "system_roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)


class SystemPermission(Base):
    __tablename__ = "system_permissions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    username = Column(String, unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    auth0_user_id = Column(String(255), nullable=True)

    __table_args__ = (
        UniqueConstraint("auth0_user_id", name="uq_users_auth0_user_id"),
        CheckConstraint("invitation_status IN ('not_sent', 'sent', 'failed')", name="ck_users_invitation_status"),
    )

    system_role_id = Column(
        Integer,
        ForeignKey("system_roles.id"),
        nullable=False,
    )

    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    last_login = Column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Sign-in invitation sent through Auth0; see services.invitation_service.invite_user.
    invitation_status = Column(String(16), nullable=False, default="not_sent", server_default="not_sent")
    invitation_sent_at = Column(DateTime(timezone=True), nullable=True)
    invitation_error = Column(String(64), nullable=True)

    employee = relationship("Employee", back_populates="user", uselist=False)


class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), unique=True, nullable=True)
    full_name = Column(String, nullable=False)
    company_role_id = Column(Integer, ForeignKey("company_roles.id"), nullable=False)
    profile_image_url = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User", back_populates="employee")

class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String, nullable=False)
    description = Column(String, nullable=True)

    start_date = Column(DateTime(timezone=True), nullable=False)
    end_date = Column(DateTime(timezone=True), nullable=True)

    status = Column(String(16), nullable=False, default=CampaignStatus.DRAFT.value, server_default=CampaignStatus.DRAFT.value)
    paused_from_status = Column(String(16), nullable=True)
    is_archived = Column(Boolean, nullable=False, default=False, server_default="false")
    archived_at = Column(DateTime(timezone=True), nullable=True)
    archived_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    unarchived_at = Column(DateTime(timezone=True), nullable=True)
    unarchived_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    ever_issued = Column(Boolean, nullable=False, default=False, server_default="false")
    # Email everyone with evaluations when the campaign opens; off for campaigns that were already running.
    launch_email_enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    # False: the workspace default reminders apply; True: this campaign's own campaign_reminders rows do.
    custom_reminders = Column(Boolean, nullable=False, default=False, server_default="false")
    # Compatibility boundary: migration-era campaigns must not acquire new snapshots
    # through the old, date/flag-driven issuance path before lifecycle integration.
    legacy_issuance_blocked = Column(Boolean, nullable=False, default=False, server_default="false")
    lifecycle_error = Column(String, nullable=True)
    lifecycle_retry_at = Column(DateTime(timezone=True), nullable=True)
    lifecycle_attempts = Column(Integer, nullable=False, default=0, server_default="0")
    last_transition_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('draft', 'scheduled', 'active', 'paused', 'review', 'closed')", name="ck_campaign_status"),
        CheckConstraint("(status = 'paused' AND paused_from_status IN ('active', 'review')) OR (status <> 'paused' AND paused_from_status IS NULL)", name="ck_campaign_paused_from_status"),
    )

    is_active = Column(Boolean, default=True, nullable=False)

    comment = Column(String, nullable=True)

    created_by = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
    )


class CampaignLifecycleHistory(Base):
    __tablename__ = "campaign_lifecycle_history"

    id = Column(Integer, primary_key=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    previous_status = Column(String(16), nullable=False)
    new_status = Column(String(16), nullable=False)
    transitioned_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    is_automatic = Column(Boolean, nullable=False)

    __table_args__ = (
        CheckConstraint("previous_status IN ('draft', 'scheduled', 'active', 'paused', 'review', 'closed')", name="ck_campaign_history_previous_status"),
        CheckConstraint("new_status IN ('draft', 'scheduled', 'active', 'paused', 'review', 'closed')", name="ck_campaign_history_new_status"),
        CheckConstraint("is_automatic OR actor_user_id IS NOT NULL", name="ck_campaign_history_manual_actor"),
    )


class CampaignArchiveEvent(Base):
    __tablename__ = "campaign_archive_events"

    id = Column(Integer, primary_key=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    action = Column(String(16), nullable=False)
    occurred_at = Column(DateTime(timezone=True), nullable=False)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    __table_args__ = (CheckConstraint("action IN ('archive', 'unarchive')", name="ck_campaign_archive_action"),)


class CampaignReminder(Base):
    """An extra reminder email, sent a number of calendar days before the campaign ends."""
    __tablename__ = "campaign_reminders"

    id = Column(Integer, primary_key=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    days_before_end = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    __table_args__ = (
        UniqueConstraint("campaign_id", "days_before_end", name="uq_campaign_reminder_days"),
        CheckConstraint("days_before_end BETWEEN 0 AND 90", name="ck_campaign_reminder_days"),
    )


class EmailDelivery(Base):
    """One email to one person; the dedupe key makes every scheduled email go out at most once."""
    __tablename__ = "email_deliveries"

    id = Column(Integer, primary_key=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String(16), nullable=False)
    reminder_id = Column(Integer, ForeignKey("campaign_reminders.id", ondelete="SET NULL"), nullable=True)
    reminder_days = Column(Integer, nullable=True)
    dedupe_key = Column(String(120), nullable=False, unique=True)
    recipient = Column(String, nullable=False)
    status = Column(String(16), nullable=False, default="pending")
    error = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    __table_args__ = (
        CheckConstraint("kind IN ('launch', 'reminder', 'manual')", name="ck_email_delivery_kind"),
        CheckConstraint("status IN ('pending', 'sent', 'failed')", name="ck_email_delivery_status"),
    )


class CampaignOperationAudit(Base):
    __tablename__ = "campaign_operation_audit"

    id = Column(Integer, primary_key=True)
    campaign_id = Column(Integer, nullable=False, index=True)
    category = Column(String(24), nullable=False)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    is_automatic = Column(Boolean, nullable=False)
    occurred_at = Column(DateTime(timezone=True), nullable=False)
    previous_status = Column(String(16), nullable=False)
    resulting_status = Column(String(16), nullable=True)
    issued_count = Column(Integer, nullable=False, default=0, server_default="0")

    __table_args__ = (
        CheckConstraint("category IN ('snapshot_issuance', 'transition_failure', 'delete', 'deadline_extension')",
                        name="ck_campaign_operation_category"),
        CheckConstraint("issued_count >= 0", name="ck_campaign_operation_issued_count"),
    )

class CompanyGroup(Base):
    __tablename__ = "company_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)

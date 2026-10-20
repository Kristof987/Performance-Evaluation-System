from enum import Enum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Date,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Table,
    UniqueConstraint,
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

    form_id = Column(
        Integer,
        ForeignKey("forms.id"),
        nullable=False,
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
        CheckConstraint("category IN ('snapshot_issuance', 'transition_failure', 'delete')", name="ck_campaign_operation_category"),
        CheckConstraint("issued_count >= 0", name="ck_campaign_operation_issued_count"),
    )

class CompanyGroup(Base):
    __tablename__ = "company_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)

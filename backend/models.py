from sqlite3 import Date

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Date,
    ForeignKey,
    Integer,
    String,
    Table,
    UniqueConstraint
)
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB

from database import Base

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

user_company_groups = Table(
    "user_company_groups",
    Base.metadata,

    Column(
        "user_id",
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
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
        ForeignKey("users.id"),
        nullable=False,
    )

    evaluatee_id = Column(
        Integer,
        ForeignKey("users.id"),
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

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

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

    company_role_id = Column(
        Integer,
        ForeignKey("company_roles.id"),
        nullable=False,
    )

    system_role_id = Column(
        Integer,
        ForeignKey("system_roles.id"),
        nullable=False,
    )

    profile_image_url = Column(String, nullable=True)

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

class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String, nullable=False)
    description = Column(String, nullable=True)

    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)

    is_active = Column(Boolean, default=True, nullable=False)

    comment = Column(String, nullable=True)

    created_by = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
    )

class CompanyGroup(Base):
    __tablename__ = "company_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)

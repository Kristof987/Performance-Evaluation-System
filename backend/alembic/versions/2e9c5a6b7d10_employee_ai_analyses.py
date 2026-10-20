"""Versioned employee AI analyses and current-approval uniqueness.

Revision ID: 2e9c5a6b7d10
Revises: b5a9e0d1c742
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "2e9c5a6b7d10"
down_revision = "b5a9e0d1c742"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "employee_ai_analyses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("evaluatee_employee_id", sa.Integer(), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("parent_analysis_id", sa.Integer(), sa.ForeignKey("employee_ai_analyses.id"), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("is_current_approved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("analysis", postgresql.JSONB(), nullable=False),
        sa.Column("evidence_summary", postgresql.JSONB(), nullable=False),
        sa.Column("model_identifier", sa.String(120), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("generated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("edited_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("source_fingerprint", sa.String(64), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.UniqueConstraint("campaign_id", "evaluatee_employee_id", "version", name="uq_employee_ai_analysis_version"),
        sa.CheckConstraint("version > 0 AND schema_version = 1", name="ck_employee_ai_version_schema"),
        sa.CheckConstraint("status IN ('draft', 'approved')", name="ck_employee_ai_status"),
        sa.CheckConstraint("NOT is_current_approved OR status = 'approved'", name="ck_employee_ai_current_status"),
        sa.CheckConstraint("(status = 'draft' AND approved_at IS NULL AND approved_by_user_id IS NULL) OR "
                           "(status = 'approved' AND approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL)",
                           name="ck_employee_ai_approval_fields"),
    )
    op.create_index("ix_employee_ai_subject", "employee_ai_analyses", ["campaign_id", "evaluatee_employee_id"])
    op.create_index("uq_employee_ai_current_approved", "employee_ai_analyses", ["campaign_id", "evaluatee_employee_id"],
                    unique=True, postgresql_where=sa.text("is_current_approved"))


def downgrade():
    raise RuntimeError("Downgrading would discard historical HR-approved analyses; restore a verified backup instead")

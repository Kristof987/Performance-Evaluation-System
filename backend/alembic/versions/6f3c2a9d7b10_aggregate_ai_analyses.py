"""Persist versioned group, role and campaign AI analyses.

Revision ID: 6f3c2a9d7b10
Revises: 2e9c5a6b7d10
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "6f3c2a9d7b10"
down_revision = "2e9c5a6b7d10"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "aggregate_ai_analyses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope_type", sa.String(16), nullable=False),
        sa.Column("scope_id", sa.Integer(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("parent_analysis_id", sa.Integer(), sa.ForeignKey("aggregate_ai_analyses.id"), nullable=True),
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
        sa.UniqueConstraint("campaign_id", "scope_type", "scope_id", "version", name="uq_aggregate_ai_version"),
        sa.CheckConstraint("(scope_type = 'campaign' AND scope_id IS NULL) OR "
                           "(scope_type IN ('group', 'role') AND scope_id IS NOT NULL AND scope_id > 0)",
                           name="ck_aggregate_ai_scope"),
        sa.CheckConstraint("version > 0 AND schema_version = 1", name="ck_aggregate_ai_version_schema"),
        sa.CheckConstraint("status IN ('draft', 'approved')", name="ck_aggregate_ai_status"),
        sa.CheckConstraint("NOT is_current_approved OR status = 'approved'", name="ck_aggregate_ai_current_status"),
        sa.CheckConstraint("(status = 'draft' AND approved_at IS NULL AND approved_by_user_id IS NULL) OR "
                           "(status = 'approved' AND approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL)",
                           name="ck_aggregate_ai_approval_fields"),
    )
    op.create_index("ix_aggregate_ai_subject", "aggregate_ai_analyses", ["campaign_id", "scope_type", "scope_id"])
    op.create_index("uq_aggregate_ai_current_approved", "aggregate_ai_analyses",
                    ["campaign_id", "scope_type", "scope_id"], unique=True,
                    postgresql_where=sa.text("is_current_approved"))
    # PostgreSQL treats NULLs as distinct in a partial unique index: campaign
    # analyses need a separate constraint for their single NULL scope_id.
    op.create_index("uq_aggregate_ai_campaign_version", "aggregate_ai_analyses", ["campaign_id", "version"],
                    unique=True, postgresql_where=sa.text("scope_type = 'campaign'"))
    op.create_index("uq_aggregate_ai_campaign_approved", "aggregate_ai_analyses", ["campaign_id"],
                    unique=True, postgresql_where=sa.text("scope_type = 'campaign' AND is_current_approved"))


def downgrade():
    raise RuntimeError("Downgrading would discard historical HR-approved analyses; restore a verified backup instead")

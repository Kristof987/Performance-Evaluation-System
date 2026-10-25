"""Durable per-subject AI generation jobs.

Revision ID: ab83f172d640
Revises: 6f3c2a9d7b10
"""

from alembic import op
import sqlalchemy as sa


revision = "ab83f172d640"
down_revision = "6f3c2a9d7b10"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_analysis_generation_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope_type", sa.String(16), nullable=False),
        sa.Column("scope_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("worker_token", sa.String(36), nullable=True),
        sa.Column("analysis_id", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.CheckConstraint("(scope_type = 'campaign' AND scope_id IS NULL) OR "
                           "(scope_type IN ('employee', 'group', 'role') AND scope_id IS NOT NULL AND scope_id > 0)",
                           name="ck_ai_generation_scope"),
        sa.CheckConstraint("status IN ('queued', 'running', 'succeeded', 'failed')", name="ck_ai_generation_status"),
        sa.CheckConstraint("(status IN ('queued', 'running') AND finished_at IS NULL) OR "
                           "(status IN ('succeeded', 'failed') AND finished_at IS NOT NULL)", name="ck_ai_generation_finished"),
        sa.CheckConstraint("status <> 'succeeded' OR analysis_id IS NOT NULL", name="ck_ai_generation_result"),
    )
    op.create_index("ix_ai_generation_subject_latest", "ai_analysis_generation_jobs",
                    ["campaign_id", "scope_type", "scope_id", "id"])
    op.create_index("uq_ai_generation_active_subject", "ai_analysis_generation_jobs",
                    ["campaign_id", "scope_type", "scope_id"], unique=True,
                    postgresql_where=sa.text("status IN ('queued', 'running') AND scope_id IS NOT NULL"))
    op.create_index("uq_ai_generation_active_campaign", "ai_analysis_generation_jobs", ["campaign_id"],
                    unique=True, postgresql_where=sa.text("status IN ('queued', 'running') AND scope_type = 'campaign'"))
    op.add_column("employee_ai_analyses", sa.Column("generation_job_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_employee_ai_generation_job", "employee_ai_analyses", "ai_analysis_generation_jobs",
                          ["generation_job_id"], ["id"])
    op.create_unique_constraint("uq_employee_ai_generation_job", "employee_ai_analyses", ["generation_job_id"])
    op.add_column("aggregate_ai_analyses", sa.Column("generation_job_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_aggregate_ai_generation_job", "aggregate_ai_analyses", "ai_analysis_generation_jobs",
                          ["generation_job_id"], ["id"])
    op.create_unique_constraint("uq_aggregate_ai_generation_job", "aggregate_ai_analyses", ["generation_job_id"])


def downgrade():
    raise RuntimeError("Downgrading would remove AI generation history; restore a verified backup instead")

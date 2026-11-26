"""AI generation jobs run in one worker thread: drop the multi-worker lease columns.

Revision ID: d7b2e4f1a903
Revises: c5a1d8e3f702
"""
from alembic import op
import sqlalchemy as sa

revision = "d7b2e4f1a903"
down_revision = "c5a1d8e3f702"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("ai_analysis_generation_jobs", "lease_expires_at")
    op.drop_column("ai_analysis_generation_jobs", "worker_token")


def downgrade():
    op.add_column("ai_analysis_generation_jobs", sa.Column("worker_token", sa.String(length=36), nullable=True))
    op.add_column("ai_analysis_generation_jobs", sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True))

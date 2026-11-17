"""Prompt versions, generation parameters and token usage for AI analyses.

Revision ID: f1d6a3c8b250
Revises: e8c1b4a7d063
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "f1d6a3c8b250"
down_revision = "e8c1b4a7d063"
branch_labels = None
depends_on = None

TABLES = ("employee_ai_analyses", "aggregate_ai_analyses")


def upgrade():
    op.create_table(
        "ai_prompt_versions",
        sa.Column("version", sa.String(120), primary_key=True),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    for table in TABLES:
        op.add_column(table, sa.Column("prompt_version", sa.String(120), nullable=True))
        op.add_column(table, sa.Column("generation_parameters", postgresql.JSONB(), nullable=True))
        op.add_column(table, sa.Column("token_usage", postgresql.JSONB(), nullable=True))


def downgrade():
    for table in TABLES:
        op.drop_column(table, "token_usage")
        op.drop_column(table, "generation_parameters")
        op.drop_column(table, "prompt_version")
    op.drop_table("ai_prompt_versions")

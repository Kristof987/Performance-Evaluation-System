"""Add performance dimensions and filled form snapshots.

Revision ID: c3f1a8d9e2b4
Revises: b6f3e9c7d210
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "c3f1a8d9e2b4"
down_revision = "b6f3e9c7d210"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "performance_dimensions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("scope_key", sa.String(), nullable=False, server_default="default"),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("normalized_name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scope_key", "normalized_name", name="uq_performance_dimension_scope_name"),
    )
    op.create_index(op.f("ix_performance_dimensions_id"), "performance_dimensions", ["id"], unique=False)
    op.add_column("filled_forms", sa.Column("form_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("filled_forms", sa.Column("snapshot_status", sa.String(), nullable=True))
    op.execute("UPDATE filled_forms SET snapshot_status = 'legacy_unsnapshotted' WHERE snapshot_status IS NULL")


def downgrade():
    op.drop_column("filled_forms", "snapshot_status")
    op.drop_column("filled_forms", "form_snapshot")
    op.drop_index(op.f("ix_performance_dimensions_id"), table_name="performance_dimensions")
    op.drop_table("performance_dimensions")

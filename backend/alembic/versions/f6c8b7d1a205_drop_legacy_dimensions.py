"""Retire the unused Performance Dimensions catalog.

Revision ID: f6c8b7d1a205
Revises: e5b7a9d2c104

Only an empty catalog may be dropped. Existing catalog rows must be independently
inventoried and preserved before revising this migration; this revision never
deletes unknown data. Historical Forms, Templates, answers and issued snapshots
are not altered. Dropping the table is irreversible without an external backup.
"""

from alembic import context, op
import sqlalchemy as sa


revision = "f6c8b7d1a205"
down_revision = "e5b7a9d2c104"
branch_labels = None
depends_on = None


def upgrade():
    if context.is_offline_mode():
        raise RuntimeError("An online database connection is required to check Performance Dimensions before dropping the table")
    has_rows = op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM performance_dimensions)")).scalar()
    if has_rows:
        raise RuntimeError(
            "performance_dimensions contains records. Preserve and review the catalog data before applying a table-drop migration."
        )
    # No CASCADE: unexpected relational dependencies must stop the migration.
    op.drop_index("ix_performance_dimensions_id", table_name="performance_dimensions")
    op.drop_table("performance_dimensions")


def downgrade():
    raise RuntimeError("Performance Dimensions catalog data cannot be reconstructed; restore it from a verified backup")

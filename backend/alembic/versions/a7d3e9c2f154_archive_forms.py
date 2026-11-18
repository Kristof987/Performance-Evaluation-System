"""Forms used by past campaigns are archived instead of deleted.

Revision ID: a7d3e9c2f154
Revises: f1d6a3c8b250
"""

from alembic import op
import sqlalchemy as sa


revision = "a7d3e9c2f154"
down_revision = "f1d6a3c8b250"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("forms", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("forms", "archived_at")

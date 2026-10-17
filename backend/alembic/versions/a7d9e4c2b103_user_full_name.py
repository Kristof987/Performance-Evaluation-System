"""Keep employee display names independently from unique usernames.

Revision ID: a7d9e4c2b103
Revises: f6c8b7d1a205
"""

from alembic import op
import sqlalchemy as sa


revision = "a7d9e4c2b103"
down_revision = "f6c8b7d1a205"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("full_name", sa.String(), nullable=True))


def downgrade():
    # Display names stored only in this column cannot be recovered after downgrade.
    op.drop_column("users", "full_name")

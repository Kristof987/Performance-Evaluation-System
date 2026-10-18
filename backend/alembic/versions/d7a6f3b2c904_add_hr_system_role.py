"""Add the HR system role without changing existing account assignments.

Revision ID: d7a6f3b2c904
Revises: c9e1f4a2b730
"""

from alembic import op
import sqlalchemy as sa


revision = "d7a6f3b2c904"
down_revision = "c9e1f4a2b730"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("INSERT INTO system_roles (name) VALUES ('HR') ON CONFLICT (name) DO NOTHING"))


def downgrade():
    # A preexisting HR role cannot be distinguished from one inserted here, and
    # later accounts may depend on it. Keep the role rather than delete data.
    pass

"""Add an optional Auth0 identity to existing user accounts.

Revision ID: c9e1f4a2b730
Revises: b8e0c6a4d215
"""

from alembic import op
import sqlalchemy as sa


revision = "c9e1f4a2b730"
down_revision = "b8e0c6a4d215"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("auth0_user_id", sa.String(length=255), nullable=True))
    op.create_unique_constraint("uq_users_auth0_user_id", "users", ["auth0_user_id"])


def downgrade():
    op.drop_constraint("uq_users_auth0_user_id", "users", type_="unique")
    op.drop_column("users", "auth0_user_id")

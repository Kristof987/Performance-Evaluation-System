"""Remove unused personal notification preferences."""

from alembic import op
import sqlalchemy as sa


revision = "d0fc681b2439"
down_revision = "e3c9a6d2b815"
branch_labels = None
depends_on = None

COLUMNS = ("notify_new_assignment", "notify_results_available", "notify_campaign_status")


def upgrade():
    for column in COLUMNS:
        op.drop_column("user_preferences", column)


def downgrade():
    for column in COLUMNS:
        op.add_column("user_preferences", sa.Column(column, sa.Boolean(), nullable=False, server_default=sa.true()))

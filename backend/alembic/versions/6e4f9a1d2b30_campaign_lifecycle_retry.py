"""Persist automatic campaign lifecycle failures and retry scheduling.

Revision ID: 6e4f9a1d2b30
Revises: a4d3c7e9b120
"""

from alembic import op
import sqlalchemy as sa


revision = "6e4f9a1d2b30"
down_revision = "a4d3c7e9b120"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("campaigns", sa.Column("lifecycle_error", sa.String(), nullable=True))
    op.add_column("campaigns", sa.Column("lifecycle_retry_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("campaigns", sa.Column("lifecycle_attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("campaigns", sa.Column("last_transition_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(sa.text("""
        UPDATE campaigns AS c SET last_transition_at = (
            SELECT max(h.transitioned_at) FROM campaign_lifecycle_history AS h WHERE h.campaign_id = c.id
        )
    """))
    op.create_index("ix_campaigns_lifecycle_retry_at", "campaigns", ["lifecycle_retry_at"])


def downgrade():
    op.drop_index("ix_campaigns_lifecycle_retry_at", table_name="campaigns")
    op.drop_column("campaigns", "last_transition_at")
    op.drop_column("campaigns", "lifecycle_attempts")
    op.drop_column("campaigns", "lifecycle_retry_at")
    op.drop_column("campaigns", "lifecycle_error")

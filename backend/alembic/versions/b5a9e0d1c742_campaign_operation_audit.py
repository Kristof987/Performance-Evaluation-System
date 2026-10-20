"""Keep non-sensitive issuance and deletion audit records.

Revision ID: b5a9e0d1c742
Revises: 8c5f1e3d7a20
"""

from alembic import op
import sqlalchemy as sa


revision = "b5a9e0d1c742"
down_revision = "8c5f1e3d7a20"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "campaign_operation_audit",
        sa.Column("id", sa.Integer(), primary_key=True),
        # No campaign FK: a deletion tombstone must survive campaign deletion.
        sa.Column("campaign_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(24), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_automatic", sa.Boolean(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("previous_status", sa.String(16), nullable=False),
        sa.Column("resulting_status", sa.String(16), nullable=True),
        sa.Column("issued_count", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("category IN ('snapshot_issuance', 'transition_failure', 'delete')", name="ck_campaign_operation_category"),
        sa.CheckConstraint("issued_count >= 0", name="ck_campaign_operation_issued_count"),
    )
    op.create_index("ix_campaign_operation_audit_campaign_id", "campaign_operation_audit", ["campaign_id"])


def downgrade():
    raise RuntimeError("Downgrading would discard permanent deletion audit records")

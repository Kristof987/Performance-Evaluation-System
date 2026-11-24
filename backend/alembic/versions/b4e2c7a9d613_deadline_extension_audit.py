"""Record deadline extensions of active campaigns in the operation audit.

Revision ID: b4e2c7a9d613
Revises: a7d3e9c2f154
"""
from alembic import op

revision = "b4e2c7a9d613"
down_revision = "a7d3e9c2f154"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("ck_campaign_operation_category", "campaign_operation_audit", type_="check")
    op.create_check_constraint(
        "ck_campaign_operation_category", "campaign_operation_audit",
        "category IN ('snapshot_issuance', 'transition_failure', 'delete', 'deadline_extension')",
    )


def downgrade():
    op.execute("DELETE FROM campaign_operation_audit WHERE category = 'deadline_extension'")
    op.drop_constraint("ck_campaign_operation_category", "campaign_operation_audit", type_="check")
    op.create_check_constraint(
        "ck_campaign_operation_category", "campaign_operation_audit",
        "category IN ('snapshot_issuance', 'transition_failure', 'delete')",
    )

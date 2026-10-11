"""Add canonical campaign and employee self-evaluation forms.

Revision ID: b6f3e9c7d210
Revises: 7d2e8f1a4b6c
"""

from alembic import op
import sqlalchemy as sa


revision = "b6f3e9c7d210"
down_revision = "7d2e8f1a4b6c"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "campaign_employee_self_evaluations",
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=False),
    )


def downgrade():
    op.drop_table("campaign_employee_self_evaluations")

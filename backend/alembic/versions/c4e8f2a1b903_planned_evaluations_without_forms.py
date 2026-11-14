"""Allow untouched planned evaluation pairs before form selection.

Revision ID: c4e8f2a1b903
Revises: ab83f172d640
"""

from alembic import op
import sqlalchemy as sa


revision = "c4e8f2a1b903"
down_revision = "ab83f172d640"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("filled_forms", "form_id", existing_type=sa.Integer(), nullable=True)
    op.create_check_constraint(
        "ck_filled_forms_null_form_only_planned", "filled_forms",
        "form_id IS NOT NULL OR (finish_date IS NULL AND snapshot_status IS NULL "
        "AND (form_snapshot IS NULL OR form_snapshot = 'null'::jsonb) AND answers = '[]'::jsonb)",
    )


def downgrade():
    op.drop_constraint("ck_filled_forms_null_form_only_planned", "filled_forms", type_="check")
    op.alter_column("filled_forms", "form_id", existing_type=sa.Integer(), nullable=False)

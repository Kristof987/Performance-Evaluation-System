"""Snapshot company roles on issued assignments; archivable company roles.

Revision ID: c7e4a1b9d352
Revises: b9d3e6f1a742
"""

from alembic import op
import sqlalchemy as sa


revision = "c7e4a1b9d352"
down_revision = "b9d3e6f1a742"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("filled_forms", sa.Column("evaluator_company_role_id", sa.Integer(),
                                            sa.ForeignKey("company_roles.id"), nullable=True))
    op.add_column("filled_forms", sa.Column("evaluatee_company_role_id", sa.Integer(),
                                            sa.ForeignKey("company_roles.id"), nullable=True))
    op.add_column("company_roles", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    # Role changes were blocked after issuance until now, so current roles are the roles at issuance.
    op.execute("""
        UPDATE filled_forms AS ff
        SET evaluator_company_role_id = evaluator.company_role_id,
            evaluatee_company_role_id = evaluatee.company_role_id
        FROM employees AS evaluator, employees AS evaluatee
        WHERE evaluator.id = ff.evaluator_id AND evaluatee.id = ff.evaluatee_id
          AND (ff.form_snapshot IS NOT NULL OR ff.finish_date IS NOT NULL
               OR ff.answers NOT IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb))
    """)


def downgrade():
    op.drop_column("company_roles", "archived_at")
    op.drop_column("filled_forms", "evaluatee_company_role_id")
    op.drop_column("filled_forms", "evaluator_company_role_id")

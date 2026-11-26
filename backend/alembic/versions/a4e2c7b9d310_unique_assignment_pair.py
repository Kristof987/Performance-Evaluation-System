"""One assignment per evaluator/evaluatee pair in a campaign.

Revision ID: a4e2c7b9d310
Revises: d0fc681b2439
"""
import sqlalchemy as sa

from alembic import op

revision = "a4e2c7b9d310"
down_revision = "d0fc681b2439"
branch_labels = None
depends_on = None


def upgrade() -> None:
    duplicates = op.get_bind().execute(sa.text(
        "SELECT campaign_id, evaluator_id, evaluatee_id, count(*) FROM filled_forms "
        "GROUP BY campaign_id, evaluator_id, evaluatee_id HAVING count(*) > 1")).fetchall()
    if duplicates:
        listed = ", ".join(f"campaign {row[0]}: {row[1]} → {row[2]} ({row[3]}×)" for row in duplicates[:10])
        raise RuntimeError(f"Resolve duplicate evaluation pairs before upgrading: {listed}")
    op.create_unique_constraint("uq_filled_forms_campaign_pair", "filled_forms",
                                ["campaign_id", "evaluator_id", "evaluatee_id"])


def downgrade() -> None:
    op.drop_constraint("uq_filled_forms_campaign_pair", "filled_forms", type_="unique")

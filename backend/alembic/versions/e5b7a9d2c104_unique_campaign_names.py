"""Require unique campaign names after whitespace and case normalization.

Revision ID: e5b7a9d2c104
Revises: d4a8c1f2e6b9
"""

from alembic import op
import sqlalchemy as sa


revision = "e5b7a9d2c104"
down_revision = "d4a8c1f2e6b9"
branch_labels = None
depends_on = None


def upgrade():
    duplicates = op.get_bind().execute(sa.text("""
        SELECT normalized_name, array_agg(id ORDER BY id) AS campaign_ids
        FROM (
            SELECT id, lower(regexp_replace(name, '^[[:space:]]+|[[:space:]]+$', '', 'g')) AS normalized_name
            FROM campaigns
        ) AS normalized_campaigns
        GROUP BY normalized_name
        HAVING count(*) > 1
        ORDER BY normalized_name
    """)).all()
    if duplicates:
        details = "; ".join(f"{name!r}: campaign IDs {ids}" for name, ids in duplicates)
        raise RuntimeError(f"Resolve duplicate campaign names before applying this migration: {details}")

    op.create_index(
        "uq_campaigns_normalized_name",
        "campaigns",
        [sa.text("lower(regexp_replace(name, '^[[:space:]]+|[[:space:]]+$', '', 'g'))")],
        unique=True,
    )


def downgrade():
    op.drop_index("uq_campaigns_normalized_name", table_name="campaigns")

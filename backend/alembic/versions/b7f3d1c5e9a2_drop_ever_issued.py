"""Drop campaigns.ever_issued: only a never-started (Draft or Scheduled) campaign is deletable.

Revision ID: b7f3d1c5e9a2
Revises: a4e2c7b9d310
"""
import sqlalchemy as sa

from alembic import op

revision = "b7f3d1c5e9a2"
down_revision = "a4e2c7b9d310"
branch_labels = None
depends_on = None


def upgrade() -> None:
    started = op.get_bind().execute(sa.text(
        "SELECT id, name FROM campaigns WHERE ever_issued AND status IN ('draft', 'scheduled')")).fetchall()
    if started:
        listed = ", ".join(f"{row[0]} ({row[1]})" for row in started[:10])
        raise RuntimeError(f"These draft or scheduled campaigns already issued questionnaires; resolve them first: {listed}")
    op.execute("DROP TRIGGER IF EXISTS trg_mark_campaign_issued ON filled_forms")
    op.execute("DROP TRIGGER IF EXISTS trg_guard_campaign_ever_issued ON campaigns")
    op.execute("DROP FUNCTION IF EXISTS mark_campaign_issued()")
    op.execute("DROP FUNCTION IF EXISTS guard_campaign_ever_issued()")
    op.drop_column("campaigns", "ever_issued")


def downgrade() -> None:
    op.add_column("campaigns", sa.Column("ever_issued", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE campaigns SET ever_issued = true WHERE status IN ('active', 'paused', 'review', 'closed')")

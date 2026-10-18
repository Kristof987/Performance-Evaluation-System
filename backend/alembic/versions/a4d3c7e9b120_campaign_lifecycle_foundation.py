"""Add campaign lifecycle foundation and normalize historical calendar dates.

Revision ID: a4d3c7e9b120
Revises: f2c9a7d4e681
"""

from alembic import op
import sqlalchemy as sa


revision = "a4d3c7e9b120"
down_revision = "f2c9a7d4e681"
branch_labels = None
depends_on = None


def upgrade():
    # DATE is the recorded predecessor schema. Inspect the actual columns as a
    # precaution against deployments that already hold timestamp values. For
    # timestamptz, take the Hungarian calendar date before dropping the time.
    columns = {column["name"]: column["type"] for column in sa.inspect(op.get_bind()).get_columns("campaigns")}
    op.execute("SET LOCAL TIME ZONE 'UTC'")
    for name in ("start_date", "end_date"):
        column_type = columns[name]
        if isinstance(column_type, sa.DateTime) and column_type.timezone:
            calendar_date = f"({name} AT TIME ZONE 'Europe/Budapest')::date"
        elif isinstance(column_type, (sa.Date, sa.DateTime)):
            # Naive timestamp columns are interpreted as Hungarian wall time.
            calendar_date = f"{name}::date"
        else:
            raise RuntimeError(f"Unsupported campaigns.{name} column type: {column_type}")
        op.alter_column(
            "campaigns", name, existing_type=column_type,
            type_=sa.DateTime(timezone=True),
            postgresql_using=f"{calendar_date}::timestamp AT TIME ZONE 'Europe/Budapest'",
        )
    op.add_column("campaigns", sa.Column("status", sa.String(16), nullable=True))
    op.add_column("campaigns", sa.Column("paused_from_status", sa.String(16), nullable=True))
    op.add_column("campaigns", sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("campaigns", sa.Column("legacy_issuance_blocked", sa.Boolean(), nullable=False, server_default=sa.false()))

    # A snapshot, submitted date, or answers proves issuance/history even if the
    # snapshot itself predates snapshot support. Never classify these as draft or
    # scheduled. Expiry is review, never implicit explicit closure. Inactive
    # historical campaigns with evidence are review to avoid implying access.
    op.execute(sa.text("""
        UPDATE campaigns AS c SET
            legacy_issuance_blocked = true,
            status = CASE
                WHEN EXISTS (
                    SELECT 1 FROM filled_forms AS f WHERE f.campaign_id = c.id
                    AND (f.form_snapshot IS NOT NULL AND f.form_snapshot <> 'null'::jsonb
                         OR f.finish_date IS NOT NULL OR f.answers <> '[]'::jsonb)
                ) THEN CASE
                    WHEN NOT c.is_active OR (c.end_date IS NOT NULL AND c.end_date <= now())
                        THEN 'review'
                    ELSE 'active'
                END
                WHEN NOT c.is_active THEN 'draft'
                WHEN c.end_date IS NOT NULL AND c.end_date <= now() THEN 'review'
                WHEN c.start_date > now() THEN 'scheduled'
                ELSE 'active'
            END
    """))
    op.alter_column("campaigns", "status", existing_type=sa.String(16), nullable=False, server_default="draft")
    op.create_check_constraint("ck_campaign_status", "campaigns", "status IN ('draft', 'scheduled', 'active', 'paused', 'review', 'closed')")
    op.create_check_constraint("ck_campaign_paused_from_status", "campaigns", "(status = 'paused' AND paused_from_status IN ('active', 'review')) OR (status <> 'paused' AND paused_from_status IS NULL)")

    op.create_table(
        "campaign_lifecycle_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("previous_status", sa.String(16), nullable=False),
        sa.Column("new_status", sa.String(16), nullable=False),
        sa.Column("transitioned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_automatic", sa.Boolean(), nullable=False),
        sa.CheckConstraint("previous_status IN ('draft', 'scheduled', 'active', 'paused', 'review', 'closed')", name="ck_campaign_history_previous_status"),
        sa.CheckConstraint("new_status IN ('draft', 'scheduled', 'active', 'paused', 'review', 'closed')", name="ck_campaign_history_new_status"),
        sa.CheckConstraint("is_automatic OR actor_user_id IS NOT NULL", name="ck_campaign_history_manual_actor"),
    )
    op.create_index("ix_campaign_lifecycle_history_campaign_id", "campaign_lifecycle_history", ["campaign_id"])


def downgrade():
    raise RuntimeError("Downgrading would discard campaign times and lifecycle history; restore a verified backup instead")

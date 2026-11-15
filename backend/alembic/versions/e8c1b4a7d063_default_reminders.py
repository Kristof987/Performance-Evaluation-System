"""Workspace default reminders and per-campaign overrides.

Revision ID: e8c1b4a7d063
Revises: d2a8f5c3e917
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "e8c1b4a7d063"
down_revision = "d2a8f5c3e917"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("workspace_settings", sa.Column("default_reminder_days", postgresql.JSONB(), nullable=False,
                                                  server_default=sa.text("'[]'::jsonb")))
    op.add_column("workspace_settings", sa.Column("default_launch_email", sa.Boolean(), nullable=False,
                                                  server_default=sa.text("true")))
    op.add_column("campaigns", sa.Column("custom_reminders", sa.Boolean(), nullable=False, server_default="false"))
    # Campaigns that already have their own reminders keep them.
    op.execute("UPDATE campaigns SET custom_reminders = true WHERE id IN (SELECT campaign_id FROM campaign_reminders)")
    op.add_column("email_deliveries", sa.Column("reminder_days", sa.Integer(), nullable=True))
    # Reminders are now deduplicated per campaign and day, whether they come from a default or the campaign.
    op.execute("""
        UPDATE email_deliveries AS delivery
        SET reminder_days = reminder.days_before_end,
            dedupe_key = 'reminder:' || delivery.campaign_id || ':' || reminder.days_before_end || ':' || delivery.employee_id
        FROM campaign_reminders AS reminder
        WHERE delivery.reminder_id = reminder.id AND delivery.kind = 'reminder'
    """)


def downgrade():
    op.drop_column("email_deliveries", "reminder_days")
    op.drop_column("campaigns", "custom_reminders")
    op.drop_column("workspace_settings", "default_launch_email")
    op.drop_column("workspace_settings", "default_reminder_days")

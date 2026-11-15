"""Campaign launch and reminder emails.

Revision ID: d2a8f5c3e917
Revises: c7e4a1b9d352
"""

from alembic import op
import sqlalchemy as sa


revision = "d2a8f5c3e917"
down_revision = "c7e4a1b9d352"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("campaigns", sa.Column("launch_email_enabled", sa.Boolean(), nullable=False, server_default="true"))
    # Campaigns that are already running must not suddenly email everyone a launch notice.
    op.execute("UPDATE campaigns SET launch_email_enabled = false WHERE status NOT IN ('draft', 'scheduled')")

    op.create_table(
        "campaign_reminders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("days_before_end", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("campaign_id", "days_before_end", name="uq_campaign_reminder_days"),
        sa.CheckConstraint("days_before_end BETWEEN 0 AND 90", name="ck_campaign_reminder_days"),
    )
    op.create_index("ix_campaign_reminders_campaign_id", "campaign_reminders", ["campaign_id"])

    op.create_table(
        "email_deliveries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("reminder_id", sa.Integer(), sa.ForeignKey("campaign_reminders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("dedupe_key", sa.String(120), nullable=False, unique=True),
        sa.Column("recipient", sa.String(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("error", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("kind IN ('launch', 'reminder', 'manual')", name="ck_email_delivery_kind"),
        sa.CheckConstraint("status IN ('pending', 'sent', 'failed')", name="ck_email_delivery_status"),
    )
    op.create_index("ix_email_deliveries_campaign_id", "email_deliveries", ["campaign_id"])

    op.drop_constraint("ck_settings_audit_category", "settings_audit_events", type_="check")
    op.create_check_constraint("ck_settings_audit_category", "settings_audit_events",
                               "category IN ('privacy', 'ai', 'permissions', 'accounts', 'notifications')")

    # Reminder timing is now set per campaign by HR, not by each person.
    op.drop_constraint("ck_user_preferences_reminder", "user_preferences", type_="check")
    op.drop_column("user_preferences", "reminder_days_before_deadline")
    op.drop_column("user_preferences", "notify_deadline_reminder")


def downgrade():
    op.add_column("user_preferences", sa.Column("notify_deadline_reminder", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("user_preferences", sa.Column("reminder_days_before_deadline", sa.Integer(), nullable=False, server_default="3"))
    op.create_check_constraint("ck_user_preferences_reminder", "user_preferences", "reminder_days_before_deadline BETWEEN 1 AND 14")
    op.execute("DELETE FROM settings_audit_events WHERE category = 'notifications'")
    op.drop_constraint("ck_settings_audit_category", "settings_audit_events", type_="check")
    op.create_check_constraint("ck_settings_audit_category", "settings_audit_events",
                               "category IN ('privacy', 'ai', 'permissions', 'accounts')")
    op.drop_index("ix_email_deliveries_campaign_id", table_name="email_deliveries")
    op.drop_table("email_deliveries")
    op.drop_index("ix_campaign_reminders_campaign_id", table_name="campaign_reminders")
    op.drop_table("campaign_reminders")
    op.drop_column("campaigns", "launch_email_enabled")

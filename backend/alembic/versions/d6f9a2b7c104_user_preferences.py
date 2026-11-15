"""Store self-service user display and notification preferences.

Revision ID: d6f9a2b7c104
Revises: c4e8f2a1b903
"""

from alembic import op
import sqlalchemy as sa


revision = "d6f9a2b7c104"
down_revision = "c4e8f2a1b903"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "password_reset_requests",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "user_preferences",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("theme", sa.String(8), nullable=False, server_default="system"),
        sa.Column("language", sa.String(2), nullable=False, server_default="en"),
        sa.Column("date_format", sa.String(8), nullable=False, server_default="locale"),
        sa.Column("notify_new_assignment", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notify_deadline_reminder", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notify_results_available", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notify_campaign_status", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("reminder_days_before_deadline", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("theme IN ('system', 'light', 'dark')", name="ck_user_preferences_theme"),
        sa.CheckConstraint("language IN ('en', 'hu')", name="ck_user_preferences_language"),
        sa.CheckConstraint("date_format IN ('locale', 'iso')", name="ck_user_preferences_date_format"),
        sa.CheckConstraint("reminder_days_before_deadline BETWEEN 1 AND 14", name="ck_user_preferences_reminder"),
    )


def downgrade():
    op.drop_table("user_preferences")
    op.drop_table("password_reset_requests")

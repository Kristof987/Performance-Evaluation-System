"""Track Auth0 sign-in invitations and allow account events in the settings audit.

Revision ID: f3b8d1e4a926
Revises: e1a7c3d9f205
"""

from alembic import op
import sqlalchemy as sa


revision = "f3b8d1e4a926"
down_revision = "e1a7c3d9f205"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("invitation_status", sa.String(16), nullable=False, server_default="not_sent"))
    op.add_column("users", sa.Column("invitation_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("invitation_error", sa.String(64), nullable=True))
    op.create_check_constraint("ck_users_invitation_status", "users",
                               "invitation_status IN ('not_sent', 'sent', 'failed')")
    op.drop_constraint("ck_settings_audit_category", "settings_audit_events", type_="check")
    op.create_check_constraint("ck_settings_audit_category", "settings_audit_events",
                               "category IN ('privacy', 'ai', 'permissions', 'accounts')")


def downgrade():
    op.execute("DELETE FROM settings_audit_events WHERE category = 'accounts'")
    op.drop_constraint("ck_settings_audit_category", "settings_audit_events", type_="check")
    op.create_check_constraint("ck_settings_audit_category", "settings_audit_events",
                               "category IN ('privacy', 'ai', 'permissions')")
    op.drop_constraint("ck_users_invitation_status", "users", type_="check")
    op.drop_column("users", "invitation_error")
    op.drop_column("users", "invitation_sent_at")
    op.drop_column("users", "invitation_status")

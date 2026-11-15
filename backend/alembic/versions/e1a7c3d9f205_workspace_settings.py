"""Workspace privacy and AI settings, settings audit trail and new permissions.

Revision ID: e1a7c3d9f205
Revises: d6f9a2b7c104
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "e1a7c3d9f205"
down_revision = "d6f9a2b7c104"
branch_labels = None
depends_on = None


NEW_PERMISSIONS = ("workspace.manage", "permissions.manage", "audit.read", "ai_analysis.generate", "ai_analysis.approve")


def _grant(db, permission: str, role_condition: str) -> None:
    db.execute(sa.text(f"""
        INSERT INTO system_role_permissions (system_role_id, permission_id)
        SELECT r.id, p.id FROM system_roles AS r CROSS JOIN system_permissions AS p
        WHERE p.name = :permission AND ({role_condition})
        ON CONFLICT (system_role_id, permission_id) DO NOTHING
    """), {"permission": permission})


def upgrade():
    op.create_table(
        "workspace_settings",
        sa.Column("scope_key", sa.String(32), primary_key=True),
        sa.Column("min_individual_peer_reviewers", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("min_aggregate_evaluatees", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("ai_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("ai_model", sa.String(100), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("min_individual_peer_reviewers BETWEEN 2 AND 20", name="ck_workspace_min_peer_reviewers"),
        sa.CheckConstraint("min_aggregate_evaluatees BETWEEN 2 AND 20", name="ck_workspace_min_aggregate_evaluatees"),
    )
    op.create_table(
        "settings_audit_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("summary", sa.String(500), nullable=False),
        sa.Column("details", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.CheckConstraint("category IN ('privacy', 'ai', 'permissions')", name="ck_settings_audit_category"),
    )
    op.create_index("ix_settings_audit_events_occurred_at", "settings_audit_events", ["occurred_at"])

    db = op.get_bind()
    db.execute(sa.text("INSERT INTO system_permissions (name) VALUES (:name) ON CONFLICT (name) DO NOTHING"),
               [{"name": name} for name in NEW_PERMISSIONS])
    # Keep today's behaviour: whoever could manage campaigns could generate and approve analyses.
    managers = """r.id IN (SELECT rp.system_role_id FROM system_role_permissions AS rp
                  JOIN system_permissions AS mp ON mp.id = rp.permission_id WHERE mp.name = 'campaigns.manage')"""
    _grant(db, "ai_analysis.generate", managers)
    _grant(db, "ai_analysis.approve", managers)
    _grant(db, "workspace.manage", "r.name IN ('Admin', 'HR')")
    _grant(db, "audit.read", "r.name IN ('Admin', 'HR')")
    _grant(db, "permissions.manage", "r.name = 'Admin'")


def downgrade():
    op.drop_index("ix_settings_audit_events_occurred_at", table_name="settings_audit_events")
    op.drop_table("settings_audit_events")
    op.drop_table("workspace_settings")
    # Permission definitions and grants may have been edited since; they are left in place.

"""Group leaders, team-scoped reports and narrower default role grants.

Revision ID: b9d3e6f1a742
Revises: a4c7e2f9b318
"""

from alembic import op
import sqlalchemy as sa


revision = "b9d3e6f1a742"
down_revision = "a4c7e2f9b318"
branch_labels = None
depends_on = None


# Managers become team leads: they keep their own evaluations and see reports of the groups they lead.
MANAGER_KEEPS = ("evaluations.read_assigned", "evaluations.submit", "settings.read", "settings.manage_self", "reports.read_team")
MANAGER_PREVIOUS = (
    "employees.read", "employees.manage", "groups.read", "groups.manage", "roles.assign",
    "campaigns.read", "campaigns.manage", "forms.read", "forms.manage", "sections.read", "sections.manage",
    "reports.read", "ai_analysis.generate", "ai_analysis.approve",
)


def _revoke(db, role: str, permissions: tuple[str, ...]) -> None:
    db.execute(sa.text("""
        DELETE FROM system_role_permissions AS rp
        USING system_roles AS r, system_permissions AS p
        WHERE rp.system_role_id = r.id AND rp.permission_id = p.id
          AND r.name = :role AND p.name = ANY(:permissions)
    """), {"role": role, "permissions": list(permissions)})


def _grant(db, role: str, permissions: tuple[str, ...]) -> None:
    db.execute(sa.text("""
        INSERT INTO system_role_permissions (system_role_id, permission_id)
        SELECT r.id, p.id FROM system_roles AS r CROSS JOIN system_permissions AS p
        WHERE r.name = :role AND p.name = ANY(:permissions)
        ON CONFLICT (system_role_id, permission_id) DO NOTHING
    """), {"role": role, "permissions": list(permissions)})


def upgrade():
    op.create_table(
        "company_group_leaders",
        sa.Column("company_group_id", sa.Integer(), sa.ForeignKey("company_groups.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_index("ix_company_group_leaders_employee_id", "company_group_leaders", ["employee_id"])

    db = op.get_bind()
    db.execute(sa.text("INSERT INTO system_permissions (name) VALUES ('reports.read_team') ON CONFLICT (name) DO NOTHING"))
    # Only administrators may hand out system roles by default.
    db.execute(sa.text("""
        DELETE FROM system_role_permissions AS rp
        USING system_roles AS r, system_permissions AS p
        WHERE rp.system_role_id = r.id AND rp.permission_id = p.id
          AND p.name = 'roles.assign' AND r.name <> 'Admin'
    """))
    _revoke(db, "Manager", MANAGER_PREVIOUS)
    _grant(db, "Manager", MANAGER_KEEPS)


def downgrade():
    db = op.get_bind()
    _grant(db, "Manager", MANAGER_PREVIOUS)
    _grant(db, "HR", ("roles.assign",))
    db.execute(sa.text("""
        DELETE FROM system_role_permissions AS rp USING system_permissions AS p
        WHERE rp.permission_id = p.id AND p.name = 'reports.read_team'
    """))
    db.execute(sa.text("DELETE FROM system_permissions WHERE name = 'reports.read_team'"))
    op.drop_index("ix_company_group_leaders_employee_id", table_name="company_group_leaders")
    op.drop_table("company_group_leaders")

"""Initialize application permissions and explicit system-role grants.

Revision ID: e8b4c2d6190a
Revises: d7a6f3b2c904
"""

from alembic import op
import sqlalchemy as sa


revision = "e8b4c2d6190a"
down_revision = "d7a6f3b2c904"
branch_labels = None
depends_on = None


PERMISSIONS = (
    "employees.read",
    "employees.manage",
    "groups.read",
    "groups.manage",
    "campaigns.read",
    "campaigns.manage",
    "forms.read",
    "forms.manage",
    "sections.read",
    "sections.manage",
    "evaluations.read_assigned",
    "evaluations.submit",
    "reports.read",
    "settings.read",
    "settings.manage_self",
)

EMPLOYEE_PERMISSIONS = (
    "evaluations.read_assigned",
    "evaluations.submit",
    "settings.read",
    "settings.manage_self",
)


def upgrade():
    db = op.get_bind()
    role_ids = dict(db.execute(sa.text("SELECT name, id FROM system_roles")).all())
    missing = {"Admin", "HR", "Manager", "Employee"} - role_ids.keys()
    if missing:
        raise RuntimeError(f"Required system roles are missing: {', '.join(sorted(missing))}")

    db.execute(
        sa.text("INSERT INTO system_permissions (name) VALUES (:name) ON CONFLICT (name) DO NOTHING"),
        [{"name": name} for name in PERMISSIONS],
    )
    permission_ids = dict(db.execute(sa.text("SELECT name, id FROM system_permissions")).all())
    grants = [
        {"role_id": role_ids[role], "permission_id": permission_ids[name]}
        for role in ("Admin", "HR", "Manager")
        for name in PERMISSIONS
    ] + [
        {"role_id": role_ids["Employee"], "permission_id": permission_ids[name]}
        for name in EMPLOYEE_PERMISSIONS
    ]
    db.execute(sa.text("""
        INSERT INTO system_role_permissions (system_role_id, permission_id)
        VALUES (:role_id, :permission_id)
        ON CONFLICT (system_role_id, permission_id) DO NOTHING
    """), grants)


def downgrade():
    # Grants and definitions may have been edited or reused after this seed ran.
    # Without provenance, removing them would risk deleting administrator changes.
    pass

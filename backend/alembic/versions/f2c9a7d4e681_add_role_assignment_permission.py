"""Grant explicit system-role assignment permission to management roles.

Revision ID: f2c9a7d4e681
Revises: e8b4c2d6190a
"""

from alembic import op
import sqlalchemy as sa


revision = "f2c9a7d4e681"
down_revision = "e8b4c2d6190a"
branch_labels = None
depends_on = None


def upgrade():
    db = op.get_bind()
    role_names = {name for (name,) in db.execute(sa.text(
        "SELECT name FROM system_roles WHERE name IN ('Admin', 'HR', 'Manager')"
    ))}
    if role_names != {"Admin", "HR", "Manager"}:
        raise RuntimeError("Admin, HR and Manager system roles are required for role assignment")

    db.execute(sa.text("""
        INSERT INTO system_permissions (name) VALUES ('roles.assign')
        ON CONFLICT (name) DO NOTHING
    """))
    db.execute(sa.text("""
        INSERT INTO system_role_permissions (system_role_id, permission_id)
        SELECT r.id, p.id FROM system_roles AS r
        CROSS JOIN system_permissions AS p
        WHERE r.name IN ('Admin', 'HR', 'Manager') AND p.name = 'roles.assign'
        ON CONFLICT (system_role_id, permission_id) DO NOTHING
    """))


def downgrade():
    # Later role-grant edits cannot be distinguished from these seed records.
    pass

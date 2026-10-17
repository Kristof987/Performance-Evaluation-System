"""Separate employee-domain identity from application accounts.

Revision ID: b8e0c6a4d215
Revises: a7d9e4c2b103

The one-time mapping is employees.user_id -> users.id. New employee primary keys
are allocated independently; legacy participant IDs are translated by joining
that mapping, never by relying on coincidentally equal numbers. Issued snapshots
and submitted answers are left unchanged.
"""

from alembic import op
import sqlalchemy as sa


revision = "b8e0c6a4d215"
down_revision = "a7d9e4c2b103"
branch_labels = None
depends_on = None


def upgrade():
    db = op.get_bind()
    op.create_table(
        "employees",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("full_name", sa.String(), nullable=False),
        sa.Column("company_role_id", sa.Integer(), sa.ForeignKey("company_roles.id"), nullable=False),
        sa.Column("profile_image_url", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("user_id", name="uq_employees_user_id"),
    )
    op.create_index("ix_employees_id", "employees", ["id"])
    db.execute(sa.text("""
        INSERT INTO employees (user_id, full_name, company_role_id, profile_image_url, is_active, created_at, updated_at)
        SELECT id, COALESCE(NULLIF(BTRIM(full_name), ''), username), company_role_id,
               profile_image_url, is_active, created_at, updated_at FROM users
    """))
    if db.execute(sa.text("SELECT count(*) FROM employees")).scalar() != db.execute(sa.text("SELECT count(*) FROM users")).scalar():
        raise RuntimeError("Not every existing account received a mapped employee profile")
    for table, column in (
        ("user_company_groups", "user_id"),
        ("filled_forms", "evaluator_id"),
        ("filled_forms", "evaluatee_id"),
        ("campaign_employee_self_evaluations", "employee_id"),
    ):
        if db.execute(sa.text(f"SELECT EXISTS (SELECT 1 FROM {table} AS old LEFT JOIN employees AS e ON e.user_id = old.{column} WHERE e.id IS NULL)")).scalar():
            raise RuntimeError(f"Unmapped historical employee reference in {table}.{column}")

    op.create_table(
        "employee_company_groups",
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("company_group_id", sa.Integer(), sa.ForeignKey("company_groups.id", ondelete="CASCADE"), primary_key=True),
    )
    db.execute(sa.text("""
        INSERT INTO employee_company_groups (employee_id, company_group_id)
        SELECT e.id, old.company_group_id FROM user_company_groups AS old
        JOIN employees AS e ON e.user_id = old.user_id
    """))
    if db.execute(sa.text("SELECT count(*) FROM employee_company_groups")).scalar() != db.execute(sa.text("SELECT count(*) FROM user_company_groups")).scalar():
        raise RuntimeError("Employee group memberships could not be preserved")

    for column in ("evaluator_id", "evaluatee_id"):
        new_column = f"{column}_employee"
        op.add_column("filled_forms", sa.Column(new_column, sa.Integer(), nullable=True))
        db.execute(sa.text(f"""
            UPDATE filled_forms AS f SET {new_column} = e.id FROM employees AS e
            WHERE f.{column} = e.user_id
        """))
        if db.execute(sa.text(f"SELECT EXISTS (SELECT 1 FROM filled_forms WHERE {new_column} IS NULL)")).scalar():
            raise RuntimeError(f"Unmapped filled_forms.{column} references")
        op.drop_constraint(f"filled_forms_{column}_fkey", "filled_forms", type_="foreignkey")
        op.drop_column("filled_forms", column)
        op.alter_column("filled_forms", new_column, new_column_name=column, nullable=False)
        op.create_foreign_key(f"filled_forms_{column}_fkey", "filled_forms", "employees", [column], ["id"])

    op.add_column("campaign_employee_self_evaluations", sa.Column("mapped_employee_id", sa.Integer(), nullable=True))
    db.execute(sa.text("""
        UPDATE campaign_employee_self_evaluations AS c SET mapped_employee_id = e.id
        FROM employees AS e WHERE c.employee_id = e.user_id
    """))
    if db.execute(sa.text("SELECT EXISTS (SELECT 1 FROM campaign_employee_self_evaluations WHERE mapped_employee_id IS NULL)")).scalar():
        raise RuntimeError("Unmapped campaign self-evaluation owner")
    op.drop_constraint("campaign_employee_self_evaluations_pkey", "campaign_employee_self_evaluations", type_="primary")
    op.drop_constraint("campaign_employee_self_evaluations_employee_id_fkey", "campaign_employee_self_evaluations", type_="foreignkey")
    op.drop_column("campaign_employee_self_evaluations", "employee_id")
    op.alter_column("campaign_employee_self_evaluations", "mapped_employee_id", new_column_name="employee_id", nullable=False)
    op.create_primary_key("campaign_employee_self_evaluations_pkey", "campaign_employee_self_evaluations", ["campaign_id", "employee_id"])
    op.create_foreign_key("campaign_employee_self_evaluations_employee_id_fkey", "campaign_employee_self_evaluations", "employees", ["employee_id"], ["id"], ondelete="CASCADE")

    op.drop_table("user_company_groups")
    op.drop_column("users", "company_role_id")
    op.drop_column("users", "profile_image_url")
    op.drop_column("users", "full_name")


def downgrade():
    raise RuntimeError(
        "Employee-only and accountless records cannot be mapped back to users without potential data loss; restore a verified pre-migration backup"
    )

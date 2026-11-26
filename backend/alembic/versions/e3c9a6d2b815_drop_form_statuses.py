"""An evaluation's state follows from its data: drop the form_statuses table.

Submitted = finish_date is set; in progress = answers are saved; otherwise not started.

Revision ID: e3c9a6d2b815
Revises: d7b2e4f1a903
"""
from alembic import op
import sqlalchemy as sa

revision = "e3c9a6d2b815"
down_revision = "d7b2e4f1a903"
branch_labels = None
depends_on = None


def upgrade():
    # Dropping the column drops its foreign key, and dropping the table its index, whatever their names.
    op.drop_column("filled_forms", "status_id")
    op.drop_table("form_statuses")


def downgrade():
    op.create_table("form_statuses",
                    sa.Column("id", sa.Integer(), nullable=False),
                    sa.Column("name", sa.String(), nullable=False),
                    sa.PrimaryKeyConstraint("id"),
                    sa.UniqueConstraint("name"))
    op.create_index("ix_form_statuses_id", "form_statuses", ["id"], unique=False)
    op.execute("INSERT INTO form_statuses (name) VALUES ('Not started'), ('In progress'), ('Completed')")
    op.add_column("filled_forms", sa.Column("status_id", sa.Integer(), nullable=True))
    op.execute("""
        UPDATE filled_forms SET status_id = (SELECT id FROM form_statuses WHERE name =
            CASE WHEN finish_date IS NOT NULL THEN 'Completed'
                 WHEN answers IS NOT NULL AND answers::text NOT IN ('[]', '{}', 'null') THEN 'In progress'
                 ELSE 'Not started' END)
    """)
    op.alter_column("filled_forms", "status_id", nullable=False)
    op.create_foreign_key("filled_forms_status_id_fkey", "filled_forms", "form_statuses", ["status_id"], ["id"])

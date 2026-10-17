"""Add centralized questionnaire sections.

Revision ID: d4a8c1f2e6b9
Revises: c3f1a8d9e2b4
"""
from alembic import op
import sqlalchemy as sa

revision = "d4a8c1f2e6b9"
down_revision = "c3f1a8d9e2b4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "sections",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("scope_key", sa.String(), nullable=False, server_default="default"),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("normalized_name", sa.String(length=120), nullable=False),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scope_key", "normalized_name", name="uq_section_scope_name"),
    )
    op.create_index(op.f("ix_sections_id"), "sections", ["id"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_sections_id"), table_name="sections")
    op.drop_table("sections")

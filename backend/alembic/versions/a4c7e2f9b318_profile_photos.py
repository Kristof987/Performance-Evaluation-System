"""Store uploaded employee profile photos.

Revision ID: a4c7e2f9b318
Revises: f3b8d1e4a926
"""

from alembic import op
import sqlalchemy as sa


revision = "a4c7e2f9b318"
down_revision = "f3b8d1e4a926"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "profile_photos",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("content_type", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade():
    # Uploaded photos live only in this table, so their URLs are cleared with it.
    op.execute("""
        UPDATE employees SET profile_image_url = NULL
        WHERE profile_image_url LIKE '/photos/%'
    """)
    op.drop_table("profile_photos")

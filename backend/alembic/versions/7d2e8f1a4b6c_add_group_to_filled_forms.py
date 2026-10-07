"""add group to filled forms

Revision ID: 7d2e8f1a4b6c
Revises: 024aaa23ee01
Create Date: 2026-10-07 21:49:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7d2e8f1a4b6c'
down_revision: Union[str, Sequence[str], None] = '024aaa23ee01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('filled_forms', sa.Column('company_group_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_filled_forms_company_group_id_company_groups',
        'filled_forms',
        'company_groups',
        ['company_group_id'],
        ['id'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'fk_filled_forms_company_group_id_company_groups',
        'filled_forms',
        type_='foreignkey',
    )
    op.drop_column('filled_forms', 'company_group_id')

"""create form templates

Revision ID: 2a3f3c0f4d1a
Revises: 936ee896176f
Create Date: 2026-10-04 21:17:02.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '2a3f3c0f4d1a'
down_revision: Union[str, Sequence[str], None] = '936ee896176f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'form_templates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('questions', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_form_templates_id'), 'form_templates', ['id'], unique=False)

    templates = sa.table(
        'form_templates',
        sa.column('name', sa.String()),
        sa.column('description', sa.String()),
        sa.column('questions', postgresql.JSONB()),
    )
    op.bulk_insert(
        templates,
        [
            {
                'name': 'Manager feedback',
                'description': 'Template for manager-to-employee feedback.',
                'questions': [
                    {
                        'text': 'What did this employee do especially well?',
                        'type': 'Text',
                        'required': True,
                        'helpText': '',
                    },
                    {
                        'text': 'How would you rate goal achievement?',
                        'type': 'Scale 1-5',
                        'required': True,
                        'helpText': 'Consider goals agreed at the beginning of the cycle.',
                    },
                ],
            },
            {
                'name': 'Engagement survey',
                'description': 'Template for lightweight employee engagement checks.',
                'questions': [
                    {
                        'text': 'How engaged do you feel at work?',
                        'type': 'Scale 1-5',
                        'required': True,
                        'helpText': '',
                    },
                    {
                        'text': 'What would improve your work experience?',
                        'type': 'Text',
                        'required': False,
                        'helpText': '',
                    },
                ],
            },
        ],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_form_templates_id'), table_name='form_templates')
    op.drop_table('form_templates')

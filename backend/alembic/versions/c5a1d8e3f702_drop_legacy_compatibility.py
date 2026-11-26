"""Drop migration-era compatibility: rewrite old stored formats to the current ones.

- campaigns.legacy_issuance_blocked is removed;
- "no snapshot" is always SQL NULL (no JSON null, no 'legacy_unsnapshotted' marker);
- forms, templates and issued snapshots use section/question blocks only;
- rating questions use the single "Scale" type with explicit limits;
- choice options are {"id", "label"} objects stored under "options";
- the dropped dimension metadata is removed from questions.

Revision ID: c5a1d8e3f702
Revises: b4e2c7a9d613
"""
import json
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision = "c5a1d8e3f702"
down_revision = "b4e2c7a9d613"
branch_labels = None
depends_on = None

_SCALE_LIMITS = {"Scale 1-5": (1, 5), "Scale 1-10": (1, 10), "Numerical scale": (1, 5)}
_DIMENSION_KEYS = ("dimension", "dimension_id", "dimensionId")


def _option(option):
    if isinstance(option, str):
        return {"id": option, "label": option}
    if not isinstance(option, dict):
        return option
    converted = {key: value for key, value in option.items() if key not in {"value", "text"}}
    converted["id"] = option.get("id") or option.get("value") or option.get("label")
    converted["label"] = option.get("label") or option.get("text") or option.get("value")
    return converted


def _question(question):
    if not isinstance(question, dict):
        return question
    converted = {key: value for key, value in question.items() if key not in _DIMENSION_KEYS and key != "choices"}
    converted.setdefault("id", str(uuid4()))
    if question.get("type") in _SCALE_LIMITS:
        minimum, maximum = _SCALE_LIMITS[question["type"]]
        converted["type"] = "Scale"
        converted.setdefault("scale_min", minimum)
        converted.setdefault("scale_max", maximum)
    options = question.get("options", question.get("choices"))
    if isinstance(options, list):
        converted["options"] = [_option(option) for option in options]
    return converted


def _blocks(structure):
    if not isinstance(structure, list):
        return structure
    blocks = []
    for item in structure:
        if isinstance(item, dict) and item.get("type") == "section":
            blocks.append({**item, "questions": [_question(question) for question in item.get("questions") or []]})
        elif isinstance(item, dict) and item.get("type") == "question":
            blocks.append({**item, "question": _question(item.get("question"))})
        else:  # A flat question from before blocks existed.
            blocks.append({"type": "question", "question": _question(item)})
    return blocks


def _snapshot(snapshot):
    if isinstance(snapshot, list):
        # Pre-v2 list snapshots stay out of schema-v2 scoring, exactly as before.
        return {"schema_version": 1, "source": "legacy_list_snapshot", "questions": _blocks(snapshot)}
    if isinstance(snapshot, dict) and isinstance(snapshot.get("questions"), list):
        return {**snapshot, "questions": _blocks(snapshot["questions"])}
    return snapshot


def _rewrite(bind, table, column, convert):
    rows = bind.execute(sa.text(f"SELECT id, {column} FROM {table} WHERE {column} IS NOT NULL")).fetchall()
    for row_id, value in rows:
        converted = convert(value)
        if converted != value:
            bind.execute(sa.text(f"UPDATE {table} SET {column} = CAST(:value AS jsonb) WHERE id = :id"),
                         {"value": json.dumps(converted), "id": row_id})


def upgrade():
    # Flagged campaigns had real history; keep them protected from permanent deletion.
    op.execute("UPDATE campaigns SET ever_issued = true WHERE legacy_issuance_blocked")
    op.drop_column("campaigns", "legacy_issuance_blocked")
    op.execute("UPDATE filled_forms SET form_snapshot = NULL WHERE form_snapshot = 'null'::jsonb")
    op.execute("UPDATE filled_forms SET snapshot_status = NULL WHERE snapshot_status = 'legacy_unsnapshotted'")
    bind = op.get_bind()
    _rewrite(bind, "forms", "questions", _blocks)
    _rewrite(bind, "form_templates", "questions", _blocks)
    _rewrite(bind, "filled_forms", "form_snapshot", _snapshot)


def downgrade():
    # The rewritten formats remain readable by the previous code; only the column returns.
    op.add_column("campaigns", sa.Column("legacy_issuance_blocked", sa.Boolean(), nullable=False,
                                         server_default=sa.false()))

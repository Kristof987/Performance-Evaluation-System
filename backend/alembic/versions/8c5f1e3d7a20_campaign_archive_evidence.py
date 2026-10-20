"""Archive audit and durable campaign issuance evidence.

Revision ID: 8c5f1e3d7a20
Revises: 6e4f9a1d2b30
"""

from alembic import op
import sqlalchemy as sa


revision = "8c5f1e3d7a20"
down_revision = "6e4f9a1d2b30"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("campaigns", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("campaigns", sa.Column("archived_by", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_campaigns_archived_by_users", "campaigns", "users", ["archived_by"], ["id"], ondelete="SET NULL")
    op.add_column("campaigns", sa.Column("unarchived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("campaigns", sa.Column("unarchived_by", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_campaigns_unarchived_by_users", "campaigns", "users", ["unarchived_by"], ["id"], ondelete="SET NULL")
    op.add_column("campaigns", sa.Column("ever_issued", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "campaign_archive_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("action IN ('archive', 'unarchive')", name="ck_campaign_archive_action"),
    )
    op.create_index("ix_campaign_archive_events_campaign_id", "campaign_archive_events", ["campaign_id"])
    # Legacy provenance is deliberately conservative; missing historical rows
    # cannot prove a campaign never issued a questionnaire.
    op.execute(sa.text("""
        UPDATE campaigns AS c SET ever_issued = true
        WHERE c.legacy_issuance_blocked OR c.status IN ('active', 'paused', 'review', 'closed')
           OR EXISTS (SELECT 1 FROM campaign_lifecycle_history AS h WHERE h.campaign_id = c.id
                      AND (h.previous_status IN ('active', 'paused', 'review', 'closed')
                           OR h.new_status IN ('active', 'paused', 'review', 'closed')))
           OR EXISTS (SELECT 1 FROM filled_forms AS f WHERE f.campaign_id = c.id
                      AND (f.form_snapshot IS NOT NULL AND f.form_snapshot <> 'null'::jsonb
                            OR (f.snapshot_status IS NOT NULL AND f.snapshot_status <> 'legacy_unsnapshotted')
                            OR f.finish_date IS NOT NULL
                            OR f.answers NOT IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb)))
    """))
    # The backfill above may promote the flag, but subsequent SQL must never
    # erase issuance evidence, even if assignment rows are later removed.
    op.execute(sa.text("""
        CREATE FUNCTION guard_campaign_ever_issued() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.ever_issued AND NOT NEW.ever_issued THEN
                RAISE EXCEPTION 'campaigns.ever_issued cannot be reset to false'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END $$
    """))
    op.execute(sa.text("""
        CREATE TRIGGER trg_guard_campaign_ever_issued BEFORE UPDATE ON campaigns
        FOR EACH ROW EXECUTE FUNCTION guard_campaign_ever_issued()
    """))
    # Preserve evidence even when a questionnaire row is subsequently removed,
    # including changes made outside the application.
    op.execute(sa.text("""
        CREATE FUNCTION mark_campaign_issued() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE source_row filled_forms%ROWTYPE;
        BEGIN
            IF TG_OP = 'UPDATE' AND (
                (OLD.form_snapshot IS NOT NULL AND OLD.form_snapshot <> 'null'::jsonb)
                 OR (OLD.snapshot_status IS NOT NULL AND OLD.snapshot_status <> 'legacy_unsnapshotted')
                 OR OLD.finish_date IS NOT NULL
                 OR OLD.answers NOT IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb)) THEN
                UPDATE campaigns SET ever_issued = true WHERE id = OLD.campaign_id AND NOT ever_issued;
            END IF;
            IF TG_OP = 'DELETE' THEN source_row := OLD;
            ELSE source_row := NEW;
            END IF;
            IF (source_row.form_snapshot IS NOT NULL AND source_row.form_snapshot <> 'null'::jsonb)
                OR (source_row.snapshot_status IS NOT NULL AND source_row.snapshot_status <> 'legacy_unsnapshotted')
                OR source_row.finish_date IS NOT NULL
                OR source_row.answers NOT IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb) THEN
                UPDATE campaigns SET ever_issued = true
                WHERE id = source_row.campaign_id AND NOT ever_issued;
            END IF;
            RETURN NULL;
        END $$;
    """))
    op.execute(sa.text("""
        CREATE TRIGGER trg_mark_campaign_issued AFTER INSERT OR UPDATE OR DELETE ON filled_forms
        FOR EACH ROW EXECUTE FUNCTION mark_campaign_issued()
    """))


def downgrade():
    raise RuntimeError("Downgrading would discard durable issuance evidence; restore a verified backup instead")

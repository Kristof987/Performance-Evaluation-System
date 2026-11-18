import { useUnsavedChangesGuard } from '../../../components/feedback/useUnsavedChangesGuard';

/** Sticky "Unsaved changes" bar; also asks before leaving the page with unsaved edits. */
export default function SaveBar({ dirty, saving, canSave = true, onDiscard, onSave }: {
  dirty: boolean; saving: boolean; canSave?: boolean; onDiscard: () => void; onSave: () => void;
}) {
  useUnsavedChangesGuard(dirty || saving);

  if (!dirty && !saving) return null;
  return <div className="settings-save-bar" aria-busy={saving}>
    <span role="status">{saving ? 'Saving...' : 'Unsaved changes'}</span>
    <button className="btn btn-secondary" type="button" disabled={saving} onClick={onDiscard}>Discard</button>
    <button className="btn btn-primary" type="button" disabled={saving || !canSave} onClick={onSave}>Save</button>
  </div>;
}

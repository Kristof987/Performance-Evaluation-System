import { useEffect } from 'react';

/** Sticky "Unsaved changes" bar; also warns before leaving the page with unsaved edits. */
export default function SaveBar({ dirty, saving, canSave = true, onDiscard, onSave }: {
  dirty: boolean; saving: boolean; canSave?: boolean; onDiscard: () => void; onSave: () => void;
}) {
  useEffect(() => {
    if (!dirty && !saving) return;
    function onBeforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, saving]);

  if (!dirty && !saving) return null;
  return <div className="settings-save-bar" aria-busy={saving}>
    <span role="status">{saving ? 'Saving...' : 'Unsaved changes'}</span>
    <button className="btn btn-secondary" type="button" disabled={saving} onClick={onDiscard}>Discard</button>
    <button className="btn btn-primary" type="button" disabled={saving || !canSave} onClick={onSave}>Save</button>
  </div>;
}

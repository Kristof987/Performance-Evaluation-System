import { useEffect, useState } from 'react';
import { useAppAuth } from '../../../auth/AppAuth';
import { usePreferences } from '../preferences-context';
import { formatSettingsDate } from '../settings-date';
import { fetchAuditLog, type AuditCategory, type AuditEntry } from '../workspace.api';
import LoadError from '../../../components/feedback/LoadError';
import LoadingState from '../../../components/feedback/LoadingState';

const PAGE_SIZE = 50;

const CATEGORIES: { value: AuditCategory; label: string }[] = [
  { value: 'lifecycle', label: 'Campaign status' },
  { value: 'operation', label: 'Campaign operations' },
  { value: 'archive', label: 'Archiving' },
  { value: 'accounts', label: 'Sign-in invitations' },
  { value: 'notifications', label: 'Email reminders' },
  { value: 'permissions', label: 'Permissions' },
  { value: 'privacy', label: 'Privacy settings' },
  { value: 'ai', label: 'AI settings' },
];

const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const labelFor = (category: AuditCategory) => CATEGORIES.find((item) => item.value === category)?.label ?? category;

export default function AuditLogSettings() {
  const { getAccessToken } = useAppAuth();
  const { preferences } = usePreferences();
  const [category, setCategory] = useState<AuditCategory | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchAuditLog(getAccessToken, { category, offset: 0, limit: PAGE_SIZE, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setEntries(result.entries); setHasMore(result.has_more); setError(''); setLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'The audit log could not load.'); setLoading(false);
      });
    return () => controller.abort();
  }, [getAccessToken, category, attempt]);

  async function loadMore() {
    setLoading(true);
    try {
      const result = await fetchAuditLog(getAccessToken, { category, offset: entries.length, limit: PAGE_SIZE });
      setEntries((current) => [...current, ...result.entries]); setHasMore(result.has_more);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'More entries could not load.');
    } finally {
      setLoading(false);
    }
  }

  return <section className="card settings-panel" aria-labelledby="audit-title">
    <div className="settings-panel-header"><h2 id="audit-title">Audit log</h2>
      <p>Campaign status changes, issued questionnaires and changes to workspace settings, newest first.</p></div>
    <label className="settings-preference-label" htmlFor="audit-category">Show
      <select id="audit-category" className="form-control" value={category ?? ''}
        onChange={(event) => { setLoading(true); setCategory((event.target.value || null) as AuditCategory | null); }}>
        <option value="">All events</option>
        {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
    {error && <LoadError message={error} onRetry={() => { setLoading(true); setAttempt((value) => value + 1); }} />}
    {!error && entries.length === 0 && !loading && <p className="settings-note">No events recorded yet.</p>}
    {entries.length > 0 && <ol className="settings-audit-list">
      {entries.map((entry) => <li key={entry.id}>
        <div className="settings-audit-meta">
          <span className={`settings-badge audit-${entry.category}`}>{labelFor(entry.category)}</span>
          <time dateTime={entry.occurred_at}>{formatSettingsDate(entry.occurred_at, browserTimeZone, preferences)}</time>
        </div>
        <p>{entry.summary}</p>
        <small>{entry.campaign_name && <>{entry.campaign_name} · </>}
          {entry.is_automatic ? 'Automatic' : entry.actor_name ?? (entry.actor_user_id ? `User #${entry.actor_user_id}` : 'Unknown user')}</small>
      </li>)}
    </ol>}
    {loading && <LoadingState variant="section" label="Loading audit log" />}
    {hasMore && !loading && <button className="btn btn-secondary settings-load-more" type="button" onClick={() => void loadMore()}>
      Load older entries</button>}
  </section>;
}

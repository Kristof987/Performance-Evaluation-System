import { useEffect, useState, type FormEvent } from 'react';
import { useAppAuth } from '../../../auth/AppAuth';
import { fetchReminderDefaults, saveReminderDefaults, type ReminderDefaults } from '../workspace.api';
import SaveBar from './SaveBar';
import { reminderDayLabel } from '../../completion-status/campaignEmails.api';

type Draft = { days: number[]; launch: boolean };

/** Workspace defaults every campaign follows until HR sets reminders for that campaign. */
export default function EmailReminderSettings() {
  const { getAccessToken } = useAppAuth();
  const [saved, setSaved] = useState<ReminderDefaults | null>(null);
  const [draft, setDraft] = useState<Draft>({ days: [], launch: true });
  const [newDays, setNewDays] = useState('3');
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchReminderDefaults(getAccessToken, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setSaved(result);
        setDraft({ days: result.default_reminder_days, launch: result.default_launch_email });
        setLoadError('');
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : 'Email reminder settings could not load.');
      });
    return () => controller.abort();
  }, [getAccessToken, attempt]);

  if (loadError) return <div className="card card-padded settings-error" role="alert">{loadError}
    <button className="btn btn-secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>;
  if (!saved) return <div className="card card-padded settings-state" role="status">Loading email reminder settings...</div>;

  const dirty = draft.launch !== saved.default_launch_email
    || draft.days.join(',') !== saved.default_reminder_days.join(',');
  const parsed = Number(newDays);
  const validNew = newDays.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 && parsed <= 90;

  function addDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validNew || draft.days.includes(parsed) || draft.days.length >= 10) return;
    setDraft((current) => ({ ...current, days: [...current.days, parsed].sort((a, b) => b - a) }));
    setMessage('');
  }

  async function save() {
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await saveReminderDefaults(getAccessToken, { default_reminder_days: draft.days, default_launch_email: draft.launch });
      setSaved(result);
      setDraft({ days: result.default_reminder_days, launch: result.default_launch_email });
      setMessage('Default reminders saved. Campaigns without their own reminders use them right away.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Email reminder settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="settings-preference-form">
    <section className="card settings-panel" aria-labelledby="email-reminders-title">
      <div className="settings-panel-header"><h2 id="email-reminders-title">Email reminders</h2>
        <p>Defaults for every campaign. A campaign can still set its own reminders on its page.</p></div>
      {!saved.email_configured && <p className="settings-error" role="status">Email sending is not configured on the server, so no emails go out yet.</p>}
      <label className="settings-reminder-launch">
        <input type="checkbox" checked={draft.launch} disabled={saving}
          onChange={(event) => { setDraft((current) => ({ ...current, launch: event.target.checked })); setMessage(''); }} />
        <span><strong>Email everyone when a campaign opens</strong>
          <small>Applies to campaigns created from now on.</small></span>
      </label>
      <h3 className="settings-reminder-heading">Reminders before the end date</h3>
      {draft.days.length === 0 ? <p className="settings-info">No default reminders.</p> : <ul className="settings-reminder-list">
        {draft.days.map((days) => <li key={days}><span>{reminderDayLabel(days)}</span>
          <button className="btn btn-secondary" type="button" disabled={saving}
            onClick={() => { setDraft((current) => ({ ...current, days: current.days.filter((item) => item !== days) })); setMessage(''); }}>Remove</button></li>)}
      </ul>}
      <form className="settings-reminder-add" onSubmit={addDay}>
        <input className="form-control" type="number" min={0} max={90} step={1} value={newDays} aria-label="Days before the end"
          aria-invalid={!validNew} disabled={saving} onChange={(event) => setNewDays(event.target.value)} />
        <span>days before the end</span>
        <button className="btn btn-secondary" type="submit" disabled={saving || !validNew || draft.days.includes(parsed) || draft.days.length >= 10}>Add</button>
      </form>
      <p className="settings-info">Only people who still have unfinished evaluations get a reminder. Days are calendar days; 0 means the last day.</p>
      {error && <p className="settings-error" role="alert">{error}</p>}
      {message && <p className="settings-success" role="status">{message}</p>}
    </section>
    <SaveBar dirty={dirty} saving={saving} canSave onDiscard={() => setDraft({ days: saved.default_reminder_days, launch: saved.default_launch_email })}
      onSave={() => void save()} />
  </div>;
}

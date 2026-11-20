import { useRef, useState } from 'react';
import { useAppAuth } from '../../../auth/AppAuth';
import { usePreferences } from '../preferences-context';
import { defaultPreferences, type Preferences } from '../settings.api';
import InlineMessage from '../../../components/feedback/InlineMessage';
import { useToast } from '../../../components/feedback/feedback-context';
import { useUnsavedChangesGuard } from '../../../components/feedback/useUnsavedChangesGuard';
import Pending from '../../../components/feedback/Pending';

function Toggle({ id, label, description, checked, disabled, onChange }: {
  id: string; label: string; description: string; checked: boolean;
  disabled: boolean; onChange: (value: boolean) => void;
}) {
  return <div className="settings-toggle-row"><label htmlFor={id}><strong>{label}</strong>
    <span id={`${id}-description`}>{description}</span></label>
    <button id={id} type="button" role="switch" aria-checked={checked} aria-describedby={`${id}-description`}
      className="settings-switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span aria-hidden="true" /></button></div>;
}

export default function PreferenceSettings({ section }: { section: 'notifications' | 'appearance' }) {
  const { state } = useAppAuth();
  const { preferences, save } = usePreferences();
  const [draft, setDraft] = useState(preferences);
  const [baseline, setBaseline] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const pending = useRef(false);
  const canManage = state.status === 'authenticated' && state.user.permissions.includes('settings.manage_self');
  const manager = state.status === 'authenticated' && state.user.permissions.includes('campaigns.manage');
  const keys = Object.keys(defaultPreferences) as (keyof Preferences)[];
  const dirty = keys.some((key) => draft[key] !== baseline[key]);
  const disabled = !canManage || saving;

  useUnsavedChangesGuard(dirty || saving, 'preference changes');

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setDraft((current) => ({ ...current, [key]: value })); setError('');
  }

  async function submit() {
    if (pending.current || !canManage || !dirty) return;
    pending.current = true;
    setSaving(true); setError('');
    const changes = Object.fromEntries(keys.filter((key) => draft[key] !== baseline[key])
      .map((key) => [key, draft[key]])) as Partial<Preferences>;
    try {
      const saved = await save(changes);
      setDraft(saved); setBaseline(saved); toast.success('Preferences saved');
    } catch (cause) {
      setDraft(baseline);
      setError(cause instanceof Error ? cause.message : 'Preferences could not be saved.');
    } finally {
      pending.current = false; setSaving(false);
    }
  }

  return <form className="settings-preference-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <section className="card settings-panel" aria-labelledby="preferences-title">
      <div className="settings-panel-header"><h2 id="preferences-title">
        {section === 'notifications' ? 'Notifications' : 'Appearance'}</h2>
        <p>{section === 'notifications' ? 'Choose the updates you want to receive.' : 'Customize your Mirra workspace.'}</p>
      </div>
      {!canManage && <p className="settings-note">You have read-only access to preferences.</p>}
      {section === 'notifications' ? <>
        <div className="settings-preference-group"><h3>Evaluations</h3>
          <Toggle id="notify-new" label="New assignments" description="When an evaluation is assigned to you."
            checked={draft.notify_new_assignment} disabled={disabled}
            onChange={(value) => update('notify_new_assignment', value)} />
          <p className="settings-note">Deadline reminder emails are scheduled for each campaign by HR.</p>
          <Toggle id="notify-results" label="Results available" description="When results become available to you."
            checked={draft.notify_results_available} disabled={disabled}
            onChange={(value) => update('notify_results_available', value)} />
        </div>
        {manager && <div className="settings-preference-group"><h3>Campaigns</h3>
          <Toggle id="notify-campaign" label="Campaign status changes" description="Lifecycle updates for campaign managers."
            checked={draft.notify_campaign_status} disabled={disabled}
            onChange={(value) => update('notify_campaign_status', value)} />
        </div>}
        <p className="settings-info">Email delivery will use these preferences once notifications are enabled for your organization.</p>
      </> : <>
        <fieldset className="settings-preference-group settings-theme-choice" disabled={disabled}><legend>Theme</legend>
          <div className="settings-segmented" role="group" aria-label="Theme">
            {(['system', 'light', 'dark'] as const).map((theme) => <button key={theme} type="button"
              aria-pressed={draft.theme === theme} onClick={() => update('theme', theme)}>
              {theme[0].toUpperCase() + theme.slice(1)}</button>)}
          </div><p className="settings-note">System follows your device's appearance, including live changes.</p>
        </fieldset>
        <label className="settings-preference-label" htmlFor="settings-language">Language
          <select id="settings-language" className="form-control" value={draft.language} disabled={disabled}
            onChange={(event) => update('language', event.target.value as Preferences['language'])}>
            <option value="en">English</option><option value="hu" disabled>Hungarian (coming soon)</option>
          </select>
        </label>
        <label className="settings-preference-label" htmlFor="settings-date-format">Date format
          <select id="settings-date-format" className="form-control" value={draft.date_format} disabled={disabled}
            onChange={(event) => update('date_format', event.target.value as Preferences['date_format'])}>
            <option value="locale">Locale format</option><option value="iso">ISO (YYYY-MM-DD)</option>
          </select>
        </label>
      </>}
      {error && <InlineMessage tone="error" onDismiss={() => setError('')}>{error} Changes were rolled back.</InlineMessage>}
    </section>
    {(dirty || saving) && <div className="settings-save-bar" aria-busy={saving}>
      <span role="status">{saving ? <Pending label="Saving" /> : 'Unsaved changes'}</span>
      <button className="btn btn-secondary" type="button" disabled={saving}
        onClick={() => { setDraft(baseline); setError(''); }}>Discard</button>
      <button className="btn btn-primary" type="submit" disabled={disabled}>Save</button>
    </div>}
  </form>;
}

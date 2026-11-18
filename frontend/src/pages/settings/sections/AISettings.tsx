import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAppAuth } from '../../../auth/AppAuth';
import {
  fetchPermissionMatrix, fetchWorkspaceSettings, patchWorkspaceSettings,
  type PermissionMatrix, type WorkspaceSettings,
} from '../workspace.api';
import SaveBar from './SaveBar';
import InlineMessage from '../../../components/feedback/InlineMessage';
import LoadError from '../../../components/feedback/LoadError';
import { useToast } from '../../../components/feedback/feedback-context';
import LoadingState from '../../../components/feedback/LoadingState';

const AI_PERMISSIONS = [
  { name: 'ai_analysis.generate', label: 'Generate and edit' },
  { name: 'ai_analysis.approve', label: 'Approve' },
];

type Draft = { enabled: boolean; model: string };

const toDraft = (settings: WorkspaceSettings): Draft => ({ enabled: settings.ai_enabled, model: settings.ai_model ?? '' });

export default function AISettings() {
  const toast = useToast();
  const { state, getAccessToken } = useAppAuth();
  const canEditPermissions = state.status === 'authenticated' && state.user.permissions.includes('permissions.manage');
  const [saved, setSaved] = useState<WorkspaceSettings | null>(null);
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [draft, setDraft] = useState<Draft>({ enabled: true, model: '' });
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchWorkspaceSettings(getAccessToken, controller.signal), fetchPermissionMatrix(getAccessToken, controller.signal)])
      .then(([settings, permissions]) => {
        if (controller.signal.aborted) return;
        setSaved(settings); setMatrix(permissions); setDraft(toDraft(settings)); setLoadError('');
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : 'AI settings could not load.');
      });
    return () => controller.abort();
  }, [getAccessToken, attempt]);

  if (loadError) return <LoadError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!saved || !matrix) return <LoadingState variant="page" label="Loading AI settings" />;

  const modelValid = /^[A-Za-z0-9._:-]{0,100}$/.test(draft.model.trim());
  const dirty = draft.enabled !== saved.ai_enabled || draft.model.trim() !== (saved.ai_model ?? '');

  async function save() {
    if (!saved || !modelValid) return;
    setSaving(true); setError('');
    try {
      const updated = await patchWorkspaceSettings(getAccessToken, { ai_enabled: draft.enabled, ai_model: draft.model.trim() });
      setSaved(updated); setDraft(toDraft(updated)); toast.success('AI settings saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const effectiveModel = draft.model.trim() || saved.default_model;

  return <div className="settings-preference-form">
    <section className="card settings-panel" aria-labelledby="ai-title">
      <div className="settings-panel-header"><h2 id="ai-title">AI analysis</h2>
        <p>Turn AI-assisted result analysis and questionnaire drafting on or off, and choose the model.</p></div>
      {!saved.api_key_configured && <InlineMessage tone="warning">
        No OpenAI API key is configured on the server, so AI generation will fail until an administrator sets OPENAI_API_KEY.</InlineMessage>}
      <div className="settings-preference-group">
        <div className="settings-toggle-row"><label htmlFor="ai-enabled"><strong>AI features</strong>
          <span id="ai-enabled-description">When off, nobody can start new AI analyses or AI questionnaire drafts.
            Saved analyses stay readable.</span></label>
          <button id="ai-enabled" type="button" role="switch" aria-checked={draft.enabled} aria-describedby="ai-enabled-description"
            className="settings-switch" disabled={saving}
            onClick={() => { setDraft((current) => ({ ...current, enabled: !current.enabled })); }}>
            <span aria-hidden="true" /></button></div>
      </div>
      <label className="settings-preference-label" htmlFor="ai-model">Model
        <input id="ai-model" className="form-control" value={draft.model} maxLength={100} disabled={saving}
          placeholder={saved.default_model ? `Server default: ${saved.default_model}` : 'Server default'}
          aria-invalid={!modelValid} aria-describedby="ai-model-help"
          onChange={(event) => { setDraft((current) => ({ ...current, model: event.target.value })); }} />
      </label>
      <p id="ai-model-help" className="settings-note">{!modelValid
        ? 'Use only letters, numbers, dots, dashes, underscores and colons.'
        : effectiveModel ? `New analyses will use ${effectiveModel}. Leave empty to use the server default.`
          : 'No model is configured on the server; enter one here.'}</p>
      {modelValid && effectiveModel && !/-\d{4}-\d{2}-\d{2}$/.test(effectiveModel) && <p className="settings-note settings-model-alias" role="status">
        “{effectiveModel}” is an alias that OpenAI may point to a newer model later, which can change results without notice.
        For stable results use a dated snapshot, for example <code>gpt-4.1-2025-04-14</code>.</p>}

      <div className="settings-preference-group"><h3>Who can use AI analysis</h3>
        <div className="settings-table-wrap"><table className="settings-table">
          <thead><tr><th scope="col">Role</th>{AI_PERMISSIONS.map((item) => <th scope="col" key={item.name}>{item.label}</th>)}</tr></thead>
          <tbody>{matrix.roles.map((role) => <tr key={role.id}><th scope="row">{role.name}</th>
            {AI_PERMISSIONS.map((item) => <td key={item.name}>{role.permissions.includes(item.name)
              ? <span className="settings-badge granted">Allowed</span> : <span className="settings-badge">—</span>}</td>)}
          </tr>)}</tbody>
        </table></div>
        <p className="settings-note">{canEditPermissions
          ? <>Change these on the <Link to="/settings/permissions">Permissions</Link> page.</>
          : 'An administrator with permission management can change who may generate and approve analyses.'}</p>
      </div>
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
          </section>
    <SaveBar dirty={dirty} saving={saving} canSave={modelValid}
      onDiscard={() => { setDraft(toDraft(saved)); setError(''); }} onSave={() => void save()} />
  </div>;
}

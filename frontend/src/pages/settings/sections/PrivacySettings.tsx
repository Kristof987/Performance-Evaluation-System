import { useEffect, useState } from 'react';
import { useAppAuth } from '../../../auth/AppAuth';
import { fetchWorkspaceSettings, patchWorkspaceSettings, type WorkspaceSettings } from '../workspace.api';
import SaveBar from './SaveBar';
import InlineMessage from '../../../components/feedback/InlineMessage';
import LoadError from '../../../components/feedback/LoadError';
import { useToast } from '../../../components/feedback/feedback-context';

type Draft = { peers: string; cohort: string };

const MIN = 2;
const MAX = 20;

function parse(value: string) {
  const number = Number(value);
  return value.trim() !== '' && Number.isInteger(number) && number >= MIN && number <= MAX ? number : null;
}

export default function PrivacySettings() {
  const toast = useToast();
  const { getAccessToken } = useAppAuth();
  const [saved, setSaved] = useState<WorkspaceSettings | null>(null);
  const [draft, setDraft] = useState<Draft>({ peers: '', cohort: '' });
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchWorkspaceSettings(getAccessToken, controller.signal)
      .then((settings) => {
        if (controller.signal.aborted) return;
        setSaved(settings);
        setDraft({ peers: String(settings.min_individual_peer_reviewers), cohort: String(settings.min_aggregate_evaluatees) });
        setLoadError('');
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : 'Privacy settings could not load.');
      });
    return () => controller.abort();
  }, [getAccessToken, attempt]);

  if (loadError) return <LoadError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!saved) return <div className="card card-padded settings-state" role="status">Loading privacy settings...</div>;

  const peers = parse(draft.peers);
  const cohort = parse(draft.cohort);
  const dirty = draft.peers !== String(saved.min_individual_peer_reviewers)
    || draft.cohort !== String(saved.min_aggregate_evaluatees);

  function discard() {
    if (!saved) return;
    setDraft({ peers: String(saved.min_individual_peer_reviewers), cohort: String(saved.min_aggregate_evaluatees) });
    setError('');
  }

  async function save() {
    if (peers === null || cohort === null) return;
    setSaving(true); setError('');
    try {
      const updated = await patchWorkspaceSettings(getAccessToken, {
        min_individual_peer_reviewers: peers, min_aggregate_evaluatees: cohort,
      });
      setSaved(updated);
      setDraft({ peers: String(updated.min_individual_peer_reviewers), cohort: String(updated.min_aggregate_evaluatees) });
      toast.success('Privacy thresholds saved. Reports use them from the next page load');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Privacy settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="settings-preference-form">
    <section className="card settings-panel" aria-labelledby="privacy-title">
      <div className="settings-panel-header"><h2 id="privacy-title">Privacy</h2>
        <p>Control when report results are hidden to protect individual reviewers.</p></div>
      <div className="settings-threshold-list">
        <label className="settings-threshold" htmlFor="min-peers">
          <span><strong>Minimum peer reviewers per employee</strong>
            <small>An employee's Section score is shown only if at least this many different colleagues rated them.</small></span>
          <input id="min-peers" className="form-control" type="number" min={MIN} max={MAX} step={1} value={draft.peers}
            aria-invalid={peers === null} disabled={saving}
            onChange={(event) => { setDraft((current) => ({ ...current, peers: event.target.value })); }} />
        </label>
        <label className="settings-threshold" htmlFor="min-cohort">
          <span><strong>Minimum evaluated employees per group</strong>
            <small>Campaign, group and role averages are shown only if at least this many employees contribute.</small></span>
          <input id="min-cohort" className="form-control" type="number" min={MIN} max={MAX} step={1} value={draft.cohort}
            aria-invalid={cohort === null} disabled={saving}
            onChange={(event) => { setDraft((current) => ({ ...current, cohort: event.target.value })); }} />
        </label>
      </div>
      {(peers === null || cohort === null) && <p className="settings-field-error" role="alert">
        Enter a whole number from {MIN} to {MAX}.</p>}
      <p className="settings-info">Values below {MIN} are not allowed: with a single reviewer, their individual ratings could be
        read directly from a report. Higher values hide more results but give stronger anonymity. Users with campaign
        management permission still see unsuppressed aggregate scores.</p>
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
          </section>
    <SaveBar dirty={dirty} saving={saving} canSave={peers !== null && cohort !== null}
      onDiscard={discard} onSave={() => void save()} />
  </div>;
}

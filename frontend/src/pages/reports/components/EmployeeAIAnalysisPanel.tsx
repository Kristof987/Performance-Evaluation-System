import { useEffect, useRef, useState } from 'react';
import type { AccessTokenGetter } from '../../../auth/authenticated-api';
import { approveAIAnalysis, fetchAIAnalyses, generateAIAnalysis, saveAIAnalysis } from '../api/ai-analysis.api';
import type { AnalysisEvidence, AnalysisFinding, AnalysisVersion, EmployeeAIAnalysis, EmployeeAIAnalysisHistory } from '../types/ai-analysis.types';

type Props = { campaignId: number; employeeId: number; getAccessToken: AccessTokenGetter };

function dateLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not recorded';
}

function EvidenceDetail({ id, item }: { id: string; item: AnalysisEvidence | undefined }) {
  return <details className="reports-ai-evidence">
    <summary>{item ? `${item.category === 'self' ? 'Self-evaluation' : 'Aggregated peer feedback'} · ${item.section_name ?? 'Other questions'} · ${item.question_text}` : 'Evidence unavailable'}</summary>
    {item && <div className="reports-ai-evidence-body">
      {item.question_statistics.map((stat, index) => <div key={`${stat.question_text}-${index}`}>
        <strong>{stat.question_text}</strong>
        <p>Normalized average: {stat.average_normalized?.toFixed(2) ?? 'Unavailable'} / 5 · Submitted answers: {stat.answer_count ?? 'Unavailable'}</p>
        <p>Issued scale: {stat.scale_min}–{stat.scale_max}{stat.min_label ? ` · ${stat.min_label}` : ''}{stat.max_label ? ` to ${stat.max_label}` : ''}</p>
        {stat.original_distribution.length > 0 && <p>Original rating distribution: {stat.original_distribution.map((bin) => `${bin.original_value}: ${bin.count}`).join(' · ')}</p>}
      </div>)}
      {item.section_statistics.map((stat) => <p key={stat.section_name}>{stat.section_name}: {stat.average_normalized?.toFixed(2) ?? 'Unavailable'} / 5 · {stat.contributor_count ?? 'Unavailable'} {item.category === 'peer' ? 'reviewers' : 'self-evaluations'}</p>)}
      {item.category === 'self' && item.original_value !== null && item.original_value !== undefined && <p>Original self-rating: {item.original_value}; normalized: {item.normalized_value?.toFixed(2)} / 5</p>}
      {item.category === 'self' && item.response_text && <p className="reports-ai-quote">{item.response_text}</p>}
      <small>Reference: {id}</small>
    </div>}
  </details>;
}

function FindingCard({ finding, evidence, edit, onChange, onRemove }: {
  finding: AnalysisFinding; evidence: Record<string, AnalysisEvidence>;
  edit: boolean; onChange?: (next: AnalysisFinding) => void; onRemove?: () => void;
}) {
  const available = Object.keys(evidence);
  return <article className="reports-ai-finding">
    {edit && onChange ? <>
      <label>Assessment<textarea className="form-control" value={finding.assessment} maxLength={1200} onChange={(event) => onChange({ ...finding, assessment: event.target.value })} /></label>
      <label>Reasoning<textarea className="form-control" value={finding.reasoning} maxLength={2000} onChange={(event) => onChange({ ...finding, reasoning: event.target.value })} /></label>
      <fieldset className="reports-ai-citations"><legend>Supporting evidence (required)</legend>
        {available.map((id) => <label key={id}><input type="checkbox" checked={finding.supporting_evidence_ids.includes(id)} onChange={(event) => onChange({ ...finding, supporting_evidence_ids: event.target.checked ? [...finding.supporting_evidence_ids, id] : finding.supporting_evidence_ids.filter((candidate) => candidate !== id) })} />{evidence[id].question_text} · {evidence[id].category}</label>)}
      </fieldset>
      {finding.numeric_claims.length > 0 && <small>Keep labeled numbers unchanged; their values and all associated citations are checked when saving.</small>}
      {onRemove && <button type="button" className="btn btn-secondary btn-small" onClick={onRemove}>Remove finding</button>}
    </> : <><h4>{finding.assessment}</h4><p>{finding.reasoning}</p></>}
    <div className="reports-ai-citation-list"><strong>Supporting evidence</strong>
      {finding.supporting_evidence_ids.map((id) => <EvidenceDetail key={id} id={id} item={evidence[id]} />)}
    </div>
  </article>;
}

const blankFinding = (evidenceId: string): AnalysisFinding => ({ assessment: '', reasoning: '', supporting_evidence_ids: [evidenceId], numeric_claims: [] });

export default function EmployeeAIAnalysisPanel({ campaignId, employeeId, getAccessToken }: Props) {
  const [history, setHistory] = useState<EmployeeAIAnalysisHistory | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<EmployeeAIAnalysis | null>(null);
  const [busy, setBusy] = useState<'generate' | 'save' | 'approve' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const actionPending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetchAIAnalyses(getAccessToken, campaignId, employeeId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setHistory(result); setSelectedId((previous) => previous !== null && result.versions.some((version) => version.id === previous) ? previous : result.versions[0]?.id ?? null); } })
      .catch((cause) => { if (!controller.signal.aborted) { setHistory(null); setEditing(null); setError(cause instanceof Error ? cause.message : 'Analysis could not be loaded.'); } });
    return () => controller.abort();
  }, [campaignId, employeeId, getAccessToken, reload]);

  const selected = history?.versions.find((version) => version.id === selectedId) ?? history?.versions[0] ?? null;
  async function perform(kind: 'generate' | 'save' | 'approve', task: () => Promise<AnalysisVersion>) {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(kind);
    setError('');
    setNotice('');
    try {
      const result = await task();
      setEditing(null);
      setSelectedId(result.id);
      setHistory((current) => current && { ...current,
        versions: [result, ...current.versions.filter((version) => version.id !== result.id).map((version) => kind === 'approve' && version.is_current_approved ? { ...version, is_current_approved: false } : version)].sort((a, b) => b.version - a.version),
      });
      setNotice(kind === 'approve' ? 'Analysis approved.' : kind === 'save' ? 'Edited Draft saved as a new version.' : 'New Draft generated. Review it before approval.');
      setReload((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Analysis request failed.');
    } finally {
      actionPending.current = false;
      setBusy(null);
    }
  }

  function updateFinding(section: keyof EmployeeAIAnalysis, index: number | null, next: AnalysisFinding) {
    setEditing((current) => {
      if (!current) return current;
      if (section === 'overall_assessment') return { ...current, overall_assessment: next };
      return { ...current, [section]: current[section].map((item, position) => position === index ? next : item) };
    });
  }
  function removeFinding(section: 'strengths' | 'development_areas', index: number) {
    setEditing((current) => current && { ...current, [section]: current[section].filter((_, position) => position !== index) });
  }
  function addFinding(section: 'strengths' | 'development_areas') {
    const firstEvidence = Object.keys(selected?.evidence ?? {})[0];
    if (firstEvidence) setEditing((current) => current && { ...current, [section]: [...current[section], blankFinding(firstEvidence)] });
  }

  const mayWrite = history?.can_manage && !selected?.outdated;
  return <section className="reports-card reports-ai-panel" aria-label="AI Performance Analysis">
    <div className="reports-section-heading"><h2>AI Performance Analysis</h2><p>Evidence-based summary of submitted evaluations. Drafts require explicit HR review and approval.</p></div>
    {!history && !error && <p className="reports-state">Loading saved analyses...</p>}
    {error && <div className="reports-state reports-error" role="alert">{error}<button type="button" className="btn btn-secondary btn-small" onClick={() => setReload((value) => value + 1)}>Retry</button></div>}
    {notice && <p className="reports-ai-notice" role="status">{notice}</p>}
    {history && <>
      <div className="reports-ai-toolbar">
        {history.versions.length > 0 && <label>Analysis version<select className="form-control" value={selected?.id ?? ''} onChange={(event) => { setEditing(null); setSelectedId(Number(event.target.value)); setNotice(''); }}>
          {history.versions.map((version) => <option key={version.id} value={version.id}>Version {version.version} · {version.status === 'draft' ? 'Draft' : 'Approved'}{version.is_current_approved ? ' · Current approved' : ''}{version.outdated ? ' · Outdated' : ''}</option>)}
        </select></label>}
        {history.can_manage && <button type="button" className="btn btn-primary" disabled={busy !== null || !history.has_eligible_evidence} onClick={() => {
          if (history.versions.length > 0 && !window.confirm('Regenerate? This may incur API cost. A new Draft will be created; earlier versions remain available.')) return;
          void perform('generate', () => generateAIAnalysis(getAccessToken, campaignId, employeeId));
        }}>{busy === 'generate' ? 'Generating analysis...' : history.versions.length ? 'Regenerate Analysis' : 'Generate Analysis'}</button>}
      </div>
      {!history.has_eligible_evidence && <p className="reports-ai-warning">No reportable submitted evidence is available. Insufficient data is not an indication of low performance.</p>}
      {!selected && <p className="reports-ai-intro">Generate an analysis of eligible submitted evaluations. AI conclusions are not shown until explicitly generated, reviewed and approved by an authorized manager.</p>}
      {selected && <>
        {selected.outdated && <p className="reports-ai-warning" role="alert">Outdated analysis: submitted evaluation data has changed. This version remains historical; regenerate before editing or approval.</p>}
        <div className="reports-ai-meta"><span>{selected.status === 'approved' ? 'Approved' : 'Draft'}{selected.is_current_approved ? ' · Current approved' : ''}</span><span>Generated {dateLabel(selected.generated_at)} by user #{selected.generated_by_user_id} · {selected.model_identifier}</span>{selected.edited_at && <span>Edited {dateLabel(selected.edited_at)} by user #{selected.edited_by_user_id}</span>}{selected.approved_at && <span>Approved {dateLabel(selected.approved_at)} by user #{selected.approved_by_user_id}</span>}</div>
        <div className="reports-ai-sections">
          <div><h3>Overall Assessment</h3><FindingCard finding={editing?.overall_assessment ?? selected.analysis.overall_assessment} evidence={selected.evidence} edit={editing !== null} onChange={(next) => updateFinding('overall_assessment', null, next)} /></div>
          {(['strengths', 'development_areas'] as const).map((section) => <div key={section}><h3>{section === 'strengths' ? 'Strengths' : 'Development Areas'}</h3>
            {(editing?.[section] ?? selected.analysis[section]).length === 0 && <p>No evidence-backed findings in this section.</p>}
            {(editing?.[section] ?? selected.analysis[section]).map((finding, index) => <FindingCard key={`${section}-${index}`} finding={finding} evidence={selected.evidence} edit={editing !== null} onChange={(next) => updateFinding(section, index, next)} onRemove={editing ? () => removeFinding(section, index) : undefined} />)}
            {editing && (editing[section].length < 5) && Object.keys(selected.evidence).length > 0 && <button type="button" className="btn btn-secondary btn-small" onClick={() => addFinding(section)}>Add finding</button>}
          </div>)}
        </div>
        {history.can_manage && <div className="reports-ai-actions">
          {editing ? <><button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => { if (editing) void perform('save', () => saveAIAnalysis(getAccessToken, campaignId, employeeId, selected.id, editing)); }}>{busy === 'save' ? 'Saving...' : 'Save as new Draft'}</button><button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => setEditing(null)}>Cancel editing</button></>
            : selected.status === 'draft' && mayWrite && <><button type="button" className="btn btn-secondary" disabled={busy !== null || selected.id !== history.versions[0]?.id} onClick={() => setEditing(structuredClone(selected.analysis))}>Edit Draft</button><button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => { if (window.confirm('Approve this specific analysis version? Approved content becomes read-only and replaces the current approved designation.')) void perform('approve', () => approveAIAnalysis(getAccessToken, campaignId, employeeId, selected.id)); }}>{busy === 'approve' ? 'Approving...' : 'Approve Analysis'}</button></>}
        </div>}
      </>}
    </>}
  </section>;
}

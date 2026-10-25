import { useEffect, useRef, useState } from 'react';
import type { AccessTokenGetter } from '../../../auth/authenticated-api';
import { approveAIAnalysis, fetchAIAnalyses, fetchGenerationJob, fetchLatestGenerationJob, generateAIAnalysis, generationErrorMessage, saveAIAnalysis } from '../api/ai-analysis.api';
import type { AIAnalysis, AIAnalysisGenerationJob, AIAnalysisHistory, AIAnalysisScope, AnalysisEvidence, AnalysisFinding, AnalysisVersion } from '../types/ai-analysis.types';

type Props = { scope: AIAnalysisScope; getAccessToken: AccessTokenGetter };

function scopeKey(scope: AIAnalysisScope) {
  switch (scope.type) {
    case 'employee': return `${scope.campaignId}:employee:${scope.employeeId}`;
    case 'group': return `${scope.campaignId}:group:${scope.groupId}`;
    case 'role': return `${scope.campaignId}:role:${scope.roleId}`;
    case 'campaign': return `${scope.campaignId}:campaign`;
  }
}

const scopeCopy = {
  employee: { heading: 'AI Performance Analysis', description: 'Evidence-based summary of submitted evaluations. Drafts require explicit HR review and approval.', intro: 'Generate an analysis of eligible submitted evaluations.' },
  group: { heading: 'AI Performance Analysis', description: 'Evidence-based summary of reportable group results, not individual employee feedback. Drafts require explicit HR review and approval.', intro: 'Generate an analysis of eligible group results.' },
  role: { heading: 'AI Performance Analysis', description: 'Evidence-based summary of reportable feedback received by employees in this role, not evaluator performance. Drafts require explicit HR review and approval.', intro: 'Generate an analysis of eligible evaluated-role results.' },
  campaign: { heading: 'AI Performance Analysis', description: 'Evidence-based summary of reportable campaign-wide results, not individual employee feedback. Drafts require explicit HR review and approval.', intro: 'Generate an analysis of eligible campaign results.' },
};

function dateLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not recorded';
}

type EvidenceGroup = { key: string; entries: Array<{ id: string; item: AnalysisEvidence | undefined }> };

function groupedEvidence(ids: string[], evidence: Record<string, AnalysisEvidence>, employeeScope: boolean): EvidenceGroup[] {
  const groups = new Map<string, EvidenceGroup>();
  for (const id of ids) {
    const source = employeeScope ? /^form:\d+:question:(.+):(rating|text)$/.exec(id) : null;
    const item = evidence[id];
    const key = source && item ? `${item.category}:${source[1]}:${source[2]}` : id;
    if (!groups.has(key)) groups.set(key, { key, entries: [] });
    groups.get(key)!.entries.push({ id, item });
  }
  return [...groups.values()];
}

function EvidenceDetail({ group, employeeScope }: { group: EvidenceGroup; employeeScope: boolean }) {
  const item = group.entries.find((entry) => entry.item)?.item;
  const questions = [...new Map(group.entries.flatMap((entry) => entry.item?.question_statistics ?? []).map((stat) => [JSON.stringify(stat), stat])).values()];
  const sections = [...new Map(group.entries.flatMap((entry) => entry.item?.section_statistics ?? []).map((stat) => [JSON.stringify(stat), stat])).values()];
  const completion = [...new Map(group.entries.flatMap((entry) => entry.item?.completion_statistics ?? []).map((stat) => [JSON.stringify(stat), stat])).values()];
  const category = item?.category === 'self' ? employeeScope ? 'Self-evaluation' : 'Aggregated self-evaluations' : item?.category === 'peer' ? 'Peer feedback' : 'Aggregated results';
  const label = item?.question_text ?? 'Evidence unavailable';
  return <details className="reports-ai-evidence">
    <summary>{item ? `${label} · ${category}` : label}</summary>
    {item && <div className="reports-ai-evidence-body">
      {item.section_name && item.section_name !== label && <p>Section: {item.section_name}</p>}
      {questions.map((stat, index) => <div key={index}>
        {stat.question_text !== label && <strong>{stat.question_text}</strong>}
        <p>Normalized average: {stat.average_normalized?.toFixed(2) ?? 'Unavailable'} / 5 · Submitted answers: {stat.answer_count ?? 'Unavailable'}</p>
        {stat.scale_min != null && stat.scale_max != null && <p>Issued scale: {stat.scale_min}–{stat.scale_max}{stat.min_label ? ` · ${stat.min_label}` : ''}{stat.max_label ? ` to ${stat.max_label}` : ''}</p>}
        {!!stat.original_distribution?.length && <p>Original rating distribution: {stat.original_distribution.map((bin) => `${bin.original_value}: ${bin.count}`).join(' · ')}</p>}
      </div>)}
      {sections.map((stat, index) => <p key={index}>{stat.section_name}: {stat.average_normalized?.toFixed(2) ?? 'Unavailable'} / 5 · {stat.contributor_count ?? 'Unavailable'} {employeeScope && item.category === 'peer' ? 'reviewers' : employeeScope && item.category === 'self' ? 'self-evaluations' : 'contributors'}</p>)}
      {completion.map((stat, index) => <p key={index}>{stat.label}: {stat.value ?? 'Unavailable'}{stat.count != null ? ` · Count: ${stat.count}` : ''}</p>)}
      {employeeScope && group.entries.map(({ id, item: source }) => <div key={id}>
        {source?.category === 'self' && source.original_value != null && <p>Original self-rating: {source.original_value}; normalized: {source.normalized_value?.toFixed(2)} / 5</p>}
        {source?.category === 'self' && source.response_text && <p className="reports-ai-quote">{source.response_text}</p>}
      </div>)}
    </div>}
  </details>;
}

function FindingCard({ finding, evidence, employeeScope, edit, onChange, onRemove }: {
  finding: AnalysisFinding; evidence: Record<string, AnalysisEvidence>;
  employeeScope: boolean; edit: boolean; onChange?: (next: AnalysisFinding) => void; onRemove?: () => void;
}) {
  const available = Object.keys(evidence);
  const [showAll, setShowAll] = useState(false);
  const groups = groupedEvidence(finding.supporting_evidence_ids, evidence, employeeScope);
  return <article className="reports-ai-finding">
    {edit && onChange ? <>
      <label>Assessment<textarea className="form-control" value={finding.assessment} maxLength={1200} onChange={(event) => onChange({ ...finding, assessment: event.target.value })} /></label>
      <label>Reasoning<textarea className="form-control" value={finding.reasoning} maxLength={2000} onChange={(event) => onChange({ ...finding, reasoning: event.target.value })} /></label>
      {finding.fact_ids != null ? <small>Supporting evidence is determined by the selected facts and cannot be changed independently.</small>
        : <fieldset className="reports-ai-citations"><legend>Supporting evidence (required)</legend>
          {available.map((id) => <label key={id}><input type="checkbox" checked={finding.supporting_evidence_ids.includes(id)} onChange={(event) => onChange({ ...finding, supporting_evidence_ids: event.target.checked ? [...finding.supporting_evidence_ids, id] : finding.supporting_evidence_ids.filter((candidate) => candidate !== id) })} />{evidence[id].question_text} · {evidence[id].category}</label>)}
        </fieldset>}
      {finding.numeric_claims.length > 0 && <small>Keep verified numbers unchanged; their values and all associated citations are checked when saving.</small>}
      {!!finding.comparison_claims?.length && <small>Keep comparisons aligned with the cited areas and direction; supporting facts are checked when saving.</small>}
      {!!finding.observation_claims?.length && <small>Keep assessments aligned with their cited observations; fact references are checked when saving.</small>}
      {!!finding.fact_ids?.length && <small>Keep assessments aligned with their cited facts; evidence is resolved and checked when saving.</small>}
      {onRemove && <button type="button" className="btn btn-secondary btn-small" onClick={onRemove}>Remove finding</button>}
    </> : <><h4>{finding.assessment}</h4><p>{finding.reasoning}</p></>}
    <div className="reports-ai-citation-list"><strong>Supporting Evidence</strong>
      {(showAll ? groups : groups.slice(0, 3)).map((group) => <EvidenceDetail key={group.key} group={group} employeeScope={employeeScope} />)}
      {groups.length > 3 && <button type="button" className="reports-ai-show-evidence" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)}>{showAll ? 'Show less' : `Show all evidence (${groups.length})`}</button>}
    </div>
  </article>;
}

const blankFinding = (evidenceId: string): AnalysisFinding => ({ assessment: '', reasoning: '', supporting_evidence_ids: [evidenceId], numeric_claims: [], comparison_claims: [], observation_claims: [] });

export default function EmployeeAIAnalysisPanel({ scope, getAccessToken }: Props) {
  return <AIAnalysisPanel key={scopeKey(scope)} scope={scope} getAccessToken={getAccessToken} />;
}

function AIAnalysisPanel({ scope, getAccessToken }: Props) {
  const [history, setHistory] = useState<AIAnalysisHistory | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<AIAnalysis | null>(null);
  const [busy, setBusy] = useState<'generate' | 'save' | 'approve' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [jobReload, setJobReload] = useState(0);
  const [job, setJob] = useState<AIAnalysisGenerationJob | null>(null);
  const [jobReady, setJobReady] = useState(false);
  const [jobError, setJobError] = useState('');
  const actionPending = useRef(false);
  const actionController = useRef<AbortController | null>(null);
  const jobRequestEpoch = useRef(0);
  const acceptedJobId = useRef(0);
  const handledSuccessJobId = useRef(0);
  const accessTokenRef = useRef(getAccessToken);
  const historyRef = useRef(history);
  const editingRef = useRef(editing);
  accessTokenRef.current = getAccessToken;
  historyRef.current = history;
  editingRef.current = editing;

  useEffect(() => {
    return () => { actionController.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetchAIAnalyses(accessTokenRef.current, scope, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setHistory(result); setSelectedId((previous) => previous !== null && result.versions.some((version) => version.id === previous) ? previous : result.versions[0]?.id ?? null); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Analysis could not be loaded.'); });
    return () => controller.abort();
  }, [scope.campaignId, scope.type, scope.type === 'employee' ? scope.employeeId : scope.type === 'group' ? scope.groupId : scope.type === 'role' ? scope.roleId : null, reload]);

  useEffect(() => {
    const controller = new AbortController();
    const epoch = jobRequestEpoch.current;
    setJobReady(false);
    setJobError('');
    fetchLatestGenerationJob(accessTokenRef.current, scope, controller.signal)
      .then((latest) => {
        if (controller.signal.aborted || epoch !== jobRequestEpoch.current || (latest && latest.id < acceptedJobId.current)) return;
        if (latest) acceptedJobId.current = latest.id;
        setJob(latest);
        setJobReady(true);
        if (latest?.status === 'succeeded') {
          if (latest.analysis_id === null) setJobError('Completed generation has no analysis. Please check its status again.');
          else if (handledSuccessJobId.current !== latest.id && !historyRef.current?.versions.some((version) => version.id === latest.analysis_id)) {
            handledSuccessJobId.current = latest.id;
            if (!editingRef.current) setSelectedId(latest.analysis_id);
            setReload((value) => value + 1);
          }
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted && epoch === jobRequestEpoch.current) setJobError(cause instanceof Error ? cause.message : 'Generation status could not be loaded.');
      });
    return () => controller.abort();
  }, [scope.campaignId, scope.type, scope.type === 'employee' ? scope.employeeId : scope.type === 'group' ? scope.groupId : scope.type === 'role' ? scope.roleId : null, jobReload]);

  const jobActive = job?.status === 'queued' || job?.status === 'running';
  useEffect(() => {
    if (!jobReady || !jobActive || jobError || !job) return;
    const controller = new AbortController();
    const epoch = jobRequestEpoch.current;
    const timer = window.setTimeout(() => {
      fetchGenerationJob(accessTokenRef.current, scope, job.id, controller.signal)
        .then((latest) => {
          if (controller.signal.aborted || epoch !== jobRequestEpoch.current || latest.id < acceptedJobId.current) return;
          setJob(latest);
          if (latest.status === 'succeeded') {
            if (latest.analysis_id === null) setJobError('Completed generation has no analysis. Please check its status again.');
            else if (handledSuccessJobId.current !== latest.id) {
              handledSuccessJobId.current = latest.id;
              if (!editingRef.current) setSelectedId(latest.analysis_id);
              setReload((value) => value + 1);
              setNotice('New Draft generated. Review it before approval.');
            }
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted && epoch === jobRequestEpoch.current) setJobError(cause instanceof Error ? cause.message : 'Generation status could not be loaded.');
        });
    }, 2500);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [job, jobActive, jobReady, jobError, scope.campaignId, scope.type, scope.type === 'employee' ? scope.employeeId : scope.type === 'group' ? scope.groupId : scope.type === 'role' ? scope.roleId : null]);

  const selected = history?.versions.find((version) => version.id === selectedId) ?? history?.versions[0] ?? null;
  async function perform(kind: 'save' | 'approve', task: () => Promise<AnalysisVersion>) {
    if (actionPending.current) return;
    actionPending.current = true;
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(kind);
    setError('');
    setNotice('');
    try {
      const result = await task();
      if (controller.signal.aborted) return;
      setEditing(null);
      setSelectedId(result.id);
      setHistory((current) => current && { ...current,
        versions: [result, ...current.versions.filter((version) => version.id !== result.id).map((version) => kind === 'approve' && version.is_current_approved ? { ...version, is_current_approved: false } : version)].sort((a, b) => b.version - a.version),
      });
      setNotice(kind === 'approve' ? 'Analysis approved.' : 'Edited Draft saved as a new version.');
      setReload((value) => value + 1);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Analysis request failed.');
    } finally {
      actionPending.current = false;
      if (actionController.current === controller) actionController.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  async function startGeneration() {
    if (actionPending.current || !jobReady || jobError || jobActive) return;
    actionPending.current = true;
    jobRequestEpoch.current += 1;
    const controller = new AbortController();
    actionController.current = controller;
    setBusy('generate');
    setError('');
    setNotice('');
    try {
      const started = await generateAIAnalysis(getAccessToken, scope, controller.signal);
      if (controller.signal.aborted) return;
      acceptedJobId.current = started.id;
      setJobReady(true);
      setJobError('');
      setJob(started);
      if (started.status === 'succeeded') {
        if (started.analysis_id === null) setJobError('Completed generation has no analysis. Please check its status again.');
        else {
          handledSuccessJobId.current = started.id;
          if (!editingRef.current) setSelectedId(started.analysis_id);
          setReload((value) => value + 1);
          setNotice('New Draft generated. Review it before approval.');
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setJobReady(false);
        setJobError(cause instanceof Error ? cause.message : 'Generation request failed.');
        setJobReload((value) => value + 1);
      }
    } finally {
      actionPending.current = false;
      if (actionController.current === controller) actionController.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  function updateFinding(section: keyof AIAnalysis, index: number | null, next: AnalysisFinding) {
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
    if (firstEvidence) setEditing((current) => {
      if (!current) return current;
      const source = current.overall_assessment;
      const next = source.fact_ids != null
        ? { ...blankFinding(firstEvidence), fact_ids: [...source.fact_ids], supporting_evidence_ids: [...source.supporting_evidence_ids] }
        : blankFinding(firstEvidence);
      return { ...current, [section]: [...current[section], next] };
    });
  }

  const mayWrite = history?.can_manage && !selected?.outdated;
  const copy = scopeCopy[scope.type];
  return <section className="reports-card reports-ai-panel" aria-label={copy.heading}>
    <div className="reports-section-heading"><h2>{copy.heading}</h2>{scope.type !== 'employee' && history?.scope_label && <strong>{history.scope_label}</strong>}<p>{copy.description}</p></div>
    {!history && !error && <p className="reports-state">Loading saved analyses...</p>}
    {error && <div className="reports-state reports-error" role="alert">{error}<button type="button" className="btn btn-secondary btn-small" onClick={() => setReload((value) => value + 1)}>Retry</button></div>}
    {notice && <p className="reports-ai-notice" role="status">{notice}</p>}
    {jobError && <div className="reports-state reports-error" role="alert">Generation status could not be checked: {jobError}<button type="button" className="btn btn-secondary btn-small" onClick={() => setJobReload((value) => value + 1)}>Retry status check</button></div>}
    {jobReady && !jobError && jobActive && <p className="reports-ai-notice" role="status">AI analysis {job?.status === 'queued' ? 'queued' : 'running'}. You can leave this page; generation will continue.</p>}
    {jobReady && !jobError && job?.status === 'failed' && <p className="reports-state reports-error" role="alert">{generationErrorMessage(job.error_code)} Use Retry generation to start a new attempt.</p>}
    {history && <>
      <div className="reports-ai-toolbar">
        {history.versions.length > 0 && <label>Analysis version<select className="form-control" value={selected?.id ?? ''} onChange={(event) => { setEditing(null); setSelectedId(Number(event.target.value)); setNotice(''); }}>
          {history.versions.map((version) => <option key={version.id} value={version.id}>Version {version.version} · {version.status === 'draft' ? 'Draft' : 'Approved'}{version.is_current_approved ? ' · Current approved' : ''}{version.outdated ? ' · Outdated' : ''}</option>)}
        </select></label>}
         {history.can_manage && <button type="button" className="btn btn-primary" disabled={busy !== null || editing !== null || !jobReady || !!jobError || jobActive || !history.has_eligible_evidence} onClick={() => {
           if (history.versions.length > 0 && !window.confirm('Regenerate? This may incur API cost. A new Draft will be created; earlier versions remain available.')) return;
           void startGeneration();
         }}>{busy === 'generate' ? 'Starting generation...' : jobActive ? 'Generation in progress...' : job?.status === 'failed' ? 'Retry generation' : history.versions.length ? 'Regenerate Analysis' : 'Generate Analysis'}</button>}
      </div>
      {!history.has_eligible_evidence && <p className="reports-ai-warning">No reportable submitted evidence is available. Insufficient data is not an indication of low performance.</p>}
       {!selected && <p className="reports-ai-intro">{copy.intro} AI conclusions are not shown until explicitly generated, reviewed and approved by an authorized manager.</p>}
      {selected && <>
        {selected.outdated && <p className="reports-ai-warning" role="alert">Outdated analysis: submitted evaluation data has changed. This version remains historical; regenerate before editing or approval.</p>}
        <div className="reports-ai-meta"><span>{selected.status === 'approved' ? 'Approved' : 'Draft'}{selected.is_current_approved ? ' · Current approved' : ''}</span><span>Generated {dateLabel(selected.generated_at)} by user #{selected.generated_by_user_id} · {selected.model_identifier}</span>{selected.edited_at && <span>Edited {dateLabel(selected.edited_at)} by user #{selected.edited_by_user_id}</span>}{selected.approved_at && <span>Approved {dateLabel(selected.approved_at)} by user #{selected.approved_by_user_id}</span>}</div>
        <div className="reports-ai-sections">
            <div><h3>Overall Assessment</h3><FindingCard key={selected.id} finding={editing?.overall_assessment ?? selected.analysis.overall_assessment} evidence={selected.evidence} employeeScope={scope.type === 'employee'} edit={editing !== null} onChange={(next) => updateFinding('overall_assessment', null, next)} /></div>
          {(['strengths', 'development_areas'] as const).map((section) => <div key={section}><h3>{section === 'strengths' ? 'Strengths' : 'Development Areas'}</h3>
            {(editing?.[section] ?? selected.analysis[section]).length === 0 && <p>No evidence-backed findings in this section.</p>}
              {(editing?.[section] ?? selected.analysis[section]).map((finding, index) => <FindingCard key={`${selected.id}-${section}-${index}`} finding={finding} evidence={selected.evidence} employeeScope={scope.type === 'employee'} edit={editing !== null} onChange={(next) => updateFinding(section, index, next)} onRemove={editing ? () => removeFinding(section, index) : undefined} />)}
            {editing && (editing[section].length < 5) && Object.keys(selected.evidence).length > 0 && <button type="button" className="btn btn-secondary btn-small" onClick={() => addFinding(section)}>Add finding</button>}
          </div>)}
        </div>
        {history.can_manage && <div className="reports-ai-actions">
           {editing ? <><button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => { if (editing) void perform('save', () => saveAIAnalysis(getAccessToken, scope, selected.id, editing)); }}>{busy === 'save' ? 'Saving...' : 'Save as new Draft'}</button><button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => setEditing(null)}>Cancel editing</button></>
             : selected.status === 'draft' && mayWrite && <><button type="button" className="btn btn-secondary" disabled={busy !== null || selected.id !== history.versions[0]?.id} onClick={() => setEditing(structuredClone(selected.analysis))}>Edit Draft</button><button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => { if (window.confirm('Approve this specific analysis version? Approved content becomes read-only and replaces the current approved designation.')) void perform('approve', () => approveAIAnalysis(getAccessToken, scope, selected.id)); }}>{busy === 'approve' ? 'Approving...' : 'Approve Analysis'}</button></>}
        </div>}
      </>}
    </>}
  </section>;
}

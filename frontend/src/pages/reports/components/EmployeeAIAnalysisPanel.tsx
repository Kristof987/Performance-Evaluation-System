import { useEffect, useRef, useState } from 'react';
import { Check, Info, MessageSquare, Pencil, RefreshCw, Sparkles, Target, TrendingUp, X } from 'lucide-react';
import type { AccessTokenGetter } from '../../../auth/authenticated-api';
import { approveAIAnalysis, fetchAIAnalyses, fetchGenerationJob, fetchLatestGenerationJob, generateAIAnalysis, generationErrorMessage, saveAIAnalysis } from '../api/ai-analysis.api';
import type { AIAnalysis, AIAnalysisGenerationJob, AIAnalysisHistory, AIAnalysisScope, AnalysisEvidence, AnalysisFinding, AnalysisTheme, AnalysisVersion } from '../types/ai-analysis.types';
import { useConfirm, useToast } from '../../../components/feedback/feedback-context';
import InlineMessage from '../../../components/feedback/InlineMessage';
import LoadError from '../../../components/feedback/LoadError';
import Pending from '../../../components/feedback/Pending';
import LoadingState from '../../../components/feedback/LoadingState';
import { useDates } from '../../../app/dates';

type Props = { scope: AIAnalysisScope; getAccessToken: AccessTokenGetter };

function scopeKey(scope: AIAnalysisScope) {
  switch (scope.type) {
    case 'employee': return `${scope.campaignId}:employee:${scope.employeeId}`;
    case 'group': return `${scope.campaignId}:group:${scope.groupId}`;
    case 'campaign': return `${scope.campaignId}:campaign`;
  }
}

const scopeCopy = {
  employee: { intro: 'Generate a summary of this employee’s submitted evaluations: scores, self-evaluation and colleagues’ written comments.' },
  group: { intro: 'Generate a summary of this group’s reportable results.' },
  role: { intro: 'Generate a summary of the reportable feedback received by employees in this role.' },
  campaign: { intro: 'Generate a summary of the campaign’s reportable results.' },
};

const MAX_FINDINGS = 3;

type EvidenceGroup = { key: string; entries: Array<{ id: string; item: AnalysisEvidence | undefined }> };

function groupedEvidence(ids: string[], evidence: Record<string, AnalysisEvidence>, employeeScope: boolean): EvidenceGroup[] {
  const groups = new Map<string, EvidenceGroup>();
  for (const id of ids) {
    if (evidence[id]?.comment) continue;  // Colleagues' comments are summarized as themes, never listed.
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

type Chip = { label: string; tone: 'good' | 'watch' | 'neutral' };

/** What a finding rests on, in numbers taken from the reports, not from the AI text. */
function findingChips(finding: AnalysisFinding, evidence: Record<string, AnalysisEvidence>, kind: 'strength' | 'development' | 'overall', authors: number | null | undefined): Chip[] {
  const sections = new Map<string, { peer?: number; self?: number }>();
  for (const id of finding.supporting_evidence_ids) {
    const item = evidence[id];
    if (!item || item.comment) continue;
    for (const stat of item.section_statistics) {
      if (stat.average_normalized == null) continue;
      const entry = sections.get(stat.section_name) ?? {};
      if (item.category === 'self') entry.self = stat.average_normalized; else entry.peer = stat.average_normalized;
      sections.set(stat.section_name, entry);
    }
  }
  const tone = kind === 'strength' ? 'good' : kind === 'development' ? 'watch' : 'neutral';
  // A ranking cites every section it compares; show the one at the end the finding is about.
  const peer = (value: { peer?: number; self?: number }) => value.peer ?? value.self ?? 0;
  const ordered = [...sections.entries()].sort((a, b) => kind === 'development' ? peer(a[1]) - peer(b[1]) : peer(b[1]) - peer(a[1]));
  const chips: Chip[] = ordered.slice(0, ordered.length > 2 ? 1 : 2).map(([name, value]) => ({
    tone,
    label: value.peer != null && value.self != null ? `${name} · self ${value.self.toFixed(1)} · peers ${value.peer.toFixed(1)}`
      : value.peer != null ? `${name} ${value.peer.toFixed(1)}` : `${name} (self) ${value.self!.toFixed(1)}`,
  }));
  if (finding.comment_mentions) chips.push({ tone: 'neutral', label: authors ? `${finding.comment_mentions} of ${authors} colleagues’ comments` : `${finding.comment_mentions} colleagues’ comments` });
  return chips;
}

function Chips({ chips }: { chips: Chip[] }) {
  return chips.length ? <span className="reports-ai-chips">{chips.map((chip) => <span key={chip.label} className={`reports-ai-chip is-${chip.tone}`}>{chip.label}</span>)}</span> : null;
}

function FindingEditor({ finding, onChange, onRemove }: { finding: AnalysisFinding; onChange: (next: AnalysisFinding) => void; onRemove?: () => void }) {
  return <div className="reports-ai-edit">
    <label>Title<input className="form-control" value={finding.assessment} maxLength={1200} onChange={(event) => onChange({ ...finding, assessment: event.target.value })} /></label>
    <label>Explanation<textarea className="form-control" value={finding.reasoning} maxLength={2000} onChange={(event) => onChange({ ...finding, reasoning: event.target.value })} /></label>
    {onRemove && <button type="button" className="reports-ai-link is-danger" onClick={onRemove}><X size={13} aria-hidden="true" />Remove</button>}
  </div>;
}

function FindingItem({ number, finding, evidence, kind, authors, employeeScope, edit, onChange, onRemove }: {
  number: number; finding: AnalysisFinding; evidence: Record<string, AnalysisEvidence>; kind: 'strength' | 'development';
  authors: number | null | undefined; employeeScope: boolean; edit: boolean; onChange: (next: AnalysisFinding) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = groupedEvidence(finding.supporting_evidence_ids, evidence, employeeScope);
  if (edit) return <li className="reports-ai-item"><FindingEditor finding={finding} onChange={onChange} onRemove={onRemove} /></li>;
  return <li className="reports-ai-item">
    <strong>{number}. {finding.assessment}</strong>
    <p>{finding.reasoning}</p>
    <div className="reports-ai-item-foot">
      <Chips chips={findingChips(finding, evidence, kind, authors)} />
      {groups.length > 0 && <button type="button" className="reports-ai-link" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? 'Hide details' : 'Details'}</button>}
    </div>
    {open && <div className="reports-ai-evidence-list">{groups.map((group) => <EvidenceDetail key={group.key} group={group} employeeScope={employeeScope} />)}</div>}
  </li>;
}

function FindingColumn({ kind, findings, evidence, authors, employeeScope, edit, onChange, onRemove, onAdd }: {
  kind: 'strength' | 'development'; findings: AnalysisFinding[]; evidence: Record<string, AnalysisEvidence>; authors: number | null | undefined;
  employeeScope: boolean; edit: boolean; onChange: (index: number, next: AnalysisFinding) => void; onRemove: (index: number) => void; onAdd?: () => void;
}) {
  const Icon = kind === 'strength' ? TrendingUp : Target;
  return <section className={`reports-ai-column is-${kind}`}>
    <h3><Icon size={15} aria-hidden="true" />{kind === 'strength' ? 'Strengths' : 'Development areas'}</h3>
    {findings.length === 0 ? <p className="reports-ai-empty">No finding the data supports.</p>
      : <ol>{findings.map((finding, index) => <FindingItem key={index} number={index + 1} finding={finding} evidence={evidence} kind={kind} authors={authors} employeeScope={employeeScope} edit={edit}
        onChange={(next) => onChange(index, next)} onRemove={() => onRemove(index)} />)}</ol>}
    {edit && onAdd && findings.length < MAX_FINDINGS && <button type="button" className="reports-ai-link" onClick={onAdd}>Add {kind === 'strength' ? 'strength' : 'development area'}</button>}
  </section>;
}

/** Recurring points in colleagues' comments, with how many colleagues raise them; never quotations. */
function ThemeList({ themes, authors, edit, onChange }: { themes: AnalysisTheme[]; authors: number | null | undefined; edit: boolean; onChange: (next: AnalysisTheme[]) => void }) {
  if (themes.length === 0) return null;
  return <section className="reports-ai-themes">
    <h3><MessageSquare size={15} aria-hidden="true" />Themes in colleagues’ comments{authors ? <small> · {authors} colleagues wrote comments</small> : null}</h3>
    <ul>{themes.map((theme, index) => {
      const share = authors && theme.mentions ? Math.round((theme.mentions / authors) * 100) : 0;
      return <li key={index} className={`is-${theme.tone}`}>
        {edit ? <span className="reports-ai-theme-edit"><input className="form-control" aria-label={`Theme ${index + 1}`} value={theme.label} maxLength={120} onChange={(event) => onChange(themes.map((item, position) => position === index ? { ...item, label: event.target.value } : item))} />
          <button type="button" className="reports-ai-link is-danger" aria-label={`Remove theme ${index + 1}`} onClick={() => onChange(themes.filter((_, position) => position !== index))}><X size={13} aria-hidden="true" /></button></span>
          : <span className="reports-ai-theme-label">{theme.label}</span>}
        <span className="reports-ai-theme-bar" aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
        <span className="reports-ai-theme-count">{theme.mentions ? authors ? `${theme.mentions} of ${authors}` : theme.mentions : '–'}</span>
      </li>;
    })}</ul>
  </section>;
}

function AIExplanation({ employeeScope, version }: { employeeScope: boolean; version: AnalysisVersion | null }) {
  const dates = useDates();
  return <details className="reports-ai-explainer">
    <summary><Info size={13} aria-hidden="true" />How it’s made</summary>
    <ul>
      <li><strong>What the AI receives:</strong> released scores and statistics, question and section wording{employeeScope ? ', the self-evaluation’s written answers, and colleagues’ written comments when at least two colleagues wrote one, with names replaced and without saying who wrote what' : ''}.</li>
      <li><strong>What it never receives:</strong> names or IDs of employees and evaluators, and any result hidden by the privacy thresholds.</li>
      <li><strong>How it is checked:</strong> every statement must cite the data it is based on; unsupported comparisons, rankings, trends and recommendations are rejected{employeeScope ? ', and so is any text that repeats a colleague’s words' : ''}. The numbers next to the findings come from the reports, not from the AI.</li>
      <li><strong>Human review:</strong> a generated text stays a draft until a person with approval rights approves it. It is never shown to the employee.</li>
      <li><strong>Not for employment decisions:</strong> don’t use it on its own for promotion, dismissal, pay or similar decisions.</li>
    </ul>
    {version && <p className="reports-ai-technical">Generated {dates.dateTime(version.generated_at, 'not recorded')} by user #{version.generated_by_user_id} · {version.model_identifier}{version.prompt_version ? ` · prompt ${version.prompt_version}` : ''}{version.token_usage ? ` · ${(version.token_usage.input_tokens + version.token_usage.output_tokens).toLocaleString()} tokens` : ''}{version.edited_at ? ` · edited ${dates.dateTime(version.edited_at, 'not recorded')} by user #${version.edited_by_user_id}` : ''}{version.approved_at ? ` · approved ${dates.dateTime(version.approved_at, 'not recorded')} by user #${version.approved_by_user_id}` : ''}</p>}
  </details>;
}

export default function EmployeeAIAnalysisPanel({ scope, getAccessToken }: Props) {
  return <AIAnalysisPanel key={scopeKey(scope)} scope={scope} getAccessToken={getAccessToken} />;
}

function AIAnalysisPanel({ scope, getAccessToken }: Props) {
  const dates = useDates();
  const confirm = useConfirm();
  const toast = useToast();
  const [history, setHistory] = useState<AIAnalysisHistory | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<AIAnalysis | null>(null);
  const [busy, setBusy] = useState<'generate' | 'save' | 'approve' | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
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
  }, [scope.campaignId, scope.type, scope.type === 'employee' ? scope.employeeId : scope.type === 'group' ? scope.groupId : null, reload]);

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
  }, [scope.campaignId, scope.type, scope.type === 'employee' ? scope.employeeId : scope.type === 'group' ? scope.groupId : null, jobReload]);

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
              toast.success('New draft generated. Review it before approval');
            }
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted && epoch === jobRequestEpoch.current) setJobError(cause instanceof Error ? cause.message : 'Generation status could not be loaded.');
        });
    }, 2500);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [job, jobActive, jobReady, jobError, scope.campaignId, scope.type, scope.type === 'employee' ? scope.employeeId : scope.type === 'group' ? scope.groupId : null]);

  const selected = history?.versions.find((version) => version.id === selectedId) ?? history?.versions[0] ?? null;
  async function perform(kind: 'save' | 'approve', task: () => Promise<AnalysisVersion>) {
    if (actionPending.current) return;
    actionPending.current = true;
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(kind);
    setActionError('');
    try {
      const result = await task();
      if (controller.signal.aborted) return;
      setEditing(null);
      setSelectedId(result.id);
      setHistory((current) => current && { ...current,
        versions: [result, ...current.versions.filter((version) => version.id !== result.id).map((version) => kind === 'approve' && version.is_current_approved ? { ...version, is_current_approved: false } : version)].sort((a, b) => b.version - a.version),
      });
      toast.success(kind === 'approve' ? `Version ${result.version} approved` : `Edited draft saved as version ${result.version}`);
      setReload((value) => value + 1);
    } catch (cause) {
      if (!controller.signal.aborted) setActionError(cause instanceof Error ? cause.message : (kind === 'approve' ? 'The analysis couldn’t be approved.' : 'The edited draft couldn’t be saved.'));
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
    setActionError('');
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
          toast.success('New draft generated. Review it before approval');
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

  function updateFinding(section: 'overall_assessment' | 'strengths' | 'development_areas', index: number | null, next: AnalysisFinding) {
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
    setEditing((current) => {
      if (!current) return current;
      const source = current.overall_assessment;
      const next: AnalysisFinding = { assessment: '', reasoning: '', fact_ids: [...source.fact_ids], supporting_evidence_ids: [...source.supporting_evidence_ids] };
      return { ...current, [section]: [...current[section], next] };
    });
  }

  const canGenerate = history?.can_generate ?? false;
  const canEdit = history?.can_manage ?? false;
  const canApprove = history?.can_approve ?? false;
  const aiEnabled = history?.ai_enabled ?? true;
  const mayWrite = !selected?.outdated;
  const employeeScope = scope.type === 'employee';
  const content = editing ?? selected?.analysis ?? null;
  const statusLabel = !selected ? null : selected.outdated ? 'Outdated' : selected.status === 'approved' ? (selected.is_current_approved ? 'Approved' : 'Approved · earlier version') : 'Draft · needs approval';
  const statusTone = !selected ? '' : selected.outdated ? 'is-outdated' : selected.status === 'approved' ? 'is-approved' : 'is-draft';
  const generateLabel = busy === 'generate' ? <Pending label="Starting" /> : jobActive ? 'Generating…' : job?.status === 'failed' ? 'Retry' : history?.versions.length ? 'Regenerate' : 'Generate summary';
  const generateDisabled = !history || busy !== null || editing !== null || !jobReady || !!jobError || jobActive || !history.has_eligible_evidence;
  async function regenerate() {
    if (!history) return;
    if (history.versions.length > 0 && !(await confirm({ title: 'Regenerate the summary?', message: 'This sends a new request to the AI provider and may incur API cost. A new draft is created; earlier versions stay available.', confirmLabel: 'Regenerate' }))) return;
    void startGeneration();
  }
  return <section className="reports-card reports-ai-panel" aria-label="AI summary">
    <header className="reports-ai-header">
      <div className="reports-ai-title"><Sparkles size={18} aria-hidden="true" /><h2>AI summary</h2>{!employeeScope && history?.scope_label && <span className="reports-ai-scope">{history.scope_label}</span>}{statusLabel && <span className={`reports-ai-status ${statusTone}`}>{statusLabel}</span>}</div>
      {history && selected && (canEdit || canApprove) && <div className="reports-ai-header-actions">
        {editing ? <>
          <button type="button" className="btn btn-secondary btn-small" disabled={busy !== null} onClick={async () => {
            if (JSON.stringify(editing) !== JSON.stringify(selected.analysis) && !(await confirm({ title: 'Discard your edits?', message: 'Your changes to this draft haven’t been saved.', confirmLabel: 'Discard edits', tone: 'danger' }))) return;
            setEditing(null);
          }}>Cancel</button>
          <button type="button" className="btn btn-primary btn-small" disabled={busy !== null} onClick={() => { void perform('save', () => saveAIAnalysis(getAccessToken, scope, selected.id, editing)); }}>{busy === 'save' ? <Pending label="Saving" /> : 'Save as new draft'}</button>
        </> : selected.status === 'draft' && mayWrite && <>
          {canEdit && <button type="button" className="btn btn-secondary btn-small" disabled={busy !== null || selected.id !== history.versions[0]?.id} onClick={() => setEditing(structuredClone(selected.analysis))}><Pencil size={13} aria-hidden="true" />Edit</button>}
          {canApprove && <button type="button" className="btn btn-primary btn-small" disabled={busy !== null} onClick={async () => { if (await confirm({ title: `Approve version ${selected.version}?`, message: 'Approved content becomes read-only and replaces the currently approved version.', confirmLabel: 'Approve' })) void perform('approve', () => approveAIAnalysis(getAccessToken, scope, selected.id)); }}>{busy === 'approve' ? <Pending label="Approving" /> : <><Check size={13} aria-hidden="true" />Approve</>}</button>}
        </>}
      </div>}
    </header>
    {!history && !error && <LoadingState variant="section" label="Loading saved summaries" />}
    {error && <LoadError message={error} onRetry={() => setReload((value) => value + 1)} />}
    {actionError && <InlineMessage tone="error" onDismiss={() => setActionError('')}>{actionError}</InlineMessage>}
    {jobError && <LoadError message={`Couldn’t confirm the generation status: ${jobError}`} retryLabel="Check status again" onRetry={() => setJobReload((value) => value + 1)} />}
    {jobReady && !jobError && jobActive && <InlineMessage tone="info">The AI summary is {job?.status === 'queued' ? 'queued' : 'being written'}. You can leave this page; it continues in the background.</InlineMessage>}
    {jobReady && !jobError && job?.status === 'failed' && <InlineMessage tone="error">{generationErrorMessage(job.error_code)}</InlineMessage>}
    {history && !aiEnabled && <InlineMessage tone="info">AI features are turned off in workspace settings. Saved summaries stay available to read.</InlineMessage>}
    {history && !history.has_eligible_evidence && <InlineMessage tone="info">No reportable submitted evaluations yet. Too little data says nothing about performance.</InlineMessage>}
    {history && !selected && <div className="reports-ai-start"><p>{scopeCopy[scope.type].intro} It stays a draft until someone with approval rights reviews it.</p>{canGenerate && <button type="button" className="btn btn-primary" disabled={generateDisabled} onClick={() => void regenerate()}><Sparkles size={14} aria-hidden="true" />{generateLabel}</button>}</div>}
    {selected && content && <>
      {selected.status === 'draft' && !selected.outdated && <p className="reports-ai-note">AI-generated draft. Check it before approving; don’t share it until it’s approved.</p>}
      {selected.outdated && <InlineMessage tone="warning">Submitted evaluations changed after this summary was written. Regenerate it before editing or approving.</InlineMessage>}
      <div className="reports-ai-summary">
        {editing ? <FindingEditor finding={editing.overall_assessment} onChange={(next) => updateFinding('overall_assessment', null, next)} />
          : <><strong>{content.overall_assessment.assessment}</strong><p>{content.overall_assessment.reasoning}</p></>}
      </div>
      <div className="reports-ai-columns">
        {(['strengths', 'development_areas'] as const).map((section) => <FindingColumn key={section} kind={section === 'strengths' ? 'strength' : 'development'} findings={content[section]} evidence={selected.evidence}
          authors={content.comment_authors} employeeScope={employeeScope} edit={editing !== null}
          onChange={(index, next) => updateFinding(section, index, next)} onRemove={(index) => removeFinding(section, index)}
          onAdd={Object.keys(selected.evidence).length > 0 ? () => addFinding(section) : undefined} />)}
      </div>
      <ThemeList themes={content.themes ?? []} authors={content.comment_authors} edit={editing !== null} onChange={(themes) => setEditing((current) => current && { ...current, themes })} />
      <footer className="reports-ai-footer">
        <span>Version {selected.version} of {history?.versions[0]?.version ?? selected.version} · {selected.edited_at ? 'edited' : 'generated'} {dates.dateTime(selected.edited_at ?? selected.generated_at, 'not recorded')}</span>
        <span className="reports-ai-footer-actions">
          {history && history.versions.length > 1 && <label className="reports-ai-versions"><span>Versions</span><select value={selected.id} disabled={editing !== null} onChange={(event) => { setEditing(null); setSelectedId(Number(event.target.value)); setActionError(''); }}>
            {history.versions.map((version) => <option key={version.id} value={version.id}>Version {version.version} · {version.status === 'draft' ? 'draft' : 'approved'}{version.is_current_approved ? ' (current)' : ''}{version.outdated ? ' · outdated' : ''}</option>)}
          </select></label>}
          {canGenerate && <button type="button" className="reports-ai-link" disabled={generateDisabled} onClick={() => void regenerate()}><RefreshCw size={13} aria-hidden="true" />{generateLabel}</button>}
        </span>
      </footer>
    </>}
    <AIExplanation employeeScope={employeeScope} version={selected} />
  </section>;
}

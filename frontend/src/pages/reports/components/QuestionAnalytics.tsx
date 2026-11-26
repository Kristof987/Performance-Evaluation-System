import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { fetchReportQuestions } from '../api/reports.api';
import type { ReportQuestion, ReportQuestions } from '../types/reports.types';
import type { AccessTokenGetter } from '../../../auth/authenticated-api';
import { useAppAuth } from '../../../auth/AppAuth';
import WrittenFeedbackList from './WrittenFeedbackList';
import LoadError from '../../../components/feedback/LoadError';
import LoadingState from '../../../components/feedback/LoadingState';

function EmployeeDistribution({ result, label }: { result: ReportQuestion; label: 'Peer' | 'Self' }) {
  const buckets = result.distribution ?? [];
  if (result.category === 'rating' && buckets.length > 5) {
    return <div className="reports-issued-rating-chart" aria-label={`${label} responses on issued scale ${result.scale_min} to ${result.scale_max}`}>
      <div className="reports-issued-rating-axis" aria-hidden="true">{[100, 75, 50, 25, 0].map((tick) => <span key={tick}>{tick}%</span>)}</div>
      <div className="reports-issued-rating-scroll"><div className="reports-issued-rating-plot" role="list" aria-label={`${label} rating distribution`} style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`, minWidth: buckets.length > 15 ? `${buckets.length * 24}px` : undefined }}>
        {buckets.map((bucket, index) => { const percentage = Math.min(100, Math.max(0, bucket.percentage)); return <div className={`reports-issued-rating-column is-${label.toLowerCase()}`} role="listitem" aria-label={`Rating ${bucket.label}: ${bucket.count} responses, ${bucket.percentage}%`} title={`${bucket.label}: ${bucket.count} responses (${bucket.percentage}%)`} key={`${index}-${bucket.label}`}><span className="reports-issued-rating-count" style={{ bottom: `calc(${percentage}% + 3px)` }}>{bucket.count}</span><span className="reports-issued-rating-bar" style={{ height: `${percentage}%` }} /><span className="reports-issued-rating-label" aria-hidden="true">{bucket.label}</span></div>; })}
      </div></div>
    </div>;
  }
  return <div className="reports-question-options">{buckets.map((bucket, index) => <div className="reports-question-option-row" key={`${index}-${bucket.label}`} title={`${bucket.label}: ${bucket.count} responses (${bucket.percentage}%)`}><span>{bucket.label}</span><div className="reports-bar-track" aria-hidden="true"><span style={{ width: `${bucket.percentage}%` }} /></div><strong>{bucket.percentage}% <small>({bucket.count})</small></strong></div>)}</div>;
}

type AnalyticsProps = {
  campaignId: number;
  getAccessToken: AccessTokenGetter | undefined;
  employeeId: number;
  feedbackStatus?: 'review' | 'closed' | 'draft' | 'scheduled' | 'active' | 'paused';
  /** Opens and scrolls to one section; a new request value repeats it for the same section. */
  focusSection?: { id: number; request: number } | null;
};

export default function QuestionAnalytics(props: AnalyticsProps) {
  return <EmployeeQuestions {...props} />;
}

function EmployeeQuestions({ campaignId, getAccessToken, employeeId, feedbackStatus, focusSection }: AnalyticsProps) {
  const { state } = useAppAuth();
  const feedbackAuthorized = state.status === 'authenticated' && state.user.permissions.includes('reports.read') && state.user.permissions.includes('campaigns.manage') && !!feedbackStatus && !!getAccessToken;
  const [reports, setReports] = useState<{ peer: ReportQuestions; self: ReportQuestions } | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState<'all' | 'peer' | 'self'>('all');
  const [search, setSearch] = useState('');
  const [openSections, setOpenSections] = useState<string[] | null>(null);
  const [openQuestions, setOpenQuestions] = useState<string[]>([]);
  const [handledFocus, setHandledFocus] = useState(focusSection?.request ?? 0);
  // A section picked in the charts opens here; adjusting state while rendering avoids a second pass through an effect.
  if (focusSection && focusSection.request !== handledFocus) {
    setHandledFocus(focusSection.request);
    setSearch('');
    setOpenSections((current) => { const active = current ?? []; return active.includes(String(focusSection.id)) ? active : [...active, String(focusSection.id)]; });
  }
  useEffect(() => {
    if (!focusSection) return undefined;
    const timer = window.setTimeout(() => document.getElementById(`employee-question-section-${focusSection.id}`)?.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    return () => window.clearTimeout(timer);
  }, [focusSection]);

  useEffect(() => {
    if (!getAccessToken) return undefined;
    const controller = new AbortController();
    setReports(null);
    setError('');
    setOpenSections(null);
    setOpenQuestions([]);
    Promise.all([
      fetchReportQuestions(getAccessToken, campaignId, employeeId, 'peer', controller.signal),
      fetchReportQuestions(getAccessToken, campaignId, employeeId, 'self', controller.signal),
    ]).then(([peer, self]) => { if (!controller.signal.aborted) setReports({ peer, self }); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Question analytics could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, employeeId, getAccessToken, reload]);

  const peer = new Map<string, ReportQuestion>(reports?.peer.questions.map((question): [string, ReportQuestion] => [question.key, question]) ?? []);
  const self = new Map<string, ReportQuestion>(reports?.self.questions.map((question): [string, ReportQuestion] => [question.key, question]) ?? []);
  const issued = new Map<string, ReportQuestion>();
  if (mode !== 'self') for (const question of peer.values()) issued.set(question.key, question);
  if (mode !== 'peer') for (const question of self.values()) if (!issued.has(question.key)) issued.set(question.key, question);
  const term = search.trim().toLowerCase();
  const sections = new Map<string, { name: string; questions: ReportQuestion[] }>();
  for (const question of issued.values()) {
    if (term && !`${question.text} ${question.type} ${question.section_name} ${question.category}`.toLowerCase().includes(term)) continue;
    const id = question.section_id === null ? 'other' : String(question.section_id);
    if (!sections.has(id)) sections.set(id, { name: question.section_name, questions: [] });
    sections.get(id)!.questions.push(question);
  }
  const firstSectionId = sections.keys().next().value;

  function metric(result: ReportQuestion | undefined, label: string) {
    if (!result) return null;
    return <span className="reports-question-metric"><b>{label} ·</b>{result.availability === 'suppressed' ? <span className="reports-question-restricted">Restricted</span>
      : result.availability === 'no_data' ? <span className="reports-question-muted">{result.category === 'text' ? 'No written responses yet' : 'No valid responses'}</span>
        : result.category === 'rating' && result.average_normalized !== null ? <><strong>{result.average_normalized.toFixed(2)} / 5</strong><small>· {result.response_count} responses</small></>
          : <span>{result.response_count} {result.category === 'text' ? 'text responses' : 'responses'}</span>}</span>;
  }

  return <section className="reports-card reports-wide-card reports-questions reports-question-list reports-employee-questions">
    <div className="reports-section-heading"><h2>Question analytics</h2><p>Issued questions for this employee. Rating averages are normalized to 1–5; submitted written answers can be opened below Text questions.</p></div>
    <div className="reports-segmented reports-question-modes" role="group" aria-label="Evaluation type">
      {(['all', 'peer', 'self'] as const).map((value) => <button key={value} type="button" className={mode === value ? 'active' : ''} aria-pressed={mode === value} onClick={() => { setMode(value); setOpenSections(null); setOpenQuestions([]); }}>{value === 'all' ? 'All' : value === 'peer' ? 'Peer' : 'Self'}</button>)}
    </div>
    {error ? <LoadError message={error} onRetry={() => setReload((value) => value + 1)} />
      : !reports || reports.peer.evaluation_type !== 'peer' || reports.self.evaluation_type !== 'self' ? <LoadingState variant="section" label="Loading question analytics" />
        : issued.size === 0 ? <p className="reports-question-status">No {mode === 'all' ? '' : `${mode} `}questions were issued for this employee.</p>
          : <><div className="reports-question-filters"><label>Search questions<input className="form-control" type="search" value={search} placeholder="Search text, type, section or category" onChange={(event) => { setSearch(event.target.value); setOpenQuestions([]); setOpenSections((current) => current?.filter((id) => !id.startsWith('closed:')) ?? null); }} /></label></div>
            {sections.size === 0 ? <p className="reports-question-status">No questions match your search.</p> : Array.from(sections, ([id, section]) => {
              const sectionKey = term ? `closed:${id}` : id;
              const sectionOpen = term ? !openSections?.includes(sectionKey) : (openSections ?? (firstSectionId === undefined ? [] : [firstSectionId])).includes(sectionKey);
              const sectionPanel = `employee-question-section-${id}`;
              return <div key={id} className="reports-question-section">
                <h3><button className="reports-question-toggle" type="button" aria-expanded={sectionOpen} aria-controls={sectionPanel} onClick={() => setOpenSections((current) => { const active = current ?? (firstSectionId === undefined ? [] : [firstSectionId]); return active.includes(sectionKey) ? active.filter((item) => item !== sectionKey) : [...active, sectionKey]; })}>{section.name} <small>{section.questions.length} {section.questions.length === 1 ? 'question' : 'questions'}</small><ChevronDown size={14} className={sectionOpen ? 'is-open' : ''} /></button></h3>
                {sectionOpen && <div id={sectionPanel} className="reports-question-items">{section.questions.map((question) => {
                  const peerResult = mode === 'self' ? undefined : peer.get(question.key);
                  const selfResult = mode === 'peer' ? undefined : self.get(question.key);
                  const results = ([['Peer', peerResult], ['Self', selfResult]] as const).filter((entry) => entry[1]?.availability === 'available' && !!entry[1]?.distribution?.length);
                  const peerText = question.category === 'text' && feedbackAuthorized && peerResult?.availability === 'available' && (peerResult.response_count ?? 0) > 0;
                  const selfText = question.category === 'text' && feedbackAuthorized && selfResult?.availability === 'available' && (selfResult.response_count ?? 0) > 0;
                  const canExpand = question.category === 'text' ? peerText || selfText : results.length > 0;
                  const expanded = openQuestions.includes(question.key);
                  const panelId = `employee-question-panel-${question.key}`;
                  const toggle = () => setOpenQuestions((current) => expanded ? current.filter((key) => key !== question.key) : [...current, question.key]);
                  return <article key={question.key} className={`reports-question-item${expanded ? ' is-highlighted' : ''}`}>
                    <div className="reports-question-summary"><div className="reports-question-identity">{canExpand ? <button className="reports-question-toggle" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={toggle} title={question.text}>{question.text}</button> : <strong title={question.text}>{question.text}</strong>}<small>{question.type}</small></div><div className="reports-question-values">{metric(peerResult, 'Peer')}{metric(selfResult, 'Self')}</div><div className="reports-question-action">{canExpand && <button className="reports-question-expand" type="button" aria-label={`${expanded ? 'Hide' : 'Show'} ${question.category === 'text' ? 'responses' : 'results'} for ${question.text}`} aria-expanded={expanded} aria-controls={panelId} onClick={toggle}>{question.category === 'text' ? expanded ? 'Hide responses' : 'View responses' : expanded ? 'Hide' : 'Details'}<ChevronDown size={14} className={expanded ? 'is-open' : ''} /></button>}</div></div>
                    {canExpand && expanded && question.category === 'text' && getAccessToken && <div className="reports-question-panel" id={panelId}>{peerText && <WrittenFeedbackList campaignId={campaignId} employeeId={employeeId} sectionId={question.section_id} questionKey={question.key} evaluationType="peer" getAccessToken={getAccessToken} />}{selfText && <WrittenFeedbackList campaignId={campaignId} employeeId={employeeId} sectionId={question.section_id} questionKey={question.key} evaluationType="self" getAccessToken={getAccessToken} />}</div>}
                    {canExpand && expanded && question.category !== 'text' && <div className="reports-question-panel" id={panelId}><p className="reports-chart-note">{question.category === 'rating' ? `Distribution uses the issued rating scale (${question.scale_min}–${question.scale_max}); the average is normalized to 1–5.` : question.type === 'Multiple choice' ? 'Share selecting each option; respondents can choose more than one.' : 'Share of responses for each option.'}</p><div className={`reports-question-panel-grid${results.length === 1 ? ' is-single' : ''}`}>{results.map(([label, result]) => <div key={label} className={`reports-question-panel-chart is-${label.toLowerCase()}`}><h3>{label} {question.category === 'rating' ? 'ratings' : 'answers'} <span>{result!.response_count} responses</span></h3><EmployeeDistribution result={result!} label={label} /></div>)}</div></div>}
                  </article>;
                })}</div>}
              </div>;
            })}</>}
  </section>;
}

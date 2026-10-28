import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { fetchReportQuestions } from '../api/reports.api';
import type { QuestionResult, ReportQuestion, ReportQuestions, RolePerspective } from '../types/reports.types';
import type { AccessTokenGetter } from '../../../auth/authenticated-api';

function Distribution({ question, result, label }: { question: ReportQuestion; result: QuestionResult; label: string }) {
  if (result.availability === 'suppressed') return <p className="reports-question-status">{label} results are hidden for confidentiality. Counts and values are withheld.</p>;
  if (result.availability === 'no_data') return <p className="reports-question-status">No valid submitted {label.toLowerCase()} responses are available.</p>;
  return <div className="reports-question-result">
    <div className="reports-question-summary"><strong>{result.response_count} {result.response_count === 1 ? 'response' : 'responses'}</strong>
      {question.category === 'rating' && <span>Average normalized rating: <strong>{result.average_normalized?.toFixed(2)} / 5</strong></span>}
    </div>
    {question.category === 'text' ? <p>Written answers are retained for future analysis and are not displayed in Reports.</p> : <>
      {question.category === 'rating' && <p>Exact issued ratings ({question.scale_min}–{question.scale_max}); normalized average is a separate measure.</p>}
      {question.type === 'Multiple choice' && <p>Option percentages use respondents as the denominator; totals may exceed 100%.</p>}
      <div className="reports-question-bars" role="list" aria-label={`${label} distribution`}>{result.distribution?.map((bucket, index) => <div className="reports-question-bar" role="listitem" key={`${index}-${bucket.label}`}>
        <span className="reports-question-option" title={bucket.label}>{bucket.label}</span>
        <div className="reports-bar-track" aria-hidden="true"><span style={{ width: `${bucket.percentage}%` }} /></div>
        <strong>{bucket.count} <small>({bucket.percentage}%)</small></strong>
      </div>)}</div>
    </>}
  </div>;
}

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
  scope?: { group_id?: number; role_id?: number; employee_id?: number; perspective?: RolePerspective };
};

export default function QuestionAnalytics(props: AnalyticsProps) {
  if (props.scope?.employee_id !== undefined) return <EmployeeQuestions campaignId={props.campaignId} getAccessToken={props.getAccessToken} employeeId={props.scope.employee_id} />;
  return <StandardQuestions {...props} />;
}

function EmployeeQuestions({ campaignId, getAccessToken, employeeId }: { campaignId: number; getAccessToken: AccessTokenGetter | undefined; employeeId: number }) {
  const [reports, setReports] = useState<{ peer: ReportQuestions; self: ReportQuestions } | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState<'all' | 'peer' | 'self'>('all');
  const [search, setSearch] = useState('');
  const [openSections, setOpenSections] = useState<string[] | null>(null);
  const [openQuestions, setOpenQuestions] = useState<string[]>([]);

  useEffect(() => {
    if (!getAccessToken) return undefined;
    const controller = new AbortController();
    setReports(null);
    setError('');
    setOpenSections(null);
    setOpenQuestions([]);
    Promise.all([
      fetchReportQuestions(getAccessToken, campaignId, { employee_id: employeeId }, 'peer', controller.signal),
      fetchReportQuestions(getAccessToken, campaignId, { employee_id: employeeId }, 'self', controller.signal),
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
      : result.availability === 'no_data' ? <span className="reports-question-muted">No valid responses</span>
        : result.category === 'rating' && result.average_normalized !== null ? <><strong>{result.average_normalized.toFixed(2)} / 5</strong><small>· {result.response_count} responses</small></>
          : <span>{result.response_count} {result.category === 'text' ? 'text responses' : 'responses'}</span>}</span>;
  }

  return <section className="reports-card reports-wide-card reports-questions reports-question-list reports-employee-questions">
    <div className="reports-section-heading"><h2>Question analytics</h2><p>Issued questions for this employee. Rating averages are normalized to 1–5; written answers are not shown.</p></div>
    <div className="reports-segmented reports-question-modes" role="group" aria-label="Evaluation type">
      {(['all', 'peer', 'self'] as const).map((value) => <button key={value} type="button" className={mode === value ? 'active' : ''} aria-pressed={mode === value} onClick={() => { setMode(value); setOpenSections(null); setOpenQuestions([]); }}>{value === 'all' ? 'All' : value === 'peer' ? 'Peer' : 'Self'}</button>)}
    </div>
    {error ? <div className="reports-state reports-error" role="alert"><span>{error}</span><button className="btn btn-secondary" type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></div>
      : !reports || reports.peer.evaluation_type !== 'peer' || reports.self.evaluation_type !== 'self' ? <p className="reports-question-status">Loading question analytics...</p>
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
                  const canExpand = question.category !== 'text' && results.length > 0;
                  const expanded = openQuestions.includes(question.key);
                  const panelId = `employee-question-panel-${question.key}`;
                  const toggle = () => setOpenQuestions((current) => expanded ? current.filter((key) => key !== question.key) : [...current, question.key]);
                  return <article key={question.key} className={`reports-question-item${expanded ? ' is-highlighted' : ''}`}>
                    <div className="reports-question-summary"><div className="reports-question-identity">{canExpand ? <button className="reports-question-toggle" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={toggle} title={question.text}>{question.text}</button> : <strong title={question.text}>{question.text}</strong>}<small>{question.type}</small></div><div className="reports-question-values">{metric(peerResult, 'Peer')}{metric(selfResult, 'Self')}</div><div className="reports-question-action">{canExpand && <button className="reports-question-expand" type="button" aria-label={`${expanded ? 'Hide' : 'Show'} results for ${question.text}`} aria-expanded={expanded} aria-controls={panelId} onClick={toggle}>{expanded ? 'Hide' : 'Details'}<ChevronDown size={14} className={expanded ? 'is-open' : ''} /></button>}</div></div>
                    {canExpand && expanded && <div className="reports-question-panel" id={panelId}><p className="reports-chart-note">{question.category === 'rating' ? `Distribution uses the issued rating scale (${question.scale_min}–${question.scale_max}); the average is normalized to 1–5.` : question.type === 'Multiple choice' ? 'Share selecting each option; respondents can choose more than one.' : 'Share of responses for each option.'}</p><div className={`reports-question-panel-grid${results.length === 1 ? ' is-single' : ''}`}>{results.map(([label, result]) => <div key={label} className={`reports-question-panel-chart is-${label.toLowerCase()}`}><h3>{label} {question.category === 'rating' ? 'ratings' : 'answers'} <span>{result!.response_count} responses</span></h3><EmployeeDistribution result={result!} label={label} /></div>)}</div></div>}
                  </article>;
                })}</div>}
              </div>;
            })}</>}
  </section>;
}

function StandardQuestions({ campaignId, getAccessToken, scope = {} }: AnalyticsProps) {
  const [evaluationType, setEvaluationType] = useState<'peer' | 'self'>('peer');
  const [section, setSection] = useState('all');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ReportQuestions | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const groupId = scope.group_id;
  const roleId = scope.role_id;
  const employeeId = scope.employee_id;
  const perspective = scope.perspective;

  useEffect(() => {
    if (!getAccessToken) return undefined;
    const controller = new AbortController();
    setData(null);
    setError('');
    setSelected(null);
    fetchReportQuestions(getAccessToken, campaignId, { group_id: groupId, role_id: roleId, employee_id: employeeId, perspective }, evaluationType, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Question analytics could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, getAccessToken, groupId, roleId, employeeId, perspective, evaluationType, reload]);

  const questions = data?.evaluation_type === evaluationType ? data.questions : null;
  const sections = new Map<string, string>();
  for (const item of questions ?? []) sections.set(item.section_id === null ? 'other' : String(item.section_id), item.section_name);
  const visible = (questions ?? []).filter((item) =>
    (section === 'all' || section === (item.section_id === null ? 'other' : String(item.section_id))) &&
    `${item.text} ${item.section_name} ${item.type}`.toLowerCase().includes(search.trim().toLowerCase())
  );
  const question = visible.find((item) => item.key === selected) ?? visible[0];
  const grouped = new Map<string, ReportQuestion[]>();
  for (const item of visible) {
    const key = item.section_id === null ? 'other' : String(item.section_id);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return <section className="reports-card reports-wide-card reports-questions">
    <div className="reports-section-heading"><h2>Question analytics</h2><p>Submitted answers from issued questionnaires. Distributions count responses, not employee-balanced performance scores.</p></div>
    <div className="reports-segmented reports-question-modes" role="group" aria-label="Evaluation type">
      <button type="button" className={evaluationType === 'peer' ? 'active' : ''} aria-pressed={evaluationType === 'peer'} onClick={() => setEvaluationType('peer')}>Peer</button>
      <button type="button" className={evaluationType === 'self' ? 'active' : ''} aria-pressed={evaluationType === 'self'} onClick={() => setEvaluationType('self')}>Self</button>
    </div>
    {error ? <div className="reports-state reports-error" role="alert"><span>{error}</span><button className="btn btn-secondary" type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></div>
      : questions === null ? <p className="reports-question-status">Loading {evaluationType} question analytics...</p>
        : questions.length === 0 ? <p className="reports-question-status">No {evaluationType} questions were issued for this scope.</p>
          : <>
            <div className="reports-question-filters">
              <label>Section<select className="form-control" value={section} onChange={(event) => { setSection(event.target.value); setSelected(null); }}><option value="all">All sections</option>{Array.from(sections, ([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              <label>Search questions<input className="form-control" type="search" value={search} placeholder="Search wording or type" onChange={(event) => { setSearch(event.target.value); setSelected(null); }} /></label>
            </div>
            {visible.length === 0 ? <p className="reports-question-status">No questions match the selected Section or search.</p> : <>
              <label className="reports-question-picker">Question<select className="form-control" value={question?.key ?? ''} onChange={(event) => setSelected(event.target.value)}>{Array.from(grouped, ([id, items]) => <optgroup label={sections.get(id)} key={id}>{items.map((item) => <option value={item.key} key={item.key}>{item.type} · {item.text}</option>)}</optgroup>)}</select></label>
              {question && <div className="reports-question-detail"><span className="reports-question-eyebrow">{question.section_name} · {question.type} · {question.required_modes.length > 1 ? 'Required on some Forms' : question.required ? 'Required' : 'Optional'}</span><h3>{question.text}</h3><Distribution question={question} result={question} label={evaluationType === 'peer' ? 'Peer' : 'Self'} /></div>}
            </>}
          </>}
  </section>;
}

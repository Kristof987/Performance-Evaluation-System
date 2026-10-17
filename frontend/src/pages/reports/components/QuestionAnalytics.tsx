import { useEffect, useState } from 'react';
import { fetchReportQuestions } from '../api/reports.api';
import type { QuestionResult, ReportQuestion, ReportQuestions, RolePerspective } from '../types/reports.types';

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

export default function QuestionAnalytics({ campaignId, requesterUserId, scope = {} }: {
  campaignId: number;
  requesterUserId: number | null;
  scope?: { group_id?: number; role_id?: number; employee_id?: number; perspective?: RolePerspective };
}) {
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
    if (requesterUserId === null) return undefined;
    const controller = new AbortController();
    setData(null);
    setError('');
    setSelected(null);
    fetchReportQuestions(campaignId, requesterUserId, { group_id: groupId, role_id: roleId, employee_id: employeeId, perspective }, evaluationType, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Question analytics could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, requesterUserId, groupId, roleId, employeeId, perspective, evaluationType, reload]);

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
        : questions.length === 0 ? <p className="reports-question-status">No submitted {evaluationType} question responses are available for this scope.</p>
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

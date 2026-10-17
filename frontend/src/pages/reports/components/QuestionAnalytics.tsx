import { useEffect, useState } from 'react';
import { fetchReportQuestions } from '../api/reports.api';
import type { QuestionResult, ReportQuestion, ReportQuestions, RolePerspective } from '../types/reports.types';

function Distribution({ question, result, label }: { question: ReportQuestion; result: QuestionResult; label: string }) {
  if (result.availability === 'suppressed') return <p className="reports-question-status">{label}: hidden for confidentiality. Response counts and values are withheld.</p>;
  if (result.availability === 'no_data') return <p className="reports-question-status">{label}: no valid submitted responses available.</p>;
  return <div className="reports-question-result">
    <div className="reports-question-summary"><strong>{label}: {result.response_count} {result.response_count === 1 ? 'response' : 'responses'}</strong>
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
    fetchReportQuestions(campaignId, requesterUserId, { group_id: groupId, role_id: roleId, employee_id: employeeId, perspective }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Question analytics could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, requesterUserId, groupId, roleId, employeeId, perspective, reload]);

  const question = data?.questions.find((item) => item.key === selected) ?? data?.questions[0];
  const groups = new Map<string, { name: string; questions: ReportQuestion[] }>();
  for (const item of data?.questions ?? []) {
    const key = item.section_id === null ? 'other' : `section-${item.section_id}`;
    const group = groups.get(key) ?? { name: item.section_name, questions: [] };
    group.questions.push(item);
    groups.set(key, group);
  }

  return <section className="reports-card reports-wide-card reports-questions">
    <div className="reports-section-heading"><h2>Question analytics</h2><p>Valid submitted answers from issued questionnaires. Frequencies count responses, not employee-balanced performance scores.</p></div>
    {error ? <div className="reports-state reports-error" role="alert"><span>{error}</span><button className="btn btn-secondary" type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></div>
      : !data ? <p className="reports-question-status">Loading question analytics...</p>
        : !question ? <p className="reports-question-status">No questions in submitted issued questionnaires for this scope.</p>
          : <div className="reports-question-layout"><nav className="reports-question-nav" aria-label="Questions by section">{Array.from(groups, ([key, group]) => <div className="reports-question-group" key={key}><h3>{group.name}</h3>{group.questions.map((item) => <button type="button" key={item.key} className={question.key === item.key ? 'active' : ''} onClick={() => setSelected(item.key)} title={item.text}>{item.text}</button>)}</div>)}</nav>
            <div className="reports-question-detail"><span className="reports-question-eyebrow">{question.section_name} · {question.type} · {question.required_modes.length > 1 ? 'Required on some Forms' : question.required ? 'Required' : 'Optional'}</span><h3>{question.text}</h3>
              {employeeId !== undefined ? <><Distribution question={question} result={question.peer!} label="Peer" /><Distribution question={question} result={question.self!} label="Self" /></>
                : <Distribution question={question} result={question} label={perspective === 'evaluator' ? 'Peer feedback given' : 'Peer feedback received'} />}
            </div></div>}
  </section>;
}

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { AccessTokenGetter } from '../../auth/authenticated-api';
import { useAppAuth } from '../../auth/AppAuth';
import LoadError from '../../components/feedback/LoadError';
import LoadingState from '../../components/feedback/LoadingState';
import { fetchAnswersIndex, fetchEmployeeAnswers } from './api/reports.api';
import ReportsEmptyState from './components/ReportsEmptyState';
import ReportsLayout from './ReportsLayout';
import type { CsvValue } from './reportExport';
import { CsvButton } from './charts/DashboardCharts';
import type { AnswersIndex, AnswersIndexEmployee, EmployeeAnswers, SubmittedAnswer, SubmittedQuestionnaire } from './types/reports.types';

type Kind = 'all' | 'self' | 'peer';

export default function AllAnswersPage() {
  const { campaignId } = useParams();
  const id = Number(campaignId);
  const valid = Number.isSafeInteger(id) && id > 0;
  const { state } = useAppAuth();
  const authorized = state.status === 'authenticated' && state.user.permissions.includes('reports.read') && state.user.permissions.includes('campaigns.manage');
  return <ReportsLayout selectedCampaignId={valid ? id : null} allowWrittenFeedbackPreview>{({ getAccessToken }) => {
    if (!authorized) return <ReportsEmptyState title="Campaign management permission is required." message="All Answers shows submitted questionnaires, so it is limited to HR users who manage campaigns." />;
    return <AnswersContent key={id} campaignId={id} getAccessToken={getAccessToken} />;
  }}</ReportsLayout>;
}

function peerSummary(employee: Pick<AnswersIndexEmployee, 'peer_assigned' | 'peer_submitted'>) {
  if (!employee.peer_assigned) return 'No colleague reviews';
  return `${employee.peer_submitted} of ${employee.peer_assigned} colleagues`;
}

function AnswersContent({ campaignId, getAccessToken }: { campaignId: number; getAccessToken: AccessTokenGetter | undefined }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [index, setIndex] = useState<AnswersIndex | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const requested = Number(params.get('employee')) || null;

  useEffect(() => {
    const token = getAccessToken;
    if (!token) return undefined;
    const controller = new AbortController();
    fetchAnswersIndex(token, campaignId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setIndex(result); setError(''); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Answers could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, getAccessToken, reload]);

  const employees = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (index?.employees ?? []).filter((item) => item.employee_name.toLocaleLowerCase().includes(needle));
  }, [index, query]);

  if (error) return <LoadError message={error} onRetry={() => { setError(''); setReload((value) => value + 1); }} />;
  if (!index || index.campaign_id !== campaignId) return <LoadingState variant="page" label="Loading answers" />;
  if (!index.employees.length) return <ReportsEmptyState title="No questionnaires yet." message="Employees appear here once questionnaires are issued for this campaign." />;

  // Without a choice in the URL, open the first employee with something to read, so the page never starts blank.
  const employeeId = requested ?? (index.employees.find((item) => item.self_submitted || item.peer_submitted > 0) ?? index.employees[0]).employee_id;

  function select(id: number) {
    const next = new URLSearchParams(params);
    next.set('employee', String(id));
    navigate({ search: `?${next}` });
  }

  return <div className="reports-answers">
    <aside className="reports-card reports-answers-people" aria-label="Employees">
      <label className="reports-answers-search"><Search size={14} aria-hidden="true" /><input type="search" placeholder="Search employees" aria-label="Search employees" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {employees.length === 0 ? <p className="reports-subtle-state">No employees match your search.</p> : <ul>{employees.map((item) => <li key={item.employee_id}>
        <button type="button" className={item.employee_id === employeeId ? 'is-active' : ''} aria-current={item.employee_id === employeeId ? 'true' : undefined} onClick={() => select(item.employee_id)}>
          <strong>{item.employee_name}</strong>
          <small>{item.self_assigned ? item.self_submitted ? 'Self ✓' : 'Self pending' : 'No self-evaluation'} · {peerSummary(item)}</small>
        </button>
      </li>)}</ul>}
    </aside>
    <div className="reports-answers-main"><EmployeeAnswersView key={employeeId} campaignId={campaignId} employeeId={employeeId} getAccessToken={getAccessToken} /></div>
  </div>;
}

function answerText(answer: SubmittedAnswer) {
  if (!answer.answered) return '';
  if (answer.rating !== null) return `${answer.rating} / ${answer.scale_max}`;
  if (answer.choices.length) return answer.choices.join('; ');
  return answer.text_answer ?? '';
}

function EmployeeAnswersView({ campaignId, employeeId, getAccessToken }: { campaignId: number; employeeId: number; getAccessToken: AccessTokenGetter | undefined }) {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<EmployeeAnswers | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState<Set<number> | 'all'>('all');
  const kind: Kind = params.get('type') === 'self' ? 'self' : params.get('type') === 'peer' ? 'peer' : 'all';
  const section = params.get('section') ?? '';

  useEffect(() => {
    const token = getAccessToken;
    if (!token) return undefined;
    const controller = new AbortController();
    fetchEmployeeAnswers(token, campaignId, employeeId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setData(result); setError(''); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Submitted answers could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, employeeId, getAccessToken, reload]);

  function change(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  }

  if (error) return <LoadError message={error} onRetry={() => { setError(''); setReload((value) => value + 1); }} />;
  if (!data || data.employee.id !== employeeId) return <LoadingState label="Loading answers" />;

  const sectionNames = [...new Set(data.questionnaires.flatMap((item) => item.sections.map((part) => part.section_name)))];
  const shown = data.questionnaires
    .filter((item) => kind === 'all' || item.kind === kind)
    .map((item) => ({ ...item, sections: item.sections.filter((part) => !section || part.section_name === section) }))
    .filter((item) => item.sections.length > 0);
  const isOpen = (position: number) => open === 'all' || open.has(position);
  function toggle(position: number) {
    setOpen((current) => {
      const next = new Set(current === 'all' ? shown.map((_item, index) => index) : current);
      if (next.has(position)) next.delete(position); else next.add(position);
      return next;
    });
  }
  function csvRows() {
    const rows: CsvValue[][] = [['Employee', 'Questionnaire', 'Form', 'Section', 'Question', 'Type', 'Answer']];
    for (const item of shown) for (const part of item.sections) for (const answer of part.answers) rows.push([data!.employee.name, item.label, item.form_name, part.section_name, answer.text, answer.type, answerText(answer)]);
    return rows;
  }

  const selfLine = data.self_assigned ? data.self_submitted ? 'Self-evaluation submitted' : 'Self-evaluation not submitted yet' : 'No self-evaluation';
  const peerLine = data.peer_assigned ? `${data.peer_submitted} of ${data.peer_assigned} colleagues submitted` : 'No colleague reviews assigned';

  return <section className="reports-answers-detail" aria-label={`Answers for ${data.employee.name}`}>
    <header className="reports-answers-head">
      <div><h2>{data.employee.name}</h2><p>{selfLine} · {peerLine}</p></div>
      {shown.length > 0 && <CsvButton name={`answers-${data.employee.name}`} rows={csvRows} />}
    </header>
    <div className="reports-answers-filters">
      <div className="reports-segmented" role="group" aria-label="Questionnaire type">{([['all', 'All'], ['self', 'Self'], ['peer', 'Colleagues']] as const).map(([value, label]) => <button key={value} type="button" className={kind === value ? 'active' : ''} aria-pressed={kind === value} onClick={() => change('type', value === 'all' ? null : value)}>{label}</button>)}</div>
      {sectionNames.length > 1 && <select aria-label="Section" value={section} onChange={(event) => change('section', event.target.value || null)}><option value="">All sections</option>{sectionNames.map((name) => <option key={name} value={name}>{name}</option>)}</select>}
      {shown.length > 1 && <button type="button" className="link-button" onClick={() => setOpen(open === 'all' || open.size === shown.length ? new Set() : 'all')}>{open === 'all' || open.size === shown.length ? 'Collapse all' : 'Expand all'}</button>}
    </div>
    {kind !== 'self' && data.peer_availability === 'suppressed' && <p className="reports-section-privacy-note">Colleague answers are hidden until at least {data.min_peer_reviewers} colleagues have submitted, so a single reviewer can’t be identified.</p>}
    {shown.length === 0 ? <p className="reports-subtle-state">{data.questionnaires.length ? 'No questionnaires match these filters.' : 'No submitted questionnaires to show yet.'}</p>
      : <div className="reports-answers-list">{shown.map((item, position) => <QuestionnaireCard key={`${item.kind}-${item.label}`} item={item} expanded={isOpen(position)} onToggle={() => toggle(position)} />)}</div>}
    <p className="reports-chart-footnote">Colleague questionnaires are shown without names, roles or dates, in a fixed shuffled order. Written answers can still contain identifying details.</p>
  </section>;
}

function QuestionnaireCard({ item, expanded, onToggle }: { item: SubmittedQuestionnaire; expanded: boolean; onToggle: () => void }) {
  const answers = item.sections.flatMap((part) => part.answers);
  const answered = answers.filter((answer) => answer.answered).length;
  const panel = `answers-${item.kind}-${item.label.replace(/\s+/g, '-')}`;
  return <article className={`reports-card reports-answers-card is-${item.kind}`}>
    <button type="button" className="reports-answers-card-head" aria-expanded={expanded} aria-controls={panel} onClick={onToggle}>
      <span className="reports-answers-badge">{item.kind === 'self' ? 'Self' : 'Colleague'}</span>
      <strong>{item.label}</strong>
      <small>{item.form_name} · {answered} of {answers.length} answered</small>
      <ChevronDown size={16} className={expanded ? 'is-open' : ''} aria-hidden="true" />
    </button>
    {expanded && <div id={panel} className="reports-answers-card-body">{item.sections.map((part) => <section key={`${part.section_id}-${part.section_name}`}>
      <h3>{part.section_name}</h3>
      <dl>{part.answers.map((answer, index) => <div key={answer.question_id || index} className="reports-answers-row">
        <dt>{answer.text}{answer.required && <span className="reports-answers-required" title="Required">*</span>}</dt>
        <dd><AnswerValue answer={answer} /></dd>
      </div>)}</dl>
    </section>)}</div>}
  </article>;
}

function AnswerValue({ answer }: { answer: SubmittedAnswer }) {
  if (!answer.answered) return <span className="reports-question-muted">No answer</span>;
  if (answer.rating !== null && answer.scale_min !== null && answer.scale_max !== null) {
    const steps = Array.from({ length: answer.scale_max - answer.scale_min + 1 }, (_value, index) => answer.scale_min! + index);
    return <span className="reports-answers-rating" aria-label={`${answer.rating} out of ${answer.scale_max}`}>
      <span className="reports-answers-dots" aria-hidden="true">{steps.map((step) => <i key={step} className={step <= answer.rating! ? 'is-on' : ''} />)}</span>
      <strong>{answer.rating}</strong><small>/ {answer.scale_max}</small>
    </span>;
  }
  if (answer.choices.length) return <span className="reports-answers-choices">{answer.choices.map((choice) => <span key={choice}>{choice}</span>)}</span>;
  return <p className="reports-answers-text">{answer.text_answer}</p>;
}

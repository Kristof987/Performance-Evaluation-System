import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { fetchSectionQuestions } from '../api/reports.api';
import type { SectionQuestion, SectionQuestionCell, SectionQuestions } from '../types/reports.types';
import type { AccessTokenGetter } from '../../../auth/authenticated-api';
import LoadError from '../../../components/feedback/LoadError';
import LoadingState from '../../../components/feedback/LoadingState';
import { ChartCard, CsvButton, Delta } from './DashboardCharts';
import { csvScore } from '../reportExport';
import { ChevronDown } from 'lucide-react';
import { scoreColor, type ChartTheme } from './chartTheme';

type Order = 'form' | 'lowest' | 'change';

const ORDERS: Array<{ value: Order; label: string }> = [
  { value: 'form', label: 'Form order' },
  { value: 'lowest', label: 'Lowest first' },
  { value: 'change', label: 'Biggest drop first' },
];

const position = (score: number) => `${((score - 1) / 4) * 100}%`;
const released = (cell: SectionQuestionCell) => cell.availability === 'available' ? cell.average : null;

function cellLabel(cell: SectionQuestionCell) {
  if (cell.availability === 'suppressed') return 'Hidden';
  return cell.average === null ? '–' : cell.average.toFixed(2);
}

function sortQuestions(questions: SectionQuestion[], order: Order) {
  if (order === 'form') return questions;
  const value = (question: SectionQuestion) => {
    const average = released(question);
    if (average === null) return Number.POSITIVE_INFINITY;
    if (order === 'lowest') return average;
    return question.previous_average === null ? Number.POSITIVE_INFINITY : average - question.previous_average;
  };
  return [...questions].sort((a, b) => value(a) - value(b));
}

function ScoreTrack({ theme, question }: { theme: ChartTheme; question: SectionQuestion }) {
  const average = released(question);
  const self = released(question.self);
  if (average === null) return <span className="reports-q-track is-empty">{question.availability === 'suppressed' ? 'Hidden by the privacy threshold' : 'No ratings yet'}</span>;
  return <span className="reports-q-track" role="img" aria-label={`Peer average ${average.toFixed(2)}${self !== null ? `, self rating ${self.toFixed(2)}` : ''} on a 1–5 scale`}>
    <span className="reports-q-fill" style={{ width: position(average), background: scoreColor(theme, average) }} />
    {question.previous_average !== null && <span className="reports-q-previous" style={{ left: position(question.previous_average) }} title={`Previous campaign ${question.previous_average.toFixed(2)}`} />}
    {self !== null && <span className="reports-q-self" style={{ left: position(self) }} title={`Self rating ${self.toFixed(2)}`} />}
  </span>;
}

function Spread({ theme, question }: { theme: ChartTheme; question: SectionQuestion }) {
  if (question.availability !== 'available' || !question.distribution?.length) return <span className="reports-q-spread is-empty" />;
  if (question.distribution_kind === 'options') {
    const top = [...question.distribution].sort((a, b) => b.count - a.count)[0];
    return <span className="reports-q-choice" title={question.distribution.map((bucket) => `${bucket.label}: ${bucket.percentage}%`).join('\n')}>Most chosen: <b>{top.label}</b> ({top.percentage}%)</span>;
  }
  const minimum = question.scale_min ?? 1;
  const maximum = question.scale_max ?? 5;
  return <span className="reports-q-spread" role="img" aria-label={`Answers: ${question.distribution.map((bucket) => `${bucket.label}: ${bucket.percentage}%`).join(', ')}`}>
    {question.distribution.filter((bucket) => bucket.count > 0).map((bucket) => {
      const normalized = maximum > minimum ? 1 + (4 * (Number(bucket.label) - minimum)) / (maximum - minimum) : 3;
      return <span key={bucket.label} style={{ flexGrow: bucket.percentage, background: scoreColor(theme, normalized) }} title={`${bucket.label}: ${bucket.count} (${bucket.percentage}%)`} />;
    })}
  </span>;
}

/** Every answer option against every scope, so a low average can be traced to the group that drives it. */
function Breakdown({ theme, question, groups, colorOf }: { theme: ChartTheme; question: SectionQuestion; groups: Array<{ id: number; name: string }>; colorOf: (id: number) => string }) {
  const scopes = [
    { key: 'all', name: 'All groups', color: undefined as string | undefined, cell: question as SectionQuestionCell },
    ...groups.map((group) => ({ key: `g${group.id}`, name: group.name, color: colorOf(group.id), cell: question.groups[String(group.id)] ?? { availability: 'no_data' as const, response_count: 0, average: null } })),
    ...(question.self.availability === 'available' && question.self.distribution ? [{ key: 'self', name: 'Self ratings', color: undefined, cell: question.self }] : []),
  ];
  const labels = question.distribution?.map((bucket) => bucket.label) ?? [];
  const minimum = question.scale_min ?? 1;
  const maximum = question.scale_max ?? 5;
  const tone = (label: string) => question.distribution_kind === 'original' && maximum > minimum ? scoreColor(theme, 1 + (4 * (Number(label) - minimum)) / (maximum - minimum)) : theme.primary;
  return <div className="reports-q-breakdown" role="cell">
    <table>
      <thead><tr><th scope="col">Answer</th>{scopes.map((scope) => <th key={scope.key} scope="col" title={scope.name}>{scope.color && <i style={{ background: scope.color }} aria-hidden="true" />}{scope.name}<small>{scope.cell.availability === 'suppressed' ? 'Hidden' : `${scope.cell.response_count ?? 0} answers`}</small></th>)}</tr></thead>
      <tbody>{labels.map((label) => <tr key={label}><th scope="row">{label}</th>{scopes.map((scope) => {
        const bucket = scope.cell.distribution?.find((item) => item.label === label);
        return <td key={scope.key}>{bucket ? <span className="reports-q-bar"><span style={{ width: `${bucket.percentage}%`, background: tone(label) }} /><b>{bucket.percentage}%</b></span> : <span className="reports-muted">{scope.cell.availability === 'suppressed' ? 'Hidden' : '–'}</span>}</td>;
      })}</tr>)}</tbody>
    </table>
  </div>;
}

function questionRows(data: SectionQuestions) {
  return [
    ['Question', 'Type', 'Answers', 'Peer average', data.previous_campaign ? `Previous (${data.previous_campaign.name})` : 'Previous', 'Self average', ...data.groups.map((group) => group.name)],
    ...data.questions.map((question) => [question.text, question.type, question.availability === 'suppressed' ? 'Hidden' : question.response_count,
      question.category === 'text' ? '' : csvScore(question.average, question.availability), csvScore(question.previous_average),
      question.category === 'text' ? '' : csvScore(question.self.average, question.self.availability),
      ...data.groups.map((group) => question.category === 'text' ? '' : csvScore(question.groups[String(group.id)]?.average, question.groups[String(group.id)]?.availability))]),
  ];
}

export default function SectionQuestionList({ theme, campaignId, sectionId, groupIds, colorOf, getAccessToken }: {
  theme: ChartTheme;
  campaignId: number;
  sectionId: number;
  groupIds: number[];
  colorOf: (id: number) => string;
  getAccessToken: AccessTokenGetter | undefined;
}) {
  const [data, setData] = useState<SectionQuestions | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [order, setOrder] = useState<Order>('form');
  const [open, setOpen] = useState<string[]>([]);
  const tokenRef = useRef(getAccessToken);
  useEffect(() => { tokenRef.current = getAccessToken; });
  const groupKey = groupIds.join(',');
  const hasToken = !!getAccessToken;

  useEffect(() => {
    const token = tokenRef.current;
    if (!token) return undefined;
    const controller = new AbortController();
    setError('');
    fetchSectionQuestions(token, campaignId, sectionId, groupKey ? groupKey.split(',').map(Number) : [], controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Section questions could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, sectionId, groupKey, reloadKey, hasToken]);

  const current = data && data.section.id === sectionId && data.campaign.id === campaignId && data.groups.map((group) => group.id).join(',') === groupKey ? data : null;
  const rated = current?.questions.filter((question) => question.category !== 'text') ?? [];
  const written = current?.questions.filter((question) => question.category === 'text') ?? [];
  const hasSelf = rated.some((question) => released(question.self) !== null);
  const columns = `minmax(220px, 1.6fr) minmax(150px, 1fr) 92px${current?.groups.map(() => ' 88px').join('') ?? ''} minmax(110px, .8fr)`;

  return <ChartCard id="section-questions" className="reports-q-card" title={`Questions in ${current?.section.name ?? 'this section'}`}
    subtitle={`Peer average per question, 1–5 · click a question for its answers by group${hasSelf ? ' · ◆ = self rating' : ''}${current?.previous_campaign ? ` · | = ${current.previous_campaign.name}` : ''}`}
    actions={<span className="reports-card-actions">{current && <CsvButton name={`${current.campaign.name} ${current.section.name} questions`} rows={() => questionRows(current)} />}{rated.length > 1 && <label className="reports-q-order reports-no-print"><span>Order</span><select value={order} onChange={(event) => setOrder(event.target.value as Order)}>{ORDERS.filter((item) => item.value !== 'change' || current?.previous_campaign).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}</span>}>
    {error ? <LoadError message={error} onRetry={() => setReloadKey((value) => value + 1)} />
      : !current ? <LoadingState variant="section" label="Loading questions" />
      : <>
        {rated.length > 0 && <div className="reports-q-table" role="table" aria-label={`Questions in ${current.section.name}`}>
          <div className="reports-q-row reports-q-head" role="row" style={{ gridTemplateColumns: columns }}>
            <span role="columnheader">Question</span><span role="columnheader">All groups</span><span role="columnheader" className="reports-q-num">Average</span>
            {current.groups.map((group) => <span key={group.id} role="columnheader" className="reports-q-num" title={group.name}><i style={{ background: colorOf(group.id) }} aria-hidden="true" />{group.name}</span>)}
            <span role="columnheader">Answers</span>
          </div>
          {sortQuestions(rated, order).map((question) => {
            const average = released(question);
            const expanded = open.includes(question.key);
            return <div key={question.key} className={`reports-q-row${expanded ? ' is-open' : ''}`} role="row" style={{ gridTemplateColumns: columns }}>
              <span role="cell" className="reports-q-text"><button type="button" className="reports-q-toggle" aria-expanded={expanded} onClick={() => setOpen((keys) => expanded ? keys.filter((key) => key !== question.key) : [...keys, question.key])} title={question.text}><ChevronDown size={14} aria-hidden="true" /><span>{question.text}</span></button><small>{question.availability === 'suppressed' ? 'Hidden' : `${question.response_count ?? 0} answers`}{released(question.self) !== null && ` · self ${released(question.self)!.toFixed(2)}`}</small></span>
              <span role="cell"><ScoreTrack theme={theme} question={question} /></span>
              <span role="cell" className="reports-q-num"><b>{cellLabel(question)}</b><Delta current={average} previous={question.previous_average} label={current.previous_campaign ? `vs. ${current.previous_campaign.name}` : undefined} /></span>
              {current.groups.map((group) => {
                const cell = question.groups[String(group.id)] ?? { availability: 'no_data', response_count: 0, average: null };
                const value = released(cell);
                return <span key={group.id} role="cell" data-label={group.name} className={`reports-q-num reports-q-group${value === null ? ' is-muted' : ''}`} title={`${group.name}: ${cell.availability === 'suppressed' ? 'hidden by the privacy threshold' : value === null ? 'no ratings' : value.toFixed(2)}`}>
                  {value !== null && <i style={{ background: scoreColor(theme, value) }} aria-hidden="true" />}{cellLabel(cell)}
                </span>;
              })}
              <span role="cell" className="reports-q-answers"><Spread theme={theme} question={question} /></span>
              {expanded && <Breakdown theme={theme} question={question} groups={current.groups} colorOf={colorOf} />}
            </div>;
          })}
        </div>}
        {rated.length === 0 && <p className="reports-chart-notice">This section has no rating or choice questions.</p>}
        {written.length > 0 && <p className="reports-chart-footnote reports-q-written">{written.length === 1 ? '1 written question' : `${written.length} written questions`} ({written.reduce((total, question) => total + (question.response_count ?? 0), 0)} answers) · <Link to={`/reports/campaigns/${campaignId}/answers`}>Read in All Answers</Link></p>}
      </>}
  </ChartCard>;
}

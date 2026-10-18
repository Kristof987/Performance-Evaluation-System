import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import AppLayout from '../layout/AppLayout';
import { formatUserName } from '../layout/sidebar-user';
import { useAppAuth } from '../../auth/AppAuth';
import { ApiAccessError } from '../../auth/authenticated-api';
import { formatShortDate } from '../hr-home/utils/hrHome.utils';
import { fetchCompletionStatus, type CompletionStatusResponse } from './completionStatus.api';
import './completion-status.css';

const PAGE_SIZE = 25;

function statusClass(status: string) {
  return status.toLowerCase().replace(/\s+/g, '-');
}

function formatDateOrDash(value: string | null) {
  return value === null ? '—' : formatShortDate(value);
}

function SortButton({ label, value, sort, order, onSort }: { label: string; value: string; sort: string; order: 'asc' | 'desc'; onSort: (value: string) => void }) {
  return <button className="completion-sort" type="button" onClick={() => onSort(value)}>
    {label}{sort === value ? (order === 'asc' ? ' ↑' : ' ↓') : ''}
  </button>;
}

export default function CompletionStatus() {
  const { id } = useParams();
  const { getAccessToken, retryAuth0 } = useAppAuth();
  const campaignId = Number(id);
  const [data, setData] = useState<CompletionStatusResponse | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [questionnaireId, setQuestionnaireId] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sort, setSort] = useState('due_date');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!Number.isSafeInteger(campaignId) || campaignId <= 0 || !getAccessToken) return;
    const controller = new AbortController();
    fetchCompletionStatus(getAccessToken, campaignId, { search, status, questionnaireId, overdueOnly, sort, order, page, pageSize: PAGE_SIZE }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setData(result); setError(''); } })
      .catch((cause) => {
        if (cause instanceof ApiAccessError) retryAuth0();
        if (!controller.signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : 'Completion status could not be loaded.'); }
      });
    return () => controller.abort();
  }, [campaignId, getAccessToken, search, status, questionnaireId, overdueOnly, sort, order, page]);

  function updateSort(value: string) {
    setPage(1);
    if (sort === value) setOrder((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSort(value); setOrder('asc'); }
  }

  function resetFilters() {
    setSearch('');
    setStatus('');
    setQuestionnaireId('');
    setOverdueOnly(false);
    setPage(1);
  }

  const dateRange = data ? `${formatShortDate(data.campaign.start_date)} – ${data.campaign.end_date === null ? 'No end date' : formatShortDate(data.campaign.end_date)}` : '';
  const summary = data?.summary;
  const invalidRequest = !Number.isSafeInteger(campaignId) || campaignId <= 0;
  const loading = !invalidRequest && data === null && error === '';

  return <AppLayout activePage="hr-home" pageClassName="completion-page">
    <main className="main-content completion-main">
      <div className="completion-back-row">
        <Link className="campaign-details-link" to={`/campaigns/${campaignId}`}>← Back to campaign</Link>
      </div>

      <header className="completion-header">
        <h1>Completion status</h1>
        {data && <p className="completion-campaign-meta">{data.campaign.name} · {dateRange}</p>}
        <p>Track evaluation progress and outstanding questionnaires.</p>
      </header>

      {invalidRequest && <div className="card card-padded completion-state completion-error" role="alert">Campaign not found.</div>}
      {!invalidRequest && loading && <div className="card card-padded completion-state">Loading completion status...</div>}
      {!invalidRequest && !loading && error && <div className="card card-padded completion-state completion-error" role="alert">{error}</div>}
      {!invalidRequest && !loading && !error && data && summary && <>
        <section className="card completion-kpis" aria-label="Completion status metrics">
          <div className="completion-kpi completion-kpi-primary"><span>Completion rate</span><strong>{summary.completion_rate}%</strong><small>{summary.completed} of {summary.total_evaluations} completed</small></div>
          <div className="completion-kpi"><span>Total evaluations</span><strong>{summary.total_evaluations}</strong></div>
          <div className="completion-kpi"><span>Not started</span><strong>{summary.not_started}</strong></div>
          <div className="completion-kpi"><span>In progress</span><strong>{summary.in_progress}</strong></div>
          <div className="completion-kpi"><span>Completed</span><strong>{summary.completed}</strong></div>
          <div className="completion-kpi"><span>Overdue</span><strong className={summary.overdue > 0 ? 'danger' : ''}>{summary.overdue}</strong></div>
        </section>

        {data.duplicate_assignment_count > 0 && <div className="card card-padded completion-warning" role="status">{data.duplicate_assignment_count} duplicate assignment group detected. Rows are kept separate by FilledForm id.</div>}

        <section className="card completion-table-card">
          <div className="completion-toolbar">
            <input className="form-control completion-search" value={search} placeholder="Search evaluator or evaluatee" onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            <select className="form-control" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Status filter">
              <option value="">All statuses</option><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="completed">Completed</option>
            </select>
            <select className="form-control" value={questionnaireId} onChange={(event) => { setQuestionnaireId(event.target.value); setPage(1); }} aria-label="Questionnaire filter">
              <option value="">All questionnaires</option>{data.questionnaires.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <label className="completion-check"><input type="checkbox" checked={overdueOnly} onChange={(event) => { setOverdueOnly(event.target.checked); setPage(1); }} /> Overdue only</label>
            <button className="btn btn-secondary" type="button" onClick={resetFilters}>Reset</button>
            <span className="completion-match-count">{data.pagination.total_items} matching evaluations</span>
          </div>

          <div className="completion-table">
            <div className="completion-table-header">
              <SortButton label="Evaluator" value="evaluator" sort={sort} order={order} onSort={updateSort} />
              <SortButton label="Evaluatee" value="evaluatee" sort={sort} order={order} onSort={updateSort} />
              <div>Questionnaire</div><SortButton label="Status" value="status" sort={sort} order={order} onSort={updateSort} /><SortButton label="Due date" value="due_date" sort={sort} order={order} onSort={updateSort} /><SortButton label="Completed at" value="completed_at" sort={sort} order={order} onSort={updateSort} />
            </div>
            {data.rows.length === 0 ? <div className="completion-empty">{summary.total_evaluations === 0 ? 'This campaign has no evaluation assignments yet.' : 'No evaluations match the current filters.'}</div> : data.rows.map((row) => <div className="completion-row" key={row.id}>
              <div><strong>{formatUserName(row.evaluator_name)}</strong><span>{row.evaluator_email}</span></div>
              <div><strong>{formatUserName(row.evaluatee_name)}</strong><span>{row.evaluatee_email}</span>{row.is_self_evaluation && <em>Self-evaluation</em>}</div>
              <div><strong>{row.questionnaire_name}</strong></div>
              <div><span className={`completion-status-pill ${statusClass(row.status_label)}`}>{row.status_label}</span>{row.is_overdue && <span className="completion-overdue">Overdue</span>}</div>
              <div className="completion-date-cell">{formatDateOrDash(row.due_date)}</div><div className="completion-date-cell">{formatDateOrDash(row.completed_at)}</div>
            </div>)}
          </div>

          <div className="completion-pagination">
            <span>Page {data.pagination.page} of {data.pagination.total_pages}</span>
            <div><button className="btn btn-secondary" type="button" disabled={data.pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><button className="btn btn-secondary" type="button" disabled={data.pagination.page >= data.pagination.total_pages} onClick={() => setPage((current) => current + 1)}>Next</button></div>
          </div>
        </section>
      </>}
    </main>
  </AppLayout>;
}

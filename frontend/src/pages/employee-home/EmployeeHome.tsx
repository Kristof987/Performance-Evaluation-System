import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import AppLayout from '../layout/AppLayout';
import { useAppAuth } from '../../auth/AppAuth';
import { ApiAccessError } from '../../auth/authenticated-api';
import { fetchEmployeeDashboard, type AssignedEvaluation } from './employee-home.api';
import { dashboardWork, evaluationOverdue, evaluationStatus, evaluationTitle } from './employee-home.utils';
import '../hr-home/components/MetricsGrid.css';
import './employee-home.css';

function formatDate(value: string | null) {
  if (!value) return 'No deadline';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${value}T00:00:00`));
}

function getGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function EvaluationRow({ evaluation, upcoming = false }: { evaluation: AssignedEvaluation; upcoming?: boolean }) {
  const status = evaluationStatus(evaluation);
  const title = evaluationTitle(evaluation);
  return (
    <div className="employee-compact-row" data-assignment-id={evaluation.id}>
      <div>
        <strong>{title}</strong>
        <span>{evaluation.formName} · {evaluation.campaignName} · {upcoming ? `Starts ${formatDate(evaluation.campaignStartDate)}` : `Due ${formatDate(evaluation.dueDate)}`}</span>
         <small>{upcoming ? 'Upcoming' : <>{status}{evaluation.campaignStatus === 'review' ? ' · Review' : ''}{evaluationOverdue(evaluation) ? ' · Overdue' : ''}</>}</small>
      </div>
      {!upcoming && (
        <Link className="btn btn-secondary employee-compact-action" to={`/employee-home/evaluations/${evaluation.id}`}
           aria-label={`${status === 'In progress' ? 'Continue' : 'Start'} ${title.toLowerCase()} · ${evaluation.formName} · ${evaluation.campaignName}${evaluationOverdue(evaluation) ? ' · Overdue' : ''}`}>
          {status === 'In progress' ? 'Continue' : 'Start'}
        </Link>
      )}
    </div>
  );
}

type EmployeeHomeProps = { forceEmptyState?: boolean };

export default function EmployeeHome({ forceEmptyState = false }: EmployeeHomeProps) {
  const { state, getAccessToken, retryAuth0 } = useAppAuth();
  const user = state.status === 'authenticated' && state.mode === 'auth0' ? state.user : null;
  const userId = user?.id;
  const [evaluations, setEvaluations] = useState<AssignedEvaluation[]>([]);
  const [restrictedCampaigns, setRestrictedCampaigns] = useState<Array<{ campaignId: number; campaignName: string; status: 'paused' | 'closed' }>>([]);
  const [currentDate, setCurrentDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(!forceEmptyState && user !== null);
  const [error, setError] = useState('');
  const [historyLimit, setHistoryLimit] = useState(5);

  useEffect(() => {
    if (forceEmptyState || userId === undefined || !getAccessToken) return;
    const controller = new AbortController();
    fetchEmployeeDashboard(getAccessToken, userId, controller.signal)
      .then((dashboard) => { if (!controller.signal.aborted) { setEvaluations(dashboard.evaluations); setRestrictedCampaigns(dashboard.restrictedCampaigns); setCurrentDate(dashboard.currentDate); } })
      .catch((cause: unknown) => {
        if (cause instanceof ApiAccessError && cause.status === 401) retryAuth0();
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Evaluations could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [forceEmptyState, userId, getAccessToken]);

  const { actionable, completed, nextDeadline, upcoming, history } = dashboardWork(forceEmptyState ? [] : evaluations);
  const firstName = user?.employee.full_name.split(' ')[0] || 'Employee';
  const visibleHistory = history.slice(0, historyLimit);

  return (
    <AppLayout activePage="employee-home" pageClassName="employee-home-page">
      <main className="main-content employee-home-main">
        <header className="employee-home-header">
          <h1>{getGreeting()}, {firstName}</h1>
          <p>Here's what needs your attention.</p>
           {currentDate && <time dateTime={currentDate}>{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${currentDate}T12:00:00Z`))}</time>}
        </header>

        {!forceEmptyState && !loading && !error && restrictedCampaigns.map((item) => (
          <p className="card card-padded employee-questionnaire-state" role="status" key={item.campaignId}>
            {item.status === 'paused'
              ? `${item.campaignName} is temporarily paused. Its questionnaires and saved drafts are unavailable until the campaign resumes.`
              : `${item.campaignName} is closed. Its questionnaires are no longer available.`}
          </p>
        ))}

         <section className="card kpi-section employee-kpi-section" aria-label="Evaluation summary for active and review campaigns">
           <div className="kpi-item"><span className="kpi-label">To complete</span><strong className="kpi-value">{loading ? '…' : actionable.length}</strong><span className="kpi-context">Active and review campaigns</span></div>
           <div className="kpi-item"><span className="kpi-label">Completed</span><strong className="kpi-value">{loading ? '…' : completed.length}</strong><span className="kpi-context">Active and review campaigns</span></div>
          <div className="kpi-item"><span className="kpi-label">Next deadline</span><strong className="kpi-value employee-deadline-value">{loading ? '…' : nextDeadline ? formatDate(nextDeadline.dueDate) : 'None'}</strong><span className="kpi-context">{nextDeadline?.campaignName ?? 'No upcoming deadlines'}</span></div>
        </section>

        <div className="employee-work-overview">
          <section className="card employee-dashboard-panel employee-tasks-panel" aria-labelledby="employee-tasks-heading">
            <div className="employee-panel-heading"><h2 id="employee-tasks-heading">Your tasks</h2></div>
            {loading ? <p className="employee-plain-empty">Loading evaluations...</p>
              : error ? <p role="alert" className="employee-plain-empty">{error}</p>
              : actionable.length ? <div className="employee-compact-list">{actionable.map((item) => <EvaluationRow key={item.id} evaluation={item} />)}</div>
              : <p className="employee-plain-empty">You're all caught up. No evaluations need your attention right now.</p>}
            {!loading && !error && upcoming.length > 0 && <div className="employee-upcoming"><h3>Upcoming</h3><div className="employee-compact-list">{upcoming.map((item) => <EvaluationRow key={item.id} evaluation={item} upcoming />)}</div></div>}
          </section>

          <section className="card employee-dashboard-panel employee-results-panel" aria-labelledby="employee-results-heading">
            <div className="employee-panel-heading"><h2 id="employee-results-heading">Latest results</h2></div>
            <p className="employee-plain-empty">No results published yet.<br />Your results will appear here when they're released.</p>
          </section>
        </div>

        <section className="card employee-dashboard-panel employee-history-panel" aria-labelledby="employee-history-heading">
          <div className="employee-panel-heading"><h2 id="employee-history-heading">History</h2></div>
          {loading ? <p className="employee-plain-empty">Loading history...</p>
            : error ? <p className="employee-plain-empty">History could not be loaded.</p>
            : history.length ? <>
              <div className="employee-history-list">{visibleHistory.map((item) => <div key={item.id}><strong>{evaluationTitle(item)}</strong><span>{item.formName} · {item.campaignName} · {item.finishDate ? `Completed ${formatDate(item.finishDate)}` : 'Completed'}</span></div>)}</div>
              {history.length > historyLimit && <button type="button" className="employee-history-toggle" onClick={() => setHistoryLimit(historyLimit + 5)}>Show more evaluations</button>}
            </> : <p className="employee-plain-empty">No completed evaluations yet.</p>}
        </section>
      </main>
    </AppLayout>
  );
}

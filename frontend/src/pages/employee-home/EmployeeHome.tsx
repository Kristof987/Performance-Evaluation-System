import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import AppLayout from '../layout/AppLayout';
import { formatUserName, getSidebarUser } from '../layout/sidebar-user';
import {
  fetchEmployeeDashboard,
  type AssignedEvaluation,
  type EmployeeDashboard,
} from './employee-home.api';
import './employee-home.css';

const emptyDashboard: EmployeeDashboard = {
  evaluations: [],
  openCount: 0,
  completedCount: 0,
  nextReviewDate: null,
  campaignDateLabel: 'Campaign ends',
  campaignDate: null,
  campaignDateEmptyText: 'Not announced yet',
  latestResult: null,
  history: [],
};

function formatShortDate(value: string | null, emptyText = 'Not announced yet') {
  if (value === null) return emptyText;
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

function getEvaluationProgress(evaluation: AssignedEvaluation) {
  if (evaluation.finishDate !== null) return 100;
  if (evaluation.questionCount === 0) return 0;
  return Math.round((evaluation.answeredCount / evaluation.questionCount) * 100);
}

function getEvaluationStatus(evaluation: AssignedEvaluation) {
  if (evaluation.finishDate !== null) return 'Submitted';
  if (getEvaluationProgress(evaluation) > 0) return 'In progress';
  return evaluation.statusName || 'Not started';
}

function getEvaluationMeta(evaluation: AssignedEvaluation) {
  const questionLabel = evaluation.questionCount === 1 ? 'question' : 'questions';
  return `${evaluation.campaignName} • about ${formatUserName(evaluation.evaluateeName)} • ${evaluation.questionCount} ${questionLabel}`;
}

function getFullDate() {
  const currentDate = new Date();
  const currentDay = currentDate.getDate().toString();
  const currentMonth = currentDate.toLocaleDateString('en-US', {
    month: 'long',
  });
  const currentYear = currentDate.getFullYear().toString();
  const currentDayString = currentDate.toLocaleDateString('en-US', {
    weekday: 'long',
  });

  return `${currentDayString}, ${currentDay} ${currentMonth} ${currentYear}`;
}

function getTimeBasedGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

type EmployeeHomeProps = {
  forceEmptyState?: boolean;
};

export default function EmployeeHome({ forceEmptyState = false }: EmployeeHomeProps) {
  const user = getSidebarUser();
  const [dashboard, setDashboard] = useState<EmployeeDashboard>(emptyDashboard);
  const [isLoadingWork, setIsLoadingWork] = useState(true);
  const [workError, setWorkError] = useState('');

  useEffect(() => {
    if (forceEmptyState) {
      setDashboard(emptyDashboard);
      setIsLoadingWork(false);
      setWorkError('');
      return;
    }

    if (user === null) {
      setDashboard(emptyDashboard);
      setIsLoadingWork(false);
      return;
    }

    const controller = new AbortController();
    setIsLoadingWork(true);
    setWorkError('');

    fetchEmployeeDashboard(user.id, controller.signal)
      .then((loadedDashboard) => {
        setDashboard(loadedDashboard);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setWorkError(error instanceof Error ? error.message : 'Assigned evaluations could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingWork(false);
      });

    return () => controller.abort();
  }, [forceEmptyState, user?.id]);

  const assignedEvaluations = dashboard.evaluations;
  const openEvaluations = assignedEvaluations.filter((evaluation) => evaluation.finishDate === null);
  const hasDashboardData = !forceEmptyState && workError === '' && assignedEvaluations.length > 0;
  const dashboardUserName = user === null ? 'Employee' : formatUserName(user.username);
  const greeting = getTimeBasedGreeting();
  const latestSubmittedEvaluation = dashboard.latestResult;

  return (
    <AppLayout activePage="employee-home" pageClassName="employee-home-page">
      <div className="main-content employee-home-main employee-empty-dashboard-main">
        <div className="topbar employee-topbar">
          <div className="greeting">
            <div className="greeting-title">{greeting}, {dashboardUserName}</div>
            <div className="greeting-date">{getFullDate()}</div>
          </div>
        </div>

        <section className="employee-summary-grid" aria-label="Review summary">
          <div className="card employee-summary-card">
            <span>Open evaluations</span>
            <strong>{isLoadingWork ? '...' : dashboard.openCount}</strong>
          </div>
          <div className="card employee-summary-card">
            <span>Completed forms in this campaign</span>
            <strong>{isLoadingWork ? '...' : dashboard.completedCount}</strong>
          </div>
          <div className="card employee-summary-card">
            <span>{dashboard.campaignDateLabel}</span>
            <strong>{formatShortDate(dashboard.campaignDate, dashboard.campaignDateEmptyText)}</strong>
          </div>
        </section>

        <section className="card employee-work-overview">
          <div className="employee-work-column employee-work-column-large">
            <div className="employee-panel-heading">
              <h2>Your tasks</h2>
            </div>
            {isLoadingWork ? (
              <p className="employee-plain-empty">Loading evaluations...</p>
            ) : openEvaluations.length > 0 ? (
              <div className="employee-compact-list">
                {openEvaluations.map((evaluation) => (
                  <div className="employee-compact-row" key={evaluation.id}>
                    <div>
                      <strong>{evaluation.formName}</strong>
                      <span>{getEvaluationMeta(evaluation)} · due {formatShortDate(evaluation.dueDate)}</span>
                    </div>
                    <button className={getEvaluationProgress(evaluation) > 0 ? 'btn btn-primary employee-compact-action' : 'btn btn-secondary employee-compact-action'} type="button">
                      {getEvaluationProgress(evaluation) > 0 ? 'Continue' : 'Start'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="employee-plain-empty">
                {workError !== '' ? 'Evaluations could not be loaded.' : "You're all caught up. New evaluations will appear here."}
              </p>
            )}
          </div>

          <div className="employee-work-column">
            <div className="employee-panel-heading">
              <h2>Latest results</h2>
            </div>
            {latestSubmittedEvaluation !== null ? (
              <div className="employee-result-card-inline">
                <div>
                  <strong>{latestSubmittedEvaluation.campaignName}</strong>
                  <span>{latestSubmittedEvaluation.formName} · {getEvaluationStatus(latestSubmittedEvaluation)}</span>
                </div>
                <Link to="/results">View summary</Link>
              </div>
            ) : (
              <p className="employee-plain-empty">No results published yet.</p>
            )}
          </div>
        </section>

        <section className="card employee-dashboard-panel employee-history-panel">
          <div className="employee-panel-heading">
            <h2>History</h2>
          </div>
          {hasDashboardData ? (
            <div className="employee-history-list">
              {dashboard.history.map((item) => (
                <div key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.status} · {item.subtitle}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="employee-history-empty">No review activity yet.</div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}

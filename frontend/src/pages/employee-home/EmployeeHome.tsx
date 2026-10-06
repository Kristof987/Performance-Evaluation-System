import { useEffect, useState } from 'react';
import AppLayout from '../layout/AppLayout';
import { formatUserName, getSidebarUser } from '../layout/sidebar-user';
import { fetchAssignedEvaluations, type AssignedEvaluation } from './employee-home.api';
import './employee-home.css';

type WorkFilter = 'open' | 'submitted' | 'all';

const activity = [
  ['Self-assessment draft saved', '12 minutes ago'],
  ['Peer feedback request received', 'Yesterday'],
  ['Mid-Year cycle opened', 'May 10'],
];

function formatShortDate(value: string | null) {
  if (value === null) return 'No due date';
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

function getEvaluationTone(evaluation: AssignedEvaluation) {
  if (evaluation.finishDate !== null) return 'submitted';
  if (getEvaluationProgress(evaluation) > 0) return 'progress';
  return 'waiting';
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

export default function EmployeeHome() {
  const user = getSidebarUser();
  const userName = user === null ? 'Employee' : formatUserName(user.username);
  const [assignedEvaluations, setAssignedEvaluations] = useState<AssignedEvaluation[]>([]);
  const [workFilter, setWorkFilter] = useState<WorkFilter>('open');
  const [isLoadingWork, setIsLoadingWork] = useState(true);
  const [workError, setWorkError] = useState('');

  useEffect(() => {
    if (user === null) {
      setAssignedEvaluations([]);
      setIsLoadingWork(false);
      return;
    }

    const controller = new AbortController();
    setIsLoadingWork(true);
    setWorkError('');

    fetchAssignedEvaluations(user.id, controller.signal)
      .then((evaluations) => {
        setAssignedEvaluations(evaluations);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setWorkError(error instanceof Error ? error.message : 'Assigned evaluations could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingWork(false);
      });

    return () => controller.abort();
  }, [user?.id]);

  const openEvaluations = assignedEvaluations.filter((evaluation) => evaluation.finishDate === null);
  const submittedEvaluations = assignedEvaluations.filter((evaluation) => evaluation.finishDate !== null);
  const visibleEvaluations =
    workFilter === 'open'
      ? openEvaluations
      : workFilter === 'submitted'
        ? submittedEvaluations
        : assignedEvaluations;
  const nextEvaluation = openEvaluations[0] ?? null;
  const currentEvaluation = nextEvaluation ?? assignedEvaluations[0] ?? null;
  const completionRate =
    assignedEvaluations.length === 0
      ? 0
      : Math.round((submittedEvaluations.length / assignedEvaluations.length) * 100);
  const cycleTitle = isLoadingWork
    ? 'Loading assigned questionnaires'
    : currentEvaluation?.campaignName ?? 'No assigned questionnaires';
  const cycleDescription =
    currentEvaluation === null
      ? 'There are no questionnaires assigned to you yet.'
      : 'Complete the forms assigned to you. Results become visible after manager approval.';

  return (
    <AppLayout activePage="employee-home" pageClassName="employee-home-page">
      <div className="main-content employee-home-main">
        <div className="topbar employee-topbar">
          <div className="greeting">
            <div className="greeting-title">Good morning, {userName}</div>
            <div className="greeting-date">
              You have {openEvaluations.length} open review {openEvaluations.length === 1 ? 'action' : 'actions'}.
            </div>
          </div>
          <div className="button-group">
            <button className="icon-button" type="button" aria-label="Notifications">
              <span />
            </button>
            <button className="icon-button" type="button" aria-label="More actions">
              <span />
            </button>
          </div>
        </div>

        <section className="card employee-cycle-card">
          <div className="employee-cycle-copy">
            <div className="employee-kicker">Current cycle</div>
            <h1>{cycleTitle}</h1>
            <p>
              {cycleDescription}
            </p>
          </div>
          <div className="employee-cycle-metrics">
            <div className="employee-cycle-metric">
              <span>Open</span>
              <strong>{openEvaluations.length}</strong>
              <small>To complete</small>
            </div>
            <div className="employee-cycle-metric warning">
              <span>Submitted</span>
              <strong>{submittedEvaluations.length}/{assignedEvaluations.length}</strong>
              <small>Finished</small>
            </div>
            <div className="employee-cycle-metric muted">
              <span>Progress</span>
              <strong>{completionRate}%</strong>
              <small>{currentEvaluation?.dueDate === null ? 'No due date' : `Due ${formatShortDate(currentEvaluation?.dueDate ?? null)}`}</small>
            </div>
          </div>
        </section>

        <div className="employee-section-row">
          <div className="employee-section-title">
            <h2>Assigned work</h2>
            <p>Questionnaires assigned to you are shown here.</p>
          </div>
          <div className="employee-filter-tabs" aria-label="Assigned work filter">
            <button className={workFilter === 'open' ? 'active' : ''} type="button" onClick={() => setWorkFilter('open')}>Open</button>
            <button className={workFilter === 'submitted' ? 'active' : ''} type="button" onClick={() => setWorkFilter('submitted')}>Submitted</button>
            <button className={workFilter === 'all' ? 'active' : ''} type="button" onClick={() => setWorkFilter('all')}>All</button>
          </div>
        </div>

        <section className="employee-workspace">
          <div className="card employee-work-table">
            <div className="employee-work-header">
              <span>Task</span>
              <span>Due</span>
              <span>Status</span>
            </div>
            {isLoadingWork && (
              <div className="employee-work-empty">
                Loading assigned questionnaires...
              </div>
            )}
            {!isLoadingWork && workError !== '' && (
              <div className="employee-work-empty">
                No questionnaires have been assigned to you yet.
              </div>
            )}
            {!isLoadingWork && workError === '' && visibleEvaluations.length === 0 && (
              <div className="employee-work-empty">
                No questionnaires have been assigned to you yet.
              </div>
            )}
            {!isLoadingWork && workError === '' && visibleEvaluations.map((evaluation) => {
              const tone = getEvaluationTone(evaluation);
              return (
                <div className="employee-work-row" key={evaluation.id}>
                  <div className="employee-work-task">
                    <strong>{evaluation.formName}</strong>
                    <span>{getEvaluationMeta(evaluation)}</span>
                    <div className={`employee-progress-line ${tone}`}>
                      <span style={{ width: `${getEvaluationProgress(evaluation)}%` }} />
                    </div>
                  </div>
                  <strong className="employee-work-due">{formatShortDate(evaluation.dueDate)}</strong>
                  <span className={`employee-status ${tone}`}>{getEvaluationStatus(evaluation)}</span>
                </div>
              );
            })}
          </div>

          <aside className="employee-side-stack">
            <div className="card employee-next-card">
              <div className="employee-kicker">Next step</div>
              {nextEvaluation === null ? (
                <>
                  <h2>You are all caught up</h2>
                  <p>No assigned questionnaires need your input right now.</p>
                </>
              ) : (
                <>
                  <h2>Continue {nextEvaluation.formName}</h2>
                  <p>{getEvaluationMeta(nextEvaluation)}</p>
                  <button className="btn btn-primary" type="button">Continue form</button>
                </>
              )}
            </div>
            <div className="card employee-next-card">
              <h2>Results</h2>
              <p>Scores and comments are private to you and will appear here after the cycle is published.</p>
              <span className="employee-locked-pill">Locked until published</span>
            </div>
          </aside>
        </section>

        <section className="card employee-activity-card">
          <h2>Recent activity</h2>
          <div className="employee-activity-list">
            {activity.map(([label, time]) => (
              <div className="employee-activity-row" key={label}>
                <span className="employee-activity-dot" />
                <strong>{label}</strong>
                <span>{time}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Calendar,
  ClipboardCheck,
  MessageCircle,
  Target,
  TrendingUp,
} from 'lucide-react';
import reviewEmptyIcon from '../../assets/review-empty-icon.png';
import AppLayout from '../layout/AppLayout';
import { formatUserName, getSidebarUser } from '../layout/sidebar-user';
import { fetchAssignedEvaluations, type AssignedEvaluation } from './employee-home.api';
import './employee-home.css';

type WorkFilter = 'open' | 'submitted' | 'all';

const reviewHighlights = [
  {
    title: 'Top strengths',
    icon: TrendingUp,
    items: [
      'Clear ownership and follow-through',
      'Helpful communication with teammates',
      'Reliable delivery on committed work',
    ],
  },
  {
    title: 'Development focus',
    icon: Target,
    items: [
      'Share progress earlier when risks appear',
      'Delegate smaller tasks more confidently',
      'Make technical decisions easier to follow',
    ],
  },
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

function getEvaluationAction(evaluation: AssignedEvaluation) {
  if (evaluation.finishDate !== null) return 'View answers';
  if (getEvaluationProgress(evaluation) > 0) return 'Continue';
  return 'Start';
}

function getEvaluationMeta(evaluation: AssignedEvaluation) {
  const questionLabel = evaluation.questionCount === 1 ? 'question' : 'questions';
  return `${evaluation.campaignName} • about ${formatUserName(evaluation.evaluateeName)} • ${evaluation.questionCount} ${questionLabel}`;
}

export default function EmployeeHome() {
  const user = getSidebarUser();
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
  const hasActiveReviewTasks = openEvaluations.length > 0;
  const cycleName = currentEvaluation?.campaignName ?? 'Next review cycle';
  const nextCycleDate = currentEvaluation?.dueDate ?? '2026-11-01';

  return (
    <AppLayout activePage="employee-home" pageClassName="employee-home-page">
      <div className="main-content employee-home-main">
        <div className="topbar employee-topbar">
          <div className="employee-dashboard-heading">
            <h1>Dashboard</h1>
          </div>
        </div>

        <section className={`card employee-review-panel ${!isLoadingWork && (!hasActiveReviewTasks || workError !== '') ? 'is-empty' : ''}`}>
          {isLoadingWork ? (
            <div className="employee-review-empty">
              <div className="employee-empty-icon" aria-hidden="true">
                <img src={reviewEmptyIcon} alt="" />
              </div>
              <div className="employee-empty-copy">
                <span className="employee-task-pill">Loading tasks</span>
                <h2>Loading assigned review tasks</h2>
                <p>Questionnaires assigned to you will appear here with their due date and status.</p>
              </div>
            </div>
          ) : !hasActiveReviewTasks || workError !== '' ? (
            <div className="employee-review-empty">
              <div className="employee-empty-icon" aria-hidden="true">
                <img src={reviewEmptyIcon} alt="" />
              </div>
              <div className="employee-empty-copy">
                <span className="employee-task-pill">0 open tasks</span>
                <h2>There is currently no form to complete.</h2>
                <p>
                  There is no form you need to fill out right now. When a review task is assigned, it will appear here with its due date and status.
                </p>
                <div className="employee-next-cycle">
                  <Calendar size={20} />
                  <span>Next review cycle:</span>
                  <strong>{formatShortDate(nextCycleDate)}</strong>
                </div>
                <div className="employee-panel-actions">
                  <Link className="btn btn-primary" to="/results">View previous reviews</Link>
                  <button className="btn btn-secondary" type="button">
                    <MessageCircle size={17} />
                    Have a question for HR?
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="employee-review-summary">
                <div>
                  <span className="employee-task-pill">{cycleName} · Open</span>
                  <h2>You have {openEvaluations.length} open review {openEvaluations.length === 1 ? 'task' : 'tasks'}</h2>
                  <div className="employee-next-cycle">
                    <Calendar size={18} />
                    <span>Cycle closes:</span>
                    <strong>{formatShortDate(currentEvaluation?.dueDate ?? null)}</strong>
                  </div>
                </div>
                <div className="employee-review-progress">
                  <span>Submitted</span>
                  <strong>{submittedEvaluations.length} / {assignedEvaluations.length}</strong>
                  <div className="employee-progress-line">
                    <span style={{ width: `${completionRate}%` }} />
                  </div>
                </div>
              </div>

              <div className="employee-work-table">
                {visibleEvaluations.map((evaluation) => {
                  const tone = getEvaluationTone(evaluation);
                  return (
                    <div className="employee-work-row" key={evaluation.id}>
                      <div className="employee-work-icon" aria-hidden="true">
                        <ClipboardCheck size={17} />
                      </div>
                      <div className="employee-work-task">
                        <strong>{evaluation.formName}</strong>
                        <span>{getEvaluationMeta(evaluation)}</span>
                      </div>
                      <div className="employee-work-due">
                        <span>Due</span>
                        <strong>{formatShortDate(evaluation.dueDate)}</strong>
                      </div>
                      <span className={`employee-status ${tone}`}>{getEvaluationStatus(evaluation)}</span>
                      <button className={tone === 'progress' ? 'btn btn-primary employee-row-action' : 'btn btn-secondary employee-row-action'} type="button">
                        {getEvaluationAction(evaluation)}
                      </button>
                    </div>
                  );
                })}
              </div>

              <button className="employee-hr-question" type="button">
                <MessageCircle size={15} />
                Have a question for HR?
              </button>

              <div className="employee-filter-tabs" aria-label="Assigned work filter">
                <button className={workFilter === 'open' ? 'active' : ''} type="button" onClick={() => setWorkFilter('open')}>Open</button>
                <button className={workFilter === 'submitted' ? 'active' : ''} type="button" onClick={() => setWorkFilter('submitted')}>Submitted</button>
                <button className={workFilter === 'all' ? 'active' : ''} type="button" onClick={() => setWorkFilter('all')}>All</button>
              </div>
            </>
          )}
        </section>

        <section className="employee-results-section">
          <div className="employee-section-row">
            <div className="employee-section-title">
              <h2>Latest published review highlights</h2>
              <p>A quick reminder of insights from your most recent review.</p>
            </div>
            <div className="employee-results-actions">
              <span>Q1 2024</span>
              <Link to="/results">Open full results</Link>
            </div>
          </div>

          <div className="employee-highlights-grid">
            {reviewHighlights.map((highlight) => {
              const Icon = highlight.icon;
              return (
                <div className="card employee-highlight-card" key={highlight.title}>
                  <h3>
                    <Icon size={21} />
                    {highlight.title}
                  </h3>
                  <ol>
                    {highlight.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}

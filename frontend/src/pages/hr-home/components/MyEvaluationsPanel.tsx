import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fetchAssignedEvaluations, type AssignedEvaluation } from '../../employee-home/employee-home.api';
import { dashboardWork, evaluationStatus, evaluationTitle } from '../../employee-home/employee-home.utils';
import { getSidebarUser } from '../../layout/sidebar-user';
import './MyEvaluationsPanel.css';

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function TaskRow({ evaluation, upcoming = false }: { evaluation: AssignedEvaluation; upcoming?: boolean }) {
  const status = upcoming ? 'Upcoming' : evaluationStatus(evaluation);
  const action = evaluationStatus(evaluation) === 'In progress' ? 'Continue' : 'Start';
  const isCompleted = status === 'Completed';
  return <div className="my-evaluation-row" data-assignment-id={evaluation.id}>
    <div className="my-evaluation-title"><strong>{evaluationTitle(evaluation)}</strong></div>
    <div className="my-evaluation-context" title={`${evaluation.formName} · ${evaluation.campaignName}`}><span>{evaluation.formName}</span><small>{evaluation.campaignName}</small></div>
    <div className="my-evaluation-due">{formatDate(evaluation.dueDate)}</div>
    <div className="my-evaluation-status">{status}</div>
    <div className="my-evaluation-action">{upcoming ? <span className="my-evaluation-muted">Not available</span> : isCompleted ? <span className="my-evaluation-completed">Completed</span> : <Link className="btn btn-secondary btn-small" to={`/evaluations/${evaluation.id}?from=hr`}>{action} →</Link>}</div>
  </div>;
}

export default function MyEvaluationsPanel() {
  const userId = getSidebarUser()?.id;
  const [evaluations, setEvaluations] = useState<AssignedEvaluation[]>([]);
  const [loading, setLoading] = useState(userId !== undefined);
  const [error, setError] = useState('');
  useEffect(() => {
    if (userId === undefined) return undefined;
    const controller = new AbortController();
    fetchAssignedEvaluations(userId, controller.signal)
      .then((items) => { if (!controller.signal.aborted) setEvaluations(items); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Your evaluations could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId]);
  const { actionable, upcoming, history } = dashboardWork(evaluations);
  const completedOnly = evaluations.length > 0 && actionable.length === 0 && upcoming.length === 0 && history.length > 0;
  const nextUpcoming = upcoming[0] ?? null;
  return <section className="card my-evaluations-panel" aria-labelledby="my-evaluations-heading"><div className="my-evaluations-heading"><div><h2 id="my-evaluations-heading">My evaluations</h2><p>Your assigned performance reviews.</p></div><div className="my-evaluations-count"><strong>{loading ? '…' : `${actionable.length} to complete`}</strong><span>Across all campaigns</span></div></div>{loading ? <p className="my-evaluations-empty">Loading your evaluations...</p> : error ? <p className="my-evaluations-empty" role="alert">{error}</p> : actionable.length > 0 ? <div className="my-evaluations-table" role="table" aria-label="My assigned evaluations"><div className="my-evaluation-row my-evaluation-head" role="row"><span>Evaluation</span><span>Questionnaire and campaign</span><span>Due date</span><span>Status</span><span>Action</span></div>{actionable.slice(0, 5).map((evaluation) => <TaskRow key={evaluation.id} evaluation={evaluation} />)}</div> : completedOnly ? <p className="my-evaluations-empty">You're all caught up.</p> : nextUpcoming ? <><p className="my-evaluations-empty">Your next evaluation becomes available on {formatDate(nextUpcoming.campaignStartDate)}.</p><div className="my-evaluations-table"><TaskRow evaluation={nextUpcoming} upcoming /></div></> : <p className="my-evaluations-empty">No evaluations are assigned to you.</p>}{!loading && !error && upcoming.length > 0 && actionable.length > 0 && <div className="my-evaluations-upcoming"><span>Upcoming</span><div className="my-evaluations-table">{upcoming.slice(0, 2).map((evaluation) => <TaskRow key={evaluation.id} evaluation={evaluation} upcoming />)}</div></div>}</section>;
}

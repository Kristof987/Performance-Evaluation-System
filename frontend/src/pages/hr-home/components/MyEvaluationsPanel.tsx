import { useState } from 'react';
import { Link } from 'react-router';
import type { AssignedEvaluation } from '../../employee-home/employee-home.api';
import { dashboardWork, evaluationAvailable, evaluationOverdue, evaluationStatus, evaluationTitle } from '../../employee-home/employee-home.utils';
import { useMyEvaluations } from '../hooks/useMyEvaluations';
import './MyEvaluationsPanel.css';

function formatDate(value: string | null) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function TaskRow({ evaluation }: { evaluation: AssignedEvaluation }) {
  const submitted = evaluation.finishDate !== null || evaluationStatus(evaluation) === 'Completed';
  const status = submitted ? 'Submitted' : evaluationStatus(evaluation);
  const available = evaluationAvailable(evaluation);
  const action = submitted ? 'View' : status === 'In progress' ? 'Continue' : 'Start';
  return <div className="my-evaluation-row" role="row" data-assignment-id={evaluation.id}>
    <div className="my-evaluation-title" role="cell"><strong title={evaluationTitle(evaluation)}>{evaluationTitle(evaluation)}</strong></div>
    <div className="my-evaluation-context" role="cell" title={`${evaluation.formName} · ${evaluation.campaignName}`}><span>{evaluation.formName}</span><small>{evaluation.campaignName}</small></div>
    <div className="my-evaluation-due" role="cell">{formatDate(evaluation.dueDate)}</div>
    <div className="my-evaluation-status" role="cell"><span className="badge badge-neutral">{status}{evaluationOverdue(evaluation) ? ' · Overdue' : ''}{evaluation.campaignStatus === 'review' ? ' · Review' : ''}</span></div>
    <div className="my-evaluation-action" role="cell">{available ? <Link className="btn btn-secondary btn-small" to={`/evaluations/${evaluation.id}?from=hr`}>{action}</Link> : <span className="my-evaluation-muted">{evaluation.campaignStatus === 'scheduled' ? `Available ${formatDate(evaluation.campaignStartDate)}` : 'Not available'}</span>}</div>
  </div>;
}

export default function MyEvaluationsPanel() {
  const { evaluations, loading, error } = useMyEvaluations();
  const [campaignId, setCampaignId] = useState('all');
  const [status, setStatus] = useState('all');
  const campaigns = Array.from(new Map(evaluations.map((item) => [item.campaignId, item.campaignName])).entries());
  const filtered = evaluations.filter((item) =>
    (campaignId === 'all' || item.campaignId === Number(campaignId)) &&
    (status === 'all' || (status === 'Submitted' ? item.finishDate !== null || evaluationStatus(item) === 'Completed' : item.finishDate === null && evaluationStatus(item) === status))
  );
  const { actionable } = dashboardWork(evaluations);

  return <section className="card my-evaluations-panel" aria-labelledby="my-evaluations-heading">
    <div className="my-evaluations-heading"><div><h2 id="my-evaluations-heading">My evaluations</h2><p>Your issued assignments across all campaigns.</p></div><div className="my-evaluations-count"><strong>{loading ? '…' : `${actionable.length} to complete`}</strong><span>Current tasks</span></div></div>
    {loading ? <p className="my-evaluations-empty" role="status">Loading your evaluations...</p> : error ? <p className="my-evaluations-empty" role="alert">{error}</p> : evaluations.length === 0 ? <p className="my-evaluations-empty">No evaluations are assigned to you yet.</p> : <>
      <div className="my-evaluations-filters"><label>Campaign<select className="form-control" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="all">All campaigns</option>{campaigns.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>Status<select className="form-control" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="Not started">Not started</option><option value="In progress">In progress</option><option value="Submitted">Submitted</option></select></label></div>
      {filtered.length === 0 ? <p className="my-evaluations-empty">No evaluations match these filters.</p> : <div className="my-evaluations-table" role="table" aria-label="My assigned evaluations"><div className="my-evaluation-row my-evaluation-head" role="row"><span role="columnheader">Evaluation</span><span role="columnheader">Questionnaire and campaign</span><span role="columnheader">Due date</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>{filtered.map((evaluation) => <TaskRow key={evaluation.id} evaluation={evaluation} />)}</div>}
    </>}
  </section>;
}

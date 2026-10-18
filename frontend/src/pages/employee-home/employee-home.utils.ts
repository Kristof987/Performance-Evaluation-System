import type { AssignedEvaluation } from './employee-home.api';

export function evaluationStatus(evaluation: AssignedEvaluation): 'Not started' | 'In progress' | 'Completed' {
  if (evaluation.finishDate !== null || evaluation.statusName.toLowerCase() === 'completed' || evaluation.statusName.toLowerCase() === 'submitted') return 'Completed';
  if (evaluation.statusName.toLowerCase() === 'in progress' || evaluation.answeredCount > 0) return 'In progress';
  return 'Not started';
}

export function evaluationTitle(evaluation: AssignedEvaluation): string {
  return evaluation.evaluatorId === evaluation.evaluateeId
    ? 'Self-evaluation'
    : `Evaluate ${evaluation.evaluateeName.trim() || 'employee'}`;
}

export function campaignStatus(evaluation: AssignedEvaluation) {
  return evaluation.campaignStatus;
}

export function evaluationAvailable(evaluation: AssignedEvaluation) {
  return evaluation.campaignStatus === 'active' || evaluation.campaignStatus === 'review';
}

export function evaluationOverdue(evaluation: AssignedEvaluation) {
  return evaluationAvailable(evaluation) && evaluationStatus(evaluation) !== 'Completed'
    && evaluation.campaignEndAt !== null && new Date(evaluation.campaignEndAt).getTime() <= Date.now();
}

export function dashboardWork(evaluations: AssignedEvaluation[]) {
  const available = evaluations.filter(evaluationAvailable);
  const completed = available.filter((item) => evaluationStatus(item) === 'Completed');
  const actionable = available.filter((item) => evaluationStatus(item) !== 'Completed');
  // Overdue first, then drafts with a deadline, then the remaining work; stable ID tie-breaker.
  actionable.sort((a, b) => {
    const priority = (item: AssignedEvaluation) => evaluationOverdue(item) ? 0
      : evaluationStatus(item) === 'In progress' && item.dueDate !== null ? 1 : 2;
    return priority(a) - priority(b) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.id - b.id;
  });
  const deadlines = actionable.filter((item) => item.dueDate !== null && !evaluationOverdue(item)).sort((a, b) =>
    (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.id - b.id);
  const upcoming = evaluations.filter((item) => evaluationStatus(item) !== 'Completed' && campaignStatus(item) === 'scheduled')
    .sort((a, b) => a.campaignStartDate.localeCompare(b.campaignStartDate) || a.id - b.id);
  const history = evaluations.filter((item) => evaluationStatus(item) === 'Completed')
    .sort((a, b) => (b.finishDate ?? '').localeCompare(a.finishDate ?? '') || b.id - a.id);
  return { actionable, completed, nextDeadline: deadlines[0] ?? null, upcoming, history };
}

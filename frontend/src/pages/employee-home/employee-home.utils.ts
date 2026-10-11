import { getCalendarToday, getCampaignLifecycleStatus } from '../campaigns/campaign.lifecycle.ts';
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

export function campaignStatus(evaluation: AssignedEvaluation, today = getCalendarToday()) {
  return getCampaignLifecycleStatus({
    is_active: evaluation.campaignIsActive,
    start_date: evaluation.campaignStartDate,
    end_date: evaluation.dueDate,
  }, today);
}

export function dashboardWork(evaluations: AssignedEvaluation[], today = getCalendarToday()) {
  const ongoing = evaluations.filter((item) => campaignStatus(item, today) === 'Ongoing');
  const completed = ongoing.filter((item) => evaluationStatus(item) === 'Completed');
  const actionable = ongoing.filter((item) => evaluationStatus(item) !== 'Completed');
  // Overdue first, then drafts with a deadline, then the remaining work; stable ID tie-breaker.
  actionable.sort((a, b) => {
    const priority = (item: AssignedEvaluation) => item.dueDate !== null && item.dueDate < today ? 0
      : evaluationStatus(item) === 'In progress' && item.dueDate !== null ? 1 : 2;
    return priority(a) - priority(b) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.id - b.id;
  });
  const deadlines = actionable.filter((item) => item.dueDate !== null).sort((a, b) =>
    (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.id - b.id);
  const upcoming = evaluations.filter((item) => evaluationStatus(item) !== 'Completed' && campaignStatus(item, today) === 'Scheduled')
    .sort((a, b) => a.campaignStartDate.localeCompare(b.campaignStartDate) || a.id - b.id);
  const history = evaluations.filter((item) => evaluationStatus(item) === 'Completed')
    .sort((a, b) => (b.finishDate ?? '').localeCompare(a.finishDate ?? '') || b.id - a.id);
  return { actionable, completed, nextDeadline: deadlines[0] ?? null, upcoming, history };
}

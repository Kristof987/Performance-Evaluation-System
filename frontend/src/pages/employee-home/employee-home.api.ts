import { API_BASE_URL } from '../../config';

type AssignedEvaluationResponse = {
  id: number;
  campaign_id: number;
  campaign_name: string;
  form_id: number;
  form_name: string;
  form_description: string | null;
  evaluatee_id: number;
  evaluatee_name: string;
  status_name: string;
  due_date: string | null;
  finish_date: string | null;
  question_count: number;
  answered_count: number;
  created_at: string;
};

type EmployeeDashboardHistoryItemResponse = {
  id: number;
  title: string;
  subtitle: string;
  status: string;
  occurred_at: string | null;
};

type EmployeeDashboardResponse = {
  evaluations: AssignedEvaluationResponse[];
  open_count: number;
  completed_count: number;
  next_review_date: string | null;
  campaign_date_label: string;
  campaign_date: string | null;
  campaign_date_empty_text: string;
  latest_result: AssignedEvaluationResponse | null;
  history: EmployeeDashboardHistoryItemResponse[];
};

export type AssignedEvaluation = {
  id: number;
  campaignId: number;
  campaignName: string;
  formId: number;
  formName: string;
  formDescription: string;
  evaluateeId: number;
  evaluateeName: string;
  statusName: string;
  dueDate: string | null;
  finishDate: string | null;
  questionCount: number;
  answeredCount: number;
  createdAt: string;
};

export type EmployeeDashboardHistoryItem = {
  id: number;
  title: string;
  subtitle: string;
  status: string;
  occurredAt: string | null;
};

export type EmployeeDashboard = {
  evaluations: AssignedEvaluation[];
  openCount: number;
  completedCount: number;
  nextReviewDate: string | null;
  campaignDateLabel: string;
  campaignDate: string | null;
  campaignDateEmptyText: string;
  latestResult: AssignedEvaluation | null;
  history: EmployeeDashboardHistoryItem[];
};

function mapAssignedEvaluation(evaluation: AssignedEvaluationResponse): AssignedEvaluation {
  return {
    id: evaluation.id,
    campaignId: evaluation.campaign_id,
    campaignName: evaluation.campaign_name,
    formId: evaluation.form_id,
    formName: evaluation.form_name,
    formDescription: evaluation.form_description || '',
    evaluateeId: evaluation.evaluatee_id,
    evaluateeName: evaluation.evaluatee_name,
    statusName: evaluation.status_name,
    dueDate: evaluation.due_date,
    finishDate: evaluation.finish_date,
    questionCount: evaluation.question_count,
    answeredCount: evaluation.answered_count,
    createdAt: evaluation.created_at,
  };
}

function mapEmployeeDashboard(dashboard: EmployeeDashboardResponse): EmployeeDashboard {
  return {
    evaluations: dashboard.evaluations.map(mapAssignedEvaluation),
    openCount: dashboard.open_count,
    completedCount: dashboard.completed_count,
    nextReviewDate: dashboard.next_review_date,
    campaignDateLabel: dashboard.campaign_date_label,
    campaignDate: dashboard.campaign_date,
    campaignDateEmptyText: dashboard.campaign_date_empty_text,
    latestResult: dashboard.latest_result === null ? null : mapAssignedEvaluation(dashboard.latest_result),
    history: dashboard.history.map((item) => ({
      id: item.id,
      title: item.title,
      subtitle: item.subtitle,
      status: item.status,
      occurredAt: item.occurred_at,
    })),
  };
}

async function requestApi<T>(path: string, options: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : fallback);
  }
  return response.json() as Promise<T>;
}

export async function fetchAssignedEvaluations(
  userId: number,
  signal: AbortSignal,
): Promise<AssignedEvaluation[]> {
  const evaluations = await requestApi<AssignedEvaluationResponse[]>(
    `/users/${userId}/assigned-evaluations`,
    { signal },
    'Assigned evaluations could not be loaded.',
  );
  return evaluations.map(mapAssignedEvaluation);
}

export async function fetchEmployeeDashboard(
  userId: number,
  signal: AbortSignal,
): Promise<EmployeeDashboard> {
  return mapEmployeeDashboard(
    await requestApi<EmployeeDashboardResponse>(
      `/users/${userId}/employee-dashboard`,
      { signal },
      'Employee dashboard could not be loaded.',
    ),
  );
}

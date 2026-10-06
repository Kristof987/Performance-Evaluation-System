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

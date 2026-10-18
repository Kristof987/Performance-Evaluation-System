import { authenticatedApiFetch, type AccessTokenGetter } from '../../auth/authenticated-api';
import type { FormQuestion } from '../forms/forms.api';

type AssignedEvaluationResponse = {
  id: number;
  evaluator_id: number;
  campaign_id: number;
  campaign_name: string;
  campaign_start_date: string;
  campaign_is_active: boolean;
  campaign_lifecycle_status: 'Scheduled' | 'Ongoing' | 'Completed' | 'Disabled';
  current_date: string;
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
  current_date: string;
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
  evaluatorId: number;
  campaignId: number;
  campaignName: string;
  campaignStartDate: string;
  campaignIsActive: boolean;
  campaignLifecycleStatus: 'Scheduled' | 'Ongoing' | 'Completed' | 'Disabled';
  currentDate: string;
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

export type QuestionnaireAnswer = { question_id: string; value: string | number | string[] };
export type IssuedBlock =
  | { type: 'section'; section_id: number; section?: { id: number; name: string }; questions: FormQuestion[] }
  | { type: 'question'; question: FormQuestion };
export type AssignedQuestionnaire = { evaluation: AssignedEvaluation; blocks: IssuedBlock[]; answers: QuestionnaireAnswer[] };
export const issuedQuestions = (blocks: IssuedBlock[]) => blocks.flatMap((block) => block.type === 'section' ? block.questions : [block.question]);

function mapIssuedBlocks(questions: Array<IssuedBlock | FormQuestion>): IssuedBlock[] {
  return questions.map((item) => item.type === 'section' || item.type === 'question'
    ? item as IssuedBlock
    : { type: 'question' as const, question: item as FormQuestion });
}

export type EmployeeDashboardHistoryItem = {
  id: number;
  title: string;
  subtitle: string;
  status: string;
  occurredAt: string | null;
};

export type EmployeeDashboard = {
  currentDate: string;
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
    evaluatorId: evaluation.evaluator_id,
    campaignId: evaluation.campaign_id,
    campaignName: evaluation.campaign_name,
    campaignStartDate: evaluation.campaign_start_date,
    campaignIsActive: evaluation.campaign_is_active,
    campaignLifecycleStatus: evaluation.campaign_lifecycle_status,
    currentDate: evaluation.current_date,
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
    currentDate: dashboard.current_date,
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

async function requestApi<T>(getAccessToken: AccessTokenGetter, path: string, options: RequestInit, fallback: string): Promise<T> {
  const response = await authenticatedApiFetch(getAccessToken, path, options);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : fallback);
  }
  return response.json() as Promise<T>;
}

export async function fetchAssignedEvaluations(
  getAccessToken: AccessTokenGetter,
  userId: number,
  signal: AbortSignal,
): Promise<AssignedEvaluation[]> {
  const evaluations = await requestApi<AssignedEvaluationResponse[]>(
    getAccessToken,
    `/users/${userId}/assigned-evaluations`,
    { signal },
    'Assigned evaluations could not be loaded.',
  );
  return evaluations.map(mapAssignedEvaluation);
}

export async function fetchEmployeeDashboard(
  getAccessToken: AccessTokenGetter,
  userId: number,
  signal: AbortSignal,
): Promise<EmployeeDashboard> {
  return mapEmployeeDashboard(
    await requestApi<EmployeeDashboardResponse>(
      getAccessToken,
      `/users/${userId}/employee-dashboard`,
      { signal },
      'Employee dashboard could not be loaded.',
    ),
  );
}

export async function fetchAssignedQuestionnaire(getAccessToken: AccessTokenGetter, userId: number, evaluationId: number, signal: AbortSignal): Promise<AssignedQuestionnaire> {
  const result = await requestApi<{ evaluation: AssignedEvaluationResponse; questions: Array<IssuedBlock | FormQuestion>; answers: QuestionnaireAnswer[] }>(
    getAccessToken,
    `/users/${userId}/assigned-evaluations/${evaluationId}`, { signal }, 'Questionnaire could not be loaded.',
  );
  return { evaluation: mapAssignedEvaluation(result.evaluation), blocks: mapIssuedBlocks(result.questions), answers: result.answers };
}

export async function saveAssignedQuestionnaire(getAccessToken: AccessTokenGetter, userId: number, evaluationId: number, answers: QuestionnaireAnswer[], submit: boolean): Promise<AssignedQuestionnaire> {
  const result = await requestApi<{ evaluation: AssignedEvaluationResponse; questions: Array<IssuedBlock | FormQuestion>; answers: QuestionnaireAnswer[] }>(
    getAccessToken,
    `/users/${userId}/assigned-evaluations/${evaluationId}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers, submit }) },
    'Questionnaire could not be saved.',
  );
  return { evaluation: mapAssignedEvaluation(result.evaluation), blocks: mapIssuedBlocks(result.questions), answers: result.answers };
}

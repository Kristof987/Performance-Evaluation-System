import { authenticatedApiFetch, type AccessTokenGetter } from '../../auth/authenticated-api';

export type CompletionStatusSummary = {
  total_evaluations: number;
  not_started: number;
  in_progress: number;
  completed: number;
  overdue: number;
  completion_rate: number;
  outstanding: number;
};

export type CompletionStatusCampaign = {
  id: number;
  name: string;
  is_active: boolean;
  start_date: string;
  end_date: string | null;
};

export type CompletionStatusRow = {
  id: number;
  evaluator_id: number;
  evaluator_name: string;
  evaluator_email: string | null;
  evaluatee_id: number;
  evaluatee_name: string;
  evaluatee_email: string | null;
  questionnaire_id: number;
  questionnaire_name: string;
  status_name: string;
  status_label: 'Not started' | 'In progress' | 'Completed' | string;
  due_date: string | null;
  completed_at: string | null;
  is_overdue: boolean;
  is_self_evaluation: boolean;
};

export type CompletionStatusResponse = {
  campaign: CompletionStatusCampaign;
  summary: CompletionStatusSummary;
  rows: CompletionStatusRow[];
  questionnaires: { id: number; name: string }[];
  pagination: { page: number; page_size: number; total_items: number; total_pages: number };
  duplicate_assignment_count: number;
};

export type CompletionStatusQuery = {
  search: string;
  status: string;
  questionnaireId: string;
  overdueOnly: boolean;
  sort: string;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
};

export async function fetchCompletionStatus(getAccessToken: AccessTokenGetter, campaignId: number, query: CompletionStatusQuery, signal: AbortSignal): Promise<CompletionStatusResponse> {
  const params = new URLSearchParams({
    sort: query.sort,
    order: query.order,
    page: String(query.page),
    page_size: String(query.pageSize),
  });
  if (query.search.trim() !== '') params.set('search', query.search.trim());
  if (query.status !== '') params.set('status', query.status);
  if (query.questionnaireId !== '') params.set('questionnaire_id', query.questionnaireId);
  if (query.overdueOnly) params.set('overdue_only', 'true');

  const response = await authenticatedApiFetch(getAccessToken, `/campaigns/${campaignId}/completion-status?${params.toString()}`, { signal });
  if (!response.ok) {
    const fallback = response.status === 403 ? 'You are not authorized to view this campaign.' : response.status === 404 ? 'Campaign not found.' : 'Completion status could not be loaded.';
    throw new Error(fallback);
  }
  return await response.json() as CompletionStatusResponse;
}

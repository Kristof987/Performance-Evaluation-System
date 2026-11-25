import { authenticatedApiFetch, type AccessTokenGetter } from '../../auth/authenticated-api';

export type CompletionStatusSummary = {
  total_evaluations: number;
  not_started: number;
  in_progress: number;
  completed: number;
  overdue: number;
  completion_rate: number;
  outstanding: number;
  evaluators: number;
  evaluators_done: number;
};

export type CompletionStatusCampaign = {
  id: number;
  name: string;
  is_active: boolean;
  start_date: string;
  end_date: string | null;
};

/** One evaluator's progress. The API deliberately never says whom they evaluate. */
export type CompletionStatusRow = {
  evaluator_id: number;
  evaluator_name: string;
  evaluator_email: string | null;
  total: number;
  not_started: number;
  in_progress: number;
  completed: number;
  outstanding: number;
  overdue: number;
  status_label: 'Not started' | 'In progress' | 'Completed' | string;
  due_date: string | null;
  last_completed_at: string | null;
};

export type CompletionStatusResponse = {
  campaign: CompletionStatusCampaign;
  summary: CompletionStatusSummary;
  rows: CompletionStatusRow[];
  pagination: { page: number; page_size: number; total_items: number; total_pages: number };
  duplicate_assignment_count: number;
};

type CompletionStatusQuery = {
  search: string;
  status: string;
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
  if (query.overdueOnly) params.set('overdue_only', 'true');

  const response = await authenticatedApiFetch(getAccessToken, `/campaigns/${campaignId}/completion-status?${params.toString()}`, { signal });
  if (!response.ok) {
    const fallback = response.status === 403 ? 'You are not authorized to view this campaign.' : response.status === 404 ? 'Campaign not found.' : 'Completion status could not be loaded.';
    throw new Error(fallback);
  }
  return await response.json() as CompletionStatusResponse;
}

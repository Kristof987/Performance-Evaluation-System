import { authenticatedApiFetch, type AccessTokenGetter } from '../../../auth/authenticated-api';
import type { AIAnalysis, AIAnalysisGenerationJob, AIAnalysisHistory, AIAnalysisScope, AnalysisVersion } from '../types/ai-analysis.types';

const generationErrors: Record<string, string> = {
  analysis_timeout: 'AI generation timed out. No analysis was saved.',
  analysis_rate_limited: 'The AI provider is rate limiting requests. Please try again later.',
  analysis_provider_unavailable: 'AI generation is temporarily unavailable.',
  analysis_not_configured: 'AI generation has not been configured by the administrator.',
  invalid_analysis_configuration: 'AI generation configuration is invalid. Contact an administrator.',
  insufficient_analysis_data: 'There is not enough reportable evidence to generate an analysis.',
  analysis_context_too_large: 'The reportable context is too large to generate safely.',
  analysis_refused_or_empty: 'The AI provider returned no usable analysis. No analysis was saved.',
  invalid_analysis_output: 'The AI response did not pass validation. No analysis was saved.',
  invalid_analysis_evidence: 'The AI response cited unsupported evidence. No analysis was saved.',
  invalid_analysis_claim: 'The AI response contained an unsupported claim. No analysis was saved.',
  worker_interrupted: 'Generation was interrupted before completion. No analysis was saved; retry explicitly.',
  generation_queue_expired: 'Generation could not be started in time. Retry explicitly.',
  authorization_changed: 'Access changed before generation completed. No analysis was saved.',
  scope_unavailable: 'The report scope is no longer available. No analysis was saved.',
  generation_conflict: 'The report changed or generation could not be completed. Review the report before retrying.',
  analysis_generation_failed: 'Generation failed without a saved analysis. Retry explicitly.',
};

export function generationErrorMessage(code: string | null) {
  return code ? generationErrors[code] ?? 'AI generation failed. No analysis was saved.' : 'AI generation failed. No analysis was saved.';
}

function basePath(scope: AIAnalysisScope) {
  const campaignPath = `/reports/campaigns/${encodeURIComponent(scope.campaignId)}`;
  switch (scope.type) {
    case 'employee': return `${campaignPath}/employees/${encodeURIComponent(scope.employeeId)}/ai-analysis`;
    case 'group': return `${campaignPath}/groups/${encodeURIComponent(scope.groupId)}/ai-analysis`;
    case 'role': return `${campaignPath}/roles/${encodeURIComponent(scope.roleId)}/ai-analysis`;
    case 'campaign': return `${campaignPath}/ai-analysis`;
  }
}

async function request<T>(getAccessToken: AccessTokenGetter, path: string, init: RequestInit = {}): Promise<T> {
  const response = await authenticatedApiFetch(getAccessToken, path, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string' ? body.detail : null;
    throw new Error(detail ? generationErrors[detail] ?? detail : 'AI analysis request failed.');
  }
  return response.json() as Promise<T>;
}

export function fetchAIAnalyses(getAccessToken: AccessTokenGetter, scope: AIAnalysisScope, signal: AbortSignal) {
  return request<AIAnalysisHistory>(getAccessToken, basePath(scope), { signal });
}

export function generateAIAnalysis(getAccessToken: AccessTokenGetter, scope: AIAnalysisScope, signal: AbortSignal) {
  return request<AIAnalysisGenerationJob>(getAccessToken, `${basePath(scope)}/generate`, { method: 'POST', signal });
}

export function fetchLatestGenerationJob(getAccessToken: AccessTokenGetter, scope: AIAnalysisScope, signal: AbortSignal) {
  return request<AIAnalysisGenerationJob | null>(getAccessToken, `${basePath(scope)}/generation-job`, { signal });
}

export function fetchGenerationJob(getAccessToken: AccessTokenGetter, scope: AIAnalysisScope, jobId: number, signal: AbortSignal) {
  return request<AIAnalysisGenerationJob>(getAccessToken, `${basePath(scope)}/generation-job/${encodeURIComponent(jobId)}`, { signal });
}

export function saveAIAnalysis(getAccessToken: AccessTokenGetter, scope: AIAnalysisScope, analysisId: number, analysis: AIAnalysis) {
  return request<AnalysisVersion>(getAccessToken, `${basePath(scope)}/${encodeURIComponent(analysisId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(analysis),
  });
}

export function approveAIAnalysis(getAccessToken: AccessTokenGetter, scope: AIAnalysisScope, analysisId: number) {
  return request<AnalysisVersion>(getAccessToken, `${basePath(scope)}/${encodeURIComponent(analysisId)}/approve`, { method: 'POST' });
}

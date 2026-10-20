import { authenticatedApiFetch, type AccessTokenGetter } from '../../../auth/authenticated-api';
import type { AnalysisVersion, EmployeeAIAnalysis, EmployeeAIAnalysisHistory } from '../types/ai-analysis.types';

const basePath = (campaignId: number, employeeId: number) =>
  `/reports/campaigns/${encodeURIComponent(campaignId)}/employees/${encodeURIComponent(employeeId)}/ai-analysis`;

async function request<T>(getAccessToken: AccessTokenGetter, path: string, init: RequestInit = {}): Promise<T> {
  const response = await authenticatedApiFetch(getAccessToken, path, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string' ? body.detail : null;
    const messages: Record<string, string> = {
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
    };
    throw new Error(detail ? messages[detail] ?? detail : 'AI analysis request failed.');
  }
  return response.json() as Promise<T>;
}

export function fetchAIAnalyses(getAccessToken: AccessTokenGetter, campaignId: number, employeeId: number, signal: AbortSignal) {
  return request<EmployeeAIAnalysisHistory>(getAccessToken, basePath(campaignId, employeeId), { signal });
}

export function generateAIAnalysis(getAccessToken: AccessTokenGetter, campaignId: number, employeeId: number) {
  return request<AnalysisVersion>(getAccessToken, `${basePath(campaignId, employeeId)}/generate`, { method: 'POST' });
}

export function saveAIAnalysis(getAccessToken: AccessTokenGetter, campaignId: number, employeeId: number, analysisId: number, analysis: EmployeeAIAnalysis) {
  return request<AnalysisVersion>(getAccessToken, `${basePath(campaignId, employeeId)}/${encodeURIComponent(analysisId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(analysis),
  });
}

export function approveAIAnalysis(getAccessToken: AccessTokenGetter, campaignId: number, employeeId: number, analysisId: number) {
  return request<AnalysisVersion>(getAccessToken, `${basePath(campaignId, employeeId)}/${encodeURIComponent(analysisId)}/approve`, { method: 'POST' });
}

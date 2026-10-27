import { authenticatedApiFetch, type AccessTokenGetter } from '../../../auth/authenticated-api';
import type { CampaignRatingDistribution, CampaignReportOverview, EmployeeReportDetail, EmployeeReportsOverview, GroupReportDetail, GroupsReport, ReportCampaignOption, ReportQuestions, ReportSectionComparison, RolePerspective, RoleReportDetail, RolesReport } from '../types/reports.types';

async function requestReports<T>(getAccessToken: AccessTokenGetter, path: string, signal: AbortSignal, fallback: string): Promise<T> {
  const response = await authenticatedApiFetch(getAccessToken, `/reports${path}`, { signal });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : fallback);
  }
  return response.json() as Promise<T>;
}

export function fetchReportCampaigns(getAccessToken: AccessTokenGetter, signal: AbortSignal) {
  return requestReports<ReportCampaignOption[]>(
    getAccessToken,
    '/campaigns',
    signal,
    'Campaigns could not be loaded.',
  );
}

export function fetchCampaignReportOverview(getAccessToken: AccessTokenGetter, campaignId: number, signal: AbortSignal) {
  return requestReports<CampaignReportOverview>(
    getAccessToken,
    `/campaigns/${encodeURIComponent(campaignId)}/overview`,
    signal,
    'Campaign report could not be loaded.',
  );
}

export function fetchCampaignRatingDistribution(getAccessToken: AccessTokenGetter, campaignId: number, signal: AbortSignal) {
  return requestReports<CampaignRatingDistribution>(getAccessToken, `/campaigns/${encodeURIComponent(campaignId)}/rating-distribution`, signal, 'Rating distribution could not be loaded.');
}

export function fetchSectionComparison(getAccessToken: AccessTokenGetter, campaignId: number, sectionId: number, signal: AbortSignal) {
  return requestReports<ReportSectionComparison>(getAccessToken, `/campaigns/${encodeURIComponent(campaignId)}/sections/${encodeURIComponent(sectionId)}/comparison`, signal, 'Section comparison could not be loaded.');
}

export function fetchReportQuestions(getAccessToken: AccessTokenGetter, campaignId: number, scope: { group_id?: number; role_id?: number; employee_id?: number; perspective?: RolePerspective }, evaluationType: 'peer' | 'self', signal: AbortSignal) {
  const params = new URLSearchParams({ evaluation_type: evaluationType });
  for (const [key, value] of Object.entries(scope)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return requestReports<ReportQuestions>(getAccessToken, `/campaigns/${encodeURIComponent(campaignId)}/questions?${params}`, signal, 'Question analytics could not be loaded.');
}

export function fetchGroupsReport(getAccessToken: AccessTokenGetter, campaignId: number, signal: AbortSignal) {
  return requestReports<GroupsReport>(
    getAccessToken,
    `/campaigns/${encodeURIComponent(campaignId)}/groups`,
    signal,
    'Group reports could not be loaded.',
  );
}

export function fetchGroupReportDetail(getAccessToken: AccessTokenGetter, campaignId: number, groupId: number, signal: AbortSignal) {
  return requestReports<GroupReportDetail>(
    getAccessToken,
    `/campaigns/${encodeURIComponent(campaignId)}/groups/${encodeURIComponent(groupId)}`,
    signal,
    'Group report could not be loaded.',
  );
}

export function fetchRolesReport(getAccessToken: AccessTokenGetter, campaignId: number, perspective: RolePerspective, signal: AbortSignal) {
  return requestReports<RolesReport>(
    getAccessToken,
    `/campaigns/${encodeURIComponent(campaignId)}/roles?perspective=${encodeURIComponent(perspective)}`,
    signal,
    'Role reports could not be loaded.',
  );
}

export function fetchRoleReportDetail(getAccessToken: AccessTokenGetter, campaignId: number, roleId: number, perspective: RolePerspective, signal: AbortSignal) {
  return requestReports<RoleReportDetail>(
    getAccessToken,
    `/campaigns/${encodeURIComponent(campaignId)}/roles/${encodeURIComponent(roleId)}?perspective=${encodeURIComponent(perspective)}`,
    signal,
    'Role report could not be loaded.',
  );
}

export function fetchEmployeeReportsOverview(getAccessToken: AccessTokenGetter, campaignId: number, signal: AbortSignal) {
  return requestReports<EmployeeReportsOverview>(
    getAccessToken,
    `/campaigns/${encodeURIComponent(campaignId)}/employees`,
    signal,
    'Employee reports could not be loaded.',
  );
}

export function fetchEmployeeReportDetail(getAccessToken: AccessTokenGetter, campaignId: number, employeeId: number, signal: AbortSignal) {
  return requestReports<EmployeeReportDetail>(
    getAccessToken,
    `/campaigns/${encodeURIComponent(campaignId)}/employees/${encodeURIComponent(employeeId)}`,
    signal,
    'Employee report could not be loaded.',
  );
}

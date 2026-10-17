import { API_BASE_URL } from '../../../config';
import type { CampaignReportOverview, EmployeeReportDetail, EmployeeReportsOverview, GroupReportDetail, GroupsReport, ReportCampaignOption, ReportQuestions, RolePerspective, RoleReportDetail, RolesReport } from '../types/reports.types';

async function requestReports<T>(path: string, signal: AbortSignal, fallback: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/reports${path}`, { signal });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : fallback);
  }
  return response.json() as Promise<T>;
}

export function fetchReportCampaigns(requesterUserId: number, signal: AbortSignal) {
  return requestReports<ReportCampaignOption[]>(
    `/campaigns?requester_user_id=${encodeURIComponent(requesterUserId)}`,
    signal,
    'Campaigns could not be loaded.',
  );
}

export function fetchCampaignReportOverview(campaignId: number, requesterUserId: number, signal: AbortSignal) {
  return requestReports<CampaignReportOverview>(
    `/campaigns/${encodeURIComponent(campaignId)}/overview?requester_user_id=${encodeURIComponent(requesterUserId)}`,
    signal,
    'Campaign report could not be loaded.',
  );
}

export function fetchReportQuestions(campaignId: number, requesterUserId: number, scope: { group_id?: number; role_id?: number; employee_id?: number; perspective?: RolePerspective }, evaluationType: 'peer' | 'self', signal: AbortSignal) {
  const params = new URLSearchParams({ requester_user_id: String(requesterUserId), evaluation_type: evaluationType });
  for (const [key, value] of Object.entries(scope)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return requestReports<ReportQuestions>(`/campaigns/${encodeURIComponent(campaignId)}/questions?${params}`, signal, 'Question analytics could not be loaded.');
}

export function fetchGroupsReport(campaignId: number, requesterUserId: number, signal: AbortSignal) {
  return requestReports<GroupsReport>(
    `/campaigns/${encodeURIComponent(campaignId)}/groups?requester_user_id=${encodeURIComponent(requesterUserId)}`,
    signal,
    'Group reports could not be loaded.',
  );
}

export function fetchGroupReportDetail(campaignId: number, groupId: number, requesterUserId: number, signal: AbortSignal) {
  return requestReports<GroupReportDetail>(
    `/campaigns/${encodeURIComponent(campaignId)}/groups/${encodeURIComponent(groupId)}?requester_user_id=${encodeURIComponent(requesterUserId)}`,
    signal,
    'Group report could not be loaded.',
  );
}

export function fetchRolesReport(campaignId: number, requesterUserId: number, perspective: RolePerspective, signal: AbortSignal) {
  return requestReports<RolesReport>(
    `/campaigns/${encodeURIComponent(campaignId)}/roles?perspective=${encodeURIComponent(perspective)}&requester_user_id=${encodeURIComponent(requesterUserId)}`,
    signal,
    'Role reports could not be loaded.',
  );
}

export function fetchRoleReportDetail(campaignId: number, roleId: number, requesterUserId: number, perspective: RolePerspective, signal: AbortSignal) {
  return requestReports<RoleReportDetail>(
    `/campaigns/${encodeURIComponent(campaignId)}/roles/${encodeURIComponent(roleId)}?perspective=${encodeURIComponent(perspective)}&requester_user_id=${encodeURIComponent(requesterUserId)}`,
    signal,
    'Role report could not be loaded.',
  );
}

export function fetchEmployeeReportsOverview(campaignId: number, requesterUserId: number, signal: AbortSignal) {
  return requestReports<EmployeeReportsOverview>(
    `/campaigns/${encodeURIComponent(campaignId)}/employees?requester_user_id=${encodeURIComponent(requesterUserId)}`,
    signal,
    'Employee reports could not be loaded.',
  );
}

export function fetchEmployeeReportDetail(campaignId: number, employeeId: number, requesterUserId: number, signal: AbortSignal) {
  return requestReports<EmployeeReportDetail>(
    `/campaigns/${encodeURIComponent(campaignId)}/employees/${encodeURIComponent(employeeId)}?requester_user_id=${encodeURIComponent(requesterUserId)}`,
    signal,
    'Employee report could not be loaded.',
  );
}

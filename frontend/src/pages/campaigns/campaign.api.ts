import type {
  Campaign,
  CampaignEvaluationMatrix,
  CampaignEvaluationMatrixResponse,
  CampaignEvaluationMatrixUpdateResponse,
  CampaignEvaluationRules,
  CampaignEvaluationRulesResponse,
  CampaignFormValues,
  CampaignGroups,
  CampaignGroupsResponse,
  CampaignOperationalMetrics,
  CampaignResponse,
  CampaignSelfEvaluations,
  CampaignSelfEvaluationsResponse,
} from './campaign.types';
import { budapestInstant, budapestLocal, mapCampaignFromResponse } from './campaign.utils';

import { authenticatedApiFetch, type AccessTokenGetter } from '../../auth/authenticated-api';

async function requestCampaigns<T>(
  getAccessToken: AccessTokenGetter,
  path: string,
  options: RequestInit,
  fallback: string,
): Promise<T> {
  const response = await authenticatedApiFetch(getAccessToken, `/campaigns${path}`, options);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    const message = detail && typeof detail === 'object' && 'message' in detail ? detail.message : null;
    throw new Error(typeof detail === 'string' ? detail : typeof message === 'string' ? message : fallback);
  }
  return response.json() as Promise<T>;
}

function mapSelfEvaluations(response: CampaignSelfEvaluationsResponse): CampaignSelfEvaluations {
  return {
    forms: response.forms,
    participants: response.participants.map((person) => ({
      employeeId: person.employee_id,
      name: person.employee_name,
      roleName: person.role_name,
      groupNames: person.group_names,
      formId: person.form_id,
      locked: person.locked,
    })),
  };
}

export async function fetchCampaignSelfEvaluations(getAccessToken: AccessTokenGetter, id: string, signal: AbortSignal) {
  return mapSelfEvaluations(await requestCampaigns<CampaignSelfEvaluationsResponse>(
    getAccessToken,
    `/${encodeURIComponent(id)}/self-evaluations`, { signal }, 'Self-evaluations could not be loaded.',
  ));
}

export async function updateCampaignSelfEvaluations(getAccessToken: AccessTokenGetter, id: string, assignments: Array<{ employeeId: number; formId: number | null }>) {
  return mapSelfEvaluations(await requestCampaigns<CampaignSelfEvaluationsResponse>(
    getAccessToken,
    `/${encodeURIComponent(id)}/self-evaluations`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments: assignments.map((item) => ({ employee_id: item.employeeId, form_id: item.formId })) }),
    }, 'Self-evaluations could not be saved.',
  ));
}

function mapCampaignGroups(response: CampaignGroupsResponse): CampaignGroups {
  return {
    availableGroups: response.available_groups,
    assignedGroupIds: response.assigned_group_ids,
  };
}

function mapCampaignEvaluationRules(
  response: CampaignEvaluationRulesResponse,
): CampaignEvaluationRules {
  return {
    forms: response.forms,
    groups: response.groups.map((group) => ({
      groupId: group.group_id,
      groupName: group.group_name,
      rolePairs: group.role_pairs.map((rule) => ({
        evaluatorRoleId: rule.evaluator_role_id,
        evaluatorRoleName: rule.evaluator_role_name,
        evaluateeRoleId: rule.evaluatee_role_id,
        evaluateeRoleName: rule.evaluatee_role_name,
        formId: rule.form_id,
        ruleId: rule.rule_id,
        locked: rule.locked ?? false,
      })),
    })),
  };
}

function mapCampaignEvaluationMatrix(
  response: CampaignEvaluationMatrixResponse,
): CampaignEvaluationMatrix {
  return {
    issuanceErrors: response.issuance_errors ?? [],
    groups: response.groups.map((group) => ({
      groupId: group.group_id,
      groupName: group.group_name,
      employees: group.employees.map((employee) => ({
        id: employee.id,
        name: employee.name,
        roleId: employee.role_id,
        roleName: employee.role_name,
        active: employee.active ?? true,
      })),
      assignments: group.assignments.map((assignment) => ({
        evaluatorId: assignment.evaluator_id,
        evaluateeId: assignment.evaluatee_id,
        formId: assignment.form_id,
        filledFormId: assignment.filled_form_id,
        issued: assignment.issued,
        isCompleted: assignment.is_completed,
        statusName: assignment.status_name,
        hasAnswers: assignment.has_answers,
      })),
    })),
  };
}

function getPayload(form: CampaignFormValues, campaign?: Campaign) {
  return {
    name: form.name,
    description: form.description || null,
    start_date: campaign && form.startLocal === budapestLocal(campaign.startAt) ? campaign.startAt : budapestInstant(form.startLocal),
    end_date: campaign && form.endLocal === (campaign.endAt ? budapestLocal(campaign.endAt) : '') ? campaign.endAt : form.endLocal ? budapestInstant(form.endLocal) : null,
    comment: form.comment || null,
  };
}

export async function changeCampaignSchedule(getAccessToken: AccessTokenGetter, id: string, action: 'schedule' | 'unschedule'): Promise<Campaign> {
  return mapCampaignFromResponse(await requestCampaigns<CampaignResponse>(
    getAccessToken, `/${encodeURIComponent(id)}/${action}`, { method: 'POST' },
    `Campaign could not be ${action === 'schedule' ? 'scheduled' : 'returned to draft'}.`,
  ));
}

export type CampaignLifecycleAction = 'pause' | 'resume' | 'review' | 'close';

export async function changeCampaignLifecycle(getAccessToken: AccessTokenGetter, id: string, action: CampaignLifecycleAction): Promise<Campaign> {
  return mapCampaignFromResponse(await requestCampaigns<CampaignResponse>(
    getAccessToken, `/${encodeURIComponent(id)}/${action}`, { method: 'POST' },
    'Campaign status could not be updated.',
  ));
}

export async function fetchCampaignOperationalMetrics(getAccessToken: AccessTokenGetter, id: string): Promise<CampaignOperationalMetrics> {
  return requestCampaigns<CampaignOperationalMetrics>(
    getAccessToken, `/${encodeURIComponent(id)}/operational-metrics`, {},
    'Campaign completion metrics could not be loaded.',
  );
}

export async function fetchCampaigns(getAccessToken: AccessTokenGetter, signal: AbortSignal): Promise<Campaign[]> {
  const campaigns = await requestCampaigns<CampaignResponse[]>(
    getAccessToken,
    '',
    { signal },
    'Campaigns could not be loaded.',
  );
  return campaigns.map(mapCampaignFromResponse);
}

export async function fetchCampaign(
  getAccessToken: AccessTokenGetter,
  id: string,
  signal: AbortSignal,
): Promise<Campaign> {
  return mapCampaignFromResponse(
    await requestCampaigns<CampaignResponse>(
      getAccessToken,
      `/${encodeURIComponent(id)}`,
      { signal },
      'Campaign could not be loaded.',
    ),
  );
}

export async function createCampaign(
  getAccessToken: AccessTokenGetter,
  form: CampaignFormValues,
): Promise<Campaign> {
  return mapCampaignFromResponse(
    await requestCampaigns<CampaignResponse>(
      getAccessToken,
      '',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getPayload(form)),
      },
      'Campaign could not be saved.',
    ),
  );
}

export async function updateCampaign(
  getAccessToken: AccessTokenGetter,
  campaign: Campaign,
  form: CampaignFormValues,
): Promise<Campaign> {
  return mapCampaignFromResponse(
    await requestCampaigns<CampaignResponse>(
      getAccessToken,
      `/${encodeURIComponent(campaign.id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getPayload(form, campaign)),
      },
      'Campaign could not be updated.',
    ),
  );
}

export async function fetchCampaignGroups(
  getAccessToken: AccessTokenGetter,
  id: string,
  signal: AbortSignal,
): Promise<CampaignGroups> {
  return mapCampaignGroups(
    await requestCampaigns<CampaignGroupsResponse>(
      getAccessToken,
      `/${encodeURIComponent(id)}/groups`,
      { signal },
      'Campaign groups could not be loaded.',
    ),
  );
}

export async function updateCampaignGroups(
  getAccessToken: AccessTokenGetter,
  id: string,
  groupIds: number[],
): Promise<CampaignGroups> {
  return mapCampaignGroups(
    await requestCampaigns<CampaignGroupsResponse>(
      getAccessToken,
      `/${encodeURIComponent(id)}/groups`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_ids: groupIds }),
      },
      'Campaign groups could not be updated.',
    ),
  );
}

export async function fetchCampaignEvaluationRules(
  getAccessToken: AccessTokenGetter,
  id: string,
  signal: AbortSignal,
): Promise<CampaignEvaluationRules> {
  return mapCampaignEvaluationRules(
    await requestCampaigns<CampaignEvaluationRulesResponse>(
      getAccessToken,
      `/${encodeURIComponent(id)}/evaluation-rules`,
      { signal },
      'Campaign form rules could not be loaded.',
    ),
  );
}

export async function updateCampaignEvaluationRules(
  getAccessToken: AccessTokenGetter,
  id: string,
  rules: Array<{
    companyGroupId: number;
    evaluatorRoleId: number;
    evaluateeRoleId: number;
    formId: number;
  }>,
): Promise<CampaignEvaluationRules> {
  return mapCampaignEvaluationRules(
    await requestCampaigns<CampaignEvaluationRulesResponse>(
      getAccessToken,
      `/${encodeURIComponent(id)}/evaluation-rules`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rules: rules.map((rule) => ({
            company_group_id: rule.companyGroupId,
            evaluator_role_id: rule.evaluatorRoleId,
            evaluatee_role_id: rule.evaluateeRoleId,
            form_id: rule.formId,
          })),
        }),
      },
      'Campaign form rules could not be updated.',
    ),
  );
}

export async function fetchCampaignEvaluationMatrix(
  getAccessToken: AccessTokenGetter,
  id: string,
  signal: AbortSignal,
): Promise<CampaignEvaluationMatrix> {
  return mapCampaignEvaluationMatrix(
    await requestCampaigns<CampaignEvaluationMatrixResponse>(
      getAccessToken,
      `/${encodeURIComponent(id)}/evaluation-matrix`,
      { signal },
      'Campaign evaluation matrix could not be loaded.',
    ),
  );
}

export async function fetchCampaignSetupPreview(getAccessToken: AccessTokenGetter, id: string, groupIds: number[], signal: AbortSignal) {
  const query = new URLSearchParams();
  groupIds.forEach((groupId) => query.append('group_ids', String(groupId)));
  const response = await requestCampaigns<{
    rules: CampaignEvaluationRulesResponse;
    self_evaluations: CampaignSelfEvaluationsResponse;
    matrix: CampaignEvaluationMatrixResponse;
  }>(getAccessToken, `/${encodeURIComponent(id)}/setup-preview?${query}`, { signal }, 'Selected group setup could not be loaded.');
  return {
    rules: mapCampaignEvaluationRules(response.rules),
    selfEvaluations: mapSelfEvaluations(response.self_evaluations),
    matrix: mapCampaignEvaluationMatrix(response.matrix),
  };
}

export async function updateCampaignEvaluationMatrix(
  getAccessToken: AccessTokenGetter,
  id: string,
  assignments: Array<{
    companyGroupId: number;
    evaluatorId: number;
    evaluateeId: number;
  }>,
): Promise<CampaignEvaluationMatrix & {
  createdCount: number;
  removedCount: number;
  keptCompletedCount: number;
}> {
  const response = await requestCampaigns<CampaignEvaluationMatrixUpdateResponse>(
    getAccessToken,
    `/${encodeURIComponent(id)}/evaluation-matrix`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignments: assignments.map((assignment) => ({
          company_group_id: assignment.companyGroupId,
          evaluator_id: assignment.evaluatorId,
          evaluatee_id: assignment.evaluateeId,
        })),
      }),
    },
    'Campaign evaluation matrix could not be updated.',
  );
  return {
    ...mapCampaignEvaluationMatrix(response),
    createdCount: response.created_count,
    removedCount: response.removed_count,
    keptCompletedCount: response.kept_completed_count,
  };
}

export async function updateCampaignSetup(
  getAccessToken: AccessTokenGetter,
  id: string,
  groupIds: number[],
  rules: Array<{ companyGroupId: number; evaluatorRoleId: number; evaluateeRoleId: number; formId: number }>,
  selfEvaluations: Array<{ employeeId: number; formId: number | null }>,
  assignments: Array<{ companyGroupId: number; evaluatorId: number; evaluateeId: number }>,
): Promise<CampaignEvaluationMatrix> {
  const response = await requestCampaigns<CampaignEvaluationMatrixResponse>(
    getAccessToken, `/${encodeURIComponent(id)}/setup`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_ids: groupIds,
        rules: rules.map((rule) => ({ company_group_id: rule.companyGroupId, evaluator_role_id: rule.evaluatorRoleId, evaluatee_role_id: rule.evaluateeRoleId, form_id: rule.formId })),
        self_evaluations: selfEvaluations.map((item) => ({ employee_id: item.employeeId, form_id: item.formId })),
        assignments: assignments.map((item) => ({ company_group_id: item.companyGroupId, evaluator_id: item.evaluatorId, evaluatee_id: item.evaluateeId })),
      }),
    }, 'Campaign setup could not be saved.',
  );
  return mapCampaignEvaluationMatrix(response);
}

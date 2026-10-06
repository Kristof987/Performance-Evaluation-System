import type {
  Campaign,
  CampaignEvaluationRules,
  CampaignEvaluationRulesResponse,
  CampaignFormValues,
  CampaignGroups,
  CampaignGroupsResponse,
  CampaignResponse,
} from './campaign.types';
import { mapCampaignFromResponse } from './campaign.utils';

import { API_BASE_URL } from '../../config';

async function requestCampaigns<T>(
  path: string,
  options: RequestInit,
  fallback: string,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/campaigns${path}`, options);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : fallback);
  }
  return response.json() as Promise<T>;
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
      })),
    })),
  };
}

function getPayload(form: CampaignFormValues) {
  return {
    name: form.name,
    description: form.description || null,
    start_date: form.startDate,
    end_date: form.endDate || null,
    is_active: form.isActive,
    comment: form.comment || null,
  };
}

export async function fetchCampaigns(signal: AbortSignal): Promise<Campaign[]> {
  const campaigns = await requestCampaigns<CampaignResponse[]>(
    '',
    { signal },
    'Campaigns could not be loaded.',
  );
  return campaigns.map(mapCampaignFromResponse);
}

export async function fetchCampaign(
  id: string,
  signal: AbortSignal,
): Promise<Campaign> {
  return mapCampaignFromResponse(
    await requestCampaigns<CampaignResponse>(
      `/${encodeURIComponent(id)}`,
      { signal },
      'Campaign could not be loaded.',
    ),
  );
}

export async function createCampaign(
  form: CampaignFormValues,
  userId: number,
): Promise<Campaign> {
  return mapCampaignFromResponse(
    await requestCampaigns<CampaignResponse>(
      '',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...getPayload(form), created_by: userId }),
      },
      'Campaign could not be saved.',
    ),
  );
}

export async function updateCampaign(
  id: string,
  form: CampaignFormValues,
): Promise<Campaign> {
  return mapCampaignFromResponse(
    await requestCampaigns<CampaignResponse>(
      `/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getPayload(form)),
      },
      'Campaign could not be updated.',
    ),
  );
}

export async function fetchCampaignGroups(
  id: string,
  signal: AbortSignal,
): Promise<CampaignGroups> {
  return mapCampaignGroups(
    await requestCampaigns<CampaignGroupsResponse>(
      `/${encodeURIComponent(id)}/groups`,
      { signal },
      'Campaign groups could not be loaded.',
    ),
  );
}

export async function updateCampaignGroups(
  id: string,
  groupIds: number[],
): Promise<CampaignGroups> {
  return mapCampaignGroups(
    await requestCampaigns<CampaignGroupsResponse>(
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
  id: string,
  signal: AbortSignal,
): Promise<CampaignEvaluationRules> {
  return mapCampaignEvaluationRules(
    await requestCampaigns<CampaignEvaluationRulesResponse>(
      `/${encodeURIComponent(id)}/evaluation-rules`,
      { signal },
      'Campaign form rules could not be loaded.',
    ),
  );
}

export async function updateCampaignEvaluationRules(
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

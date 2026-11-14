import type { CampaignSelfEvaluations } from './campaign.types';

export function selfFormMap(data: CampaignSelfEvaluations): Record<number, number | null> {
  return Object.fromEntries(data.participants.map((person) => [person.employeeId, person.formId]));
}

export function selfFormsDirty(data: CampaignSelfEvaluations, selected: Record<number, number | null>) {
  return data.participants.some((person) => !person.locked &&
    (selected[person.employeeId] ?? null) !== person.formId);
}

import type { CampaignSelfEvaluations } from './campaign.types';

export function selfFormMap(data: CampaignSelfEvaluations): Record<number, number | null> {
  return Object.fromEntries(data.participants.map((person) => [person.employeeId, person.formId]));
}

export function selfFormsDirty(data: CampaignSelfEvaluations, selected: Record<number, number | null>) {
  return data.participants.some((person) => !person.locked &&
    (selected[person.employeeId] ?? null) !== person.formId);
}

export function previewSelfCopy(data: CampaignSelfEvaluations, selected: Record<number, number | null>, sourceId: number) {
  const source = data.participants.find((person) => person.employeeId === sourceId);
  const formId = selected[sourceId] ?? null;
  const changes: Record<number, number | null> = {};
  let protectedCount = 0;
  let unchangedCount = 0;
  let newCount = 0;
  let replacedCount = 0;
  for (const person of data.participants) {
    if (person.employeeId === sourceId) continue;
    if (person.locked) protectedCount++;
    else if ((selected[person.employeeId] ?? null) === formId) unchangedCount++;
    else if (formId !== null) {
      changes[person.employeeId] = formId;
      if (selected[person.employeeId] == null) newCount++;
      else replacedCount++;
    }
  }
  return { source, formId, changes, protectedCount, unchangedCount, newCount, replacedCount };
}

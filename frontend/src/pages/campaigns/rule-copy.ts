import type { CampaignEvaluationRules } from './campaign.types';

export type RuleCopyRequest = {
  sourceGroupId: number;
  evaluatorRoleId?: number;
  evaluateeRoleId?: number;
};

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function countAssignedRules(
  rules: CampaignEvaluationRules,
  values: Record<string, number | null>,
  groupId?: number,
): number {
  return rules.groups
    .filter((group) => groupId === undefined || group.groupId === groupId)
    .flatMap((group) => group.rolePairs.map((pair) =>
      values[`${group.groupId}:${pair.evaluatorRoleId}:${pair.evaluateeRoleId}`]
    ))
    .filter((formId) => formId != null).length;
}

export function previewRuleCopy(
  rules: CampaignEvaluationRules,
  values: Record<string, number | null>,
  request: RuleCopyRequest,
) {
  const source = rules.groups.find((group) => group.groupId === request.sourceGroupId);
  const sourcePairs = source?.rolePairs.filter((pair) =>
    request.evaluatorRoleId === undefined ||
    (pair.evaluatorRoleId === request.evaluatorRoleId && pair.evaluateeRoleId === request.evaluateeRoleId)
  ) ?? [];
  const changes: Record<string, number | null> = {};
  let matchingGroups = 0;
  let affectedGroups = 0;
  let replaced = 0;
  let cleared = 0;
  let assigned = 0;
  let protectedCount = 0;
  for (const group of rules.groups) {
    if (group.groupId === request.sourceGroupId) continue;
    let matches = 0;
    let changed = false;
    for (const pair of group.rolePairs) {
      const matching = sourcePairs.find((candidate) =>
        candidate.evaluatorRoleId === pair.evaluatorRoleId &&
        candidate.evaluateeRoleId === pair.evaluateeRoleId
      );
      if (!matching) continue;
      matches++;
      if (pair.locked) {
        protectedCount++;
        continue;
      }
      const sourceValue = values[`${request.sourceGroupId}:${pair.evaluatorRoleId}:${pair.evaluateeRoleId}`] ?? null;
      const key = `${group.groupId}:${pair.evaluatorRoleId}:${pair.evaluateeRoleId}`;
      const previous = values[key] ?? null;
      if (previous === sourceValue) continue;
      changed = true;
      changes[key] = sourceValue;
      if (sourceValue === null) cleared++;
      else if (previous === null) assigned++;
      else replaced++;
    }
    if (matches) matchingGroups++;
    if (changed) affectedGroups++;
  }
  return { source, sourcePairs, matchingGroups, affectedGroups, changes, replaced, cleared, assigned, protectedCount };
}

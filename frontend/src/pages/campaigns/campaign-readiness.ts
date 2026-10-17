import type { CampaignEvaluationRules } from './campaign.types';

export function getFormAssignmentProgress(
  rules: CampaignEvaluationRules,
  values: Record<string, number | null>,
) {
  const validForms = new Set(rules.forms.map((form) => form.id));
  const groups = rules.groups.map((group) => {
    const peerPairs = group.rolePairs.filter((pair) => pair.evaluatorRoleId !== pair.evaluateeRoleId);
    const missingPairs = peerPairs.filter((pair) => !validForms.has(
      values[`${group.groupId}:${pair.evaluatorRoleId}:${pair.evaluateeRoleId}`] ?? -1,
    ));
    return {
      groupId: group.groupId,
      groupName: group.groupName,
      available: group.rolePairs.length,
      required: peerPairs.length,
      configured: peerPairs.length - missingPairs.length,
      missing: missingPairs.length,
      firstMissing: missingPairs[0] ?? null,
    };
  });
  const required = groups.reduce((sum, group) => sum + group.required, 0);
  const missing = groups.reduce((sum, group) => sum + group.missing, 0);
  return { groups, required, configured: required - missing, missing, complete: groups.some((group) => group.available > 0) && missing === 0 };
}

export function getMatrixReadiness(
  progress: ReturnType<typeof getFormAssignmentProgress>,
  groupsDirty: boolean,
  rulesDirty: boolean,
): 'groups' | 'missing' | 'rules' | 'empty' | 'ready' {
  if (groupsDirty || progress.groups.length === 0) return 'groups';
  if (progress.groups.every((group) => group.available === 0)) return 'empty';
  if (progress.missing > 0) return 'missing';
  if (rulesDirty) return 'rules';
  return 'ready';
}

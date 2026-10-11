import type { CampaignGroupEvaluationMatrix, CampaignEvaluationMatrix, CampaignEvaluationRules } from './campaign.types';

export type MatrixSelection = Record<string, boolean>;

export function matrixKey(groupId: number, evaluatorId: number, evaluateeId: number) {
  return `${groupId}:${evaluatorId}:${evaluateeId}`;
}

export function matrixGroupWithSelfLocks(matrix: CampaignEvaluationMatrix, group: CampaignGroupEvaluationMatrix) {
  const issuedSelf = matrix.groups.flatMap((item) => item.assignments.filter((assignment) =>
    assignment.evaluatorId === assignment.evaluateeId && group.employees.some((person) => person.id === assignment.evaluatorId)
  ));
  return { ...group, assignments: [
    ...group.assignments,
    ...issuedSelf.filter((assignment) => !group.assignments.some((item) => item.evaluatorId === assignment.evaluatorId && item.evaluateeId === assignment.evaluateeId)),
  ] };
}

export function matrixCell(
  group: CampaignGroupEvaluationMatrix,
  _rules: CampaignEvaluationRules,
  evaluatorId: number,
  evaluateeId: number,
  selfForms: Record<number, number | null> = {},
) {
  const evaluator = group.employees.find((employee) => employee.id === evaluatorId);
  const evaluatee = group.employees.find((employee) => employee.id === evaluateeId);
  const issued = group.assignments.find((assignment) =>
    assignment.evaluatorId === evaluatorId && assignment.evaluateeId === evaluateeId
  );
  if (issued) return { editable: false, reason: issued.isCompleted
    ? 'This evaluation has been completed and is locked.'
    : issued.hasAnswers || issued.statusName?.toLowerCase() === 'in progress'
      ? 'This evaluation is in progress and cannot be changed.'
      : `This evaluation has already been issued (${issued.statusName || 'Issued'}) and cannot be changed.`, issued: true };
  if (!evaluator || !evaluatee) return { editable: false, reason: 'Employee is not in this group.', issued: false };
  if (evaluatorId === evaluateeId && selfForms[evaluatorId] == null) {
    return { editable: false, reason: 'Choose a self-evaluation form in the Self-evaluations section first.', issued: false };
  }
  return { editable: true, reason: '', issued: false };
}

export function matrixSelectedCount(selection: MatrixSelection, groupId?: number) {
  return Object.entries(selection).filter(([key, selected]) => selected &&
    (groupId === undefined || key.startsWith(`${groupId}:`))).length;
}

export function matrixDirty(selection: MatrixSelection, saved: MatrixSelection) {
  return [...new Set([...Object.keys(selection), ...Object.keys(saved)])]
    .some((key) => Boolean(selection[key]) !== Boolean(saved[key]));
}

export function toggleMatrixPair(
  group: CampaignGroupEvaluationMatrix,
  rules: CampaignEvaluationRules,
  selection: MatrixSelection,
  evaluatorId: number,
  evaluateeId: number,
  selfForms: Record<number, number | null> = {},
): MatrixSelection {
  if (!matrixCell(group, rules, evaluatorId, evaluateeId, selfForms).editable) return selection;
  const key = matrixKey(group.groupId, evaluatorId, evaluateeId);
  return { ...selection, [key]: !selection[key] };
}

export function synchronizeSelfPair(groups: CampaignGroupEvaluationMatrix[], selection: MatrixSelection, employeeId: number, selected: boolean) {
  const next = { ...selection };
  for (const group of groups) {
    if (!group.employees.some((person) => person.id === employeeId)) continue;
    const key = matrixKey(group.groupId, employeeId, employeeId);
    if (group.assignments.some((item) => item.evaluatorId === employeeId && item.evaluateeId === employeeId)) continue;
    next[key] = selected;
  }
  return next;
}

export function selectMatrixPairs(
  group: CampaignGroupEvaluationMatrix,
  rules: CampaignEvaluationRules,
  selection: MatrixSelection,
  selfOnly = false,
  selfForms: Record<number, number | null> = {},
): MatrixSelection {
  const next = { ...selection };
  for (const evaluator of group.employees) {
    for (const evaluatee of group.employees) {
      if (selfOnly && evaluator.id !== evaluatee.id) continue;
      if (!matrixCell(group, rules, evaluator.id, evaluatee.id, selfForms).editable) continue;
      next[matrixKey(group.groupId, evaluator.id, evaluatee.id)] = true;
    }
  }
  return next;
}

export function clearMatrixPairs(group: CampaignGroupEvaluationMatrix, rules: CampaignEvaluationRules, selection: MatrixSelection, selfForms: Record<number, number | null> = {}) {
  const next = { ...selection };
  for (const evaluator of group.employees) {
    for (const evaluatee of group.employees) {
      if (!matrixCell(group, rules, evaluator.id, evaluatee.id, selfForms).editable) continue;
      next[matrixKey(group.groupId, evaluator.id, evaluatee.id)] = false;
    }
  }
  return next;
}

export function generateMatrixPairs(
  group: CampaignGroupEvaluationMatrix,
  rules: CampaignEvaluationRules,
  selection: MatrixSelection,
  minimum: number,
) {
  if (!Number.isInteger(minimum) || minimum < 0 || minimum > 100) {
    throw new Error('Enter a whole number from 0 to 100.');
  }
  const next = { ...selection };
  const workload = new Map(group.employees.map((employee) => [employee.id, 0]));
  for (const evaluator of group.employees) {
    for (const evaluatee of group.employees) {
      if (next[matrixKey(group.groupId, evaluator.id, evaluatee.id)]) {
        workload.set(evaluator.id, (workload.get(evaluator.id) ?? 0) + 1);
      }
    }
  }
  const unmet: string[] = [];
  for (const evaluatee of group.employees) {
    const candidates = group.employees.filter((evaluator) => evaluator.id !== evaluatee.id &&
      matrixCell(group, rules, evaluator.id, evaluatee.id).editable);
    let received = group.employees.filter((evaluator) => evaluator.id !== evaluatee.id &&
      next[matrixKey(group.groupId, evaluator.id, evaluatee.id)]).length;
    const available = candidates.filter((evaluator) => !next[matrixKey(group.groupId, evaluator.id, evaluatee.id)])
      .sort((a, b) => (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0) || a.id - b.id);
    for (const evaluator of available) {
      if (received >= minimum) break;
      next[matrixKey(group.groupId, evaluator.id, evaluatee.id)] = true;
      workload.set(evaluator.id, (workload.get(evaluator.id) ?? 0) + 1);
      received++;
    }
    if (received < minimum) unmet.push(`${evaluatee.name} (${received}/${minimum})`);
  }
  return { selection: next, unmet };
}

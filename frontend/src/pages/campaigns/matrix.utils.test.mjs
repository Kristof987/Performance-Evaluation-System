import test from 'node:test';
import assert from 'node:assert/strict';
import { clearMatrixPairs, generateMatrixPairs, matrixCell, matrixDirty, matrixGroupWithSelfLocks, matrixKey, matrixSelectedCount, selectMatrixPairs, synchronizeSelfPair, toggleMatrixPair } from './matrix.utils.ts';

const employees = [
  { id: 1, name: 'Ada', roleId: 10, roleName: 'Engineer' },
  { id: 2, name: 'Ben', roleId: 20, roleName: 'Tester' },
  { id: 3, name: 'Cal', roleId: 10, roleName: 'Engineer' },
];
const group = { groupId: 1, groupName: 'Alpha', employees, assignments: [{ evaluatorId: 1, evaluateeId: 3, formId: 5, filledFormId: 8, isCompleted: false }] };
const rules = { forms: [{ id: 5, name: 'Review' }], groups: [
  { groupId: 1, rolePairs: [
    { evaluatorRoleId: 10, evaluateeRoleId: 20, formId: 5 },
    { evaluatorRoleId: 10, evaluateeRoleId: 10, formId: 5 },
    { evaluatorRoleId: 20, evaluateeRoleId: 20, formId: null },
  ] },
  { groupId: 2, rolePairs: [{ evaluatorRoleId: 20, evaluateeRoleId: 10, formId: 5 }] },
] };

test('diagonal requires a dedicated configured form; issued work stays locked', () => {
  assert.equal(matrixCell(group, rules, 1, 2).editable, true);
  assert.equal(matrixCell(group, rules, 2, 1).editable, true);
  assert.equal(matrixCell(group, rules, 2, 2).editable, false);
  assert.match(matrixCell(group, rules, 2, 2).reason, /Self-evaluations/);
  assert.equal(matrixCell(group, rules, 1, 1, { 1: 5 }).editable, true);
  assert.equal(matrixCell(group, rules, 1, 3).editable, false);
  assert.equal(matrixCell(group, rules, 1, 3).issued, true);
  assert.match(matrixCell(group, rules, 1, 3).reason, /issued/);
  assert.equal(matrixCell({ ...group, employees: employees.slice(1), assignments: [] }, rules, 1, 2).editable, false);
});

test('add all includes allowed self pairs and preserves issued records; self only stays diagonal', () => {
  const saved = { [matrixKey(1, 1, 3)]: true, '2:1:2': true };
  const all = selectMatrixPairs(group, rules, saved, false, { 1: 5, 2: 5, 3: 5 });
  assert.equal(all['1:1:1'], true);
  assert.equal(all['1:1:2'], true);
  assert.equal(all['1:2:1'], true);
  assert.equal(all['1:2:2'], true);
  assert.equal(all['1:1:3'], true);
  assert.equal(all['2:1:2'], true);
  assert.equal(matrixSelectedCount(all, 1), 9);
  assert.equal(matrixSelectedCount(selectMatrixPairs(group, rules, saved, true, { 1: 5, 2: 5, 3: 5 }), 1), 4);
  assert.deepEqual(saved, { '1:1:3': true, '2:1:2': true });
});

test('each self-evaluation toggles independently; issued, started and completed cells stay locked', () => {
  const saved = { '1:1:3': true };
  const first = toggleMatrixPair(group, rules, saved, 1, 1, { 1: 5, 2: 5 });
  assert.equal(first['1:1:1'], true);
  assert.equal(first['1:2:2'], undefined);
  const second = toggleMatrixPair(group, rules, first, 2, 2, { 1: 5, 2: 5 });
  assert.equal(second['1:1:1'], true);
  assert.equal(second['1:2:2'], true);
  assert.equal(toggleMatrixPair(group, rules, second, 1, 1, { 1: 5 })['1:2:2'], true);
  assert.equal(toggleMatrixPair(group, rules, saved, 1, 3), saved);
  const completed = { ...group, assignments: [{ ...group.assignments[0], isCompleted: true }] };
  assert.match(matrixCell(completed, rules, 1, 3).reason, /completed/);
  const started = { ...group, assignments: [{ ...group.assignments[0], hasAnswers: true, statusName: 'In progress' }] };
  assert.match(matrixCell(started, rules, 1, 3).reason, /in progress/);
});

test('shared participant diagonal selection synchronizes across groups without editing issued cells', () => {
  const second = { ...group, groupId: 2, assignments: [] };
  assert.deepEqual(synchronizeSelfPair([group, second], {}, 1, true), { '2:1:1': true, '1:1:1': true });
  const issued = { ...group, assignments: [{ evaluatorId: 1, evaluateeId: 1 }] };
  assert.deepEqual(synchronizeSelfPair([issued, second], { '1:1:1': true, '2:1:1': true }, 1, false), { '1:1:1': true, '2:1:1': false });
  const effective = matrixGroupWithSelfLocks({ groups: [issued, second] }, second);
  assert.equal(matrixCell(effective, rules, 1, 1, { 1: 5 }).editable, false);
  assert.equal(clearMatrixPairs(effective, rules, { '2:1:1': true }, { 1: 5 })['2:1:1'], true);
});

test('clear removes only editable selections; dirty state normalizes absent and false entries', () => {
  const saved = { '1:1:3': true };
  const edited = { ...saved, '1:1:2': true, '1:2:1': true };
  const cleared = clearMatrixPairs(group, rules, edited);
  assert.equal(cleared['1:1:3'], true);
  assert.equal(cleared['1:1:2'], false);
  assert.equal(cleared['1:2:1'], false);
  assert.equal(matrixDirty(saved, { ...saved, '1:1:2': false }), false);
  assert.equal(matrixDirty(edited, saved), true);
  assert.equal(matrixDirty(cleared, saved), false);
});

test('generate adds deterministic balanced incoming peer reviews and reports infeasibility', () => {
  const saved = { '1:1:3': true };
  const first = generateMatrixPairs(group, rules, saved, 1);
  assert.deepEqual(first.unmet, []);
  assert.equal(first.selection['1:2:1'], true);
  assert.equal(first.selection['1:3:2'], true);
  assert.equal(first.selection['1:1:3'], true);
  assert.equal(first.selection['1:1:1'], undefined);
  assert.deepEqual(generateMatrixPairs(group, rules, saved, 1), first);
  assert.deepEqual(generateMatrixPairs(group, rules, first.selection, 1).selection, first.selection);
  assert.deepEqual(generateMatrixPairs(group, rules, first.selection, 2).unmet, []);
  assert.deepEqual(generateMatrixPairs(group, rules, first.selection, 3).unmet, ['Ada (2/3)', 'Ben (2/3)', 'Cal (2/3)']);
  assert.throws(() => generateMatrixPairs(group, rules, saved, 1.5), /whole number/);
});

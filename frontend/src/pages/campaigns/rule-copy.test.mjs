import test from 'node:test';
import assert from 'node:assert/strict';
import { countAssignedRules, countLabel, previewRuleCopy } from './rule-copy.ts';

const pair = (evaluatorRoleId, evaluateeRoleId) => ({ evaluatorRoleId, evaluateeRoleId });
const group = (groupId, rolePairs) => ({ groupId, groupName: `Group ${groupId}`, rolePairs });
const rules = {
  forms: [{ id: 4, name: 'Review' }, { id: 5, name: 'Feedback' }],
  groups: [
    group(1, [pair(10, 20), pair(20, 10), pair(10, 10)]),
    group(2, [pair(10, 20), pair(20, 10), pair(10, 10)]),
    group(3, [pair(10, 20), pair(20, 10)]),
    group(4, [pair(20, 10)]),
  ],
};

test('role copy matches directed IDs across groups without touching reverse or unrelated pairs', () => {
  const values = { '1:10:20': 4, '2:10:20': 5, '2:20:10': 5, '2:10:10': 5, '3:10:20': null };
  const snapshot = structuredClone(values);
  const preview = previewRuleCopy(rules, values, { sourceGroupId: 1, evaluatorRoleId: 10, evaluateeRoleId: 20 });
  assert.deepEqual(preview.changes, { '2:10:20': 4, '3:10:20': 4 });
  assert.equal(preview.matchingGroups, 2);
  assert.equal(preview.affectedGroups, 2);
  assert.equal(preview.replaced, 1);
  assert.equal(preview.assigned, 1);
  assert.equal(Object.keys(preview.changes).length, preview.assigned + preview.replaced + preview.cleared);
  assert.deepEqual(values, snapshot);
  assert.equal(({ ...values, ...preview.changes })['2:20:10'], 5);
});

test('no form clears only matching destinations and identical selections are no-ops', () => {
  const values = { '1:10:20': null, '2:10:20': 4, '3:10:20': null };
  const preview = previewRuleCopy(rules, values, { sourceGroupId: 1, evaluatorRoleId: 10, evaluateeRoleId: 20 });
  assert.deepEqual(preview.changes, { '2:10:20': null });
  assert.equal(preview.cleared, 1);
  assert.equal(preview.replaced, 0);
  assert.equal(preview.affectedGroups, 1);
  assert.equal(Object.keys(preview.changes).length, preview.assigned + preview.replaced + preview.cleared);
  assert.deepEqual(previewRuleCopy(rules, { ...values, ...preview.changes }, { sourceGroupId: 1, evaluatorRoleId: 10, evaluateeRoleId: 20 }).changes, {});
  assert.deepEqual(previewRuleCopy(rules, values, { sourceGroupId: 4, evaluatorRoleId: 10, evaluateeRoleId: 20 }).changes, {});
});

test('group copy skips missing pairs, copies independent destination keys and counts overwrites', () => {
  const values = { '1:10:20': 4, '1:20:10': null, '1:10:10': 5,
    '2:10:20': 5, '2:20:10': 4, '2:10:10': 5,
    '3:10:20': null, '3:20:10': 4, '4:20:10': 4 };
  const preview = previewRuleCopy(rules, values, { sourceGroupId: 1 });
  assert.deepEqual(preview.changes, {
    '2:10:20': 4, '2:20:10': null, '3:10:20': 4,
    '3:20:10': null, '4:20:10': null,
  });
  assert.equal(preview.affectedGroups, 3);
  assert.equal(preview.replaced, 1);
  assert.equal(preview.cleared, 3);
  assert.equal(preview.assigned, 1);
  assert.equal(Object.keys(preview.changes).length, preview.assigned + preview.replaced + preview.cleared);
  const savedValues = { ...values, ...preview.changes };
  assert.equal(savedValues['2:10:10'], 5);
  assert.equal(savedValues['1:10:20'], 4);
  assert.deepEqual(previewRuleCopy(rules, savedValues, { sourceGroupId: 1 }).changes, {});
  assert.equal(values['2:10:20'], 5);
});

test('assigned counts only include real group-specific pairs and labels pluralize', () => {
  const values = { '1:10:20': 4, '1:20:10': 4, '2:10:20': 4, '2:20:10': null, '9:1:1': 4 };
  assert.equal(countAssignedRules(rules, values, 1), 2);
  assert.equal(countAssignedRules(rules, values, 2), 1);
  assert.equal(countAssignedRules(rules, values), 3);
  assert.equal(countLabel(0, 'role relationship'), '0 role relationships');
  assert.equal(countLabel(1, 'assigned rule'), '1 assigned rule');
  assert.equal(countLabel(2, 'group'), '2 groups');
  assert.equal(countLabel(1, 'assignment'), '1 assignment');
});

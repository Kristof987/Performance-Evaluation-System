import test from 'node:test';
import assert from 'node:assert/strict';
import { getFormAssignmentProgress, getMatrixReadiness } from './campaign-readiness.ts';

const pair = (evaluatorRoleId, evaluateeRoleId) => ({ evaluatorRoleId, evaluateeRoleId });
const rules = {
  forms: [{ id: 11, name: 'Review' }],
  groups: [
    { groupId: 1, groupName: 'Engineers', rolePairs: [pair(3, 3), pair(3, 4), pair(4, 3)] },
    { groupId: 2, groupName: 'Managers', rolePairs: [pair(4, 4)] },
  ],
};

test('counts directed relationships and missing forms across all selected groups', () => {
  const values = { '1:3:3': 11, '1:3:4': 11, '1:4:3': null, '2:4:4': 11 };
  const progress = getFormAssignmentProgress(rules, values);
  assert.equal(progress.required, 4);
  assert.equal(progress.configured, 3);
  assert.equal(progress.missing, 1);
  assert.deepEqual(progress.groups.map((group) => group.missing), [1, 0]);
  assert.deepEqual(progress.groups[0].firstMissing, pair(4, 3));
  assert.equal(progress.complete, false);
  assert.equal(getMatrixReadiness(progress, false, false), 'missing');
  const complete = getFormAssignmentProgress(rules, { ...values, '1:4:3': 11 });
  assert.equal(complete.complete, true);
  assert.equal(getMatrixReadiness(complete, false, false), 'ready');
});

test('unknown or removed forms are incomplete; only current selected groups count', () => {
  const progress = getFormAssignmentProgress(rules, { '1:3:3': 11, '1:3:4': 99, '1:4:3': 11, '2:4:4': 11, '9:3:3': 11 });
  assert.equal(progress.missing, 1);
  assert.equal(progress.groups[0].firstMissing.evaluateeRoleId, 4);
  const oneGroup = getFormAssignmentProgress({ ...rules, groups: rules.groups.slice(0, 1) }, { '1:3:3': 11, '1:3:4': 11, '1:4:3': 11 });
  assert.equal(oneGroup.required, 3);
  assert.equal(oneGroup.complete, true);
});

test('unsaved group or rule changes block otherwise complete matrices', () => {
  const complete = getFormAssignmentProgress(rules, { '1:3:3': 11, '1:3:4': 11, '1:4:3': 11, '2:4:4': 11 });
  assert.equal(getMatrixReadiness(complete, true, false), 'groups');
  assert.equal(getMatrixReadiness(complete, false, true), 'rules');
  assert.equal(getMatrixReadiness(complete, false, false), 'ready');
});

test('no selected groups and selected groups without role pairs are not ready', () => {
  const none = getFormAssignmentProgress({ forms: rules.forms, groups: [] }, {});
  assert.equal(none.complete, false);
  assert.equal(getMatrixReadiness(none, false, false), 'groups');
  const empty = getFormAssignmentProgress({ forms: rules.forms, groups: [{ groupId: 1, groupName: 'Empty', rolePairs: [] }] }, {});
  assert.equal(empty.missing, 0);
  assert.equal(empty.complete, false);
  assert.equal(getMatrixReadiness(empty, false, false), 'empty');
});

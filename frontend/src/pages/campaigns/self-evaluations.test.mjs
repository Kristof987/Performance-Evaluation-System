import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSelfCopy, selfFormMap, selfFormsDirty } from './self-evaluations.ts';

const data = { forms: [{ id: 7, name: 'Self' }], participants: [
  { employeeId: 1, name: 'Ada', groupNames: ['A', 'B'], formId: 7, locked: false },
  { employeeId: 2, name: 'Ben', groupNames: ['A'], formId: null, locked: false },
  { employeeId: 3, name: 'Cal', groupNames: ['B'], formId: 7, locked: true },
  { employeeId: 4, name: 'Dia', groupNames: ['B'], formId: 7, locked: false },
] };

test('copy preview deduplicates participant rows and protects issued selections', () => {
  const initial = selfFormMap(data);
  const preview = previewSelfCopy(data, initial, 1);
  assert.deepEqual(preview.changes, { 2: 7 });
  assert.equal(preview.protectedCount, 1);
  assert.equal(preview.unchangedCount, 1);
  assert.equal(preview.newCount, 1);
  assert.equal(preview.replacedCount, 0);
  assert.equal(selfFormsDirty(data, initial), false);
  assert.equal(selfFormsDirty(data, { ...initial, ...preview.changes }), true);
  assert.deepEqual(previewSelfCopy(data, { ...initial, ...preview.changes }, 1).changes, {});
});

test('copy of No form cannot clear assignments in bulk', () => {
  const selected = { ...selfFormMap(data), 2: null };
  assert.deepEqual(previewSelfCopy(data, selected, 2).changes, {});
  assert.equal(selfFormsDirty(data, { ...selected, 3: null }), false);
});

test('copy counts replacements separately from new assignments', () => {
  const selected = { ...selfFormMap(data), 4: 8 };
  const preview = previewSelfCopy(data, selected, 1);
  assert.deepEqual(preview.changes, { 2: 7, 4: 7 });
  assert.equal(preview.newCount, 1);
  assert.equal(preview.replacedCount, 1);
});

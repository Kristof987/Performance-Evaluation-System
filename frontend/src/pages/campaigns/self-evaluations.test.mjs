import test from 'node:test';
import assert from 'node:assert/strict';
import { selfFormMap, selfFormsDirty } from './self-evaluations.ts';

const data = { forms: [{ id: 7, name: 'Self' }], participants: [
  { employeeId: 1, name: 'Ada', groupNames: ['A', 'B'], formId: 7, locked: false },
  { employeeId: 2, name: 'Ben', groupNames: ['A'], formId: null, locked: false },
  { employeeId: 3, name: 'Cal', groupNames: ['B'], formId: 7, locked: true },
] };

test('the saved mapping has one entry per participant, including no form', () => {
  assert.deepEqual(selfFormMap(data), { 1: 7, 2: null, 3: 7 });
});

test('dirty only when an editable participant differs from the saved form', () => {
  const saved = selfFormMap(data);
  assert.equal(selfFormsDirty(data, saved), false);
  assert.equal(selfFormsDirty(data, { ...saved, 2: 7 }), true);
  assert.equal(selfFormsDirty(data, { ...saved, 1: null }), true);
  // Issued (locked) self-evaluations cannot change, so a different value there is not an unsaved edit.
  assert.equal(selfFormsDirty(data, { ...saved, 3: null }), false);
  // A missing entry means "no form".
  assert.equal(selfFormsDirty(data, { 1: 7, 3: 7 }), false);
});

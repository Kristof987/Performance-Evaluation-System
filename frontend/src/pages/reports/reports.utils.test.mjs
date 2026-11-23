import test from 'node:test';
import assert from 'node:assert/strict';
import { completionText, formatPercent, formatScore, reportScopeTitle } from './reports.utils.ts';

test('formats report KPI values without fake data', () => {
  assert.equal(formatPercent(74.6), '75%');
  assert.equal(formatScore(null), 'Not available');
  assert.equal(formatScore(3.456), '3.46');
  assert.equal(completionText(2, 5), '2 of 5 evaluations completed');
});

test('report scope title names the section and the selected groups', () => {
  assert.equal(reportScopeTitle(undefined, []), 'All sections · All groups');
  assert.equal(reportScopeTitle({ name: 'Teamwork' }, [{ name: 'Alpha' }, { name: 'Beta' }]), 'Teamwork · Alpha, Beta');
  assert.equal(reportScopeTitle(undefined, [], 'All roles'), 'All sections · All roles');
});

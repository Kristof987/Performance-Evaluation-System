import test from 'node:test';
import assert from 'node:assert/strict';
import { completionText, formatPercent, formatScore, selectedDistributionSource } from './reports.utils.ts';

test('formats report KPI values without fake data', () => {
  assert.equal(formatPercent(74.6), '75%');
  assert.equal(formatScore(null), 'Not available');
  assert.equal(formatScore(3.456), '3.46');
  assert.equal(completionText(2, 5), '2 of 5 evaluations completed');
});

test('selects distribution source deterministically', () => {
  const sources = [
    { id: 'dimension:communication', label: 'Communication', source_type: 'dimension', scale_min: 1, scale_max: 5, response_count: 2, buckets: [] },
    { id: 'question:1:q1', label: 'Question', source_type: 'question', scale_min: 1, scale_max: 5, response_count: 3, buckets: [] },
  ];
  assert.equal(selectedDistributionSource(sources, 'question:1:q1')?.label, 'Question');
  assert.equal(selectedDistributionSource(sources, 'missing')?.label, 'Communication');
  assert.equal(selectedDistributionSource([], 'missing'), null);
});

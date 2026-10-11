import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardWork, evaluationStatus, evaluationTitle } from './employee-home.utils.ts';

const task = (id, changes = {}) => ({
  id, evaluatorId: 1, evaluateeId: 2, evaluateeName: 'Sarah Mitchell',
  campaignId: 10, campaignName: 'Third review', campaignStartDate: '2026-10-01',
  campaignIsActive: true, dueDate: '2026-10-20', finishDate: null,
  statusName: 'Not started', answeredCount: 0, formName: 'Probe form',
  ...changes,
});

test('actionable KPIs share ongoing scope and nearest outstanding deadline', () => {
  const items = [task(1), task(2, { statusName: 'In progress', dueDate: '2026-10-11' }),
    task(3, { finishDate: '2026-10-08', dueDate: '2026-10-10' }),
    task(4, { campaignStartDate: '2026-11-01', dueDate: '2026-11-20' }),
    task(5, { campaignIsActive: false }), task(6, { campaignStartDate: '2026-09-01', dueDate: '2026-09-30' })];
  const work = dashboardWork(items, '2026-10-09');
  assert.deepEqual(work.actionable.map((item) => item.id), [2, 1]);
  assert.equal(work.completed.length, 1);
  assert.equal(work.nextDeadline.id, 2);
  assert.deepEqual(work.upcoming.map((item) => item.id), [4]);
  assert.deepEqual(work.history.map((item) => item.id), [3]);
});

test('identity and status use persisted evaluator, evaluatee and completion', () => {
  assert.equal(evaluationTitle(task(1)), 'Evaluate Sarah Mitchell');
  assert.equal(evaluationTitle(task(2, { evaluatorId: 2, evaluateeId: 2 })), 'Self-evaluation');
  assert.equal(evaluationStatus(task(3, { answeredCount: 1 })), 'In progress');
  assert.equal(evaluationStatus(task(4, { finishDate: '2026-10-08' })), 'Completed');
  assert.equal(evaluationStatus(task(5)), 'Not started');
});

test('distinct FilledForm IDs remain separate even with identical titles', () => {
  assert.deepEqual(dashboardWork([task(8), task(7)], '2026-10-09').actionable.map((item) => item.id), [7, 8]);
});

test('completed history excludes in-progress and not-started work', () => {
  const work = dashboardWork([task(1), task(2, { answeredCount: 1 }), task(3, { finishDate: '2026-10-08' })], '2026-10-09');
  assert.deepEqual(work.history.map((item) => item.id), [3]);
  assert.deepEqual(work.actionable.map((item) => item.id), [2, 1]);
});

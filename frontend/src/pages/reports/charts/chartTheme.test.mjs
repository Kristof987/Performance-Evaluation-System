import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDelta, scoreColor } from './chartTheme.ts';

const theme = { low: '#c4553f', mid: '#d99a2b', high: '#2e9e6b' };

test('score colours run from low through mid to high and clamp at the ends', () => {
  assert.equal(scoreColor(theme, 1), '#c4553f');
  assert.equal(scoreColor(theme, 2), '#c4553f');
  assert.equal(scoreColor(theme, 3), '#d99a2b');
  assert.equal(scoreColor(theme, 4.5), '#2e9e6b');
  assert.equal(scoreColor(theme, 5), '#2e9e6b');
});

test('deltas are signed, rounded and missing without a comparison', () => {
  assert.deepEqual(formatDelta(3.65, 3.53), { value: 0.12, label: '+0.12' });
  assert.deepEqual(formatDelta(85, 92, 0), { value: -7, label: '−7' });
  assert.deepEqual(formatDelta(3, 3), { value: 0, label: '±0.00' });
  assert.equal(formatDelta(null, 3), null);
  assert.equal(formatDelta(3, null), null);
});

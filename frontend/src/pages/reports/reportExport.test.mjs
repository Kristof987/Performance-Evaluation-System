import test from 'node:test';
import assert from 'node:assert/strict';
import { csvScore, toCsv } from './reportExport.ts';

test('CSV cells are quoted when needed and formulas are neutralised', () => {
  assert.equal(toCsv([['Name', 'Score'], ['Kovács, Anna', 4.5], ['Say "hi"', null], ['=SUM(A1)', -1]]),
    'Name,Score\r\n"Kovács, Anna",4.5\r\n"Say ""hi""",\r\n\'=SUM(A1),-1');
});

test('scores keep two decimals and hidden values stay hidden', () => {
  assert.equal(csvScore(3.456), '3.46');
  assert.equal(csvScore(null), '');
  assert.equal(csvScore(4.2, 'suppressed'), 'Hidden');
});

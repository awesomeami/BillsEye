import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate } from '../../utilities/config';

test('formatDate displays a safe fallback when a receipt has no usable date', () => {
  assert.equal(formatDate(null), 'Unknown Date');
  assert.equal(formatDate(''), 'Unknown Date');
  assert.equal(formatDate('not-a-date'), 'Unknown Date');
  assert.equal(formatDate('2026-02-31'), 'Unknown Date');
  assert.notEqual(formatDate('2026-08-28'), 'Unknown Date');
});

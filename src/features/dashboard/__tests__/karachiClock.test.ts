import assert from 'node:assert/strict';
import { test } from 'node:test';
import { millisecondsUntilNextKarachiDay } from '../../../hooks/useKarachiNow';

test('schedules a refresh at the next Karachi midnight', () => {
  const beforeMidnight = new Date('2026-09-02T18:59:30.000Z');
  assert.strictEqual(millisecondsUntilNextKarachiDay(beforeMidnight), 30_250);

  const afterMidnight = new Date('2026-09-02T19:00:30.000Z');
  assert.strictEqual(millisecondsUntilNextKarachiDay(afterMidnight), 86_370_250);
});

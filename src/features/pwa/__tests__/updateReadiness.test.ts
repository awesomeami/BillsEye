import assert from 'node:assert';
import { describe, test } from 'node:test';
import { canApplyPwaUpdate, getPwaUpdateDeferralReason, hasMemoryOnlyQueueWork } from '../updateReadiness';

describe('PWA update readiness', () => {
  test('defers updates while receipt edits or memory-only queue work exist', () => {
    const queue = [{ status: 'extracting' as const }];
    assert.strictEqual(hasMemoryOnlyQueueWork(queue), true);
    assert.strictEqual(canApplyPwaUpdate(false, queue), false);
    assert.match(getPwaUpdateDeferralReason(false, queue) ?? '', /queued receipt processing/);
    assert.strictEqual(canApplyPwaUpdate(true, []), false);
    assert.match(getPwaUpdateDeferralReason(true, []) ?? '', /receipt edits/);
  });

  test('permits an explicit update only after terminal queue items and clean editing state', () => {
    const terminal = [{ status: 'duplicate' as const }, { status: 'cancelled' as const }];
    assert.strictEqual(hasMemoryOnlyQueueWork(terminal), false);
    assert.strictEqual(canApplyPwaUpdate(false, terminal), true);
    assert.strictEqual(getPwaUpdateDeferralReason(false, terminal), null);
  });
});

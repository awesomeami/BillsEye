import assert from 'node:assert';
import { describe, test } from 'node:test';
import { deriveReceiptSyncState } from '../syncState';

describe('receipt sync state', () => {
  test('distinguishes browser offline, active synchronization, pending writes, success, and errors', () => {
    const synced = { fromCache: false, hasPendingWrites: false };
    const cached = { fromCache: true, hasPendingWrites: false };
    const pending = { fromCache: false, hasPendingWrites: true };
    const cases = [
      ['offline overrides other signals', { online: false, loading: false, hasError: true, sources: [synced] }, 'offline'],
      ['initial subscriptions are synchronizing', { online: true, loading: true, hasError: false, sources: [null] }, 'syncing'],
      ['cache-only response is synchronizing', { online: true, loading: false, hasError: false, sources: [cached, synced] }, 'syncing'],
      ['local writes are pending', { online: true, loading: false, hasError: false, sources: [synced, pending] }, 'pending-writes'],
      ['server snapshots are synchronized', { online: true, loading: false, hasError: false, sources: [synced, synced] }, 'synced'],
      ['listener failures are errors when online', { online: true, loading: false, hasError: true, sources: [synced] }, 'error'],
    ] as const;

    for (const [, input, expected] of cases) {
      assert.strictEqual(deriveReceiptSyncState(input), expected);
    }
  });
});

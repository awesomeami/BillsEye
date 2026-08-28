import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ReceiptHydrationCache, ReceiptHydrationSource } from '../receiptHydrationCache';

interface FixtureData extends Record<string, unknown> {
  revision: number;
  updatedAt: string;
  itemStorageVersion: number;
  itemCount: number;
}

type FixtureSource = ReceiptHydrationSource<string, FixtureData>;

function makeReceipts(count: number, itemsPerReceipt = 4): FixtureSource[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `receipt-${index}`,
    ref: `users/performance-fixture/receipts/receipt-${index}`,
    data: {
      revision: 1,
      updatedAt: '2026-08-28T00:00:00.000Z',
      itemStorageVersion: 2,
      itemCount: itemsPerReceipt,
    },
  }));
}

describe('ReceiptHydrationCache', () => {
  test('a realistic one-receipt update hydrates only that receipt item collection', async () => {
    const cache = new ReceiptHydrationCache<string, FixtureData, string[]>();
    const receipts = makeReceipts(250);
    let itemQueries = 0;
    let itemDocumentReads = 0;
    const load = async (source: FixtureSource) => {
      itemQueries += 1;
      itemDocumentReads += source.data.itemCount;
      return Array.from({ length: source.data.itemCount }, (_, index) => `${source.id}-item-${index}`);
    };

    const initial = await cache.hydrate(receipts, load);
    assert.equal(itemQueries, 250);
    assert.equal(itemDocumentReads, 1_000);

    const unchanged = await cache.hydrate(receipts, load);
    assert.strictEqual(unchanged, initial, 'unchanged snapshots should preserve the result array identity');

    const modified = receipts.map((receipt, index) => index === 137
      ? { ...receipt, data: { ...receipt.data, revision: 2, updatedAt: '2026-08-28T01:00:00.000Z' } }
      : receipt);
    await cache.hydrate(modified, load);

    assert.equal(itemQueries, 251, 'the second snapshot should issue one new item query, not 250');
    assert.equal(itemDocumentReads, 1_004, 'the second snapshot should read four item documents, not 1,000');
    assert.equal(cache.size, 250);
  });

  test('updated metadata invalidates a receipt and deleted receipts are evicted', async () => {
    const cache = new ReceiptHydrationCache<string, FixtureData, string>();
    const receipts = makeReceipts(3);
    let loads = 0;
    const load = async (source: FixtureSource) => `${source.id}:${++loads}`;

    const initial = await cache.hydrate(receipts, load);
    const updated = receipts.slice(1).map((receipt, index) => index === 0
      ? { ...receipt, data: { ...receipt.data, updatedAt: '2026-08-29T00:00:00.000Z' } }
      : receipt);
    const next = await cache.hydrate(updated, load);

    assert.deepEqual(initial, ['receipt-0:1', 'receipt-1:2', 'receipt-2:3']);
    assert.deepEqual(next, ['receipt-1:4', 'receipt-2:3']);
    assert.equal(cache.size, 2);
  });

  test('clear and separate instances prevent reuse across subscription generations or users', async () => {
    const alice = new ReceiptHydrationCache<string, FixtureData, string>();
    const bob = new ReceiptHydrationCache<string, FixtureData, string>();
    const [receipt] = makeReceipts(1);
    let loads = 0;
    const load = async () => `load-${++loads}`;

    assert.deepEqual(await alice.hydrate([receipt], load), ['load-1']);
    assert.deepEqual(await bob.hydrate([receipt], load), ['load-2']);
    alice.clear();
    assert.deepEqual(await alice.hydrate([receipt], load), ['load-3']);
  });

  test('an older hydration cannot replace the cache owned by a newer snapshot', async () => {
    const cache = new ReceiptHydrationCache<string, FixtureData, string>();
    const [receipt] = makeReceipts(1);
    const newerReceipt = {
      ...receipt,
      data: { ...receipt.data, revision: 2, updatedAt: '2026-08-28T02:00:00.000Z' },
    };
    let resolveOlder!: (value: string) => void;
    let resolveNewer!: (value: string) => void;
    const olderValue = new Promise<string>(resolve => { resolveOlder = resolve; });
    const newerValue = new Promise<string>(resolve => { resolveNewer = resolve; });
    let loads = 0;

    const olderHydration = cache.hydrate([receipt], async () => {
      loads += 1;
      return olderValue;
    });
    const newerHydration = cache.hydrate([newerReceipt], async () => {
      loads += 1;
      return newerValue;
    });
    resolveNewer('newer');
    assert.deepEqual(await newerHydration, ['newer']);
    resolveOlder('older');
    assert.deepEqual(await olderHydration, ['older']);

    assert.deepEqual(await cache.hydrate([newerReceipt], async () => {
      loads += 1;
      return 'unexpected reload';
    }), ['newer']);
    assert.equal(loads, 2);
  });
});

import assert from 'node:assert';
import { describe, test } from 'node:test';
import {
  ExtractionControlService,
  InMemoryExtractionControlStore,
  type ExtractionControlConfig,
} from '../extractionControls';

const testConfig: ExtractionControlConfig = {
  maxRequestsPerWindow: 2,
  rateWindowMs: 60_000,
  leaseDurationMs: 65_000,
};

describe('distributed extraction controls', () => {
  test('independent limiter instances atomically share a per-UID concurrency lease', async () => {
    const sharedStore = new InMemoryExtractionControlStore();
    const firstInstance = new ExtractionControlService(sharedStore, testConfig);
    const secondInstance = new ExtractionControlService(sharedStore, testConfig);

    const [first, second] = await Promise.all([
      firstInstance.acquire('user-a', 'first-lease', 1_000),
      secondInstance.acquire('user-a', 'second-lease', 1_000),
    ]);

    assert.strictEqual([first, second].filter((result) => result.allowed).length, 1);
    const rejected = [first, second].find((result) => result.allowed === false);
    assert.ok(rejected && rejected.allowed === false);
    assert.strictEqual(rejected.reason, 'concurrent_request');

    const acquired = first.allowed ? { service: firstInstance, leaseId: 'first-lease' } : { service: secondInstance, leaseId: 'second-lease' };
    await acquired.service.release('user-a', acquired.leaseId);

    const retry = await secondInstance.acquire('user-a', 'retry-lease', 2_000);
    assert.deepStrictEqual(retry, { allowed: true, leaseId: 'retry-lease' });
  });

  test('expired leases are reclaimed and cannot permanently lock a UID', async () => {
    const controls = new ExtractionControlService(new InMemoryExtractionControlStore(), testConfig);

    assert.deepStrictEqual(await controls.acquire('user-a', 'old-lease', 1_000), {
      allowed: true,
      leaseId: 'old-lease',
    });

    assert.deepStrictEqual(await controls.acquire('user-a', 'fresh-lease', 66_001), {
      allowed: true,
      leaseId: 'fresh-lease',
    });
  });

  test('rate windows reset while retaining a bounded active lease', async () => {
    const controls = new ExtractionControlService(new InMemoryExtractionControlStore(), testConfig);

    assert.strictEqual((await controls.acquire('user-a', 'one', 1_000)).allowed, true);
    await controls.release('user-a', 'one');
    assert.strictEqual((await controls.acquire('user-a', 'two', 2_000)).allowed, true);
    await controls.release('user-a', 'two');

    const limited = await controls.acquire('user-a', 'three', 3_000);
    assert.strictEqual(limited.allowed, false);
    if (limited.allowed === false) {
      assert.strictEqual(limited.reason, 'rate_limited');
      assert.strictEqual(limited.retryAfterSeconds, 58);
    }

    assert.deepStrictEqual(await controls.acquire('user-a', 'next-window', 61_001), {
      allowed: true,
      leaseId: 'next-window',
    });
  });

  test('different UIDs have independent budgets', async () => {
    const controls = new ExtractionControlService(new InMemoryExtractionControlStore(), testConfig);

    const [firstUser, secondUser] = await Promise.all([
      controls.acquire('user-a', 'lease-a', 1_000),
      controls.acquire('user-b', 'lease-b', 1_000),
    ]);

    assert.strictEqual(firstUser.allowed, true);
    assert.strictEqual(secondUser.allowed, true);
  });
});

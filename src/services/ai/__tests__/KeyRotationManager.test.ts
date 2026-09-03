import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { KeyRotationManager } from '../KeyRotationManager';
import { AiRequestExecutor } from '../AiRequestExecutor';

describe('KeyRotationManager Fake Clock Tests', () => {
  let krm: KeyRotationManager;
  let timeNow = 1000000;
  let originalDateNow: () => number;

  beforeEach(() => {
    krm = new KeyRotationManager();
    originalDateNow = Date.now;
    Date.now = () => timeNow;
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  test('Iterates actual eligible slots round-robin and skips disabled/invalid', () => {
    krm.updateSlots([
      { slotId: 1, isEnabled: true, status: 'healthy', maskedKey: '', isSessionOnly: false },
      { slotId: 2, isEnabled: false, status: 'healthy', maskedKey: '', isSessionOnly: false }, // Disabled
      { slotId: 3, isEnabled: true, status: 'invalid', maskedKey: '', isSessionOnly: false },  // Invalid
      { slotId: 5, isEnabled: true, status: 'healthy', maskedKey: '', isSessionOnly: false },  // Gap
    ]);

    const first = krm.getEligibleKeyIndex();
    assert.strictEqual(first, 0, 'Should return slot 1 index 0');
    
    // Fake success updates the state to be healthy again
    krm.handleSuccess(first);

    const second = krm.getEligibleKeyIndex();
    assert.strictEqual(second, 3, 'Should return slot 5 index 3 skipping 2 and 3');

    krm.handleSuccess(second);

    const third = krm.getEligibleKeyIndex();
    assert.strictEqual(third, 0, 'Should wrap around to slot 1');
  });

  test('Bounded exponential backoff and jitter on rate limit', () => {
    krm.updateSlots([
      { slotId: 1, isEnabled: true, status: 'healthy', maskedKey: '', isSessionOnly: false }
    ]);
    
    // First failure
    krm.handleError(0, { code: 'rate_limit', message: 'Rate limit' });
    let slot = krm.getSlotsForTesting()[0];
    assert.strictEqual(slot.status, 'cooldown');
    assert.ok(slot.failureCount === 1);
    assert.ok(slot.cooldownUntil !== undefined);
    const firstCooldown = slot.cooldownUntil - timeNow;
    assert.ok(firstCooldown >= 30000 && firstCooldown < 35000); // 30s + jitter

    // Advance time past cooldown
    timeNow += 40000;

    // Second failure
    krm.handleError(0, { code: 'rate_limit', message: 'Rate limit' });
    slot = krm.getSlotsForTesting()[0];
    assert.ok(slot.failureCount === 2);
    assert.ok(slot.cooldownUntil !== undefined);
    const secondCooldown = slot.cooldownUntil - timeNow;
    assert.ok(secondCooldown >= 60000 && secondCooldown < 65000); // 60s + jitter
  });

  test('AiRequestExecutor: fatal_auth_error (Firebase 401) does not change key status, failureCount, or cooldownUntil', async () => {
    krm.updateSlots([
      { slotId: 1, isEnabled: true, status: 'healthy', maskedKey: 'key-1', isSessionOnly: false },
      { slotId: 2, isEnabled: true, status: 'healthy', maskedKey: 'key-2', isSessionOnly: false }
    ]);

    const executor = new AiRequestExecutor(krm);
    let attemptsCount = 0;

    await assert.rejects(
      async () => {
        await executor.execute(
          'extractReceipt',
          async () => {
            attemptsCount++;
            const error = Object.assign(new Error('Unauthorized user token'), { status: 401 });
            throw error;
          },
          async (index) => `decrypted-key-${index}`
        );
      },
      (error: unknown) => {
        assert.ok(error instanceof Error && error.message.includes('User authentication failed'));
        return true;
      }
    );

    // Only 1 attempt made (no key rotation loop triggered)
    assert.strictEqual(attemptsCount, 1, 'Should abort immediately without retrying other keys');

    // Slot 0 and Slot 1 must remain untouched
    const slots = krm.getSlotsForTesting();
    assert.strictEqual(slots[0].status, 'healthy');
    assert.strictEqual(slots[0].cooldownUntil, undefined);
    assert.strictEqual(slots[0].failureCount, undefined);

    assert.strictEqual(slots[1].status, 'healthy');
    assert.strictEqual(slots[1].cooldownUntil, undefined);
    assert.strictEqual(slots[1].failureCount, undefined);
  });

  test('AiRequestExecutor: server failure does not put a valid key on cooldown', async () => {
    krm.updateSlots([
      { slotId: 1, isEnabled: true, status: 'healthy', maskedKey: 'key-1', isSessionOnly: false },
      { slotId: 2, isEnabled: true, status: 'healthy', maskedKey: 'key-2', isSessionOnly: false }
    ]);

    const executor = new AiRequestExecutor(krm);
    let attemptsCount = 0;

    await assert.rejects(
      () => executor.execute(
        'extractReceipt',
        async () => {
          attemptsCount++;
          throw Object.assign(new Error('Internal Server Error'), { status: 500 });
        },
        async (index) => `decrypted-key-${index}`,
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /temporarily unavailable/i);
        assert.strictEqual((error as Error & { status?: number }).status, 500);
        return true;
      },
    );

    assert.strictEqual(attemptsCount, 1, 'Should not rotate keys for an app server failure');
    for (const slot of krm.getSlotsForTesting()) {
      assert.strictEqual(slot.status, 'healthy');
      assert.strictEqual(slot.cooldownUntil, undefined);
      assert.strictEqual(slot.failureCount, undefined);
    }
  });

  test('AiRequestExecutor: permanent deployment configuration failures preserve AI keys and do not retry', async () => {
    krm.updateSlots([
      { slotId: 1, isEnabled: true, status: 'healthy', maskedKey: 'key-1', isSessionOnly: false },
      { slotId: 2, isEnabled: true, status: 'healthy', maskedKey: 'key-2', isSessionOnly: false },
    ]);
    const executor = new AiRequestExecutor(krm);

    for (const [code, expectedMessage] of [
      ['DEPLOYMENT_PROTECTION_BLOCKED', 'Vercel Deployment Protection'],
      ['CONFIGURATION_UNAVAILABLE', 'Firebase Admin configuration'],
    ] as const) {
      let attempts = 0;
      await assert.rejects(
        () => executor.execute(
          'extractReceipt',
          async () => {
            attempts += 1;
            throw Object.assign(new Error('generic service failure'), { status: 503, code });
          },
          async index => `decrypted-key-${index}`,
        ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, new RegExp(expectedMessage));
          assert.strictEqual((error as Error & { status?: number; code?: string }).status, 424);
          assert.strictEqual((error as Error & { code?: string }).code, code);
          return true;
        },
      );
      assert.strictEqual(attempts, 1);
    }

    for (const slot of krm.getSlotsForTesting()) {
      assert.strictEqual(slot.status, 'healthy');
      assert.strictEqual(slot.cooldownUntil, undefined);
      assert.strictEqual(slot.failureCount, undefined);
    }
  });

  test('AiRequestExecutor: rotates to next key on rate_limit and applies cooldown', async () => {
    krm.updateSlots([
      { slotId: 1, isEnabled: true, status: 'healthy', maskedKey: 'key-1', isSessionOnly: false },
      { slotId: 2, isEnabled: true, status: 'healthy', maskedKey: 'key-2', isSessionOnly: false }
    ]);

    const executor = new AiRequestExecutor(krm);
    let callIndex = 0;

    const result = await executor.execute(
      'extractReceipt',
      async (key) => {
        callIndex++;
        if (key === 'decrypted-key-0') {
          const error = Object.assign(new Error('Rate limit exceeded'), {
            status: 429,
            code: 'QUOTA_EXCEEDED',
          });
          throw error;
        }
        return `success-with-${key}`;
      },
      async (index) => `decrypted-key-${index}`
    );

    assert.strictEqual(result, 'success-with-decrypted-key-1');
    assert.strictEqual(callIndex, 2);

    const slots = krm.getSlotsForTesting();
    assert.strictEqual(slots[0]!.status, 'cooldown');
    assert.strictEqual(slots[0]!.failureCount, 1);
    assert.ok(slots[0]!.cooldownUntil !== undefined && slots[0]!.cooldownUntil > timeNow);

    assert.strictEqual(slots[1]!.status, 'healthy');
    assert.strictEqual(slots[1]!.failureCount, 0);
  });

  test('AiRequestExecutor: app-wide rate limits preserve every Gemini key', async () => {
    krm.updateSlots([
      { slotId: 1, isEnabled: true, status: 'healthy', maskedKey: 'key-1', isSessionOnly: false },
      { slotId: 2, isEnabled: true, status: 'healthy', maskedKey: 'key-2', isSessionOnly: false },
    ]);
    const executor = new AiRequestExecutor(krm);
    let attempts = 0;

    await assert.rejects(
      () => executor.execute(
        'extractReceipt',
        async () => {
          attempts += 1;
          throw Object.assign(new Error('Another extraction is still running.'), {
            status: 429,
            code: 'EXTRACTION_IN_PROGRESS',
            retryAfterMs: 7000,
          });
        },
        async index => `decrypted-key-${index}`,
      ),
      (error: unknown) => {
        const requestError = error as Error & { status?: number; retryAfterMs?: number };
        assert.strictEqual(requestError.status, 429);
        assert.strictEqual(requestError.retryAfterMs, 7000);
        return true;
      },
    );

    assert.strictEqual(attempts, 1);
    for (const slot of krm.getSlotsForTesting()) {
      assert.strictEqual(slot.status, 'healthy');
      assert.strictEqual(slot.failureCount, undefined);
      assert.strictEqual(slot.cooldownUntil, undefined);
    }
  });

  test('AiRequestExecutor: malformed Gemini output does not rotate or cool keys', async () => {
    krm.updateSlots([
      { slotId: 1, isEnabled: true, status: 'healthy', maskedKey: 'key-1', isSessionOnly: false },
      { slotId: 2, isEnabled: true, status: 'healthy', maskedKey: 'key-2', isSessionOnly: false },
    ]);
    const executor = new AiRequestExecutor(krm);
    let attempts = 0;

    await assert.rejects(
      () => executor.execute(
        'extractReceipt',
        async () => {
          attempts += 1;
          throw Object.assign(new Error('Gemini response did not match expected schema'), {
            status: 422,
            code: 'UNPROCESSABLE_ENTITY',
          });
        },
        async index => `decrypted-key-${index}`,
      ),
      (error: unknown) => {
        assert.strictEqual((error as Error & { status?: number }).status, 422);
        return true;
      },
    );

    assert.strictEqual(attempts, 1);
    for (const slot of krm.getSlotsForTesting()) {
      assert.strictEqual(slot.status, 'healthy');
      assert.strictEqual(slot.failureCount, undefined);
      assert.strictEqual(slot.cooldownUntil, undefined);
    }
  });

  test('AiRequestExecutor: rotates to next key on auth_failed and marks key invalid', async () => {
    krm.updateSlots([
      { slotId: 1, isEnabled: true, status: 'healthy', maskedKey: 'key-1', isSessionOnly: false },
      { slotId: 2, isEnabled: true, status: 'healthy', maskedKey: 'key-2', isSessionOnly: false }
    ]);

    const executor = new AiRequestExecutor(krm);

    const result = await executor.execute(
      'extractReceipt',
      async (key) => {
        if (key === 'decrypted-key-0') {
          const error = Object.assign(new Error('Invalid Gemini key'), { status: 403 });
          throw error;
        }
        return `success-with-${key}`;
      },
      async (index) => `decrypted-key-${index}`
    );

    assert.strictEqual(result, 'success-with-decrypted-key-1');

    const slots = krm.getSlotsForTesting();
    assert.strictEqual(slots[0].status, 'invalid');
    assert.strictEqual(slots[1].status, 'healthy');
  });

  test('AiRequestExecutor: unavailable browser storage does not mark a key invalid', async () => {
    krm.updateSlots([
      { slotId: 1, isEnabled: true, status: 'healthy', maskedKey: 'key-1', isSessionOnly: false },
    ]);

    const executor = new AiRequestExecutor(krm);
    let operationCalled = false;

    await assert.rejects(
      () => executor.execute(
        'extractReceipt',
        async () => {
          operationCalled = true;
          return 'unexpected';
        },
        async () => null,
      ),
      /saved AI key is not available/i,
    );

    assert.strictEqual(operationCalled, false);
    const [slot] = krm.getSlotsForTesting();
    assert.strictEqual(slot.status, 'healthy');
    assert.strictEqual(slot.failureCount, undefined);
  });
});

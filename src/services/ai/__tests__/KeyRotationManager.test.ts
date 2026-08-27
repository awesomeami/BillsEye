import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { KeyRotationManager } from '../KeyRotationManager';
import { AiRequestExecutor } from '../AiRequestExecutor';

describe('KeyRotationManager Fake Clock Tests', () => {
  let krm: KeyRotationManager;
  let timeNow = 1000000;
  let originalDateNow: any;

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
    let slot = (krm as any).slots[0];
    assert.strictEqual(slot.status, 'cooldown');
    assert.ok(slot.failureCount === 1);
    const firstCooldown = slot.cooldownUntil - timeNow;
    assert.ok(firstCooldown >= 30000 && firstCooldown < 35000); // 30s + jitter

    // Advance time past cooldown
    timeNow += 40000;

    // Second failure
    krm.handleError(0, { code: 'rate_limit', message: 'Rate limit' });
    slot = (krm as any).slots[0];
    assert.ok(slot.failureCount === 2);
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
            const error: any = new Error('Unauthorized user token');
            error.status = 401;
            throw error;
          },
          async (index) => `decrypted-key-${index}`
        );
      },
      (err: any) => {
        assert.ok(err.message.includes('User authentication failed'));
        return true;
      }
    );

    // Only 1 attempt made (no key rotation loop triggered)
    assert.strictEqual(attemptsCount, 1, 'Should abort immediately without retrying other keys');

    // Slot 0 and Slot 1 must remain untouched
    const slots = (krm as any).slots;
    assert.strictEqual(slots[0].status, 'healthy');
    assert.strictEqual(slots[0].cooldownUntil, undefined);
    assert.strictEqual(slots[0].failureCount, undefined);

    assert.strictEqual(slots[1].status, 'healthy');
    assert.strictEqual(slots[1].cooldownUntil, undefined);
    assert.strictEqual(slots[1].failureCount, undefined);
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
          const error: any = new Error('Rate limit exceeded');
          error.status = 429;
          throw error;
        }
        return `success-with-${key}`;
      },
      async (index) => `decrypted-key-${index}`
    );

    assert.strictEqual(result, 'success-with-decrypted-key-1');
    assert.strictEqual(callIndex, 2);

    const slots = (krm as any).slots;
    assert.strictEqual(slots[0].status, 'cooldown');
    assert.strictEqual(slots[0].failureCount, 1);
    assert.ok(slots[0].cooldownUntil > timeNow);

    assert.strictEqual(slots[1].status, 'healthy');
    assert.strictEqual(slots[1].failureCount, 0);
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
          const error: any = new Error('Invalid Gemini key');
          error.status = 403;
          throw error;
        }
        return `success-with-${key}`;
      },
      async (index) => `decrypted-key-${index}`
    );

    assert.strictEqual(result, 'success-with-decrypted-key-1');

    const slots = (krm as any).slots;
    assert.strictEqual(slots[0].status, 'invalid');
    assert.strictEqual(slots[1].status, 'healthy');
  });
});

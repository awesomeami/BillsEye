import assert from 'node:assert';
import { describe, test } from 'node:test';
import {
  clearLegacyVaultRemnants,
  clearOfflineDeviceData,
  DEVICE_STORAGE_KEYS,
  getClearOfflineDataOnSignOutPreference,
  getTrustedDevicePreference,
  readLocalStorage,
  setClearOfflineDataOnSignOutPreference,
  setTrustedDevicePreference,
  shouldClearOfflineDataAfterSignOut,
} from '../offlineStorage';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
}

const restrictiveStorage = {
  getItem: () => { throw new DOMException('Blocked', 'SecurityError'); },
  setItem: () => { throw new DOMException('Blocked', 'SecurityError'); },
  removeItem: () => { throw new DOMException('Blocked', 'SecurityError'); },
};

describe('offline device storage', () => {
  test('restrictive browser storage cannot crash preference reads or writes', () => {
    assert.doesNotThrow(() => getTrustedDevicePreference(restrictiveStorage));
    assert.strictEqual(getTrustedDevicePreference(restrictiveStorage), false);
    assert.strictEqual(getClearOfflineDataOnSignOutPreference(restrictiveStorage), false);
    assert.strictEqual(readLocalStorage(DEVICE_STORAGE_KEYS.trustedDevice, restrictiveStorage), null);
    assert.strictEqual(setTrustedDevicePreference(true, restrictiveStorage), false);
    assert.strictEqual(setClearOfflineDataOnSignOutPreference(true, restrictiveStorage), false);
    assert.strictEqual(clearLegacyVaultRemnants(restrictiveStorage), false);
  });

  test('keeps trusted-device and shared-device cleanup opt-in preferences separate', () => {
    const storage = memoryStorage();
    assert.strictEqual(getTrustedDevicePreference(storage), false);
    assert.strictEqual(getClearOfflineDataOnSignOutPreference(storage), false);

    assert.strictEqual(setTrustedDevicePreference(true, storage), true);
    assert.strictEqual(setClearOfflineDataOnSignOutPreference(true, storage), true);
    assert.strictEqual(getTrustedDevicePreference(storage), true);
    assert.strictEqual(getClearOfflineDataOnSignOutPreference(storage), true);
    assert.strictEqual(shouldClearOfflineDataAfterSignOut(false, 'user-a'), false);
    assert.strictEqual(shouldClearOfflineDataAfterSignOut(true, null), false);
    assert.strictEqual(shouldClearOfflineDataAfterSignOut(true, 'user-a'), true);
  });

  test('clears Firestore persistence before local vault data and stops on a failed step', async () => {
    const calls: string[] = [];
    await clearOfflineDeviceData({
      terminateFirestore: async () => { calls.push('terminate'); },
      clearFirestorePersistence: async () => { calls.push('clear-firestore'); },
      clearLocalVault: async () => { calls.push('clear-vault'); },
      clearLegacyVaultRemnants: () => { calls.push('clear-legacy'); return true; },
    });
    assert.deepStrictEqual(calls, ['terminate', 'clear-firestore', 'clear-vault', 'clear-legacy']);

    const failedCalls: string[] = [];
    await assert.rejects(() => clearOfflineDeviceData({
      terminateFirestore: async () => { failedCalls.push('terminate'); },
      clearFirestorePersistence: async () => { failedCalls.push('clear-firestore'); throw new Error('blocked'); },
      clearLocalVault: async () => { failedCalls.push('clear-vault'); },
      clearLegacyVaultRemnants: () => { failedCalls.push('clear-legacy'); return true; },
    }));
    assert.deepStrictEqual(failedCalls, ['terminate', 'clear-firestore']);
  });
});

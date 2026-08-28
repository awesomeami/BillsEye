/**
 * Device-only preferences must never make startup depend on browser storage.
 * Some private browsing and managed-browser configurations throw even when
 * merely reading window.localStorage.
 */
export const DEVICE_STORAGE_KEYS = {
  trustedDevice: 'kharchalens_trusted_device',
  clearOfflineDataOnSignOut: 'kharchalens_clear_offline_on_sign_out',
  legacyVaultSalt: 'kharchalens_vault_salt',
  legacyVaultIv: 'kharchalens_vault_iv',
  legacyVaultData: 'kharchalens_vault_data',
} as const;

export type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface OfflineDataCleanupDependencies {
  terminateFirestore: () => Promise<void>;
  clearFirestorePersistence: () => Promise<void>;
  clearLocalVault: () => Promise<void>;
  clearLegacyVaultRemnants: () => boolean;
}

export function getSafeLocalStorage(): LocalStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLocalStorage(key: string, storage: LocalStorageLike | null = getSafeLocalStorage()): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeLocalStorage(key: string, value: string, storage: LocalStorageLike | null = getSafeLocalStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeLocalStorage(key: string, storage: LocalStorageLike | null = getSafeLocalStorage()): boolean {
  try {
    if (!storage) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function getTrustedDevicePreference(storage?: LocalStorageLike | null): boolean {
  return readLocalStorage(DEVICE_STORAGE_KEYS.trustedDevice, storage) === 'true';
}

export function setTrustedDevicePreference(enabled: boolean, storage?: LocalStorageLike | null): boolean {
  return enabled
    ? writeLocalStorage(DEVICE_STORAGE_KEYS.trustedDevice, 'true', storage)
    : removeLocalStorage(DEVICE_STORAGE_KEYS.trustedDevice, storage);
}

export function getClearOfflineDataOnSignOutPreference(storage?: LocalStorageLike | null): boolean {
  return readLocalStorage(DEVICE_STORAGE_KEYS.clearOfflineDataOnSignOut, storage) === 'true';
}

export function setClearOfflineDataOnSignOutPreference(enabled: boolean, storage?: LocalStorageLike | null): boolean {
  return enabled
    ? writeLocalStorage(DEVICE_STORAGE_KEYS.clearOfflineDataOnSignOut, 'true', storage)
    : removeLocalStorage(DEVICE_STORAGE_KEYS.clearOfflineDataOnSignOut, storage);
}

/** Returns false when a restrictive browser prevents us from confirming removal. */
export function clearLegacyVaultRemnants(storage?: LocalStorageLike | null): boolean {
  return [
    DEVICE_STORAGE_KEYS.legacyVaultSalt,
    DEVICE_STORAGE_KEYS.legacyVaultIv,
    DEVICE_STORAGE_KEYS.legacyVaultData,
  ].every(key => removeLocalStorage(key, storage));
}

/**
 * Firestore must be terminated before clearing its IndexedDB persistence. The
 * caller reloads only after this resolves, so it never reports a cache clear
 * that could not be confirmed.
 */
export async function clearOfflineDeviceData(dependencies: OfflineDataCleanupDependencies): Promise<void> {
  await dependencies.terminateFirestore();
  await dependencies.clearFirestorePersistence();
  await dependencies.clearLocalVault();
  if (!dependencies.clearLegacyVaultRemnants()) {
    throw new Error('Could not confirm removal of legacy local vault remnants.');
  }
}

export function shouldClearOfflineDataAfterSignOut(
  clearOnSignOutEnabled: boolean,
  signedOutUserId: string | null,
): boolean {
  return clearOnSignOutEnabled && Boolean(signedOutUserId);
}

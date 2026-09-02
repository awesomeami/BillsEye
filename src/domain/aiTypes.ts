export interface AiKeySlot {
  slotId: number;
  label?: string;
  maskedKey: string;
  isEnabled: boolean;
  isSessionOnly: boolean;
  status: 'healthy' | 'cooldown' | 'invalid' | 'untested';
  lastSuccessAt?: number;
  cooldownUntil?: number;
  failureCount?: number;
  requiresMigration?: boolean;
}

/** Keyless metadata retained after legacy plaintext material is removed. */
export interface LegacyKeyReentryMetadata {
  slotId: number;
}

/**
 * A Gemini key saved in this browser for one authenticated account.
 *
 * The browser must be able to read the key after a reload to submit a receipt,
 * so this is deliberately a device-local IndexedDB record rather than a
 * passphrase-encrypted vault. It is never sent to Firestore; its local record
 * is scoped by the authenticated account ID.
 */
export interface LocalKeyRecord {
  slotId: number;
  label?: string;
  maskedKey: string;
  isEnabled: boolean;
  recordVersion: 3;
  key: string;
}

export type VaultState = 'unconfigured' | 'unlocked' | 'migration-required';

export interface VaultInspection {
  localKeys: LocalKeyRecord[];
  legacyKeys: LegacyKeyReentryMetadata[];
}

export interface AiRequestError {
  code: 'rate_limit' | 'service_rate_limit' | 'auth_failed' | 'network_error' | 'bad_request' | 'cancelled' | 'unknown' | 'fatal_auth_error';
  message: string;
  retryAfterMs?: number;
}

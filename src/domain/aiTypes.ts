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

/** Historical IndexedDB shape. It is read only to offer removal/re-entry, never used as a key source. */
export interface LegacyPlaintextKeyRecord {
  slotId: number;
  label?: string;
  maskedKey: string;
  key: string;
  isEnabled: boolean;
}

export interface EncryptedKeyRecord {
  slotId: number;
  label?: string;
  maskedKey: string;
  isEnabled: boolean;
  recordVersion: 2;
  ciphertextBase64: string;
  ivBase64: string;
}

export interface VaultMetadata {
  metadataVersion: 2;
  saltBase64: string;
}

export type VaultState = 'unconfigured' | 'locked' | 'unlocked' | 'migration-required';

export interface VaultInspection {
  metadata: VaultMetadata | null;
  encryptedKeys: EncryptedKeyRecord[];
  legacyKeys: Array<Omit<LegacyPlaintextKeyRecord, 'key'>>;
}

export interface AiRequestError {
  code: 'rate_limit' | 'auth_failed' | 'network_error' | 'bad_request' | 'cancelled' | 'unknown' | 'fatal_auth_error';
  message: string;
  retryAfterMs?: number;
}

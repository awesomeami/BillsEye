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
}

export interface StoredKeyRecord {
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
  key?: string;
  // Crypto metadata (optional for backwards compatibility)
  ciphertextBase64?: string;
  ivBase64?: string;
  saltBase64?: string;
}

export interface AiRequestError {
  code: 'rate_limit' | 'auth_failed' | 'network_error' | 'bad_request' | 'cancelled' | 'unknown' | 'fatal_auth_error';
  message: string;
  retryAfterMs?: number;
}

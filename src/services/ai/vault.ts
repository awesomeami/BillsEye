import {
  EncryptedKeyRecord,
  LegacyPlaintextKeyRecord,
  VaultInspection,
  VaultMetadata,
  VaultState
} from '../../domain/aiTypes';

const DB_NAME = 'KharchaLens_AIVault';
const DB_VERSION = 1;
const metadataId = (uid: string) => `${uid}_metadata`;

type StoredVaultEntry = Record<string, unknown> & { id: string; uid: string };

/**
 * Keeps cleanup scoped to the authenticated user's records, including vault
 * metadata and both legacy and encrypted entries.
 */
export function selectVaultEntriesForUser<T extends { uid: unknown }>(entries: T[], uid: string): T[] {
  return entries.filter(entry => entry.uid === uid);
}

export function isEncryptedVaultRecord(value: unknown): value is EncryptedKeyRecord {
  const record = value as Partial<EncryptedKeyRecord> | null;
  return Boolean(
    record &&
    record.recordVersion === 2 &&
    typeof record.slotId === 'number' &&
    typeof record.ciphertextBase64 === 'string' &&
    typeof record.ivBase64 === 'string'
  );
}

export function shouldPersistKey(isSessionOnly: boolean) {
  return !isSessionOnly;
}

export function getVaultStartupState(inspection: VaultInspection): VaultState {
  if (inspection.encryptedKeys.length > 0) return 'locked';
  if (inspection.legacyKeys.length > 0) return 'migration-required';
  return 'unconfigured';
}

export class AiVault {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private uid: string;

  constructor(uid: string) {
    this.uid = uid;
  }

  private initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('encrypted_keys')) {
          db.createObjectStore('encrypted_keys', { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  private generateId(slotId: number): string {
    return `${this.uid}_${slotId}`;
  }

  private async getEntriesForUser(): Promise<StoredVaultEntry[]> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('encrypted_keys', 'readonly');
      const request = transaction.objectStore('encrypted_keys').getAll();
      request.onsuccess = () => resolve(selectVaultEntriesForUser(request.result || [], this.uid));
      request.onerror = () => reject(request.error);
    });
  }

  async saveMetadata(metadata: VaultMetadata): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('encrypted_keys', 'readwrite');
      const store = transaction.objectStore('encrypted_keys');
      const data = { id: metadataId(this.uid), uid: this.uid, recordType: 'metadata', ...metadata };
      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getInspection(): Promise<VaultInspection> {
    const entries = await this.getEntriesForUser();
    const metadataEntry = entries.find(entry => entry.id === metadataId(this.uid) && entry.recordType === 'metadata');
    const metadata = metadataEntry && metadataEntry.metadataVersion === 2 && typeof metadataEntry.saltBase64 === 'string'
      ? { metadataVersion: 2 as const, saltBase64: metadataEntry.saltBase64 }
      : null;

    const encryptedKeys: EncryptedKeyRecord[] = [];
    const legacyKeys: Array<Omit<LegacyPlaintextKeyRecord, 'key'>> = [];
    for (const entry of entries) {
      if (entry.id === metadataId(this.uid)) continue;
      if (isEncryptedVaultRecord(entry)) {
        encryptedKeys.push({
          slotId: entry.slotId,
          label: entry.label,
          maskedKey: entry.maskedKey,
          isEnabled: entry.isEnabled,
          recordVersion: 2,
          ciphertextBase64: entry.ciphertextBase64,
          ivBase64: entry.ivBase64
        });
      } else if (typeof entry.slotId === 'number') {
        // Never return a legacy record's plaintext `key` to application memory.
        legacyKeys.push({
          slotId: entry.slotId,
          label: typeof entry.label === 'string' ? entry.label : undefined,
          maskedKey: typeof entry.maskedKey === 'string' ? entry.maskedKey : '••••••••',
          isEnabled: entry.isEnabled !== false
        });
      }
    }
    return { metadata, encryptedKeys, legacyKeys };
  }

  async saveEncryptedKey(record: EncryptedKeyRecord): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('encrypted_keys', 'readwrite');
      const request = transaction.objectStore('encrypted_keys').put({
        id: this.generateId(record.slotId),
        uid: this.uid,
        recordType: 'encrypted',
        ...record
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async removeKey(slotId: number): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('encrypted_keys', 'readwrite');
      const store = transaction.objectStore('encrypted_keys');
      const request = store.delete(this.generateId(slotId));

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async removeMetadata(): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('encrypted_keys', 'readwrite');
      const request = transaction.objectStore('encrypted_keys').delete(metadataId(this.uid));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async updateKeyEnabled(slotId: number, isEnabled: boolean): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('encrypted_keys', 'readwrite');
      const store = transaction.objectStore('encrypted_keys');
      const request = store.get(this.generateId(slotId));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (!request.result) return resolve();
        const update = store.put({ ...request.result, isEnabled });
        update.onsuccess = () => resolve();
        update.onerror = () => reject(update.error);
      };
    });
  }

  async clearLegacyForUser(): Promise<void> {
    const entries = await this.getEntriesForUser();
    const legacyIds = entries
      .filter(entry => entry.id !== metadataId(this.uid) && !isEncryptedVaultRecord(entry) && typeof entry.slotId === 'number')
      .map(entry => entry.id);
    await this.deleteEntries(legacyIds);
  }

  private async deleteEntries(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('encrypted_keys', 'readwrite');
      const store = transaction.objectStore('encrypted_keys');
      ids.forEach(id => store.delete(id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async clearAllForUser(): Promise<void> {
    const entries = await this.getEntriesForUser();
    await this.deleteEntries(entries.map(entry => entry.id));
  }
}

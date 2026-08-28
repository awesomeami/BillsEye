import {
  EncryptedKeyRecord,
  LegacyKeyReentryMetadata,
  VaultInspection,
  VaultMetadata,
  VaultState
} from '../../domain/aiTypes';

const DB_NAME = 'KharchaLens_AIVault';
const DB_VERSION = 1;
const metadataId = (uid: string) => `${uid}_metadata`;

type StoredVaultEntry = Record<string, unknown> & { id: string; uid: string };
export type LegacyReentryMarker = StoredVaultEntry & {
  recordType: 'reentry-required';
  slotId: number;
  requiresReentry: true;
};

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

export function isLegacyReentryMarker(value: unknown): value is LegacyReentryMarker {
  const record = value as Partial<LegacyReentryMarker> | null;
  return Boolean(
    record &&
    typeof record.id === 'string' &&
    typeof record.uid === 'string' &&
    record.recordType === 'reentry-required' &&
    typeof record.slotId === 'number' &&
    record.requiresReentry === true
  );
}

export function createLegacyReentryMarker(entry: StoredVaultEntry): LegacyReentryMarker {
  if (typeof entry.slotId !== 'number') throw new Error('Legacy vault record is missing its slot identifier.');
  return {
    id: entry.id,
    uid: entry.uid,
    recordType: 'reentry-required',
    slotId: entry.slotId,
    requiresReentry: true,
  };
}

export function getLegacyVaultReplacement(entry: StoredVaultEntry): LegacyReentryMarker | null {
  if (entry.recordType === 'metadata' || isEncryptedVaultRecord(entry) || isLegacyReentryMarker(entry)) return null;
  return typeof entry.slotId === 'number' ? createLegacyReentryMarker(entry) : null;
}

export function planLegacyVaultReplacements(entries: StoredVaultEntry[]): LegacyReentryMarker[] {
  return entries.flatMap(entry => {
    const replacement = getLegacyVaultReplacement(entry);
    return replacement ? [replacement] : [];
  });
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
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('encrypted_keys', 'readwrite');
      const store = transaction.objectStore('encrypted_keys');
      const request = store.getAll();
      let inspection: VaultInspection | null = null;

      request.onsuccess = () => {
        const allEntries = (request.result || []) as StoredVaultEntry[];
        const entries = selectVaultEntriesForUser(allEntries, this.uid);
        const metadataEntry = entries.find(entry => entry.id === metadataId(this.uid) && entry.recordType === 'metadata');
        const metadata = metadataEntry && metadataEntry.metadataVersion === 2 && typeof metadataEntry.saltBase64 === 'string'
          ? { metadataVersion: 2 as const, saltBase64: metadataEntry.saltBase64 }
          : null;
        const encryptedKeys: EncryptedKeyRecord[] = [];
        const legacyKeys: LegacyKeyReentryMetadata[] = [];

        for (const entry of entries) {
          if (entry.id === metadataId(this.uid) && entry.recordType === 'metadata') continue;
          if (isEncryptedVaultRecord(entry)) {
            encryptedKeys.push({
              slotId: entry.slotId,
              label: entry.label,
              maskedKey: entry.maskedKey,
              isEnabled: entry.isEnabled,
              recordVersion: 2,
              ciphertextBase64: entry.ciphertextBase64,
              ivBase64: entry.ivBase64,
            });
          } else if (typeof entry.slotId === 'number') {
            legacyKeys.push({ slotId: entry.slotId });
          }
        }
        for (const replacement of planLegacyVaultReplacements(allEntries)) store.put(replacement);
        for (const entry of allEntries) {
          if (getLegacyVaultReplacement(entry)) {
            for (const property of Object.keys(entry)) delete entry[property];
          }
        }
        allEntries.length = 0;
        entries.length = 0;
        inspection = { metadata, encryptedKeys, legacyKeys };
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => {
        if (inspection) resolve(inspection);
        else reject(new Error('Could not inspect the local key vault.'));
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
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
      .filter(entry => entry.recordType !== 'metadata' && !isEncryptedVaultRecord(entry) && typeof entry.slotId === 'number')
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

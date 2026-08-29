import { LocalKeyRecord, VaultInspection, VaultState } from '../../domain/aiTypes';

const DB_NAME = 'KharchaLens_AIVault';
const DB_VERSION = 1;

type StoredVaultEntry = Record<string, unknown> & { id: string; uid: string };
export type LegacyReentryMarker = StoredVaultEntry & {
  recordType: 'reentry-required';
  slotId: number;
  requiresReentry: true;
};

/** Keeps every vault operation scoped to the signed-in account. */
export function selectVaultEntriesForUser<T extends { uid: unknown }>(entries: T[], uid: string): T[] {
  return entries.filter(entry => entry.uid === uid);
}

export function isLocalKeyRecord(value: unknown): value is LocalKeyRecord {
  const record = value as Partial<LocalKeyRecord> | null;
  return Boolean(
    record
    && record.recordVersion === 3
    && typeof record.slotId === 'number'
    && typeof record.key === 'string'
    && typeof record.maskedKey === 'string'
    && typeof record.isEnabled === 'boolean',
  );
}

export function isLegacyReentryMarker(value: unknown): value is LegacyReentryMarker {
  const record = value as Partial<LegacyReentryMarker> | null;
  return Boolean(
    record
    && typeof record.id === 'string'
    && typeof record.uid === 'string'
    && record.recordType === 'reentry-required'
    && typeof record.slotId === 'number'
    && record.requiresReentry === true,
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

/**
 * Plaintext records from versions before the passphrase vault are converted to
 * a marker. Passphrase-encrypted records are left in place so replacing that
 * slot can overwrite it without an extra cleanup step.
 */
export function getLegacyVaultReplacement(entry: StoredVaultEntry): LegacyReentryMarker | null {
  if (
    entry.recordType === 'metadata'
    || entry.recordType === 'encrypted'
    || isLocalKeyRecord(entry)
    || isLegacyReentryMarker(entry)
  ) return null;
  return typeof entry.slotId === 'number' ? createLegacyReentryMarker(entry) : null;
}

export function planLegacyVaultReplacements(entries: StoredVaultEntry[]): LegacyReentryMarker[] {
  return entries.flatMap(entry => {
    const replacement = getLegacyVaultReplacement(entry);
    return replacement ? [replacement] : [];
  });
}

export function getVaultStartupState(inspection: VaultInspection): VaultState {
  if (inspection.localKeys.length > 0) return 'unlocked';
  if (inspection.legacyKeys.length > 0) return 'migration-required';
  return 'unconfigured';
}

export class AiVault {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly uid: string) {}

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
        const localKeys: LocalKeyRecord[] = [];
        const legacySlotIds = new Set<number>();

        for (const entry of entries) {
          if (isLocalKeyRecord(entry)) {
            localKeys.push({
              slotId: entry.slotId,
              label: entry.label,
              maskedKey: entry.maskedKey,
              isEnabled: entry.isEnabled,
              recordVersion: 3,
              key: entry.key,
            });
          } else if (entry.recordType !== 'metadata' && typeof entry.slotId === 'number') {
            // Version 2 records need a passphrase that this app no longer
            // requests. They must be entered once more to save locally.
            legacySlotIds.add(entry.slotId);
          }
        }

        for (const replacement of planLegacyVaultReplacements(allEntries)) store.put(replacement);
        inspection = {
          localKeys,
          legacyKeys: [...legacySlotIds].sort((left, right) => left - right).map(slotId => ({ slotId })),
        };
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => inspection
        ? resolve(inspection)
        : reject(new Error('Could not inspect the local key vault.'));
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async saveLocalKey(record: LocalKeyRecord): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('encrypted_keys', 'readwrite');
      const request = transaction.objectStore('encrypted_keys').put({
        id: this.generateId(record.slotId),
        uid: this.uid,
        recordType: 'local',
        ...record,
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async removeKey(slotId: number): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('encrypted_keys', 'readwrite');
      const request = transaction.objectStore('encrypted_keys').delete(this.generateId(slotId));
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
    await this.deleteEntries(entries
      .filter(entry => !isLocalKeyRecord(entry))
      .map(entry => entry.id));
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

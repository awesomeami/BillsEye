import { StoredKeyRecord } from '../../domain/aiTypes';

const DB_NAME = 'KharchaLens_AIVault';
const DB_VERSION = 1;

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

  async saveKey(record: StoredKeyRecord): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('encrypted_keys', 'readwrite');
      const store = transaction.objectStore('encrypted_keys');
      const data = { id: this.generateId(record.slotId), ...record, uid: this.uid };
      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getKeys(): Promise<StoredKeyRecord[]> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('encrypted_keys', 'readonly');
      const store = transaction.objectStore('encrypted_keys');
      const request = store.getAll();

      request.onsuccess = () => {
        const allKeys = request.result || [];
        // Filter by current UID
        const userKeys = allKeys.filter(k => k.uid === this.uid).map(k => {
          const { id: _id, uid: _uid, ...record } = k;
          return {
            slotId: record.slotId,
            label: record.label,
            maskedKey: record.maskedKey,
            key: record.key || '',
            isEnabled: record.isEnabled ?? true,
          } as StoredKeyRecord;
        });
        resolve(userKeys);
      };
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

  async clearAllForUser(): Promise<void> {
    const keys = await this.getKeys();
    for (const key of keys) {
      await this.removeKey(key.slotId);
    }
  }
}

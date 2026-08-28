export type ReceiptSyncState = 'offline' | 'pending-writes' | 'syncing' | 'synced' | 'error';

export interface FirestoreSnapshotSyncMetadata {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export interface ReceiptSyncInputs {
  online: boolean;
  loading: boolean;
  hasError: boolean;
  sources: ReadonlyArray<FirestoreSnapshotSyncMetadata | null>;
}

/** Maps Firestore metadata and browser connectivity to an honest UI state. */
export function deriveReceiptSyncState({ online, loading, hasError, sources }: ReceiptSyncInputs): ReceiptSyncState {
  if (!online) return 'offline';
  if (hasError) return 'error';
  if (loading || sources.some(source => source === null)) return 'syncing';
  if (sources.some(source => source?.hasPendingWrites)) return 'pending-writes';
  if (sources.some(source => source?.fromCache)) return 'syncing';
  return 'synced';
}

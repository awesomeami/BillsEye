import {
  USER_OWNED_SUBCOLLECTIONS,
  USER_OWNED_SUBCOLLECTION_NAMES,
  UserOwnedSubcollection,
} from '../domain/userData.js';

export interface DeletionCollectionReference {
  get(): Promise<{ docs: Array<{ ref: DeletionDocumentReference }> }>;
  doc(id: string): DeletionDocumentReference;
}

export interface DeletionDocumentReference {
  collection(path: string): DeletionCollectionReference;
  delete(): Promise<void>;
}

export interface DeletionBatch {
  delete(ref: DeletionDocumentReference): void;
  commit(): Promise<void>;
}

export interface DeletionDatabase {
  collection(path: string): DeletionCollectionReference;
  batch(): DeletionBatch;
  recursiveDelete?(ref: DeletionCollectionReference): Promise<void>;
}

export interface UserDeletionProgress {
  deletedDocuments: number;
  completedCollections: UserOwnedSubcollection[];
}

export class UserDeletionError extends Error {
  constructor(
    readonly progress: UserDeletionProgress,
    readonly failedCollection: UserOwnedSubcollection,
  ) {
    super('User data deletion was only partially completed.');
  }
}

class CollectionDeletionError extends Error {
  constructor(readonly deletedDocuments: number) {
    super('Collection deletion was only partially completed.');
  }
}

const MAX_BATCH_SIZE = 500;

async function deleteReferencesInBatches(
  db: DeletionDatabase,
  refs: DeletionDocumentReference[],
): Promise<number> {
  let deleted = 0;
  for (let index = 0; index < refs.length; index += MAX_BATCH_SIZE) {
    const batch = db.batch();
    const slice = refs.slice(index, index + MAX_BATCH_SIZE);
    slice.forEach(ref => batch.delete(ref));
    if (slice.length > 0) {
      try {
        await batch.commit();
        deleted += slice.length;
      } catch {
        throw new CollectionDeletionError(deleted);
      }
    }
  }
  return deleted;
}

async function deleteReceiptDocuments(db: DeletionDatabase, uid: string): Promise<number> {
  const receipts = db.collection(`users/${uid}/receipts`);
  // Recursive deletion is essential in production: Firestore permits a
  // subcollection beneath a missing parent, which a normal collection query
  // cannot enumerate. The Admin SDK traverses every descendant of this scope.
  if (db.recursiveDelete) {
    await db.recursiveDelete(receipts);
    return 0;
  }

  const receiptSnapshot = await receipts.get();
  const refs: DeletionDocumentReference[] = [];
  for (const receipt of receiptSnapshot.docs) {
    for (const nestedName of USER_OWNED_SUBCOLLECTIONS.receipts.nestedCollections) {
      const nestedSnapshot = await receipt.ref.collection(nestedName).get();
      refs.push(...nestedSnapshot.docs.map(item => item.ref));
    }
    refs.push(receipt.ref);
  }
  return deleteReferencesInBatches(db, refs);
}

async function deleteFlatCollection(
  db: DeletionDatabase,
  uid: string,
  collectionName: Exclude<UserOwnedSubcollection, 'receipts'>,
): Promise<number> {
  const snapshot = await db.collection(`users/${uid}/${collectionName}`).get();
  return deleteReferencesInBatches(db, snapshot.docs.map(item => item.ref));
}

/**
 * Deletes every collection in the central user-data manifest. Firestore has no
 * cross-collection transaction for deletes, so callers receive committed
 * progress if a later collection or batch fails and can safely retry.
 */
export async function deleteUserOwnedData(
  db: DeletionDatabase,
  uid: string,
): Promise<UserDeletionProgress> {
  const progress: UserDeletionProgress = {
    deletedDocuments: 0,
    completedCollections: [],
  };

  for (const collectionName of USER_OWNED_SUBCOLLECTION_NAMES) {
    try {
      const deleted = collectionName === 'receipts'
        ? await deleteReceiptDocuments(db, uid)
        : await deleteFlatCollection(db, uid, collectionName);
      progress.deletedDocuments += deleted;
      progress.completedCollections.push(collectionName);
    } catch (error) {
      const committedInFailedCollection = error instanceof CollectionDeletionError
        ? error.deletedDocuments
        : 0;
      progress.deletedDocuments += committedInFailedCollection;
      throw new UserDeletionError({
        deletedDocuments: progress.deletedDocuments,
        completedCollections: [...progress.completedCollections],
      }, collectionName);
    }
  }
  return progress;
}

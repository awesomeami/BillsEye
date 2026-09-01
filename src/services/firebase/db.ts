import {
  collection, 
  doc, 
  getDoc, 
  setDoc,
  updateDoc,
  deleteDoc, 
  getDocs, 
  query, 
  where,
  orderBy,
  onSnapshot,
  DocumentData,
  QueryDocumentSnapshot,
  SnapshotOptions,
  QuerySnapshot,
  serverTimestamp,
  runTransaction,
  writeBatch,
  Timestamp
} from 'firebase/firestore';
import { ReceiptHydrationCache } from './receiptHydrationCache';
import { db } from './config';
import { getAuth } from 'firebase/auth';
import { handleFirestoreError, OperationType } from './errors';
import { 
  UserProfileDocument, 
  UserProfileSchema,
  ReceiptDocument,
  ReceiptItemSchema,
  ReceiptSchema,
  ReceiptWriteSchema,
  StoredReceiptWriteSchema,
  CategoryDocument,
  CategorySchema,
  AliasDocument,
  AliasSchema,
  AppSettingsDocument,
  AppSettingsSchema
} from '../../domain/schema';
import {
  DEFAULT_CATEGORIES,
  canonicalizeReceiptItemCategories,
  categoryMatchesLegacyName,
  normalizeCategoryName,
  normalizeMerchantName,
} from '../../domain/categories';
import { replaceCategoryInReceiptWithRetry } from '../../domain/categoryReplacement';
import { SequencedAsyncSubscription } from './subscriptionIsolation';

export class ReceiptRevisionConflictError extends Error {
  readonly code = 'receipt-revision-conflict';

  constructor() {
    super('Conflict: Receipt was updated by another device.');
    this.name = 'ReceiptRevisionConflictError';
  }
}

const processTimestamp = (value: unknown) => {
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return value;
};

const normalizeReceiptTimestamps = (data: DocumentData): DocumentData => ({
  ...data,
  createdAt: processTimestamp(data.createdAt),
  updatedAt: processTimestamp(data.updatedAt),
  confirmedAt: processTimestamp(data.confirmedAt),
});

const validateReceiptForWrite = (receipt: unknown): ReceiptDocument => {
  const parsed = ReceiptWriteSchema.safeParse(receipt);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 3)
      .map(issue => `${issue.path.join('.') || 'receipt'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Receipt validation failed before write: ${details}`);
  }
  return parsed.data;
};

const validateStoredReceiptForWrite = (receipt: unknown): DocumentData => {
  const parsed = StoredReceiptWriteSchema.safeParse(receipt);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 3)
      .map(issue => `${issue.path.join('.') || 'receipt'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Stored receipt validation failed before write: ${details}`);
  }
  return parsed.data;
};

const parseStoredReceiptItem = (data: unknown) => {
  const parsed = ReceiptItemSchema.strict().safeParse(data);
  if (!parsed.success) {
    throw new Error('Receipt contains a malformed item and cannot be updated safely.');
  }
  return parsed.data;
};

interface MalformedFirestoreDocument {
  _malformed: true;
  id: string;
  error?: unknown;
}

type HydratedReceipt = ReceiptDocument | MalformedFirestoreDocument;

const isMalformedReceipt = (receipt: HydratedReceipt): receipt is MalformedFirestoreDocument =>
  '_malformed' in receipt && receipt._malformed === true;

// Helper to create typed converters with Zod validation
// Explicit converters with safeParse for reads
export const converters = {
  user: {
    toFirestore: (data: UserProfileDocument): DocumentData => {
      return data;
    },
    fromFirestore: (snapshot: QueryDocumentSnapshot, options: SnapshotOptions): UserProfileDocument => {
      const data = {
        ...snapshot.data(options),
        createdAt: processTimestamp(snapshot.data(options).createdAt),
        lastLoginAt: processTimestamp(snapshot.data(options).lastLoginAt),
      };
      const parsed = UserProfileSchema.safeParse(data);
      if (!parsed.success) {
        console.error('Stored user profile validation failed.');
        throw new Error("Malformed UserProfile");
      }
      return parsed.data;
    }
  },
  receipt: {
    toFirestore: (data: ReceiptDocument): DocumentData => {
      return data;
    },
    fromFirestore: (snapshot: QueryDocumentSnapshot, options: SnapshotOptions): HydratedReceipt => {
      const data = normalizeReceiptTimestamps(snapshot.data(options));
      
      const parsed = ReceiptSchema.safeParse(data);
      if (!parsed.success) {
        console.error('Stored receipt validation failed.');
        return { _malformed: true, id: snapshot.id, error: parsed.error };
      }
      return parsed.data;
    }
  },
  category: {
    toFirestore: (data: CategoryDocument): DocumentData => data,
    fromFirestore: (snapshot: QueryDocumentSnapshot, options: SnapshotOptions): CategoryDocument => {
      const snapshotData = snapshot.data(options);
      const data = { ...snapshotData, createdAt: processTimestamp(snapshotData.createdAt) };
      const parsed = CategorySchema.safeParse(data);
      if (!parsed.success) {
        console.error('Stored category validation failed.');
        throw new Error(`Malformed category ${snapshot.id}`);
      }
      return parsed.data;
    }
  },
  settings: {
    toFirestore: (data: AppSettingsDocument): DocumentData => data,
    fromFirestore: (snapshot: QueryDocumentSnapshot, options: SnapshotOptions): AppSettingsDocument => {
      const data = snapshot.data(options);
      const parsed = AppSettingsSchema.safeParse(data);
      if (!parsed.success) {
        return AppSettingsSchema.parse({});
      }
      return parsed.data;
    }
  }
};

const hydrateReceiptItems = async (receiptRef: ReturnType<typeof doc>, data: DocumentData): Promise<HydratedReceipt> => {
  const normalized = normalizeReceiptTimestamps(data);
  const parsed = ReceiptSchema.safeParse(normalized);
  if (!parsed.success) {
    console.error('Stored receipt validation failed.');
    return { _malformed: true, id: receiptRef.id, error: parsed.error };
  }

  // Version 1 receipts retain their inline items and remain readable without
  // migration. Version 2 receipts store each fully validated item separately.
  if (data.itemStorageVersion !== 2) {
    return parsed.data;
  }

  try {
    const itemSnapshot = await getDocs(collection(receiptRef, 'items'));
    const items = itemSnapshot.docs
      .sort((left, right) => Number(left.id) - Number(right.id))
      .map(item => parseStoredReceiptItem(item.data()));
    return { ...parsed.data, items };
  } catch {
    console.error('Stored receipt item validation failed.');
    return { _malformed: true, id: receiptRef.id };
  }
};

const loadUserCategories = async (uid: string): Promise<CategoryDocument[]> => {
  const snapshot = await getDocs(collection(db, `users/${uid}/categories`));
  return snapshot.docs.flatMap(categorySnapshot => {
    const parsed = CategorySchema.safeParse(categorySnapshot.data());
    return parsed.success ? [parsed.data] : [];
  });
};

export const userRepository = {
  async getOrCreateProfile(uid: string, email: string, displayName?: string | null): Promise<UserProfileDocument> {
    const userRef = doc(db, 'users', uid).withConverter(converters.user);
    const auth = getAuth();
    let userSnap;
    try {
      userSnap = await getDoc(userRef);
    } catch (error) {
      if (error instanceof Error && error.message.includes('offline')) {
        console.warn('Client is offline, using temporary profile');
        const now = new Date().toISOString();
        return {
          email,
          displayName: displayName || email,
          createdAt: now,
          lastLoginAt: now,
          schemaVersion: 1,
        };
      }
      handleFirestoreError(error, OperationType.GET, `users/${uid}`, auth);
    }

    if (userSnap.exists()) {
      const current = userSnap.data();
      setDoc(userRef, { lastLoginAt: serverTimestamp() }, { merge: true })
        .catch(() => console.warn('Could not update the profile login timestamp.'));
      return current;
    }

    const now = new Date().toISOString();
    const newProfile = {
      email,
      displayName: displayName || email,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      schemaVersion: 1,
    };
    try {
      await setDoc(userRef, newProfile);
      this.seedDefaultCategories(uid).catch(() => console.warn('Could not seed default categories.'));
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}`, auth);
    }
    return {
      email,
      displayName: displayName || email,
      createdAt: now,
      lastLoginAt: now,
      schemaVersion: 1,
    };
  },

  async seedDefaultCategories(uid: string) {
    const categoriesRef = collection(db, `users/${uid}/categories`).withConverter(converters.category);
    const now = new Date().toISOString();
    const auth = getAuth();
    
    let order = 0;
    for (const name of DEFAULT_CATEGORIES) {
      const id = `cat_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const catRef = doc(categoriesRef, id);
      try {
        await setDoc(catRef, {
          id,
          name,
          legacyNames: [],
          isCustom: false,
          createdAt: now,
          order: order++,
          isActive: true
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/categories/${id}`, auth);
      }
    }
  }
};

export const receiptRepository = {
  subscribeToReceipts(
    uid: string,
    onUpdate: (receipts: ReceiptDocument[]) => void,
    onError: (error: Error) => void,
    onMetadata?: (metadata: { fromCache: boolean; hasPendingWrites: boolean }) => void,
  ) {
    const auth = getAuth();
    const receiptsRef = collection(db, `users/${uid}/receipts`);
    // Realtime sync all confirmed receipts for fast local search/filter
    // We order by transactionDate descending
    const q = query(receiptsRef, where('status', '==', 'confirmed'), orderBy('transactionDate', 'desc'));
    
    // The cache belongs to this UID-scoped subscription and is discarded on
    // unsubscribe, so neither auth transitions nor replacement generations can
    // reuse another session's hydrated receipt data.
    const hydrationCache = new ReceiptHydrationCache<
      ReturnType<typeof doc>,
      DocumentData,
      Awaited<ReturnType<typeof hydrateReceiptItems>>
    >();
    const sequencer = new SequencedAsyncSubscription<QuerySnapshot<DocumentData>, ReceiptDocument[]>({
      hydrate: async snapshot => {
        const receipts = await hydrationCache.hydrate(
          snapshot.docs.map(docSnap => ({ id: docSnap.id, ref: docSnap.ref, data: docSnap.data() })),
          source => hydrateReceiptItems(source.ref, source.data),
        );
        return receipts.filter((receipt): receipt is ReceiptDocument => !isMalformedReceipt(receipt));
      },
      onUpdate,
      onError: error => onError(error instanceof Error ? error : new Error('Could not load receipts.')),
    });
    // Server acknowledgements and cache-to-server transitions can change only metadata.
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, snapshot => {
      onMetadata?.({
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
      sequencer.next(snapshot);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `users/${uid}/receipts`, auth);
      } catch (error) {
        sequencer.fail(error);
      }
    });
    return () => {
      sequencer.deactivate();
      hydrationCache.clear();
      unsubscribe();
    };
  },

  subscribeToPendingReceipts(
    uid: string,
    onUpdate: (receipts: ReceiptDocument[]) => void,
    onError: (error: Error) => void,
    onMetadata?: (metadata: { fromCache: boolean; hasPendingWrites: boolean }) => void,
  ) {
    const auth = getAuth();
    const receiptsRef = collection(db, `users/${uid}/receipts`);
    const q = query(receiptsRef, where('status', '==', 'pendingReview'), orderBy('createdAt', 'desc'));
    
    const hydrationCache = new ReceiptHydrationCache<
      ReturnType<typeof doc>,
      DocumentData,
      Awaited<ReturnType<typeof hydrateReceiptItems>>
    >();
    const sequencer = new SequencedAsyncSubscription<QuerySnapshot<DocumentData>, ReceiptDocument[]>({
      hydrate: async snapshot => {
        const receipts = await hydrationCache.hydrate(
          snapshot.docs.map(docSnap => ({ id: docSnap.id, ref: docSnap.ref, data: docSnap.data() })),
          source => hydrateReceiptItems(source.ref, source.data),
        );
        return receipts.filter((receipt): receipt is ReceiptDocument => !isMalformedReceipt(receipt));
      },
      onUpdate,
      onError: error => onError(error instanceof Error ? error : new Error('Could not load pending receipts.')),
    });
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, snapshot => {
      onMetadata?.({
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
      sequencer.next(snapshot);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `users/${uid}/receipts`, auth);
      } catch (error) {
        sequencer.fail(error);
      }
    });
    return () => {
      sequencer.deactivate();
      hydrationCache.clear();
      unsubscribe();
    };
  },

  async updateReceipt(uid: string, receiptId: string, data: Partial<ReceiptDocument>, currentVersion?: number): Promise<ReceiptDocument> {
    const auth = getAuth();
    const docRef = doc(db, `users/${uid}/receipts`, receiptId);
    
    try {
      const [storedItems, categories] = await Promise.all([
        getDocs(collection(docRef, 'items')),
        loadUserCategories(uid),
      ]);
      return await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(docRef);
        if (!docSnap.exists()) {
          throw new Error('Receipt no longer exists.');
        }

        const rawCurrent = docSnap.data();
        const usesItemSubcollection = rawCurrent.itemStorageVersion === 2;
        const itemSnapshot = usesItemSubcollection ? storedItems : null;
        const existingItems = itemSnapshot
          ? itemSnapshot.docs.map(item => parseStoredReceiptItem(item.data()))
          : rawCurrent.items;
        const current = ReceiptSchema.safeParse({
          ...normalizeReceiptTimestamps(rawCurrent),
          items: existingItems,
        });
        if (!current.success) {
          throw new Error('Receipt is malformed and cannot be updated safely.');
        }
        if (usesItemSubcollection) {
          validateStoredReceiptForWrite({
            ...normalizeReceiptTimestamps(rawCurrent),
            itemStorageVersion: 2,
            items: [],
          });
        }
        if (currentVersion !== undefined && current.data.revision !== currentVersion) {
          throw new ReceiptRevisionConflictError();
        }

        const updatePayload: Record<string, unknown> = { ...data };
        delete updatePayload.createdAt;
        delete updatePayload.updatedAt;
        delete updatePayload.id;

        const candidate: Record<string, unknown> = {
          ...current.data,
          ...updatePayload,
          id: receiptId,
          createdAt: processTimestamp(rawCurrent.createdAt),
          updatedAt: processTimestamp(rawCurrent.updatedAt),
          revision: current.data.revision + 1,
        };
        candidate.items = canonicalizeReceiptItemCategories(
          (candidate.items as ReceiptDocument['items']) ?? current.data.items,
          categories,
        );
        if (candidate.status === 'confirmed' && candidate.confirmedAt == null) {
          candidate.confirmedAt = new Date().toISOString();
        }

        const validated = validateReceiptForWrite(candidate);
        const confirmationChanged = validated.confirmedAt !== processTimestamp(rawCurrent.confirmedAt);
        const firestoreReceipt: DocumentData = {
          ...validateStoredReceiptForWrite({
            ...validated,
            itemStorageVersion: 2,
            items: [],
          }),
          createdAt: rawCurrent.createdAt,
          updatedAt: serverTimestamp(),
        };
        if (validated.confirmedAt === null) {
          firestoreReceipt.confirmedAt = null;
        } else if (validated.confirmedAt !== undefined) {
          firestoreReceipt.confirmedAt = confirmationChanged || !rawCurrent.confirmedAt
            ? serverTimestamp()
            : rawCurrent.confirmedAt;
        }

        transaction.set(docRef, firestoreReceipt);
        itemSnapshot?.docs.forEach(item => transaction.delete(item.ref));
        validated.items.forEach((item, index) => {
          transaction.set(doc(docRef, 'items', String(index)), parseStoredReceiptItem(item));
        });
        return validated;
      });
    } catch (err) {
      if (err instanceof ReceiptRevisionConflictError) {
        throw err;
      }
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/receipts/${receiptId}`, auth);
    }
  },

  async deleteReceipt(uid: string, receiptId: string): Promise<void> {
    const auth = getAuth();
    const docRef = doc(db, `users/${uid}/receipts`, receiptId);
    try {
      const itemSnapshot = await getDocs(collection(docRef, 'items'));
      const batch = writeBatch(db);
      itemSnapshot.docs.forEach(item => batch.delete(item.ref));
      batch.delete(docRef);
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/receipts/${receiptId}`, auth);
    }
  },

  async getReceipts(uid: string): Promise<ReceiptDocument[]> {
    const auth = getAuth();
    const receiptsRef = collection(db, `users/${uid}/receipts`);
    try {
      const snapshot = await getDocs(receiptsRef);
      const receipts = await Promise.all(snapshot.docs.map(docSnap => hydrateReceiptItems(docSnap.ref, docSnap.data())));
      return receipts.filter((receipt): receipt is ReceiptDocument => !isMalformedReceipt(receipt));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/receipts`, auth);
    }
  },

  async getReceipt(uid: string, receiptId: string): Promise<ReceiptDocument | null> {
    const auth = getAuth();
    const receiptRef = doc(db, `users/${uid}/receipts`, receiptId);
    try {
      const snapshot = await getDoc(receiptRef);
      if (!snapshot.exists()) return null;
      const receipt = await hydrateReceiptItems(receiptRef, snapshot.data());
      return isMalformedReceipt(receipt) ? null : receipt;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${uid}/receipts/${receiptId}`, auth);
    }
  },

  async createReceipt(uid: string, receipt: ReceiptDocument, options: { preserveTimestamps?: boolean } = {}): Promise<void> {
    const auth = getAuth();
    try {
      const categories = await loadUserCategories(uid);
      const validated = validateReceiptForWrite({
        ...receipt,
        items: canonicalizeReceiptItemCategories(receipt.items, categories),
      });
      const docRef = doc(db, `users/${uid}/receipts`, validated.id);
      const firestoreReceipt: DocumentData = {
        ...validateStoredReceiptForWrite({
          ...validated,
          itemStorageVersion: 2,
          items: [],
        }),
        createdAt: options.preserveTimestamps ? Timestamp.fromDate(new Date(validated.createdAt)) : serverTimestamp(),
        updatedAt: options.preserveTimestamps ? Timestamp.fromDate(new Date(validated.updatedAt)) : serverTimestamp(),
        confirmedAt: validated.confirmedAt
          ? (options.preserveTimestamps ? Timestamp.fromDate(new Date(validated.confirmedAt)) : serverTimestamp())
          : null,
      };
      const batch = writeBatch(db);
      batch.set(docRef, firestoreReceipt);
      validated.items.forEach((item, index) => {
        batch.set(doc(docRef, 'items', String(index)), parseStoredReceiptItem(item));
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${uid}/receipts/${receipt.id}`, auth);
    }
  },

  async findByHash(uid: string, sha256: string): Promise<ReceiptDocument[]> {
    const auth = getAuth();
    const receiptsRef = collection(db, `users/${uid}/receipts`);
    const q = query(receiptsRef, where('sourceSha256', '==', sha256));
    try {
      const snapshot = await getDocs(q);
      const receipts = await Promise.all(snapshot.docs.map(docSnap => hydrateReceiptItems(docSnap.ref, docSnap.data())));
      return receipts.filter((receipt): receipt is ReceiptDocument => !isMalformedReceipt(receipt));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/receipts`, auth);
    }
  },

  async findPossibleDuplicates(uid: string, merchant: string, date: string, total: number | null): Promise<ReceiptDocument[]> {
    const auth = getAuth();
    const receiptsRef = collection(db, `users/${uid}/receipts`);
    const q = query(receiptsRef, where('transactionDate', '==', date));
    try {
      const snapshot = await getDocs(q);
      const docs = (await Promise.all(snapshot.docs.map(docSnap => hydrateReceiptItems(docSnap.ref, docSnap.data()))))
        .filter((receipt): receipt is ReceiptDocument => !isMalformedReceipt(receipt));
      return docs.filter(doc => 
        doc.merchantNormalized === merchant && 
        doc.printedGrandTotal === total
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/receipts`, auth);
    }
  }
};

export const categoryRepository = {
  async addCategory(uid: string, name: string, isCustom = true) {
    const auth = getAuth();
    const categoriesRef = collection(db, `users/${uid}/categories`).withConverter(converters.category);
    try {
      const existing = await loadUserCategories(uid);
      if (existing.some(category => normalizeCategoryName(category.name) === normalizeCategoryName(name))) {
        throw new Error('Category already exists');
      }
      
      const id = `cat_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
      const catRef = doc(categoriesRef, id);
      await setDoc(catRef, {
        id,
        name,
        legacyNames: [],
        isCustom,
        createdAt: new Date().toISOString(),
        order: existing.length,
        isActive: true
      });
      return id;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/categories`, auth);
    }
  },

  async renameCategory(uid: string, categoryId: string, name: string): Promise<void> {
    const auth = getAuth();
    try {
      const categories = await loadUserCategories(uid);
      const category = categories.find(candidate => candidate.id === categoryId);
      if (!category) throw new Error('Category no longer exists.');
      if (categories.some(candidate => candidate.id !== categoryId && normalizeCategoryName(candidate.name) === normalizeCategoryName(name))) {
        throw new Error('Category already exists');
      }
      if (normalizeCategoryName(category.name) === normalizeCategoryName(name)) return;

      const legacyNames = Array.from(new Set([...(category.legacyNames ?? []), category.name])).slice(-20);
      await updateDoc(doc(db, `users/${uid}/categories`, categoryId), { name, legacyNames });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/categories/${categoryId}`, auth);
    }
  },

  async getReferenceCounts(uid: string, category: CategoryDocument): Promise<{ receiptItems: number; aliases: number }> {
    const [receipts, aliases] = await Promise.all([
      receiptRepository.getReceipts(uid),
      aliasRepository.getAliases(uid),
    ]);
    const receiptItems = receipts.reduce(
      (count, receipt) => count + receipt.items.filter(item =>
        item.categoryId === category.id || (!item.categoryId && categoryMatchesLegacyName(category, item.category)),
      ).length,
      0,
    );
    return {
      receiptItems,
      aliases: aliases.filter(alias => alias.categoryId === category.id).length,
    };
  },

  async replaceCategory(uid: string, oldCategoryId: string, newCategoryId: string): Promise<void> {
    const auth = getAuth();
    try {
      if (oldCategoryId === newCategoryId) throw new Error('Choose a different replacement category.');
      const categories = await loadUserCategories(uid);
      const oldCategory = categories.find(category => category.id === oldCategoryId);
      const replacement = categories.find(category => category.id === newCategoryId);
      if (!oldCategory) throw new Error('Category no longer exists.');
      if (!replacement || !replacement.isActive) throw new Error('Choose an active replacement category.');

      const receipts = await receiptRepository.getReceipts(uid);
      const failedReceiptIds: string[] = [];
      for (const receipt of receipts) {
        try {
          await replaceCategoryInReceiptWithRetry(receipt, oldCategory, newCategoryId, {
            loadLatest: receiptId => receiptRepository.getReceipt(uid, receiptId),
            save: async (receiptId, update, revision) => {
              await receiptRepository.updateReceipt(uid, receiptId, update, revision);
            },
          });
        } catch {
          failedReceiptIds.push(receipt.id);
        }
      }
      if (failedReceiptIds.length > 0) {
        throw new Error(`Could not safely update ${failedReceiptIds.length} receipt(s). The category was not deleted.`);
      }

      const aliases = await aliasRepository.getAliases(uid);
      await Promise.all(aliases
        .filter(alias => alias.categoryId === oldCategoryId)
        .map(alias => aliasRepository.setAlias(uid, alias.merchantNormalized, newCategoryId)));

      const oldCatRef = doc(db, `users/${uid}/categories`, oldCategoryId);
      await deleteDoc(oldCatRef);
      
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/categories`, auth);
    }
  },

  subscribeToCategories(uid: string, onUpdate: (categories: CategoryDocument[]) => void, onError: (error: Error) => void) {
    const auth = getAuth();
    const categoriesRef = collection(db, `users/${uid}/categories`).withConverter(converters.category);
    const q = query(categoriesRef, orderBy('order', 'asc'));
    
    let active = true;
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (active) onUpdate(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      if (!active) return;
      try {
        handleFirestoreError(error, OperationType.LIST, `users/${uid}/categories`, auth);
      } catch (error) {
        onError(error instanceof Error ? error : new Error('Could not load categories.'));
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  },

  async deleteCategory(uid: string, categoryId: string): Promise<void> {
    const auth = getAuth();
    try {
      const category = (await loadUserCategories(uid)).find(candidate => candidate.id === categoryId);
      if (!category) return;
      const references = await this.getReferenceCounts(uid, category);
      if (references.receiptItems > 0 || references.aliases > 0) {
        throw new Error('Choose a replacement category before deleting a category that is still in use.');
      }
      await deleteDoc(doc(db, `users/${uid}/categories`, categoryId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/categories/${categoryId}`, auth);
    }
  },
  
  async updateCategory(uid: string, categoryId: string, data: Partial<CategoryDocument>): Promise<void> {
    const auth = getAuth();
    const docRef = doc(db, `users/${uid}/categories`, categoryId);
    try {
      await updateDoc(docRef, data);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/categories/${categoryId}`, auth);
    }
  }
};

const createAliasId = (merchantNormalized: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < merchantNormalized.length; index += 1) {
    hash ^= merchantNormalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const safePrefix = merchantNormalized
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'merchant';
  return `alias_${safePrefix}_${(hash >>> 0).toString(36)}`;
};

export const aliasRepository = {
  async getAliases(uid: string): Promise<AliasDocument[]> {
    const auth = getAuth();
    const aliasesRef = collection(db, `users/${uid}/aliases`);
    try {
      const snap = await getDocs(aliasesRef);
      return snap.docs.map(d => AliasSchema.parse({
        ...d.data(),
        createdAt: processTimestamp(d.data().createdAt),
        updatedAt: processTimestamp(d.data().updatedAt),
      }));
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${uid}/aliases`, auth);
      return [];
    }
  },

  subscribeToAliases(uid: string, onUpdate: (aliases: AliasDocument[]) => void, onError: (error: Error) => void) {
    const auth = getAuth();
    const aliasesRef = collection(db, `users/${uid}/aliases`);
    let active = true;
    const unsubscribe = onSnapshot(aliasesRef, snapshot => {
      const aliases = snapshot.docs.flatMap(aliasSnapshot => {
        const parsed = AliasSchema.safeParse({
          ...aliasSnapshot.data(),
          createdAt: processTimestamp(aliasSnapshot.data().createdAt),
          updatedAt: processTimestamp(aliasSnapshot.data().updatedAt),
        });
        return parsed.success ? [parsed.data] : [];
      });
      if (active) onUpdate(aliases.sort((left, right) => left.merchantNormalized.localeCompare(right.merchantNormalized)));
    }, error => {
      if (!active) return;
      try {
        handleFirestoreError(error, OperationType.LIST, `users/${uid}/aliases`, auth);
      } catch (handled) {
        onError(handled as Error);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  },

  async getAliasForMerchant(uid: string, merchantName: string): Promise<AliasDocument | null> {
    const merchantNormalized = normalizeMerchantName(merchantName);
    if (!merchantNormalized) return null;
    const aliases = await this.getAliases(uid);
    return aliases.find(alias => normalizeMerchantName(alias.merchantNormalized) === merchantNormalized) ?? null;
  },

  async setAlias(uid: string, merchantName: string, categoryId: string): Promise<void> {
    const auth = getAuth();
    const merchantNormalized = normalizeMerchantName(merchantName);
    if (!merchantNormalized) throw new Error('Enter a merchant name.');
    const category = (await loadUserCategories(uid)).find(candidate => candidate.id === categoryId);
    if (!category || !category.isActive) throw new Error('Choose an active category.');
    const id = createAliasId(merchantNormalized);
    const docRef = doc(db, `users/${uid}/aliases`, id);
    try {
      const existing = await getDoc(docRef);
      const now = new Date().toISOString();
      await setDoc(docRef, {
        id,
        merchantNormalized,
        categoryId,
        createdAt: existing.exists() ? processTimestamp(existing.data().createdAt) : now,
        updatedAt: now,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/aliases/${id}`, auth);
    }
  },

  async deleteAlias(uid: string, aliasId: string): Promise<void> {
    const auth = getAuth();
    try {
      await deleteDoc(doc(db, `users/${uid}/aliases`, aliasId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/aliases/${aliasId}`, auth);
    }
  },
};

export const settingsRepository = {
  async getSettings(uid: string): Promise<AppSettingsDocument | null> {
    const auth = getAuth();
    const docRef = doc(db, `users/${uid}/settings/default`).withConverter(converters.settings);
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) return snap.data();
      return null;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${uid}/settings/default`, auth);
      return null;
    }
  },
  async updateSettings(uid: string, settings: Partial<AppSettingsDocument>) {
    const auth = getAuth();
    const docRef = doc(db, `users/${uid}/settings/default`);
    try {
      await setDoc(docRef, settings, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/settings/default`, auth);
    }
  },
  subscribeToSettings(uid: string, onUpdate: (settings: AppSettingsDocument) => void, onError: (error: Error) => void) {
    const auth = getAuth();
    const docRef = doc(db, `users/${uid}/settings/default`).withConverter(converters.settings);
    let active = true;
    const unsubscribe = onSnapshot(docRef, snapshot => {
      if (active) onUpdate(snapshot.exists() ? snapshot.data() : AppSettingsSchema.parse({}));
    }, error => {
      if (!active) return;
      try {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/settings/default`, auth);
      } catch (handled) {
        onError(handled as Error);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }
};

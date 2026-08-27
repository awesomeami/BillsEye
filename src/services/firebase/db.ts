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
  FirestoreDataConverter,
  serverTimestamp,
  runTransaction,
  writeBatch
} from 'firebase/firestore';
import { db } from './config';
import { getAuth } from 'firebase/auth';
import { handleFirestoreError, OperationType } from './errors';
import { 
  UserProfileDocument, 
  UserProfileSchema,
  ReceiptDocument,
  ReceiptSchema,
  CategoryDocument,
  CategorySchema,
  AppSettingsDocument,
  AppSettingsSchema
} from '../../domain/schema';

// Helper to create typed converters with Zod validation
// Explicit converters with safeParse for reads
export const converters = {
  user: {
    toFirestore: (data: any): DocumentData => {
      return data;
    },
    fromFirestore: (snapshot: QueryDocumentSnapshot, options: SnapshotOptions): UserProfileDocument => {
      const data = snapshot.data(options);
      const processTimestamp = (val: any) => val && val.toDate ? val.toDate().toISOString() : val;
      data.createdAt = processTimestamp(data.createdAt);
      data.lastLoginAt = processTimestamp(data.lastLoginAt);
      const parsed = UserProfileSchema.safeParse(data);
      if (!parsed.success) {
        console.error("Malformed UserProfile:", snapshot.id, parsed.error);
        throw new Error("Malformed UserProfile");
      }
      return parsed.data;
    }
  },
  receipt: {
    toFirestore: (data: any): DocumentData => {
      return data;
    },
    fromFirestore: (snapshot: QueryDocumentSnapshot, options: SnapshotOptions): any => {
      const data = snapshot.data(options);
      const processTimestamp = (val: any) => val && val.toDate ? val.toDate().toISOString() : val;
      data.createdAt = processTimestamp(data.createdAt);
      data.updatedAt = processTimestamp(data.updatedAt);
      data.confirmedAt = processTimestamp(data.confirmedAt);
      
      const parsed = ReceiptSchema.safeParse(data);
      if (!parsed.success) {
        console.error("Malformed Receipt:", snapshot.id, parsed.error);
        return { _malformed: true, id: snapshot.id, error: parsed.error };
      }
      return parsed.data;
    }
  },
  category: {
    toFirestore: (data: any): DocumentData => data,
    fromFirestore: (snapshot: QueryDocumentSnapshot, options: SnapshotOptions): any => {
      const data = snapshot.data(options);
      const processTimestamp = (val: any) => val && val.toDate ? val.toDate().toISOString() : val;
      data.createdAt = processTimestamp(data.createdAt);
      const parsed = CategorySchema.safeParse(data);
      if (!parsed.success) {
        console.error("Malformed Category:", snapshot.id, parsed.error);
        return { _malformed: true, id: snapshot.id, error: parsed.error };
      }
      return parsed.data;
    }
  },
  settings: {
    toFirestore: (data: any): DocumentData => data,
    fromFirestore: (snapshot: QueryDocumentSnapshot, options: SnapshotOptions): any => {
      const data = snapshot.data(options);
      const parsed = AppSettingsSchema.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      return parsed.data;
    }
  }
};


const DEFAULT_CATEGORIES = [
  'Groceries',
  'Meat',
  'Fruit & Vegetables',
  'Household',
  'Medicine',
  'Eating Out',
  'Miscellaneous'
];

export const userRepository = {
  async getOrCreateProfile(uid: string, email: string, displayName?: string | null): Promise<UserProfileDocument> {
    const userRef = doc(db, 'users', uid).withConverter(converters.user);
    const auth = getAuth();
    let userSnap;
    try {
      userSnap = await getDoc(userRef);
    } catch (err: any) {
      if (err.message && err.message.includes('offline')) {
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
      handleFirestoreError(err, OperationType.GET, `users/${uid}`, auth);
    }

    if (userSnap.exists()) {
      const current = userSnap.data();
      setDoc(userRef, { lastLoginAt: serverTimestamp() }, { merge: true }).catch(console.warn);
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
      await setDoc(userRef, newProfile as any);
      this.seedDefaultCategories(uid).catch(console.warn);
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
  subscribeToReceipts(uid: string, onUpdate: (receipts: ReceiptDocument[]) => void, onError: (error: Error) => void) {
    const auth = getAuth();
    const receiptsRef = collection(db, `users/${uid}/receipts`).withConverter(converters.receipt);
    // Realtime sync all confirmed receipts for fast local search/filter
    // We order by transactionDate descending
    const q = query(receiptsRef, where('status', '==', 'confirmed'), orderBy('transactionDate', 'desc'));
    
    return onSnapshot(q, (snapshot) => {
      onUpdate(snapshot.docs.map(doc => doc.data()).filter(d => !d._malformed));
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `users/${uid}/receipts`, auth);
      } catch (e: any) {
        onError(e);
      }
    });
  },

  subscribeToPendingReceipts(uid: string, onUpdate: (receipts: ReceiptDocument[]) => void, onError: (error: Error) => void) {
    const auth = getAuth();
    const receiptsRef = collection(db, `users/${uid}/receipts`).withConverter(converters.receipt);
    const q = query(receiptsRef, where('status', '==', 'pendingReview'), orderBy('createdAt', 'desc'));
    
    return onSnapshot(q, (snapshot) => {
      onUpdate(snapshot.docs.map(doc => doc.data()).filter(d => !d._malformed));
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `users/${uid}/receipts`, auth);
      } catch (e: any) {
        onError(e);
      }
    });
  },

  async updateReceipt(uid: string, receiptId: string, data: Partial<ReceiptDocument>, currentVersion?: number): Promise<void> {
    const auth = getAuth();
    const docRef = doc(db, `users/${uid}/receipts`, receiptId).withConverter(converters.receipt);
    
    const updatePayload: any = { ...data };
    delete updatePayload.createdAt;
    delete updatePayload.id;
    if (typeof updatePayload.confirmedAt === 'string') {
      delete updatePayload.confirmedAt;
    }
    updatePayload.updatedAt = serverTimestamp();

    try {
      if (currentVersion !== undefined) {
        // Enforce version conflict protection using a transaction
        await runTransaction(db, async (transaction) => {
          const docSnap = await transaction.get(docRef);
          if (!docSnap.exists()) {
            throw new Error('Receipt no longer exists.');
          }
          const currentData = docSnap.data();
          if ((currentData.revision || 1) !== currentVersion) {
            throw new Error('Conflict: Receipt was updated by another device. Please refresh and try again.');
          }
          transaction.update(docRef, { 
            ...updatePayload, 
            revision: currentVersion + 1,
            updatedAt: serverTimestamp()
          });
        });
      } else {
        await updateDoc(docRef, updatePayload);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/receipts/${receiptId}`, auth);
    }
  },

  async deleteReceipt(uid: string, receiptId: string): Promise<void> {
    const auth = getAuth();
    const docRef = doc(db, `users/${uid}/receipts`, receiptId);
    try {
      await deleteDoc(docRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/receipts/${receiptId}`, auth);
    }
  },

  async getReceipts(uid: string): Promise<ReceiptDocument[]> {
    const auth = getAuth();
    const receiptsRef = collection(db, `users/${uid}/receipts`).withConverter(converters.receipt);
    try {
      const snapshot = await getDocs(receiptsRef);
      return snapshot.docs.map(doc => doc.data()).filter(d => !d._malformed);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/receipts`, auth);
    }
  },

  async createReceipt(uid: string, receipt: any): Promise<void> {
    const auth = getAuth();
    const docRef = doc(db, `users/${uid}/receipts`, receipt.id).withConverter(converters.receipt);
    try {
      await setDoc(docRef, receipt);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${uid}/receipts/${receipt.id}`, auth);
    }
  },

  async findByHash(uid: string, sha256: string): Promise<ReceiptDocument[]> {
    const auth = getAuth();
    const receiptsRef = collection(db, `users/${uid}/receipts`).withConverter(converters.receipt);
    const q = query(receiptsRef, where('sourceSha256', '==', sha256));
    try {
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => doc.data());
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/receipts`, auth);
    }
  },

  async findPossibleDuplicates(uid: string, merchant: string, date: string, total: number | null): Promise<ReceiptDocument[]> {
    const auth = getAuth();
    const receiptsRef = collection(db, `users/${uid}/receipts`).withConverter(converters.receipt);
    const q = query(receiptsRef, where('transactionDate', '==', date));
    try {
      const snapshot = await getDocs(q);
      const docs = snapshot.docs.map(doc => doc.data());
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
    // prevent duplicate normalized names
    const q = query(categoriesRef, where('isActive', '==', true));
    try {
      const snap = await getDocs(q);
      const existing = snap.docs.map(d => d.data());
      if (existing.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        throw new Error('Category already exists');
      }
      
      const id = `cat_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
      const catRef = doc(categoriesRef, id);
      await setDoc(catRef, {
        id,
        name,
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
  
  async replaceCategory(uid: string, oldCategoryId: string, newCategoryId: string) {
    const auth = getAuth();
    try {
      // Find all receipts with the old category
      const receiptsRef = collection(db, `users/${uid}/receipts`).withConverter(converters.receipt);
      const snap = await getDocs(receiptsRef);
      const docs = snap.docs;
      
      let currentBatch = writeBatch(db);
      const batches: Promise<void>[] = [];
      let mutationCount = 0;
      const MAX_BATCH_SIZE = 500;
      
      
      docs.forEach(docSnap => {
        const data = docSnap.data();
        let changed = false;
        const newItems = data.items.map((item: any) => {
          if (item.category === oldCategoryId) {
            changed = true;
            return { ...item, category: newCategoryId, userEdited: true };
          }
          return item;
        });
        
        if (changed) {
          currentBatch.update(docSnap.ref, { 
            items: newItems, 
            updatedAt: serverTimestamp(),
            revision: (data.revision || 1) + 1
          });
          
          mutationCount++;
          if (mutationCount >= MAX_BATCH_SIZE) {
            batches.push(currentBatch.commit());
            currentBatch = writeBatch(db);
            mutationCount = 0;
          }
        }
      });
      
      if (mutationCount > 0) {
        batches.push(currentBatch.commit());
      }
      
      await Promise.all(batches);
      
      // Delete old category
      const oldCatRef = doc(db, `users/${uid}/categories`, oldCategoryId);
      await deleteDoc(oldCatRef);
      
    } catch(err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/categories`, auth);
    }
  },

  subscribeToCategories(uid: string, onUpdate: (categories: CategoryDocument[]) => void, onError: (error: Error) => void) {
    const auth = getAuth();
    const categoriesRef = collection(db, `users/${uid}/categories`).withConverter(converters.category);
    const q = query(categoriesRef, orderBy('order', 'asc'));
    
    return onSnapshot(q, (snapshot) => {
      onUpdate(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `users/${uid}/categories`, auth);
      } catch (e: any) {
        onError(e);
      }
    });
  },

  async deleteCategory(uid: string, categoryId: string): Promise<void> {
    const auth = getAuth();
    const docRef = doc(db, `users/${uid}/categories`, categoryId);
    try {
      await deleteDoc(docRef);
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


export interface AliasDocument {
  id: string;
  merchantNormalized: string;
  categoryId: string;
  createdAt: string;
  updatedAt: string;
}

export const aliasRepository = {
  async getAliases(uid: string): Promise<AliasDocument[]> {
    const auth = getAuth();
    const aliasesRef = collection(db, `users/${uid}/aliases`);
    try {
      const snap = await getDocs(aliasesRef);
      return snap.docs.map(d => d.data() as AliasDocument);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${uid}/aliases`, auth);
      return [];
    }
  },
  async setAlias(uid: string, merchantNormalized: string, categoryId: string) {
    const auth = getAuth();
    const id = `alias_${merchantNormalized.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const docRef = doc(db, `users/${uid}/aliases`, id);
    try {
      await setDoc(docRef, {
        id,
        merchantNormalized,
        categoryId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/aliases/${id}`, auth);
    }
  }
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
  }
};

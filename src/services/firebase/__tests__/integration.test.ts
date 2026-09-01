import { describe, test, afterEach, before, after } from 'node:test';
import assert from 'node:assert';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as fs from 'fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build, stop } from 'esbuild';
import { initializeApp, deleteApp } from 'firebase/app';
import { ReceiptSchema, ReceiptDocument } from '../../../domain/schema';
import { getValidatedClientFirebaseConfig } from '../clientConfig';

const firebaseConfig = getValidatedClientFirebaseConfig({}, { mode: 'test' });
let testEnv: RulesTestEnvironment;

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is required. Tests must run against the Firebase Emulator.');
  }
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  
  testEnv = await initializeTestEnvironment({
    projectId: firebaseConfig.projectId,
    firestore: { rules },
  });
});

afterEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe('Firestore Named Database Integration & Multi-User Isolation', () => {

  test('production receipt subscriptions receive cache transitions and write acknowledgements without data changes', async () => {
    const uid = 'receipt-sync-user';
    const testDb = testEnv.authenticatedContext(uid).firestore();
    const authApp = initializeApp({ projectId: firebaseConfig.projectId, apiKey: 'emulator-only' });
    // Bundle the real repository, replacing only its Vite-specific database
    // bootstrap with this isolated emulator connection. Firebase itself is real.
    const temporaryDirectory = fs.mkdtempSync(path.join(process.cwd(), 'node_modules', '.receipt-sync-test-'));
    const modulePath = path.join(temporaryDirectory, 'repository.mjs');
    const testGlobal = globalThis as typeof globalThis & { __RECEIPT_SYNC_TEST_DB__?: unknown };
    testGlobal.__RECEIPT_SYNC_TEST_DB__ = testDb;
    const unsubscribers: (() => void)[] = [];
    type Metadata = { fromCache: boolean; hasPendingWrites: boolean };
    const metadata: Partial<Record<'confirmed' | 'pending', Metadata>> = {};
    const received: Partial<Record<'confirmed' | 'pending', ReceiptDocument[]>> = {};
    const errors: Error[] = [];
    const waitUntil = async (condition: () => boolean, message: string) => {
      const deadline = Date.now() + 8000;
      while (!condition() && errors.length === 0 && Date.now() < deadline) await delay(20);
      assert.deepStrictEqual(errors, []);
      assert.ok(condition(), message);
    };

    try {
      await build({
        entryPoints: ['src/services/firebase/db.ts'],
        outfile: modulePath,
        bundle: true,
        platform: 'node',
        format: 'esm',
        packages: 'external',
        plugins: [{
          name: 'emulator-database',
          setup(builder) {
            builder.onResolve({ filter: /^\.\/config$/ }, () => ({ path: 'emulator-db', namespace: 'receipt-sync-test' }));
            builder.onLoad({ filter: /.*/, namespace: 'receipt-sync-test' }, () => ({ contents: 'export const db = globalThis.__RECEIPT_SYNC_TEST_DB__;' }));
          },
        }],
      });
      const { receiptRepository } = await import(pathToFileURL(modulePath).href) as typeof import('../db');
      await testDb.disableNetwork();
      unsubscribers.push(receiptRepository.subscribeToReceipts(uid, data => { received.confirmed = data; }, error => errors.push(error), value => { metadata.confirmed = value; }));
      unsubscribers.push(receiptRepository.subscribeToPendingReceipts(uid, data => { received.pending = data; }, error => errors.push(error), value => { metadata.pending = value; }));
      await waitUntil(() => metadata.confirmed?.fromCache === true && metadata.pending?.fromCache === true, 'Both empty queries should report cached snapshots while offline');

      await testDb.enableNetwork();
      await waitUntil(() => metadata.confirmed?.fromCache === false && metadata.pending?.fromCache === false, 'Both empty queries must receive metadata-only server confirmation');
      assert.deepStrictEqual(received.confirmed, []);
      assert.deepStrictEqual(received.pending, []);

      await receiptRepository.createReceipt(uid, ReceiptSchema.parse({
        id: 'receipt-sync',
        status: 'confirmed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        transactionDate: '2022-01-30',
        printedGrandTotal: 50900,
      }));
      await waitUntil(() => received.confirmed?.length === 1 && metadata.confirmed?.hasPendingWrites === false, 'The created receipt should be acknowledged and hydrated');

      // Updating only literal values makes the acknowledgement metadata-only.
      await testDb.doc(`users/${uid}/receipts/receipt-sync`).update({ merchantRaw: 'Updated merchant', revision: 2 });
      await waitUntil(() => received.confirmed?.[0]?.merchantRaw === 'Updated merchant' && metadata.confirmed?.hasPendingWrites === false, 'Acknowledgement must clear pending writes even when receipt fields do not change at the server');
      assert.strictEqual(metadata.pending?.hasPendingWrites, false);
    } finally {
      unsubscribers.forEach(unsubscribe => unsubscribe());
      await testDb.terminate();
      delete testGlobal.__RECEIPT_SYNC_TEST_DB__;
      await deleteApp(authApp);
      stop();
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
  
  test('Two-user isolation: Alice cannot read or write Bob data', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const bobDb = testEnv.authenticatedContext('bob').firestore();
    
    // Alice creates a category
    const aliceCatRef = aliceDb.collection('users').doc('alice').collection('categories').doc('cat1');
    await assertSucceeds(aliceCatRef.set({
      id: 'cat1',
      name: 'Groceries',
      isCustom: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      order: 1,
      isActive: true
    }));
    
    // Bob tries to read it
    const bobReadAliceCat = bobDb.collection('users').doc('alice').collection('categories').doc('cat1');
    await assertFails(bobReadAliceCat.get());
    
    // Bob tries to write into Alice's path
    const bobWriteAliceCat = bobDb.collection('users').doc('alice').collection('categories').doc('cat2');
    await assertFails(bobWriteAliceCat.set({
      id: 'cat2',
      name: 'Hacked',
      isCustom: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      order: 2,
      isActive: true
    }));
  });

  test('Same-user two-client test: document written by client A appears to client B', async () => {
    // Client A and Client B authenticated as Alice
    const aliceDbA = testEnv.authenticatedContext('alice').firestore();
    const aliceDbB = testEnv.authenticatedContext('alice').firestore();

    // Client A writes a category
    const catRefA = aliceDbA.collection('users').doc('alice').collection('categories').doc('sync1');
    await assertSucceeds(catRefA.set({
      id: 'sync1',
      name: 'Utilities',
      isCustom: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      order: 10,
      isActive: true
    }));

    // Client B reads the document
    const catRefB = aliceDbB.collection('users').doc('alice').collection('categories').doc('sync1');
    const snapshotB = await catRefB.get();
    assert.strictEqual(snapshotB.exists, true);
    assert.strictEqual(snapshotB.data()?.name, 'Utilities');
  });

  test('Image base64 payloads and binary fields are rejected', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    
    const catRef = aliceDb.collection('users').doc('alice').collection('categories').doc('img-test');
    await assertFails(catRef.set({
      id: 'img-test',
      name: 'Test',
      isCustom: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      order: 1,
      isActive: true,
      imageBase64: 'data:image/jpeg;base64,invalid'
    }));
  });
});

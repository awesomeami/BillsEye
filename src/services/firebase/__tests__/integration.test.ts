import { describe, test, afterEach, before, after } from 'node:test';
import assert from 'node:assert';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as fs from 'fs';
import { getValidatedFirebaseConfig } from '../coreConfig';

const firebaseConfig = getValidatedFirebaseConfig();
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

import { describe, test, afterEach, before, after } from 'node:test';
import assert from 'node:assert';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { serverTimestamp } from 'firebase/firestore';
import * as fs from 'fs';

let testEnv: RulesTestEnvironment;

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Tests must run against the Firebase Emulator.');
  }

  const rules = fs.readFileSync('firestore.rules', 'utf8');
  
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-kharchalens-' + Date.now(),
    firestore: {
      rules,
    },
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

describe('Firestore Security Rules', () => {
  
  test('unauthenticated users cannot read or write', async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    const docRef = unauthedDb.collection('users').doc('user1').collection('receipts').doc('receipt1');
    
    await assertFails(docRef.get());
    await assertFails(docRef.set({ amount: 100 }));
  });

  test('authenticated users can create and read their own user profile', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const bobDb = testEnv.authenticatedContext('bob').firestore();
    
    const aliceProfile = aliceDb.collection('users').doc('alice');
    await assertSucceeds(aliceProfile.set({
      email: 'alice@example.com',
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      schemaVersion: 1
    }));
    
    const aliceProfileRead = await aliceProfile.get();
    assert.strictEqual(aliceProfileRead.exists, true);
    
    // Bob cannot read Alice's profile
    const aliceDocForBob = bobDb.collection('users').doc('alice');
    await assertFails(aliceDocForBob.get());
  });

  test('users cannot write image/binary fields anywhere', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    
    // Attempt shadow write with image in category
    const catRef = aliceDb.collection('users').doc('alice').collection('categories').doc('cat1');
    await assertFails(catRef.set({
      id: 'cat1',
      name: 'Groceries',
      isCustom: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      order: 1,
      isActive: true,
      imageBase64: 'data:image/jpeg;base64,12345'
    }));

    // Attempt setting receipt with image field
    const receiptRef = aliceDb.collection('users').doc('alice').collection('receipts').doc('r1');
    await assertFails(receiptRef.set({
      id: 'r1',
      schemaVersion: 2,
      revision: 1,
      status: 'pendingReview',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      image: 'some-image-url'
    }));
  });

  test('rejects receipt with malformed or disallowed fields in items at index 1', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const receiptRef = aliceDb.collection('users').doc('alice').collection('receipts').doc('r1');
    
    // Attempt write with forbidden 'image' field on item at index 1
    await assertFails(receiptRef.set({
      id: 'r1',
      schemaVersion: 2,
      revision: 1,
      status: 'pendingReview',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      items: [
        { id: 'item-0', name: 'Valid Item 0', lineTotal: 100 },
        { id: 'item-1', name: 'Invalid Item 1', lineTotal: 200, image: 'data:image/png;base64,hidden' }
      ]
    }));

    // Valid items at index 0 and 1 succeed
    await assertSucceeds(receiptRef.set({
      id: 'r1',
      schemaVersion: 2,
      revision: 1,
      status: 'pendingReview',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      items: [
        { id: 'item-0', name: 'Valid Item 0', lineTotal: 100 },
        { id: 'item-1', name: 'Valid Item 1', lineTotal: 200 }
      ]
    }));
  });

  test('categories and settings enforce authorization and validation', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const bobDb = testEnv.authenticatedContext('bob').firestore();
    
    const catRef = aliceDb.collection('users').doc('alice').collection('categories').doc('cat1');
    await assertSucceeds(catRef.set({
      id: 'cat1',
      name: 'Groceries',
      isCustom: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      order: 1,
      isActive: true
    }));

    // Bob cannot read or modify Alice's category
    const bobCatRef = bobDb.collection('users').doc('alice').collection('categories').doc('cat1');
    await assertFails(bobCatRef.get());
    await assertFails(bobCatRef.set({ id: 'cat1', name: 'Hacked' }));

    // Settings
    const settingsRef = aliceDb.collection('users').doc('alice').collection('settings').doc('preferences');
    await assertSucceeds(settingsRef.set({
      currency: 'PKR',
      locale: 'en-PK',
      timeZone: 'Asia/Karachi',
      theme: 'light',
      lowConfidenceThreshold: 0.7,
      discrepancyTolerance: 100
    }));

    // Invalid theme rejected
    await assertFails(settingsRef.set({
      currency: 'PKR',
      theme: 'neon-glow'
    }));
  });

  test('receipts enforce revision increment and timestamp validation', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const receiptRef = aliceDb.collection('users').doc('alice').collection('receipts').doc('r1');
    
    await assertSucceeds(receiptRef.set({
      id: 'r1',
      schemaVersion: 2,
      revision: 1,
      status: 'pendingReview',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      merchantRaw: 'Al-Fatah',
      items: []
    }));

    // Updating without revision increment should fail
    await assertFails(receiptRef.update({
      status: 'confirmed',
      updatedAt: serverTimestamp()
    }));

    // Updating with valid revision and timestamp succeeds
    await assertSucceeds(receiptRef.update({
      revision: 2,
      updatedAt: serverTimestamp(),
      status: 'confirmed'
    }));
  });
});

import { describe, test, afterEach, before, after } from 'node:test';
import assert from 'node:assert';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { serverTimestamp } from '@firebase/firestore';
import * as fs from 'fs';

let testEnv: RulesTestEnvironment;

const makeReceiptHeader = (id: string) => ({
  id,
  schemaVersion: 2,
  revision: 1,
  status: 'pendingReview',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  itemStorageVersion: 2,
  items: [],
});

const makeCompleteReceiptHeader = (id: string) => ({
  ...makeReceiptHeader(id),
  confirmedAt: null,
  sourceFileName: 'receipt.png',
  sourceMimeType: 'image/png',
  sourceSha256: 'a'.repeat(64),
  sourcePageNumber: 1,
  merchantRaw: 'Example Market',
  merchantNormalized: 'Example Market',
  branchAddress: 'Example Street',
  receiptNumber: 'R-123',
  transactionDate: '2026-08-28',
  transactionTime: '12:00',
  dateAmbiguous: false,
  currency: 'PKR',
  paymentMethod: 'cash',
  printedSubtotal: 1000,
  printedDiscount: 0,
  printedTax: 0,
  printedFees: 0,
  printedRounding: 0,
  printedGrandTotal: 1000,
  computedLineTotal: 1000,
  computedExpectedTotal: 1000,
  discrepancy: 0,
  reconciliationStatus: 'matched',
  rawOcrText: 'Example Market',
  overallConfidence: 0.9,
  warnings: ['One low-confidence field'],
  ambiguousFields: ['transactionDate'],
  extractionModel: 'gemini-3-flash-preview',
  extractionModelActual: 'gemini-3-flash-preview',
  extractionSchemaVersion: '2',
  extractionDurationMs: 1250,
  userNote: 'Reviewed',
  wasEditedByUser: false,
});

const makeReceiptItem = (id: string, index: number) => ({
  id,
  rawLineText: `Item ${index}`,
  name: null,
  brand: null,
  quantity: null,
  unit: null,
  unitPrice: null,
  discount: null,
  lineTotal: index * 100,
  category: null,
  confidence: 0.9,
  userEdited: false,
  warnings: [],
});

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

    await assertFails(aliceProfile.set({
      email: 'alice@example.com',
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      schemaVersion: 1,
      offlineCapture: { imagePayload: 'not allowed' },
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

    // Attempt nesting arbitrary binary-like data in an otherwise valid receipt.
    const receiptRef = aliceDb.collection('users').doc('alice').collection('receipts').doc('r1');
    await assertFails(receiptRef.set({
      ...makeReceiptHeader('r1'),
      arbitraryAttachment: { imagePayload: 'some-image-url' },
    }));
  });

  test('rejects receipt with malformed or disallowed fields in items at index 1', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const receiptRef = aliceDb.collection('users').doc('alice').collection('receipts').doc('r1');
    await assertSucceeds(receiptRef.set(makeReceiptHeader('r1')));
    
    // Attempt write with forbidden 'image' field in item slot 1.
    await assertFails(receiptRef.collection('items').doc('1').set({
      ...makeReceiptItem('item-1', 1),
      image: 'data:image/png;base64,hidden',
    }));
    await assertFails(receiptRef.collection('items').doc('2').set({
      ...makeReceiptItem('item-2', 2),
      lineTotal: '200',
    }));
    await assertFails(receiptRef.collection('items').doc('3').set({
      ...makeReceiptItem('item-3', 3),
      warnings: [{ unexpected: 'nested map' }],
    }));

    // Valid items in slots 0 and 1 succeed.
    await assertSucceeds(receiptRef.collection('items').doc('0').set(makeReceiptItem('item-0', 0)));
    await assertSucceeds(receiptRef.collection('items').doc('1').set(makeReceiptItem('item-1', 1)));
    await assertSucceeds(receiptRef.collection('items').doc('4').set({
      ...makeReceiptItem('item-4', 4),
      categoryId: 'cat_groceries',
      category: null,
    }));
    await assertFails(receiptRef.collection('items').doc('5').set({
      ...makeReceiptItem('item-5', 5),
      categoryId: 'not/a-valid-id',
    }));
  });

  test('accepts the 40-item boundary and rejects an item beyond slot 39', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const receiptRef = aliceDb.collection('users').doc('alice').collection('receipts').doc('boundary-40');
    await assertSucceeds(receiptRef.set(makeReceiptHeader('boundary-40')));

    await assertSucceeds(Promise.all(
      Array.from({ length: 40 }, (_, index) => receiptRef.collection('items').doc(String(index)).set(makeReceiptItem(`item-${index}`, index)))
    ));
    await assertFails(receiptRef.collection('items').doc('40').set(makeReceiptItem('item-40', 40)));
  });

  test('rejects orphan item documents while allowing an atomic receipt and item creation', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const orphan = aliceDb.collection('users').doc('alice').collection('receipts').doc('missing').collection('items').doc('0');
    await assertFails(orphan.set(makeReceiptItem('orphan-item', 0)));

    const receiptRef = aliceDb.collection('users').doc('alice').collection('receipts').doc('atomic-receipt');
    const batch = aliceDb.batch();
    batch.set(receiptRef, makeReceiptHeader('atomic-receipt'));
    batch.set(receiptRef.collection('items').doc('0'), makeReceiptItem('atomic-item', 0));
    await assertSucceeds(batch.commit());
  });

  test('receipt header allows canonical extraction metadata but rejects unapproved fields', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const receiptRef = aliceDb.collection('users').doc('alice').collection('receipts').doc('canonical-header');
    await assertSucceeds(receiptRef.set({
      ...makeReceiptHeader('canonical-header'),
      merchantRaw: null,
      merchantNormalized: null,
      warnings: ['Merchant is unreadable'],
      ambiguousFields: ['merchantRaw'],
      extractionModel: 'gemini-3-flash-preview',
      extractionModelActual: 'gemini-3-flash-preview',
      extractionSchemaVersion: '2',
      extractionDurationMs: 1250,
    }));

    await assertFails(receiptRef.set({
      ...makeReceiptHeader('canonical-header'),
      metadata: { arbitraryImageField: 'data:image/png;base64,not-allowed' },
    }));
  });

  test('accepts a complete current receipt header within the Rules expression limit', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const receiptRef = aliceDb.collection('users').doc('alice').collection('receipts').doc('complete-header');
    await assertSucceeds(receiptRef.set(makeCompleteReceiptHeader('complete-header')));
  });

  test('allows negative refund and adjustment amounts without weakening ownership checks', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const receiptRef = aliceDb.collection('users').doc('alice').collection('receipts').doc('refund-header');
    await assertSucceeds(receiptRef.set({
      ...makeCompleteReceiptHeader('refund-header'),
      printedSubtotal: -1000,
      printedDiscount: -100,
      printedTax: -50,
      printedFees: -20,
      printedGrandTotal: -1170,
      computedLineTotal: -1000,
      computedExpectedTotal: -1170,
    }));
    await assertSucceeds(receiptRef.collection('items').doc('0').set({
      ...makeReceiptItem('refund-item', 0),
      unitPrice: -1000,
      discount: -100,
      lineTotal: -900,
    }));
  });

  test('categories and settings enforce authorization and validation', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const bobDb = testEnv.authenticatedContext('bob').firestore();
    
    const catRef = aliceDb.collection('users').doc('alice').collection('categories').doc('cat1');
    await assertSucceeds(catRef.set({
      id: 'cat1',
      name: 'Groceries',
      legacyNames: ['Food'],
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
    const settingsRef = aliceDb.collection('users').doc('alice').collection('settings').doc('default');
    await assertSucceeds(settingsRef.set({
      currency: 'PKR',
      locale: 'en-PK',
      timeZone: 'Asia/Karachi',
      theme: 'light',
      lowConfidenceThreshold: 0.7,
      discrepancyTolerance: 100
    }));

    // Settings use an exact document shape and a single canonical document ID.
    await assertFails(settingsRef.set({
      currency: 'PKR',
      locale: 'en-PK',
      timeZone: 'Asia/Karachi',
      theme: 'light',
      lowConfidenceThreshold: 0.7,
      discrepancyTolerance: 100,
      unexpectedPayload: { image: 'not allowed' },
    }));

    await assertFails(aliceDb.collection('users').doc('alice').collection('settings').doc('preferences').set({
      currency: 'PKR',
    }));

    // Invalid theme rejected
    await assertFails(settingsRef.set({
      currency: 'PKR',
      theme: 'neon-glow'
    }));
  });

  test('aliases and the temporary sync diagnostic use strict approved shapes', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const aliasRef = aliceDb.collection('users').doc('alice').collection('aliases').doc('alias_merchant');
    await assertSucceeds(aliasRef.set({
      id: 'alias_merchant',
      merchantNormalized: 'Example Market',
      categoryId: 'groceries',
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
    }));
    await assertFails(aliasRef.set({
      id: 'alias_merchant',
      merchantNormalized: 'Example Market',
      categoryId: 'groceries',
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
      thumbnail: 'not allowed',
    }));

    const diagnosticRef = aliceDb.collection('users').doc('alice').collection('settings').doc('sync-test');
    await assertSucceeds(diagnosticRef.set({ lastTest: serverTimestamp(), device: 'test-client' }));
    await assertSucceeds(diagnosticRef.delete());
    await assertFails(diagnosticRef.set({
      lastTest: serverTimestamp(),
      device: 'test-client',
      nestedBlob: { value: 'not allowed' },
    }));
  });

  test('receipts enforce revision increment and timestamp validation', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const receiptRef = aliceDb.collection('users').doc('alice').collection('receipts').doc('r1');
    
    await assertSucceeds(receiptRef.set({
      ...makeReceiptHeader('r1'),
      merchantRaw: 'Al-Fatah',
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

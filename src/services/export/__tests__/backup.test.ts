import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateJSONBackup,
  normalizeBackupContents,
  receiptRestorePatch,
  summarizeRestoreRecords,
  validateBackup,
} from '../backup';
import {
  AliasDocument,
  AppSettingsDocument,
  CategoryDocument,
  ReceiptDocument,
  UserProfileDocument,
} from '../../../domain/schema';

describe('Backup Service', () => {
  const mockReceipt: ReceiptDocument = {
    id: 'r1',
    status: 'confirmed',
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
    schemaVersion: 1,
    revision: 1,
    currency: 'PKR',
    printedGrandTotal: 1000,
    reconciliationStatus: 'unknown',
    dateAmbiguous: false,
    transactionDate: '2023-01-01',
    receiptNumber: 'REC-9988',
    paymentMethod: 'Cash',
    sourceSha256: 'sha256_hash_value',
    sourceMimeType: 'image/jpeg',
    sourceFileName: 'receipt.jpg',
    sourcePageNumber: 1,
    overallConfidence: 0.95,
    rawOcrText: 'Total: 1000',
    extractionModel: 'gemini-2.5-flash',
    extractionModelActual: 'gemini-2.5-flash',
    extractionSchemaVersion: '2',
    extractionDurationMs: 1200,
    warnings: [],
    ambiguousFields: [],
    wasEditedByUser: false,
    items: []
  };
  const mockReceipts: ReceiptDocument[] = [mockReceipt];
  const profile: UserProfileDocument = {
    email: 'backup@example.test',
    displayName: 'Backup User',
    createdAt: '2023-01-01T00:00:00.000Z',
    lastLoginAt: '2023-01-01T00:00:00.000Z',
    schemaVersion: 1,
  };
  const category: CategoryDocument = {
    id: 'category-1',
    name: 'Groceries',
    isCustom: false,
    createdAt: '2023-01-01T00:00:00.000Z',
    order: 4,
    isActive: false,
  };
  const alias: AliasDocument = {
    id: 'alias-market',
    merchantNormalized: 'market',
    categoryId: category.id,
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-02T00:00:00.000Z',
  };
  const settings: AppSettingsDocument = {
    currency: 'PKR',
    locale: 'en-PK',
    timeZone: 'Asia/Karachi',
    theme: 'dark',
    lowConfidenceThreshold: 0.7,
    discrepancyTolerance: 0,
    categoryCatalogVersion: 1,
  };
  const contents = { profile, receipts: mockReceipts, categories: [category], aliases: [alias], settings };

  it('exports and validates every declared account record with SHA-256 integrity', async () => {
    const json = await generateJSONBackup(contents);
    const result = await validateBackup(json);
    
    assert.strictEqual(result.isValid, true);
    assert.ok(result.envelope);
    assert.strictEqual(result.envelope.receipts.length, 1);
    assert.deepStrictEqual(result.envelope.profile, profile);
    assert.deepStrictEqual(result.envelope.categories, [category]);
    assert.deepStrictEqual(result.envelope.aliases, [alias]);
    assert.deepStrictEqual(result.envelope.settings, settings);
    assert.strictEqual(result.envelope.integrity.algorithm, 'SHA-256');
    
    // Check fields are preserved
    const restoredReceipt = result.envelope!.receipts[0];
    assert.strictEqual(restoredReceipt.sourceSha256, 'sha256_hash_value');
    assert.strictEqual(restoredReceipt.sourceMimeType, 'image/jpeg');
    assert.strictEqual(restoredReceipt.sourceFileName, 'receipt.jpg');
    assert.strictEqual(restoredReceipt.sourcePageNumber, 1);
    assert.strictEqual(restoredReceipt.receiptNumber, 'REC-9988');
    assert.strictEqual(restoredReceipt.paymentMethod, 'Cash');
    assert.strictEqual(restoredReceipt.overallConfidence, 0.95);
    assert.strictEqual(restoredReceipt.rawOcrText, 'Total: 1000');
    assert.strictEqual(restoredReceipt.extractionModel, 'gemini-2.5-flash');
    assert.strictEqual(restoredReceipt.extractionDurationMs, 1200);
    assert.strictEqual(restoredReceipt.id, 'r1');
    assert.strictEqual(restoredReceipt.printedGrandTotal, 1000);

  });

  it('refuses key material or image data instead of allowing it into a backup', async () => {
    await assert.rejects(
      generateJSONBackup({ ...contents, receipts: [{ ...mockReceipt, rawOcrText: 'data:image/png;base64,abc' }] }),
      /Images are not supported/,
    );
    await assert.rejects(
      generateJSONBackup({
        ...contents,
        receipts: [{ ...mockReceipt, rawOcrText: 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' }],
      }),
      /Images are not supported/,
    );
    assert.throws(
      () => normalizeBackupContents({ ...contents, aliases: [{ ...alias, apiKey: 'not-a-real-key' }] }),
      /prohibited key material/,
    );
  });

  it('normalizes Firestore-shaped timestamps before JSON serialization', async () => {
    const firestoreTimestamp = {
      seconds: 1_672_531_200,
      nanoseconds: 0,
      toDate: () => new Date('2023-01-01T00:00:00.000Z'),
    };
    const normalized = normalizeBackupContents({
      ...contents,
      profile: { ...profile, createdAt: firestoreTimestamp, lastLoginAt: firestoreTimestamp },
      categories: [{ ...category, createdAt: firestoreTimestamp }],
      aliases: [{ ...alias, createdAt: firestoreTimestamp, updatedAt: firestoreTimestamp }],
    });
    const json = await generateJSONBackup(normalized);
    assert.doesNotMatch(json, /"seconds"|"nanoseconds"/);
    assert.match(json, /2023-01-01T00:00:00\.000Z/);
  });

  it('previews new, unchanged, and overwritten records and excludes immutable receipt metadata from overwrites', () => {
    const incoming = [
      mockReceipt,
      { ...mockReceipt, id: 'r2', userNote: 'restored note' },
      { ...mockReceipt, id: 'r3' },
    ];
    const existing = [
      mockReceipt,
      { ...mockReceipt, id: 'r2', userNote: 'current note' },
    ];
    assert.deepStrictEqual(summarizeRestoreRecords(incoming, existing), {
      new: 1,
      unchanged: 1,
      overwritten: 1,
    });

    const patch = receiptRestorePatch(mockReceipt);
    assert.strictEqual(patch.id, undefined);
    assert.strictEqual(patch.createdAt, undefined);
    assert.strictEqual(patch.updatedAt, undefined);
    assert.strictEqual(patch.revision, undefined);
    assert.strictEqual(patch.printedGrandTotal, 1000);
  });

  it('fails validation on a changed file', async () => {
    const json = await generateJSONBackup(contents);
    const corruptJson = json.replace('"r1"', '"r2"');
    const result = await validateBackup(corruptJson);
    assert.strictEqual(result.isValid, false);
    assert.match(result.error!, /integrity check failed/);
  });

  it('rejects malformed, unsupported, and key-bearing imports before any restore can write', async () => {
    const invalidJson = JSON.stringify({
      version: 2,
      receipts: [],
    });
    const result = await validateBackup(invalidJson);
    assert.strictEqual(result.isValid, false);
    assert.match(result.error!, /profile|integrity/);

    const keyBearing = JSON.stringify({
      version: 2,
      integrity: { algorithm: 'SHA-256', digest: '0'.repeat(64) },
      profile: null,
      receipts: [],
      categories: [],
      aliases: [],
      settings: null,
      timestamp: '2023-01-01T00:00:00.000Z',
      authorization: 'not-a-real-token',
    });
    const keyResult = await validateBackup(keyBearing);
    assert.strictEqual(keyResult.isValid, false);
    assert.match(keyResult.error!, /prohibited key material/);

    assert.throws(
      () => normalizeBackupContents({
        ...contents,
        categories: [{ ...category, createdAt: 'not-a-timestamp' }],
      }),
      /Invalid timestamp/,
    );
  });
});

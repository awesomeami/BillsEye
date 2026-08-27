import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateJSONBackup, validateBackup } from '../backup';
import { ReceiptDocument } from '../../../domain/schema';

describe('Backup Service', () => {
  const mockReceipts: (Partial<ReceiptDocument> & { [key: string]: any })[] = [
    {
      id: 'r1',
      status: 'confirmed',
      createdAt: '2023-01-01T00:00:00Z',
      updatedAt: '2023-01-01T00:00:00Z',
      schemaVersion: 1, revision: 1,
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
      unregisteredField: 'should_be_stripped',
      warnings: [],
      ambiguousFields: [],
      wasEditedByUser: false,
      items: []
    }
  ];

  it('generates valid JSON with checksum and preserves schema metadata while stripping unknown fields', () => {
    const json = generateJSONBackup(mockReceipts, []);
    const result = validateBackup(json);
    
    assert.strictEqual(result.isValid, true);
    assert.ok(result.envelope);
    assert.strictEqual(result.envelope.receipts.length, 1);
    
    // Check fields are preserved
    const restoredReceipt = result.envelope.receipts[0] as any;
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

    // Check unknown fields are stripped
    assert.strictEqual(restoredReceipt.unregisteredField, undefined);
  });

  it('fails validation on corrupt file', () => {
    const json = generateJSONBackup(mockReceipts, []);
    // Tamper with data
    const corruptJson = json.replace('"r1"', '"r2"');
    const result = validateBackup(corruptJson);
    assert.strictEqual(result.isValid, false);
    assert.match(result.error!, /Checksum mismatch/);
  });

  it('fails validation on invalid schema', () => {
    const invalidJson = JSON.stringify({
      version: 1,
      receipts: []
      // missing categories
    });
    const result = validateBackup(invalidJson);
    assert.strictEqual(result.isValid, false);
    assert.match(result.error!, /Invalid backup format/);
  });
  
  it('supports future schema versions', () => {
    // As long as fields are parsed, extra fields are preserved or ignored by our validation.
    // Right now validation only checks version, categories, receipts arrays, and checksum.
    const envelope = {
      version: 2,
      futureField: 'test',
      categories: [],
      receipts: []
    };
    const hashData = JSON.stringify({
      version: 2,
      categories: [],
      receipts: []
    });
    // Generate simple hash
    let hash = 0;
    for (let i = 0; i < hashData.length; i++) {
      hash = ((hash << 5) - hash) + hashData.charCodeAt(i);
      hash |= 0;
    }
    
    const validJson = JSON.stringify({ ...envelope, checksum: hash.toString() });
    const result = validateBackup(validJson);
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.envelope!.version, 2);
  });
});

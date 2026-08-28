import assert from 'node:assert';
import { describe, test } from 'node:test';
import { MAX_RECEIPT_ITEMS, ReceiptSchema, ReceiptWriteSchema, StoredReceiptWriteSchema } from '../schema';

const makeReceipt = (itemCount = 1) => ({
  id: 'receipt-contract',
  schemaVersion: 2,
  revision: 1,
  status: 'pendingReview' as const,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
  confirmedAt: null,
  merchantRaw: null,
  merchantNormalized: null,
  branchAddress: null,
  receiptNumber: null,
  transactionDate: null,
  transactionTime: null,
  dateAmbiguous: false,
  currency: 'PKR',
  paymentMethod: null,
  items: Array.from({ length: itemCount }, (_, index) => ({
    id: `item-${index}`,
    rawLineText: `Unclear item ${index}`,
    name: null,
    brand: null,
    quantity: null,
    unit: null,
    unitPrice: null,
    discount: null,
    lineTotal: null,
    category: null,
    confidence: 0.4,
    userEdited: false,
    warnings: ['Name is unreadable'],
  })),
  printedSubtotal: null,
  printedDiscount: null,
  printedTax: null,
  printedFees: null,
  printedRounding: null,
  printedGrandTotal: null,
  computedLineTotal: null,
  computedExpectedTotal: null,
  discrepancy: null,
  reconciliationStatus: 'unknown' as const,
  rawOcrText: 'UNREADABLE RECEIPT',
  overallConfidence: 0.4,
  warnings: ['Merchant and item details need review'],
  ambiguousFields: ['merchantRaw'],
  extractionModel: 'gemini-flash-latest',
  extractionModelActual: 'gemini-flash-latest',
  extractionSchemaVersion: '2',
  extractionDurationMs: 1200,
  userNote: null,
  wasEditedByUser: false,
});

describe('Receipt data contract', () => {
  test('accepts a realistic null-valued receipt at the supported item boundary', () => {
    const parsed = ReceiptWriteSchema.safeParse(makeReceipt(MAX_RECEIPT_ITEMS));

    assert.strictEqual(parsed.success, true);
    if (parsed.success) {
      assert.strictEqual(parsed.data.merchantRaw, null);
      assert.strictEqual(parsed.data.items[0].name, null);
      assert.strictEqual(parsed.data.extractionSchemaVersion, '2');
      assert.strictEqual(parsed.data.items.length, MAX_RECEIPT_ITEMS);
    }
  });

  test('rejects over-limit and unexpected item fields before a Firestore write', () => {
    assert.strictEqual(ReceiptWriteSchema.safeParse(makeReceipt(MAX_RECEIPT_ITEMS + 1)).success, false);

    const baseReceipt = makeReceipt();
    const withUnexpectedItemField = {
      ...baseReceipt,
      items: baseReceipt.items.map((item, index) => index === 0 ? { ...item, image: 'not allowed' } : item),
    };
    assert.strictEqual(ReceiptWriteSchema.safeParse(withUnexpectedItemField).success, false);
  });

  test('requires the Firestore receipt header to use item subdocument storage', () => {
    const receipt = makeReceipt();
    const header = {
      ...receipt,
      itemStorageVersion: 2,
      items: [],
    };

    assert.strictEqual(StoredReceiptWriteSchema.safeParse(header).success, true);
    assert.strictEqual(StoredReceiptWriteSchema.safeParse({ ...header, items: receipt.items }).success, false);
  });

  test('round-trips a final Firestore-shaped receipt with nullable Gemini fields', () => {
    const receipt = makeReceipt();
    const storedHeader = StoredReceiptWriteSchema.parse({
      ...receipt,
      itemStorageVersion: 2,
      items: [],
    });
    const hydrated = ReceiptSchema.parse({ ...storedHeader, items: receipt.items });

    assert.strictEqual(hydrated.merchantRaw, null);
    assert.strictEqual(hydrated.items[0].name, null);
    assert.strictEqual(hydrated.items[0].brand, null);
    assert.strictEqual(hydrated.extractionSchemaVersion, '2');
  });

  test('continues to read valid historical documents that omit nullable text fields', () => {
    const current = makeReceipt();
    const { name: _name, ...historicalItem } = current.items[0];
    const { merchantRaw: _merchantRaw, ...historical } = current;

    assert.strictEqual(ReceiptSchema.safeParse({ ...historical, items: [historicalItem] }).success, true);
  });
});

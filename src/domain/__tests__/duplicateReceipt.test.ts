import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getDuplicateReceiptFingerprint,
  receiptMatchesDuplicateFingerprint,
} from '../duplicateReceipt';
import { ReceiptDocument } from '../schema';

const receipt: ReceiptDocument = {
  id: 'candidate',
  schemaVersion: 2,
  revision: 1,
  status: 'confirmed',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  merchantRaw: '  SAVOUR   Foods ',
  transactionDate: '2026-09-01',
  currency: 'PKR',
  items: [{ id: 'item', userEdited: false, lineTotal: 12500 }],
  dateAmbiguous: false,
  warnings: [],
  ambiguousFields: [],
  reconciliationStatus: 'matched',
  wasEditedByUser: false,
};

describe('duplicate receipt fingerprints', () => {
  test('matches merchantRaw across case and whitespace differences', () => {
    const fingerprint = getDuplicateReceiptFingerprint(receipt);
    assert.ok(fingerprint);
    assert.strictEqual(receiptMatchesDuplicateFingerprint(receipt, {
      merchant: 'savour foods',
      transactionDate: '2026-09-01',
      total: 12500,
    }), true);
  });

  test('uses calculated receipt totals when no printed grand total exists', () => {
    assert.strictEqual(getDuplicateReceiptFingerprint(receipt)?.total, 12500);
  });
});

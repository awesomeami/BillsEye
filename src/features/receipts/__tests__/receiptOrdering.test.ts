import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReceiptDocument } from '../../../domain/schema';
import { sortReceiptsByTransactionDateDescending } from '../../../services/firebase/receiptOrdering';

const makeReceipt = (id: string, transactionDate?: string): ReceiptDocument => ({
  id,
  schemaVersion: 2,
  revision: 1,
  status: 'confirmed',
  createdAt: `2026-09-0${id.length}T00:00:00Z`,
  updatedAt: '2026-09-01T00:00:00Z',
  transactionDate,
  currency: 'PKR',
  items: [],
  dateAmbiguous: false,
  warnings: [],
  ambiguousFields: [],
  reconciliationStatus: 'unknown',
  wasEditedByUser: false,
});

test('confirmed receipt ordering retains documents that omit transactionDate', () => {
  const receipts = [
    makeReceipt('missing'),
    makeReceipt('newer', '2026-09-01'),
    makeReceipt('older', '2025-01-01'),
  ];
  assert.deepStrictEqual(
    sortReceiptsByTransactionDateDescending(receipts).map(receipt => receipt.id),
    ['newer', 'older', 'missing'],
  );
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prepareReceiptSave } from '../receiptConfirmation';
import { CategoryDocument, ReceiptDocument } from '../schema';

const groceries: CategoryDocument = {
  id: 'groceries',
  name: 'Groceries',
  isCustom: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  order: 0,
  isActive: true,
};

const receipt: ReceiptDocument = {
  id: 'receipt-1',
  schemaVersion: 2,
  revision: 1,
  status: 'pendingReview',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  confirmedAt: null,
  currency: 'PKR',
  items: [{
    id: 'item-1',
    name: 'Rice',
    lineTotal: 9900,
    category: 'Groceries',
    userEdited: false,
  }],
  printedGrandTotal: 10000,
  warnings: [],
  ambiguousFields: [],
  dateAmbiguous: false,
  wasEditedByUser: false,
  reconciliationStatus: 'unknown',
};

describe('receipt confirmation invariants', () => {
  it('applies aliases, canonical categories, tolerance, and confirmation metadata', () => {
    const saved = prepareReceiptSave({
      receipt,
      status: 'confirmed',
      categories: [groceries],
      discrepancyTolerance: 100,
      expectedCurrency: 'PKR',
      merchantAliasCategoryId: groceries.id,
      now: () => '2026-09-02T12:00:00.000Z',
    });

    assert.strictEqual(saved.status, 'confirmed');
    assert.strictEqual(saved.confirmedAt, '2026-09-02T12:00:00.000Z');
    assert.strictEqual(saved.items?.[0].categoryId, groceries.id);
    assert.strictEqual(saved.items?.[0].category, undefined);
    assert.strictEqual(saved.computedLineTotal, 9900);
    assert.strictEqual(saved.discrepancy, 100);
    assert.strictEqual(saved.reconciliationStatus, 'matched');
  });

  it('does not overwrite a user-edited category with a merchant alias', () => {
    const saved = prepareReceiptSave({
      receipt: {
        ...receipt,
        items: [{ ...receipt.items[0], category: undefined, categoryId: 'medicine', userEdited: true }],
      },
      status: 'confirmed',
      categories: [groceries],
      discrepancyTolerance: 0,
      expectedCurrency: 'PKR',
      merchantAliasCategoryId: groceries.id,
    });

    assert.strictEqual(saved.items?.[0].categoryId, 'medicine');
  });

  it('rejects a non-PKR receipt before it can be confirmed', () => {
    assert.throws(() => prepareReceiptSave({
      receipt: { ...receipt, currency: 'USD' },
      status: 'confirmed',
      categories: [groceries],
      discrepancyTolerance: 0,
      expectedCurrency: 'PKR',
    }), /configured for PKR only/);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSortReceipts, FilterState, SortState } from '../library/libraryUtils';
import { ReceiptDocument } from '../../../domain/schema';

describe('libraryUtils', () => {
  const mockReceipts: ReceiptDocument[] = [
    {
      id: 'r1',
      schemaVersion: 1, revision: 1,
      status: 'confirmed',
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
      confirmedAt: '2026-08-01T00:00:00Z',
      merchantNormalized: 'Target',
      merchantRaw: 'TARGET STORE',
      transactionDate: '2026-08-01',
      transactionTime: null,
      currency: 'USD',
      items: [
        { id: 'i1', name: 'Milk', lineTotal: 300, category: 'Groceries', userEdited: false },
        { id: 'i2', name: 'Bread', lineTotal: 200, category: 'Groceries', userEdited: false }
      ],
      printedGrandTotal: 500,
      printedSubtotal: null,
      printedDiscount: null,
      printedTax: null,
      printedFees: null,
      printedRounding: null,
      computedLineTotal: 500,
      computedExpectedTotal: 500,
      discrepancy: null,
      reconciliationStatus: 'matched',
      warnings: [],
      ambiguousFields: [],
      dateAmbiguous: false,
      wasEditedByUser: false,
    },
    {
      id: 'r2',
      schemaVersion: 1, revision: 1,
      status: 'confirmed',
      createdAt: '2026-08-02T00:00:00Z',
      updatedAt: '2026-08-02T00:00:00Z',
      confirmedAt: '2026-08-02T00:00:00Z',
      merchantNormalized: 'Walmart',
      transactionDate: '2026-08-02',
      transactionTime: null,
      currency: 'USD',
      items: [
        { id: 'i3', name: 'TV', lineTotal: 50000, category: 'Electronics', userEdited: false }
      ],
      printedGrandTotal: 50000,
      printedSubtotal: null,
      printedDiscount: null,
      printedTax: null,
      printedFees: null,
      printedRounding: null,
      computedLineTotal: 50000,
      computedExpectedTotal: 50000,
      discrepancy: null,
      reconciliationStatus: 'matched',
      warnings: [],
      ambiguousFields: [],
      dateAmbiguous: false,
      wasEditedByUser: false,
    },
    {
      id: 'r3',
      schemaVersion: 1, revision: 1,
      status: 'confirmed',
      createdAt: '2026-08-03T00:00:00Z',
      updatedAt: '2026-08-03T00:00:00Z',
      confirmedAt: '2026-08-03T00:00:00Z',
      merchantNormalized: 'McDonalds',
      transactionDate: null, // Test null field handling
      transactionTime: null,
      currency: 'USD',
      items: [
        { id: 'i4', name: 'Burger', lineTotal: 1000, category: 'Eating Out', userEdited: false }
      ],
      printedGrandTotal: 1200,
      printedSubtotal: null,
      printedDiscount: null,
      printedTax: null,
      printedFees: null,
      printedRounding: null,
      computedLineTotal: 1000,
      computedExpectedTotal: 1000,
      discrepancy: 200,
      reconciliationStatus: 'mismatched',
      warnings: ['Totals mismatch'],
      ambiguousFields: [],
      dateAmbiguous: false,
      wasEditedByUser: false,
    }
  ];

  const defaultFilters: FilterState = {
    searchQuery: '',
    dateStart: null,
    dateEnd: null,
    merchant: null,
    category: null,
    item: null,
    paymentMethod: null,
    amountMin: null,
    amountMax: null,
    hasWarning: null,
  };

  const defaultSort: SortState = { field: 'date', order: 'desc' };

  it('should return all receipts if no filters are applied', () => {
    const result = filterAndSortReceipts(mockReceipts, defaultFilters, defaultSort);
    assert.strictEqual(result.length, 3);
  });

  it('should filter by search query (merchant)', () => {
    const result = filterAndSortReceipts(mockReceipts, { ...defaultFilters, searchQuery: 'walmart' }, defaultSort);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'r2');
  });

  it('should filter by search query (item)', () => {
    const result = filterAndSortReceipts(mockReceipts, { ...defaultFilters, searchQuery: 'milk' }, defaultSort);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'r1');
  });

  it('should handle missing fields safely during sort', () => {
    const result = filterAndSortReceipts(mockReceipts, defaultFilters, { field: 'date', order: 'asc' });
    // r3 has no date, so '' localeCompare '2026-08-01' is negative, making r3 come first
    assert.strictEqual(result[0].id, 'r3');
    assert.strictEqual(result[1].id, 'r1');
    assert.strictEqual(result[2].id, 'r2');
  });

  it('should filter by amount range', () => {
    const result = filterAndSortReceipts(mockReceipts, { ...defaultFilters, amountMin: 1000, amountMax: 10000 }, defaultSort);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'r3');
  });

  it('should filter by warning', () => {
    const result = filterAndSortReceipts(mockReceipts, { ...defaultFilters, hasWarning: true }, defaultSort);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'r3');

    const result2 = filterAndSortReceipts(mockReceipts, { ...defaultFilters, hasWarning: false }, defaultSort);
    assert.strictEqual(result2.length, 2);
  });

  it('should handle Asia/Karachi date boundaries via standard string comparison', () => {
    // In our system, dates are stored as YYYY-MM-DD. Timezone translation happens before saving,
    // so filtering by '2026-08-02' (which could be the boundary in Karachi) works strictly.
    const result = filterAndSortReceipts(mockReceipts, { 
      ...defaultFilters, 
      dateStart: '2026-08-01',
      dateEnd: '2026-08-01'
    }, defaultSort);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'r1');
  });

  it('should handle complex combinations', () => {
    const result = filterAndSortReceipts(mockReceipts, { 
      ...defaultFilters, 
      dateStart: '2026-08-01',
      dateEnd: '2026-08-02',
      amountMax: 1000
    }, defaultSort);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'r1');
  });
});

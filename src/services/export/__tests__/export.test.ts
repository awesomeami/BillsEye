import { describe, it } from 'node:test';
import assert from 'node:assert';
import { exportReceiptsCSV, exportItemsCSV } from '../csv';
import { exportExcel } from '../excel';
import { exportPDF } from '../pdf';
import { ReceiptDocument, CategoryDocument } from '../../../domain/schema';

describe('Export Service', () => {
  const mockReceipts: ReceiptDocument[] = [
    {
      id: 'r1',
      status: 'confirmed',
      createdAt: '2023-01-01T00:00:00Z',
      updatedAt: '2023-01-01T00:00:00Z',
      schemaVersion: 1, revision: 1,
      currency: 'PKR',
      transactionDate: '2023-01-01',
      merchantNormalized: 'Test Store',
      printedGrandTotal: 1500,
      printedTax: 50,
      reconciliationStatus: 'matched',
      dateAmbiguous: false,
      userNote: 'Test Note',
      warnings: [],
      ambiguousFields: [],
      wasEditedByUser: false,
      items: [
        {
          id: 'i1',
          name: 'Milk',
          quantity: 2,
          unitPrice: 500,
          lineTotal: 1000,
          category: 'cat_groceries',
          userEdited: false
        }
      ]
    }
  ];

  const mockCategories: CategoryDocument[] = [
    {
      id: 'cat_groceries',
      name: 'Groceries',
      isCustom: false,
      createdAt: '2023-01-01T00:00:00Z',
      order: 0,
      isActive: true
    }
  ];

  it('generates Receipts CSV', () => {
    const csv = exportReceiptsCSV(mockReceipts, false); // No BOM for test
    assert.match(csv, /r1/);
    assert.match(csv, /Test Store/);
    assert.match(csv, /15/); // 1500 / 100 = 15
  });

  it('generates Items CSV', () => {
    const csv = exportItemsCSV(mockReceipts, false);
    assert.match(csv, /i1/);
    assert.match(csv, /Milk/);
    assert.match(csv, /10/); // 1000 / 100 = 10
  });

  it('sanitizes potential CSV formula injection payloads', () => {
    const maliciousReceipts: ReceiptDocument[] = [
      {
        ...mockReceipts[0],
        id: 'r_inj',
        merchantNormalized: '=SUM(1,2)',
        userNote: '@cmd /c calc',
        items: [
          {
            id: 'i_inj',
            name: '+1337',
            quantity: 1,
            unitPrice: 100,
            lineTotal: 100,
            category: '-DANGEROUS',
            userEdited: false
          }
        ]
      }
    ];

    const receiptsCsv = exportReceiptsCSV(maliciousReceipts, false);
    // Values beginning with =, @, +, - should have a leading single quote prefix
    assert.match(receiptsCsv, /'=SUM\(1,2\)/);
    assert.match(receiptsCsv, /'@cmd \/c calc/);

    const itemsCsv = exportItemsCSV(maliciousReceipts, false);
    assert.match(itemsCsv, /'\+1337/);
    assert.match(itemsCsv, /'-DANGEROUS/);
  });

  it('generates Excel Buffer', async () => {
    const buffer = await exportExcel(mockReceipts, mockCategories);
    assert.ok(buffer);
    assert.ok(buffer.byteLength > 0);
  });

  it('generates PDF Buffer', () => {
    const buffer = exportPDF(mockReceipts, 'Test Range');
    assert.ok(buffer);
    assert.ok(buffer.byteLength > 0);
  });
});

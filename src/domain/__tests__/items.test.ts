import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnit, areUnitsCompatible, analyzeItem, ItemObservation, groupAndAnalyzeItems } from '../items';
import { ReceiptDocument } from '../schema';

describe('Item Analytics', () => {
  it('parses and normalizes compatible units correctly', () => {
    // mass
    assert.deepEqual(parseUnit(1.5, 'kg'), { category: 'mass', standardValue: 1.5, standardUnit: 'kg', isEstimated: false });
    assert.deepEqual(parseUnit(500, 'g'), { category: 'mass', standardValue: 0.5, standardUnit: 'kg', isEstimated: false });
    
    // volume
    assert.deepEqual(parseUnit(2, 'L'), { category: 'volume', standardValue: 2, standardUnit: 'L', isEstimated: false });
    assert.deepEqual(parseUnit(250, 'ml'), { category: 'volume', standardValue: 0.25, standardUnit: 'L', isEstimated: false });
    
    // count
    assert.deepEqual(parseUnit(2, 'dozen'), { category: 'count', standardValue: 24, standardUnit: 'pc', isEstimated: false });
    assert.deepEqual(parseUnit(5, 'pcs'), { category: 'count', standardValue: 5, standardUnit: 'pc', isEstimated: false });
    
    // unknown/packs
    assert.deepEqual(parseUnit(1, 'box'), { category: 'unknown', standardValue: 1, standardUnit: 'box', isEstimated: false });
  });

  it('checks unit compatibility', () => {
    assert.strictEqual(areUnitsCompatible(parseUnit(1, 'kg'), parseUnit(500, 'g')), true);
    assert.strictEqual(areUnitsCompatible(parseUnit(1, 'L'), parseUnit(500, 'ml')), true);
    assert.strictEqual(areUnitsCompatible(parseUnit(1, 'dozen'), parseUnit(12, 'pcs')), true);
    
    // incompatible
    assert.strictEqual(areUnitsCompatible(parseUnit(1, 'kg'), parseUnit(1, 'L')), false);
    assert.strictEqual(areUnitsCompatible(parseUnit(1, 'kg'), parseUnit(1, 'pcs')), false);
    
    // unknown
    assert.strictEqual(areUnitsCompatible(parseUnit(1, 'box'), parseUnit(1, 'box')), true);
    assert.strictEqual(areUnitsCompatible(parseUnit(1, 'box'), parseUnit(1, 'packet')), false);
  });

  it('calculates weighted versus simple averages and median correctly', () => {
    const obs: ItemObservation[] = [
      { receiptId: '1', transactionDate: '2026-07-01', merchant: 'A', rawName: 'Rice', canonicalName: 'rice', unit: parseUnit(1, 'kg'), lineTotal: 300, unitPrice: 300, isRefund: false },
      { receiptId: '2', transactionDate: '2026-07-05', merchant: 'B', rawName: 'Rice', canonicalName: 'rice', unit: parseUnit(5, 'kg'), lineTotal: 1000, unitPrice: 200, isRefund: false },
      { receiptId: '3', transactionDate: '2026-08-10', merchant: 'A', rawName: 'Rice', canonicalName: 'rice', unit: parseUnit(10, 'kg'), lineTotal: 1500, unitPrice: 150, isRefund: false },
    ];

    const result = analyzeItem(obs);
    assert.ok(result);

    // Simple average of prices: (300 + 200 + 150) / 3 = 216.66
    assert.ok(Math.abs(result.simpleAverage! - 216.666) < 0.01);
    
    // Weighted average: total spend / total units = (300+1000+1500) / (1+5+10) = 2800 / 16 = 175
    assert.strictEqual(result.weightedAverage, 175);
    
    // Median of [150, 200, 300] = 200
    assert.strictEqual(result.medianPrice, 200);

    // Change abs: latest is 150 (on 08-10). prev is 200 (on 08-05). Change = -50
    assert.ok(Math.abs(result.priceChangeAbs! - (-66.666)) < 0.01);
    assert.ok(Math.abs(result.priceChangePct! - (-30.769)) < 0.01);
  });

  it('handles zero denominator safely', () => {
    const receipts: ReceiptDocument[] = [{
      id: 'r1', schemaVersion: 1, revision: 1, status: 'confirmed', createdAt: '', updatedAt: '', 
      transactionDate: '2026-08-01', transactionTime: null, merchantRaw: 'A', items: [
        { id: 'i1', userEdited: false, name: 'Rice', quantity: 0, unit: 'kg', lineTotal: 300 }
      ], currency: 'PKR', warnings: [], ambiguousFields: [], dateAmbiguous: false, wasEditedByUser: false, reconciliationStatus: 'unknown',
      printedGrandTotal: 300, printedSubtotal: null, printedDiscount: null, printedTax: null, printedFees: null, printedRounding: null, computedLineTotal: 300, computedExpectedTotal: null, discrepancy: null
    }];
    
    const res = groupAndAnalyzeItems(receipts);
    assert.strictEqual(res.length, 0); // 0 quantity items are excluded
  });

  it('keeps estimated quantities in spend without inventing a rate', () => {
    const result = analyzeItem([{
      receiptId: 'r1',
      transactionDate: '2026-08-01',
      merchant: 'A',
      rawName: 'Rice',
      canonicalName: 'rice',
      unit: parseUnit(1, 'kg', true),
      lineTotal: 300,
      unitPrice: 300,
      isRefund: false,
    }]);

    assert.ok(result);
    assert.strictEqual(result.totalSpent, 300);
    assert.strictEqual(result.latestPrice, null);
    assert.strictEqual(result.weightedAverage, null);
    assert.deepStrictEqual(result.observations, []);
  });

  it('handles insufficient observations for percentage change safely', () => {
    const obs: ItemObservation[] = [
      { receiptId: '1', transactionDate: '2026-08-01', merchant: 'A', rawName: 'Rice', canonicalName: 'rice', unit: parseUnit(1, 'kg'), lineTotal: 300, unitPrice: 300, isRefund: false },
    ];
    const result = analyzeItem(obs);
    assert.ok(result);
    assert.strictEqual(result.priceChangeAbs, null);
    assert.strictEqual(result.priceChangePct, null);
  });

  it('groups items properly by canonical name and unit category', () => {
    const receipts: ReceiptDocument[] = [{
      id: 'r1', schemaVersion: 1, revision: 1, status: 'confirmed', createdAt: '', updatedAt: '', 
      transactionDate: '2026-08-01', transactionTime: null, merchantRaw: 'A', items: [
        { id: 'i1', userEdited: false, name: 'Rice', quantity: 1, unit: 'kg', lineTotal: 300 },
        { id: 'i2', userEdited: false, name: 'Rice', quantity: 1, unit: 'pcs', lineTotal: 50 }, // same name, different unit category
      ], currency: 'PKR', warnings: [], ambiguousFields: [], dateAmbiguous: false, wasEditedByUser: false, reconciliationStatus: 'unknown',
      printedGrandTotal: 350, printedSubtotal: null, printedDiscount: null, printedTax: null, printedFees: null, printedRounding: null, computedLineTotal: 350, computedExpectedTotal: null, discrepancy: null
    }];
    const res = groupAndAnalyzeItems(receipts);
    assert.strictEqual(res.length, 2);
    assert.strictEqual(res.find(r => r.unitCategory === 'mass')?.canonicalName, 'rice');
    assert.strictEqual(res.find(r => r.unitCategory === 'count')?.canonicalName, 'rice');
  });

  it('prefers the extracted unit rate over a discounted line-total derivation', () => {
    const receipts: ReceiptDocument[] = [{
      ...createReceipt('discounted-rate', 18000),
      items: [{
        id: 'item-1',
        userEdited: false,
        name: 'Soap',
        quantity: 2,
        unit: 'pc',
        unitPrice: 10000,
        discount: 2000,
        lineTotal: 18000,
      }],
    }];

    const [result] = groupAndAnalyzeItems(receipts);
    assert.strictEqual(result.latestPrice, 10000);
    assert.strictEqual(result.weightedAverage, 10000);
    assert.strictEqual(result.totalSpent, 18000);
  });

  it('converts an extracted rate to the normalized standard unit', () => {
    const receipts: ReceiptDocument[] = [{
      ...createReceipt('mass-rate', 1000),
      items: [{
        id: 'item-1',
        userEdited: false,
        name: 'Spice',
        quantity: 500,
        unit: 'g',
        unitPrice: 2,
        lineTotal: 1000,
      }],
    }];

    const [result] = groupAndAnalyzeItems(receipts);
    assert.strictEqual(result.standardUnit, 'kg');
    assert.strictEqual(result.latestPrice, 2000);
  });

  it('keeps different unknown units in separate groups', () => {
    const receipts: ReceiptDocument[] = [{
      ...createReceipt('unknown-units', 3000),
      items: [
        { id: 'box', userEdited: false, name: 'Tea', quantity: 1, unit: 'box', lineTotal: 1000 },
        { id: 'bottle', userEdited: false, name: 'Tea', quantity: 1, unit: 'bottle', lineTotal: 2000 },
      ],
    }];

    const result = groupAndAnalyzeItems(receipts);
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result.map(item => item.standardUnit).sort(), ['bottle', 'box']);
  });

  it('nets refunds into total spend without treating a return as a price observation', () => {
    const purchase = {
      ...createReceipt('purchase', 10000),
      transactionDate: '2026-08-01',
      items: [{
        id: 'purchase-item', userEdited: false, name: 'Kettle', quantity: 1,
        unit: 'pc', unitPrice: 10000, lineTotal: 10000,
      }],
    };
    const refund = {
      ...createReceipt('refund', -4000),
      transactionDate: '2026-08-05',
      items: [{
        id: 'refund-item', userEdited: false, name: 'Kettle', quantity: 1,
        unit: 'pc', unitPrice: 4000, lineTotal: 4000,
      }],
    };

    const [result] = groupAndAnalyzeItems([purchase, refund]);
    assert.strictEqual(result.totalSpent, 6000);
    assert.strictEqual(result.occasions, 2);
    assert.strictEqual(result.latestPrice, 10000);
    assert.strictEqual(result.observations.length, 1);
  });
});

function createReceipt(id: string, printedGrandTotal: number): ReceiptDocument {
  return {
    id,
    schemaVersion: 2,
    revision: 1,
    status: 'confirmed',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    transactionDate: '2026-08-01',
    merchantRaw: 'Merchant',
    items: [],
    currency: 'PKR',
    printedGrandTotal,
    warnings: [],
    ambiguousFields: [],
    dateAmbiguous: false,
    wasEditedByUser: false,
    reconciliationStatus: 'matched',
  };
}

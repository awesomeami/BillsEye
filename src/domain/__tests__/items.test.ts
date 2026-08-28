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
    assert.ok(Math.abs(result.simpleAverage - 216.666) < 0.01);
    
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

  it('excludes estimated quantities from strict analysis', () => {
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

    assert.strictEqual(result, null);
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
});

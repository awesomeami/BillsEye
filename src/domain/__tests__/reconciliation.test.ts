import { describe, test } from 'node:test';
import assert from 'node:assert';
import { reconcileReceipt } from '../reconciliation';

describe('reconcileReceipt', () => {
  test('matches when items sum exactly to grand total with no modifiers', () => {
    const items = [{ lineTotal: 1000 }, { lineTotal: 550 }];
    const totals = { printedGrandTotal: 1550 };
    const result = reconcileReceipt(items, totals);
    
    assert.strictEqual(result.computedLineTotal, 1550);
    assert.strictEqual(result.computedExpectedTotal, 1550);
    assert.strictEqual(result.discrepancy, 0);
    assert.strictEqual(result.reconciliationStatus, 'matched');
    assert.strictEqual(result.warnings.length, 0);
  });

  test('calculates correct expected total with discount, tax, fees', () => {
    const items = [{ lineTotal: 1000 }];
    const totals = { 
      printedSubtotal: 1000,
      printedDiscount: 100, // Policy: absolute value subtracted
      printedTax: 50,
      printedFees: 20,
      printedRounding: -1,
      printedGrandTotal: 969
    };
    
    const result = reconcileReceipt(items, totals);
    assert.strictEqual(result.computedExpectedTotal, 969); // 1000 - 100 + 50 + 20 - 1
    assert.strictEqual(result.reconciliationStatus, 'matched');
  });

  test('discount absolute value policy', () => {
    const items = [{ lineTotal: 1000 }];
    const totals = { 
      printedSubtotal: 1000,
      printedDiscount: -100, // Should be subtracted even if negative
      printedGrandTotal: 900
    };
    
    const result = reconcileReceipt(items, totals);
    assert.strictEqual(result.computedExpectedTotal, 900);
    assert.strictEqual(result.reconciliationStatus, 'matched');
  });

  test('preserves unknown when grand total is missing', () => {
    const items = [{ lineTotal: 1000 }];
    const totals = {};
    
    const result = reconcileReceipt(items, totals);
    assert.strictEqual(result.computedExpectedTotal, 1000);
    assert.strictEqual(result.discrepancy, null);
    assert.strictEqual(result.reconciliationStatus, 'unknown');
  });

  test('preserves unknown when items are missing line totals and subtotal missing', () => {
    const items = [{ lineTotal: 1000 }, { lineTotal: null }];
    const totals = { printedGrandTotal: 1500 };
    
    const result = reconcileReceipt(items, totals);
    assert.strictEqual(result.computedLineTotal, 1000);
    assert.strictEqual(result.computedExpectedTotal, 1000); // Base falls back to partial items
    assert.strictEqual(result.discrepancy, -500); // 1000 - 1500
    assert.strictEqual(result.reconciliationStatus, 'mismatched');
    assert.strictEqual(result.warnings.length, 2);
  });
});

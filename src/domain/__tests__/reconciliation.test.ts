import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateReceiptTotals, getDiscrepancyLabel, normalizeDiscount } from '../reconciliation';

describe('receipt total calculation', () => {
  const cases = [
    {
      name: 'includes tax, fees, rounding, and a positive discount exactly once',
      items: [{ lineTotal: 1000 }],
      totals: { printedDiscount: 100, printedTax: 50, printedFees: 20, printedRounding: -1, printedGrandTotal: 969 },
      expected: { line: 1000, expected: 969, effective: 969, discrepancy: 0, status: 'matched' },
    },
    {
      name: 'normalizes an already-negative discount without changing the result',
      items: [{ lineTotal: 1000 }],
      totals: { printedDiscount: -100, printedGrandTotal: 900 },
      expected: { line: 1000, expected: 900, effective: 900, discrepancy: 0, status: 'matched' },
    },
    {
      name: 'uses a real numeric zero printed subtotal as a known subtotal',
      items: [{ lineTotal: null }, { lineTotal: null }],
      totals: { printedSubtotal: 0, printedGrandTotal: 0 },
      expected: { line: null, expected: 0, effective: 0, discrepancy: 0, status: 'matched' },
    },
    {
      name: 'does not convert all-null line items into a zero subtotal',
      items: [{ lineTotal: null }, { lineTotal: null }],
      totals: { printedGrandTotal: 1500 },
      expected: { line: null, expected: null, effective: 1500, discrepancy: null, status: 'unknown' },
    },
    {
      name: 'does not use a partial line-item total as a complete subtotal',
      items: [{ lineTotal: 1000 }, { lineTotal: null }],
      totals: { printedGrandTotal: 1500 },
      expected: { line: null, expected: null, effective: 1500, discrepancy: null, status: 'unknown' },
    },
    {
      name: 'keeps refunds and negative adjustments negative',
      items: [{ lineTotal: -1000 }],
      totals: { printedTax: -50, printedFees: -20, printedRounding: 1, printedGrandTotal: -1069 },
      expected: { line: -1000, expected: -1069, effective: -1069, discrepancy: 0, status: 'matched' },
    },
  ] as const;

  for (const scenario of cases) {
    test(scenario.name, () => {
      const result = calculateReceiptTotals(scenario.items, scenario.totals);
      assert.strictEqual(result.computedLineTotal, scenario.expected.line);
      assert.strictEqual(result.computedExpectedTotal, scenario.expected.expected);
      assert.strictEqual(result.effectiveTotal, scenario.expected.effective);
      assert.strictEqual(result.discrepancy, scenario.expected.discrepancy);
      assert.strictEqual(result.reconciliationStatus, scenario.expected.status);
    });
  }

  test('defines discrepancy as printed total minus calculated total everywhere', () => {
    const result = calculateReceiptTotals([{ lineTotal: 900 }], { printedGrandTotal: 1000 });

    assert.strictEqual(result.discrepancy, 100);
    assert.strictEqual(result.discrepancyDirection, 'printed_higher');
    assert.strictEqual(getDiscrepancyLabel(result.discrepancyDirection), 'Printed total is higher than calculated total');
  });

  test('retains an unknown total instead of displaying a numeric zero', () => {
    const result = calculateReceiptTotals([{ lineTotal: null }], {});

    assert.strictEqual(result.effectiveTotal, null);
    assert.strictEqual(result.reconciliationStatus, 'unknown');
  });

  test('normalizes missing and both discount signs to one negative adjustment', () => {
    assert.strictEqual(normalizeDiscount(null), 0);
    assert.strictEqual(normalizeDiscount(100), -100);
    assert.strictEqual(normalizeDiscount(-100), -100);
  });
});

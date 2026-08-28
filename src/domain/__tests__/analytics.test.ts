import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { 
  calculateDashboardSummary, 
  getDateRange,
  getElapsedMonthComparisonRanges,
  generateMonthlyReport,
  generateItemReport,
  generateMerchantReport
} from '../analytics';
import { ReceiptDocument } from '../schema';

const baseReceipt: ReceiptDocument = {
  id: '1',
  schemaVersion: 1,
  revision: 1,
  status: 'confirmed',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  confirmedAt: new Date().toISOString(),
  transactionDate: '2024-05-15',
  transactionTime: null,
  merchantRaw: 'TEST',
  merchantNormalized: 'Test Merchant',
  items: [],
  printedGrandTotal: 1000, 
  currency: 'USD',
  warnings: [],
  ambiguousFields: [],
  dateAmbiguous: false,
  wasEditedByUser: false,
  reconciliationStatus: 'matched',
};

// TZ Matrix
const testTimezones = ['UTC', 'Asia/Karachi', 'America/New_York', 'Europe/London'];

for (const tz of testTimezones) {
  describe(`Analytics Tests - TZ: ${tz}`, () => {
    let originalTz: string | undefined;

    before(() => {
      originalTz = process.env.TZ;
      process.env.TZ = tz;
    });

    after(() => {
      if (originalTz) process.env.TZ = originalTz;
      else delete process.env.TZ;
    });

    test('getDateRange handles standard filters', () => {
      const refDate = new Date('2024-02-15T12:00:00Z'); 
      const thisMonth = getDateRange('this_month', refDate);
      assert.strictEqual(thisMonth.start, '2024-02-01');
      assert.strictEqual(thisMonth.end, '2024-02-29'); // handles leap year correctly

      const lastMonth = getDateRange('last_month', refDate);
      assert.strictEqual(lastMonth.start, '2024-01-01');
      assert.strictEqual(lastMonth.end, '2024-01-31');

      const prev3 = getDateRange('previous_3_months', refDate);
      // refDate is Feb, so last month is Jan. previous 3 months should be Nov, Dec, Jan
      assert.strictEqual(prev3.start, '2023-11-01');
      assert.strictEqual(prev3.end, '2024-01-31');

      const last3IncludingCurrent = getDateRange('current_and_previous_2_months', refDate);
      assert.strictEqual(last3IncludingCurrent.start, '2023-12-01');
      assert.strictEqual(last3IncludingCurrent.end, '2024-02-29');
    });

    test('compares the elapsed current month with the same elapsed prior-month period', () => {
      const refDate = new Date('2026-08-10T12:00:00Z');
      const receipts: ReceiptDocument[] = [
        { ...baseReceipt, id: '1', transactionDate: '2026-08-05', printedGrandTotal: 5000 },
        { ...baseReceipt, id: '2', transactionDate: '2026-08-15', printedGrandTotal: 2000 }, 
        { ...baseReceipt, id: '3', transactionDate: '2026-07-05', printedGrandTotal: 3000 },
        { ...baseReceipt, id: '4', transactionDate: '2026-07-25', printedGrandTotal: 1000 },
        { ...baseReceipt, id: '5', transactionDate: '2026-06-15', printedGrandTotal: 10000 }, 
        { ...baseReceipt, id: '6', transactionDate: null, printedGrandTotal: 500 }, 
        { ...baseReceipt, id: '7', status: 'pendingReview', transactionDate: '2026-08-05', printedGrandTotal: 9999 }, 
        { ...baseReceipt, id: '8', transactionDate: '2026-08-01', printedGrandTotal: -500 }, // Refund
        { ...baseReceipt, id: '9', transactionDate: '2026-08-02', printedGrandTotal: null }, // Unknown total
      ];

      const summary = calculateDashboardSummary(receipts, refDate);
      
      // Current total = 5000 - 500; Aug 15 and Jul 25 are after the comparison period.
      assert.strictEqual(summary.currentTotal, 4500);
      assert.strictEqual(summary.currentTotalAvailable, true);
      assert.strictEqual(summary.prevTotal, 3000);
      assert.strictEqual(summary.previousTotalAvailable, true);
      assert.strictEqual(summary.changeAbs, 1500);
      assert.strictEqual(summary.changePct, 50);
      assert.strictEqual(summary.pendingCount, 1);
      assert.strictEqual(summary.needsDateCount, 1);
      assert.strictEqual(summary.excludedNullCount, 1);
      assert.strictEqual(summary.receiptCount, 3); // id 1, 8, 9 are in the elapsed current period
      assert.strictEqual(summary.averageReceiptValue, 2250); // 4500 / 2 valid receipts
      assert.deepStrictEqual(summary.dailyTrend.map(day => day.date), ['2026-08-01', '2026-08-05']);
    });

    test('clamps equivalent elapsed ranges at month boundaries, including leap years', () => {
      const cases = [
        ['2026-08-10T12:00:00Z', '2026-08-01', '2026-08-10', '2026-07-01', '2026-07-10'],
        ['2024-03-31T12:00:00Z', '2024-03-01', '2024-03-31', '2024-02-01', '2024-02-29'],
        ['2023-03-31T12:00:00Z', '2023-03-01', '2023-03-31', '2023-02-01', '2023-02-28'],
        ['2026-01-05T12:00:00Z', '2026-01-01', '2026-01-05', '2025-12-01', '2025-12-05'],
      ] as const;

      for (const [input, currentStart, currentEnd, previousStart, previousEnd] of cases) {
        const ranges = getElapsedMonthComparisonRanges(new Date(input));
        assert.deepStrictEqual(ranges.current, { start: currentStart, end: currentEnd });
        assert.deepStrictEqual(ranges.previous, { start: previousStart, end: previousEnd });
      }
    });

    test('does not calculate a percentage for a zero prior total or an unavailable current total', () => {
      const refDate = new Date('2026-08-10T12:00:00Z');
      const zeroPrior = calculateDashboardSummary([
        { ...baseReceipt, id: 'current', transactionDate: '2026-08-05', printedGrandTotal: 1000 },
        { ...baseReceipt, id: 'previous', transactionDate: '2026-07-05', printedGrandTotal: 0 },
      ], refDate);
      assert.strictEqual(zeroPrior.previousTotalAvailable, true);
      assert.strictEqual(zeroPrior.changePct, null);

      const unknownCurrent = calculateDashboardSummary([
        { ...baseReceipt, id: 'current', transactionDate: '2026-08-05', printedGrandTotal: null },
        { ...baseReceipt, id: 'previous', transactionDate: '2026-07-05', printedGrandTotal: 1000 },
      ], refDate);
      assert.strictEqual(unknownCurrent.currentTotalAvailable, false);
      assert.strictEqual(unknownCurrent.changePct, null);
    });

    test('aggregates category composition strictly based on items', () => {
      const refDate = new Date('2026-08-10T12:00:00Z');
      const receipts: ReceiptDocument[] = [
        { 
          ...baseReceipt, transactionDate: '2026-08-05', printedGrandTotal: 300,
          items: [
            { id: 'i1', userEdited: false, name: 'A', lineTotal: 100, category: 'Food' },
            { id: 'i2', userEdited: false, name: 'B', lineTotal: 200, category: 'Food' }
          ] 
        },
        { 
          ...baseReceipt, transactionDate: '2026-08-06', printedGrandTotal: 100,
          items: [
            { id: 'i3', userEdited: false, name: 'C', lineTotal: 50, category: 'Transport' },
            { id: 'i4', userEdited: false, name: 'D', lineTotal: null } 
          ] 
        },
      ];

      const summary = calculateDashboardSummary(receipts, refDate);
      const foodCat = summary.categoryComposition.find(c => c.name === 'Food');
      const transportCat = summary.categoryComposition.find(c => c.name === 'Transport');
      const unalloc = summary.categoryComposition.find(c => c.name === 'Adjustments / Unallocated');
      
      assert.strictEqual(foodCat?.total, 300);
      assert.strictEqual(transportCat?.total, 50);
      assert.strictEqual(unalloc?.total, 50); // 100 total - 50 known
    });

    test('handles merchant reports and item reports correctly', () => {
      const receipts: ReceiptDocument[] = [
        {
          ...baseReceipt,
          transactionDate: '2026-08-01',
          merchantNormalized: 'Carrefour',
          printedGrandTotal: 5000,
          items: [
            { id: '1', userEdited: false, name: 'Oil 5L', lineTotal: 3000, quantity: 1, category: 'Groceries' },
            { id: '2', userEdited: false, name: 'Rice 5kg', lineTotal: 2000, quantity: 1, category: 'Groceries' }
          ]
        },
        {
          ...baseReceipt,
          transactionDate: '2026-08-05',
          merchantNormalized: 'Carrefour',
          printedGrandTotal: 2000,
          items: [
            { id: '3', userEdited: false, name: 'Oil 5L', lineTotal: 2000, quantity: 1, category: 'Groceries' }
          ]
        }
      ];

      const merchantReport = generateMerchantReport(receipts, { start: '2026-08-01', end: '2026-08-31' });
      assert.strictEqual(merchantReport.length, 1);
      assert.strictEqual(merchantReport[0].merchant, 'Carrefour');
      assert.strictEqual(merchantReport[0].total, 7000);
      assert.strictEqual(merchantReport[0].visits, 2);

      const itemReport = generateItemReport(receipts, { start: '2026-08-01', end: '2026-08-31' });
      const oilItem = itemReport.find(i => i.canonicalName === 'oil 5l');
      assert.ok(oilItem);
      assert.strictEqual(oilItem?.totalSpent, 5000);
      assert.strictEqual(oilItem?.occasions, 2);
    });

    test('monthly report aggregates breakdown by month key', () => {
      const receipts: ReceiptDocument[] = [
        { ...baseReceipt, transactionDate: '2026-01-15', printedGrandTotal: 1000 },
        { ...baseReceipt, transactionDate: '2026-01-20', printedGrandTotal: 2000 },
        { ...baseReceipt, transactionDate: '2026-02-10', printedGrandTotal: 4000 }
      ];

      const monthly = generateMonthlyReport(receipts, { start: '2026-01-01', end: '2026-02-28' });
      assert.strictEqual(monthly.length, 2);
      assert.strictEqual(monthly[0].month, '2026-01');
      assert.strictEqual(monthly[0].total, 3000);
      assert.strictEqual(monthly[1].month, '2026-02');
      assert.strictEqual(monthly[1].total, 4000);
    });
  });
}

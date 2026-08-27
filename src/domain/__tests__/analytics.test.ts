import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { 
  calculateDashboardSummary, 
  DateRangeFilter, 
  getDateRange,
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
    });

    test('calculates dashboard summary properly (current, previous, MTD, null exclusion)', () => {
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
      
      // Current total = 5000 + 2000 - 500 = 6500 (id 9 is excluded from sums)
      assert.strictEqual(summary.currentTotal, 6500);
      assert.strictEqual(summary.prevTotal, 4000);
      assert.strictEqual(summary.mtdPriorTotal, 3000);
      assert.strictEqual(summary.changeAbs, 2500);
      assert.strictEqual(summary.changePct, 62.5);
      assert.strictEqual(summary.pendingCount, 1);
      assert.strictEqual(summary.needsDateCount, 1);
      assert.strictEqual(summary.excludedNullCount, 1);
      assert.strictEqual(summary.receiptCount, 4); // id 1, 2, 8, 9 are this month
      assert.strictEqual(summary.averageReceiptValue, 2167); // 6500 / 3 valid receipts
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

import { expect, test } from '@playwright/test';
import path from 'node:path';

const receiptImagePath = path.resolve('public/pwa-192x192.png');
const extractionResponse = {
  isReceipt: true, documentWarnings: [], merchantRaw: null, merchantNormalized: 'Example Market', branchAddress: null,
  receiptNumber: null, transactionDate: '2026-08-28', transactionTime: null, dateAmbiguous: false, currency: 'PKR', paymentMethod: null,
  items: [{ id: 'responsive-item', rawLineText: 'Example item', name: null, brand: null, quantity: null, unit: null, unitPrice: null, discount: null, lineTotal: 12345, category: null, confidence: 0.8, userEdited: false, warnings: [] }],
  printedSubtotal: 12345, printedDiscount: null, printedTax: null, printedFees: null, printedRounding: null, printedGrandTotal: 12345,
  rawOcrText: 'EXAMPLE MARKET', overallConfidence: 0.8, ambiguousFields: [], extractionSchemaVersion: '2', extractionModel: 'test-model', extractionModelActual: 'test-model', extractionDurationMs: 12,
  computedLineTotal: 12345, computedExpectedTotal: 12345, discrepancy: 0, reconciliationStatus: 'matched', warnings: [],
};

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

test('mobile navigation keeps five primary destinations and routes secondary views through More', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(nav.getByRole('link')).toHaveCount(4);
  await expect(nav.getByRole('link', { name: 'Add Receipt' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'More' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);

  await nav.getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu', { name: 'More destinations' });
  await expect(menu.getByRole('menuitem', { name: 'Reports' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('AI Rotation Simulator')).toHaveCount(0);
  await expect(page.getByText('Test Gemini Extraction')).toHaveCount(0);
  await expect(page.getByText('Sync Diagnostic')).toHaveCount(0);
  await expect(page.getByText('v1.0.0-dev')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mobile reports summarize sparse data and keep tab navigation discoverable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/extract', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(extractionResponse) }));
  await signIn(page);
  await page.getByRole('link', { name: 'Add Receipt' }).click();
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').first().setInputFiles(receiptImagePath);
  await page.getByRole('link', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Confirm & Save' }).click();

  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Reports' }).click();
  await expect(page.getByText('Swipe to see all report views')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Monthly spending summary' })).toBeVisible();
  await expect(page.getByText('First month in this period')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);
});

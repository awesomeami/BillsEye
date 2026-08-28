import { expect, test } from '@playwright/test';
import path from 'node:path';

const receiptImagePath = path.resolve('public/pwa-192x192.png');

const extractionResponse = {
  isReceipt: true,
  documentWarnings: [],
  merchantRaw: null,
  merchantNormalized: 'Example Market',
  branchAddress: null,
  receiptNumber: null,
  transactionDate: '2026-08-28',
  transactionTime: null,
  dateAmbiguous: false,
  currency: 'PKR',
  paymentMethod: null,
  items: [{
    id: 'a11y-item', rawLineText: 'Accessible grocery item', name: null, brand: null,
    quantity: null, unit: null, unitPrice: null, discount: null, lineTotal: 12345,
    category: null, confidence: 0.8, userEdited: false, warnings: [],
  }],
  printedSubtotal: 12345, printedDiscount: null, printedTax: null, printedFees: null,
  printedRounding: null, printedGrandTotal: 12345, rawOcrText: 'EXAMPLE MARKET',
  overallConfidence: 0.8, ambiguousFields: [], extractionSchemaVersion: '2',
  extractionModel: 'test-model', extractionModelActual: 'test-model', extractionDurationMs: 12,
  computedLineTotal: 12345, computedExpectedTotal: 12345, discrepancy: 0,
  reconciliationStatus: 'matched', warnings: [],
};

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

async function openReview(page: import('@playwright/test').Page) {
  await page.route('**/api/extract', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(extractionResponse),
  }));
  await page.getByRole('link', { name: 'Add Receipt' }).first().click();
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').first().setInputFiles(receiptImagePath);
  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page.getByRole('heading', { name: 'Review Receipt' })).toBeVisible();
}

test('keyboard journey traps, restores, and exposes receipt-list sorting @a11y', async ({ page }) => {
  await signIn(page);
  await openReview(page);

  await page.getByLabel('Merchant (Raw)').fill('Unsaved keyboard edit');
  const reportsLink = page.getByRole('link', { name: 'Reports' });
  await reportsLink.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('alertdialog', { name: 'Discard unsaved receipt changes?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

  await dialog.getByRole('button', { name: 'Discard changes' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close confirmation' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(reportsLink).toBeFocused();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');

  await page.getByRole('button', { name: 'Confirm & Save' }).click();
  await page.getByRole('link', { name: 'Receipts' }).click();
  const dateHeader = page.getByRole('columnheader', { name: /Sort by date/ });
  await expect(dateHeader).toHaveAttribute('aria-sort', 'descending');
  await dateHeader.getByRole('button').press('Enter');
  await expect(dateHeader).toHaveAttribute('aria-sort', 'ascending');
});

test('mobile review controls stay usable without document overflow @a11y', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await openReview(page);

  for (const control of [
    page.getByRole('button', { name: 'Confirm & Save' }),
    page.getByRole('button', { name: 'Save Draft' }),
    page.getByRole('button', { name: 'Delete receipt' }),
    page.getByRole('button', { name: 'Add Item' }),
    page.getByRole('button', { name: 'Remove item 1' }),
  ]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
  }

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Delete receipt' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete Receipt' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Delete receipt' })).toBeFocused();
});

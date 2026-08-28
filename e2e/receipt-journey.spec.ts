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
    id: 'mock-item-1',
    rawLineText: 'Unclear grocery item',
    name: null,
    brand: null,
    quantity: null,
    unit: null,
    unitPrice: null,
    discount: null,
    lineTotal: 12345,
    category: null,
    confidence: 0.8,
    userEdited: false,
    warnings: [],
  }],
  printedSubtotal: 12345,
  printedDiscount: null,
  printedTax: null,
  printedFees: null,
  printedRounding: null,
  printedGrandTotal: 12345,
  rawOcrText: 'EXAMPLE MARKET',
  overallConfidence: 0.8,
  ambiguousFields: [],
  extractionSchemaVersion: '2',
  extractionModel: 'test-model',
  extractionModelActual: 'test-model',
  extractionDurationMs: 12,
  computedLineTotal: 12345,
  computedExpectedTotal: 12345,
  discrepancy: 0,
  reconciliationStatus: 'matched',
  warnings: [],
};

async function mockExtraction(page: import('@playwright/test').Page) {
  let authorization: string | undefined;
  await page.route('**/api/extract', async route => {
    authorization = route.request().headers().authorization;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(extractionResponse) });
  });
  return () => authorization;
}

test('mocked sign-in, upload, review, confirmation, dashboard and reports journey', async ({ page }) => {
  const getAuthorization = await mockExtraction(page);
  await page.goto('/login');

  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.getByRole('link', { name: 'Add Receipt' }).first().click();
  await expect(page.getByRole('heading', { name: 'Add Receipts' })).toBeVisible();
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').first().setInputFiles(receiptImagePath);

  const reviewLink = page.getByRole('link', { name: 'Review' });
  await expect(reviewLink).toBeVisible();
  expect(getAuthorization()).toBe('Bearer e2e-test-firebase-token');
  await reviewLink.click();
  await expect(page.getByRole('heading', { name: 'Review Receipt' })).toBeVisible();
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByText('Draft saved.').last()).toBeVisible();

  await page.getByRole('link', { name: 'Inbox' }).click();
  await expect(page.getByRole('heading', { name: 'AI Inbox' })).toBeVisible();
  await expect(page.getByText('Example Market')).toBeVisible();
  await page.getByRole('link', { name: 'Review Details' }).click();
  await expect(page.getByRole('heading', { name: 'Review Receipt' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm & Save' }).click();

  await page.getByRole('link', { name: 'Inbox' }).click();
  await expect(page.getByRole('heading', { name: "You're all caught up!" })).toBeVisible();

  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Example Market 2026-08-28/ })).toBeVisible();
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '2026-08', exact: true })).toBeVisible();
});

test('navigation, report keyboard tabs, labels, and destructive dialog accessibility smoke @a11y', async ({ page }) => {
  const getAuthorization = await mockExtraction(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();

  await page.getByRole('link', { name: 'Reports' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await page.getByRole('tab', { name: 'Monthly' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Categories' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('link', { name: 'Add Receipt' }).first().click();
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').first().setInputFiles(receiptImagePath);
  const reviewLink = page.getByRole('link', { name: 'Review' });
  await expect(reviewLink).toBeVisible();
  expect(getAuthorization()).toBe('Bearer e2e-test-firebase-token');
  await reviewLink.click();
  const grandTotal = page.getByLabel('Printed Grand Total');
  await grandTotal.fill('-');
  await grandTotal.blur();
  await expect(page.getByText('Enter a valid amount.')).toBeVisible();
  await page.getByRole('link', { name: 'Reports' }).click();
  const discardDialog = page.getByRole('alertdialog', { name: 'Discard unsaved receipt changes?' });
  await expect(discardDialog).toBeVisible();
  await expect(discardDialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Review Receipt' })).toBeVisible();
  await grandTotal.fill('123.45');
  await grandTotal.blur();
  await page.getByRole('button', { name: /Confirm & Save/ }).click();

  await page.getByRole('link', { name: 'Receipts' }).click();
  await page.getByRole('button', { name: 'View details for Example Market' }).click();
  await page.getByRole('button', { name: 'Delete Receipt' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete Receipt' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('a concurrent receipt update preserves local edits and retries against the latest revision', async ({ page }) => {
  await mockExtraction(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.getByRole('link', { name: 'Add Receipt' }).first().click();
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').first().setInputFiles(receiptImagePath);
  await page.getByRole('link', { name: 'Review' }).click();

  const merchant = page.getByLabel('Merchant (Raw)');
  await merchant.fill('Local edit');
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __E2E_FORCE_RECEIPT_CONFLICT__?: boolean }).__E2E_FORCE_RECEIPT_CONFLICT__ = true;
  });
  await page.getByRole('button', { name: 'Save Draft' }).click();

  const conflict = page.getByRole('alertdialog', { name: 'Receipt changed elsewhere' });
  await expect(conflict).toBeVisible();
  await expect(conflict.getByText(/Your edits are still preserved/)).toBeVisible();
  await conflict.getByRole('button', { name: 'Keep my edits' }).click();
  await expect(merchant).toHaveValue('Local edit');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
});

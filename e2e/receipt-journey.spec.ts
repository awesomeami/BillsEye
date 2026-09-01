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
  await page.clock.setFixedTime(new Date('2026-08-28T12:00:00Z'));
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

  await page.getByRole('link', { name: 'Receipts' }).click();
  const receiptDetailsTrigger = page.getByRole('button', { name: 'View details for Example Market' });
  await receiptDetailsTrigger.click();
  await expect(page.getByRole('dialog', { name: 'Receipt Details' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(receiptDetailsTrigger).toBeFocused();

  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Example Market 2026-08-28/ })).toBeVisible();
  await expect(page.getByLabel('Dashboard date range')).toHaveValue('this_month');
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

test('the in-memory queue continues across app navigation and releases an item on review', async ({ page }) => {
  await mockExtraction(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.getByRole('link', { name: 'Add Receipt' }).first().click();
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').first().setInputFiles(receiptImagePath);

  await expect(page.getByRole('link', { name: 'Review' })).toBeVisible();
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.getByRole('link', { name: 'Add Receipt' }).first().click();
  const review = page.getByRole('link', { name: 'Review' });
  await expect(review).toBeVisible();
  await review.click();
  await expect(page.getByRole('heading', { name: 'Review Receipt' })).toBeVisible();

  await page.getByRole('link', { name: 'Add Receipt' }).first().click();
  await expect(page.getByText('Privacy & Memory Notice')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review' })).toHaveCount(0);
});

test('restricted localStorage does not prevent mock-mode startup', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new DOMException('Blocked by browser policy', 'SecurityError'); },
    });
  });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
});

test('shared-device cache settings require confirmation and reflect real connectivity transitions', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();

  const trustedDevice = page.getByLabel('This is a trusted device');
  await trustedDevice.click();
  const confirmation = page.getByRole('alertdialog', { name: 'Enable trusted-device cache?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await expect(trustedDevice).not.toBeChecked();

  const clearOnSignOut = page.getByLabel(/Clear offline data when signing out/);
  await clearOnSignOut.check();
  await expect(clearOnSignOut).toBeChecked();

  await page.context().setOffline(true);
  await expect(page.getByRole('status')).toContainText('Offline');
  await page.context().setOffline(false);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('a historical receipt populates the overview and every report without changing its date', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-01T12:00:00Z'));
  const historicalReceipt = {
    ...extractionResponse,
    transactionDate: '2022-01-30',
    merchantNormalized: 'Al-Shaheer Corporation Ltd.',
    printedSubtotal: null,
    printedGrandTotal: 50900,
    computedLineTotal: 50893,
    computedExpectedTotal: 50900,
    items: [{ ...extractionResponse.items[0], name: 'Chicken', rawLineText: 'Chicken', quantity: 0.994, unit: 'kg', unitPrice: 51200, lineTotal: 50893, category: 'Meat' }],
  };
  await page.route('**/api/extract', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(historicalReceipt) }));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.getByRole('link', { name: 'Add Receipt' }).first().click();
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').first().setInputFiles(receiptImagePath);
  await page.getByRole('link', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Confirm & Save' }).click();
  await page.getByRole('link', { name: 'Home' }).click();

  await expect(page.getByLabel('Dashboard date range')).toHaveValue('all_time');
  await expect(page.getByText('Total Spent (All Time)').locator('..').locator('..')).toContainText('Rs 509');
  await expect(page.getByText('1 confirmed receipt across all dates.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Al-Shaheer Corporation Ltd. 2022-01-30/ })).toBeVisible();
  await expect(page.getByText('Chicken', { exact: true })).toBeVisible();
  await expect(page.getByText(/You've recorded Rs\s+509/)).toBeVisible();
  await expect(page.getByText('Add a receipt with categories to see your spending mix.')).toHaveCount(0);

  await page.getByLabel('Dashboard date range').selectOption('this_month');
  await expect(page.getByText('Total Spent (This Month)').locator('..').locator('..')).toContainText('Rs 0');
  await expect(page.getByText('No confirmed receipts dated this month')).toBeVisible();
  await page.getByLabel('Dashboard date range').selectOption('all_time');
  await expect(page.getByText('1 confirmed receipt across all dates.')).toBeVisible();

  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByLabel('Report date range')).toHaveValue('all_time');
  await expect(page.getByRole('row').filter({ has: page.getByRole('cell', { name: '2022-01', exact: true }) })).toContainText('Rs 509');
  await page.getByLabel('Report date range').selectOption('this_year');
  await expect(page.getByRole('cell', { name: '2022-01', exact: true })).toHaveCount(0);
  await page.getByLabel('Report date range').selectOption('all_time');
  await page.getByRole('tab', { name: 'Categories' }).click();
  await expect(page.getByRole('cell', { name: 'Meat', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Merchants' }).click();
  await expect(page.getByRole('cell', { name: 'Al-Shaheer Corporation Ltd.', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Items', exact: true }).click();
  await expect(page.getByRole('button', { name: /Expand details for chicken/i })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('cloud synchronization clears on metadata-only acknowledgements for both receipt streams', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  const metadata = async (source: 'confirmed' | 'pending', fromCache: boolean, hasPendingWrites = false) => {
    await page.evaluate(detail => window.dispatchEvent(new CustomEvent('kharchalens:e2e-receipt-metadata', { detail })), { source, fromCache, hasPendingWrites });
  };
  await metadata('confirmed', true);
  await metadata('pending', true);
  await expect(page.getByRole('status')).toContainText('Synchronizing with the cloud');
  await metadata('confirmed', false);
  await expect(page.getByRole('status')).toContainText('Synchronizing with the cloud');
  await metadata('pending', false);
  await expect(page.getByRole('status')).toHaveCount(0);
  await metadata('confirmed', false, true);
  await expect(page.getByRole('status')).toContainText('waiting to sync');
  await metadata('confirmed', false);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('an available PWA update waits for memory-only queue work and dirty receipt edits', async ({ page }) => {
  await mockExtraction(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.getByRole('link', { name: 'Add Receipt' }).first().click();
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').first().setInputFiles(receiptImagePath);
  await expect(page.getByRole('link', { name: 'Review' })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('kharchalens:e2e-pwa-update-ready')));
  const updatePrompt = page.getByRole('status', { name: 'Application update available' });
  const updateButton = updatePrompt.getByRole('button', { name: 'Reload to update' });
  await expect(updatePrompt).toContainText('queued receipt processing');
  await expect(updateButton).toBeDisabled();

  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page.getByRole('heading', { name: 'Review Receipt' })).toBeVisible();
  await expect(updateButton).toBeEnabled();

  await page.getByLabel('Merchant (Raw)').fill('Unsaved update guard');
  await expect(updatePrompt).toContainText('receipt edits');
  await expect(updateButton).toBeDisabled();
});

test('AI key settings save browser-local keys without a passphrase gate', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'AI Configuration' }).click();

  await expect(page.getByRole('heading', { name: 'AI Configuration' })).toBeVisible();
  await expect(page.getByText(/passphrase/i)).toHaveCount(0);
  await page.getByRole('button', { name: /Add Key/ }).click();
  await expect(page.getByText('No passphrase is required.')).toBeVisible();
});

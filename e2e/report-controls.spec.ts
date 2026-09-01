import { expect, test } from '@playwright/test';

test('table sorting, custom date ranges, and receipt search spacing work together', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-02T12:00:00+05:00'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.evaluate(() => {
    const target = window as typeof window & { __KHARCHALENS_E2E_SEED_RECEIPTS__?: (count: number) => void };
    target.__KHARCHALENS_E2E_SEED_RECEIPTS__?.(3);
  });

  await page.getByLabel('Dashboard date range').selectOption('custom');
  await expect(page.getByLabel('Dashboard date range start')).toHaveValue('2026-09-01');
  await expect(page.getByLabel('Dashboard date range end')).toHaveValue('2026-09-02');
  await page.getByLabel('Dashboard date range start').fill('2026-08-01');
  await page.getByLabel('Dashboard date range end').fill('2026-08-02');
  await expect(page.getByText('2 confirmed receipts within the selected dates.')).toBeVisible();

  await page.getByRole('link', { name: 'Receipts' }).click();
  const receiptSearch = page.getByRole('textbox', { name: 'Search receipts' });
  const searchGeometry = await receiptSearch.evaluate(input => {
    const inputBox = input.getBoundingClientRect();
    const iconBox = input.parentElement?.querySelector('svg')?.getBoundingClientRect();
    return {
      paddingLeft: Number.parseFloat(getComputedStyle(input).paddingLeft),
      iconRightWithinInput: iconBox ? iconBox.right - inputBox.left : null,
    };
  });
  expect(searchGeometry.paddingLeft).toBeGreaterThanOrEqual(40);
  expect(searchGeometry.iconRightWithinInput).not.toBeNull();
  expect(searchGeometry.paddingLeft).toBeGreaterThan(searchGeometry.iconRightWithinInput!);

  const categoryHeader = page.getByRole('columnheader', { name: /sort by categories/i });
  await expect(categoryHeader).toHaveAttribute('aria-sort', 'none');
  await categoryHeader.getByRole('button').click();
  await expect(categoryHeader).toHaveAttribute('aria-sort', 'ascending');

  await page.getByRole('link', { name: 'Reports' }).click();
  await page.getByLabel('Report date range').selectOption('custom');
  await expect(page.getByLabel('Report date range start')).toHaveValue('2026-09-01');
  await expect(page.getByLabel('Report date range end')).toHaveValue('2026-09-02');
  await page.getByLabel('Report date range start').fill('2026-08-01');
  await page.getByLabel('Report date range end').fill('2026-08-02');

  await page.getByRole('tab', { name: 'Merchants' }).click();
  const merchantHeader = page.getByRole('columnheader', { name: /sort by merchant/i });
  await expect(merchantHeader).toHaveAttribute('aria-sort', 'none');
  await merchantHeader.getByRole('button').click();
  await expect(merchantHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('Performance Merchant 000');
  await merchantHeader.getByRole('button').click();
  await expect(merchantHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('Performance Merchant 001');

  await page.getByRole('tab', { name: 'Items', exact: true }).click();
  for (const label of ['Canonical Item', 'Total Spent', 'Unit Price (Latest)', 'Change', 'Occasions']) {
    await expect(page.getByRole('button', { name: new RegExp(`Sort by ${label.replace(/[()]/g, '\\$&')}`) })).toBeVisible();
  }
});

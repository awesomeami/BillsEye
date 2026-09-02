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

  await page.getByLabel('Recent activity date range').selectOption('custom');
  await expect(page.getByLabel('Recent activity date range start')).toHaveValue('2026-09-01');
  await expect(page.getByLabel('Recent activity date range end')).toHaveValue('2026-09-02');
  await page.getByLabel('Recent activity date range start').fill('2026-08-01');
  await page.getByLabel('Recent activity date range end').fill('2026-08-02');
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

test('phones and tablets expose every date preset and every sortable table column', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-02T12:00:00+05:00'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.evaluate(() => {
    const target = window as typeof window & { __KHARCHALENS_E2E_SEED_RECEIPTS__?: (count: number) => void };
    target.__KHARCHALENS_E2E_SEED_RECEIPTS__?.(3);
  });

  const expectedDateOptions = [
    'This Month',
    'Last Month',
    'Last 3 Months',
    'This Year',
    'All Time',
    'Custom Range',
  ];
  const viewports = [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
  ];
  const dashboardRangeLabels = [
    'Total spent date range',
    'Recent activity date range',
    'Category composition date range',
    'Daily spending trend date range',
    'Top merchants date range',
    'Top items date range',
    'Recent receipts date range',
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.getByLabel('Dashboard date range')).toHaveCount(0);
    for (const label of dashboardRangeLabels) {
      await expect(page.getByLabel(label).locator('option')).toHaveText(expectedDateOptions);
    }
    const totalRange = page.getByLabel('Total spent date range');
    const categoryRange = page.getByLabel('Category composition date range');
    await totalRange.selectOption('last_month');
    await expect(totalRange).toHaveValue('last_month');
    await expect(categoryRange).toHaveValue('all_time');
    await totalRange.selectOption('all_time');

    await page.getByRole('link', { name: 'Receipts', exact: true }).click();
    for (const label of ['date', 'merchant', 'categories', 'total']) {
      const header = page.getByRole('columnheader', { name: new RegExp(`Sort by ${label}`, 'i') });
      await expect(header).toBeVisible();
      await header.getByRole('button').click();
      await expect(header).not.toHaveAttribute('aria-sort', 'none');
    }

    const reportsLink = page.getByRole('link', { name: 'Reports', exact: true });
    if (await reportsLink.count() > 0) {
      await reportsLink.click();
    } else {
      await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'More' }).click();
      await page.getByRole('menuitem', { name: 'Reports' }).click();
    }
    await expect(page.getByLabel('Report date range').locator('option')).toHaveText(expectedDateOptions);
    const reportTables = [
      { tab: 'Monthly', columns: ['Month', 'Total', 'Receipts', 'Average', 'Change'] },
      { tab: 'Categories', columns: ['Category', 'Total', '% of Gross Spend', 'Contained in Receipts'] },
      { tab: 'Merchants', columns: ['Merchant', 'Total Spent', 'Visits', 'Average Basket', 'First Purchase', 'Last Purchase'] },
      { tab: 'Items', columns: ['Canonical Item', 'Total Spent', 'Unit Price (Latest)', 'Change', 'Occasions'] },
    ];

    for (const report of reportTables) {
      await page.getByRole('tab', { name: report.tab, exact: true }).click();
      for (const label of report.columns) {
        const header = page.getByRole('columnheader', {
          name: new RegExp(`Sort by ${label.replace(/[()]/g, '\\$&')}`, 'i'),
        });
        await expect(header).toBeVisible();
        await header.getByRole('button').click();
        await expect(header).not.toHaveAttribute('aria-sort', 'none');
      }
    }

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

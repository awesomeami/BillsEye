import { expect, test } from '@playwright/test';

test('large mobile receipt library progressively renders and keeps its keyboard journey', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL('/');

  await page.evaluate(() => {
    const target = window as typeof window & { __KHARCHALENS_E2E_SEED_RECEIPTS__?: (count: number) => void };
    target.__KHARCHALENS_E2E_SEED_RECEIPTS__?.(240);
  });
  await page.getByRole('link', { name: 'Receipts' }).click();
  await expect(page).toHaveURL('/receipts');

  const receiptRows = page.getByRole('button', { name: /^View details for Performance Merchant/ });
  await expect(receiptRows).toHaveCount(50);
  await expect(page.getByText('Showing 50 of 240 receipts')).toBeVisible();

  await page.getByRole('button', { name: 'Show 50 more receipts' }).click();
  await expect(receiptRows).toHaveCount(100);
  await expect(page.getByText('Showing 100 of 240 receipts')).toBeVisible();

  const search = page.getByRole('textbox', { name: 'Search receipts' });
  await search.fill('Performance Merchant 239');
  await expect(search).toHaveValue('Performance Merchant 239');
  await expect(receiptRows).toHaveCount(1);

  const result = page.getByRole('button', { name: 'View details for Performance Merchant 239' });
  await result.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Receipt Details' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Receipt Details' })).toBeHidden();
  await expect(result).toBeFocused();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasHorizontalOverflow).toBe(false);
});

import { expect, test } from '@playwright/test';

test('BillsEye exposes a visible browser-tab icon and installed-app artwork', async ({ page }) => {
  await page.goto('/login');

  await expect(page).toHaveTitle('BillsEye');
  await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1);
  await expect(page.locator('link[rel="icon"][href="/favicon-32x32.png"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"][href="/apple-touch-icon.png"]')).toHaveCount(1);
  await expect(page.locator('img[src="/pwa-192x192.png"]')).toBeVisible();

  const decodedAssets = await page.evaluate(async () => {
    const dimensions = async (src: string) => new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error(`Could not load ${src}`));
      image.src = src;
    });

    return Promise.all([
      dimensions('/favicon-32x32.png'),
      dimensions('/apple-touch-icon.png'),
      dimensions('/pwa-192x192.png'),
      dimensions('/pwa-512x512.png'),
    ]);
  });

  expect(decodedAssets).toEqual([
    { width: 32, height: 32 },
    { width: 180, height: 180 },
    { width: 192, height: 192 },
    { width: 512, height: 512 },
  ]);
});

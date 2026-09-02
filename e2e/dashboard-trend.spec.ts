import { expect, test } from '@playwright/test';

test('daily spending uses elapsed-time spacing, full years, and a live mobile brush', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.evaluate(() => {
    const target = window as typeof window & {
      __KHARCHALENS_E2E_SEED_TREND__?: (points: Array<{ date: string; total: number }>) => void;
    };
    target.__KHARCHALENS_E2E_SEED_TREND__?.([
      { date: '2025-04-21', total: 50_000 },
      { date: '2022-01-10', total: 10_000 },
      { date: '2023-01-10', total: 30_000 },
      { date: '2022-01-10', total: 20_000 },
    ]);
  });

  const trend = page.getByRole('region', { name: 'Daily Spending Trend' });
  await expect(trend.getByLabel('Selected trend date range')).toContainText('2022');
  await expect(trend.getByLabel('Selected trend date range')).toContainText('2025');

  const axisTicks = (await trend.locator('svg text').allTextContents())
    .filter(label => /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(label));
  expect(axisTicks.length).toBeGreaterThan(0);
  expect(axisTicks.every(label => /\b\d{4}\b/.test(label))).toBe(true);
  expect(axisTicks.some(label => label.includes('2025'))).toBe(true);

  const dots = trend.locator('.recharts-line-dots circle');
  await expect(dots).toHaveCount(3);
  const xPositions = await dots.evaluateAll(elements => elements.map(element => Number(element.getAttribute('cx'))));
  expect(xPositions[2] - xPositions[1]).toBeGreaterThan((xPositions[1] - xPositions[0]) * 1.5);

  const plotBounds = await trend.locator('clipPath rect').first().evaluate(element => ({
    left: Number(element.getAttribute('x')),
    right: Number(element.getAttribute('x')) + Number(element.getAttribute('width')),
  }));
  const endpointBounds = await dots.evaluateAll(elements => [elements[0], elements[elements.length - 1]].map(element => {
    const radius = Number(element.getAttribute('r'));
    const strokeWidth = Number(getComputedStyle(element).strokeWidth.replace('px', '')) || 0;
    const outerRadius = radius + (strokeWidth / 2);
    const center = Number(element.getAttribute('cx'));
    return { left: center - outerRadius, right: center + outerRadius };
  }));
  expect(endpointBounds[0].left).toBeGreaterThanOrEqual(plotBounds.left);
  expect(endpointBounds[1].right).toBeLessThanOrEqual(plotBounds.right);

  await dots.nth(2).hover();
  await expect(trend.getByText(/Date:.*2025/)).toBeVisible();

  const travellers = trend.locator('.recharts-brush-traveller');
  await expect(travellers).toHaveCount(2);
  for (const traveller of await travellers.all()) {
    const box = await traveller.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await travellers.last().focus();
  const brushLabels = trend.locator('.recharts-brush-texts text');
  await expect(brushLabels).toHaveCount(2);
  const chartBounds = await trend.locator('svg.recharts-surface').boundingBox();
  expect(chartBounds).not.toBeNull();
  for (const label of await brushLabels.all()) {
    const labelBounds = await label.boundingBox();
    expect(labelBounds).not.toBeNull();
    expect(labelBounds!.x).toBeGreaterThanOrEqual(chartBounds!.x);
    expect(labelBounds!.x + labelBounds!.width).toBeLessThanOrEqual(chartBounds!.x + chartBounds!.width);
  }

  const originalRange = await trend.getByLabel('Selected trend date range').textContent();
  const leftHandle = await travellers.first().boundingBox();
  expect(leftHandle).not.toBeNull();
  await page.mouse.move(leftHandle!.x + (leftHandle!.width / 2), leftHandle!.y + (leftHandle!.height / 2));
  await page.mouse.down();
  await page.mouse.move(leftHandle!.x + 170, leftHandle!.y + (leftHandle!.height / 2), { steps: 12 });
  await page.mouse.up();
  await expect(trend.getByLabel('Selected trend date range')).not.toHaveText(originalRange ?? '');
  await expect(trend.getByLabel('Selected trend date range')).toContainText('2023');
  await expect(dots).toHaveCount(2);

  const narrowedRange = await trend.getByLabel('Selected trend date range').textContent();
  const selectedWindow = await trend.locator('.recharts-brush-slide').boundingBox();
  const narrowedLeftHandle = await travellers.first().boundingBox();
  expect(selectedWindow).not.toBeNull();
  expect(narrowedLeftHandle).not.toBeNull();
  const panDistance = leftHandle!.x - narrowedLeftHandle!.x;
  await page.mouse.move(selectedWindow!.x + (selectedWindow!.width / 2), selectedWindow!.y + (selectedWindow!.height / 2));
  await page.mouse.down();
  await page.mouse.move(selectedWindow!.x + (selectedWindow!.width / 2) + panDistance, selectedWindow!.y + (selectedWindow!.height / 2), { steps: 12 });
  await page.mouse.up();
  await expect(trend.getByLabel('Selected trend date range')).not.toHaveText(narrowedRange ?? '');
  await expect(trend.getByLabel('Selected trend date range')).toContainText('2022');
  await expect(dots).toHaveCount(2);

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

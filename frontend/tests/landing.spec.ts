import { expect, test } from '@playwright/test';
import { mockCloud } from './helpers/cloud';

test('public homepage explains the workflow and opens a blank guest planner', async ({ page }, testInfo) => {
  await mockCloud(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Get relief supplies where they’re needed.');
  const photo = page.getByRole('img', { name: /Volunteers packing blankets/ });
  await expect.poll(() => photo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('landing-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: 'See an example' }).click();
  const preview = page.locator('.landing-preview');
  await expect(preview.getByText('$156', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Supplier runs short' }).click();
  await expect(preview.getByText('$104', { exact: true })).toBeVisible();
  await expect(preview.getByText('8 thermal blankets')).toBeVisible();
  await page.getByRole('button', { name: 'Shelter budget drops' }).click();
  await expect(preview.getByText('$117', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('landing-mobile-dark.png'), fullPage: true });
  await page.getByRole('link', { name: 'Try the planner' }).first().click();
  await expect(page.getByRole('heading', { name: 'Start a relief operation' })).toBeVisible();
  await expect(page.getByLabel('Households to supply')).toHaveValue('');
});

test('homepage sign-in opens the workspace sign-in page', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to ReliefOps' })).toBeVisible();
});

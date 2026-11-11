import { test, expect } from '@playwright/test';
import { startGuestPlan } from './helpers/setup';

test.use({ colorScheme: 'light' });

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} theme covers authentication, dashboard, table, and plan dialog`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/?workspace=1');
    await expect(page.getByRole('heading', { name: 'Sign in to ReliefOps' })).toBeVisible();
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.google-button')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(17, 17, 20)' : 'rgb(255, 255, 255)');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `../design/previews/signin-${theme}.png`, fullPage: true, animations: 'disabled' });
    await startGuestPlan(page);
    await expect(page.getByRole('heading', { name: 'Operation overview' })).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(9, 9, 11)' : 'rgb(255, 255, 255)');
    await page.screenshot({ path: `../design/previews/overview-${theme}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Supplier offers', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Withdraw Harbor Essentials Thermal blanket' })).toBeVisible();
    await page.screenshot({ path: `../design/previews/suppliers-${theme}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Purchasing plan' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('background-color', theme === 'dark' ? 'rgb(17, 17, 20)' : 'rgb(255, 255, 255)');
    await expect(dialog.getByText('$1,440', { exact: true })).toBeVisible();
  });

  test(`${theme} theme fits mobile without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?workspace=1');
    await expect(page.getByRole('heading', { name: 'Sign in to ReliefOps' })).toBeVisible();
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await startGuestPlan(page);
    await expect(page.getByRole('heading', { name: 'Operation overview' })).toBeVisible();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await expect(page.getByRole('button', { name: 'Generate purchasing plan' })).toBeInViewport();
    await page.screenshot({ path: `../design/previews/mobile-${theme}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Open integration setup' }).click();
    await expect(page.getByRole('dialog', { name: 'Integration setup' })).toBeVisible();
  });
}

test('theme preference survives refresh and can be changed again', async ({ page }) => {
  await page.goto('/?workspace=1');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

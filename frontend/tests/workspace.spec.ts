import { test, expect, type Page } from '@playwright/test';
import { startGuestPlan } from './helpers/setup';

async function openSample(page: Page) {
  await page.goto('/?workspace=1');
  await startGuestPlan(page);
}

test('calculate, withdraw a supplier, and replan using the real API', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await openSample(page);
  await expect(page.getByRole('heading', { name: 'Operation overview' })).toBeVisible();
  await page.screenshot({ path: '../.tools/workspace-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Generate purchasing plan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Purchasing plan' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('$1,440', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Sign in to approve purchases')).toBeVisible();
  await page.getByRole('button', { name: 'Back to workspace' }).click();
  await page.getByRole('button', { name: 'Supplier offers', exact: false }).click();
  await page.getByRole('button', { name: 'Withdraw Harbor Essentials Thermal blanket' }).click();
  await expect(page.getByRole('status')).toContainText('out of date');
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('$1,530', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Northstar Relief Goods · 60 units')).toBeVisible();
});

test('fund restrictions produce a visible partial result', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: 'Funding', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Emergency reserve amount' }).fill('0');
  await page.getByRole('button', { name: 'Generate plan with these funds' }).click();
  const dialog = page.getByRole('dialog', { name: 'Purchasing plan' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Supplies still needed')).toBeVisible();
  await expect(dialog.getByText('$0', { exact: true })).toBeVisible();
});

test('mobile navigation and setup dialog work without credentials', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSample(page);
  await expect(page.getByRole('heading', { name: 'Operation overview' })).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: '../.tools/workspace-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open integration setup' }).click();
  await expect(page.getByRole('dialog', { name: 'Integration setup' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Changes in this session' })).toBeVisible();
});

test('modal contains keyboard focus and restores it on close', async ({ page }) => {
  await openSample(page);
  const opener = page.getByRole('button', { name: 'Open integration setup' });
  await opener.click();
  const close = page.getByRole('button', { name: 'Close integration setup' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Got it' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('API failures show a recoverable error rather than a fabricated plan', async ({ page }) => {
  await page.route('**/api/plan', route => route.abort());
  await openSample(page);
  await page.getByRole('button', { name: 'Generate purchasing plan' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not reach the planner');
  await expect(page.getByRole('dialog', { name: 'Purchasing plan' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate purchasing plan' })).toBeEnabled();
});

import { test, expect } from '@playwright/test';
import { startGuestPlan } from './helpers/setup';
import { mockCloud, signIn } from './helpers/cloud';

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

test('sign-in fits desktop and mobile and reveals both themes', async ({ page }, testInfo) => {
  await mockCloud(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?workspace=1');
  await expect(page.getByRole('heading', { name: 'Sign in to ReliefOps' })).toBeVisible();
  const root = page.locator('html');
  await expect(root).toHaveJSProperty('scrollHeight', 900);
  await page.screenshot({ path: testInfo.outputPath('sign-in-light.png') });
  for (const theme of ['dark', 'light'] as const) {
    await page.getByRole('button', { name: `Switch to ${theme} theme` }).click();
    await expect.poll(() => page.evaluate(() => document.getAnimations().some(animation =>
      animation instanceof CSSAnimation && animation.animationName === 'theme-reveal',
    ))).toBe(true);
    await expect(root).toHaveAttribute('data-theme', theme);
    await expect(root).not.toHaveAttribute('data-theme-reveal', '');
    if (theme === 'dark') await page.screenshot({ path: testInfo.outputPath('sign-in-dark.png') });
  }
  for (const viewport of [{ width: 1366, height: 680 }, { width: 390, height: 760 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(viewport);
    await expect(root).toHaveJSProperty('scrollHeight', viewport.height);
    await expect(root).toHaveJSProperty('scrollWidth', viewport.width);
    await expect(page.getByRole('button', { name: 'Start without signing in' })).toBeInViewport();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).not.toHaveAttribute('data-theme-reveal', '');
  await page.screenshot({ path: testInfo.outputPath('sign-in-mobile.png') });
});

test('dashboard theme switch reveals both themes and respects reduced motion', async ({ page }) => {
  await mockCloud(page);
  await signIn(page);
  const root = page.locator('html');
  for (const theme of ['dark', 'light']) {
    await page.getByRole('button', { name: `Switch to ${theme} theme` }).click();
    await expect.poll(() => page.evaluate(() => document.getAnimations().some(animation =>
      animation instanceof CSSAnimation && animation.animationName === 'theme-reveal',
    ))).toBe(true);
    await expect(root).toHaveAttribute('data-theme', theme);
    await expect(root).not.toHaveAttribute('data-theme-reveal', '');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).not.toHaveAttribute('data-theme-reveal', '');
});

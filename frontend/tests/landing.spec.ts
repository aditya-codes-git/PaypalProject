import { expect, test } from '@playwright/test';
import { mockCloud } from './helpers/cloud';

test('public homepage explains the workflow and opens a blank guest planner', async ({ page }, testInfo) => {
  await mockCloud(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan what to buy. Know who it reaches.');
  for (const theme of ['dark', 'light']) {
    await page.getByRole('button', { name: `Switch to ${theme} theme` }).click();
    await expect.poll(() => page.evaluate(() => document.getAnimations().some(animation =>
      animation instanceof CSSAnimation && animation.animationName === 'theme-reveal',
    ))).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-reveal', '');
  }
  const kit = page.locator('.landing-kit');
  await expect.poll(() => kit.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const artwork = page.locator('.landing-hero-art');
  const header = page.getByRole('banner');
  const desktopGap = (await header.boundingBox())!.y;
  expect(desktopGap).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 220));
  await expect(artwork).not.toHaveCSS('transform', 'none');
  await expect.poll(async () => (await header.boundingBox())?.y).toBe(desktopGap);
  const blanket = page.locator('.landing-workflow-art img');
  await blanket.scrollIntoViewIfNeeded();
  await expect.poll(() => blanket.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('landing-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'See an example' }).click();
  const preview = page.locator('.landing-preview');
  await expect(preview.getByText('$156', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Supplier runs short' }).click();
  await expect(preview.getByText('$104', { exact: true })).toBeVisible();
  await expect(preview.getByText('8 thermal blankets')).toBeVisible();
  await page.getByRole('button', { name: 'Shelter budget drops' }).click();
  await expect(preview.getByText('$117', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cheaper supplier arrives late' }).click();
  await expect(preview.getByText('$168', { exact: true })).toBeVisible();
  await expect(preview.getByText('Northstar Relief Goods · Shelter fund')).toBeVisible();
  await expect(preview.getByRole('status')).toContainText('12 of 12 households covered');
  await page.getByText('How does ReliefOps use AI?', { exact: true }).click();
  await expect(page.getByText(/You review the source and confirm the terms/)).toBeVisible();
  const footer = page.getByRole('contentinfo');
  await footer.getByRole('link', { name: 'PayPal checkout' }).click();
  await expect(page).toHaveURL(/#paypal$/);
  const headerBottom = desktopGap + (await header.boundingBox())!.height;
  const paypalHeading = page.getByRole('heading', { name: 'Follow a purchase from grant to payment.' });
  await expect.poll(async () => (await paypalHeading.boundingBox())?.y).toBeGreaterThan(headerBottom);
  await expect(page.getByText('Scroll to move through checkout')).toBeInViewport();
  const purchase = page.getByRole('article', { name: 'Sample purchase' });
  await expect(purchase.getByRole('status')).toContainText('$96.00 reserved. $0.00 spent.');
  const { start, stops } = await page.locator('.landing-paypal-track').evaluate(track => {
    const scene = track.firstElementChild as HTMLElement;
    const start = window.scrollY + track.getBoundingClientRect().top - parseFloat(getComputedStyle(scene).top);
    const travel = track.clientHeight - scene.offsetHeight;
    return { start, stops: [0.38, 0.63, 0.88].map(progress => start + travel * progress) };
  });
  await page.evaluate(top => window.scrollTo({ top }), start + 30);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(start + 350);
  await expect(page.getByText('Step 1 of 4', { exact: true })).toBeInViewport();
  for (const [index, status] of ['Awaiting buyer approval', 'Paid in sandbox', 'Ready for delivery'].entries()) {
    await page.evaluate(top => window.scrollTo({ top }), stops[index]);
    await expect(purchase.getByRole('status')).toContainText(status);
    await expect(page.locator('.landing-paypal-inner')).toBeInViewport({ ratio: 0.9 });
    await expect.poll(async () => (await page.locator('.landing-paypal-inner').boundingBox())?.y).toBeGreaterThan(headerBottom);
  }
  await page.evaluate(top => window.scrollTo({ top }), stops[0]);
  await expect(purchase.getByRole('status')).toContainText('Awaiting buyer approval');
  await page.getByRole('button', { name: 'Approve in PayPal' }).click();
  await expect(purchase.getByRole('status')).toContainText('Awaiting buyer approval');
  await page.getByRole('button', { name: 'Confirm the payment' }).click();
  await expect(purchase.getByRole('status')).toContainText('$0.00 reserved. $96.00 spent.');
  await page.getByRole('button', { name: 'Keep the purchase record' }).click();
  await expect(purchase.getByText(/export the record as a PDF/)).toBeVisible();
  await footer.getByRole('link', { name: 'Purchase records' }).click();
  await expect(page).toHaveURL(/#records$/);
  await expect(page.getByText('Sample delivery receipt')).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', 'https://github.com/aditya-codes-git/PaypalProject');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(kit).toHaveCSS('opacity', '1');
  const mobileGap = (await header.boundingBox())!.y;
  expect(mobileGap).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 220));
  await expect(artwork).toHaveCSS('transform', 'none');
  await expect.poll(async () => (await header.boundingBox())?.y).toBe(mobileGap);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-reveal', '');
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

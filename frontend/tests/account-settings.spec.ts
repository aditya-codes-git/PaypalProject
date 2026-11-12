import { expect, test } from '@playwright/test';
import { mockCloud, signIn } from './helpers/cloud';

test('header stays pinned and desktop and mobile navigation can collapse', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 600 });
  await mockCloud(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Plan settings', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.locator('.topbar').evaluate(header => header.getBoundingClientRect().top)).toBe(0);
  await page.locator('#workspace-sidebar').evaluate(sidebar => {
    sidebar.addEventListener('transitionrun', event => {
      if (event instanceof TransitionEvent && event.target === sidebar) sidebar.setAttribute(`data-transition-${event.propertyName}`, 'true');
    });
  });
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.locator('#workspace-sidebar')).toHaveAttribute('data-transition-width', 'true');
  await expect(page.locator('#workspace-sidebar')).toHaveCSS('width', '68px');
  await expect(page.getByRole('button', { name: 'Funding', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('#workspace-sidebar')).toHaveCSS('width', '68px');
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.locator('#workspace-sidebar')).toHaveCSS('width', '236px');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#workspace-sidebar').evaluate(sidebar => {
    sidebar.addEventListener('transitionrun', event => {
      if (event instanceof TransitionEvent && event.target === sidebar && event.propertyName === 'transform') {
        sidebar.setAttribute('data-transition-transform', 'true');
      }
    });
  });
  await expect(page.locator('#workspace-sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.locator('#workspace-sidebar')).toHaveAttribute('data-transition-transform', 'true');
  await page.getByRole('button', { name: 'Funding', exact: true }).click();
  await expect(page.locator('#workspace-sidebar')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Manage funding' })).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#workspace-sidebar')).toHaveCSS('transition-duration', '0s');
});

test('profile exports data and deletes only after explicit account email confirmation', async ({ page }) => {
  await mockCloud(page);
  let attempted = 0;
  await page.route('**/api/account/export', route => route.fulfill({ json: { operations: [], plans: [], financial_records: [] } }));
  await page.route('**/api/account/delete', route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'coordinator@example.test' });
    attempted += 1;
    return attempted === 1
      ? route.fulfill({ status: 409, json: { detail: 'Resolve pending PayPal transactions in Purchases before deleting your account.' } })
      : route.fulfill({ json: { deleted: true } });
  });
  await signIn(page, false);
  const openProfile = page.getByRole('banner').getByRole('button', { name: 'Profile', exact: true });
  await openProfile.click();
  const profile = page.getByRole('dialog', { name: 'User profile' });
  const mode = profile.getByRole('radio', { name: 'AI assistant' });
  await mode.focus();
  await expect(mode).toBeFocused();
  await expect(mode).toHaveCSS('width', '17px');
  await expect(mode).toHaveCSS('height', '17px');
  await expect(mode).toHaveCSS('outline-width', '2px');
  await profile.getByLabel('Display name').fill('Test Coordinator');
  await profile.getByRole('button', { name: 'Save preference' }).click();
  await expect(profile).toBeHidden();
  await openProfile.click();
  await expect(profile.getByLabel('Display name')).toHaveValue('Test Coordinator');
  await profile.getByRole('button', { name: 'Security' }).click();
  await expect(profile.getByText('Change password', { exact: true })).toBeVisible();
  await profile.getByRole('button', { name: 'Data', exact: true }).click();
  const download = page.waitForEvent('download');
  await profile.getByRole('button', { name: 'Download account data' }).click();
  expect((await download).suggestedFilename()).toBe('reliefops-account-export.json');
  await profile.getByText('Delete account', { exact: true }).click();
  const remove = profile.getByRole('button', { name: 'Permanently delete account' });
  await profile.getByLabel('Enter your account email to confirm').fill('wrong@example.test');
  await expect(remove).toBeDisabled();
  expect(attempted).toBe(0);
  await profile.getByLabel('Enter your account email to confirm').fill('coordinator@example.test');
  await remove.click();
  await expect(profile.getByRole('alert')).toContainText('Resolve pending PayPal transactions');
  await remove.click();
  await expect(page.getByRole('heading', { name: 'Sign in to ReliefOps' })).toBeVisible();
  expect(attempted).toBe(2);
});

test('delete a selected project from settings and remove it from the switcher', async ({ page }) => {
  const state = await mockCloud(page);
  const other = { id: '33333333-3333-4333-8333-333333333333', name: 'Riverdale flood response', revision: 2, updated_at: '2026-11-10T12:00:00Z' };
  await signIn(page);
  const active = state.operation;
  await page.route('**/api/operations', route => route.request().method() === 'GET'
    ? route.fulfill({ json: [active, other] }) : route.fallback());
  await page.reload();
  await expect(page.getByLabel('Saved operation', { exact: true })).toHaveValue(active.id);
  await page.route(`**/api/operations/${active.id}`, route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    expect(route.request().postDataJSON()).toEqual({ expected_revision: active.revision });
    return route.fulfill({ json: { deleted: true } });
  });
  await page.getByRole('banner').getByRole('button', { name: 'Profile', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'User profile' });
  await settings.getByRole('button', { name: 'Data', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Project to delete' }).selectOption(active.id);
  await settings.getByRole('button', { name: 'Delete selected project' }).click();
  await page.getByRole('dialog', { name: 'Delete this project?' }).getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('Deleted');
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  const switcher = page.getByLabel('Saved operation', { exact: true });
  await expect(switcher).toHaveValue('');
  await expect(switcher.locator(`option[value="${active.id}"]`)).toHaveCount(0);
  await expect(switcher.locator(`option[value="${other.id}"]`)).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Start a relief operation' })).toBeVisible();
});

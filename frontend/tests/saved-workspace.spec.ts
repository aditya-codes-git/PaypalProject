import { test, expect } from '@playwright/test';
import { mockCloud, signIn } from './helpers/cloud';
const operationId = '22222222-2222-4222-8222-222222222222';

test('sign in, save, calculate, refresh, restore, and sign out', async ({ page }) => {
  const state = await mockCloud(page);
  await signIn(page);
  await page.getByLabel('Operation name', { exact: true }).fill('Saved flood response');
  await page.getByLabel('Households to reach').fill('55');
  await page.getByRole('button', { name: 'Save operation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('All operation inputs saved');
  await page.getByRole('button', { name: 'Generate purchasing plan' }).click();
  await expect(page.getByRole('dialog', { name: 'Purchasing plan' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Saved calculations' })).toBeVisible();
  expect(state.plans).toHaveLength(1);
  await page.reload();
  page.on('dialog', dialog => dialog.accept());
  await page.getByLabel('Saved operation', { exact: true }).selectOption(operationId);
  // The freshly opened draft is intentionally not auto-saved or silently restored.
  // Selecting a saved operation asks before replacing that draft.
  await expect(page.getByLabel('Households to reach')).toHaveValue('55');
  await expect(page.getByRole('heading', { name: 'Saved calculations' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to your workspace' })).toBeVisible();
  await expect(page.getByLabel('Operation name', { exact: true })).toHaveCount(0);
});

test('stale saves leave local edits intact', async ({ page }) => {
  const state = await mockCloud(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Save operation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('All operation inputs saved');
  state.conflict = true;
  await page.getByLabel('Households to reach').fill('47');
  await page.getByRole('button', { name: 'Save operation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Another tab changed');
  await expect(page.getByLabel('Households to reach')).toHaveValue('47');
});

test('invalid credentials stay on sign-in and do not open saved data', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/');
  await page.getByLabel('Email address', { exact: true }).fill('coordinator@example.test');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not sign in');
  await expect(page.getByLabel('Operation name', { exact: true })).toHaveCount(0);
});

test('sign-out protects unsaved edits and reports revocation failures', async ({ page }) => {
  const state = await mockCloud(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Save operation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('All operation inputs saved');
  await page.getByLabel('Households to reach').fill('43');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Households to reach')).toHaveValue('43');
  state.signoutFailure = true;
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Signed out on this device');
  await expect(page.getByRole('heading', { name: 'Welcome to your workspace' })).toBeVisible();
  await expect(page.getByLabel('Households to reach')).toHaveCount(0);
});

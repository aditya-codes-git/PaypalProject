import { expect, type Page } from '@playwright/test';
import { testScenario } from './scenario';

export async function fillOperationSetup(page: Page, { signedIn = false, addFunding = true } = {}) {
  const scenario = testScenario();
  if (signedIn) await page.getByLabel('Operation name').fill('Riverdale flood response');
  await page.getByLabel('Households to supply').fill(String(scenario.target_kits));
  await page.getByLabel('Delivery window (days)').fill(String(scenario.deadline_days));

  for (const [index, need] of scenario.needs.entries()) {
    if (index) await page.getByRole('button', { name: 'Add supply', exact: true }).click();
    const row = page.getByRole('group', { name: `Supply ${index + 1}`, exact: true });
    await row.getByLabel('Supply name').fill(need.name);
    await row.getByLabel('Category').fill(need.category);
    await row.getByLabel('Units per household').fill(String(need.quantity));
  }
  for (const [index, offer] of scenario.offers.entries()) {
    if (index) await page.getByRole('button', { name: 'Add offer', exact: true }).click();
    const row = page.getByRole('group', { name: `Offer ${index + 1}`, exact: true });
    await row.getByLabel('Supplier name').fill(offer.supplier);
    await row.getByLabel('Supply type').selectOption({ label: scenario.needs.find(need => need.id === offer.need_id)!.name });
    await row.getByLabel('Unit price (USD)').fill(String(offer.unit_cost_cents / 100));
    await row.getByLabel('Units in stock').fill(String(offer.stock));
    await row.getByLabel('Delivery (days)').fill(String(offer.delivery_days));
  }
  if (addFunding) for (const [index, fund] of scenario.funds.entries()) {
    await page.getByRole('button', { name: 'Add funding pool' }).click();
    const row = page.getByRole('group', { name: `Pool ${index + 1}`, exact: true });
    await row.getByLabel('Pool name').fill(fund.name);
    await row.getByLabel('Planned budget (USD)').fill(String(fund.available_cents / 100));
    await row.getByLabel('Allowed categories').fill(fund.categories.join(','));
    await row.getByLabel('I confirmed these funding restrictions').check();
  }
}

export async function startGuestPlan(page: Page) {
  await page.getByRole('button', { name: 'Start without signing in' }).click();
  await expect(page.getByRole('heading', { name: 'Start a relief operation' })).toBeVisible();
  await expect(page.getByLabel('Households to supply')).toHaveValue('');
  await expect(page.getByLabel('Supply name')).toHaveValue('');
  await expect(page.getByLabel('Supplier name')).toHaveValue('');
  await expect(page.getByLabel('Planned budget (USD)')).toHaveCount(0);
  await fillOperationSetup(page);
  await page.getByRole('button', { name: 'Continue to planner' }).click();
  await expect(page.getByRole('heading', { name: 'Operation overview' })).toBeVisible();
}

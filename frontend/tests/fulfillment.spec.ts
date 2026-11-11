import { expect, test } from '@playwright/test';
import { mockCloud, signIn } from './helpers/cloud';

test('records a short delivery and downloads the linked funding report', async ({ page }) => {
  const state = await mockCloud(page);
  const at = '2026-11-11T18:00:00Z';
  const purchase = { id: 'purchase', supplier: 'Riverbend Supplies', need_id: '', quantity: 10, cost_cents: 8000,
    status: 'paid', order_id: 'ORDER', capture_id: 'CAPTURE', approval_url: null, merchant_id: '',
    supplier_confirmation: null as Record<string, string> | null, receipts: [] as Record<string, unknown>[], delivery_closed: false };
  await page.route('**/api/operations/*/finance', route => route.fulfill({
    json: { balances: {}, documents: [], events: [], purchases: [{ ...purchase, need_id: state.operation?.scenario.needs[0]?.id }] },
  }));
  await page.route('**/api/operations/*/purchases/*/supplier-confirmation', route => {
    purchase.supplier_confirmation = route.request().postDataJSON();
    expect(purchase.supplier_confirmation?.invoice_reference).toBe('INV-17');
    return route.fulfill({ json: purchase });
  });
  await page.route('**/api/operations/*/purchases/*/receipts', route => {
    const receipt = route.request().postDataJSON();
    expect(receipt).toMatchObject({ location: 'North shelter', accepted_units: 8, rejected_units: 2, close_delivery: true });
    purchase.receipts.push({ ...receipt, at });
    purchase.delivery_closed = true;
    return route.fulfill({ json: purchase });
  });
  await page.route('**/api/operations/*/funding-report', route => route.fulfill({ json: {
    operation: state.operation.name, generated_at: at,
    funds: [{ id: 'grant', name: 'Food grant', opening_cents: 10000, reserved_cents: 0, spent_cents: 8000,
      available_cents: 2000, source: { filename: 'grant.txt', page: 1 } }],
    purchases: [{ purchase_id: purchase.id, supplier: purchase.supplier, supply: 'Food pack', status: 'paid',
      ordered_units: 10, received_units: 8, delivery_closed: purchase.delivery_closed, receipts: purchase.receipts,
      allocations: [{ fund_id: 'grant', amount_cents: 8000 }] }],
  } }));

  await signIn(page);
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await page.getByText('Supplier and delivery', { exact: true }).click();
  await page.getByLabel('Supplier confirmation reference').fill('SO-17');
  await page.getByLabel('Invoice reference').fill('INV-17');
  await page.getByRole('button', { name: 'Save supplier details' }).click();
  await page.getByLabel('Delivery location').fill('North shelter');
  await page.getByLabel('Receipt reference').fill('RC-1');
  await page.getByLabel('Usable units').fill('8');
  await page.getByLabel('Rejected units').fill('2');
  await page.getByLabel('Close delivery with no more units expected').check();
  await page.getByRole('button', { name: 'Record delivery' }).click();
  await page.getByRole('dialog', { name: 'Close this delivery short?' }).getByRole('button', { name: 'Close delivery' }).click();
  await expect(page.getByText('8 of 10 units received · Delivery closed')).toBeVisible();
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByText('grant.txt · Page 1')).toBeVisible();
  await expect(page.getByText('$100 budget · $0 reserved · $80 spent')).toBeVisible();
  await expect(page.getByText('North shelter · 8 accepted · 2 rejected')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download funding report' }).click();
  expect((await downloaded).suggestedFilename()).toBe('reliefops-funding-report.json');
});

import { test, expect } from '@playwright/test';
import { mockCloud, signIn } from './helpers/cloud';

test('review, approve, reserve, reload and cancel an unsubmitted purchase', async ({ page }) => {
  const state = await mockCloud(page);
  const ledger = { purchases: [] as any[], balances: {} as any, events: [] as any[], documents: [] };
  await page.route('**/api/operations/*/finance', route => route.fulfill({ json: ledger }));
  await page.route('**/api/operations/*/approve', async route => {
    const input = route.request().postDataJSON();
    expect(input.expected_revision).toBe(state.operation.revision);
    expect(input.purchases).toHaveLength(3);
    ledger.purchases = input.purchases.map((p: any, i: number) => ({ ...p, id: `purchase-${i}`, status: 'reserved', merchant_id: '', order_id: null, capture_id: null, approval_url: null }));
    ledger.events = [{ id: 'event-1', kind: 'approved', message: 'Approved purchases; funding reserved.', actor: 'owner', at: new Date().toISOString() }];
    ledger.balances = { flexible: { opening_cents: 72000, available_cents: 36000, reserved_cents: 36000, spent_cents: 0 } };
    await route.fulfill({ json: { id: 'approval-1' } });
  });
  await page.route('**/api/operations/*/purchases/*/cancel', route => {
    ledger.purchases[0].status = 'cancelled';
    return route.fulfill({ json: ledger.purchases[0] });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Generate purchasing plan' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Approve and reserve funds' }).click();
  await expect(page.getByRole('heading', { name: 'Purchases & commitments' })).toBeVisible();
  await expect(page.getByText('$360 reserved · $0 spent')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay with PayPal sandbox' })).toHaveCount(3);
  await page.reload();
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Saved operation', { exact: true }).selectOption(state.operation.id);
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel reservation' })).toHaveCount(3);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancel reservation' }).first().click();
  await expect(page.getByText('cancelled', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel reservation' })).toHaveCount(2);
  await page.screenshot({ path: '../design/previews/purchases-light.png', fullPage: true });
});

test('evidence remains a proposal until explicit source review and confirmation', async ({ page }) => {
  const state = await mockCloud(page);
  const quote = 'Community Food Grant provides USD 100 for food packs only.';
  const ledger = { purchases: [], balances: {}, events: [], documents: [] as any[] };
  await page.route('**/api/operations/*/finance', route => route.fulfill({ json: ledger }));
  await page.route('**/api/operations/*/documents', route => {
    expect(route.request().postDataJSON().filename).toBe('grant.txt');
    const document = { id: 'document-1', filename: 'grant.txt', hash: 'a'.repeat(64), pages: [quote], confirmed: [], metadata: { model: 'fixture-groq', usage: { total_tokens: 100 } }, proposals: { warnings: [], funds: [{ name: 'Food grant', amount_cents: 10000, categories: ['food'], quote, page: 1, requires_review: false, warnings: [] }] } };
    ledger.documents.push(document);
    return route.fulfill({ status: 201, json: document });
  });
  await page.route('**/api/operations/*/documents/*/confirm', route => {
    const input = route.request().postDataJSON();
    expect(input.acknowledge_review).toBe(true);
    expect(input.amount_cents).toBe(10000);
    ledger.documents[0].confirmed = [0];
    state.operation.revision += 1;
    return route.fulfill({ json: { operation: state.operation } });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Save operation', exact: true }).click();
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Upload funding terms').setInputFiles({ name: 'grant.txt', mimeType: 'text/plain', buffer: Buffer.from(quote) });
  await expect(page.locator('blockquote')).toContainText(quote);
  await expect(page.getByRole('button', { name: 'Confirm funding rule' })).toBeDisabled();
  await page.getByLabel('I checked the full source', { exact: false }).check();
  await page.getByRole('button', { name: 'Confirm funding rule' }).click();
  await expect(page.getByRole('button', { name: 'Confirmed and active' })).toBeDisabled();
  await page.screenshot({ path: '../design/previews/evidence-light.png', fullPage: true });
});

test('operation input changes apply only after validation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample workspace' }).click();
  await page.getByRole('button', { name: 'Operation inputs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Supply requirements' })).toBeVisible();
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove supply', exact: true })).toHaveCount(4);
  await page.getByLabel('Supply name', { exact: true }).last().fill('Water');
  await page.getByLabel('Category', { exact: true }).last().fill('water');
  await page.getByRole('button', { name: 'Apply operation inputs' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByText('Water', { exact: true })).toBeVisible();
});

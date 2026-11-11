import { test, expect } from '@playwright/test';
import { fillOperationSetup, startGuestPlan } from './helpers/setup';
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
  const approve = page.getByRole('button', { name: 'Approve and reserve funds' });
  const confirmation = page.getByRole('dialog', { name: 'Approve this purchasing plan?' });
  await approve.click();
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(confirmation).toContainText('$1,440 for 3 purchases');
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(approve).toBeFocused();
  expect(ledger.purchases).toHaveLength(0);
  await approve.click();
  await confirmation.getByRole('button', { name: 'Approve plan' }).click();
  await expect(page.getByRole('heading', { name: 'Pay for approved items' })).toBeVisible();
  await expect(page.getByText('$360 reserved · $0 spent')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay with PayPal' })).toHaveCount(3);
  await page.reload();
  await page.getByLabel('Saved operation', { exact: true }).selectOption(state.operation.id);
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel purchase' })).toHaveCount(3);
  await page.getByRole('button', { name: 'Cancel purchase' }).first().click();
  await page.getByRole('dialog', { name: 'Cancel this purchase?' }).getByRole('button', { name: 'Cancel purchase', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel purchase' })).toHaveCount(2);
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
  await signIn(page, false);
  await expect(page.getByLabel('Operation name')).toHaveValue('');
  await fillOperationSetup(page, { signedIn: true, addFunding: false });
  await page.getByRole('button', { name: 'Save operation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add money to your plan' })).toBeVisible();
  expect(state.operation.scenario.funds).toEqual([]);
  await page.getByRole('button', { name: 'Upload a grant document' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Review grant documents' })).toBeVisible();
  await expect(page.getByLabel('Choose a grant file')).toBeInViewport();
  await expect(page.getByRole('region', { name: 'Saved operations' })).toHaveCount(0);
  await expect(page.getByText('coordinator@example.test', { exact: true })).toHaveCount(0);
  await page.getByLabel('Choose a grant file').setInputFiles({ name: 'grant.txt', mimeType: 'text/plain', buffer: Buffer.from(quote) });
  await page.getByRole('dialog', { name: 'Analyze this grant document?' }).getByRole('button', { name: 'Analyze document' }).click();
  await expect(page.locator('blockquote')).toContainText(quote);
  await expect(page.getByText('fixture-groq', { exact: false })).toBeHidden();
  await page.getByText('AI extraction details', { exact: true }).click();
  await expect(page.getByText('fixture-groq', { exact: false })).toBeVisible();
  await page.getByText('AI extraction details', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm and add grant' })).toBeDisabled();
  await page.getByLabel('I checked the document', { exact: false }).check();
  await page.getByRole('button', { name: 'Confirm and add grant' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added to funding' })).toBeVisible();
  await page.screenshot({ path: '../design/previews/evidence-light.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.screenshot({ path: '../.tools/evidence-dark.png', fullPage: true, animations: 'disabled' });
});

test('operation input changes apply only after validation', async ({ page }) => {
  await page.goto('/?workspace=1');
  await startGuestPlan(page);
  await page.getByRole('button', { name: 'Plan settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Supplies per household' })).toBeVisible();
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove supply', exact: true })).toHaveCount(4);
  await page.getByLabel('Supply name', { exact: true }).last().fill('Water');
  await page.getByLabel('Category', { exact: true }).last().fill('water');
  await page.getByLabel('Units per household').last().fill('1');
  await page.getByRole('button', { name: 'Apply plan changes' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByText('Water', { exact: true })).toBeVisible();
});

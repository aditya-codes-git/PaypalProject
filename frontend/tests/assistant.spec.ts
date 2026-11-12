import { expect, test, type Page } from '@playwright/test';
import { mockCloud } from './helpers/cloud';

async function signIn(page: Page) {
  await page.goto('/?workspace=1');
  await page.getByLabel('Email address', { exact: true }).fill('coordinator@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ask ReliefOps' })).toBeVisible();
}

test('assistant is the default, drafts an operation, and preserves it across profile modes', async ({ page }) => {
  const state = await mockCloud(page, 'default');
  const source = 'Set up a Hillview response for 12 households, one hygiene kit each, within two days.';
  await page.route('**/api/operations/assistant', route => {
    expect(route.request().postDataJSON()).toEqual({ operation_id: null, messages: [{ role: 'user', text: source }] });
    return route.fulfill({ json: {
      action: 'draft', message: 'Review the Hillview draft.', offer: null, receipt: null, purchase_id: null,
      operation: { name: 'Hillview response', households: 12, deadline_days: 2,
        needs: [{ name: 'Hygiene kit', category: 'hygiene', quantity: 1 }], offers: [] },
    } });
  });
  await signIn(page);
  await expect(page.getByLabel('Supply name')).toHaveCount(0);
  await page.getByLabel('Message ReliefOps').fill(source);
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('button', { name: 'Review operation draft' }).click();
  await expect(page.getByLabel('Operation name')).toHaveValue('Hillview response');
  await expect(page.getByLabel('Households to supply')).toHaveValue('12');
  await expect(page.getByLabel('Supply name')).toHaveValue('Hygiene kit');
  expect(state.operation).toBeNull();
  await page.getByRole('button', { name: 'Save operation', exact: true }).click();
  await expect(page.getByLabel('Saved operation', { exact: true })).toHaveValue('22222222-2222-4222-8222-222222222222');
  expect(state.operation.scenario.offers).toEqual([]);
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('radio', { name: 'Manual entry' }).check();
  await page.getByRole('button', { name: 'Save preference' }).click();
  await expect(page.getByRole('heading', { name: 'Ask ReliefOps' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Operation overview' })).toBeVisible();
  await expect(page.getByLabel('Operation name')).toHaveValue('Hillview response');
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('radio', { name: 'AI assistant' }).check();
  await page.getByRole('button', { name: 'Save preference' }).click();
  await expect(page.getByRole('heading', { name: 'Ask ReliefOps' })).toBeVisible();
  await expect(page.getByLabel('Saved operation', { exact: true })).toHaveValue(state.operation.id);
  await expect(page.getByText('Review the Hillview draft.')).toBeVisible();
});

test('chat carries receipt fields into a purchase and opens the closeout record', async ({ page }) => {
  const state = await mockCloud(page, 'default');
  const at = '2026-11-12T12:00:00Z';
  state.operation = {
    id: '22222222-2222-4222-8222-222222222222', revision: 1, updated_at: at, name: 'Hillview',
    scenario: { target_kits: 4, deadline_days: 2, currency: 'USD',
      needs: [{ id: 'hygiene', name: 'Hygiene kit', category: 'hygiene', quantity: 1 }], offers: [], funds: [] },
  };
  const source = 'Northline delivered all 4 hygiene kits to Hillview Hall, reference NH-1043.';
  const purchase = { id: 'northline', supplier: 'Northline', status: 'paid', quantity: 4, need_id: 'hygiene',
    cost_cents: 3600, capture_id: 'CAPTURE', receipts: [] as Record<string, unknown>[] };
  let closed = false;
  await page.route('**/api/operations/*/finance', route => route.fulfill({ json: {
    balances: {}, documents: [], events: [], purchases: [purchase],
  } }));
  await page.route('**/api/operations/assistant', route => route.fulfill({ json: {
    message: 'Review the Northline receipt.', action: 'delivery', operation: null, offer: null, purchase_id: purchase.id,
    receipt: { accepted_units: 4, rejected_units: 0, location: 'Hillview Hall', reference: 'NH-1043', short: false, quote: source },
  } }));
  await page.route('**/purchases/northline/receipts', route => {
    const receipt = route.request().postDataJSON();
    expect(receipt).toMatchObject({ accepted_units: 4, location: 'Hillview Hall', reference: 'NH-1043' });
    purchase.receipts.push({ ...receipt, at });
    return route.fulfill({ json: purchase });
  });
  await page.route('**/funding-report', route => route.fulfill({ json: {
    operation: 'Hillview', generated_at: at, funds: [], purchases: [],
    closeout: { households: 4, complete_households: purchase.receipts.length ? 4 : 0, pending_payments: 0,
      open_deliveries: 0, supplies: [], ready: !!purchase.receipts.length, recorded_at: closed ? at : null },
  } }));
  await page.route('**/closeout', route => {
    closed = true;
    return route.fulfill({ json: { recorded_at: at } });
  });
  await signIn(page);
  await page.getByLabel('Message ReliefOps').fill(source);
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('button', { name: 'Review delivery' }).click();
  await expect(page.getByLabel('Delivery location')).toHaveValue('Hillview Hall');
  await expect(page.getByLabel('Receipt reference')).toHaveValue('NH-1043');
  expect(purchase.receipts).toHaveLength(0);
  await page.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await expect(page.getByText('4 of 4 units received')).toBeVisible();
  await page.getByRole('button', { name: 'View closeout' }).click();
  await page.getByRole('region', { name: 'Operation closeout' }).getByRole('button', { name: 'Record closeout' }).click();
  await page.getByRole('dialog', { name: 'Record this closeout?' }).getByRole('button', { name: 'Record closeout' }).click();
  await expect(page.getByText(/Closeout recorded/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download purchase record (PDF)' })).toBeVisible();
});

test('grant review sits beside chat on desktop and opens visibly on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await mockCloud(page, 'default');
  const source = 'The Cedar Grove Hygiene Grant provides $132 USD for hygiene kits only.';
  await page.route('**/api/operations/assistant', route => route.fulfill({ json: {
    message: 'Review the Cedar Grove grant.', action: 'grant', operation: null, offer: null, purchase_id: null, receipt: null,
  } }));
  let analyzed = false;
  await page.route('**/api/operations/*/documents', route => {
    const body = route.request().postDataJSON();
    expect(Buffer.from(body.content_base64, 'base64').toString('utf8')).toBe(source);
    analyzed = true;
    return route.fulfill({ status: 201, json: {} });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await page.getByLabel('Message ReliefOps').fill(source);
  await page.getByRole('button', { name: 'Send message' }).click();
  const review = page.getByRole('button', { name: 'Review grant', exact: true });
  await review.click();
  await expect(page.getByRole('heading', { name: 'Start a relief operation' })).toBeFocused();
  await expect(page.getByText('Your grant text is ready. Save the operation below to review it.')).toBeInViewport();
  await page.getByRole('button', { name: 'Save operation', exact: true }).click();
  const heading = page.getByRole('heading', { name: 'Review grant documents' });
  await expect(heading).toBeFocused();
  const chat = page.getByRole('region', { name: 'Ask ReliefOps' });
  const chatBounds = await chat.boundingBox();
  const reviewBounds = await heading.boundingBox();
  expect(reviewBounds!.x).toBeGreaterThan(chatBounds!.x + chatBounds!.width);
  await expect(chat.locator('textarea')).toHaveCSS('background-color', 'rgb(12, 10, 16)');
  await page.screenshot({ path: testInfo.outputPath('assistant-dark-desktop.png') });
  const chatNav = page.getByRole('button', { name: 'Ask ReliefOps', exact: true });
  await chatNav.click();
  await expect(heading).toBeHidden();
  await expect(chatNav).toHaveAttribute('aria-current', 'page');
  await expect(chat.getByText(source, { exact: false })).toBeVisible();
  await expect.poll(async () => (await chat.boundingBox())?.width ?? 0).toBeGreaterThan(chatBounds!.width);
  await review.click();
  await expect(heading).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await review.click();
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('assistant-dark-mobile.png') });
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await expect(chat.getByRole('heading', { name: 'Ask ReliefOps' })).toBeFocused();
  await expect(heading).toBeHidden();
  await review.click();
  await page.getByRole('button', { name: 'Analyze pasted grant terms' }).click();
  await page.getByRole('dialog', { name: 'Analyze this grant document?' }).getByRole('button', { name: 'Analyze document' }).click();
  await expect.poll(() => analyzed).toBe(true);
});

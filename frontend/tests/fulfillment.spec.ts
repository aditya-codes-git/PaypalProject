import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockCloud, signIn } from './helpers/cloud';

test('records a short delivery and downloads purchase and funding records', async ({ page }, testInfo) => {
  const state = await mockCloud(page);
  const at = '2026-11-11T18:00:00Z';
  const purchase = { id: 'purchase', supplier: 'Riverbend Supplies', need_id: '', quantity: 10, cost_cents: 8000,
    status: 'paid', order_id: 'ORDER', capture_id: 'CAPTURE', approval_url: null, merchant_id: '',
    supply_name: 'Food pack', allocations: [{ fund_id: 'grant', amount_cents: 8000 }],
    supplier_confirmation: null as Record<string, string> | null, receipts: [] as Record<string, unknown>[], delivery_closed: false };
  await page.route('**/api/operations/*/finance', route => route.fulfill({
    json: {
      balances: { grant: { opening_cents: 10000, reserved_cents: 0, spent_cents: 8000, available_cents: 2000 } },
      documents: [],
      events: Array.from({ length: 28 }, (_, i) => ({ id: String(i), at, message: `Purchase event ${i + 1}` })),
      purchases: [{ ...purchase, need_id: state.operation?.scenario.needs[0]?.id }],
    },
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
  const recordDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download purchase record (PDF)', exact: true }).click();
  const record = await recordDownload;
  expect(record.suggestedFilename()).toBe(`reliefops-purchase-record-${state.operation.id}.pdf`);
  const recordPath = testInfo.outputPath('purchase-record.pdf');
  await record.saveAs(recordPath);
  expect((await readFile(recordPath)).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByText('grant.txt · Page 1')).toBeVisible();
  await expect(page.getByText('$100 budget · $0 reserved · $80 spent')).toBeVisible();
  await expect(page.getByText('North shelter · 8 accepted · 2 rejected')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download funding report' }).click();
  expect((await downloaded).suggestedFilename()).toBe('reliefops-funding-report.json');
});

test('reviews a supplier message and reserves only the missing units', async ({ page }, testInfo) => {
  const state = await mockCloud(page);
  const at = '2026-11-12T12:00:00Z';
  const source = 'We delivered eight hygiene kits. The remaining four will not ship.';
  state.operation = {
    id: '22222222-2222-4222-8222-222222222222', revision: 1, updated_at: at, name: 'Winter shelter',
    scenario: { currency: 'USD', target_kits: 12, deadline_days: 2,
      needs: [{ id: 'kit', name: 'Hygiene Kit', category: 'hygiene', quantity: 1 }],
      funds: [
        { id: 'shelter', name: 'Winter Shelter Fund', available_cents: 13200, categories: ['shelter'], confirmed: true },
        { id: 'hygiene', name: 'Hygiene Grant', available_cents: 9600, categories: ['hygiene'], confirmed: true },
      ],
      offers: [{ id: 'backup', supplier: 'Backup Supplies', need_id: 'kit', unit_cost_cents: 900, stock: 4, delivery_days: 1, active: true }] },
  };
  const original = { id: 'original', supplier: 'Summit Supplies', need_id: 'kit', supply_name: 'Hygiene Kit',
    quantity: 12, cost_cents: 9600, status: 'paid', order_id: 'ORIGINAL', capture_id: 'CAPTURE', merchant_id: '',
    receipts: [] as Record<string, unknown>[], delivery_closed: false };
  const replacement = { ...original, id: 'replacement', supplier: 'Backup Supplies', quantity: 4, cost_cents: 3600,
    status: 'reserved', order_id: null, capture_id: null, replaces_purchase_id: original.id };
  const analysis = { id: 'analysis', revision: 1, model: 'openai/gpt-oss-120b',
    proposal: { purchase_match: 'matches', reported_total_received: 8, remaining_delivery: 'cancelled', quote: source,
      summary: 'Eight hygiene kits arrived and four were cancelled.', operator_check: 'Check the receipt for eight usable kits.' } };
  const purchases: (typeof original | typeof replacement)[] = [original];
  let savedEvidence: unknown = null;
  await page.route('**/api/operations/*/finance', route => route.fulfill({
    json: { balances: { hygiene: { opening_cents: 9600, available_cents: 0, spent_cents: 9600, reserved_cents: 0 } }, documents: [], events: [], purchases: purchases.map(purchase =>
      purchase === original ? { ...purchase, short_delivery: savedEvidence } : purchase) },
  }));
  await page.route('**/short-delivery/analyze', route => {
    expect(route.request().postDataJSON()).toEqual({ text: source });
    return route.fulfill({ json: analysis });
  });
  await page.route('**/purchases/original/receipts', route => {
    const receipt = route.request().postDataJSON();
    expect(receipt).toMatchObject({ accepted_units: 8, close_delivery: true, short_delivery_review: { analysis_id: 'analysis', expected_receipts: 0 } });
    original.receipts.push({ ...receipt, at });
    original.delivery_closed = true;
    savedEvidence = { receipt_id: receipt.request_id, evidence: analysis, at };
    return route.fulfill({ json: original });
  });
  const proposed = { offer_id: 'backup', need_id: 'kit', supplier: 'Backup Supplies', quantity: 4,
    cost_cents: 3600, allocations: [{ fund_id: 'hygiene', amount_cents: 3600 }] };
  const plan = { id: 'replacement-plan', input_digest: 'a'.repeat(64), total_cost_cents: 3600, purchases: [proposed] };
  let replacementReady = false;
  await page.route('**/short-delivery/plan', route => {
    expect(original.delivery_closed).toBe(true);
    return route.fulfill({ json: {
      plan: replacementReady ? plan : { ...plan, total_cost_cents: 0, purchases: [] },
      target_units: 4, current_planned_kits: 8, projected_kits: replacementReady ? 12 : 8, target_kits: 12,
      eligible_budget_cents: replacementReady ? 3600 : 0, ineligible_funds: ['Winter Shelter Fund'],
      units_without_offer: replacementReady ? 0 : 4, funding_gap_cents: replacementReady ? 0 : null,
    } });
  });
  await page.route('**/api/operations/*/approve', route => {
    expect(route.request().postDataJSON()).toMatchObject({ replaces_purchase_id: original.id, input_digest: plan.input_digest, purchases: [proposed] });
    purchases.push(replacement);
    return route.fulfill({ json: { id: 'replacement-approval' } });
  });

  await signIn(page, false);
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await page.getByRole('button', { name: 'Resolve short delivery' }).click();
  await page.getByLabel('Supplier email or message').fill(source);
  await page.getByRole('button', { name: 'Analyze with AI' }).click();
  const panel = page.getByRole('region', { name: 'Short delivery recovery' });
  await expect(panel.getByRole('blockquote')).toHaveText(source);
  await expect(panel.getByLabel('Additional usable units')).toHaveValue('8');
  expect(original.receipts).toHaveLength(0);
  await panel.getByLabel('Delivery location').fill('North shelter');
  await panel.getByLabel('Receipt or supplier reference').fill('SO-17');
  await panel.getByLabel('I checked the delivery').check();
  await panel.getByRole('button', { name: 'Save short delivery and compare options' }).click();
  await expect(panel.getByRole('heading', { name: 'No replacement found for the 4 missing units' })).toBeVisible();
  await expect(panel.getByText('A backup supplier is needed')).toBeVisible();
  await expect(panel.getByText('No money available for this item')).toBeVisible();
  await expect(panel.getByText('Winter Shelter Fund can pay for shelter.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Approve replacement plan' })).toHaveCount(0);
  await expect(panel.getByText('With the replacement', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Edit supplier offers' }).click();
  await expect(page.getByRole('heading', { name: 'Supplier offers', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await page.getByRole('button', { name: 'View replacement options' }).click();
  await panel.getByRole('button', { name: 'Review funding budget' }).click();
  await expect(page.getByRole('heading', { name: 'Change a budget' })).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Funding source', exact: true })).toHaveValue('hygiene');
  replacementReady = true;
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await page.getByRole('button', { name: 'View replacement options' }).click();
  await expect(panel.getByRole('heading', { name: 'Replace 4 of 4 missing units for $36' })).toBeVisible();
  await expect(panel.getByText('This would increase planned coverage from 8 to 12 of 12 households with complete supply kits.')).toBeVisible();
  await expect(panel.getByText('4 replacement units · Reported delivery in 1 day')).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath('short-delivery-options.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await panel.getByRole('button', { name: 'Approve replacement plan' }).click();
  await page.getByRole('dialog', { name: 'Approve these replacements?' }).getByRole('button', { name: 'Approve replacements' }).click();
  await expect(panel.getByRole('link', { name: 'Backup Supplies · 4 units · Ready for PayPal checkout' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay with PayPal', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Replacement for Summit Supplies' })).toBeVisible();
});

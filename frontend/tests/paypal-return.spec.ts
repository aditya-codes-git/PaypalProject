import { expect, test } from '@playwright/test';
import { mockCloud, signIn } from './helpers/cloud';

for (const payment of ['approved', 'cancelled'] as const) {
  test(`PayPal ${payment} return handles only the matching purchase`, async ({ page }) => {
    const state = await mockCloud(page);
    const purchaseId = '33333333-3333-4333-8333-333333333333';
    const orderId = 'PAYPALORDER';
    let captures = 0;
    let status = 'awaiting_approval';
    let finishCapture!: () => void;
    const captureResponse = new Promise<void>(resolve => { finishCapture = resolve; });
    await page.route('**/api/operations/*/purchases/*/capture', async route => {
      captures += 1;
      expect(new URL(route.request().url()).pathname).toBe(`/api/operations/${state.operation.id}/purchases/${purchaseId}/capture`);
      expect(route.request().postDataJSON()).toEqual({ order_id: orderId });
      await captureResponse;
      status = 'paid';
      await route.fulfill({ json: { status } });
    });
    await page.route('**/api/operations/*/finance', route => route.fulfill({
      json: {
        purchases: [{ id: purchaseId, supplier: 'Riverbend Supplies', need_id: state.operation?.scenario.needs[0]?.id,
          quantity: 1, cost_cents: 1000, status, order_id: orderId, merchant_id: '', approval_url: 'https://www.sandbox.paypal.com/' }],
        balances: {}, documents: [], events: [],
      },
    }));

    await signIn(page);
    await page.goto(`/?operation=${state.operation.id}&purchase=${purchaseId}&payment=${payment}&token=${orderId}`);
    if (payment === 'approved') {
      await expect(page.getByRole('status').filter({ hasText: 'Confirming payment with PayPal' })).toBeVisible();
      finishCapture();
      await expect(page.getByRole('status').filter({ hasText: 'Payment confirmed.' })).toBeVisible();
      await expect(page.getByText('Paid', { exact: true })).toBeVisible();
      expect(captures).toBe(1);
    } else {
      await expect(page.getByRole('status').filter({ hasText: 'PayPal checkout was closed' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Continue in PayPal' })).toBeVisible();
      expect(captures).toBe(0);
    }
    await expect(page.getByRole('button', { name: 'Complete payment', exact: true })).toHaveCount(0);
    await expect(page).toHaveURL('http://127.0.0.1:5173/');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Start a relief operation' })).toBeVisible();
    expect(captures).toBe(payment === 'approved' ? 1 : 0);
  });
}

import { expect, type Page } from '@playwright/test';
import { fillOperationSetup } from './setup';
const operationId = '22222222-2222-4222-8222-222222222222';
const userId = '11111111-1111-4111-8111-111111111111';
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'coordinator@example.test', created_at: '2026-11-10T00:00:00Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };

export async function mockCloud(page: Page) {
  const state: { operation: any; plans: any[]; conflict: boolean; signoutFailure: boolean } = { operation: null, plans: [], conflict: false, signoutFailure: false };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`;
  await page.route('**/api/public-config', route => route.fulfill({ json: { supabase: { url: 'https://reliefops-test.supabase.co', publishable_key: 'sb_publishable_browser_test' } } }));
  await page.route('https://reliefops-test.supabase.co/auth/v1/**', route => {
    if (route.request().url().includes('/logout') && state.signoutFailure) return route.fulfill({ status: 400, json: { msg: 'Sign-out service unavailable' } });
    if (route.request().url().includes('/token')) {
      const input = route.request().postDataJSON();
      if (input.password !== 'test-password') return route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials' } });
      return route.fulfill({ json: { access_token: accessToken, token_type: 'bearer', expires_in: 3600, refresh_token: 'test-refresh-token', user } });
    }
    return route.fulfill({ json: user });
  });
  await page.route('**/api/operations**', async route => {
    const request = route.request();
    expect(request.headers().authorization).toBe(`Bearer ${accessToken}`);
    const path = new URL(request.url()).pathname;
    if (path === '/api/operations' && request.method() === 'GET') return route.fulfill({ json: state.operation ? [state.operation] : [] });
    if (path.endsWith('/plans')) {
      const response = await page.request.post('/api/plan', { data: state.operation.scenario });
      expect(response.ok()).toBeTruthy();
      const plan = { id: `saved-${state.plans.length}`, operation_id: operationId, input_revision: state.operation.revision, scenario: state.operation.scenario, result: await response.json(), created_at: new Date().toISOString() };
      state.plans.unshift(plan);
      return route.fulfill({ status: 201, json: plan });
    }
    if (request.method() === 'GET') return route.fulfill({ json: { operation: state.operation, plans: state.plans } });
    if (state.conflict) return route.fulfill({ status: 409, json: { detail: 'Another tab changed this operation. Reload the saved version before saving again.' } });
    const data = request.postDataJSON();
    state.operation = { id: operationId, name: data.name, scenario: data.scenario, revision: (state.operation?.revision ?? 0) + 1, updated_at: new Date().toISOString() };
    return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: state.operation });
  });
  return state;
}

export async function signIn(page: Page, save = true) {
  await page.goto('/');
  await page.getByLabel('Email address', { exact: true }).fill('coordinator@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved operations' })).toBeVisible();
  if (save) {
    await fillOperationSetup(page, { signedIn: true });
    await page.getByRole('button', { name: 'Save operation', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Operation overview' })).toBeVisible();
  }
}


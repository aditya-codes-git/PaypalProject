import { test, expect, type Page } from '@playwright/test';

async function configure(page: Page) {
  await page.route('**/api/public-config', route => route.fulfill({ json: { supabase: { url: 'https://oauth-test.supabase.co', publishable_key: 'sb_publishable_oauth_test' } } }));
  await page.route('**/api/operations', route => route.fulfill({ json: [] }));
}

test('Google button starts a PKCE flow with the current app as redirect', async ({ page }) => {
  await configure(page);
  let authorization: URL | null = null;
  await page.route('https://oauth-test.supabase.co/auth/v1/authorize**', route => {
    authorization = new URL(route.request().url());
    return route.fulfill({ contentType: 'text/html', body: '<h1>Provider authorization started</h1>' });
  });
  await page.goto('/?workspace=1');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Provider authorization started' })).toBeVisible();
  expect(authorization!.searchParams.get('provider')).toBe('google');
  expect(authorization!.searchParams.get('redirect_to')).toBe('http://127.0.0.1:5173/');
  expect(authorization!.searchParams.get('code_challenge')).toBeTruthy();
  expect(authorization!.searchParams.get('code_challenge_method')?.toLowerCase()).toBe('s256');
});

test('OAuth callback exchanges the code and opens the signed-in workspace', async ({ page }) => {
  await configure(page);
  const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'google-user@example.test', created_at: new Date().toISOString(), app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {}, identities: [] };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
  let exchanged = false;
  await page.route('https://oauth-test.supabase.co/auth/v1/authorize**', route => route.fulfill({ status: 302, headers: { location: 'http://127.0.0.1:5173/?code=test-authorization-code' }, body: '' }));
  await page.route('https://oauth-test.supabase.co/auth/v1/token**', route => {
    const body = route.request().postDataJSON();
    expect(new URL(route.request().url()).searchParams.get('grant_type')).toBe('pkce');
    expect(body.auth_code).toBe('test-authorization-code');
    expect(body.code_verifier).toBeTruthy();
    exchanged = true;
    return route.fulfill({ json: { access_token: token, token_type: 'bearer', refresh_token: 'mock-refresh', expires_in: 3600, user } });
  });
  await page.route('https://oauth-test.supabase.co/auth/v1/user', route => route.fulfill({ json: user }));
  await page.goto('/?workspace=1');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('region', { name: 'Ask ReliefOps' })).toBeVisible();
  expect(exchanged).toBeTruthy();
  await expect(page).toHaveURL('http://127.0.0.1:5173/?workspace=1');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Ask ReliefOps' })).toBeVisible();
});

test('cancelled OAuth displays a safe error and cleans callback parameters', async ({ page }) => {
  await configure(page);
  await page.goto('/?error=access_denied&error_description=private-provider-details');
  await expect(page.getByRole('alert')).toContainText('Google sign-in was cancelled');
  await expect(page.getByRole('alert')).not.toContainText('private-provider-details');
  await expect(page).toHaveURL('http://127.0.0.1:5173/?workspace=1');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
});

test('a callback without its browser verifier asks for a fresh sign-in', async ({ page }) => {
  await configure(page);
  await page.goto('/?code=expired-or-unmatched-code');
  await expect(page.getByRole('alert')).toContainText('Restart sign-in in this browser');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
});

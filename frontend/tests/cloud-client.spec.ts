import { test, expect } from '@playwright/test';
import { cloudRequest, type Account } from '../src/cloud';

test('an account switch cannot send an old workspace using the new user token', async () => {
  const account = {
    session: { user: { id: 'original-user' } },
    client: { auth: { getSession: async () => ({ data: { session: { user: { id: 'different-user' }, access_token: 'do-not-send' } }, error: null }) } },
  } as unknown as Account;
  await expect(cloudRequest(account, '', 'POST', { name: 'Private original workspace' })).rejects.toThrow('The signed-in account changed');
});

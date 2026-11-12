import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Plan, Scenario } from './types';

export type Account = { client: SupabaseClient; session: Session };
export type Operation = { id: string; name: string; revision: number; scenario: Scenario; updated_at: string };
export type OperationSummary = Pick<Operation, 'id' | 'name' | 'revision' | 'updated_at'>;
export type SavedPlan = { id: string; operation_id: string; input_revision: number; scenario: Scenario; result: Plan; created_at: string };

export function fingerprint(value: unknown): string {
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, ordered(val)])) : item;
  return JSON.stringify(ordered(value));
}

export async function cloudRequest<T>(account: Account, path: string, method = 'GET', body?: unknown): Promise<T> {
  return authenticatedRequest(account, `/api/operations${path}`, method, body);
}

export async function accountRequest<T>(account: Account, path: string, method = 'GET', body?: unknown): Promise<T> {
  return authenticatedRequest(account, `/api/account${path}`, method, body);
}

async function authenticatedRequest<T>(account: Account, path: string, method: string, body: unknown): Promise<T> {
  const { data, error } = await account.client.auth.getSession();
  if (error || !data.session) throw new Error('Your session expired. Sign in again before saving.');
  if (data.session.user.id !== account.session.user.id) throw new Error('The signed-in account changed. Reopen the workspace before saving.');
  // The backend verifies this credential with Supabase; browser session state is not authorization.
  const response = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (response.status === 422 && Array.isArray(result?.detail)) {
    throw new Error('Some inputs were rejected. Review the form and try again.');
  }
  if (!response.ok) throw new Error(typeof result?.detail === 'string' ? result.detail : 'The saved workspace could not be reached. Your edits have not been discarded.');
  return result as T;
}

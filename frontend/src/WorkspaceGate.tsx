import { Brand, AuthArtwork } from './Brand';
import { ThemeToggle } from './Theme';
import { useEffect, useState, type FormEvent } from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { App } from './App';

let clientPromise: Promise<SupabaseClient | null> | null = null;
function loadClient() {
  if (!clientPromise) clientPromise = fetch('/api/public-config').then(async response => {
    if (!response.ok) throw new Error('Could not open sign-in. Try again in a moment.');
    const { supabase } = await response.json();
    return supabase ? createClient(supabase.url, supabase.publishable_key, {
      auth: { flowType: 'pkce', detectSessionInUrl: true },
    }) : null;
  }).catch(error => { clientPromise = null; throw error; });
  return clientPromise;
}

export function WorkspaceGate() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [guest, setGuest] = useState(() => new URLSearchParams(window.location.search).get('guest') === '1');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const callbackUrl = new URL(window.location.href);
    const callbackHash = new URLSearchParams(callbackUrl.hash.slice(1));
    if (!callbackUrl.searchParams.has('workspace')) {
      callbackUrl.searchParams.set('workspace', '1');
      window.history.replaceState(window.history.state, '', callbackUrl);
    }
    const callbackError = callbackUrl.searchParams.get('error') ?? callbackHash.get('error');
    const hadCode = callbackUrl.searchParams.has('code');
    setLoading(true);
    setError(callbackError ? 'Google sign-in was cancelled or could not be completed. Please try again.' : '');
    loadClient().then(async next => {
      if (!active) return;
      setClient(next);
      if (next) {
        const { data: { subscription } } = next.auth.onAuthStateChange((_event, current) => {
          if (active) setSession(current);
        });
        unsubscribe = () => subscription.unsubscribe();
        // The SDK exchanges a returned authorization code using the locally stored PKCE verifier.
        const { error: initializeError } = await next.auth.initialize();
        const { data, error: sessionError } = await next.auth.getSession();
        if (!active) return;
        if (hadCode && (initializeError || !data.session)) setError('Google sign-in could not be completed. Restart sign-in in this browser.');
        else if (sessionError) setError('Your previous session could not be restored. Please sign in again.');
        const cleanUrl = new URL(window.location.href);
        for (const key of ['code', 'error', 'error_code', 'error_description']) cleanUrl.searchParams.delete(key);
        if (callbackHash.has('error')) cleanUrl.hash = '';
        window.history.replaceState(window.history.state, '', cleanUrl);
        setSession(data.session);
      }
      if (active) setLoading(false);
    }).catch(err => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; unsubscribe?.(); };
  }, [attempt]);

  if (loading) return <div className="auth-shell"><div className="auth-card"><p role="status">Opening your workspace…</p></div></div>;
  if (guest) return <App key="guest" account={null} onExit={() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('guest');
    window.history.replaceState(window.history.state, '', url);
    setGuest(false);
  }} />;
  if (session && client) return <App key={session.user.id} account={{ client, session }} onExit={async reason => {
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
    if (signOutError && reason !== 'deleted') setError('Signed out on this device, but the server could not confirm session revocation.');
    setSession(null);
  }} />;
  return <SignIn client={client} initialError={error} onGuest={() => setGuest(true)} onRetry={() => setAttempt(n => n + 1)} />;
}

function SignIn({ client, initialError, onGuest, onRetry }: { client: SupabaseClient | null; initialError: string; onGuest: () => void; onRetry: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState('');
  async function googleSignIn() {
    if (!client) return;
    setGoogleBusy(true); setError('');
    try {
      const { data, error: authError } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/`, skipBrowserRedirect: true },
      });
      if (authError || !data.url) throw new Error('OAuth unavailable');
      window.location.assign(data.url);
    } catch {
      setError('Could not start Google sign-in. Check your connection and try again.');
      setGoogleBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    setBusy(true); setError('');
    try {
      const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) setError('Could not sign in. Check your email, password, and whether the account is confirmed.');
    } catch { setError('The sign-in service could not be reached. Try again.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell">
    <div className="auth-appearance"><ThemeToggle animate /></div>
    <section className="auth-intro">
      <a href="/" className="auth-brand" aria-label="ReliefOps home"><Brand /></a>
      <div className="auth-story">
        <h2>From urgent needs to a <span>purchasing plan.</span></h2>
        <p>See what you can buy with your grants, supplier stock, and delivery deadline.</p>
        <AuthArtwork />
      </div>
    </section>
    <section className="auth-card" aria-labelledby="sign-in-title">
      <div className="auth-heading">
        <h1 id="sign-in-title">Sign in to ReliefOps</h1>
        <p>Save operations, review grants, and approve purchases.</p>
      </div>
      {(error || initialError) && <div className="error-banner" role="alert">{error || initialError}</div>}
      <button className="button google-button full-width" type="button" disabled={busy || googleBusy || !client} onClick={googleSignIn}>
        <span className="google-mark" aria-hidden="true">G</span>{googleBusy ? 'Connecting to Google…' : 'Continue with Google'}
      </button>
      <div className="auth-or"><span>or sign in with email</span></div>
      <form onSubmit={submit}>
        <label>Email address<input autoComplete="username" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
        <label>Password<input autoComplete="current-password" type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className="button primary full-width" type="submit" disabled={busy || googleBusy || !client}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {!client && <div>
        <p className="auth-help">Sign-in is unavailable. You can still build a guest plan.</p>
        <button className="text-button" onClick={onRetry}>Retry connection</button>
      </div>}
      <div className="auth-guest">
        <button className="button subtle full-width" onClick={onGuest}>Start without signing in</button>
        <small className="auth-sample-note">Guest plans are temporary.</small>
      </div>
    </section>
  </main>;
}

import { useState, type FormEvent } from 'react';
import { accountRequest, type Account, type OperationSummary } from './cloud';
import { useConfirmation } from './Confirmation';

export type WorkspaceMode = 'assistant' | 'manual';
type ProfileSection = 'Profile' | 'Security' | 'Data';

export function WorkspaceProfile({ account, mode, onChange, onClose, onDeleted, projects, activeProjectId, onDeleteProject }: {
  account: Account; mode: WorkspaceMode; onChange: (mode: WorkspaceMode) => void; onClose: () => void; onDeleted: () => Promise<void>;
  projects: OperationSummary[]; activeProjectId?: string; onDeleteProject: (project: OperationSummary) => Promise<void>;
}) {
  const user = account.session.user;
  const email = user.email ?? '';
  const providers: string[] = user.app_metadata.providers ?? [];
  const emailLogin = providers.includes('email') || user.identities?.some(identity => identity.provider === 'email') || user.app_metadata.provider === 'email';
  const [section, setSection] = useState<ProfileSection>('Profile');
  const [selected, setSelected] = useState(mode);
  const [name, setName] = useState(String(user.user_metadata.reliefops_display_name ?? user.user_metadata.full_name ?? '').slice(0, 80));
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const confirm = useConfirmation();
  const selectedProject = projects.find(project => project.id === projectId);

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setStatus('');
    setError('');
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : fallback); }
    finally { setBusy(false); }
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const { data, error: failure } = await account.client.auth.updateUser({
        data: { reliefops_workspace_mode: selected, reliefops_display_name: name.trim() },
      });
      if (failure || data.user?.id !== user.id) throw new Error('Could not save your profile. Try again.');
      onChange(selected);
      onClose();
    }, 'Could not save your profile. Try again.');
  }

  function updateEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const next = String(new FormData(form).get('email')).trim();
    void run(async () => {
      const { error: failure } = await account.client.auth.updateUser({ email: next });
      if (failure) throw new Error('Could not request the email change. Check the address and try again.');
      form.reset();
      setStatus('Check your inbox for the email change confirmation.');
    }, 'Could not request the email change.');
  }

  function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = String(fields.get('password'));
    const nonce = String(fields.get('nonce')).trim();
    if (password !== fields.get('confirm-password')) { setStatus(''); setError('The passwords must match.'); return; }
    void run(async () => {
      const { error: failure } = await account.client.auth.updateUser({ password, ...(nonce ? { nonce } : {}) });
      if (failure?.code === 'reauthentication_needed' || failure?.code === 'reauthentication_not_valid') {
        throw new Error('Send a verification code, then enter it with your new password.');
      }
      if (failure) throw new Error('Could not update your password. Check its length and your verification code.');
      form.reset();
      setStatus('Password updated.');
    }, 'Could not update your password.');
  }

  function downloadExport() {
    void run(async () => {
      const data = await accountRequest<Record<string, unknown>>(account, '/export');
      const file = new Blob([JSON.stringify({ profile: { email, display_name: user.user_metadata.reliefops_display_name ?? user.user_metadata.full_name ?? '', mode }, ...data }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url; link.download = 'reliefops-account-export.json';
      link.click();
      URL.revokeObjectURL(url);
      setStatus('Account export downloaded.');
    }, 'Could not export your account data.');
  }

  function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email || confirmationEmail.trim().toLowerCase() !== email.toLowerCase()) return;
    void run(async () => {
      const result = await accountRequest<{ deleted: boolean }>(account, '/delete', 'POST', { email: confirmationEmail.trim() });
      if (!result.deleted) throw new Error('Account deletion could not be confirmed.');
      await onDeleted();
    }, 'Could not delete your account.');
  }

  async function deleteProject() {
    if (!selectedProject || !await confirm({
      title: 'Delete this project?',
      message: `Permanently delete “${selectedProject.name}” and its saved plans and records? Last saved ${new Date(selectedProject.updated_at).toLocaleString()}.`,
      action: 'Delete project',
    })) return;
    await run(async () => {
      await onDeleteProject(selectedProject);
      setProjectId('');
      setStatus(`Deleted “${selectedProject.name}”.`);
    }, 'Could not delete this project.');
  }

  return <div className="overlay setup-overlay" onClick={() => { if (!busy) onClose(); }}>
    <section className="setup-modal account-settings" role="dialog" aria-modal="true" aria-label="User profile" onClick={event => event.stopPropagation()}>
      <div className="drawer-header"><div><h2>Account settings</h2><p className="account-email">{email}</p></div>
        <button className="button subtle" disabled={busy} onClick={onClose}>Close</button></div>
      <nav className="profile-navigation" aria-label="Account settings">
        {(['Profile', 'Security', 'Data'] as const).map(item => <button key={item} type="button" className="button subtle"
          aria-pressed={section === item} disabled={busy} onClick={() => { setSection(item); setError(''); setStatus(''); }}>{item}</button>)}
      </nav>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {status && <p className="grant-confirmed" role="status">{status}</p>}
      {section === 'Profile' && <form className="profile-form" onSubmit={saveProfile}>
        <label>Display name<input value={name} onChange={event => setName(event.target.value)} maxLength={80} autoComplete="name" disabled={busy} /></label>
        <fieldset disabled={busy}><legend>Workspace mode</legend>
          <label className="check-label"><input type="radio" name="workspace-mode" checked={selected === 'assistant'} onChange={() => setSelected('assistant')} />AI assistant</label>
          <label className="check-label"><input type="radio" name="workspace-mode" checked={selected === 'manual'} onChange={() => setSelected('manual')} />Manual entry</label>
        </fieldset>
        <p>Both modes use your saved operations and purchases.</p>
        <button className="button primary" disabled={busy}>Save preference</button>
      </form>}
      {section === 'Security' && <div className="profile-form">
        {emailLogin ? <>
          <details className="account-section"><summary>Change email address</summary><form className="profile-form" onSubmit={updateEmail}>
            <label>New email address<input type="email" name="email" autoComplete="email" maxLength={320} required disabled={busy} /></label>
            <button className="button subtle" disabled={busy}>Request email change</button>
          </form></details>
          <details className="account-section"><summary>Change password</summary><form className="profile-form" onSubmit={updatePassword}>
            <label>New password<input type="password" name="password" autoComplete="new-password" required disabled={busy} /></label>
            <label>Confirm new password<input type="password" name="confirm-password" autoComplete="new-password" required disabled={busy} /></label>
            <label>Verification code, if required<input name="nonce" autoComplete="one-time-code" inputMode="numeric" disabled={busy} /></label>
            <div className="action-row"><button className="button primary" disabled={busy}>Update password</button>
              <button className="button subtle" type="button" disabled={busy} onClick={() => void run(async () => {
                const { error: failure } = await account.client.auth.reauthenticate();
                if (failure) throw new Error('Could not send a verification code. Try again.');
                setStatus('Check your inbox for the verification code.');
              }, 'Could not send a verification code.')}>Send verification code</button></div>
          </form></details>
        </> : <p>{providers.includes('google') ? 'You sign in with Google. Manage your email and password in your Google Account.' : 'Manage your sign-in credentials with your account provider.'}</p>}
        <section className="account-section"><h3>Sessions</h3><p>Sign out of ReliefOps on other browsers and devices.</p>
          <button className="button subtle" disabled={busy} onClick={async () => {
            if (!await confirm({ title: 'Sign out other sessions?', message: 'This browser will stay signed in.', action: 'Sign out other sessions' })) return;
            await run(async () => {
              const { error: failure } = await account.client.auth.signOut({ scope: 'others' });
              if (failure) throw new Error('Could not sign out the other sessions.');
              setStatus('Other sessions signed out.');
            }, 'Could not sign out the other sessions.');
          }}>Sign out other sessions</button>
        </section>
      </div>}
      {section === 'Data' && <div className="profile-form">
        <section className="account-section"><h3>Saved projects</h3>
          {projects.length ? <div className="profile-form">
            <label>Project to delete<select value={projectId} disabled={busy} onChange={event => setProjectId(event.target.value)}>
              <option value="">Select a project</option>
              {projects.map(project => <option key={project.id} value={project.id}>
                {project.name} · {new Date(project.updated_at).toLocaleString()}{project.id === activeProjectId ? ' · Open' : ''}
              </option>)}
            </select></label>
            <button className="button danger-button" disabled={busy || !selectedProject} onClick={() => void deleteProject()}>Delete selected project</button>
          </div> : <p>You have no saved projects.</p>}
        </section>
        <section className="account-section"><h3>Export your data</h3><p>Download your saved operations, plans, and financial records as JSON.</p>
          <button className="button subtle" disabled={busy} onClick={downloadExport}>Download account data</button></section>
        <details className="account-section account-danger"><summary>Delete account</summary>
          <form className="profile-form" onSubmit={deleteAccount}>
            <p>This permanently deletes your ReliefOps account, saved operations, and records. PayPal retains its own transaction history.</p>
            <label>Enter your account email to confirm<input type="email" value={confirmationEmail} onChange={event => setConfirmationEmail(event.target.value)}
              autoComplete="off" maxLength={320} required disabled={busy} /></label>
            <button className="button danger-button" disabled={busy || !email || confirmationEmail.trim().toLowerCase() !== email.toLowerCase()}>
              {busy ? 'Deleting…' : 'Permanently delete account'}
            </button>
          </form>
        </details>
      </div>}
    </section>
  </div>;
}

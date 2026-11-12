import { useEffect, useRef, useState } from 'react';
import { cloudRequest, fingerprint, type Account, type Operation, type OperationSummary, type SavedPlan } from './cloud';
import { emptyScenario, type Plan, type Scenario } from './types';

type SavedWorkspace = { operation: Operation; plans: SavedPlan[] };

export function useSavedWorkspace(account: Account | null, restore: (scenario: Scenario, plan: Plan | null, plannedScenario: Scenario | null) => void, restoreLatest: boolean) {
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [active, setActive] = useState<Operation | null>(null);
  const [name, setName] = useState('');
  const [history, setHistory] = useState<SavedPlan[]>([]);
  const [savedFingerprint, setSavedFingerprint] = useState('');
  const [initializing, setInitializing] = useState(!!account && restoreLatest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const requestId = useRef(0);
  const client = account?.client;
  const userId = account?.session.user.id;

  useEffect(() => {
    const request = ++requestId.current;
    if (!account) return;
    async function openWorkspace(session: Account) {
      try {
        // The operations endpoint returns the most recently updated operation first.
        const rows = await cloudRequest<OperationSummary[]>(session, '');
        if (request !== requestId.current) return;
        setOperations(rows);
        if (restoreLatest && rows.length) {
          const result = await cloudRequest<SavedWorkspace>(session, `/${rows[0].id}`);
          if (request === requestId.current) install(result.operation, result.plans);
        }
      } catch (err) {
        if (request === requestId.current) setError(err instanceof Error ? err.message : 'Could not open saved operations.');
      } finally {
        if (request === requestId.current) setInitializing(false);
      }
    }
    void openWorkspace(account);
    return () => { requestId.current += 1; };
  }, [client, userId, restoreLatest]);

  function install(operation: Operation, plans: SavedPlan[]) {
    setActive(operation); setName(operation.name); setHistory(plans);
    setSavedFingerprint(fingerprint({ name: operation.name, scenario: operation.scenario }));
    restoreRef.current(operation.scenario, plans[0]?.result ?? null, plans[0]?.scenario ?? null);
  }

  async function load(id: string) {
    if (!account) return;
    setBusy(true); setError('');
    try { const result = await cloudRequest<SavedWorkspace>(account, `/${id}`); install(result.operation, result.plans); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load this operation.'); }
    finally { setBusy(false); }
  }

  async function save(scenario: Scenario): Promise<Operation> {
    if (!account) throw new Error('Sign in to save.');
    if (!name.trim()) throw new Error('Enter an operation name.');
    setBusy(true); setError('');
    try {
      const saved = await cloudRequest<Operation>(account, active ? `/${active.id}` : '', active ? 'PATCH' : 'POST',
        { name: name.trim(), scenario, ...(active ? { expected_revision: active.revision } : {}) });
      setActive(saved);
      setSavedFingerprint(fingerprint({ name: saved.name, scenario: saved.scenario }));
      setOperations(rows => [{ id: saved.id, name: saved.name, revision: saved.revision, updated_at: saved.updated_at }, ...rows.filter(row => row.id !== saved.id)]);
      return saved;
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); throw err; }
    finally { setBusy(false); }
  }

  function fresh() {
    setActive(null); setName(''); setHistory([]); setSavedFingerprint(''); setError('');
    restoreRef.current(emptyScenario(), null, null);
  }

  async function remove(project: OperationSummary) {
    if (!account) throw new Error('Sign in to delete a project.');
    setBusy(true);
    try {
      const revision = active?.id === project.id ? active.revision : project.revision;
      await cloudRequest(account, `/${project.id}`, 'DELETE', { expected_revision: revision });
      setOperations(rows => rows.filter(row => row.id !== project.id));
      if (active?.id === project.id) fresh();
    } finally {
      setBusy(false);
    }
  }

  return { operations, active, name, setName, history, setHistory, initializing, busy, error, setError, load, save, fresh, remove,
    dirty: (scenario: Scenario) => active
      ? fingerprint({ name: name.trim(), scenario }) !== savedFingerprint
      : !!name.trim() || scenario.needs.length > 0 };
}

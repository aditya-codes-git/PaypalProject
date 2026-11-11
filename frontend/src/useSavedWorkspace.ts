import { useEffect, useRef, useState } from 'react';
import { createDemo } from './demo';
import { cloudRequest, fingerprint, type Account, type Operation, type OperationSummary, type SavedPlan } from './cloud';
import type { Plan, Scenario } from './types';

export function useSavedWorkspace(account: Account | null, restore: (scenario: Scenario, plan: Plan | null, plannedScenario: Scenario | null) => void) {
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [active, setActive] = useState<Operation | null>(null);
  const [name, setName] = useState('Riverdale flood response');
  const [history, setHistory] = useState<SavedPlan[]>([]);
  const [savedFingerprint, setSavedFingerprint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const requestId = useRef(0);
  const client = account?.client;

  useEffect(() => {
    const request = ++requestId.current;
    if (!account) return;
    setBusy(true);
    cloudRequest<OperationSummary[]>(account, '').then(rows => {
      if (request === requestId.current) setOperations(rows);
    }).catch(err => { if (request === requestId.current) setError(err.message); })
      .finally(() => { if (request === requestId.current) setBusy(false); });
    return () => { requestId.current += 1; };
  }, [client]);

  function install(operation: Operation, plans: SavedPlan[]) {
    setActive(operation); setName(operation.name); setHistory(plans);
    setSavedFingerprint(fingerprint({ name: operation.name, scenario: operation.scenario }));
    restoreRef.current(operation.scenario, plans[0]?.result ?? null, plans[0]?.scenario ?? null);
  }

  async function load(id: string) {
    if (!account) return;
    setBusy(true); setError('');
    try { const result = await cloudRequest<{ operation: Operation; plans: SavedPlan[] }>(account, `/${id}`); install(result.operation, result.plans); }
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
    setActive(null); setName('Untitled operation'); setHistory([]); setSavedFingerprint(''); setError('');
    restoreRef.current(createDemo(), null, null);
  }

  return { operations, active, name, setName, history, setHistory, busy, error, setError, load, save, fresh,
    dirty: (scenario: Scenario) => fingerprint({ name: name.trim(), scenario }) !== savedFingerprint };
}

import { Icon } from './Icons';
import { Brand } from './Brand';
import { ThemeToggle, useTheme } from './Theme';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import { createDemo } from './demo';
import { money, type Offer, type Plan, type Scenario } from './types';
import { cloudRequest, fingerprint, type Account, type SavedPlan } from './cloud';
import { useSavedWorkspace } from './useSavedWorkspace';
import { ApproveAction, DurableActivity, EvidencePanel, FundingLedger, Purchases, useProcurement } from './Procurement';
import { InputEditor } from './InputEditor';

ModuleRegistry.registerModules([AllCommunityModule]);
const pages = {
  Overview: { title: 'Operation overview', icon: 'overview' },
  'Plan settings': { title: 'Edit needs, offers and funding', icon: 'overview' },
  'Supplier offers': { title: 'Compare supplier offers', icon: 'box' },
  'Funding': { title: 'Manage funding', icon: 'fund' },
  'Grant documents': { title: 'Review grant documents', icon: 'shield' },
  Purchases: { title: 'Approved purchases', icon: 'box' },
  Activity: { title: 'Activity history', icon: 'activity' },
} as const;
type Tab = keyof typeof pages;
const tabs = Object.keys(pages) as Tab[];
type Event = { id: number; time: string; title: string; body: string };
type Integrations = Record<string, { configured: boolean; implemented: boolean }>;

export function App({ account = null, onExit = () => {} }: { account?: Account | null; onExit?: () => void | Promise<void> }) {
  const { theme } = useTheme();
  const gridTheme = useMemo(() => themeQuartz.withParams({ accentColor: '#8b78ed', backgroundColor: theme === 'dark' ? '#111114' : '#ffffff', foregroundColor: theme === 'dark' ? '#ededf0' : '#27272a', borderColor: theme === 'dark' ? '#24242b' : '#e9e9ed', headerBackgroundColor: theme === 'dark' ? '#151519' : '#fafafa', fontFamily: 'Geist Variable, sans-serif', fontSize: 16, rowHeight: 62, headerHeight: 52, wrapperBorderRadius: 7 }), [theme]);
  const [scenario, setScenario] = useState(createDemo);
  const [tab, setTab] = useState<Tab>('Overview');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [plannedSnapshot, setPlannedSnapshot] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const revision = useRef(0);
  const eventSequence = useRef(0);
  const workspace = useSavedWorkspace(account, (next, savedPlan, savedScenario) => {
    revision.current += 1;
    setScenario(next); setPlan(savedPlan); setPlannedSnapshot(savedScenario ? fingerprint(savedScenario) : '');
    setEvents([]); setError(''); setDrawer(false);
  });
  const procurement = useProcurement(account, workspace.active, workspace.history.length);
  const locked = busy || workspace.busy || procurement.busy;
  const stale = !!plan && (fingerprint(scenario) !== plannedSnapshot || plan.finance_version != null && procurement.ledger?.version != null && plan.finance_version !== procurement.ledger.version);
  const hasLedger = !!procurement.ledger && Object.keys(procurement.ledger.balances).length > 0;
  const available = (id: string, draft: number) => hasLedger ? procurement.ledger!.balances[id]?.available_cents ?? 0 : draft;
  const totalFunds = scenario.funds.reduce((sum, fund) => sum + available(fund.id, fund.available_cents), 0);
  const usable = !!plan && !stale && ['OPTIMAL', 'FEASIBLE'].includes(plan.status);
  const fundName = (id: string) => scenario.funds.find(f => f.id === id)?.name ?? id;
  const needName = (id: string) => scenario.needs.find(n => n.id === id)?.name ?? id;
  const isDirty = !!account && workspace.dirty(scenario);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  useEffect(() => {
    if (!account) return;
    const params = new URLSearchParams(window.location.search);
    const operation = params.get('operation');
    if (!operation || !params.has('payment')) return;
    const approved = params.get('payment') === 'approved';
    window.history.replaceState(null, '', window.location.pathname);
    void workspace.load(operation).then(() => {
      setTab('Purchases');
      setError(approved ? 'The buyer returned from PayPal. Select Complete payment to finish the test purchase.' : 'PayPal checkout was closed. Check PayPal status before trying again.');
    });
  }, [account?.session.user.id]);

  function record(title: string, body: string) {
    const event = { id: ++eventSequence.current, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), title, body };
    setEvents(previous => [event, ...previous]);
  }

  function update(next: Scenario, title: string, body: string) {
    revision.current += 1;
    setScenario(next);
    setError('');
    record(title, body);
  }

  async function generate() {
    const input = fingerprint(scenario);
    const requestedRevision = revision.current;
    setBusy(true); setError('');
    try {
      let result: Plan;
      if (account) {
        const saved = await workspace.save(scenario);
        const calculation = await cloudRequest<SavedPlan>(account, `/${saved.id}/plans`, 'POST', { expected_revision: saved.revision });
        result = calculation.result;
        workspace.setHistory(previous => [calculation, ...previous].slice(0, 20));
      } else {
        const response = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: input });
        if (!response.ok) throw new Error(response.status === 422 ? 'Check the quantities and funding values. The planner rejected an invalid input.' : 'The planning service could not complete this request. Try again.');
        result = await response.json();
      }
      if (requestedRevision !== revision.current) { setError('Inputs changed while planning. Generate a fresh plan.'); return; }
      setPlan(result); setPlannedSnapshot(input);
      record(account ? 'Purchasing plan calculated and saved' : 'Purchasing plan calculated', `${result.complete_kits} of ${result.target_kits} complete kits · ${money(result.total_cost_cents)} · ${result.status.toLowerCase()}`);
      if (['OPTIMAL', 'FEASIBLE'].includes(result.status)) setDrawer(true);
      else setError('The solver did not return a usable plan. Adjust the inputs or try again.');
    } catch (err) {
      setError(err instanceof TypeError ? 'Could not reach the planner. Try again in a moment.' : err instanceof Error ? err.message : 'Unexpected planning error.');
    } finally { setBusy(false); }
  }

  function changeOffer(offer: Offer, active: boolean) {
    update({ ...scenario, offers: scenario.offers.map(o => o.id === offer.id ? { ...o, active } : o) }, active ? 'Supplier offer restored' : 'Supplier offer withdrawn', `${offer.supplier} · ${needName(offer.need_id)}. Generate a new plan to use this change.`);
  }

  function reset() {
    if (isDirty && !window.confirm('Discard unsaved edits and reset this scenario?')) return;
    revision.current += 1; setScenario(createDemo()); setPlan(null); setPlannedSnapshot(''); setError(''); setDrawer(false);
    record('Scenario reset', 'Original fictional offers, funding, and needs restored.');
  }

  async function exitWorkspace() {
    if (account && workspace.dirty(scenario) && !window.confirm('Sign out and discard unsaved operation edits?')) return;
    try { await onExit(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sign out. Please try again.'); }
  }

  async function openSetup() {
    setShowSetup(true);
    try { const response = await fetch('/api/integrations'); if (!response.ok) throw new Error(); setIntegrations(await response.json()); }
    catch { setIntegrations(null); }
  }

  const columns: ColDef<Offer>[] = [
    { field: 'supplier', headerName: 'Supplier', minWidth: 210, flex: 1.5 },
    { field: 'need_id', headerName: 'Supply', valueFormatter: params => needName(params.value), minWidth: 150, flex: 1 },
    { field: 'unit_cost_cents', headerName: 'Unit price', valueFormatter: params => money(params.value), width: 115 },
    { field: 'stock', headerName: 'Available', width: 105 },
    { field: 'delivery_days', headerName: 'Delivery', valueFormatter: params => params.value === 1 ? 'Tomorrow' : `${params.value} days`, width: 120 },
    { field: 'active', headerName: 'Plan action', width: 155, cellRenderer: (params: { data: Offer }) => <button disabled={locked} className={`status-toggle ${params.data.active ? 'available' : 'withdrawn'}`} onClick={() => changeOffer(params.data, !params.data.active)} aria-label={`${params.data.active ? 'Withdraw' : 'Restore'} ${params.data.supplier} ${needName(params.data.need_id)}`}>{params.data.active ? 'Exclude offer' : 'Include offer'}</button> },
  ];

  return <div className="app-shell">
    <aside className="sidebar" inert={drawer || showSetup}>
      <a className="brand" href="#" aria-label="ReliefOps overview" onClick={e => { e.preventDefault(); setTab('Overview'); }}><Brand /></a>
      <nav aria-label="Workspace navigation">{tabs.map(name => (
        <button key={name} aria-current={tab === name ? 'page' : undefined} className={`nav-item ${tab === name ? 'selected' : ''}`} onClick={() => setTab(name)}>
          <Icon name={pages[name].icon} /><span>{name}</span>
        </button>
      ))}</nav>
    </aside>

    <div className="main-shell" inert={drawer || showSetup}>
      <header className="topbar">
        {account ? (
          <select className="operation-switcher" aria-label="Saved operation" value={workspace.active?.id ?? ''} disabled={locked} onChange={event => {
            if (isDirty && !window.confirm('Discard unsaved changes and switch operations?')) return;
            if (event.target.value) void workspace.load(event.target.value);
            else { workspace.fresh(); setTab('Overview'); }
          }}>
            <option value="">{workspace.active ? '+ New operation' : 'New operation'}</option>
            {workspace.operations.map(operation => <option value={operation.id} key={operation.id}>{operation.name}</option>)}
          </select>
        ) : <strong className="sample-label">Sample workspace</strong>}
        <div className="topbar-right">
          <ThemeToggle />
          <button className="text-button" onClick={exitWorkspace} disabled={locked}>{account ? 'Sign out' : 'Sign in'}</button>
          <button className="icon-button" onClick={openSetup} aria-label="Open integration setup" title="Service status"><Icon name="fund" size={19} /></button>
        </div>
      </header>
      <main>
        <div className="page-heading"><h1>{pages[tab].title}</h1>
          {tab === 'Overview' && <button className="button planner-button" onClick={generate} disabled={locked}>{busy ? 'Building plan…' : 'Generate purchasing plan'}<Icon name="arrow" size={18} /></button>}
          {tab === 'Funding' && <button className="button subtle" onClick={() => setTab('Grant documents')}>Review grant documents<Icon name="arrow" size={16} /></button>}
        </div>
        {account && tab === 'Overview' && <section className="cloud-toolbar" aria-label="Saved operations">
          <div className="cloud-controls">
            <label>Operation name<input maxLength={100} value={workspace.name} disabled={locked} onChange={event => workspace.setName(event.target.value)} /></label>
            <button className="button primary" disabled={locked || !workspace.name.trim()} onClick={() => { void workspace.save(scenario).catch(() => {}); }}>{workspace.busy ? 'Saving…' : 'Save operation'}</button>
            {workspace.active && isDirty && <button className="text-button" disabled={locked} onClick={() => {
              if (window.confirm('Discard changes since your last save?')) void workspace.load(workspace.active!.id);
            }}>Discard changes</button>}
            {workspace.active && <span className="save-status" role="status">{isDirty ? 'Unsaved changes' : 'Saved'}</span>}
          </div>
        </section>}
        {account && workspace.active && isDirty && tab !== 'Overview' && <div className="inline-save">
          <span>Unsaved changes</span>
          <button className="button subtle" disabled={locked || !workspace.name.trim()} onClick={() => { void workspace.save(scenario).catch(() => {}); }}>Save operation</button>
        </div>}
        {workspace.error && <div className="error-banner" role="alert">{workspace.error}</div>}
        {tab === 'Overview' && <div className="overview-intro">
          <p>{account ? 'See what you can buy with your funding, supplier stock and delivery deadline.' : 'Plan a flood response with sample data. Sign in to save your own operation.'}</p>
          {!account && <button className="text-button" onClick={reset} disabled={locked}>Reset sample</button>}
        </div>}
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close" size={16} /></button></div>}
        {stale && (tab === 'Overview' || tab === 'Supplier offers' || tab === 'Funding') && <div className="warning-banner" role="status">Your plan is out of date. Generate a new one with your changes.</div>}

        {tab === 'Overview' && <>
          <section className="stats" aria-label="Operation summary">
            <Stat label="Households to reach" value={String(scenario.target_kits)} icon="box" />
            <Stat label="Available funding" value={money(totalFunds)} icon="fund" />
            <Stat label="Delivery deadline" value={scenario.deadline_days === 0 ? 'Today' : scenario.deadline_days === 1 ? 'Tomorrow' : `${scenario.deadline_days} days`} icon="clock" />
            <Stat label="Households covered" value={usable ? `${Math.round(plan!.complete_kits / scenario.target_kits * 100)}%` : '—'} detail={usable ? `${plan!.complete_kits} of ${scenario.target_kits} households` : stale ? 'Plan is out of date' : 'No plan yet'} icon="shield" />
          </section>

          <div className="overview-grid"><section className="card needs-card"><div className="card-heading"><div><h2>Supplies needed</h2></div><button className="text-button" onClick={() => setTab('Plan settings')}>Edit supplies<Icon name="arrow" size={16} /></button></div><div className="needs-list">{scenario.needs.map((need, index) => <div className="need-row" key={need.id}><span className={`need-icon tone-${index}`}><Icon name={index === 0 ? 'box' : index === 1 ? 'leaf' : 'shield'} size={22} /></span><div><strong>{need.name}</strong><small>{need.quantity} per household · {need.category}</small></div><div className="need-quantity"><strong>{need.quantity * scenario.target_kits}</strong><small>units needed</small></div></div>)}</div><div className="scenario-controls"><label>Households<input disabled={locked} aria-label="Households to reach" type="number" min="1" max="100" value={scenario.target_kits} onChange={e => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 1 && value <= 100) update({ ...scenario, target_kits: value }, 'Needs updated', `Target changed to ${value} complete kits.`); }} /></label><label>Deadline<select disabled={locked} aria-label="Delivery deadline" value={scenario.deadline_days} onChange={e => update({ ...scenario, deadline_days: Number(e.target.value) }, 'Deadline updated', `Delivery window changed to ${e.target.value} days.`)}>{![1, 2, 5].includes(scenario.deadline_days) && <option value={scenario.deadline_days}>{scenario.deadline_days === 0 ? 'Today' : `Within ${scenario.deadline_days} days`}</option>}<option value={1}>Within 1 day</option><option value={2}>Within 2 days</option><option value={5}>Within 5 days</option></select></label></div></section>

          <section className="card"><div className="card-heading"><div><h2>Available funding by source</h2></div><button className="text-button" onClick={() => setTab('Funding')}>Manage funding <Icon name="arrow" size={16} /></button></div><div className="fund-preview">{scenario.funds.map((fund, index) => <div className="fund-preview-item" key={fund.id}><span className={`fund-dot fund-${index}`} /><div><strong>{fund.name}</strong><small>{`Can pay for: ${fund.categories.join(', ')}`}</small></div><strong>{money(available(fund.id, fund.available_cents))}</strong></div>)}</div></section>
          </div>
          {plan && <section className="result-strip"><span className="result-icon"><Icon name="check" /></span><div><strong>{stale ? 'Previous plan is out of date' : `${plan.complete_kits} complete kits planned for ${money(plan.total_cost_cents)}`}</strong></div><button className="button subtle" disabled={stale || busy || !usable} onClick={() => setDrawer(true)}>Review plan <Icon name="arrow" size={16} /></button></section>}
        </>}

        {tab === 'Supplier offers' && <section className="card"><div className="card-heading"><div><h2>Available stock and prices</h2><p>Exclude an offer if the supplier can no longer deliver, then generate a new plan.</p></div><button className="button primary" onClick={generate} disabled={locked}>{busy ? 'Calculating…' : 'Generate plan'}<Icon name="arrow" size={16} /></button></div><div className="grid-wrap"><AgGridReact<Offer> theme={gridTheme} rowData={scenario.offers} columnDefs={columns} defaultColDef={{ sortable: true, resizable: true }} getRowId={params => params.data.id} domLayout="autoHeight" /></div><div className="card-footnote">The plan skips offers that arrive after your delivery deadline.</div></section>}

        {tab === 'Funding' && <div className="funds-editor">{scenario.funds.map((fund, index) => <section className="card fund-editor" key={fund.id}><div className="fund-editor-heading"><span className={`need-icon tone-${index}`}><Icon name="fund" /></span><span className="tag">{fund.confirmed ? 'Ready to use' : 'Needs confirmation'}</span></div><h2>{fund.name}</h2><p>Can pay for: {fund.categories.join(', ')}.</p><label>Budget (USD)<input disabled={locked || !!procurement.ledger?.balances[fund.id]} aria-label={`${fund.name} amount`} type="number" min="0" max="1000000" step="0.01" value={(procurement.ledger?.balances[fund.id]?.opening_cents ?? fund.available_cents) / 100} onChange={e => { const amount = Number(e.target.value); if (Number.isFinite(amount) && amount >= 0 && amount <= 1000000) update({ ...scenario, funds: scenario.funds.map(f => f.id === fund.id ? { ...f, available_cents: Math.round(amount * 100) } : f) }, 'Funding balance updated', `${fund.name}: ${money(Math.round(amount * 100))}.`); }} /></label>{hasLedger && <p className="fund-editor-note">{money(available(fund.id, 0))} left to spend</p>}</section>)}<div className="fund-action"><button className="button primary" onClick={generate} disabled={locked}>{busy ? 'Calculating…' : 'Generate plan with these funds'}<Icon name="arrow" size={16} /></button></div></div>}

        {tab === 'Activity' && <section className="card"><div className="card-heading"><div><h2>Changes in this session</h2></div></div>{events.length === 0 ? <div className="empty-state"><Icon name="activity" size={32} /><h3>No changes yet</h3><p>Changes and new plans will appear here.</p></div> : <ol className="activity-list">{events.map(event => <li key={event.id}><span className="activity-dot" /><div><strong>{event.title}</strong><p>{event.body}</p></div><time>{event.time}</time></li>)}</ol>}</section>}

        {tab === 'Plan settings' && <InputEditor scenario={scenario} disabled={locked} onApply={next => update(next, 'Operation inputs updated', 'Needs, funding rules and supplier offers changed. Save and calculate a fresh plan.')} />}
        {tab === 'Purchases' && (account && workspace.active ? <Purchases procurement={procurement} operation={workspace.active} clean={!isDirty} onPlan={() => setTab('Overview')} /> : <section className="card empty-state"><h2>Save an operation to manage purchases</h2><p>Approved items appear here, ready for test checkout.</p><button className="button primary" onClick={account ? () => setTab('Overview') : exitWorkspace}>{account ? 'Go to overview' : 'Sign in'}</button></section>)}
        {tab === 'Grant documents' && (account && workspace.active ? <EvidencePanel procurement={procurement} operation={workspace.active} clean={!isDirty} reload={() => workspace.load(workspace.active!.id)} /> : <section className="card empty-state"><h2>Save an operation to upload a grant</h2><p>Upload a document to find the grant amount and what it can pay for.</p><button className="button primary" onClick={account ? () => setTab('Overview') : exitWorkspace}>{account ? 'Go to overview' : 'Sign in'}</button></section>)}
        {tab === 'Activity' && account && workspace.active && <DurableActivity procurement={procurement} />}
        {tab === 'Funding' && account && workspace.active && !isDirty && <FundingLedger procurement={procurement} operation={workspace.active} />}
        {tab === 'Overview' && account && workspace.history.length > 0 && <section className="card saved-history"><div className="card-heading"><div><h2>Previous plans</h2></div></div>{workspace.history.map(calculation => <button className="history-row" key={calculation.id} onClick={() => { setPlan(calculation.result); setPlannedSnapshot(fingerprint(calculation.scenario)); setDrawer(true); }}><span><strong>{calculation.result.complete_kits} complete kits</strong><small>{new Date(calculation.created_at).toLocaleString()}</small></span><strong>{money(calculation.result.total_cost_cents)}</strong><Icon name="arrow" size={16} /></button>)}</section>}
      </main>
    </div>

    {drawer && plan && <div className="overlay" onClick={() => setDrawer(false)}><section className="drawer" role="dialog" aria-modal="true" aria-label="Purchasing plan" onClick={e => e.stopPropagation()}><div className="drawer-header"><h2>Purchasing plan</h2><button className="icon-button" onClick={() => setDrawer(false)} aria-label="Close purchasing plan"><Icon name="close" /></button></div>{stale && <p className="warning-banner">This plan is out of date. Generate a new plan to approve purchases.</p>}<div className="plan-summary"><div><strong>{plan.complete_kits}<small> / {plan.target_kits}</small></strong><span>complete kits</span></div><div><strong>{money(plan.total_cost_cents)}</strong><span>total planned cost</span></div></div>{plan.status === 'FEASIBLE' && <p className="plan-caveat">This plan meets your rules. A lower-cost plan may be possible.</p>}<div className="plan-lines">{plan.purchases.map(p => <article key={p.offer_id}><div className="purchase-heading"><div><h3>{needName(p.need_id)}</h3><p>{p.supplier} · {p.quantity} units</p></div><strong>{money(p.cost_cents)}</strong></div>{p.allocations.map(allocation => <div className="allocation" key={allocation.fund_id}><Icon name="fund" size={14} /><span>{fundName(allocation.fund_id)}</span><strong>{money(allocation.amount_cents)}</strong></div>)}</article>)}</div>{Object.values(plan.unmet).some(n => n > 0) && <div className="warning-banner"><strong>Supplies still needed</strong><p>{Object.entries(plan.unmet).filter(([, count]) => count > 0).map(([id, count]) => `${count} ${needName(id).toLowerCase()}s`).join(' · ')}</p></div>}{account ? <ApproveAction procurement={procurement} plan={plan} operation={workspace.active} disabled={locked || stale || isDirty} onApproved={() => { setDrawer(false); setTab('Purchases'); }} /> : <div className="payment-placeholder"><Icon name="shield" size={20} /><div><strong>Sign in to approve purchases</strong></div></div>}<button className="button subtle full-width" onClick={() => setDrawer(false)}>Back to workspace<Icon name="arrow" size={16} /></button></section></div>}

    {showSetup && <div className="overlay setup-overlay" onClick={() => setShowSetup(false)}><section className="setup-modal" role="dialog" aria-modal="true" aria-label="Integration setup" onClick={e => e.stopPropagation()}><div className="drawer-header"><h2>Service status</h2><button className="icon-button" onClick={() => setShowSetup(false)} aria-label="Close integration setup"><Icon name="close" /></button></div>{['groq', 'supabase', 'paypal'].map(name => <div className="integration-row" key={name}><strong>{name === 'groq' ? 'Groq AI' : name === 'paypal' ? 'PayPal sandbox' : 'Supabase'}</strong><span>{integrations?.[name]?.configured && integrations?.[name]?.implemented ? 'Configured' : integrations?.[name]?.configured ? 'Unavailable' : 'Status unavailable'}</span></div>)}<p className="setup-note">These settings show which services are configured for this workspace.</p><button className="button primary full-width" onClick={() => setShowSetup(false)}>Got it</button></section></div>}
    <ModalKeyboard open={drawer || showSetup} close={() => { setDrawer(false); setShowSetup(false); }} />
  </div>;
}

function Stat({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon: string }) {
  return <article className="stat"><div><span>{label}</span><Icon name={icon} size={18} /></div><strong>{value}</strong>{detail && <p>{detail}</p>}</article>;
}

function ModalKeyboard({ close, open }: { close: () => void; open: boolean }) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')];
    focusable()[0]?.focus();
    function handle(event: KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return null;
}

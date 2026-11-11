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
const tabs = ['Overview', 'Supplier offers', 'Funding pools', 'Activity', 'Purchases', 'Evidence', 'Operation inputs'] as const;
type Tab = typeof tabs[number];
type Event = { id: number; time: string; title: string; body: string };
type Integrations = Record<string, { configured: boolean; implemented: boolean }>;

export function App({ account = null, onExit = () => {} }: { account?: Account | null; onExit?: () => void | Promise<void> }) {
  const { theme } = useTheme();
  const gridTheme = useMemo(() => themeQuartz.withParams({ accentColor: '#8b78ed', backgroundColor: theme === 'dark' ? '#111114' : '#ffffff', foregroundColor: theme === 'dark' ? '#ededf0' : '#27272a', borderColor: theme === 'dark' ? '#24242b' : '#e9e9ed', headerBackgroundColor: theme === 'dark' ? '#151519' : '#fafafa', fontFamily: 'Geist Variable, sans-serif', fontSize: 14, rowHeight: 62, headerHeight: 46, wrapperBorderRadius: 7 }), [theme]);
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
      setError(approved ? 'PayPal buyer approval returned. Review the purchase and capture the approved payment.' : 'PayPal checkout was closed. Its reservation remains protected; reconcile the order.');
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
      setError(err instanceof TypeError ? 'Cannot reach the backend. Start the API on port 8000, then try again.' : err instanceof Error ? err.message : 'Unexpected planning error.');
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
    { field: 'active', headerName: 'Offer status', width: 155, cellRenderer: (params: { data: Offer }) => <button disabled={locked} className={`status-toggle ${params.data.active ? 'available' : 'withdrawn'}`} onClick={() => changeOffer(params.data, !params.data.active)} aria-label={`${params.data.active ? 'Withdraw' : 'Restore'} ${params.data.supplier} ${needName(params.data.need_id)}`}>{params.data.active ? '● Available' : '○ Withdrawn'}</button> },
  ];

  return <div className="app-shell">
    <aside className="sidebar" inert={drawer || showSetup}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('Overview'); }}><Brand /><span className="beta-badge">BETA</span></a>
      <div className="workspace-label">Your organization</div>
      <div className="workspace-card"><span className="workspace-avatar">CR</span><div><strong>Common Ground Relief</strong><small>Fictional organization</small></div></div>
      <div className="nav-label">Workspace</div><nav aria-label="Workspace navigation">{tabs.map((name, index) => <button key={name} aria-label={name} aria-current={tab === name ? 'page' : undefined} className={`nav-item ${tab === name ? 'selected' : ''}`} onClick={() => setTab(name)}><Icon name={['overview', 'box', 'fund', 'activity', 'box', 'shield', 'overview'][index]} /><span>{name}</span>{name === 'Supplier offers' && <small>{scenario.offers.length}</small>}</button>)}</nav>
      <div className="sidebar-note"><span className="mini-label"><Icon name="shield" size={13} />SANDBOX ENVIRONMENT</span><h3>Plan with confidence.</h3><p>Test purchasing decisions without moving real money.</p></div>
      <button className="sidebar-bottom" onClick={openSetup}><span className="avatar">A</span><span><strong>{account ? 'Private workspace' : 'Sample workspace'}</strong><small>Integration setup</small></span><span className="chevron">↗</span></button>
    </aside>

    <div className="main-shell" inert={drawer || showSetup}>
      <header className="topbar"><div className="breadcrumb">Operations <span>/</span> <strong>{account ? workspace.name : 'Flood response'}</strong></div><div className="topbar-right"><ThemeToggle /><span className="demo-label"><span />{account ? 'Private workspace' : 'Sample workspace'}</span><button className="text-button" onClick={exitWorkspace} disabled={locked}>{account ? 'Sign out' : 'Sign in'}</button><button className="icon-button" onClick={openSetup} aria-label="Open integration setup"><Icon name="fund" size={19} /></button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span />ACTIVE OPERATION <span className="eyebrow-separator">/</span> DEMO-001</div><h1>{tab === 'Overview' ? 'Operation overview' : tab}</h1><p>{tab === 'Overview' ? 'Manage needs, compare offers, and make your next purchasing decision.' : tab === 'Supplier offers' ? 'Compare reported availability and test what happens when an offer changes.' : tab === 'Funding pools' ? 'Keep restricted funding aligned with the purpose it was given for.' : 'A session record of inputs changed and plans calculated.'}</p></div><button className="button subtle" onClick={reset} disabled={locked}><Icon name="reset" size={16} />Reset scenario</button></div>

        {account && <section className="cloud-toolbar" aria-label="Saved operations"><div className="cloud-controls"><label>Saved operations<select aria-label="Saved operation" value={workspace.active?.id ?? ''} disabled={locked} onChange={event => { if (event.target.value && (!workspace.dirty(scenario) || window.confirm('Discard unsaved edits and load the saved operation?'))) void workspace.load(event.target.value); }}><option value="">New operation</option>{workspace.operations.map(operation => <option value={operation.id} key={operation.id}>{operation.name}</option>)}</select></label><label>Operation name<input aria-label="Operation name" maxLength={100} value={workspace.name} disabled={locked} onChange={event => workspace.setName(event.target.value)} /></label><button className="button primary" disabled={locked || !workspace.name.trim()} onClick={() => { void workspace.save(scenario).catch(() => {}); }}>{workspace.busy ? 'Working…' : 'Save operation'}</button><button className="button subtle" disabled={locked} onClick={() => { if (!workspace.dirty(scenario) || window.confirm('Discard unsaved edits and start a new operation?')) workspace.fresh(); }}>New</button>{workspace.active && <button className="text-button" disabled={locked} onClick={() => { if (!workspace.dirty(scenario) || window.confirm('Discard unsaved edits and reload the saved version?')) void workspace.load(workspace.active!.id); }}>Reload saved</button>}</div><p role="status">{workspace.active ? `Saved revision ${workspace.active.revision}` : 'New operation'} · {workspace.dirty(scenario) ? 'Unsaved changes' : 'All operation inputs saved'} · {account.session.user.email}</p>{workspace.error && <div className="error-banner" role="alert">{workspace.error}</div>}</section>}
        <section className="operation-banner"><span className="operation-icon"><Icon name="box" size={23} /></span><div><strong>{account ? workspace.name : 'Riverdale flood response'}</strong><p>Synthetic scenario · 1 food pack, 1 blanket, 1 hygiene kit per household</p></div><span className="location-tag">{account ? 'USD · Private operation' : 'USD · Local demo'}</span></section>

        <div className="notice"><Icon name="shield" size={16} /><span>{account ? 'Private operation · PayPal sandbox only · Verify reported supplier information and confirm AI proposals before use.' : 'Sample workspace: fictional data, no saved changes, no payments. Sign in to keep your operations.'}</span></div>
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close" size={16} /></button></div>}
        {stale && <div className="warning-banner" role="status">Inputs have changed. The previous plan is out of date; generate a new plan before reviewing it.</div>}

        {tab === 'Overview' && <>
          <section className="stats" aria-label="Operation summary">
            <Stat label="HOUSEHOLDS TO REACH" value={String(scenario.target_kits)} detail="One complete kit per household" icon="box" />
            <Stat label="AVAILABLE FUNDING" value={money(totalFunds)} detail={`${scenario.funds.length} funding pools · uncommitted`} icon="fund" />
            <Stat label="DELIVERY WINDOW" value={scenario.deadline_days === 1 ? 'Tomorrow' : `${scenario.deadline_days} days`} detail="Reported supplier delivery" icon="clock" />
            <Stat label="PLANNED COVERAGE" value={usable ? `${Math.round(plan!.complete_kits / scenario.target_kits * 100)}%` : '—'} detail={usable ? `${plan!.complete_kits} kits · includes existing commitments` : stale ? 'Plan needs recalculation' : 'Generate a purchasing plan'} icon="shield" />
          </section>

          <div className="overview-grid"><section className="card needs-card"><div className="card-heading"><div><h2>Supply requirements</h2><p>The essentials for every household.</p></div><span className="tag">{scenario.needs.length} essentials</span></div><div className="needs-list">{scenario.needs.map((need, index) => <div className="need-row" key={need.id}><span className={`need-icon tone-${index}`}><Icon name={index === 0 ? 'box' : index === 1 ? 'leaf' : 'shield'} size={22} /></span><div><strong>{need.name}</strong><small>{need.quantity} per household · {need.category}</small></div><div className="need-quantity"><strong>{need.quantity * scenario.target_kits}</strong><small>units needed</small></div></div>)}</div><div className="scenario-controls"><label>Households<input disabled={locked} aria-label="Households to reach" type="number" min="1" max="100" value={scenario.target_kits} onChange={e => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 1 && value <= 100) update({ ...scenario, target_kits: value }, 'Needs updated', `Target changed to ${value} complete kits.`); }} /></label><label>Deadline<select disabled={locked} aria-label="Delivery deadline" value={scenario.deadline_days} onChange={e => update({ ...scenario, deadline_days: Number(e.target.value) }, 'Deadline updated', `Delivery window changed to ${e.target.value} days.`)}><option value={1}>Within 1 day</option><option value={2}>Within 2 days</option><option value={5}>Within 5 days</option></select></label></div></section>

          <section className="planner-card"><div className="planner-top"><span className="planner-symbol"><Icon name="activity" size={27} /></span><span className="planner-chip">PURCHASING PLANNER</span></div><h2>Your next move, calculated.</h2><p>Build a feasible plan across eligible funds, available stock, and your delivery deadline.</p><ul><li><Icon name="check" size={16} />Funding restrictions checked</li><li><Icon name="check" size={16} />Complete kits prioritized</li><li><Icon name="check" size={16} />Known costs minimized</li></ul><button className="button planner-button" onClick={generate} disabled={locked}>{busy ? 'Calculating your plan…' : plan ? 'Recalculate plan' : 'Generate purchasing plan'}{!busy && <Icon name="arrow" size={18} />}</button><small>Funding, availability, and deadlines checked</small></section></div>

          <section className="card"><div className="card-heading"><div><h2>Funding allocation</h2><p>Available balances and the categories they can support.</p></div><button className="text-button" onClick={() => setTab('Funding pools')}>Manage pools <Icon name="arrow" size={16} /></button></div><div className="fund-preview">{scenario.funds.map((fund, index) => <div className="fund-preview-item" key={fund.id}><span className={`fund-dot fund-${index}`} /><div><strong>{fund.name}</strong><small>{fund.categories.length === 3 ? 'Flexible · all operation categories' : `${fund.categories.join(', ')} only`}</small></div><strong>{money(available(fund.id, fund.available_cents))}</strong></div>)}</div></section>
          {plan && <section className="result-strip"><span className="result-icon"><Icon name="check" /></span><div><strong>{stale ? 'Previous plan is out of date' : `${plan.complete_kits} complete kits planned for ${money(plan.total_cost_cents)}`}</strong><p>{stale ? 'Recalculate with your updated inputs.' : `${plan.status.toLowerCase()} result · calculated in ${plan.elapsed_ms} ms · no money moved`}</p></div><button className="button subtle" disabled={stale || busy || !usable} onClick={() => setDrawer(true)}>Review plan <Icon name="arrow" size={16} /></button></section>}
        </>}

        {tab === 'Supplier offers' && <section className="card"><div className="card-heading"><div><h2>Offers on the table</h2><p>Use the status button to withdraw an offer, then recalculate.</p></div><button className="button primary" onClick={generate} disabled={locked}>{busy ? 'Calculating…' : 'Generate plan'}<Icon name="arrow" size={16} /></button></div><div className="grid-wrap"><AgGridReact<Offer> theme={gridTheme} rowData={scenario.offers} columnDefs={columns} defaultColDef={{ sortable: true, resizable: true }} getRowId={params => params.data.id} domLayout="autoHeight" /></div><div className="card-footnote">Prices are fictional all-in demo unit costs. Offers arriving after the selected deadline are automatically excluded.</div></section>}

        {tab === 'Funding pools' && <div className="funds-editor">{scenario.funds.map((fund, index) => <section className="card fund-editor" key={fund.id}><div className="fund-editor-heading"><span className={`need-icon tone-${index}`}><Icon name="fund" /></span><span className="tag">{fund.confirmed ? 'Confirmed rule' : 'Unconfirmed · excluded'}</span></div><h2>{fund.name}</h2><p>Eligible: {fund.categories.join(', ')}.</p><label>Available amount (USD)<input disabled={locked} aria-label={`${fund.name} amount`} type="number" min="0" max="1000000" step="0.01" value={fund.available_cents / 100} onChange={e => { const amount = Number(e.target.value); if (Number.isFinite(amount) && amount >= 0 && amount <= 1000000) update({ ...scenario, funds: scenario.funds.map(f => f.id === fund.id ? { ...f, available_cents: Math.round(amount * 100) } : f) }, 'Funding balance updated', `${fund.name}: ${money(Math.round(amount * 100))}.`); }} /></label><div className="fund-editor-note"><Icon name="shield" size={15} />{hasLedger ? `${money(available(fund.id, 0))} uncommitted. Use recorded adjustments to change the opening allocation.` : 'Application allocation, not a verified PayPal balance.'}</div></section>)}<div className="fund-action"><button className="button primary" onClick={generate} disabled={locked}>{busy ? 'Calculating…' : 'Generate plan with these funds'}<Icon name="arrow" size={16} /></button></div></div>}

        {tab === 'Activity' && <section className="card"><div className="card-heading"><div><h2>Decision history</h2><p>Local session activity only. Refreshing clears this record.</p></div><span className="tag">{events.length} events</span></div>{events.length === 0 ? <div className="empty-state"><Icon name="activity" size={32} /><h3>Your operation starts here.</h3><p>Generate a plan or change an input to see an activity record.</p></div> : <ol className="activity-list">{events.map(event => <li key={event.id}><span className="activity-dot" /><div><strong>{event.title}</strong><p>{event.body}</p></div><time>{event.time}</time></li>)}</ol>}</section>}

        {tab === 'Operation inputs' && <InputEditor scenario={scenario} disabled={locked} onApply={next => update(next, 'Operation inputs updated', 'Needs, funding rules and supplier offers changed. Save and calculate a fresh plan.')} />}
        {tab === 'Purchases' && (account && workspace.active ? <Purchases procurement={procurement} operation={workspace.active} clean={!isDirty} /> : <section className="card empty-state"><h2>Save an operation to manage purchases</h2><p>Sign in, save your inputs, then generate and approve a plan.</p></section>)}
        {tab === 'Evidence' && (account && workspace.active ? <EvidencePanel procurement={procurement} operation={workspace.active} clean={!isDirty} reload={() => workspace.load(workspace.active!.id)} /> : <section className="card empty-state"><h2>Save an operation to add evidence</h2><p>Sign in and save your operation before uploading funding terms.</p></section>)}
        {tab === 'Activity' && account && workspace.active && <DurableActivity procurement={procurement} />}
        {tab === 'Funding pools' && account && workspace.active && !isDirty && <FundingLedger procurement={procurement} operation={workspace.active} />}
        {account && workspace.history.length > 0 && <section className="card saved-history"><div className="card-heading"><div><h2>Saved calculations</h2><p>Input snapshots and results remain available after refresh. These are calculations, not spending approvals.</p></div><span className="tag">{workspace.history.length} recent</span></div>{workspace.history.map(calculation => <button className="history-row" key={calculation.id} onClick={() => { setPlan(calculation.result); setPlannedSnapshot(fingerprint(calculation.scenario)); setDrawer(true); }}><span><strong>Revision {calculation.input_revision} · {calculation.result.complete_kits} kits</strong><small>{new Date(calculation.created_at).toLocaleString()}</small></span><strong>{money(calculation.result.total_cost_cents)}</strong><Icon name="arrow" size={16} /></button>)}</section>}
        <footer><span><Icon name="leaf" size={14} />ReliefOps · Purpose in every purchase.</span><span>{account ? 'Private saved workspace · Sandbox procurement' : 'Local planning prototype · $0 services required to calculate'}</span></footer>
      </main>
    </div>

    {drawer && plan && <div className="overlay" onClick={() => setDrawer(false)}><section className="drawer" role="dialog" aria-modal="true" aria-label="Purchasing plan" onClick={e => e.stopPropagation()}><div className="drawer-header"><div><div className="eyebrow">PURCHASING PLAN</div><h2>Purchasing plan</h2></div><button className="icon-button" onClick={() => setDrawer(false)} aria-label="Close purchasing plan"><Icon name="close" /></button></div><span className={`tag ${stale ? 'amber' : ''}`}>{stale ? 'Out of date' : plan.status === 'OPTIMAL' ? 'Optimal for the confirmed inputs' : plan.status}</span><div className="plan-summary"><div><strong>{plan.complete_kits}<small> / {plan.target_kits}</small></strong><span>complete kits</span></div><div><strong>{money(plan.total_cost_cents)}</strong><span>total planned cost</span></div></div><div className="plan-lines">{plan.purchases.map(p => <article key={p.offer_id}><div className="purchase-heading"><div><h3>{needName(p.need_id)}</h3><p>{p.supplier} · {p.quantity} units</p></div><strong>{money(p.cost_cents)}</strong></div>{p.allocations.map(allocation => <div className="allocation" key={allocation.fund_id}><Icon name="fund" size={14} /><span>{fundName(allocation.fund_id)}</span><strong>{money(allocation.amount_cents)}</strong></div>)}</article>)}</div>{Object.values(plan.unmet).some(n => n > 0) && <div className="warning-banner"><strong>Some needs remain unmet.</strong><p>{Object.entries(plan.unmet).filter(([, count]) => count > 0).map(([id, count]) => `${count} ${needName(id).toLowerCase()}s`).join(' · ')}</p></div>}<div className="plan-notes">{plan.notes.map(note => <p key={note}>{note}</p>)}</div>{account ? <ApproveAction procurement={procurement} plan={plan} operation={workspace.active} disabled={locked || stale || isDirty} onApproved={() => { setDrawer(false); setTab('Purchases'); }} /> : <div className="payment-placeholder"><Icon name="shield" size={20} /><div><strong>Sign in to approve purchases</strong><p>Sample calculations reserve no funding and move no money.</p></div></div>}<button className="button primary full-width" onClick={() => setDrawer(false)}>Back to workspace<Icon name="arrow" size={16} /></button><small className="plan-id">Plan {plan.id.slice(0, 8)} · input {plan.input_digest.slice(0, 12)}</small></section></div>}

    {showSetup && <div className="overlay setup-overlay" onClick={() => setShowSetup(false)}><section className="setup-modal" role="dialog" aria-modal="true" aria-label="Integration setup" onClick={e => e.stopPropagation()}><div className="drawer-header"><h2>Your integration setup</h2><button className="icon-button" onClick={() => setShowSetup(false)} aria-label="Close integration setup"><Icon name="close" /></button></div><p>Your local <code>.env</code> file is in the project root. Use <code>.env.example</code> for variable names. Keep secret keys out of chat and Git.</p>{['groq', 'supabase', 'paypal'].map(name => <div className="integration-row" key={name}><strong>{name === 'groq' ? 'Groq AI' : name === 'paypal' ? 'PayPal sandbox' : 'Supabase'}</strong><span>{integrations?.[name]?.configured && integrations?.[name]?.implemented ? 'Configured · integration available' : integrations?.[name]?.configured ? 'Configuration present · not connected' : 'Not connected'}</span></div>)}<p className="setup-note">Authenticated operations support evidence review, approvals, funding commitments and PayPal sandbox checkout. Configuration presence does not verify provider connectivity. The sample planner works without credentials.</p><button className="button primary full-width" onClick={() => setShowSetup(false)}>Got it</button></section></div>}
    <ModalKeyboard open={drawer || showSetup} close={() => { setDrawer(false); setShowSetup(false); }} />
  </div>;
}

function Stat({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: string }) {
  return <article className="stat"><div><span>{label}</span><Icon name={icon} size={18} /></div><strong>{value}</strong><p>{detail}</p></article>;
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

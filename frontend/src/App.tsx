import { Icon } from './Icons';
import { Brand } from './Brand';
import { ThemeToggle, useTheme } from './Theme';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import { emptyScenario, money, type Offer, type Plan, type Scenario } from './types';
import { cloudRequest, fingerprint, type Account, type OperationSummary, type SavedPlan } from './cloud';
import { useSavedWorkspace } from './useSavedWorkspace';
import { ApproveAction, DurableActivity, EvidencePanel, FundingLedger, Purchases, purchaseStatusLabel, useProcurement } from './Procurement';
import { InputEditor } from './InputEditor';
import { useConfirmation } from './Confirmation';
import { FundingReport } from './Fulfillment';
import { assistantAction, draftOffer, draftScenario, loadAssistantThreads, saveAssistantThreads, WorkspaceAssistant, type AssistantReply } from './WorkspaceAssistant';
import { WorkspaceProfile, type WorkspaceMode } from './WorkspaceProfile';

ModuleRegistry.registerModules([AllCommunityModule]);
const pages = {
  Overview: { title: 'Operation overview', icon: 'overview' },
  'Plan settings': { title: 'Edit needs, offers and funding', icon: 'overview' },
  'Supplier offers': { title: 'Compare supplier offers', icon: 'box' },
  'Funding': { title: 'Manage funding', icon: 'fund' },
  'Grant documents': { title: 'Review grant documents', icon: 'shield' },
  Purchases: { title: 'Approved purchases', icon: 'box' },
  Reports: { title: 'Operation reports', icon: 'fund' },
  Activity: { title: 'Activity history', icon: 'activity' },
} as const;
type Tab = keyof typeof pages;
const tabs = Object.keys(pages) as Tab[];
type Event = { id: number; time: string; title: string; body: string };
type Integrations = Record<string, { configured: boolean; implemented: boolean }>;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const sidebarPreference = 'reliefops-sidebar-collapsed';

function initialSidebarState() {
  try {
    const saved = localStorage.getItem(sidebarPreference);
    if (saved !== null) return saved === 'true';
  } catch { /* Browser storage may be unavailable. */ }
  return false;
}

function readCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const operation = params.get('operation');
  const payment = params.get('payment');
  if (!operation || !uuid.test(operation) || (payment !== 'approved' && payment !== 'cancelled')) return null;
  return { params, operation, payment, purchase: params.get('purchase'), order: params.get('token') };
}

export function App({ account = null, onExit = () => {} }: { account?: Account | null; onExit?: (reason?: 'deleted') => void | Promise<void> }) {
  const { theme } = useTheme();
  const confirm = useConfirmation();
  const gridTheme = useMemo(() => themeQuartz.withParams({ accentColor: '#8b78ed', backgroundColor: theme === 'dark' ? '#111114' : '#ffffff', foregroundColor: theme === 'dark' ? '#ededf0' : '#27272a', borderColor: theme === 'dark' ? '#24242b' : '#e9e9ed', headerBackgroundColor: theme === 'dark' ? '#151519' : '#fafafa', fontFamily: 'Geist Variable, sans-serif', fontSize: 16, rowHeight: 62, headerHeight: 52, wrapperBorderRadius: 7 }), [theme]);
  const [scenario, setScenario] = useState(emptyScenario);
  const [setupEdited, setSetupEdited] = useState(false);
  const [tab, setTab] = useState<Tab>('Overview');
  const [mode, setMode] = useState<WorkspaceMode>(() => account?.session.user.user_metadata?.reliefops_workspace_mode === 'manual' ? 'manual' : 'assistant');
  const [showProfile, setShowProfile] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarState);
  const [mobileLayout, setMobileLayout] = useState(() => window.matchMedia('(max-width: 800px)').matches);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [assistantView, setAssistantView] = useState<'chat' | 'review' | 'chat-with-review'>('chat');
  const [focusAssistantDetail, setFocusAssistantDetail] = useState(false);
  const [assistantSeed, setAssistantSeed] = useState<Scenario | null>(null);
  const [assistantGrant, setAssistantGrant] = useState('');
  const [focusGrantReview, setFocusGrantReview] = useState(false);
  const [assistantPurchase, setAssistantPurchase] = useState<{ reply: AssistantReply; source: string } | null>(null);
  const [resumeRecovery, setResumeRecovery] = useState<string | null>(null);
  const [assistantThreads] = useState(() => loadAssistantThreads(account?.session.user.id));
  const [settingsSection, setSettingsSection] = useState<'offers' | 'funding' | null>(null);
  const [recoveryFund, setRecoveryFund] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [plannedSnapshot, setPlannedSnapshot] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paymentNotice, setPaymentNotice] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [checkoutReturn] = useState(readCheckoutReturn);
  const revision = useRef(0);
  const eventSequence = useRef(0);
  const handlingPaymentReturn = useRef(false);
  const grantReviewHeading = useRef<HTMLHeadingElement>(null);
  const assistantDetailRegion = useRef<HTMLDivElement>(null);
  const workspace = useSavedWorkspace(account, (next, savedPlan, savedScenario) => {
    revision.current += 1;
    setSetupEdited(false);
    setScenario(next); setPlan(savedPlan); setPlannedSnapshot(savedScenario ? fingerprint(savedScenario) : '');
    setEvents([]); setError(''); setPaymentNotice(''); setDrawer(false);
  }, !checkoutReturn);
  const procurement = useProcurement(account, workspace.active, workspace.history.length);
  const locked = busy || workspace.initializing || workspace.busy || procurement.busy;
  const stale = !!plan && (fingerprint(scenario) !== plannedSnapshot || plan.finance_version != null && procurement.ledger?.version != null && plan.finance_version !== procurement.ledger.version);
  const hasLedger = !!procurement.ledger && Object.keys(procurement.ledger.balances).length > 0;
  const available = (id: string, draft: number) => hasLedger ? procurement.ledger!.balances[id]?.available_cents ?? 0 : draft;
  const totalFunds = scenario.funds.reduce((sum, fund) => sum + available(fund.id, fund.available_cents), 0);
  const usable = !!plan && !stale && ['OPTIMAL', 'FEASIBLE'].includes(plan.status);
  const fundName = (id: string) => scenario.funds.find(f => f.id === id)?.name ?? id;
  const needName = (id: string) => scenario.needs.find(n => n.id === id)?.name ?? id;
  const settingUp = !scenario.needs.length;
  const isDirty = setupEdited || (!!account && workspace.dirty(scenario));
  const canPlan = scenario.funds.some(fund => fund.confirmed);
  const showFundingHelp = !settingUp && !canPlan;
  const assistantMode = !!account && mode === 'assistant';
  const assistantDetail = assistantView === 'review';
  const dialogOpen = drawer || showSetup || showProfile;
  const navigationExpanded = mobileLayout ? mobileSidebarOpen : !sidebarCollapsed;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 800px)');
    function resize(event: MediaQueryListEvent) { setMobileLayout(event.matches); setMobileSidebarOpen(false); }
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);

  useEffect(() => {
    if (tab !== 'Plan settings' || !settingsSection) return;
    document.getElementById(`plan-settings-${settingsSection}`)?.focus();
    setSettingsSection(null);
  }, [tab, settingsSection]);

  useEffect(() => {
    if (!focusGrantReview || tab !== 'Grant documents' || !assistantDetail) return;
    grantReviewHeading.current?.focus();
    setFocusGrantReview(false);
  }, [focusGrantReview, tab, assistantDetail]);

  useEffect(() => {
    if (!focusAssistantDetail || !assistantDetail) return;
    assistantDetailRegion.current?.focus();
    setFocusAssistantDetail(false);
  }, [focusAssistantDetail, assistantDetail]);

  function openSettings(section: 'offers' | 'funding') {
    setSettingsSection(section);
    openDetail('Plan settings', false);
  }

  function openRecoveryFunding(fundId: string | null, purchaseId: string) {
    if (assistantMode) setResumeRecovery(purchaseId);
    if (!fundId) {
      openSettings('funding');
      return;
    }
    setRecoveryFund(fundId);
    openDetail('Funding', false);
  }

  function openDetail(next: Tab, focus = true) {
    setTab(next);
    setAssistantView('review');
    if (assistantMode && focus) setFocusAssistantDetail(true);
  }

  function focusChat() {
    setAssistantView(view => view === 'review' ? 'chat-with-review' : view);
    setFocusAssistantDetail(false);
    setFocusGrantReview(false);
    requestAnimationFrame(() => document.getElementById('workspace-chat-heading')?.focus());
  }

  function toggleSidebar() {
    if (mobileLayout) { setMobileSidebarOpen(open => !open); return; }
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    try { localStorage.setItem(sidebarPreference, String(collapsed)); }
    catch { /* The preference can still be used for this visit. */ }
  }

  function dismissMobileSidebar() {
    setMobileSidebarOpen(false);
  }

  async function selectOperation(operationId: string) {
    if (isDirty && !await confirm({
      title: 'Switch operations?',
      message: 'Changes since your last save will be lost.',
      action: 'Discard and switch',
    })) return;
    setAssistantView('chat'); setAssistantSeed(null); setAssistantGrant(''); setAssistantPurchase(null); setResumeRecovery(null);
    if (operationId) await workspace.load(operationId);
    else workspace.fresh();
    setTab('Overview');
    window.scrollTo(0, 0);
  }

  function returnToRecovery(purchaseId: string) {
    setAssistantPurchase({ reply: assistantAction('delivery', purchaseId), source: '' });
    setResumeRecovery(null);
    openDetail('Purchases', false);
  }

  function openAssistantEditor() {
    openDetail(settingUp ? 'Overview' : 'Plan settings');
  }

  async function downloadAssistantRecord() {
    if (!workspace.active || !procurement.ledger) throw new Error('Load the operation before downloading.');
    const { savePurchaseRecord } = await import('./PurchaseRecord');
    savePurchaseRecord(workspace.active, procurement.ledger, purchaseStatusLabel);
  }

  function runAssistantAction(reply: AssistantReply, source: string) {
    switch (reply.action) {
      case 'draft':
        if (reply.operation && !workspace.active) {
          setAssistantSeed(draftScenario(reply.operation));
          if (reply.operation.name) workspace.setName(reply.operation.name);
          setSetupEdited(true);
        }
        openAssistantEditor();
        break;
      case 'offer':
        if (reply.offer && workspace.active && !isDirty && scenario.offers.length < 24) {
          setAssistantSeed({ ...scenario, offers: [...scenario.offers, draftOffer(reply.offer, scenario.needs)] });
        }
        openSettings('offers');
        break;
      case 'grant':
        if (source) setAssistantGrant(source);
        setFocusGrantReview(true);
        openDetail('Grant documents', false);
        break;
      case 'funding': openDetail('Funding'); break;
      case 'plan':
        if (settingUp) openAssistantEditor();
        else if (isDirty) { openDetail('Overview'); setError('Save your changes before calculating a purchasing plan.'); }
        else if (!canPlan) openDetail('Funding');
        else void generate();
        break;
      case 'delivery':
      case 'purchases':
        setAssistantPurchase(reply.purchase_id ? { reply, source } : null);
        openDetail('Purchases', !reply.purchase_id);
        break;
      case 'reports': openDetail('Reports'); break;
      case 'activity': openDetail('Activity'); break;
    }
  }

  const unresolvedPayment = procurement.ledger?.purchases.find(purchase =>
    ['reserved', 'awaiting_approval', 'unknown', 'capturing', 'creating', 'review'].includes(purchase.status));
  const openDelivery = procurement.ledger?.purchases.find(purchase => purchase.status === 'paid' && !purchase.delivery_closed);
  const nextActions = workspace.active ? [
    unresolvedPayment && { label: 'Review payment', reply: assistantAction('purchases', unresolvedPayment.id) },
    openDelivery && { label: 'Record a delivery', reply: assistantAction('delivery', openDelivery.id) },
    { label: !scenario.offers.length ? 'Add supplier offers' : canPlan ? 'Build a purchasing plan' : 'Add grant funding',
      reply: assistantAction(!scenario.offers.length ? 'offer' : canPlan ? 'plan' : 'grant') },
    { label: 'View closeout', reply: assistantAction('reports') },
  ].filter(action => action !== undefined) : [{
    label: 'Try a sample',
    reply: { ...assistantAction('draft'), operation: { name: 'Hillview winter response (sample)', households: 12,
      deadline_days: 2, needs: [{ name: 'Hygiene kit', category: 'hygiene', quantity: 1 }],
      offers: [{ supplier: 'Summit Supplies', supply: 'Hygiene kit', unit_cost_cents: 800, stock: 12, delivery_days: 1 },
        { supplier: 'Northline Supplies', supply: 'Hygiene kit', unit_cost_cents: 900, stock: 4, delivery_days: 2 }] } },
  }];

  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  useEffect(() => {
    if (!account || !checkoutReturn || handlingPaymentReturn.current) return;
    const { params, operation, purchase, order, payment } = checkoutReturn;
    handlingPaymentReturn.current = true;
    setBusy(true);
    openDetail('Purchases');
    setPaymentNotice(payment === 'approved' ? 'Confirming payment with PayPal…' : 'Opening purchases…');

    const finishPayment = async () => {
      let message = 'PayPal checkout was closed. Check PayPal status if you already approved.';
      if (payment === 'approved') {
        message = 'Payment could not be confirmed. Use Check PayPal status before trying again.';
        if (purchase && uuid.test(purchase) && order) {
          try {
            const result = await cloudRequest<{ status: string }>(account,
              `/${operation}/purchases/${purchase}/capture`, 'POST', { order_id: order });
            if (result.status === 'paid') message = 'Payment confirmed.';
            else if (result.status === 'refunded') message = 'PayPal reports this payment was refunded.';
            else if (result.status === 'failed') message = 'PayPal reports this payment failed.';
            else message = 'Payment confirmation is pending. Use Check PayPal status for updates.';
          } catch {
            // A failed response can follow a successful capture. Reconcile before retrying.
          }
        }
      }
      await workspace.load(operation);
      setPaymentNotice(message);
      for (const key of ['operation', 'purchase', 'payment', 'token', 'PayerID']) params.delete(key);
      const query = params.toString();
      window.history.replaceState(window.history.state, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
      setBusy(false);
    };
    void finishPayment();
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

  async function saveInputs(next: Scenario) {
    const continueToGrant = assistantMode && !workspace.active && (tab === 'Grant documents' || !!assistantGrant);
    let applied = next;
    if (account) {
      try {
        const saved = await workspace.save(next);
        applied = saved.scenario;
        if (!workspace.active) {
          const thread = assistantThreads.get('new');
          if (thread) assistantThreads.set(saved.id, thread);
          assistantThreads.delete('new');
          saveAssistantThreads(account.session.user.id, assistantThreads);
        }
      }
      catch { return; }
    }
    update(applied, 'Plan inputs updated', 'Needs, supplier offers and funding are ready to review.');
    setSetupEdited(false);
    setAssistantSeed(null);
    if (continueToGrant) {
      setFocusGrantReview(true);
      return;
    }
    if (assistantMode && resumeRecovery) returnToRecovery(resumeRecovery);
    else setTab(applied.funds.some(fund => fund.confirmed) ? 'Overview' : 'Funding');
    window.scrollTo(0, 0);
  }

  async function generate() {
    if (!canPlan) { setTab('Funding'); return; }
    const input = fingerprint(scenario);
    const requestedRevision = revision.current;
    setBusy(true); setError('');
    try {
      let result: Plan;
      if (account) {
        const saved = workspace.active && !isDirty ? workspace.active : await workspace.save(scenario);
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

  async function finishWorkspace(reason?: 'deleted') {
    if (account) {
      assistantThreads.clear();
      saveAssistantThreads(account.session.user.id, assistantThreads);
    }
    await onExit(reason);
  }

  async function deleteProject(project: OperationSummary) {
    await workspace.remove(project);
    assistantThreads.delete(project.id);
    if (account) saveAssistantThreads(account.session.user.id, assistantThreads);
    if (workspace.active?.id === project.id) {
      setAssistantView('chat'); setAssistantSeed(null); setAssistantGrant(''); setAssistantPurchase(null); setResumeRecovery(null);
      setTab('Overview');
    }
  }

  async function exitWorkspace() {
    if ((isDirty || (!account && !settingUp)) && !await confirm({
      title: account ? 'Sign out with unsaved changes?' : 'Leave this guest plan?',
      message: account ? 'Changes since your last save will be lost.' : 'Sign in to create a saved operation. This guest plan will be cleared.',
      action: account ? 'Discard and sign out' : 'Continue to sign-in',
    })) return;
    try { await finishWorkspace(); }
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

  return <div className="app-shell" data-signed-in={account ? '' : undefined} data-sidebar-collapsed={account && sidebarCollapsed ? '' : undefined}
    data-mobile-sidebar-open={account && mobileSidebarOpen ? '' : undefined}>
    <aside id="workspace-sidebar" className="sidebar" inert={dialogOpen || (!!account && mobileLayout && !mobileSidebarOpen)}>
      <a className="brand" href="#" aria-label="ReliefOps overview" onClick={e => { e.preventDefault(); if (assistantMode) focusChat(); else setTab('Overview'); }}><Brand /></a>
      {(!settingUp || assistantMode) && <nav aria-label="Workspace navigation">
        {assistantMode && <button className={`nav-item assistant-nav ${assistantDetail ? '' : 'selected'}`} title="Ask ReliefOps" aria-current={assistantDetail ? undefined : 'page'} onClick={() => { dismissMobileSidebar(); focusChat(); }}>
          <Icon name="chat" /><span>Ask ReliefOps</span>
        </button>}
        {!settingUp && tabs.filter(name => account || name !== 'Reports').map(name => (
        <button key={name} title={name} aria-current={tab === name && (!assistantMode || assistantDetail) ? 'page' : undefined} className={`nav-item ${tab === name && (!assistantMode || assistantDetail) ? 'selected' : ''}`} onClick={() => { dismissMobileSidebar(); if (name === 'Purchases') setAssistantPurchase(null); openDetail(name); }}>
          <Icon name={pages[name].icon} /><span>{name}</span>
        </button>
      ))}</nav>}
    </aside>

    <div className="main-shell" inert={dialogOpen}>
      <header className="topbar">
        {account ? (
          <div className="topbar-operation">
            <button className="icon-button" type="button" aria-controls="workspace-sidebar" aria-expanded={navigationExpanded}
              aria-label={navigationExpanded ? 'Collapse sidebar' : 'Expand sidebar'} title={navigationExpanded ? 'Collapse sidebar' : 'Expand sidebar'} onClick={toggleSidebar}>
              <Icon name={navigationExpanded ? 'sidebar-close' : 'sidebar-open'} size={19} />
            </button>
            <select className="operation-switcher" aria-label="Saved operation" value={workspace.active?.id ?? ''} disabled={locked}
              onChange={event => void selectOperation(event.currentTarget.value)}>
              <option value="">{workspace.active ? '+ New operation' : 'Select an operation'}</option>
              {workspace.operations.map(operation => <option value={operation.id} key={operation.id}>{operation.name}</option>)}
            </select>
            <button className="icon-button" type="button" aria-label="New operation" title="New operation" disabled={locked}
              onClick={() => void selectOperation('')}><Icon name="plus" size={19} /></button>
          </div>
        ) : <strong className="sample-label">Guest workspace</strong>}
        <div className="topbar-right">
          <ThemeToggle animate />
          {account && <button className="text-button" onClick={() => setShowProfile(true)}><Icon name="user" size={16} /> Profile</button>}
          <button className="text-button" onClick={exitWorkspace} disabled={locked}>{account ? 'Sign out' : 'Sign in'}</button>
          <button className="icon-button" onClick={openSetup} aria-label="Open integration setup" title="Service status"><Icon name="settings" size={19} /></button>
        </div>
      </header>
      <main>
        {tab === 'Purchases' && paymentNotice && <p className="payment-notice" role="status">{paymentNotice}</p>}
        <div className={assistantMode ? `workspace-layout${assistantDetail && !workspace.initializing ? ' has-review' : ''}` : undefined}>
        {assistantMode && account && !workspace.initializing && <WorkspaceAssistant key={workspace.active?.id ?? 'new'}
          account={account} operation={workspace.active} busy={locked} threads={assistantThreads} quickActions={nextActions}
          onAction={runAssistantAction} onOpenEditor={openAssistantEditor} />}
        {assistantMode && !assistantDetail && !workspace.initializing && workspace.error && <p className="error-banner" role="alert">{workspace.error}</p>}
        {assistantMode && !assistantDetail && !workspace.initializing && error && <p className="error-banner" role="alert">{error}</p>}
        {(!assistantMode || assistantView !== 'chat' || workspace.initializing) && <div className={assistantMode ? 'assistant-detail' : undefined}
          hidden={assistantMode && !assistantDetail && !workspace.initializing}
          ref={assistantMode ? assistantDetailRegion : undefined} tabIndex={assistantMode ? -1 : undefined}>
        {assistantMode && assistantDetail && <button className="text-button assistant-return" onClick={focusChat}>
          <Icon name="chat" size={16} /> Back to chat
        </button>}
        {workspace.initializing ? <p role="status">Opening saved operations…</p> : settingUp ? (busy && paymentNotice ? null : <section aria-label={account ? "Saved operations" : "New operation setup"}>
          <div className="page-heading"><h1 ref={tab === 'Grant documents' ? grantReviewHeading : undefined} tabIndex={tab === 'Grant documents' ? -1 : undefined}>Start a relief operation</h1></div>
          {assistantMode && tab === 'Grant documents' && <p className="warning-banner" role="status">
            {assistantGrant ? 'Your grant text is ready. Save the operation below to review it.' : 'Save the operation below before adding a grant.'}
          </p>}
          <p className="setup-intro">Enter who you need to supply, what each household needs, and what suppliers can deliver.</p>
          {workspace.error && <div className="error-banner" role="alert">{workspace.error}</div>}
          <InputEditor scenario={scenario} seed={assistantSeed} disabled={locked} setup allowNoOffers={assistantMode || !!assistantSeed}
            operationName={account ? workspace.name : undefined}
            onNameChange={workspace.setName}
            allowNoFunds={!!account}
            onEdit={() => setSetupEdited(true)}
            onApply={saveInputs} />
        </section>) : <>
        <div className="page-heading"><h1 ref={tab === 'Grant documents' ? grantReviewHeading : undefined} tabIndex={tab === 'Grant documents' ? -1 : undefined}>{pages[tab].title}</h1>
          {tab === 'Overview' && (canPlan
            ? <button className="button planner-button" onClick={generate} disabled={locked}>{busy ? 'Building plan…' : 'Generate purchasing plan'}<Icon name="arrow" size={18} /></button>
            : <button className="button planner-button" onClick={() => setTab('Funding')}>Add funding<Icon name="arrow" size={18} /></button>)}
          {tab === 'Funding' && <button className="button subtle" onClick={() => setTab('Grant documents')}>Review grant documents<Icon name="arrow" size={16} /></button>}
          {tab === 'Grant documents' && canPlan && <button className="button subtle" onClick={() => setTab('Overview')}>Go to planner<Icon name="arrow" size={16} /></button>}
        </div>
        {account && tab === 'Overview' && <section className="cloud-toolbar" aria-label="Saved operations">
          <div className="cloud-controls">
            <label>Operation name<input maxLength={100} value={workspace.name} disabled={locked} onChange={event => workspace.setName(event.target.value)} /></label>
            <button className="button primary" disabled={locked || !workspace.name.trim()} onClick={() => { void workspace.save(scenario).catch(() => {}); }}>{workspace.busy ? 'Saving…' : 'Save operation'}</button>
            {workspace.active && isDirty && <button className="text-button" disabled={locked} onClick={async () => {
              const operationId = workspace.active!.id;
              if (await confirm({
                title: 'Discard unsaved changes?',
                message: 'This operation will go back to its last saved version.',
                action: 'Discard changes',
              })) void workspace.load(operationId);
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
          <p>See what you can buy with your funding, supplier stock and delivery deadline.</p>
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

          <section className="card"><div className="card-heading"><div><h2>Available funding by source</h2></div><button className="text-button" onClick={() => setTab('Funding')}>Manage funding <Icon name="arrow" size={16} /></button></div><div className="fund-preview">{!scenario.funds.length && <p>No funding added yet.</p>}{scenario.funds.map((fund, index) => <div className="fund-preview-item" key={fund.id}><span className={`fund-dot fund-${index}`} /><div><strong>{fund.name}</strong><small>{`Can pay for: ${fund.categories.join(', ')}`}</small></div><strong>{money(available(fund.id, fund.available_cents))}</strong></div>)}</div></section>
          </div>
          {plan && <section className="result-strip"><span className="result-icon"><Icon name="check" /></span><div><strong>{stale ? 'Previous plan is out of date' : `${plan.complete_kits} complete kits planned for ${money(plan.total_cost_cents)}`}</strong></div><button className="button subtle" disabled={stale || busy || !usable} onClick={() => setDrawer(true)}>Review plan <Icon name="arrow" size={16} /></button></section>}
        </>}

        {tab === 'Supplier offers' && <section className="card"><div className="card-heading"><div><h2>Available stock and prices</h2><p>Exclude an offer if the supplier can no longer deliver, then generate a new plan.</p></div><button className="button primary" onClick={generate} disabled={locked || !canPlan}>{busy ? 'Calculating…' : 'Generate plan'}<Icon name="arrow" size={16} /></button></div><div className="grid-wrap"><AgGridReact<Offer> theme={gridTheme} rowData={scenario.offers} columnDefs={columns} defaultColDef={{ sortable: true, resizable: true }} getRowId={params => params.data.id} domLayout="autoHeight" /></div><div className="card-footnote">The plan skips offers that arrive after your delivery deadline.</div></section>}

        {tab === 'Funding' && showFundingHelp && <section className="card procurement-panel funding-start">
          <h2>{scenario.funds.length ? 'Confirm your funding' : 'Add money to your plan'}</h2>
          <p>Tell ReliefOps how much you can spend and what the money can pay for.</p>
          <div className="action-row">
            <button className="button primary" onClick={() => setTab('Plan settings')}>{scenario.funds.length ? 'Review funding rules' : 'Enter a budget'}</button>
            {account && <button className="button subtle" onClick={() => setTab('Grant documents')}>Upload a grant document</button>}
          </div>
        </section>}
        {tab === 'Funding' && scenario.funds.length > 0 && <div className="funds-editor">{scenario.funds.map((fund, index) => <section className="card fund-editor" key={fund.id}><div className="fund-editor-heading"><span className={`need-icon tone-${index}`}><Icon name="fund" /></span><span className="tag">{fund.confirmed ? 'Ready to use' : 'Needs confirmation'}</span></div><h2>{fund.name}</h2><p>Can pay for: {fund.categories.join(', ')}.</p><label>Budget (USD)<input disabled={locked || !!procurement.ledger?.balances[fund.id]} aria-label={`${fund.name} amount`} type="number" min="0" max="1000000" step="0.01" value={(procurement.ledger?.balances[fund.id]?.opening_cents ?? fund.available_cents) / 100} onChange={e => { const amount = Number(e.target.value); if (Number.isFinite(amount) && amount >= 0 && amount <= 1000000) update({ ...scenario, funds: scenario.funds.map(f => f.id === fund.id ? { ...f, available_cents: Math.round(amount * 100) } : f) }, 'Funding balance updated', `${fund.name}: ${money(Math.round(amount * 100))}.`); }} /></label>{hasLedger && <p className="fund-editor-note">{money(available(fund.id, 0))} left to spend</p>}</section>)}<div className="fund-action"><button className="button primary" onClick={generate} disabled={locked || !canPlan}>{busy ? 'Calculating…' : 'Generate plan with these funds'}<Icon name="arrow" size={16} /></button></div></div>}

        {tab === 'Activity' && <section className="card"><div className="card-heading"><div><h2>Changes in this session</h2></div></div>{events.length === 0 ? <div className="empty-state"><Icon name="activity" size={32} /><h3>No changes yet</h3><p>Changes and new plans will appear here.</p></div> : <ol className="activity-list">{events.map(event => <li key={event.id}><span className="activity-dot" /><div><strong>{event.title}</strong><p>{event.body}</p></div><time>{event.time}</time></li>)}</ol>}</section>}

        {tab === 'Plan settings' && <InputEditor scenario={scenario} seed={assistantSeed} disabled={locked} allowNoFunds={!!account} allowNoOffers={!!account && !scenario.offers.length} onApply={saveInputs} />}
        {tab === 'Purchases' && (account && workspace.active ? <Purchases procurement={procurement} operation={workspace.active} clean={!isDirty} onPlan={() => setTab('Overview')} onStatusCheck={() => setPaymentNotice('')}
          onEditOffers={purchaseId => { if (assistantMode) setResumeRecovery(purchaseId); openSettings('offers'); }}
          onEditFunding={openRecoveryFunding} suggested={assistantMode ? assistantPurchase : null} /> : <section className="card empty-state"><h2>Save an operation to manage purchases</h2><p>Approved items appear here, ready for test checkout.</p><button className="button primary" onClick={account ? () => setTab('Overview') : exitWorkspace}>{account ? 'Go to overview' : 'Sign in'}</button></section>)}
        {tab === 'Grant documents' && (account && workspace.active ? <EvidencePanel procurement={procurement} operation={workspace.active} clean={!isDirty} pastedText={assistantMode ? assistantGrant : ''} reload={() => workspace.load(workspace.active!.id)} /> : <section className="card empty-state"><h2>Save an operation to upload a grant</h2><p>Upload a document to find the grant amount and what it can pay for.</p><button className="button primary" onClick={account ? () => setTab('Overview') : exitWorkspace}>{account ? 'Go to overview' : 'Sign in'}</button></section>)}
        {tab === 'Activity' && account && workspace.active && <DurableActivity procurement={procurement} />}
        {tab === 'Reports' && account && workspace.active && <FundingReport key={workspace.active.id} account={account} operationId={workspace.active.id}
          recordCloseout={assistantMode ? () => procurement.action('/closeout', {}, true) : undefined}
          downloadPdf={assistantMode && procurement.ledger ? downloadAssistantRecord : undefined} />}
        {tab === 'Funding' && account && workspace.active && !isDirty && <FundingLedger procurement={procurement} operation={workspace.active} initialFund={recoveryFund} />}
        {assistantMode && resumeRecovery && (tab === 'Funding' || tab === 'Plan settings') &&
          <button className="button subtle" disabled={locked} onClick={() => returnToRecovery(resumeRecovery)}>Back to replacement</button>}
        {tab === 'Overview' && account && workspace.history.length > 0 && <section className="card saved-history"><div className="card-heading"><div><h2>Previous plans</h2></div></div>{workspace.history.map(calculation => <button className="history-row" key={calculation.id} onClick={() => { setPlan(calculation.result); setPlannedSnapshot(fingerprint(calculation.scenario)); setDrawer(true); }}><span><strong>{calculation.result.complete_kits} complete kits</strong><small>{new Date(calculation.created_at).toLocaleString()}</small></span><strong>{money(calculation.result.total_cost_cents)}</strong><Icon name="arrow" size={16} /></button>)}</section>}
        </>}
        </div>}
        </div>
      </main>
    </div>

    {drawer && plan && <div className="overlay" onClick={() => setDrawer(false)}><section className="drawer" role="dialog" aria-modal="true" aria-label="Purchasing plan" onClick={e => e.stopPropagation()}><div className="drawer-header"><h2>Purchasing plan</h2><button className="icon-button" onClick={() => setDrawer(false)} aria-label="Close purchasing plan"><Icon name="close" /></button></div>{stale && <p className="warning-banner">This plan is out of date. Generate a new plan to approve purchases.</p>}<div className="plan-summary"><div><strong>{plan.complete_kits}<small> / {plan.target_kits}</small></strong><span>complete kits</span></div><div><strong>{money(plan.total_cost_cents)}</strong><span>total planned cost</span></div></div>{plan.status === 'FEASIBLE' && <p className="plan-caveat">This plan meets your rules. A lower-cost plan may be possible.</p>}<div className="plan-lines">{plan.purchases.map(p => <article key={p.offer_id}><div className="purchase-heading"><div><h3>{needName(p.need_id)}</h3><p>{p.supplier} · {p.quantity} units</p></div><strong>{money(p.cost_cents)}</strong></div>{p.allocations.map(allocation => <div className="allocation" key={allocation.fund_id}><Icon name="fund" size={14} /><span>{fundName(allocation.fund_id)}</span><strong>{money(allocation.amount_cents)}</strong></div>)}</article>)}</div>{Object.values(plan.unmet).some(n => n > 0) && <div className="warning-banner"><strong>Supplies still needed</strong><p>{Object.entries(plan.unmet).filter(([, count]) => count > 0).map(([id, count]) => `${count} ${needName(id).toLowerCase()}s`).join(' · ')}</p></div>}{account ? <ApproveAction procurement={procurement} plan={plan} operation={workspace.active} disabled={locked || stale || isDirty} onApproved={() => { setDrawer(false); setTab('Purchases'); }} /> : <div className="payment-placeholder"><Icon name="shield" size={20} /><div><strong>Sign in to approve purchases</strong></div></div>}<button className="button subtle full-width" onClick={() => setDrawer(false)}>Back to workspace<Icon name="arrow" size={16} /></button></section></div>}

    {showSetup && <div className="overlay setup-overlay" onClick={() => setShowSetup(false)}><section className="setup-modal" role="dialog" aria-modal="true" aria-label="Integration setup" onClick={e => e.stopPropagation()}><div className="drawer-header"><h2>Service status</h2><button className="icon-button" onClick={() => setShowSetup(false)} aria-label="Close integration setup"><Icon name="close" /></button></div>{['groq', 'supabase', 'paypal'].map(name => <div className="integration-row" key={name}><strong>{name === 'groq' ? 'Groq AI' : name === 'paypal' ? 'PayPal sandbox' : 'Supabase'}</strong><span>{integrations?.[name]?.configured && integrations?.[name]?.implemented ? 'Configured' : integrations?.[name]?.configured ? 'Unavailable' : 'Status unavailable'}</span></div>)}<p className="setup-note">These settings show which services are configured for this workspace.</p><button className="button primary full-width" onClick={() => setShowSetup(false)}>Got it</button></section></div>}
    {showProfile && account && <WorkspaceProfile account={account} mode={mode} onChange={next => {
      if (next === 'assistant' && isDirty) setAssistantView('review');
      setMode(next);
    }} onClose={() => setShowProfile(false)} onDeleted={() => finishWorkspace('deleted')}
      projects={workspace.operations} activeProjectId={workspace.active?.id} onDeleteProject={deleteProject} />}
    <ModalKeyboard open={dialogOpen} close={() => { setDrawer(false); setShowSetup(false); setShowProfile(false); }} />
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
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]')]
      .filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    function handle(event: KeyboardEvent) {
      if (document.querySelector('dialog:modal')) return;
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

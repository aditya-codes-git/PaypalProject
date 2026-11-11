import { useCallback, useEffect, useRef, useState } from 'react';
import { cloudRequest, type Account, type Operation } from './cloud';
import { useConfirmation } from './Confirmation';
import { PurchaseDelivery, type Delivery } from './Fulfillment';
import { money, type Plan } from './types';

type Intent = Delivery & { id: string; supplier: string; need_id: string; quantity: number; cost_cents: number; status: string; order_id: string | null; capture_id: string | null; approval_url: string | null; merchant_id: string };
type Evidence = { id: string; filename: string; hash: string; confirmed: number[]; pages: string[]; metadata: { model: string; usage: { total_tokens?: number } }; proposals: { warnings: string[]; funds: { name: string; amount_cents: number | null; categories: string[]; quote: string; page: number; requires_review: boolean; warnings: string[] }[] } };
type Ledger = { version?: number; purchases: Intent[]; events: { id: string; at: string; actor: string; kind: string; message: string }[]; documents: Evidence[]; balances: Record<string, { opening_cents: number; reserved_cents: number; spent_cents: number; available_cents: number }> };

export function useProcurement(account: Account | null, operation: Operation | null, refreshKey: number) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const operationId = operation?.id;
  const activeOperation = useRef(operationId);
  activeOperation.current = operationId;
  const client = account?.client;
  const refresh = useCallback(async () => {
    if (!account || !operationId) { setLedger(null); return; }
    try {
      const value = await cloudRequest<Ledger>(account, `/${operationId}/finance`);
      if (activeOperation.current !== operationId) return;
      if (Array.isArray(value.purchases)) { setLedger(value); setError(''); }
    } catch (err) { if (activeOperation.current === operationId) setError(err instanceof Error ? err.message : 'Cannot load commitments.'); }
  }, [client, operationId]);
  useEffect(() => { setLedger(null); void refresh(); }, [refresh, operation?.revision, refreshKey]);
  async function action(path: string, body?: unknown) {
    if (!account || !operationId) throw new Error('Save an operation first.');
    setBusy(true); setError('');
    try {
      const result = await cloudRequest<any>(account, `/${operationId}${path}`, 'POST', body ?? {});
      await refresh();
      return result;
    } catch (err) { const message = err instanceof Error ? err.message : 'The action could not be completed.'; setError(message); throw err; }
    finally { setBusy(false); }
  }
  return { ledger, busy, error, refresh, action };
}

type Procurement = ReturnType<typeof useProcurement>;

const purchaseStatus: Record<string, string> = {
  reserved: 'Ready for checkout',
  creating: 'Opening PayPal checkout',
  awaiting_approval: 'Waiting for PayPal checkout',
  capturing: 'Completing payment',
  unknown: 'Check payment status',
  paid: 'Paid',
  failed: 'Payment failed',
  cancelled: 'Cancelled',
  refunding: 'Refund requested',
  refund_unknown: 'Check refund status',
  refunded: 'Refunded',
};


export function ApproveAction({ procurement, plan, operation, disabled, onApproved }: { procurement: Procurement; plan: Plan; operation: Operation | null; disabled: boolean; onApproved: () => void }) {
  const confirm = useConfirmation();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => setRequestId(crypto.randomUUID()), [plan.id]);
  return <div className="approval-action"><p>Approval sets this money aside. You can pay for each purchase separately.</p>{procurement.error && <p className="error-banner" role="alert">{procurement.error}</p>}<button className="button primary full-width" disabled={disabled || procurement.busy || !operation || !plan.purchases.length} onClick={async () => {
    const count = plan.purchases.length;
    if (!await confirm({
      title: 'Approve this purchasing plan?',
      message: `Set aside ${money(plan.total_cost_cents)} for ${count} ${count === 1 ? 'purchase' : 'purchases'}. You can pay for them separately.`,
      action: 'Approve plan',
    })) return;
    void procurement.action('/approve', { expected_revision: operation!.revision, input_digest: plan.input_digest, request_id: requestId, purchases: plan.purchases }).then(onApproved).catch(() => {});
  }}>{procurement.busy ? 'Reserving funds…' : 'Approve and reserve funds'}</button></div>;
}

export function Purchases({ procurement, operation, clean, onPlan }: { procurement: Procurement; operation: Operation; clean: boolean; onPlan: () => void }) {
  const confirm = useConfirmation();
  const ledger = procurement.ledger;
  return <section className="card procurement-panel"><div className="card-heading"><div><h2>Pay for approved items</h2><p>PayPal uses test money in this workspace.</p></div><button className="button subtle" onClick={() => void procurement.refresh()} disabled={procurement.busy}>Refresh status</button></div>
    {!clean && <p className="warning-banner">Save your changes before paying.</p>}
    {procurement.error && <div className="error-banner" role="alert">{procurement.error}</div>}
    {ledger && <div className="balance-grid">{Object.entries(ledger.balances).map(([id, b]) => <article key={id}><strong>{operation.scenario.funds.find(f => f.id === id)?.name ?? id}</strong><span>{money(b.available_cents)} available</span><small>{money(b.reserved_cents)} reserved · {money(b.spent_cents)} spent</small></article>)}</div>}
    {!ledger && !procurement.error && <p role="status">Loading purchases…</p>}
    {ledger && !ledger.purchases.length && <div className="empty-state"><h3>No approved purchases yet</h3><p>Generate a plan and approve it to see what you can pay for here.</p><button className="button subtle" onClick={onPlan}>Go to planner</button></div>}
    {ledger?.purchases.map(p => <article className="purchase-card" key={p.id}><div className="purchase-heading"><div><h3>{p.supplier}</h3><p>{p.quantity} × {operation.scenario.needs.find(n => n.id === p.need_id)?.name ?? p.need_id}</p></div><strong>{money(p.cost_cents)}</strong></div><p><span className="tag">{purchaseStatus[p.status] ?? p.status.replaceAll('_', ' ')}</span></p>
    {p.order_id && <details className="technical-details"><summary>PayPal details</summary><small className="provider-reference">Test recipient: {p.merchant_id ? 'Configured supplier account' : 'Default test account'}<br />Order: {p.order_id}{p.capture_id && <><br />Payment: {p.capture_id}</>}</small></details>}<div className="action-row">
      {p.status === 'reserved' && <><button className="button primary" disabled={!clean || procurement.busy} onClick={() => void procurement.action(`/purchases/${p.id}/checkout`).then(result => { if (result.approval_url) window.location.assign(result.approval_url); }).catch(() => {})}>Pay with PayPal</button><button className="button subtle" disabled={procurement.busy} onClick={async () => {
        if (await confirm({
          title: 'Cancel this purchase?',
          message: `${money(p.cost_cents)} will be available to spend again.`,
          action: 'Cancel purchase',
        })) void procurement.action(`/purchases/${p.id}/cancel`).catch(() => {});
      }}>Cancel purchase</button></>}
      {p.status === 'awaiting_approval' && <>{p.approval_url && <a className="button subtle" href={p.approval_url} rel="noreferrer">Continue in PayPal</a>}<button className="button primary" disabled={!clean || procurement.busy} onClick={() => void procurement.action(`/purchases/${p.id}/capture`).catch(() => {})}>Complete payment</button></>}
      {!['reserved', 'cancelled', 'failed', 'refunded'].includes(p.status) && <button className="button subtle" disabled={procurement.busy} onClick={() => void procurement.action(`/purchases/${p.id}/reconcile`).catch(() => {})}>Check PayPal status</button>}
      {p.status === 'paid' && <button className="button subtle" disabled={procurement.busy} onClick={async () => {
        if (await confirm({
          title: 'Request a full refund?',
          message: 'PayPal will refund this test payment. The funds become available when PayPal confirms the refund.',
          action: 'Request refund',
        })) void procurement.action(`/purchases/${p.id}/refund`).catch(() => {});
      }}>Request full refund</button>}
    </div><PurchaseDelivery purchase={p} busy={procurement.busy} submit={(path, body) => procurement.action(`/purchases/${p.id}/${path}`, body)} /></article>)}
    {ledger && <button className="button subtle" onClick={() => download(operation, ledger)}>Download purchase record</button>}
  </section>;
}

function download(operation: Operation, ledger: Ledger) {
  // Source text is private and intentionally omitted from the purchase/audit export.
  const { documents, ...finance } = ledger;
  const blob = new Blob([JSON.stringify({ schema_version: 1, operation, finance, evidence: documents.map(d => ({ id: d.id, filename: d.filename, hash: d.hash, confirmed: d.confirmed, metadata: d.metadata })) }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `reliefops-${operation.id}.json`; link.click(); URL.revokeObjectURL(url);
}

export function DurableActivity({ procurement }: { procurement: Procurement }) {
  return <section className="card"><div className="card-heading"><div><h2>Saved decisions and payments</h2></div></div>{procurement.ledger?.events.length ? <ol className="activity-list">{procurement.ledger.events.map(e => <li key={e.id}><span className="activity-dot" /><div><strong>{e.message}</strong></div><time>{new Date(e.at).toLocaleString()}</time></li>)}</ol> : <div className="empty-state"><p>Approved purchases, confirmed grants and payments will appear here.</p></div>}</section>;
}

export function EvidencePanel({ procurement, operation, clean, reload }: { procurement: Procurement; operation: Operation; clean: boolean; reload: () => Promise<void> }) {
  const confirm = useConfirmation();
  const [localError, setLocalError] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  return <section className="card procurement-panel"><div className="card-heading"><div><h2>Upload a grant document</h2><p>AI suggests the grant amount and what it can pay for. Review the quoted text before adding the grant to your funding.</p></div></div><div className="evidence-upload"><label>Choose a grant file<input type="file" accept=".txt,.pdf" disabled={!clean || procurement.busy || loadingFile} onChange={async e => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    setLocalError('');
    if (file.size > 2_000_000) { setLocalError('Choose a document smaller than 2 MB.'); return; }
    if (!await confirm({
      title: 'Analyze this grant document?',
      message: 'ReliefOps sends the file’s text to Groq to find the grant terms. Use a sample document for testing.',
      action: 'Analyze document',
    })) return;
    setLoadingFile(true);
    try { const reader = new FileReader(); const content = await new Promise<string>((resolve, reject) => { reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); await procurement.action('/documents', { filename: file.name, content_base64: content }); }
    catch (err) { setLocalError(err instanceof Error ? err.message : 'Could not read the file.'); }
    finally { setLoadingFile(false); }
  }} /></label><p>Choose a .txt file or a PDF with selectable text, up to 2 MB and 20 pages.</p>{!clean && <p>Save your changes before uploading or confirming a grant.</p>}{(loadingFile || procurement.busy) && <p role="status">Working on your document…</p>}</div>
    {(localError || procurement.error) && <div className="error-banner" role="alert">{localError || procurement.error}</div>}
    {procurement.ledger?.documents.map(document => <article className="evidence-document" key={document.id}><h3>{document.filename}</h3><details className="technical-details"><summary>AI extraction details</summary><small>{document.metadata.model} · {document.metadata.usage.total_tokens ?? '—'} tokens · Document ID {document.hash.slice(0, 12)}</small></details>{document.proposals.warnings.map((w, i) => <p className="warning-banner" key={i}>{w}</p>)}{!document.proposals.funds.length && <p>No grant terms were found. You can add funding in Plan settings.</p>}{document.proposals.funds.map((proposal, index) => <Proposal key={index} proposal={proposal} document={document} index={index} procurement={procurement} operation={operation} clean={clean} reload={reload} />)}</article>)}
  </section>;
}

function Proposal({ proposal, document, index, procurement, operation, clean, reload }: { proposal: Evidence['proposals']['funds'][number]; document: Evidence; index: number; procurement: Procurement; operation: Operation; clean: boolean; reload: () => Promise<void> }) {
  const [name, setName] = useState(proposal.name);
  const [amount, setAmount] = useState(proposal.amount_cents === null ? '' : String(proposal.amount_cents / 100));
  const [categories, setCategories] = useState(proposal.categories);
  const [acknowledge, setAcknowledge] = useState(false);
  const confirmed = document.confirmed.includes(index);
  return <form className="evidence-proposal" onSubmit={e => { e.preventDefault(); void procurement.action(`/documents/${document.id}/confirm`, { expected_revision: operation.revision, proposal_index: index, name, amount_cents: Math.round(Number(amount) * 100), categories, acknowledge_review: acknowledge }).then(reload).catch(() => {}); }}><blockquote>{proposal.quote}<cite>Page {proposal.page}</cite></blockquote><details><summary>Read the full page</summary><pre>{document.pages[proposal.page - 1]}</pre></details>{proposal.requires_review && <p className="warning-banner">Manual review required: {proposal.warnings.join(' ') || 'Check the complete source conditions before confirmation.'}</p>}{confirmed ? <p className="grant-confirmed" role="status">Added to funding</p> : <><div className="input-grid"><label>Grant name<input value={name} maxLength={100} required onChange={e => setName(e.target.value)} /></label><label>Grant amount (USD)<input type="number" min="0" max="1000000" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} /></label></div><fieldset><legend>What can this grant pay for?</legend>{[...new Set(operation.scenario.needs.map(n => n.category))].map(category => <label className="check-label" key={category}><input type="checkbox" checked={categories.includes(category)} onChange={e => setCategories(previous => e.target.checked ? [...previous, category] : previous.filter(c => c !== category))} />{category}</label>)}</fieldset><label className="check-label"><input type="checkbox" checked={acknowledge} onChange={e => setAcknowledge(e.target.checked)} />I checked the document and confirmed the amount and spending rules.</label><button className="button primary" disabled={!clean || procurement.busy || !acknowledge || !categories.length}>Confirm and add grant</button></>}</form>;
}

export function FundingLedger({ procurement, operation }: { procurement: Procurement; operation: Operation }) {
  const confirm = useConfirmation();
  const [fund, setFund] = useState(operation.scenario.funds[0]?.id ?? '');
  const [amount, setAmount] = useState(''); const [reason, setReason] = useState('');
  if (!procurement.ledger || !Object.keys(procurement.ledger.balances).length) return null;
  return <section className="card procurement-panel"><h2>Change a budget</h2><p>Enter the new total, including money already set aside or spent.</p><form className="input-grid" onSubmit={async e => {
    e.preventDefault();
    const openingCents = Math.round(Number(amount) * 100);
    if (!await confirm({
      title: 'Update this budget?',
      message: `Set the total budget to ${money(openingCents)}. This change will appear in Activity.`,
      action: 'Save budget',
    })) return;
    void procurement.action('/funding', { expected_revision: operation.revision, fund_id: fund, opening_cents: openingCents, reason })
      .then(() => { setReason(''); setAmount(''); }).catch(() => {});
  }}><label>Funding source<select value={fund} onChange={e => setFund(e.target.value)}>{operation.scenario.funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>New total budget (USD)<input type="number" required min="0" max="1000000" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label><label>Reason<input required minLength={5} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></label><button className="button subtle" disabled={procurement.busy}>Update budget</button></form></section>;
}

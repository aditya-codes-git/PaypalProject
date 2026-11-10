import { useCallback, useEffect, useRef, useState } from 'react';
import { cloudRequest, type Account, type Operation } from './cloud';
import { money, type Plan } from './types';

type Intent = { id: string; supplier: string; need_id: string; quantity: number; cost_cents: number; status: string; order_id: string | null; capture_id: string | null; approval_url: string | null; merchant_id: string };
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

export function ApproveAction({ procurement, plan, operation, disabled, onApproved }: { procurement: Procurement; plan: Plan; operation: Operation | null; disabled: boolean; onApproved: () => void }) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => setRequestId(crypto.randomUUID()), [plan.id]);
  return <div className="approval-action"><p>Approval reserves the listed funds and quantities. You are approving as this operation's owner. PayPal buyer approval is a separate step.</p>{procurement.error && <p className="error-banner" role="alert">{procurement.error}</p>}<button className="button primary full-width" disabled={disabled || procurement.busy || !operation || !plan.purchases.length} onClick={() => {
    if (!window.confirm(`Approve these ${plan.purchases.length} purchases and reserve ${money(plan.total_cost_cents)}?`)) return;
    void procurement.action('/approve', { expected_revision: operation!.revision, input_digest: plan.input_digest, request_id: requestId, purchases: plan.purchases }).then(onApproved).catch(() => {});
  }}>{procurement.busy ? 'Reserving funds…' : 'Approve and reserve funds'}</button></div>;
}

export function Purchases({ procurement, operation, clean }: { procurement: Procurement; operation: Operation; clean: boolean }) {
  const ledger = procurement.ledger;
  return <section className="card procurement-panel"><div className="card-heading"><div><h2>Purchases & commitments</h2><p>Sandbox payments only. Paid supplies remain part of your plan when other offers change.</p></div><button className="button subtle" onClick={() => void procurement.refresh()} disabled={procurement.busy}>Refresh status</button></div>
    <p className="card-footnote">Unmapped fictional suppliers use the application's default sandbox merchant. Separate supplier recipients require configured merchant mappings. Payments do not establish physical delivery.</p>
    {!clean && <p className="warning-banner">Save your current operation before starting or capturing a payment.</p>}
    {procurement.error && <div className="error-banner" role="alert">{procurement.error}</div>}
    {ledger && <div className="balance-grid">{Object.entries(ledger.balances).map(([id, b]) => <article key={id}><strong>{operation.scenario.funds.find(f => f.id === id)?.name ?? id}</strong><span>{money(b.available_cents)} available</span><small>{money(b.reserved_cents)} reserved · {money(b.spent_cents)} spent</small></article>)}</div>}
    {!ledger?.purchases.length && <div className="empty-state"><h3>No approved purchases yet</h3><p>Generate a current plan, review its allocations, then approve it.</p></div>}
    {ledger?.purchases.map(p => <article className="purchase-card" key={p.id}><div className="purchase-heading"><div><h3>{p.supplier}</h3><p>{p.quantity} × {operation.scenario.needs.find(n => n.id === p.need_id)?.name ?? p.need_id}</p></div><strong>{money(p.cost_cents)}</strong></div><p><span className="tag">{p.status.replaceAll('_', ' ')}</span> · {p.merchant_id ? 'Mapped sandbox merchant' : 'Default application sandbox merchant'}</p>{p.order_id && <small className="provider-reference">PayPal order {p.order_id}{p.capture_id ? ` · capture ${p.capture_id}` : ''}</small>}<div className="action-row">
      {p.status === 'reserved' && <><button className="button primary" disabled={!clean || procurement.busy} onClick={() => void procurement.action(`/purchases/${p.id}/checkout`).then(result => { if (result.approval_url) window.location.assign(result.approval_url); }).catch(() => {})}>Pay with PayPal sandbox</button><button className="button subtle" disabled={procurement.busy} onClick={() => { if (window.confirm('Cancel this unsubmitted purchase and release its reservation?')) void procurement.action(`/purchases/${p.id}/cancel`).catch(() => {}); }}>Cancel reservation</button></>}
      {p.status === 'awaiting_approval' && <>{p.approval_url && <a className="button subtle" href={p.approval_url} rel="noreferrer">Open PayPal approval</a>}<button className="button primary" disabled={!clean || procurement.busy} onClick={() => void procurement.action(`/purchases/${p.id}/capture`).catch(() => {})}>Capture approved payment</button></>}
      {!['reserved', 'cancelled', 'failed', 'refunded'].includes(p.status) && <button className="button subtle" disabled={procurement.busy} onClick={() => void procurement.action(`/purchases/${p.id}/reconcile`).catch(() => {})}>Reconcile with PayPal</button>}
      {p.status === 'paid' && <button className="button subtle" disabled={procurement.busy} onClick={() => { if (window.confirm('Request a full sandbox refund? Funding remains spent until the refund is confirmed.')) void procurement.action(`/purchases/${p.id}/refund`).catch(() => {}); }}>Request full refund</button>}
    </div></article>)}
    {ledger && <button className="button subtle" onClick={() => download(operation, ledger)}>Export operation & audit</button>}
  </section>;
}

function download(operation: Operation, ledger: Ledger) {
  // Source text is private and intentionally omitted from the purchase/audit export.
  const { documents, ...finance } = ledger;
  const blob = new Blob([JSON.stringify({ schema_version: 1, operation, finance, evidence: documents.map(d => ({ id: d.id, filename: d.filename, hash: d.hash, confirmed: d.confirmed, metadata: d.metadata })) }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `reliefops-${operation.id}.json`; link.click(); URL.revokeObjectURL(url);
}

export function DurableActivity({ procurement }: { procurement: Procurement }) {
  return <section className="card"><div className="card-heading"><div><h2>Saved decision history</h2><p>Approvals, commitments, evidence confirmations and reconciled sandbox payments.</p></div></div>{procurement.ledger?.events.length ? <ol className="activity-list">{procurement.ledger.events.map(e => <li key={e.id}><span className="activity-dot" /><div><strong>{e.kind.replaceAll('_', ' ')}</strong><p>{e.message}</p><small>Actor {e.actor}</small></div><time>{new Date(e.at).toLocaleString()}</time></li>)}</ol> : <div className="empty-state"><p>No saved financial decisions yet.</p></div>}</section>;
}

export function EvidencePanel({ procurement, operation, clean, reload }: { procurement: Procurement; operation: Operation; clean: boolean; reload: () => Promise<void> }) {
  const [localError, setLocalError] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  return <section className="card procurement-panel"><div className="card-heading"><div><h2>Funding evidence</h2><p>Groq proposes rules from your document. You review the exact source before anything becomes active.</p></div></div><div className="evidence-upload"><label>Upload funding terms<input type="file" accept=".txt,.pdf" disabled={!clean || procurement.busy || loadingFile} onChange={async e => {
    const file = e.target.files?.[0]; if (!file) return; setLocalError('');
    if (file.size > 2_000_000) { setLocalError('Choose a document smaller than 2 MB.'); return; }
    if (!window.confirm('Send the readable text in this document to Groq for funding-rule extraction? Use synthetic demo documents.')) { e.target.value = ''; return; }
    setLoadingFile(true);
    try { const reader = new FileReader(); const content = await new Promise<string>((resolve, reject) => { reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); await procurement.action('/documents', { filename: file.name, content_base64: content }); }
    catch (err) { setLocalError(err instanceof Error ? err.message : 'Could not read the file.'); }
    finally { setLoadingFile(false); e.target.value = ''; }
  }} /></label><p>Text PDFs or UTF-8 text · 2 MB · 20 pages · 12,000 characters. Scans and complex conditions need manual review. Extraction is capped at 20 requests/day for this app; manual input always remains available.</p>{!clean && <p>Save the operation before uploading or confirming evidence.</p>}{(loadingFile || procurement.busy) && <p role="status">Processing your request…</p>}</div>
    {(localError || procurement.error) && <div className="error-banner" role="alert">{localError || procurement.error}</div>}
    {procurement.ledger?.documents.map(document => <article className="evidence-document" key={document.id}><h3>{document.filename}</h3><small>{document.metadata.model} · {document.metadata.usage.total_tokens ?? '—'} tokens · source {document.hash.slice(0, 12)}</small>{document.proposals.warnings.map((w, i) => <p className="warning-banner" key={i}>{w}</p>)}{!document.proposals.funds.length && <p>No supported funding pools found. Use manual entry.</p>}{document.proposals.funds.map((proposal, index) => <Proposal key={index} proposal={proposal} document={document} index={index} procurement={procurement} operation={operation} clean={clean} reload={reload} />)}</article>)}
  </section>;
}

function Proposal({ proposal, document, index, procurement, operation, clean, reload }: { proposal: Evidence['proposals']['funds'][number]; document: Evidence; index: number; procurement: Procurement; operation: Operation; clean: boolean; reload: () => Promise<void> }) {
  const [name, setName] = useState(proposal.name);
  const [amount, setAmount] = useState(proposal.amount_cents === null ? '' : String(proposal.amount_cents / 100));
  const [categories, setCategories] = useState(proposal.categories);
  const [acknowledge, setAcknowledge] = useState(false);
  const confirmed = document.confirmed.includes(index);
  return <form className="evidence-proposal" onSubmit={e => { e.preventDefault(); void procurement.action(`/documents/${document.id}/confirm`, { expected_revision: operation.revision, proposal_index: index, name, amount_cents: Math.round(Number(amount) * 100), categories, acknowledge_review: acknowledge }).then(reload).catch(() => {}); }}><blockquote>{proposal.quote}<cite>Page {proposal.page}</cite></blockquote><details><summary>Inspect source page</summary><pre>{document.pages[proposal.page - 1]}</pre></details>{proposal.requires_review && <p className="warning-banner">Manual review required: {proposal.warnings.join(' ') || 'Check the complete source conditions before confirmation.'}</p>}<div className="input-grid"><label>Funding pool name<input value={name} maxLength={100} required disabled={confirmed} onChange={e => setName(e.target.value)} /></label><label>Opening allocation (USD)<input type="number" min="0" max="1000000" step="0.01" required disabled={confirmed} value={amount} onChange={e => setAmount(e.target.value)} /></label></div><fieldset disabled={confirmed}><legend>Confirmed eligible categories</legend>{[...new Set(operation.scenario.needs.map(n => n.category))].map(category => <label className="check-label" key={category}><input type="checkbox" checked={categories.includes(category)} onChange={e => setCategories(previous => e.target.checked ? [...previous, category] : previous.filter(c => c !== category))} />{category}</label>)}</fieldset><label className="check-label"><input type="checkbox" checked={acknowledge || confirmed} disabled={confirmed} onChange={e => setAcknowledge(e.target.checked)} />I checked the full source, amount and restrictions. Unsupported conditions have been resolved manually.</label><button className="button primary" disabled={confirmed || !clean || procurement.busy || !acknowledge || !categories.length}>{confirmed ? 'Confirmed and active' : 'Confirm funding rule'}</button></form>;
}

export function FundingLedger({ procurement, operation }: { procurement: Procurement; operation: Operation }) {
  const [fund, setFund] = useState(operation.scenario.funds[0]?.id ?? '');
  const [amount, setAmount] = useState(''); const [reason, setReason] = useState('');
  if (!procurement.ledger || !Object.keys(procurement.ledger.balances).length) return null;
  return <section className="card procurement-panel"><h2>Recorded opening allocations</h2><p>Once commitments exist, changing draft balances does not change available funding. Record a confirmed allocation adjustment here; it cannot reduce a pool below reserved and spent amounts.</p><form className="input-grid" onSubmit={e => { e.preventDefault(); if (window.confirm('Record this opening allocation adjustment in the saved financial history?')) void procurement.action('/funding', { expected_revision: operation.revision, fund_id: fund, opening_cents: Math.round(Number(amount) * 100), reason }).then(() => { setReason(''); setAmount(''); }).catch(() => {}); }}><label>Pool<select value={fund} onChange={e => setFund(e.target.value)}>{operation.scenario.funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>New opening allocation (USD)<input type="number" required min="0" max="1000000" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label><label>Reason<input required minLength={5} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></label><button className="button subtle" disabled={procurement.busy}>Record adjustment</button></form></section>;
}

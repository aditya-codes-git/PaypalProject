import { useEffect, useState, type FormEvent } from 'react';
import { cloudRequest, type Account } from './cloud';
import { useConfirmation } from './Confirmation';
import { money } from './types';
import type { ReceiptDraft } from './WorkspaceAssistant';

type Receipt = { request_id: string; reference: string; location: string; accepted_units: number; rejected_units: number; at: string };
export type SupplierAnalysis = {
  id: string; revision: number; model: string;
  proposal: {
    purchase_match: 'matches' | 'different' | 'unclear';
    reported_total_received: number | null;
    remaining_delivery: 'cancelled' | 'delayed' | 'expected' | 'unclear';
    quote: string | null;
    summary: string;
    operator_check?: string;
  };
};
export type Delivery = {
  supplier_confirmation?: { supplier_reference: string; invoice_reference: string | null };
  receipts?: Receipt[];
  delivery_closed?: boolean;
  short_delivery_draft?: SupplierAnalysis;
  short_delivery?: { receipt_id: string; evidence: SupplierAnalysis | null; at: string };
  replaces_purchase_id?: string;
};

export function PurchaseDelivery({ purchase, busy, submit, draft, open }: {
  purchase: Delivery & { quantity: number; status: string };
  busy: boolean;
  submit: (path: string, body: unknown) => Promise<unknown>;
  draft?: ReceiptDraft;
  open?: boolean;
}) {
  const confirm = useConfirmation();
  const receipts = purchase.receipts ?? [];
  const received = receipts.reduce((total, receipt) => total + receipt.accepted_units, 0);
  const remaining = purchase.quantity - received;
  const canSetSupplier = !purchase.delivery_closed && ['reserved', 'awaiting_approval', 'paid'].includes(purchase.status);
  const canReceive = !purchase.delivery_closed && purchase.status === 'paid';
  const [receiptId, setReceiptId] = useState(() => crypto.randomUUID());
  if (!canSetSupplier && !canReceive && !receipts.length && !purchase.supplier_confirmation) return null;

  function saveSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void submit('supplier-confirmation', {
      supplier_reference: String(fields.get('supplier')),
      invoice_reference: String(fields.get('invoice')).trim() || null,
    }).catch(() => {});
  }

  async function saveReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const accepted = Number(fields.get('accepted'));
    const close = fields.has('close');
    if (close && accepted < remaining && !await confirm({
      title: 'Close this delivery short?',
      message: 'The next plan can replace the missing units. The payment stays recorded.',
      action: 'Close delivery',
    })) return;
    try {
      await submit('receipts', {
        request_id: receiptId, location: String(fields.get('location')), reference: String(fields.get('reference')),
        accepted_units: accepted, rejected_units: Number(fields.get('rejected')), close_delivery: close,
      });
      form.reset();
      setReceiptId(crypto.randomUUID());
    } catch {
      // Keep the receipt and request ID so the user can retry safely.
    }
  }

  return <details className="technical-details delivery-panel" open={open || undefined}>
    <summary>Supplier and delivery</summary>
    <p>{received} of {purchase.quantity} units received{purchase.delivery_closed ? ' · Delivery closed' : ''}</p>
    {canSetSupplier ? <form className="input-grid" onSubmit={saveSupplier}>
      <label>Supplier confirmation reference<input name="supplier" required maxLength={100} defaultValue={purchase.supplier_confirmation?.supplier_reference} /></label>
      <label>Invoice reference<input name="invoice" maxLength={100} defaultValue={purchase.supplier_confirmation?.invoice_reference ?? ''} /></label>
      <button type="submit" className="button subtle" disabled={busy}>Save supplier details</button>
    </form> : purchase.supplier_confirmation && <p>Supplier reference {purchase.supplier_confirmation.supplier_reference}
      {purchase.supplier_confirmation.invoice_reference && ` · Invoice ${purchase.supplier_confirmation.invoice_reference}`}</p>}
    {receipts.length > 0 && <ul className="receipt-list">{receipts.map(receipt => <li key={receipt.request_id}>
      {receipt.location} · {receipt.accepted_units} accepted · {receipt.rejected_units} rejected · {receipt.reference}
    </li>)}</ul>}
    {canReceive && <form className="input-grid receipt-form" onSubmit={saveReceipt}>
      <label>Delivery location<input name="location" required maxLength={100} defaultValue={draft?.location ?? ''} /></label>
      <label>Receipt reference<input name="reference" required maxLength={100} defaultValue={draft?.reference ?? ''} /></label>
      <label>Usable units<input name="accepted" type="number" required min={0} max={remaining} step={1} defaultValue={draft?.accepted_units ?? ''} /></label>
      <label>Rejected units<input name="rejected" type="number" required min={0} max={remaining} step={1} defaultValue={draft?.rejected_units ?? 0} /></label>
      {draft?.quote && <blockquote className="assistant-receipt-quote">{draft.quote}</blockquote>}
      <label className="receipt-close"><input name="close" type="checkbox" />Close delivery with no more units expected</label>
      <button className="button primary" type="submit" disabled={busy}>Record delivery</button>
    </form>}
  </details>;
}

type Report = {
  operation: string;
  generated_at: string;
  closeout?: { households: number; complete_households: number; pending_payments: number; open_deliveries: number;
    ready: boolean; recorded_at: string | null; supplies: { name: string; required: number; received: number }[] };
  funds: { id: string; name: string; opening_cents: number; reserved_cents: number; spent_cents: number; available_cents: number; source: { filename: string; page: number } | null }[];
  purchases: { purchase_id: string; supplier: string; supply: string; status: string; ordered_units: number; received_units: number; delivery_closed: boolean; replaces_purchase_id?: string | null; receipts: Pick<Receipt, 'location' | 'accepted_units' | 'rejected_units' | 'at'>[]; allocations: { fund_id: string; amount_cents: number }[] }[];
};

export function FundingReport({ account, operationId, recordCloseout, downloadPdf }: {
  account: Account; operationId: string; recordCloseout?: () => Promise<unknown>; downloadPdf?: () => Promise<void>;
}) {
  const confirm = useConfirmation();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void cloudRequest<Report>(account, `/${operationId}/funding-report`).then(data => {
      if (active) setReport(data);
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load the funding report.');
    });
    return () => { active = false; };
  }, [account, operationId, attempt]);

  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'reliefops-funding-report.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function closeout() {
    if (!recordCloseout || !await confirm({
      title: 'Record this closeout?', message: 'Save a record that payments are settled and the planned supplies have been received.',
      action: 'Record closeout',
    })) return;
    setSaving(true);
    setError('');
    try { await recordCloseout(); setAttempt(previous => previous + 1); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not record the closeout.'); }
    finally { setSaving(false); }
  }

  async function exportPdf() {
    setError('');
    try { await downloadPdf?.(); }
    catch { setError('Could not download the purchase record. Try again.'); }
  }

  return <section className="card procurement-panel">
    <div className="card-heading"><div><h2>Funding and deliveries</h2><p>See what each grant funded and where supplies arrived.</p></div>
      {report && <button className="button subtle" onClick={download}>Download funding report</button>}
    </div>
    {error && <div className="error-banner" role="alert">{error} <button className="button subtle" onClick={() => { setError(''); setAttempt(attempt + 1); }}>Try again</button></div>}
    {!report && !error && <p role="status">Loading funding report…</p>}
    {report && <>
      {recordCloseout && report.closeout && <section className="closeout-summary" aria-label="Operation closeout">
        <h3>Operation closeout</h3>
        <p>{report.closeout.complete_households} of {report.closeout.households} households have complete supplies delivered.</p>
        <ul className="receipt-list">{report.closeout.supplies.map((supply, index) =>
          <li key={index}>{supply.name} · {supply.received} of {supply.required} received</li>)}</ul>
        {(report.closeout.pending_payments > 0 || report.closeout.open_deliveries > 0) && <p>
          {report.closeout.pending_payments} payments to resolve · {report.closeout.open_deliveries} deliveries still open
        </p>}
        {report.closeout.recorded_at && <p className="grant-confirmed" role="status">Closeout recorded {new Date(report.closeout.recorded_at).toLocaleString()}.</p>}
        <div className="action-row">
          {report.closeout.ready && !report.closeout.recorded_at && <button className="button primary" disabled={saving} onClick={() => void closeout()}>Record closeout</button>}
          {downloadPdf && <button className="button subtle" onClick={() => void exportPdf()}>Download purchase record (PDF)</button>}
        </div>
      </section>}
      {!report.funds.length && <p>No funding sources added yet.</p>}
      <div className="balance-grid">{report.funds.map(fund => <article key={fund.id}>
        <strong>{fund.name}</strong><span>{money(fund.available_cents)} available</span>
        <small>{money(fund.opening_cents)} budget · {money(fund.reserved_cents)} reserved · {money(fund.spent_cents)} spent</small>
        {fund.source && <small>{fund.source.filename} · Page {fund.source.page}</small>}
      </article>)}</div>
      {!report.purchases.length && <p>Purchase and delivery records will appear here after approval.</p>}
      {report.purchases.map(purchase => <article className="purchase-card" key={purchase.purchase_id}>
        <h3>{purchase.supply} · {purchase.supplier}</h3>
        <p>{purchase.received_units} of {purchase.ordered_units} units received{purchase.delivery_closed ? ' · Delivery closed' : ''}
          {purchase.status === 'refunded' ? ' · Payment refunded' : purchase.status === 'paid' ? ' · Paid' : ''}</p>
        {purchase.replaces_purchase_id && <p>Replacement for {report.purchases.find(row => row.purchase_id === purchase.replaces_purchase_id)?.supplier ?? 'original purchase'}</p>}
        {purchase.receipts.length > 0 && <ul className="receipt-list">{purchase.receipts.map((receipt, index) => <li key={index}>
          {receipt.location} · {receipt.accepted_units} accepted · {receipt.rejected_units} rejected
        </li>)}</ul>}
        <details className="technical-details"><summary>Purchase allocations</summary>
          <ul className="receipt-list">{purchase.allocations.map(allocation => <li key={allocation.fund_id}>
            {report.funds.find(fund => fund.id === allocation.fund_id)?.name ?? allocation.fund_id} · {money(allocation.amount_cents)}
          </li>)}</ul>
        </details>
      </article>)}
    </>}
  </section>;
}

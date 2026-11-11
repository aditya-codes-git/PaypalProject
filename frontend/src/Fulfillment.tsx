import { useEffect, useState, type FormEvent } from 'react';
import { cloudRequest, type Account } from './cloud';
import { useConfirmation } from './Confirmation';
import { money } from './types';

type Receipt = { request_id: string; reference: string; location: string; accepted_units: number; rejected_units: number; at: string };
export type Delivery = {
  supplier_confirmation?: { supplier_reference: string; invoice_reference: string | null };
  receipts?: Receipt[];
  delivery_closed?: boolean;
};

export function PurchaseDelivery({ purchase, busy, submit }: {
  purchase: Delivery & { quantity: number; status: string };
  busy: boolean;
  submit: (path: string, body: unknown) => Promise<unknown>;
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

  return <details className="technical-details delivery-panel">
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
      <label>Delivery location<input name="location" required maxLength={100} /></label>
      <label>Receipt reference<input name="reference" required maxLength={100} /></label>
      <label>Usable units<input name="accepted" type="number" required min={0} max={remaining} step={1} /></label>
      <label>Rejected units<input name="rejected" type="number" required min={0} max={remaining} step={1} defaultValue={0} /></label>
      <label className="receipt-close"><input name="close" type="checkbox" />Close delivery with no more units expected</label>
      <button className="button primary" type="submit" disabled={busy}>Record delivery</button>
    </form>}
  </details>;
}

type Report = {
  operation: string;
  generated_at: string;
  funds: { id: string; name: string; opening_cents: number; reserved_cents: number; spent_cents: number; available_cents: number; source: { filename: string; page: number } | null }[];
  purchases: { purchase_id: string; supplier: string; supply: string; status: string; ordered_units: number; received_units: number; delivery_closed: boolean; receipts: Pick<Receipt, 'location' | 'accepted_units' | 'rejected_units' | 'at'>[]; allocations: { fund_id: string; amount_cents: number }[] }[];
};

export function FundingReport({ account, operationId }: { account: Account; operationId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
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

  return <section className="card procurement-panel">
    <div className="card-heading"><div><h2>Funding and deliveries</h2><p>See what each grant funded and where supplies arrived.</p></div>
      {report && <button className="button subtle" onClick={download}>Download funding report</button>}
    </div>
    {error && <div className="error-banner" role="alert">{error} <button className="button subtle" onClick={() => { setError(''); setAttempt(attempt + 1); }}>Try again</button></div>}
    {!report && !error && <p role="status">Loading funding report…</p>}
    {report && <>
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

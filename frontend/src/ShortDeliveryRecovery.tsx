import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Operation } from './cloud';
import type { Delivery, SupplierAnalysis } from './Fulfillment';
import type { Procurement } from './Procurement';
import { money, type Plan } from './types';
import type { ReceiptDraft } from './WorkspaceAssistant';

type RecoveryPurchase = Delivery & { id: string; need_id: string; supply_name?: string; status: string; quantity: number };
type RecoveryPreview = {
  plan: Plan;
  target_units: number;
  current_planned_kits: number;
  projected_kits: number;
  target_kits: number;
  eligible_budget_cents: number;
  ineligible_funds: string[];
  units_without_offer: number;
  funding_gap_cents: number | null;
};

export function ShortDeliveryRecovery({ purchase, procurement, operation, clean, onEditOffers, onEditFunding, renderApproval, suggested, openReview }: {
  purchase: RecoveryPurchase;
  procurement: Procurement;
  operation: Operation;
  clean: boolean;
  onEditOffers: () => void;
  onEditFunding: (fundId: string | null) => void;
  renderApproval: (plan: Plan, disabled: boolean, onApproved: () => void) => ReactNode;
  suggested?: { draft: ReceiptDraft; source: string; analysis?: SupplierAnalysis };
  openReview?: boolean;
}) {
  const [open, setOpen] = useState(!!suggested || !!openReview);
  const [source, setSource] = useState(suggested?.source ?? '');
  const [analysis, setAnalysis] = useState<SupplierAnalysis | null>(suggested?.analysis ?? null);
  const [reviewing, setReviewing] = useState(!!suggested?.analysis);
  const [accepted, setAccepted] = useState(suggested?.analysis && suggested.draft.accepted_units != null ? String(suggested.draft.accepted_units) : '');
  const [verified, setVerified] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');
  const [task, setTask] = useState<'analyze' | 'plan' | 'receipt' | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const autoPreview = useRef(false);
  const receipts = purchase.receipts ?? [];
  const received = receipts.reduce((sum, receipt) => sum + receipt.accepted_units, 0);
  const remaining = purchase.quantity - received;
  const closed = Boolean(purchase.delivery_closed);
  const supply = operation.scenario.needs.find(need => need.id === purchase.need_id);
  const supplyName = purchase.supply_name ?? supply?.name ?? 'Supplies';
  const path = `/purchases/${purchase.id}`;
  const replacements = procurement.ledger?.purchases.filter(row => row.replaces_purchase_id === purchase.id) ?? [];
  const blocked = !clean || procurement.busy || task !== null;
  const validEvidence = analysis?.proposal.quote && analysis.proposal.purchase_match !== 'different' ? analysis : null;
  useEffect(() => {
    if (open && closed) heading.current?.focus();
  }, [open, closed]);
  useEffect(() => {
    if (!openReview || !closed || blocked || remaining <= 0 || autoPreview.current) return;
    autoPreview.current = true;
    void calculate();
  }, [openReview, closed, blocked, remaining]);
  if (remaining <= 0 || (!closed && purchase.status !== 'paid')) return null;

  function review(proposal: SupplierAnalysis | null) {
    const total = proposal?.proposal.reported_total_received;
    setAccepted(proposal?.proposal.purchase_match === 'matches' && total != null && total >= received ? String(total - received) : '');
    setAnalysis(proposal);
    setReviewing(true);
    setVerified(false);
    setError('');
    setRequestId(crypto.randomUUID());
  }

  function toggle() {
    if (!open && !reviewing && purchase.short_delivery_draft?.revision === operation.revision) review(purchase.short_delivery_draft);
    if (!open && closed && !preview && !approved && !blocked) void calculate();
    setOpen(!open);
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTask('analyze');
    setError('');
    try {
      review(await procurement.action<SupplierAnalysis>(`${path}/short-delivery/analyze`, { text: source.trim() }, true));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the supplier update.');
    } finally {
      setTask(null);
    }
  }

  async function calculate() {
    setPreview(null);
    setTask('plan');
    setError('');
    try {
      setPreview(await procurement.action<RecoveryPreview>(`${path}/short-delivery/plan`, {}, true));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not compare replacements.');
    } finally {
      setTask(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setTask('receipt');
    setError('');
    try {
      await procurement.action(`${path}/receipts`, {
        request_id: requestId,
        location: String(fields.get('location')),
        reference: String(fields.get('reference')),
        accepted_units: Number(accepted),
        rejected_units: Number(fields.get('rejected')),
        close_delivery: true,
        short_delivery_review: {
          expected_revision: operation.revision,
          expected_receipts: receipts.length,
          analysis_id: validEvidence?.id ?? null,
        },
      }, true);
      await calculate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the delivery.');
    } finally {
      setTask(null);
    }
  }

  return <div className="short-delivery">
    <button className="button subtle" type="button" aria-expanded={open} onClick={toggle}>
      {closed ? 'View replacement options' : 'Resolve short delivery'}
    </button>
    {open && <section className="recovery-panel" aria-label="Short delivery recovery">
      <div className="recovery-header">
        <div><h3 ref={heading} tabIndex={-1}>{closed ? 'Replace missing supplies' : 'Review the supplier update'}</h3>
          <p>{supplyName} · {received} of {purchase.quantity} received{closed && ` · ${remaining} missing`}</p></div>
      </div>
      {!clean && <p className="warning-banner">Save your operation changes to continue.</p>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      {!closed && <>
        {!suggested?.analysis && <form className="recovery-form" onSubmit={analyze}>
          <label>Supplier email or message
            <textarea rows={4} maxLength={4000} disabled={task === 'analyze'} placeholder="Paste the part about what arrived and whether more units are coming."
              value={source} onChange={event => { setSource(event.target.value); setAnalysis(null); setVerified(false); }} />
          </label>
          <p>{suggested ? 'Verify this update before saving it to the purchase record.' : 'Groq reads the update and highlights the evidence for you to check.'}</p>
          <div className="action-row">
            <button className="button primary" disabled={blocked || source.trim().length < 10}>{task === 'analyze' ? 'Reading supplier update…' : 'Analyze with AI'}</button>
            <button className="button subtle" type="button" disabled={blocked} onClick={() => review(null)}>Enter delivery manually</button>
          </div>
        </form>}
        {reviewing && <form className="recovery-form recovery-review" onSubmit={save}>
          {analysis && <AnalysisEvidence analysis={analysis} />}
          <h4>Confirm what actually arrived</h4>
          <p>Enter units from this receipt. {received > 0 && `${received} units are already recorded.`}</p>
          <div className="input-grid">
            <label>Additional usable units<input type="number" required min={0} max={remaining - 1} step={1} value={accepted} onChange={event => setAccepted(event.target.value)} /></label>
            <label>Rejected units<input name="rejected" type="number" required min={0} max={remaining - Number(accepted)} step={1} defaultValue={suggested?.draft.rejected_units ?? 0} /></label>
            <label>Delivery location<input name="location" required maxLength={100} defaultValue={suggested?.draft.location ?? ''} /></label>
            <label>Receipt or supplier reference<input name="reference" required maxLength={100} defaultValue={suggested?.draft.reference ?? purchase.supplier_confirmation?.supplier_reference ?? ''} /></label>
          </div>
          <label className="check-label"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} required />I checked the delivery and confirmed the remaining units won’t arrive.</label>
          <button className="button primary" disabled={blocked}>{task === 'receipt' ? 'Saving delivery…' : 'Save short delivery and compare options'}</button>
        </form>}
      </>}
      {closed && <>
        {replacements.length > 0 && <ul className="recovery-links">{replacements.map(row => <li key={row.id}>
          <a href={`#purchase-${row.id}`}>{row.supplier} · {row.quantity} units · {row.status === 'reserved' ? 'Ready for PayPal checkout' : row.status === 'paid' ? 'Paid' : 'View purchase'}</a>
        </li>)}</ul>}
        {approved && <p className="grant-confirmed" role="status">Funds reserved. Open the replacement purchase to pay with PayPal.</p>}
        {preview && <RecoveryOptions preview={preview} operation={operation} category={supply?.category}
          onEditOffers={onEditOffers} onEditFunding={onEditFunding} />}
        {preview && preview.plan.purchases.length > 0 && renderApproval(preview.plan, blocked, () => { setApproved(true); setPreview(null); })}
        <button className="button subtle" disabled={blocked} onClick={() => void calculate()}>
          {task === 'plan' ? 'Checking suppliers and funding…' : preview || approved ? 'Check again' : 'Find replacements'}
        </button>
        {purchase.short_delivery?.evidence && <details className="technical-details">
          <summary>View supplier message</summary><AnalysisEvidence analysis={purchase.short_delivery.evidence} />
        </details>}
      </>}
    </section>}
  </div>;
}

function AnalysisEvidence({ analysis }: { analysis: SupplierAnalysis }) {
  const proposal = analysis.proposal;
  return <div className="recovery-evidence">
    <strong>What AI found</strong>
    <p>{proposal.summary}</p>
    {proposal.quote && <blockquote>{proposal.quote}</blockquote>}
    {proposal.operator_check && <p><strong>Check before confirming</strong> {proposal.operator_check}</p>}
    {proposal.purchase_match === 'different' && <p className="warning-banner">This update appears to describe another purchase. Check your source and enter the verified delivery details.</p>}
    {proposal.purchase_match !== 'different' && proposal.remaining_delivery !== 'cancelled' && <p className="warning-banner">Check whether the remaining items are still expected before closing the delivery.</p>}
  </div>;
}

function RecoveryOptions({ preview, operation, category, onEditOffers, onEditFunding }: {
  preview: RecoveryPreview;
  operation: Operation;
  category?: string;
  onEditOffers: () => void;
  onEditFunding: (fundId: string | null) => void;
}) {
  const { plan } = preview;
  if (!preview.target_units) return <p role="status">This shortfall needs no additional purchase under the current plan.</p>;
  const units = plan.purchases.reduce((total, row) => total + row.quantity, 0);
  const eligibleFund = operation.scenario.funds.find(fund => fund.confirmed && category && fund.categories.includes(category));
  const restrictedFunds = operation.scenario.funds.filter(fund => preview.ineligible_funds.includes(fund.name) && category && !fund.categories.includes(category));
  const fundingGap = preview.funding_gap_cents ?? 0;
  const fundingShort = preview.eligible_budget_cents === 0 || fundingGap > 0;
  const deadline = operation.scenario.deadline_days;
  const deliveryWindow = deadline === 0 ? 'today' : `within ${deadline} ${deadline === 1 ? 'day' : 'days'}`;
  return <div className="recovery-options">
    <h4 className="recovery-result" aria-live="polite">{units > 0
      ? `Replace ${units} of ${preview.target_units} missing units for ${money(plan.total_cost_cents)}`
      : `No replacement found for the ${preview.target_units} missing units`}</h4>
    {units > 0 && preview.projected_kits > preview.current_planned_kits && <p>
      This would increase planned coverage from {preview.current_planned_kits} to {preview.projected_kits} of {preview.target_kits} households with complete supply kits.
    </p>}
    {preview.units_without_offer > 0 && <div className="warning-banner recovery-blocker">
      <strong>{preview.units_without_offer === preview.target_units ? 'A backup supplier is needed' : 'More supplier stock is needed'}</strong>
      <p>Add an offer from another supplier who can deliver {preview.units_without_offer} {preview.units_without_offer === 1 ? 'unit' : 'units'} {deliveryWindow}.</p>
      <button className="button subtle" onClick={onEditOffers}>Edit supplier offers</button>
    </div>}
    {fundingShort && <div className="warning-banner recovery-blocker">
      <strong>{preview.eligible_budget_cents === 0 ? 'No money available for this item' : 'More funding is needed'}</strong>
      {fundingGap > 0 && <p>{money(fundingGap)} more is needed to replace all {preview.target_units} units.</p>}
      {restrictedFunds.map(fund => <p key={fund.id}>{fund.name} can pay for {fund.categories.join(', ')}.</p>)}
      {eligibleFund ? <p>Check the budget for {eligibleFund.name}.</p>
        : <p>Add a funding pool that can pay for {category ?? 'this supply'}, then set its spendable budget under Funding → Change a budget.</p>}
      <button className="button subtle" onClick={() => onEditFunding(eligibleFund?.id ?? null)}>{eligibleFund ? 'Review funding budget' : 'Add a funding pool'}</button>
    </div>}
    {plan.purchases.map(row => {
      const delivery = operation.scenario.offers.find(offer => offer.id === row.offer_id)?.delivery_days;
      return <article className="recovery-offer" key={row.offer_id}>
        <div className="purchase-heading"><div><h4>{row.supplier}</h4><p>
          {row.quantity} replacement {row.quantity === 1 ? 'unit' : 'units'}
          {delivery === 0 ? ' · Reported same-day delivery' : delivery !== undefined && ` · Reported delivery in ${delivery} ${delivery === 1 ? 'day' : 'days'}`}
        </p></div><strong>{money(row.cost_cents)}</strong></div>
        {row.allocations.map(allocation => <div className="allocation" key={allocation.fund_id}>
          <span>{operation.scenario.funds.find(fund => fund.id === allocation.fund_id)?.name ?? allocation.fund_id}</span>
          <strong>{money(allocation.amount_cents)}</strong>
        </div>)}
      </article>;
    })}
    {units === 0 && !preview.units_without_offer && !fundingShort && <p>Check the prices and available budgets for this item, then try again.</p>}
  </div>;
}

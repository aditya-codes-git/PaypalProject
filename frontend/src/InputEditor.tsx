import { useEffect, useState } from 'react';
import { useConfirmation } from './Confirmation';
import type { Scenario } from './types';

type Props = {
  scenario: Scenario;
  onApply: (scenario: Scenario) => Promise<void>;
  disabled: boolean;
  setup?: boolean;
  operationName?: string;
  onNameChange?: (name: string) => void;
  allowNoFunds?: boolean;
  onEdit?: () => void;
};
const identifier = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
const numeric = (value: string) => value === '' ? Number.NaN : Number(value);
const display = (value: number) => Number.isFinite(value) ? value : '';

function initialDraft(scenario: Scenario, setup: boolean): Scenario {
  if (!setup) return structuredClone(scenario);
  const need = { id: identifier('need'), name: '', category: '', quantity: Number.NaN };
  return {
    ...scenario,
    needs: [need],
    offers: [{ id: identifier('offer'), supplier: '', need_id: need.id, unit_cost_cents: Number.NaN,
      stock: Number.NaN, delivery_days: Number.NaN, active: true }],
  };
}

export function InputEditor({
  scenario, onApply, disabled, setup = false, operationName, onNameChange, allowNoFunds = false, onEdit,
}: Props) {
  const confirm = useConfirmation();
  const [draft, setDraft] = useState<Scenario>(() => initialDraft(scenario, setup));
  const [error, setError] = useState('');
  useEffect(() => { setDraft(initialDraft(scenario, setup)); setError(''); }, [scenario, setup]);
  function edit(change: Partial<Scenario>) {
    setDraft(current => ({ ...current, ...change }));
    setError('');
    onEdit?.();
  }
  async function removeNeed(id: string) {
    if (draft.offers.some(offer => offer.need_id === id) && !await confirm({
      title: 'Remove this supply?',
      message: 'This also removes its supplier offers from your draft.',
      action: 'Remove supply and offers',
    })) return;
    edit({ needs: draft.needs.filter(need => need.id !== id), offers: draft.offers.filter(offer => offer.need_id !== id) });
  }
  function apply() {
    const normalized: Scenario = {
      ...draft,
      needs: draft.needs.map(need => ({ ...need, name: need.name.trim(), category: need.category.trim() })),
      offers: draft.offers.map(offer => ({ ...offer, supplier: offer.supplier.trim() })),
      funds: draft.funds.map(fund => ({ ...fund, name: fund.name.trim(), categories: [...new Set(fund.categories.map(category => category.trim()).filter(Boolean))] })),
    };
    const integerIn = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
    if (!integerIn(normalized.target_kits, 1, 100) || !integerIn(normalized.deadline_days, 0, 30)) {
      setError('Set a household target from 1 to 100 and a delivery window from 0 to 30 whole days.'); return;
    }
    if (!normalized.needs.length || !normalized.offers.length) {
      setError('Add at least one supply and one supplier offer.'); return;
    }
    if (!allowNoFunds && !normalized.funds.some(fund => fund.confirmed)) {
      setError('Add a funding source and confirm what it can pay for.'); return;
    }
    if (normalized.needs.some(need => !need.name || !need.category || !integerIn(need.quantity, 1, 500))) {
      setError('Every supply needs a name, category, and whole quantity from 1 to 500 per household.'); return;
    }
    const needs = new Set(normalized.needs.map(need => need.id));
    if (normalized.offers.some(offer => !offer.supplier || !needs.has(offer.need_id) || !integerIn(offer.unit_cost_cents, 1, 1_000_000) || !integerIn(offer.stock, 0, 500) || !integerIn(offer.delivery_days, 0, 365))) {
      setError('Every offer needs a supplier, an existing supply type, an all-in price from $0.01 to $10,000, whole stock from 0 to 500, and delivery from 0 to 365 days.'); return;
    }
    if (normalized.funds.some(fund => !fund.name || !integerIn(fund.available_cents, 0, 100_000_000) || !fund.categories.length || fund.categories.length > 10 || fund.categories.some(category => category.length > 40))) {
      setError('Every pool needs a name, an allocation from $0 to $1,000,000, and one to ten eligible categories of at most 40 characters each.'); return;
    }
    setError(''); void onApply(normalized);
  }
  return <form className="operation-inputs" onSubmit={event => { event.preventDefault(); apply(); }}>
    <section className="card input-section"><div className="card-heading"><div><h2>{setup ? '1. Households and deadline' : 'Households and deadline'}</h2></div></div><fieldset disabled={disabled} className="input-grid input-global"><legend className="sr-only">Operation target</legend>{operationName !== undefined && <label>Operation name<input required maxLength={100} value={operationName} onChange={event => onNameChange?.(event.target.value)} /></label>}<label>Households to supply<input type="number" min="1" max="100" step="1" required value={display(draft.target_kits)} onChange={event => edit({ target_kits: numeric(event.target.value) })} /></label><label>Delivery window (days)<input type="number" min="0" max="30" step="1" required value={display(draft.deadline_days)} onChange={event => edit({ deadline_days: numeric(event.target.value) })} /></label></fieldset></section>

    <section className="card input-section"><div className="card-heading"><div><h2>{setup ? '2. Supplies per household' : 'Supplies per household'}</h2><p>A complete kit contains every supply listed here.</p></div><button type="button" className="button subtle" disabled={disabled || draft.needs.length >= 6} onClick={() => edit({ needs: [...draft.needs, { id: identifier('need'), name: '', category: '', quantity: Number.NaN }] })}>Add supply</button></div>{draft.needs.map((need, index) => <fieldset key={need.id} disabled={disabled} className="input-record"><legend>Supply {index + 1}</legend><div className="input-grid"><label>Supply name<input required maxLength={100} value={need.name} onChange={event => edit({ needs: draft.needs.map(item => item.id === need.id ? { ...item, name: event.target.value } : item) })} /></label><label>Category<input required maxLength={40} placeholder="food, shelter, hygiene…" value={need.category} onChange={event => edit({ needs: draft.needs.map(item => item.id === need.id ? { ...item, category: event.target.value } : item) })} /></label><label>Units per household<input type="number" min="1" max="500" step="1" required value={display(need.quantity)} onChange={event => edit({ needs: draft.needs.map(item => item.id === need.id ? { ...item, quantity: numeric(event.target.value) } : item) })} /></label></div><button type="button" className="text-button input-remove" disabled={draft.needs.length <= 1} onClick={() => removeNeed(need.id)}>Remove supply</button></fieldset>)}</section>

    <section className="card input-section"><div className="card-heading"><div><h2>{setup ? '3. Supplier offers' : 'Supplier offers'}</h2><p>Include tax and shipping in each unit price.</p></div><button type="button" className="button subtle" disabled={disabled || draft.offers.length >= 24 || !draft.needs.length} onClick={() => edit({ offers: [...draft.offers, { id: identifier('offer'), supplier: '', need_id: draft.needs[0].id, unit_cost_cents: Number.NaN, stock: Number.NaN, delivery_days: Number.NaN, active: true }] })}>Add offer</button></div>{draft.offers.map((offer, index) => <fieldset key={offer.id} disabled={disabled} className="input-record"><legend>Offer {index + 1}</legend><div className="input-grid"><label>Supplier name<input required maxLength={100} value={offer.supplier} onChange={event => edit({ offers: draft.offers.map(item => item.id === offer.id ? { ...item, supplier: event.target.value } : item) })} /></label><label>Supply type<select value={offer.need_id} onChange={event => edit({ offers: draft.offers.map(item => item.id === offer.id ? { ...item, need_id: event.target.value } : item) })}>{draft.needs.map(need => <option key={need.id} value={need.id}>{need.name || 'Unnamed supply'}</option>)}</select></label><label>Unit price (USD)<input type="number" required min="0.01" max="10000" step="0.01" value={display(offer.unit_cost_cents / 100)} onChange={event => edit({ offers: draft.offers.map(item => item.id === offer.id ? { ...item, unit_cost_cents: Math.round(numeric(event.target.value) * 100) } : item) })} /></label><label>Units in stock<input type="number" required min="0" max="500" step="1" value={display(offer.stock)} onChange={event => edit({ offers: draft.offers.map(item => item.id === offer.id ? { ...item, stock: numeric(event.target.value) } : item) })} /></label><label>Delivery (days)<input type="number" required min="0" max="365" step="1" value={display(offer.delivery_days)} onChange={event => edit({ offers: draft.offers.map(item => item.id === offer.id ? { ...item, delivery_days: numeric(event.target.value) } : item) })} /></label></div><div className="action-row"><label className="check-label"><input type="checkbox" checked={offer.active} onChange={event => edit({ offers: draft.offers.map(item => item.id === offer.id ? { ...item, active: event.target.checked } : item) })} />Offer available</label><button type="button" className="text-button input-remove" disabled={draft.offers.length <= 1} onClick={() => edit({ offers: draft.offers.filter(item => item.id !== offer.id) })}>Remove offer</button></div></fieldset>)}</section>

    <section className="card input-section"><div className="card-heading"><div><h2>{setup ? '4. Funding' : 'Funding'}</h2><p>{setup && allowNoFunds ? 'Enter a budget now, or save the operation to upload a grant.' : 'Enter your budget and what it can pay for.'}</p></div><button type="button" className="button subtle" disabled={disabled || draft.funds.length >= 6} onClick={() => edit({ funds: [...draft.funds, { id: identifier('fund'), name: '', available_cents: Number.NaN, categories: [], confirmed: false }] })}>Add funding pool</button></div>{draft.funds.length > 0 && <p className="input-guidance">Supply categories: {[...new Set(draft.needs.map(need => need.category).filter(Boolean))].join(', ') || 'add a supply category first'}. Separate categories with commas.</p>}{draft.funds.map((fund, index) => <fieldset key={fund.id} disabled={disabled} className="input-record"><legend>Pool {index + 1}</legend><div className="input-grid"><label>Pool name<input required maxLength={100} value={fund.name} onChange={event => edit({ funds: draft.funds.map(item => item.id === fund.id ? { ...item, name: event.target.value } : item) })} /></label><label>Planned budget (USD)<input type="number" required min="0" max="1000000" step="0.01" value={display(fund.available_cents / 100)} onChange={event => edit({ funds: draft.funds.map(item => item.id === fund.id ? { ...item, available_cents: Math.round(numeric(event.target.value) * 100) } : item) })} /></label><label>Allowed categories<input required value={fund.categories.join(',')} onChange={event => edit({ funds: draft.funds.map(item => item.id === fund.id ? { ...item, categories: event.target.value.split(',') } : item) })} /></label></div><div className="action-row"><label className="check-label"><input type="checkbox" checked={fund.confirmed} onChange={event => edit({ funds: draft.funds.map(item => item.id === fund.id ? { ...item, confirmed: event.target.checked } : item) })} />I confirmed these funding restrictions</label><button type="button" className="text-button input-remove" disabled={draft.funds.length <= 1 && !allowNoFunds} onClick={() => edit({ funds: draft.funds.filter(item => item.id !== fund.id) })}>Remove pool</button></div></fieldset>)}</section>

    <div className="card input-submit">{error && <p className="error-banner" role="alert">{error}</p>}<button type="submit" className="button primary" disabled={disabled}>{setup ? (allowNoFunds ? 'Save operation' : 'Continue to planner') : 'Apply plan changes'}</button></div>
  </form>;
}

export type Need = { id: string; name: string; category: string; quantity: number };
export type Fund = { id: string; name: string; available_cents: number; categories: string[]; confirmed: boolean };
export type Offer = { id: string; supplier: string; need_id: string; unit_cost_cents: number; stock: number; delivery_days: number; active: boolean };
export type Scenario = { currency: string; deadline_days: number; target_kits: number; needs: Need[]; funds: Fund[]; offers: Offer[] };
export type Purchase = { offer_id: string; need_id: string; supplier: string; quantity: number; cost_cents: number; allocations: { fund_id: string; amount_cents: number }[] };
export type Plan = { id: string; input_digest: string; status: string; complete_kits: number; target_kits: number; total_cost_cents: number; purchases: Purchase[]; unmet: Record<string, number>; notes: string[]; elapsed_ms: number; finance_version?: number | null };
export const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

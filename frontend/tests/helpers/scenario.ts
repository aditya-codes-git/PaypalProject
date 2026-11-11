import type { Scenario } from '../../src/types';

export const testScenario = (): Scenario => ({
  currency: 'USD', deadline_days: 1, target_kits: 60,
  needs: [
    { id: 'food', name: 'Food pack', category: 'food', quantity: 1 },
    { id: 'blanket', name: 'Thermal blanket', category: 'shelter', quantity: 1 },
    { id: 'hygiene', name: 'Hygiene kit', category: 'hygiene', quantity: 1 },
  ],
  funds: [
    { id: 'food-grant', name: 'Community food grant', available_cents: 60000, categories: ['food'], confirmed: true },
    { id: 'shelter-grant', name: 'Shelter response fund', available_cents: 48000, categories: ['shelter'], confirmed: true },
    { id: 'flexible', name: 'Emergency reserve', available_cents: 72000, categories: ['food', 'shelter', 'hygiene'], confirmed: true },
  ],
  offers: [
    { id: 'a-food', supplier: 'Riverbend Supplies', need_id: 'food', unit_cost_cents: 1000, stock: 60, delivery_days: 1, active: true },
    { id: 'a-hygiene', supplier: 'Riverbend Supplies', need_id: 'hygiene', unit_cost_cents: 600, stock: 60, delivery_days: 1, active: true },
    { id: 'b-blanket', supplier: 'Harbor Essentials', need_id: 'blanket', unit_cost_cents: 800, stock: 60, delivery_days: 1, active: true },
    { id: 'c-blanket', supplier: 'Northstar Relief Goods', need_id: 'blanket', unit_cost_cents: 950, stock: 60, delivery_days: 1, active: true },
    { id: 'c-food', supplier: 'Northstar Relief Goods', need_id: 'food', unit_cost_cents: 900, stock: 80, delivery_days: 4, active: true },
  ],
});

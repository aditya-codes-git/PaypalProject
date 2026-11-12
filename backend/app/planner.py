"""Two-stage integer optimization, followed by independent invariant checks."""

import hashlib
import time
from uuid import uuid4

from ortools.sat.python import cp_model

from .models import Allocation, Plan, PlanningRequest, Purchase


def validate_plan(request: PlanningRequest, plan: Plan, *, unit_target: int | None = None) -> None:
    """Reject invalid output even if a future solver/model change introduces it."""
    target = request.target_kits if unit_target is None else unit_target
    offers = {offer.id: offer for offer in request.offers}
    needs = {need.id: need for need in request.needs}
    funds = {fund.id: fund for fund in request.funds}
    spending = {fund.id: 0 for fund in request.funds}
    bought = {need.id: 0 for need in request.needs}
    seen = set()
    for purchase in plan.purchases:
        if purchase.offer_id in seen:
            raise ValueError("Duplicate offer in plan.")
        seen.add(purchase.offer_id)
        offer = offers[purchase.offer_id]
        if not offer.active or offer.delivery_days > request.deadline_days:
            raise ValueError("Unavailable or late offer selected.")
        if not 0 < purchase.quantity <= offer.stock:
            raise ValueError("Invalid stock allocation.")
        if purchase.need_id != offer.need_id or purchase.supplier != offer.supplier:
            raise ValueError("Purchase does not match offer.")
        if purchase.cost_cents != purchase.quantity * offer.unit_cost_cents:
            raise ValueError("Purchase arithmetic mismatch.")
        if sum(row.amount_cents for row in purchase.allocations) != purchase.cost_cents:
            raise ValueError("Funding does not cover purchase.")
        for allocation in purchase.allocations:
            fund = funds[allocation.fund_id]
            if not fund.confirmed or needs[offer.need_id].category not in fund.categories:
                raise ValueError("Ineligible fund selected.")
            spending[fund.id] += allocation.amount_cents
        bought[offer.need_id] += purchase.quantity
    if any(spending[fund.id] > fund.available_cents for fund in request.funds):
        raise ValueError("Fund overspent.")
    if plan.target_kits != target or not 0 <= plan.complete_kits <= target:
        raise ValueError("Invalid kit count.")
    for need in request.needs:
        if bought[need.id] != max(0, plan.complete_kits * need.quantity - request.committed.get(need.id, 0)):
            raise ValueError("Plan contains incomplete kits or excess purchases.")
    if plan.unmet != {
        need.id: max(0, target * need.quantity - request.committed.get(need.id, 0) - bought[need.id])
        for need in request.needs
    }:
        raise ValueError("Unmet need arithmetic mismatch.")
    if plan.total_cost_cents != sum(row.cost_cents for row in plan.purchases):
        raise ValueError("Total arithmetic mismatch.")


def solve(request: PlanningRequest, time_limit: float = 3.0, *, unit_target: int | None = None) -> Plan:
    started = time.perf_counter()
    target = request.target_kits if unit_target is None else unit_target
    digest_source = request.model_dump_json()
    if unit_target is not None:
        digest_source += f":units:{unit_target}"
    digest = hashlib.sha256(digest_source.encode()).hexdigest()
    model = cp_model.CpModel()
    kits = model.new_int_var(0, target, "complete_kits")
    quantities = {}
    allocations = {}
    need_by_id = {need.id: need for need in request.needs}
    for offer in request.offers:
        eligible = offer.active and offer.delivery_days <= request.deadline_days
        quantities[offer.id] = model.new_int_var(0, offer.stock if eligible else 0, f"q_{offer.id}")
        for fund in request.funds:
            if fund.confirmed and need_by_id[offer.need_id].category in fund.categories:
                allocations[offer.id, fund.id] = model.new_int_var(
                    0, fund.available_cents, f"a_{offer.id}_{fund.id}"
                )
        model.add(sum(allocations.get((offer.id, fund.id), 0) for fund in request.funds)
                  == quantities[offer.id] * offer.unit_cost_cents)
    for need in request.needs:
        remaining = model.new_int_var(0, target * need.quantity, f"remaining_{need.id}")
        model.add_max_equality(remaining, [0, kits * need.quantity - request.committed.get(need.id, 0)])
        model.add(sum(quantities[offer.id] for offer in request.offers if offer.need_id == need.id) == remaining)
    for fund in request.funds:
        model.add(sum(allocations.get((offer.id, fund.id), 0) for offer in request.offers)
                  <= fund.available_cents)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = 1
    model.maximize(kits)
    first = solver.solve(model)
    valid = (cp_model.OPTIMAL, cp_model.FEASIBLE)
    notes = ["Objective: maximize complete kits by the deadline, then minimize known item costs.",
             "Stock and delivery are reported inputs. This calculation executes no purchases."]
    if request.committed:
        notes.append("Kit totals include existing reserved or paid supplies. New purchases cover only remaining needs.")
    if first not in valid:
        return Plan(id=str(uuid4()), input_digest=digest,
                    status=solver.status_name(first), complete_kits=0, target_kits=target,
                    total_cost_cents=0, purchases=[], unmet={n.id: max(0, n.quantity * target - request.committed.get(n.id, 0)) for n in request.needs},
                    notes=["No usable result was found within the solver limit. No purchase is proposed."],
                    elapsed_ms=round((time.perf_counter() - started) * 1000))

    best_kits = solver.value(kits)

    def snapshot():
        return {key: solver.value(value) for key, value in quantities.items()}, {
            key: solver.value(value) for key, value in allocations.items()}

    selected_quantities, selected_allocations = snapshot()
    model.add(kits == best_kits)
    model.minimize(sum(quantities[o.id] * o.unit_cost_cents for o in request.offers))
    remaining = time_limit - (time.perf_counter() - started)
    second = None
    if remaining > 0:
        solver.parameters.max_time_in_seconds = remaining
        second = solver.solve(model)
        if second in valid:
            selected_quantities, selected_allocations = snapshot()
    status = "OPTIMAL" if first == cp_model.OPTIMAL and second == cp_model.OPTIMAL else "FEASIBLE"
    if status != "OPTIMAL":
        notes.append("A feasible plan is available; the full two-stage optimum was not proven.")
    if best_kits < target:
        label = "kits" if unit_target is None else "units"
        notes.append(f"{target - best_kits} {label} remain unfulfilled under the current confirmed constraints.")
    purchases = [Purchase(offer_id=o.id, need_id=o.need_id, supplier=o.supplier,
                          quantity=selected_quantities[o.id], cost_cents=selected_quantities[o.id] * o.unit_cost_cents,
                          allocations=[Allocation(fund_id=f.id, amount_cents=selected_allocations[o.id, f.id])
                                       for f in request.funds if selected_allocations.get((o.id, f.id), 0) > 0])
                 for o in request.offers if selected_quantities[o.id] > 0]
    plan = Plan(id=str(uuid4()), input_digest=digest,
                status=status, complete_kits=best_kits, target_kits=target,
                total_cost_cents=sum(p.cost_cents for p in purchases), purchases=purchases,
                unmet={n.id: max(0, target * n.quantity - request.committed.get(n.id, 0) - sum(p.quantity for p in purchases if p.need_id == n.id)) for n in request.needs},
                notes=notes, elapsed_ms=round((time.perf_counter() - started) * 1000))
    validate_plan(request, plan, unit_target=unit_target)
    return plan


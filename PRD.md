# ReliefOps — Product Requirements Document

**Version:** 0.1 — proposed product baseline  
**Date:** November 10, 2026  
**Status:** Product target; planning, evidence, approval and sandbox execution implemented. See README.md for measured results and remaining live verification.  
**Budget:** $0 out of pocket for development, testing, and the hackathon demo  
**Working name:** ReliefOps

## 1. Product definition

ReliefOps helps a relief coordinator turn urgent supply needs, restricted funding, and supplier offers into an approved purchasing plan. It connects that plan to PayPal sandbox payments and repairs the remaining plan when stock, delivery estimates, or payment outcomes change.

**Core question:** What can we purchase in time, using funds we are allowed to spend—and what changes when something fails?

**Product promise:** Every recommended purchase is checked against confirmed constraints, explained with supporting evidence, explicitly approved, and traceable through execution.

This promise applies to information and transactions recorded in ReliefOps. The product does not establish that a supplier's claims are true, guarantee physical delivery, or control payments made outside the application.

## 2. Problem and proposed audience

### 2.1 Problem

Available money alone does not determine a workable relief purchase. A coordinator must simultaneously consider:

- Quantities and types of supplies needed.
- Funding purposes, exclusions, expiry dates, and remaining balances.
- Supplier prices, stock, minimum quantities, and reported delivery dates.
- Purchases already approved, reserved, or paid.
- Operational changes that invalidate part of a plan.

An individually valid purchase can consume flexible funds needed elsewhere. The cheapest offer can miss a deadline. Replanning without accounting for existing payments can double-spend or duplicate purchases.

### 2.2 Initial user

The initial user is the purchasing coordinator at a small relief organization, working with a known supplier roster on one operation. Finance reviewers approve spending. Suppliers provide offers and availability updates. Program staff confirm needs and priorities.

The hypothesis is that these users need a lightweight, connected planning and payment workflow. This has not yet been validated through user interviews.

### 2.3 Illustrative scenario

An organization has $600 restricted to food and $400 in flexible emergency funding. It needs $600 of food and $400 of blankets by tomorrow. Using flexible funding for food can leave the blanket purchase without eligible funds, despite sufficient total money at the outset.

ReliefOps proposes food funded from the food grant and blankets funded from the flexible pool. If the blanket supplier becomes unavailable, it preserves the completed food purchase, reassesses alternatives, and exposes any remaining shortfall.

All scenario data is fictional. Dollar amounts illustrate a single-currency operation.

## 3. Goals, outcomes, and boundaries

### 3.1 Goals

1. Produce feasible purchase plans under explicit funding, stock, and deadline constraints.
2. Make each recommendation inspectable and correctable by a coordinator.
3. Execute approved sandbox purchases without duplicate captures or conflicting fund reservations.
4. Replan safely around completed, pending, and uncertain transactions.
5. Demonstrate the full cycle, including a disruption, in a concise working demo.
6. Support extensive repeatable testing without depending on paid APIs or hosting.

### 3.2 Success measures

These are proposed acceptance targets, not measured results.

| Measure | Initial acceptance target |
| --- | --- |
| Confirmed hard-constraint violations | Zero in accepted plans across the regression suite |
| Unauthorized payment execution | Zero successful payment actions without a current approval |
| Duplicate execution | One captured payment per approved purchase intent under tested retries and duplicate events |
| Concurrent reservations | No negative available fund balance under tested competing approvals |
| Recovery | Interrupted jobs resume or enter a visible review state without silently losing work |
| Explanation coverage | Every purchase exposes funding allocation, source inputs, and relevant constraints |
| AI grounding | Every extracted rule proposed for confirmation includes a verifiable source reference |
| Plan responsiveness | Target a usable result within 10 seconds for the demo dataset; benchmark before committing |
| Demo completeness | Need intake through payment, disruption, replanning, and audit record works end to end |
| Cost | No paid service required by the baseline configuration |

### 3.3 Outside the initial scope

- Global humanitarian logistics, vehicle routing, warehouse management, or beneficiary distribution.
- Autonomous decisions about beneficiary eligibility or humanitarian priority.
- Supplier vetting, real-time stock guarantees, or proof of delivery inferred from payment.
- Multi-organization pooled purchasing or a public supplier marketplace.
- Live money movement, escrow, lending, foreign exchange, or automated bank balance verification.
- PayPal marketplace onboarding, arbitrary merchant checkout automation, or unattended buyer authorization.
- A general-purpose chat assistant or multiple autonomous agents.
- Complex grant-law interpretation, formal accounting certification, or complete accounting software.
- Advanced scheduling, vector search, paid OCR, SMS, or email-dependent onboarding.

## 4. Personas and permissions

| Role | Responsibilities | Permissions |
| --- | --- | --- |
| Coordinator | Confirm needs, review offers, generate and revise plans | Edit operational inputs and propose purchases |
| Approver | Review funding and spending | Confirm funding rules and approve a specific plan version |
| Organization administrator | Manage access and operation setup | Assign roles and configure funding pools |
| Supplier contact | Submit an offer or availability change | No access to funding balances or approval controls |

The demo may use pre-created accounts with combined coordinator and approver roles. Authorization must remain enforced on the backend. External supplier submissions can initially be represented by coordinator-entered, clearly attributed updates.

## 5. Core user journey

1. Sign in and select an operation.
2. Add needs, quantities, deadlines, and coordinator-defined priorities.
3. Add funding pools and upload supporting terms.
4. Review AI-proposed rules and confirm or correct them.
5. Add supplier offers with prices, stock, delivery estimates, and validity dates.
6. Generate a plan and inspect alternatives, allocations, unmet needs, and assumptions.
7. Approve a specific plan version; atomically reserve eligible funds.
8. Complete required PayPal buyer approvals for the individual supplier purchases.
9. Track capture and reconciliation outcomes.
10. Introduce a supplier or payment disruption.
11. Replan uncommitted purchases while preserving existing commitments.
12. Review and approve material changes; inspect the final audit trail.

## 6. Functional requirements

### FR-01 — Operations and needs

- Support one organization with distinct operations and a single currency per operation.
- Store item type, unit, quantity, needed-by time, destination label, priority, and source.
- Store times in UTC and display the operation's selected timezone.
- Require human confirmation of AI-interpreted quantities, units, and priorities.
- Flag missing or inconsistent fields instead of inventing defaults that affect eligibility.
- Suggest possible duplicate requests for review; do not silently merge them.

**Acceptance:** An incomplete need cannot enter planning until its required fields are resolved or it is explicitly excluded with a reason.

### FR-02 — Funding pools and evidence

- Store opening allocation, confirmed restrictions, eligible categories, exclusions, validity period, and evidence references.
- Track available, reserved, spent, and unresolved committed amounts.
- Represent money in integer minor units; support one explicitly chosen currency initially.
- Separate proposed AI interpretations from confirmed enforceable rules.
- Require confirmation before a restriction becomes active.
- Route unsupported, contradictory, or unclear terms to manual review.
- Preserve rule versions and their source documents.

Fund pools are application allocations. They are not separate PayPal balances or legally segregated accounts. The coordinator supplies funding balances; the prototype does not verify external cash availability.

**Acceptance:** A plan cannot allocate an expense to an unconfirmed or ineligible pool. Unknown payment outcomes retain their commitment until resolved.

### FR-03 — Supplier offers

- Record supplier identity, sandbox merchant mapping, item specification, price, stock, delivery estimate, and offer expiry.
- Include delivery charges and taxes in the known payable total, or require review if the total is incomplete.
- Distinguish supplier-reported availability from coordinator-confirmed information.
- Mark expired or withdrawn offers unavailable for new approval.
- Normalize simple units explicitly; block ambiguous conversions.
- Use predefined acceptable substitutions; AI may propose additional substitutions for confirmation.

**Acceptance:** An offer that is expired, withdrawn, or missing a required cost cannot be approved for execution.

### FR-04 — Planning and optimization

- Use OR-Tools CP-SAT for purchasing and fund-allocation decisions.
- Inputs must be structured, versioned, and validated independently of the model.
- Enforce funding eligibility, balances, integer quantities, stock, and deadline constraints.
- Account for approved reservations, pending payments, and completed purchases.
- Start with a coordinator-confirmed kit definition and a lexicographic objective: maximize complete kits delivered by the deadline, then minimize total cost while preserving the first objective's achieved value.
- Clearly identify partial fulfillment and unmet needs.
- Report solver status: optimal, feasible, infeasible, unknown, or invalid input/model.
- Never label a time-limited feasible result as proven optimal.
- Bound runtime and concurrency; expose cancellation and resource-limit outcomes.
- Explain common shortfalls through explicit checks or additional feasibility analysis; do not fabricate a solver explanation through the LLM.

**Acceptance:** Every returned candidate passes an independent constraint validator before it becomes approvable. Small benchmark instances are checked against exhaustive enumeration where practical.

### FR-05 — Plan review and approval

- Present supplier choices, item quantities, all known costs, delivery assumptions, funding allocations, unmet needs, and tradeoffs.
- Allow input changes followed by regeneration; preserve the previous version for comparison.
- Bind approval to an immutable snapshot of the plan, input versions, line items, recipients, amounts, currency, and approver.
- Revalidate current eligibility and availability before creating an execution intent.
- Atomically reserve funds when approval succeeds.
- Reject stale approvals or concurrent reservations that no longer fit.
- Require new approval for recipient, amount, quantity, substitution, or funding-allocation changes.

**Acceptance:** Two simultaneous approvals competing for the same remaining pool cannot both reserve beyond its balance.

### FR-06 — PayPal sandbox execution

- Use PayPal sandbox buyer and business accounts representing the organization and demo suppliers.
- Start with an explicit checkout per supplier purchase. Each supplier merchant configuration is controlled for the demo.
- Create orders and capture through backend endpoints; collect buyer approval through PayPal's supported checkout flow.
- Validate server-side order identity, recipient, amount, currency, purchase intent, and current approval before capture.
- Persist the execution intent before an external side effect.
- Use stable idempotency keys on supported operations and reconcile uncertain results before reattempting.
- Verify webhook authenticity, deduplicate events, and handle delayed or out-of-order events.
- Use PayPal status lookup to resolve missing or ambiguous notifications.
- Record captures and refunds separately from operational fulfillment.
- A timeout is an unknown outcome until checked; it must not immediately release reserved funding.

The prototype does not claim that ordinary checkout automatically provides a general nonprofit purchasing account, multi-seller platform authorization, or payment access to arbitrary suppliers. Production merchant onboarding and permissions require separate validation.

**Acceptance:** A capture succeeds only for a current approved intent. Retrying an uncertain operation first checks its persisted and provider state. Verified success moves the relevant reservation to spent exactly once.

### FR-07 — Disruptions and replanning

- Support offer withdrawal, reduced stock, price change, delivery change, failed payment, and unresolved payment.
- Preserve completed purchases and protect unresolved commitments.
- Release reservations only when the associated execution is definitively cancelled, expired, or failed without payment.
- Recompute the remaining needs and funding using current confirmed inputs.
- Show differences from the previous plan and request approval for material changes.
- If no feasible replacement exists, show the shortage and actionable options without silently relaxing hard rules.
- A supplier cancellation after payment enters a resolution/refund flow. Funds become available only after a confirmed outcome supports the release.

**Acceptance:** With one supplier purchase captured and another withdrawn before payment, replanning neither duplicates the completed purchase nor reuses its spent allocation.

### FR-08 — Audit and transparency

- Maintain application-level append-only events for input changes, rule confirmation, planning, approval, reservation, payment attempts, provider events, and replanning.
- Include actor, timestamp, operation, correlation identifier, prior version, resulting version, and relevant reason.
- Link decisions to source documents and confirmed rules.
- Provide an operation summary and downloadable purchase/allocation records.
- Keep private funding documents and credentials out of public exports.
- Describe this as an audit trail, not a tamper-proof or independently certified ledger.

**Acceptance:** A reviewer can trace a captured purchase back to its approval, funding allocations, confirmed restrictions, and evidence.

### FR-09 — AI behavior

- Use Groq-hosted GPT-OSS 120B as the initial model, subject to account availability and evaluation.
- Use structured outputs and Pydantic validation for proposed records.
- Treat document content as untrusted data; extracted instructions cannot change permissions, funding rules, or payment recipients.
- Verify referenced quotations against extracted document text before presenting them as evidence.
- Give the model narrow tools for reading state and requesting calculations. Payment endpoints independently require authorized approval.
- Save document extractions using document hashes and extraction versions.
- Track tokens, request outcomes, model identity, and prompt/schema versions.
- Respect rate-limit responses, bound retries, and show a queued or temporarily unavailable state.
- Preserve manual entry and planning when AI quota is unavailable. Label manual inputs and saved results clearly.

**Acceptance:** Malformed or unsupported model output cannot create an active rule or payment. Adversarial test documents cannot bypass backend approval or reservation checks.

## 7. Execution and recovery model

These state groups are related but remain separate:

| Entity | Illustrative states |
| --- | --- |
| Plan | Draft → validated → approved → executing → completed / disrupted / superseded |
| Purchase | Proposed → reserved → awaiting buyer approval → payment pending → paid; with cancellation and review branches |
| Payment attempt | Created → submitted → confirmed / definitively failed / unknown; unknown resolves through reconciliation |
| Job | Queued → leased → running → succeeded / retryable / failed / awaiting review |

- PostgreSQL transactions protect reservations and state transitions.
- A database outbox records work alongside the state change that requires it.
- Workers claim jobs with leases. Interrupted jobs can be reclaimed after checking their side effects.
- Local testing can run a dedicated worker process at no service charge.
- The free hosted backend processes work only while running. Startup or a later request can trigger recovery; a sleeping service does not provide continuous processing.
- No database transaction is held open while waiting for PayPal or a human.
- Approval waits are persisted states, not an in-memory conversation or long-running browser request.

## 8. Product experience

The main experience is an operations workspace with:

1. Needs and current fulfillment.
2. Funding pools and restrictions.
3. Supplier offer comparison.
4. Plan review and alternatives.
5. Approvals and purchase execution.
6. Disruptions requiring attention.
7. Evidence and audit history.

AG Grid Community supports detailed tables. Standard forms and focused review panels handle confirmation and approval. A chat interface is optional and cannot be the only way to perform a core task.

Show meaningful states for loading, missing information, solver timeout, AI quota exhaustion, stale plans, unknown payments, and recovery. Use text alongside color. Core workflows must work with keyboard navigation and readable labels.

## 9. Technical baseline and $0 constraints

| Area | Baseline | Cost boundary |
| --- | --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind, shadcn/ui | Open-source components; no paid assets required |
| Tables | AG Grid Community | No Enterprise or Studio dependency |
| Backend | Python, FastAPI, Pydantic | Single modular application |
| Persistence | PostgreSQL, SQLAlchemy, Alembic | Local database for extensive tests; Supabase Free for demo |
| Auth and documents | Supabase Auth and Storage | Pre-created demo accounts; no email-dependent signup |
| Planning | OR-Tools CP-SAT | Local computation; bounded hosted workload |
| AI | Groq Python SDK, GPT-OSS 120B | Free tier only; no automatic paid upgrade |
| PDF text | pypdf | Local extraction; scanned OCR optional and separately benchmarked |
| OCR | Tesseract, if included | Local testing first; no paid OCR service |
| Payments | PayPal JavaScript SDK and REST APIs | Sandbox only |
| Jobs | PostgreSQL jobs/outbox and application worker | No Render Workflows, managed paid worker, or Redis requirement |
| Hosting | Render static site and one Free web service | Subject to account eligibility and measured resource fit |
| Tests | pytest, Playwright, local failure simulations | Live integration checks budgeted separately |
| Repository/CI | Public GitHub repository; standard hosted runners | Limit retained artifacts and caches |

### 9.1 Published service assumptions

The following are reference values checked during stack discussion on November 9–10, 2026. They are not reserved capacity or contractual guarantees. Verify actual account limits before deployment.

- Groq GPT-OSS 120B: published Free limits of 30 requests/minute, 1,000/day, 8,000 tokens/minute, and 200,000 tokens/day. All applicable limits matter; requests may consume thousands of tokens each.
- Supabase Free: 500 MB database, 1 GB files, 5 GB egress plus 5 GB cached egress, 50,000 monthly active users, and two active projects. Projects can pause after a week of inactivity.
- Render Free backend: 0.1 CPU, 512 MB RAM, idle suspension after 15 minutes, temporary local files, and 750 shared Free instance hours per workspace per month.
- Render Hobby: published 500 build minutes and 5 GB outbound bandwidth monthly. Verify current allowances and overage behavior in the account.
- Render free PostgreSQL expires after 30 days and is excluded.
- Render Workflows is metered and is excluded from the baseline. Temporary sponsor credits are not required by the architecture.

The backend must be benchmarked on the free compute envelope. If it does not fit, the repository must still provide a functional local build; public hosting must not be described as adequate without evidence.

### 9.2 Sponsor usage

- **PayPal:** required payment integration.
- **AG Grid:** operational comparison and allocation tables, Community edition only.
- **Render:** hosting, conditional on free-account and resource verification.
- No other sponsor integration is currently justified. Groq and Supabase are technology providers, not claimed hackathon sponsors.

## 10. Data and security requirements

- Scope every organization-owned record and file to its organization; enforce authorization on backend and storage access.
- Keep PayPal, Groq, and privileged Supabase credentials server-side.
- Use sandbox-specific configuration and visibly label demo payments.
- Redact credentials, tokens, and sensitive document content from logs.
- Restrict document size and types; treat parsed text as untrusted.
- Use synthetic data for public demos and test fixtures.
- Preserve approved snapshots and external transaction identifiers for reconciliation.
- Provide local export/restore instructions rather than assume free managed backup coverage.
- Prevent public demo use from consuming unbounded AI quota: authenticated access, request limits, and bounded operation sizes.

## 11. Testing and release acceptance

### 11.1 Repeatable local suite

The suite must cover:

1. Restricted and flexible funding allocation, including the motivating example.
2. Insufficient eligible funding despite sufficient aggregate funding.
3. Stock shortages, deadline failures, withdrawn offers, and incomplete costs.
4. Integer money arithmetic, allocation totals, and quantity/unit validation.
5. Solver timeout, unknown status, infeasible status, and invalid inputs.
6. Independent validation of solver output and small-instance optimality checks.
7. Concurrent approvals and stale plan versions.
8. Duplicate requests, duplicate webhooks, and out-of-order provider events.
9. Timeout after a potentially successful capture.
10. Worker interruption before and after an external side effect.
11. Replanning after partial payment and post-payment supplier cancellation.
12. Refund pending versus confirmed and correct fund availability.
13. Cross-organization access attempts and unauthorized approvals.
14. Malformed AI output, unsupported source claims, and injected document instructions.
15. AI quota exhaustion, API failure, and manual-input continuity.
16. Browser journeys through approval, payment, disruption, and audit review.

Use controlled model and payment responses for repeatable failure tests. These do not substitute for live integration verification.

### 11.2 Live checks

- Evaluate Groq extraction on a small labeled corpus of clear, ambiguous, and adversarial documents.
- Record source-reference accuracy, field correctness, review frequency, latency, and token usage.
- Exercise actual PayPal sandbox order approval, capture, lookup, refund, and webhook handling for supported demo flows.
- Verify deployment startup, database connectivity, sleep/wake behavior, and recovery.
- Measure backend memory and solver duration using the intended demo dataset.
- Never load-test Groq or PayPal endpoints without provider authorization.

### 11.3 Release gate

The demo is ready only when core journeys pass, funding invariants hold, unknown payments remain safely committed, and every advertised capability has corresponding evidence. Actual results and limitations belong in the README/submission.

## 12. Hackathon demonstration scope

### Required vertical slice

- One fictional organization and one relief operation.
- One currency and a small predefined kit definition.
- Two or three funding pools with explicit restrictions.
- Three controlled supplier offers and mapped sandbox merchants.
- Confirmed needs and at least one real AI-assisted document extraction.
- A validated plan with inspectable evidence and allocations.
- Individual PayPal sandbox checkout flows.
- One completed purchase followed by another supplier's pre-payment withdrawal.
- Revised plan or explicit shortfall, renewed approval, and final audit record.

### Demonstration narrative

Show the funding-allocation problem, generate and approve a valid plan, complete one purchase, then break the remaining plan live. Demonstrate that ReliefOps preserves existing commitments, exposes the changed tradeoff, and continues only after appropriate review.

### Submission requirements

- Functional hosted build or complete local setup/run instructions.
- Public source repository with a visible open-source license.
- Clear list of actual integrations, implemented capabilities, and simulated supplier data.
- Public YouTube demonstration under three minutes and English submission materials.
- Judge access through December 15, 2026, with a documented local fallback if free hosting pauses.
- Submission deadline: November 13, 2026 at 1:30 a.m. IST, corresponding to November 12 at noon PST.

## 13. Competition and differentiation hypothesis

Humanitarian procurement and optimization already exist. Solvoz provides humanitarian sourcing and procurement capabilities; WFP uses planning tools including Optimus and SCOUT; SAP Ariba supports sourcing optimization; AIDONIC provides humanitarian payment and distribution capabilities.

ReliefOps proposes a focused workflow for smaller teams that joins confirmed funding restrictions, purchasing optimization, explicit PayPal approvals, and recovery around existing commitments.

This is a hypothesis about usability and workflow value, not a claim that competitors lack these capabilities. Validate it through product comparisons and interviews. Do not claim worldwide novelty, proven savings, or delivery impact without evidence.

## 14. Open decisions and material risks

| Question or risk | Required resolution |
| --- | --- |
| Does the intended user need this workflow? | Interview purchasing/finance operators and document current alternatives |
| Are free accounts available without an unaffordable verification step? | Check actual account onboarding before committing to hosting |
| Does OR-Tools fit free hosted compute? | Benchmark memory, runtime, and bounded concurrency |
| Are Groq quotas adequate for planned live checks? | Inspect account limits and measure tokens per workflow |
| Can all supplier sandbox payment flows be configured correctly? | Validate the chosen buyer/merchant checkout setup end to end |
| How trustworthy are supplier updates? | Display source, age, and confirmation status; no fabricated live inventory |
| Which grant terms are supported? | Define a limited structured rule vocabulary and review unsupported clauses |
| Can hosted jobs progress during idle periods? | They cannot on sleeping free compute; document recovery timing and local worker behavior |
| Will accounts or databases pause during judging? | Verify access before judging and supply complete local instructions |
| What is needed beyond the hackathon? | Validate merchant permissions, supplier onboarding, operations, security, and sustainable hosting separately |

## 15. References

### Challenge

- [Hackathon overview and requirements](https://paypalaihackathon.devpost.com/)
- [Official rules](https://paypalaihackathon.devpost.com/rules)
- [AG Grid sponsor guidance](https://paypalaihackathon.devpost.com/details/aggrid)

### Technical and cost references

- [Groq rate limits](https://console.groq.com/docs/rate-limits)
- [Groq GPT-OSS 120B](https://console.groq.com/docs/model/openai/gpt-oss-120b)
- [Groq structured outputs](https://console.groq.com/docs/structured-outputs)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase email restrictions](https://supabase.com/docs/guides/auth/auth-smtp)
- [Render Free service restrictions](https://render.com/docs/free)
- [Render compute plans](https://render.com/docs/compute-plans)
- [Render workspace allowances](https://render.com/docs/new-workspace-plans)
- [Render Workflows](https://render.com/docs/workflows)
- [AG Grid Community license](https://www.ag-grid.com/eula/community/)
- [OR-Tools CP-SAT](https://developers.google.com/optimization/cp/cp_solver)
- [PayPal sandbox](https://developer.paypal.com/sandbox-testing/overview)
- [PayPal idempotency](https://developer.paypal.com/api/rest/reference/idempotency/)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

### Problem and existing solutions

- [UNICEF: Supply chains save lives](https://www.unicef.org/supply/reports/supply-chains-save-lives)
- [Propel: Managing restricted funds](https://propelnonprofits.org/resources/managing-restricted-funds/)
- [Solvoz humanitarian procurement](https://solvoz.tech/humanitarian/)
- [WFP supply chain](https://www.wfp.org/supply-chain)
- [SAP Ariba sourcing optimization](https://help.sap.com/docs/strategic-sourcing/managing-events-with-guided-sourcing/using-optimization-scenarios-to-award-guided-sourcing-events)
- [AIDONIC](https://www.aidonic.io/)

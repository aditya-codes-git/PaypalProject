# ReliefOps: current stage and proposed next milestone

Reviewed November 10, 2026. Next-stage implementation awaits user approval.

## Current assessment

ReliefOps is a working local planning workspace with authentication and private persistence. It is not yet an end-to-end procurement or payment product, and does not yet satisfy the hackathon's requirement to meaningfully use both PayPal and AI.

| Capability | Actual state |
| --- | --- |
| Interface | Responsive React/TypeScript app; light/dark themes, self-hosted Geist, Lucide, generated brand asset |
| Planning | Real OR-Tools CP-SAT; maximize complete kits, then minimize cost; independent output validation |
| Constraints | Confirmed category eligibility, integer USD cents, stock, active offers, relative delivery deadline |
| Plan review | Supplier quantities, costs, allocations, unmet needs, solver status, stale-input detection |
| Authentication | Supabase Google PKCE and password flows integrated; real Google consent flow not verified in this audit |
| Persistence | Owner-scoped saved operations, revision conflicts, recent calculation snapshots |
| Data intake | Fictional seeded needs, funds, offers; UI changes household target, deadline, balances, and offer availability. Full creation/editing of needs, rules, prices, stock and suppliers is missing |
| Supplier disruption | Withdrawal followed by a fresh calculation works before purchases; does not preserve paid/pending commitments because those entities do not exist |
| AI | Configuration present; no Groq requests, document parsing, evidence review or extraction pipeline |
| Approvals | Missing; saved calculations are not spending authorization |
| Fund accounting | Editable planning inputs only; no durable opening/reserved/spent ledger |
| PayPal | Client ID/secret present; integration, merchant setup verification, checkout, capture, webhooks and reconciliation missing |
| Audit | Session activity plus saved calculations; no durable approval/payment event history |
| Deployment/submission | Local only; no deployment config, CI workflow or open-source license found |

Actual stack differs from the proposed PRD: custom CSS rather than Tailwind/shadcn; Supabase REST rather than SQLAlchemy/Alembic. These differences are not defects and do not justify rebuilding working components.

## Verification performed

- Backend: `python -m pytest -c backend/pytest.ini backend/tests -q`: **27 passed**.
- Frontend: `npm run build`: type check and production build **passed**.
- Browser/client: `npm run test:e2e`: **19 passed**, including real planner calls, sample disruptions, saved-workspace behavior, simulated OAuth, keyboard focus and both themes/mobile layouts.
- Hosted Supabase project: **ACTIVE_HEALTHY**, both application tables have RLS enabled; operations has three policies and operation_plans has two. One operation and one plan currently exist; their contents were not inspected.
- Security advisor: one warning for disabled leaked-password protection. See https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection . Account eligibility/cost for this setting was not checked; no setting was changed.
- Secret-presence check only: Groq, Supabase and PayPal core configuration present. PayPal webhook ID and supplier merchant mappings missing. Key validity and Groq account quotas were not checked.

Tests simulate authentication/cloud provider responses. They are not proof of real Google consent, live authenticated save/reload, Groq availability, or PayPal sandbox behavior. Hosted RLS presence was rechecked; cross-user attack tests were not repeated during this audit.

## Gaps and risks

1. A signed-in user can reset an unsaved scenario without confirmation; browser refresh has no dirty-state warning. Protect these actions and document that deliberate discard still loses drafts.
2. Database owners can insert their own calculation snapshots directly through the Data API. This is acceptable for calculation history only. Approval must never trust a client-written result, digest or approval flag.
3. Funding is still an editable scenario field. A financial ledger must become authoritative once a plan is approved; editing a draft cannot replenish reserved funds. Funds are operation-scoped initially, with no claim of shared cross-operation cash accounting.
4. The planning endpoint is unauthenticated and bounded per request but has no request rate/concurrency limit. Address before public hosting; CORS is not authorization.
5. Production JS is approximately 1.68 MB minified / 474 KB gzip; build warns about chunk size. Optimize after the core journey, before hosting if needed. This is not a correctness failure.
6. Most implementation files are untracked; only README, PRD and .gitattributes are currently tracked. Make a reviewed Git checkpoint before further implementation. No commit or push was made in this audit.
7. PRD status still says implementation has not started. It is a target specification, not a current capability statement; update milestone labels when implementation resumes.

## Proposed next stage: approve a plan and reserve its funds

Outcome: a signed-in coordinator can review a current plan, explicitly approve it, reserve eligible operation funds exactly once, and inspect/cancel the unexecuted approval after a refresh.

This stage establishes the boundary required for PayPal execution. It does not require another sponsor, paid service, public supplier access, or a new UI framework. Single-owner approval is sufficient for the demo; do not present it as independent finance review.

### Work sequence

1. **Checkpoint and focused fixes.** Protect reset/refresh, reconcile milestone documentation and save the current source to Git without secrets. Verify real authenticated save/reload where an available user session permits; do not request passwords in chat.
2. **Authoritative persistence.** Add operation-scoped funding balances, approvals, purchase intents, reservation allocations and durable events. Keep integer cents, ownership enforcement and explicit revisions. Use transactional database operations with narrow permissions; clients must not directly create approvals, release reservations, or alter spent totals. Provide migration and rollback instructions that preserve existing operations/calculations.
3. **Approval transaction.** Bind approval to the current operation revision, immutable inputs, supplier identities, amounts and allocations. Recompute/validate trusted inputs server-side, then atomically recheck the revision, eligibility and available funds while reserving. Reject stale, tampered and unaffordable requests. Do not hold a transaction open while waiting for humans or external services.
4. **Idempotency and cancellation.** Duplicate approval requests return the same committed outcome. Cancelling an unexecuted purchase releases its reservation exactly once. Changes do not silently mutate an approved intent; cancel/review affected unexecuted commitments and approve a replacement. Prevent planning from buying the same reserved quantities again.
5. **Product flow.** Replace the payment placeholder with a review/approve action and visible reserved/unreserved balances. Persist who approved what and when, show purchase intents and status after reload, and clearly state that no payment has occurred.
6. **Proof.** Test true competing database transactions as well as API and browser journeys. Do not substitute mocked database responses for reservation-race proof.

### Acceptance gate

- Current saved plan can be approved; stale or client-forged plans cannot.
- Double-clicks/retries do not create duplicate approvals or reservations.
- Concurrent competing approvals cannot reserve more than a pool's available balance.
- A draft balance edit cannot erase/replenish an existing reservation.
- Restricted allocations remain eligible; all monetary totals reconcile.
- Account B cannot read or mutate account A's approvals, events or reservations.
- Reload restores the approval, purchase intents and balance breakdown.
- Cancelling an unexecuted purchase releases only its own reservation, once.
- Replanning does not duplicate reserved purchases.
- Existing 27 backend and 19 browser/client checks continue to pass, plus meaningful tests for the new invariants.

Stop at this gate for review. Do not add simulated paid states or claim a payment happened.

## Subsequent stages, in order

1. **PayPal sandbox execution and disruption recovery.** First validate the controlled buyer/merchant setup with the actual credentials. Add persisted execution attempts, buyer approval, backend create/capture/lookup, supported idempotency, verified/deduplicated webhooks and unknown-outcome reconciliation. Preserve paid and pending commitments when a second supplier withdraws. Missing webhook ID can be configured once a reachable callback exists. Merchant mappings require controlled sandbox accounts; no nonprofit outreach is needed.
2. **Groq-assisted evidence intake.** Verify the configured model and actual account limits before committing to a model. Support a narrow text/PDF grant input, source-checked quotations, schema validation, human confirmation and versioned rules. Keep manual entry working, cap tokens/retries and use fixtures for extensive testing. Unsupported/scanned documents can enter manual review. AI interprets evidence and proposes inputs; it does not authorize purchases.
3. **Release and demo.** Add minimum manual CRUD for the demonstrated operation, public-endpoint limits, benchmark solver memory/runtime, deploy only within verified free account allowances, verify real OAuth/sandbox/AI flows, document export/restore, select a license with the owner, publish source, and record the demo/submission.

The verified deadline is November 12, 2026 at noon PST, or **November 13 at 1:30 a.m. IST**. Scope must prioritize one real end-to-end journey over broad team features, OCR, extra sponsors or further visual redesign.

Hackathon sources: https://paypalaihackathon.devpost.com/ and https://paypalaihackathon.devpost.com/rules .

## Approval scope

User approval of the proposed next stage authorizes the approval/reservation milestone above, including its schema/API/UI changes and tests. PayPal, Groq and deployment are sequenced follow-ups rather than silently included implementation work. No product code, schema, external settings, commits or deployment were changed during this audit.

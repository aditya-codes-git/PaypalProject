# ReliefOps

ReliefOps turns urgent supply needs, restricted funding and supplier offers into a purchasing plan, then connects explicit spending approval to PayPal sandbox checkout. When an offer changes, replanning preserves existing commitments instead of buying the same supplies twice.

The demo uses fictional relief data and sandbox money. Funding pools are operation-specific application allocations, not verified PayPal balances or shared organization cash accounts. Payment does not establish delivery.

## Implemented workflow

- Google PKCE and password sign-in through Supabase; private saved operations and revision-aware updates.
- Seven workspace views, including editable needs/offers/funds, purchasing, funding evidence and persistent decision history.
- OR-Tools planning: maximize complete kits by the delivery window, then minimize known costs. An independent validator checks funding eligibility, integer money, quantities and stock.
- Version-bound approval, exactly-once reservations under tested retries, cancellation of unsubmitted purchases, and explicit opening-allocation adjustments.
- PayPal sandbox order creation, buyer approval, backend capture, provider reconciliation, full-refund requests and verified webhook handling.
- Durable payment intents. Unknown outcomes retain commitments; reconciliation protects paid/pending supplies during replanning.
- Groq-assisted funding proposals from text/PDF documents, exact source-quotation checks and human confirmation before rules activate.
- Supplier confirmation and invoice references, delivery receipts, and a funding report linking grant pages, purchase allocations, and received quantities.
- Saved audit and purchase export that excludes raw source-document text.
- Responsive light/dark themes, self-hosted Geist, Lucide icons and an original generated logo. See [design references](design/README.md).

This is a single-owner hackathon prototype. The operation owner also approves spending; independent finance review and team permissions are not implemented.

## Run locally

Use Python 3.12, Node.js 22.12+ and npm. From the repository root:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.lock
cd frontend
npm ci
cd ..
.\scripts\dev.ps1
```

Open **http://127.0.0.1:5173**. API documentation is at **http://127.0.0.1:8000/docs**. Ctrl+C stops both services. This checkout already has dependencies installed; start it with the final command.

The root `.env` is private and Git-ignored. Preserve any existing values. Create the file only if absent, and use [.env.example](.env.example) for variable names. Never put server secrets in `VITE_` variables or commit them. Restart the backend after configuration changes.

| Configuration | Purpose |
| --- | --- |
| No keys | Account-free planning with your own inputs |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Sign-in and private operations |
| `RELIEFOPS_SERVER_KEY` | Scoped financial gateway credential; provision its hash as described in [database setup](database/README.md) |
| `GROQ_API_KEY`, `GROQ_MODEL` | Funding-evidence extraction |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT=sandbox` | Sandbox checkout/capture/refund |
| `PAYPAL_WEBHOOK_ID` | Signature verification for the registered sandbox webhook |
| `APP_ORIGIN` | Exact app origin for PayPal returns and allowed cross-origin requests |
| `PAYPAL_MERCHANT_ID`, `PAYPAL_SUPPLIER_MERCHANTS` | Optional default or exact supplier-name-to-merchant mappings |

The hosted ReliefOps schema and `finance-gateway` Edge Function are installed. A fresh Supabase project needs [database and gateway setup](database/README.md). The app does not need a Supabase service-role secret or `DATABASE_URL`; the Edge Function uses its platform-provided credential internally. Credential presence is not proof that an integration works.

Google's provider settings live in Supabase, not `.env`. Allow exact app return URLs in Supabase Authentication URL Configuration, including both local hostnames if used. Google Cloud's authorized redirect is the Supabase `/auth/v1/callback` URL. Start and finish login in the same browser and hostname so PKCE can complete. Password access requires an existing confirmed application account; password recovery/email setup is outside this prototype.

## Run the submission demo

1. Sign in to start an empty operation. For a short, reproducible walkthrough, enter 10 households, a 1-day delivery window, one food pack per household in the `food` category, and a supplier offering 10 units at $8 with delivery in 1 day. Enter a second offer at $9 with the same stock and delivery to demonstrate replanning.
2. Save the operation with funding blank. Choose **Upload a grant document** and upload the [fictional Riverdale grant](demo/riverdale-grant.txt). Review the source quote, amount and category, then confirm the grant. Alternatively, enter and confirm a budget manually.
3. Generate the purchasing plan. The $8 offer should cover 10 households for $80. Exclude that offer and generate again. The $9 offer should cover the same households for $90.
4. Choose **Approve and reserve funds** and confirm. In **Purchases**, select **Pay with PayPal**, approve the order with a separate sandbox buyer, return, and select **Complete payment**. Use **Check PayPal status** if the payment outcome is uncertain.
5. Confirm the purchase shows **Paid** and the amount moved from reserved to spent. Open **Supplier and delivery** to record the supplier reference and a receipt. Close a short delivery only when the remaining units are no longer expected. Generate another plan to cover the shortage, then open **Reports** to inspect spending, receipts, and the grant source page. The funding report omits raw source text, payment credentials, and provider IDs.

For a quick public check, choose **Start without signing in** and enter the same needs, offers and a confirmed $100 food budget yourself. Guest plans are not saved and do not create purchases.

Before submission, verify the hosted signed-in workflow with a dedicated test account and PayPal sandbox buyer, check judge access in a clean browser, and record a public video under three minutes. See [submission copy and recording cues](SUBMISSION_KIT.md).

Unmapped fictional suppliers all use the application's default sandbox merchant. Distinct recipients require controlled sandbox merchant mappings; this is not a marketplace onboarding integration. Prices must include all payable unit costs; tax/shipping are not calculated separately. Stock and delivery are reported inputs.

After the first financial initialization, draft funding fields cannot replenish committed money. Record an explicit opening-allocation adjustment with a reason; it cannot lower a pool below existing commitments.

Supplier and invoice references are recorded by the operator. Receipts require a paid purchase. Open deliveries count their outstanding quantities as committed. Closing a short delivery makes the missing quantities eligible for replanning while keeping the original payment in the ledger. Received units remain part of coverage even if PayPal refunds the payment.

## Evidence and recovery limits

Documents are limited to 2 MB, 20 pages and 12,000 extracted characters; ten documents per operation. Encrypted/scanned PDFs require manual entry. Supported active restrictions are confirmed category eligibility. Dates, exclusions and complex clauses are surfaced for manual review rather than silently interpreted as enforceable rules.

Extraction records source hash, model, prompt/schema version, usage and latency. The app has one concurrent extraction slot and a database-backed cap of 20 requests/day; provider/account quotas may be lower or shared with other work. There are no automatic AI retries or paid-tier upgrades.

The recovery worker runs inside the single service while it is awake, scans up to ten pending intents per pass and waits 60 seconds between passes. It also runs on startup. To disable it, set `RECOVERY_WORKER=false`. For one manual recovery pass from the root:

```powershell
$env:PYTHONPATH = 'backend'
.\.venv\Scripts\python.exe -m app.recovery
```

Sleeping/stopped free compute does not process jobs continuously. Unknown captures/refunds stay committed until provider state supports a transition; expired safe retry windows require review. A submitted checkout is not cancelled merely because the buyer closed a tab.

## Verification

```powershell
# Root: ordinary backend checks; database tests skip without TEST_DATABASE_URL.
.\.venv\Scripts\python.exe -m pytest -c backend\pytest.ini backend\tests -q

# Optional: disposable LOCAL PostgreSQL for real transaction/race checks.
docker run --name reliefops-postgres -e POSTGRES_PASSWORD=local-test-only -p 127.0.0.1:55432:5432 -d postgres:17-alpine
$env:TEST_DATABASE_URL = 'postgresql://postgres:local-test-only@127.0.0.1:55432/postgres'
.\.venv\Scripts\python.exe -m pytest -c backend\pytest.ini backend\tests -q

cd frontend
npm run build
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Split-Path $PWD -Parent) '.tools\browsers'
npx playwright install chromium
npm run test:e2e
```

The database tests create/drop a uniquely named test database and require a disposable loopback PostgreSQL administrator connection. They never target the hosted operation. If the named Docker container already exists, start it instead of running a second one.

Verification recorded during implementation:

- 43 backend tests passed with real PostgreSQL, including concurrent reservations and provider-failure simulations.
- Production type check/build and Docker image build passed. Existing bundle-size warnings remain.
- All 22 browser/client checks passed, including input/approval/evidence journeys; auth/provider responses are simulated, while planning uses the real API.
- A constrained local Docker smoke test at 512 MB / 0.1 CPU served the app and calculated 60 kits in approximately 97 ms at approximately 80 MB memory. This is one dataset, not a hosted capacity guarantee.
- A real Groq synthetic extraction passed, using 1,121 tokens. Real PayPal sandbox authentication, order creation and recipient validation passed.

The [hosted demo](https://reliefops-aditya-2026.onrender.com) is live on Render Free. The hosted URL is allowed in Supabase Auth, and the PayPal sandbox webhook is registered and configured on Render.

Still to verify with real accounts: hosted Google sign-in, buyer-approved PayPal capture and refund, and signed webhook delivery. The sandbox order creation test did not capture a payment.

## Deployment

[Dockerfile](Dockerfile) builds the frontend and serves it with FastAPI on one origin. [render.yaml](render.yaml) describes one Free Docker web service with one worker process. Set its secret variables from the private environment, set `APP_ORIGIN` to the final HTTPS URL, and allow that exact URL in Supabase Auth. Do not upload `.env` in the image.

Register `https://YOUR_APP_HOST/api/paypal/webhook` in the same PayPal sandbox app, subscribe to the checkout/capture/refund events used by the demo, then set its webhook ID and restart. Until that round trip is verified, provider lookup remains the explicit reconciliation path.

No paid service is required by this configuration. Actual account eligibility, shared quotas, free-plan suspension and retained judging access must be checked in the accounts; configuration does not reserve free capacity. No always-on worker, paid database, Redis or extra sponsor integration is assumed. The demo uses AG Grid Community and runs on Render Free.

## Source map

| Path | Responsibility |
| --- | --- |
| `backend/app/planner.py` | Integer optimization and independent validation |
| `backend/app/cloud.py` | Verified sessions and revision-aware saved operations |
| `backend/app/finance.py` | Approvals, authoritative commitments, balance derivation |
| `backend/app/payments.py` | Sandbox create/capture/refund, verification and reconciliation |
| `backend/app/documents.py` | Bounded document parsing, extraction and human confirmation |
| `backend/app/recovery.py` | Recovery while the service is awake |
| `database/` | Additive schema and provisioning/rollback guidance |
| `supabase/functions/finance-gateway/` | Narrow server-to-database financial gateway |
| `frontend/src/` | Workspace, forms, evidence and purchasing UI |

The [PRD](PRD.md) remains the broader product target. This README describes implemented behavior and verification limits. Source is under the [MIT License](LICENSE).

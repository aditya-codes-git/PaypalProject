# Operations and financial state

The hosted ReliefOps project has the operations schema, additive financial migration and deployed `finance-gateway` Edge Function. Existing operations/calculations were preserved. For another project, follow the setup below once; never rerun table-creation SQL on application startup.

## Data and authorization boundaries

- `operations.sql` creates owner-scoped operations, calculation snapshots, indexes, RLS policies and a revision trigger. Conditional saves reject stale revisions.
- `finance.sql` adds `operation_finance` and private credential/AI-usage tables. One versioned JSON state per operation contains opening allocations, approvals, immutable purchase intents, documents and durable events.
- Authenticated owners can read their own financial row but cannot insert/update it directly. Anonymous clients have no application table access.
- `reliefops_finance_command` is callable only by `service_role`; `anon`, `authenticated` and `PUBLIC` have no execute grant. Its `SECURITY DEFINER` implementation has an empty search path, verifies a scoped server-key hash before any command, checks the operation owner, and locks the operation row.
- A financial write compares both operation revision and finance version, then commits the new state atomically. Confirmation can update the scenario and evidence state in the same transaction. No provider HTTP request occurs while a database lock is held.
- The Edge Function uses its platform-provided service-role credential internally to reach that narrow RPC. The application backend sends only its scoped `RELIEFOPS_SERVER_KEY`; it does not require a Supabase service-role key in `.env`.
- Ordinary saved-operation calls still use a verified user's access token. Client-inserted calculation snapshots are never treated as spending authority: approval recomputes current inputs and compares the reviewed purchase selection.

Funding is independent per operation. Creating another operation does not transfer or share a balance. These are confirmed application allocations, not bank/PayPal balance verification or organization-level accounting.

## Provision a fresh project

1. In Supabase SQL Editor or migration tooling, apply [operations.sql](operations.sql), then [finance.sql](finance.sql). `pgcrypto` must be available in the `extensions` schema, as in Supabase. Preserve existing objects; investigate name conflicts instead of dropping tables.
2. Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the private root `.env`.
3. Generate a 256-bit scoped server credential and store only its SHA-256 hash in the database. The following root-directory command preserves an existing key and prints its hash, never the secret:

```powershell
@'
import hashlib
import secrets
from pathlib import Path
from dotenv import dotenv_values, set_key

path = Path('.env')
path.touch(exist_ok=True)
key = dotenv_values(path).get('RELIEFOPS_SERVER_KEY')
if not key:
    key = secrets.token_hex(32)
    set_key(path, 'RELIEFOPS_SERVER_KEY', key)
print(hashlib.sha256(key.encode()).hexdigest())
'@ | .\.venv\Scripts\python.exe -
```

4. Substitute the printed hash in this SQL. The hash is not the application credential:

```sql
insert into reliefops_private.server_credential(singleton, key_hash)
values (true, 'PASTE_SHA256_HASH_HERE')
on conflict (singleton) do update set key_hash = excluded.key_hash;
```

5. Deploy [finance-gateway](../supabase/functions/finance-gateway/index.ts). [supabase/config.toml](../supabase/config.toml) disables platform JWT verification for this function because the separate scoped server credential is verified in the database. Do not remove the credential check or expose its value to browsers. Do not enable request-body logging.

With an authenticated Supabase CLI, first inspect your installed command's flags, then deploy to the intended project:

```powershell
supabase functions deploy --help
supabase functions deploy finance-gateway --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

The function requires the platform-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; do not copy either service-role value into frontend configuration. See the official [function deployment guide](https://supabase.com/docs/guides/functions/deploy) and [CLI reference](https://supabase.com/docs/reference/cli/supabase-functions-deploy) if your installed CLI differs.

For self-service account deletion, apply [account.sql](account.sql) after the finance schema and redeploy the updated finance gateway. This adds the service-only deletion function. It checks the confirmed email and active account session and uses the same operation locks as payment writes. Existing account records are affected only when an authenticated user explicitly confirms deletion.

Apply [project_deletion.sql](project_deletion.sql) after the finance schema to enable deleting individual projects from **Profile → Data**. The owner policy scopes deletes, and a database trigger protects pending PayPal transactions.

6. Restart the app backend. Sign in, save an operation and open Purchases. Its initially empty financial state should load without a gateway error. Generate/review/approve a plan and reload to verify persistence.

The root `.env` must remain Git-ignored. When rotating the scoped key, update the backend secret and private database hash together; expect financial commands to fail safely during a mismatch. Never print the key or put it into SQL migration files.

## Commitments and recovery

Opening allocations become authoritative when financial state is initialized. Available funding is derived from opening amounts minus reserved and spent commitments. Draft input edits cannot replenish it. Explicit opening-allocation adjustments require a reason and cannot lower a pool below commitments.

Unsubmitted cancellations release their reservation once. Paid, pending and unknown transactions remain protected; refunds release spent allocations only after full-refund confirmation. Replanning subtracts committed quantities and supplier stock so it does not duplicate existing purchases.

The app's recovery thread runs while the single service is awake, querying at most ten pending intents per pass with a 60-second interval. It starts with the app and can be disabled with `RECOVERY_WORKER=false`. Sleep or downtime delays recovery; persisted state survives. Provider calls are outside transactions and use stable supported request IDs. Unknown capture/refund results are looked up before further action; no database state change can establish a real payment without matching provider evidence.

Source text and extraction metadata live inside the owner-scoped financial state for this bounded demo. The public purchase/audit export omits raw source text. Keep original documents separately for restoration. The current export is a review artifact, not a one-click financial restore tool; restoring commitments blindly could duplicate external transactions.

## Verify the boundaries

`backend/tests/test_procurement.py` uses real disposable PostgreSQL when `TEST_DATABASE_URL` is set to a loopback connection. Its fixture creates a uniquely named test database, applies both SQL files and removes that test database afterward. Use a disposable local administrator connection, never a hosted database URL. See the root [verification commands](../README.md#verification).

Coverage includes competing reservations, stale versions, restricted funding, cancellation, commitment-aware replanning, provider timeouts, immutable recipient/amount checks, document grounding and human confirmation. Provider responses in the repeatable suite are controlled fixtures; they do not replace live buyer approval, capture/refund or webhook checks.

For a hosted review, confirm RLS on all three public tables, inspect grants/policies and run the Supabase security advisor. Then test user A/user B isolation, direct financial writes denied, direct anonymous/authenticated RPC execution denied, and the scoped gateway rejecting an invalid key. Existing hosted checks confirmed owner isolation/revision behavior and installed financial state; real-account payment/OAuth verification remains separately documented in the root README.

The security advisor has reported disabled leaked-password protection. Review [password protection settings](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) and actual account eligibility; no claim is made that every managed-account warning is resolved.

## Roll back without losing commitments

1. Stop the recovery worker and prevent new approval/payment actions before changing application versions.
2. Export the operation/audit and securely back up relevant database records and original evidence. Record provider order/capture/refund IDs.
3. Roll back the UI/API only to a version that cannot issue money actions against incompatible state. Keep the database tables and gateway in place. The account-free sample planner can remain available.
4. Reconcile any submitted or uncertain PayPal transactions with the provider. A stopped app or disabled gateway does not cancel a provider payment or release its commitment.

Do **not** drop `operation_finance`, operations, snapshots, credential or usage tables as an automatic rollback. Never discard rows with paid/pending/unknown commitments. Destructive removal requires an explicit data-retention decision after verified reconciliation. The migration is additive; retaining it is the preservation-safe rollback path.

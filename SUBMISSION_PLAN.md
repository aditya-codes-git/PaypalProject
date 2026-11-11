# ReliefOps delivery plan

## Finish the hackathon release today

| Order | Work | Done when |
| --- | --- | --- |
| 1 | Start every new operation blank. Guide the user through households, supplies, supplier offers, and funding. | A clean browser shows blank inputs. A guest can enter a budget and calculate a plan. A signed-in user can save before uploading a grant. Existing operations still open. |
| 2 | Verify the release and publish it from `main`. | Backend and browser checks pass. Render deploys the checked commit. The public site produces a plan using only data entered during the check. |
| 3 | Prove the hosted workflow with dedicated test accounts. | A coordinator saves an operation, confirms an AI grant proposal against its source, approves a plan, and uses a separate PayPal sandbox buyer to complete the payment. Purchases shows Paid and the ledger moves the amount from reserved to spent. |
| 4 | Prepare and submit the entry. | A clean browser can access the demo. The public repository has setup instructions and its license. The Devpost entry explains the two integrations and links to a public YouTube demo under three minutes. |

Use the [README walkthrough](README.md#run-the-submission-demo) and [submission kit](SUBMISSION_KIT.md) for the recording. If time is tight, prioritize the signed-in grant-to-payment walkthrough and judge access. Show refund and signed webhook delivery only after verifying them separately.

## Build toward the full product after submission

1. **Run an operation as a team.** Model membership and roles independently of a person's account. Coordinators edit plans, approvers authorize reservations, finance staff manage payments, and field staff record receipts. Enforce each permission in the backend and database. Require tests for direct API access, revoked members, cross-organization isolation, and a coordinator attempting to approve their own plan before enabling team access.
2. **Track purchases through delivery.** Owner-recorded supplier confirmations, invoice references, and receipts are available. Next, give invited suppliers a scoped way to confirm their own orders, attach invoices, and report shipment status. Retain receipt history and test partial, duplicate, and out-of-order deliveries.
3. **Report outcomes to funders.** The owner can inspect and export grant balances, purchase allocations, source page references, and delivery locations. Add funder access using an explicit report projection and revocable permissions. Separate delivered supplies from household reach until field teams can verify distribution.
4. **Coordinate across organizations.** Pilot opt-in sharing of supply counts and geographic coverage with participating organizations. Design the shared view around quantities and service areas. Validate that organizations can withdraw access, identify overlapping coverage, and spot gaps without exposing grant documents, payment records, or household identities.

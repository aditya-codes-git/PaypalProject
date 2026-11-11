# ReliefOps delivery plan

## Finish the hackathon release today

| Order | Work | Done when |
| --- | --- | --- |
| 1 | Start every new operation blank. Guide the user through households, supplies, supplier offers, and funding. | A clean browser shows blank inputs. A guest can enter a budget and calculate a plan. A signed-in user can save before uploading a grant. Existing operations still open. |
| 2 | Verify the release and publish it from `main`. | Backend and browser checks pass. Render deploys the checked commit. The public site produces a plan using only data entered during the check. |
| 3 | Prove the hosted workflow with dedicated test accounts. | A coordinator saves an operation, confirms an AI grant proposal against its source, approves a plan, and uses a separate PayPal sandbox buyer to complete the payment. Purchases shows Paid and the ledger moves the amount from reserved to spent. |
| 4 | Prepare and submit the entry. | A clean browser can access the demo. The public repository has setup instructions and its license. The Devpost entry explains the two integrations and links to a public YouTube demo under three minutes. |

Use the [README walkthrough](README.md#run-the-submission-demo) for the recording. If time is tight, prioritize the signed-in grant-to-payment walkthrough and judge access. Show refund and signed webhook delivery only after verifying them separately.

## Build toward the full product after submission

1. **Run an operation as a team.** Add separate coordinator, approver, finance, and field roles. Prove that approvals, edits, and audit history work across shifts.
2. **Track purchases through delivery.** Connect supplier acceptance, invoices, shipment updates, and field receipts to the existing purchase records. Replan when promised or received quantities change.
3. **Report outcomes to funders.** Show how much of each grant remains, what was purchased, and which locations received supplies. Keep the source clause and approval trail available for review.
4. **Coordinate across organizations.** Pilot optional sharing of supply and coverage information with participating organizations. Validate that teams can identify duplicated deliveries and unmet needs while each organization controls access to its records.

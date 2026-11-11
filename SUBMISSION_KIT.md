# ReliefOps submission kit

## Devpost description

**Pitch:** ReliefOps helps a relief coordinator decide what to buy with restricted funds, approve the plan, and account for what arrives.

When a supplier cannot deliver, a coordinator has to find a replacement, check which grant can pay for it, and avoid buying supplies already ordered. ReliefOps puts the decision in one workspace. Enter household needs and supplier quotes. Upload a grant document and review the exact text behind Groq's proposed spending rules. The planner uses the confirmed rules, stock, and delivery window to select purchases. The coordinator approves the plan before money is reserved or a PayPal Sandbox checkout begins.

PayPal Sandbox handles checkout and capture. ReliefOps tracks reserved and spent amounts separately and records supplier references and delivery receipts. A closed short delivery makes missing units eligible for a new plan. The funding report links each grant's balance to purchase allocations and records where supplies arrived.

**Tools:** Groq for structured grant extraction, OR-Tools for purchasing decisions, PayPal Sandbox for payment, Supabase for sign-in and owner-scoped records, AG Grid for supplier comparison, and Render for hosting.

- [Interactive demo](https://reliefops-aditya-2026.onrender.com/)
- [Public repository and setup instructions](https://github.com/aditya-codes-git/PaypalProject)
- [Official submission and testing rules](https://paypalaihackathon.devpost.com/rules)

## Recording cues

| Time | Show |
| --- | --- |
| 0:00–0:20 | Start with a blank operation. Explain who needs supplies and what makes the grant restriction matter. |
| 0:20–0:55 | Enter the two offers from the README. Upload the fictional grant, show its exact quote, and confirm the rule. |
| 0:55–1:25 | Show the $80 plan for 10 households. Exclude Riverbend and show the $90 replacement. |
| 1:25–2:05 | Approve the purchase, complete PayPal Sandbox checkout with a separate buyer, and show Paid and the spent balance. |
| 2:05–2:35 | Record a fictional receipt after payment. Show the grant source, spending, and delivery location in Reports. |
| 2:35–2:45 | Show the public URL and repository. |

Use only outcomes you can reproduce on the hosted release. Hide test credentials and private identifiers in the recording. Publish the finished video publicly on YouTube and add the URL to Devpost.

## Judge access

Use a clean browser. **Start without signing in** gives immediate access to blank planning. For the full hosted flow, provide a dedicated test account and a separate Sandbox buyer through the event's testing instructions. Keep private provider credentials out of the repository, recording, and public description. Test both access paths before submission.

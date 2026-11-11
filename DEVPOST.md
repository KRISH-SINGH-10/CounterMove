# Countermove: Devpost submission text

Copy each section into the matching field on Devpost. Lines marked **[fill in]** need a fact only the team has.

## Project name

Countermove

## Tagline

Stop scammers before you ship. Settle the rest without a fight.

## Inspiration

A small seller gets a PayPal dispute and has days to answer. Most refund out of fear, or send a rushed reply that leaves out the evidence that would have won. The reseller who ships a $236 pair of deadstock sneakers to a package forwarder never had a chance: the dispute was lost before it was opened.

We wanted an agent that works across the whole life of a dispute: stop the bad order before it ships, answer the dispute with evidence when one arrives, and afterwards fix whatever caused it.

**[fill in: one or two sentences from a real seller you spoke to, with their permission.]**

## What it does

**Before a dispute**
- Checks every paid PayPal order for dispute risk before it ships, and offers one action: refund it through PayPal, require a signature, or ship to the PayPal address only.
- Warns about buyers that other shops have already proven wrong. Shops share only a salted hash of the buyer's email, the claim type and what the evidence showed.
- Gives buyers a "fix it first" page. Tracking questions are answered at once from the shop's shipping records; refund and replacement requests go to the seller instead of to PayPal.

**During a dispute**
- When PayPal's dispute webhook arrives, a Gemini agent investigates through the PayPal Agent Toolkit: the dispute, the order, the shipment tracker and the buyer's transaction history, plus the shop's own records.
- It recommends fight, partial refund or refund, with each fact traced to its source and the expected money kept for each option.
- The seller approves in one click, or autopilot acts inside limits the seller sets.
- For partial refunds, an AI negotiator haggles in the PayPal dispute conversation inside a ceiling the buyer never sees.
- If a PayPal call fails, the agent reads PayPal's error and recovers: it retries outages, refreshes an expired token, and explains a business refusal.

**After a dispute**
- **Dispute Reserve** forecasts the money at risk over the next 30 days.
- **Dispute Doctor** finds the repeated causes behind refunds and proposes one fix for each.
- **PayPal API trail** lists every PayPal call the agent, autopilot, the seller and the server made, with PayPal's status and debug id.

- **Photo forensics:** Gemini compares the listing photo, the shop's packing photo and the buyer's photo, and reports damage in transit, not as described, or a different item, checking each part of the buyer's claim.

**Judge mode** plays the whole story in the Simulator in under a minute.

The demo shop is **Laceline Resale**, a two-person sneaker resale shop: high-value pairs, package forwarders and "never arrived" claims make resale one of the hardest places to sell with PayPal. Every brand and model name in the demo is made up.

## How we built it

- **PayPal:** the Agent Toolkit for the agent's read tools; the Disputes API for evidence, offers, messages and accepting claims; the Orders API for tracking; the Payments API for refunding a capture before shipping; webhooks with signature verification for new disputes and for completed payments, which start the pre-ship check. `scripts/verify-live.mjs` checks each API against the real sandbox.
- **AI:** Google Gemini in a function-calling loop. The model only reads and recommends. Every PayPal write is made by server code, after a person approves or inside autopilot rules checked in code after the model answers.
- **AG Grid:** a 1,000,000-row scale check on the server-side row model, and more grids on one custom theme, plus AG Charts and AG Studio. "Ask the grid" turns a plain-English question into AG Grid filters, sort and row grouping through Gemini, validated in code against the grid's real columns.
- **App:** Next.js and TypeScript on Render, with 143 automated tests.
- **Simulator:** returns the same JSON as the PayPal sandbox, so the same code, pages and agent run in both. Judges can try every action with no PayPal login, and one toggle switches to the real sandbox.

## Built with AG Grid

| Feature | What it does in Countermove | Where |
|---|---|---|
| Server-side row model | 1,000,000 disputes sorted, filtered and grouped on the server (Postgres), one block at a time, with the time per block shown | Insights → Scale check (Enterprise) |
| Ask the grid | Plain English ("unauthorized claims over $100") becomes filters, sort and row grouping, set by Gemini and checked against the grid's real columns | Disputes, Insights → Outcomes ledger |
| Integrated and cross-filter charts | Chart any cell range from the right-click menu; "Chart in grid" draws kept vs refunded by claim type, and a bar click filters the ledger | Insights → Outcomes ledger (Enterprise) |
| Row grouping and pivoting | Ledger grouped by claim type with totals, a group-by bar, pivot mode and the Columns and Filters tool panels | Insights → Outcomes ledger (Enterprise) |
| Master/detail | Each dispute expands into the evidence the agent weighed (its own grid) beside the dispute's timeline | Insights → Outcomes ledger (Enterprise) |
| Live delta updates | `getRowId` with cell flash: the trust network, pre-ship orders and buyer requests update and flash as orders and reports arrive | Protect |
| Full-width detail rows | The agent's reasoning under a dispute, and the pre-ship verdict with one-click actions under an order | Disputes, Protect |
| Inline editing with validation | Autopilot rules edited in the grid, each cell checked against the others | Autopilot rules drawer |
| Theming API | One custom `themeQuartz` theme from the app's CSS variables, so every grid follows light and dark mode | Every grid |
| AG Studio | Ask AI builds a dashboard of charts, KPIs and grids from a question, with Gemini driving AG Studio's agents | Ask AI |
| Excel and CSV export | The outcomes ledger to Excel (Enterprise) or CSV with plain-number amounts | Insights |
| Also | Row selection for bulk approve, pinned totals rows, quick filter, saved column layout, pagination, a 100,000-row client-side check | Disputes, Insights |

Without `AG_GRID_LICENSE_KEY` every grid runs on AG Grid Community with no watermark, and without `AG_STUDIO_LICENSE_KEY` the Ask AI page explains how to switch it on instead of loading AG Studio, so the browser console stays clean.

## Challenges we ran into

- The PayPal sandbox opened every buyer dispute as a chargeback, where offers are not allowed, so the negotiator could only be exercised end to end in the Simulator.
- Our sandbox seller had no USD balance, so PayPal refused refunds with `INSUFFICIENT_FUNDS`. That refusal became the test case for self-healing.
- The free Gemini tier allows only a few requests a minute. Finished investigations are saved and replayed, so the hosted demo keeps working with no quota left.
- Getting Gemini to drive AG Studio's tools needed three fixes: thought signatures, recursive schemas, and repairing flattened one-of arguments.

## Accomplishments that we're proud of

- A sandbox dispute answered end to end with real PayPal calls: evidence accepted, and a $184 "not received" claim ruled for the seller.
- The model never moves money. Every limit is enforced in code, and tests cover each one.
- A demo that any judge can drive alone, each in a private Simulator.

## What we learned

- Most of the value is before and after the dispute, not in the reply itself.
- An agent that handles money needs limits that live in code, where the model cannot talk its way past them.

## What's next

- Mark orders shipped from the seller's fulfilment system, so the pre-ship check list empties itself.
- A shared scammer network across real shops, with the same hash-only privacy.

## Every PayPal API we use

| PayPal API | Calls | What Countermove does with it | Verified live in the sandbox |
|---|---|---|---|
| OAuth 2.0 | `POST /v1/oauth2/token` | Signs in before every call | Yes (200) |
| Disputes API | list, read, `provide-evidence`, `provide-supporting-info`, `make-offer`, `send-message`, `accept-claim`, `adjudicate` (sandbox) | The inbox, the agent's investigation, every answer, the negotiator, and PayPal's ruling in demos | Reads: yes (200, 200), 11 Nov. Evidence and ruling: yes, on a real sandbox dispute ($184 claim ruled for the seller). Offers: not possible, because the sandbox opened every dispute as a chargeback |
| Orders API v2 | create, read, `/track` | The agent reads each order; the pre-ship check reads every paid order; tracking is added before a fight | Create and read: yes (201, 200) |
| Payments API v2 | `POST /v2/payments/captures/{id}/refund` | Refunds a risky order before it ships | Simulator only (needs a buyer-paid sandbox order) |
| Shipment Tracking | read and add trackers | The agent checks delivery; tracking is added to the transaction | No: 403, the sandbox app lacks the tracking permission |
| Transaction Search | `GET /v1/reporting/transactions` | The agent checks the buyer's history with the shop | No: 403, the sandbox app lacks Transaction Search |
| Webhooks | `CUSTOMER.DISPUTE.*`, `PAYMENT.CAPTURE.COMPLETED`, `verify-webhook-signature`, register and list webhooks | Starts autopilot on a new dispute and the pre-ship check on a paid order | Signature check and listing: yes (200) |
| PayPal Agent Toolkit | `get_dispute`, `get_order`, `get_shipment_tracking`, `list_transactions`, `list_disputes`, `accept_dispute_claim`, `create_shipment_tracking` | The model's read tools, passed to Gemini with PayPal's own schemas | Yes, through the reads above |

`node --env-file=.env.local scripts/verify-live.mjs` repeats the live check and prints PayPal's status and debug id for each call. Everything runs against `api-m.sandbox.paypal.com`; nothing calls live PayPal.

## Honest limits of this demo

- The other shops in the scammer network are simulated and labelled as such.
- The photo forensics images are illustrations made for the demo, labelled as such.
- Shipment tracking and Transaction Search return 403 for our sandbox app until those permissions are turned on, so on live sandbox disputes the agent works without those two lookups.
- The buyer "fix it first" page runs as a preview in the seller's browser.
- On the hosted demo the live PayPal sandbox is view-only, because every visitor shares one sandbox account. The video shows live calls.

## Links

- Live demo: https://rebuttal-6j9a.onrender.com
- Code: https://github.com/KRISH-SINGH-10/Rebuttal
- Video: **[fill in the final YouTube link]**

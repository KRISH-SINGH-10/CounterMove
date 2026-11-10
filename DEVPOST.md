# Countermove: Devpost submission text

Copy each section into the matching field on Devpost. Lines marked **[fill in]** need a fact only the team has.

## Project name

Countermove

## Tagline

Stop scammers before you ship. Settle the rest without a fight.

## Inspiration

A small seller gets a PayPal dispute and has days to answer. Most refund out of fear, or send a rushed reply that leaves out the evidence that would have won. The seller who ships a $236 bag to a package forwarder never had a chance: the dispute was lost before it was opened.

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

**Judge mode** plays the whole story in the Simulator in under a minute.

## How we built it

- **PayPal:** the Agent Toolkit for the agent's read tools; the Disputes API for evidence, offers, messages and accepting claims; the Orders API for tracking; the Payments API for refunding a capture before shipping; webhooks with signature verification to start autopilot.
- **AI:** Google Gemini in a function-calling loop. The model only reads and recommends. Every PayPal write is made by server code, after a person approves or inside autopilot rules checked in code after the model answers.
- **AG Grid:** nine grids on one custom theme, plus AG Charts and AG Studio. "Ask the grid" turns a plain-English question into AG Grid filters, sort and row grouping through Gemini, validated in code against the grid's real columns.
- **App:** Next.js and TypeScript on Render, with 130 automated tests.
- **Simulator:** returns the same JSON as the PayPal sandbox, so the same code, pages and agent run in both. Judges can try every action with no PayPal login, and one toggle switches to the real sandbox.

## Built with AG Grid

- **Ask the grid:** type "unauthorized claims over $100" and Gemini sets the Disputes grid's filters and sort; "refunds by claim type" groups the Outcomes ledger. Saved answers replay with no AI quota.
- **Live grids for the core story:** the dispute queue, the pre-ship check with action buttons in a full-width detail row, the scammer network, buyer requests, the PayPal API trail, Dispute Reserve and Dispute Doctor.
- **Enterprise features on the Outcomes ledger:** row grouping with totals, pivoting, set filters, master-detail, cell selection with a status bar, integrated and cross-filter charts, and Excel export.
- **AG Studio:** the Ask AI page builds a dashboard from a question, with Gemini driving AG Studio's agent framework.
- **Also:** inline editing with validation for the autopilot rules, pinned totals rows, saved column layout, CSV export, and a 100,000-row scale check with timings.

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

- Run the pre-ship check on live orders from PayPal's `PAYMENT.CAPTURE.COMPLETED` webhook.
- Photo evidence: compare the buyer's photo with the listing and the packing photo.
- A shared scammer network across real shops, with the same hash-only privacy.

## Honest limits of this demo

- The other shops in the scammer network are simulated and labelled as such.
- The buyer "fix it first" page runs as a preview in the seller's browser.
- On the hosted demo the live PayPal sandbox is view-only, because every visitor shares one sandbox account. The video shows live calls.

## Links

- Live demo: https://rebuttal-6j9a.onrender.com
- Code: https://github.com/KRISH-SINGH-10/Rebuttal
- Video: **[fill in the final YouTube link]**

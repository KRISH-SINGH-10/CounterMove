// "After the dispute": two plain calculations over the shop's own dispute history.
// - Dispute Reserve: how much money is likely to leave in the next 30 days.
// - Dispute Doctor: why disputes keep happening, and the fix for each cause.
// Both are arithmetic and fixed rules over the cases, with no model call, so they are the
// same every time and work with no AI quota. Pure functions: the Insights page runs them
// in the browser on the cases it already has.

import type { AutopilotRules, CaseRecord, DisputeReason } from "./types";

const DAY = 86_400_000;
const amountOf = (c: CaseRecord) => Number(c.dispute.dispute_amount.value) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- Dispute Reserve ----------------------------------------------------------------

export type ReserveRow = { id: string; buyer: string; reason: DisputeReason; amount: number; loss_share: number; expected_loss: number; basis: string };
export type Reserve = {
  // Open disputes, each with the money the shop should expect to lose on it.
  open: ReserveRow[];
  open_expected: number;
  // New disputes expected in the next 30 days, from the last 90 days' pace.
  new_count: number;
  new_expected: number;
  // The shop's own share of disputed money that ended up refunded.
  loss_share: number;
  reserve: number;
};

// Share of disputed money the shop lost on closed disputes, overall and per claim type.
function lossShares(closed: CaseRecord[]) {
  const by = new Map<DisputeReason, { total: number; lost: number }>();
  let total = 0;
  let lost = 0;
  for (const c of closed) {
    const a = amountOf(c);
    const l = Math.min(a, c.outcome?.amount_lost ?? 0);
    total += a;
    lost += l;
    const cur = by.get(c.dispute.reason) ?? { total: 0, lost: 0 };
    by.set(c.dispute.reason, { total: cur.total + a, lost: cur.lost + l });
  }
  const overall = total ? lost / total : 0.5;
  return { overall, of: (r: DisputeReason) => { const x = by.get(r); return x && x.total ? x.lost / x.total : overall; } };
}

export function forecastReserve(cases: CaseRecord[], now = Date.now()): Reserve {
  const closed = cases.filter((c) => c.outcome);
  const shares = lossShares(closed);
  const open: ReserveRow[] = cases
    .filter((c) => !c.outcome)
    .map((c) => {
      const amount = amountOf(c);
      const sent = c.submitted?.decision;
      const r = c.recommendation;
      let share: number;
      let basis: string;
      if (sent === "REFUND") [share, basis] = [1, "Refund sent"];
      else if (sent === "OFFER") [share, basis] = [Math.min(1, (c.submitted?.offer_amount ?? 0) / (amount || 1)), "Offer sent"];
      else if (r?.decision === "REFUND") [share, basis] = [1, "AI recommends a refund"];
      else if (r?.decision === "OFFER") [share, basis] = [Math.min(1, r.offer_amount / (amount || 1)), "AI recommends a partial refund"];
      else if (r) [share, basis] = [1 - r.win_probability, `AI win estimate ${Math.round(r.win_probability * 100)}%`];
      else [share, basis] = [shares.of(c.dispute.reason), "Your past results for this claim type"];
      return { id: c.id, buyer: c.dispute.disputed_transactions[0]?.buyer?.name ?? "Unknown buyer", reason: c.dispute.reason, amount, loss_share: round2(share), expected_loss: round2(amount * share), basis };
    })
    .sort((a, b) => b.expected_loss - a.expected_loss);

  const recent = cases.filter((c) => now - Date.parse(c.dispute.create_time) <= 90 * DAY);
  const newCount = Math.round((recent.length / 3) * 10) / 10;
  const avg = recent.length ? recent.reduce((s, c) => s + amountOf(c), 0) / recent.length : 0;
  const newExpected = round2(newCount * avg * shares.overall);
  const openExpected = round2(open.reduce((s, r) => s + r.expected_loss, 0));
  return { open, open_expected: openExpected, new_count: newCount, new_expected: newExpected, loss_share: round2(shares.overall), reserve: round2(openExpected + newExpected) };
}

// ---- Dispute Doctor -----------------------------------------------------------------

export type DoctorFix =
  // Text the seller pastes into a listing or a shipping policy.
  | { kind: "copy"; label: string; text: string }
  // A change to the autopilot rules, applied through POST /api/rules.
  | { kind: "rule"; label: string; patch: Partial<AutopilotRules> };

export type Finding = {
  id: string;
  cause: string;
  evidence: string;
  disputes: number;
  // Money refunded because of this cause.
  lost: number;
  fix: string;
  action: DoctorFix;
};

const lostOf = (c: CaseRecord) => c.outcome?.amount_lost ?? 0;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;

export function diagnose(cases: CaseRecord[], rules?: AutopilotRules | null): Finding[] {
  const closed = cases.filter((c) => c.outcome);
  const out: Finding[] = [];
  const reason = (r: DisputeReason) => closed.filter((c) => c.dispute.reason === r);

  // 1. "Never arrived" claims that cost money: delivery wasn't provable.
  const notReceived = reason("MERCHANDISE_OR_SERVICE_NOT_RECEIVED").filter((c) => lostOf(c) > 0);
  if (notReceived.length >= 2) {
    const amounts = notReceived.map(amountOf).sort((a, b) => a - b);
    // A signature costs a few dollars, so the rule starts at the median lost order.
    const threshold = Math.max(25, Math.floor(amounts[Math.floor(amounts.length / 2)] / 5) * 5);
    out.push({
      id: "signature",
      cause: "“Never arrived” claims you couldn't disprove",
      evidence: `${plural(notReceived.length, "not-received dispute")} ended in a refund. PayPal sides with the buyer when tracking has no signature.`,
      disputes: notReceived.length,
      lost: round2(notReceived.reduce((s, c) => s + lostOf(c), 0)),
      fix: `Require signature confirmation on every order of ${usd(threshold)} or more.`,
      action: { kind: "copy", label: "Copy shipping rule", text: `Shipping rule: every order of ${usd(threshold)} or more ships tracked with signature confirmation, to the address on the PayPal transaction only.` },
    });
  }

  // 2. "Not as described": the same item keeps surprising buyers.
  const nad = reason("MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED");
  const byItem = new Map<string, CaseRecord[]>();
  for (const c of nad) {
    const item = c.dispute.disputed_transactions[0]?.items?.[0]?.item_description?.trim();
    if (item) byItem.set(item, [...(byItem.get(item) ?? []), c]);
  }
  const worst = [...byItem.entries()].sort((a, b) => b[1].length - a[1].length || b[1].reduce((s, c) => s + lostOf(c), 0) - a[1].reduce((s, c) => s + lostOf(c), 0))[0];
  if (nad.length >= 2) {
    const [item, hits] = worst && worst[1].length >= 2 ? worst : [null, nad];
    out.push({
      id: "listing",
      cause: item ? `The listing for “${item}” sets the wrong expectation` : "Listings set the wrong expectation",
      evidence: `${plural(hits.length, "not-as-described dispute")}${item ? " on this one item" : " across your listings"}; ${usd(round2(hits.reduce((s, c) => s + lostOf(c), 0)))} refunded.`,
      disputes: hits.length,
      lost: round2(hits.reduce((s, c) => s + lostOf(c), 0)),
      fix: `Say in the listing${item ? "" : "s"} what varies and show it in a photo, so buyers know before they pay.`,
      action: { kind: "copy", label: "Copy listing text", text: "Colour in daylight: off-white and pastel colourways read warmer outdoors than in these studio photos; photo 3 shows the pair in daylight. Pre-owned pairs: every mark is photographed, and anything not shown is a defect we fix." },
    });
  }

  // 3. Small refunds a person still had to handle: just above the auto-refund limit.
  if (rules) {
    const limit = rules.auto_refund_max;
    const manual = closed.filter((c) => c.outcome?.result === "REFUNDED" && c.submitted?.by !== "autopilot" && amountOf(c) > limit && amountOf(c) <= Math.max(limit * 2, limit + 30));
    if (manual.length >= 2) {
      const next = Math.min(rules.max_auto_amount, Math.ceil(Math.max(...manual.map(amountOf)) / 5) * 5);
      if (next > limit) {
        out.push({
          id: "auto-refund",
          cause: "Small refunds still wait for you",
          evidence: `${plural(manual.length, "refund")} between ${usd(limit)} and ${usd(next)} were approved by hand, about 45 minutes of work each.`,
          disputes: manual.length,
          lost: round2(manual.reduce((s, c) => s + lostOf(c), 0)),
          fix: `Let autopilot refund up to ${usd(next)} on its own when the AI recommends a refund.`,
          action: { kind: "rule", label: `Raise auto-refund to ${usd(next)}`, patch: { auto_refund_max: next } },
        });
      }
    }
  }

  // 4. Unauthorized-payment claims that were lost.
  const unauth = reason("UNAUTHORISED").filter((c) => lostOf(c) > 0);
  if (unauth.length >= 2) {
    out.push({
      id: "unauthorized",
      cause: "Orders shipped to addresses PayPal doesn't cover",
      evidence: `${plural(unauth.length, "unauthorized-payment dispute")} ended in a refund. Seller Protection only covers the address on the PayPal transaction.`,
      disputes: unauth.length,
      lost: round2(unauth.reduce((s, c) => s + lostOf(c), 0)),
      fix: "Ship only to the address on the PayPal transaction, and check new high-value orders on Protect before shipping.",
      action: { kind: "copy", label: "Copy shipping rule", text: "Shipping rule: orders ship only to the address on the PayPal transaction. Requests to change the address after payment are refunded and re-ordered." },
    });
  }

  // 5. Refunds promised but late, or charged twice: a policy and checkout problem.
  const slow = [...reason("CREDIT_NOT_PROCESSED"), ...reason("DUPLICATE_TRANSACTION")];
  if (slow.length >= 2) {
    out.push({
      id: "refund-policy",
      cause: "Refunds and double charges handled too slowly",
      evidence: `${plural(slow.length, "dispute")} for a refund that didn't arrive or a duplicate charge. These are almost never won.`,
      disputes: slow.length,
      lost: round2(slow.reduce((s, c) => s + lostOf(c), 0)),
      fix: "Refund through PayPal within 24 hours of agreeing to it, and tell the buyer the day it was sent.",
      action: { kind: "copy", label: "Copy refund policy", text: "Refund policy: approved refunds are sent through PayPal within 24 hours. You'll get a message the same day with the amount and the PayPal transaction it went to." },
    });
  }

  return out.sort((a, b) => b.lost - a.lost);
}

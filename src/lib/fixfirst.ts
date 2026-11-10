// "Fix it first": a page the shop links from its order emails, where a buyer with a
// problem gets an answer before opening a PayPal dispute. "Where is my order?" is
// answered at once from the shop's own shipping records; a problem or a cancellation
// becomes a request the seller sees on Protect and answers in one click.
//
// Requests are kept in memory per tenant, like the simulator's other state. In the demo
// the buyer page runs in the seller's own browser (a preview), so it reads the same
// simulated shop.

import { pendingOrderByKey } from "./demo/orders";
import { scenarioByKey } from "./demo/scenarios";
import { lruGet, tenant } from "./visitor";

export type FixKind = "WHERE" | "PROBLEM" | "CANCEL";
export type FixWants = "REFUND" | "REPLACEMENT";

export type BuyerOrder = {
  invoice_id: string;
  item: string;
  amount: string;
  buyer_first_name: string;
  state: "PAID_NOT_SHIPPED" | "SHIPPED" | "DELIVERED";
  carrier: string | null;
  tracking_number: string | null;
  // The carrier's latest scan, when the parcel is tracked.
  last_event: { at: string; status: string; location: string } | null;
  signed_by: string | null;
  shipped_at: string | null;
  service: string | null;
  returns_policy: string;
  // True when the order can still be refunded before it ships (a paid order on Protect).
  refundable_before_shipping: boolean;
};

export type FixRequest = {
  id: string;
  invoice_id: string;
  buyer: string;
  item: string;
  amount: string;
  kind: FixKind;
  wants: FixWants | null;
  note: string;
  at: string;
  status: "OPEN" | "ANSWERED";
  // What the buyer was told, at once or by the seller.
  answer: string | null;
  answered_at: string | null;
  answered_by: "auto" | "seller" | null;
};

export class FixError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
  }
}

const MAX_REQUESTS = 200;
const g = globalThis as unknown as { __rebuttalFix?: Map<string, FixRequest[]> };
const store = (): FixRequest[] => lruGet<FixRequest[]>((g.__rebuttalFix ??= new Map()), tenant(), () => [], 500);

const SHOP_RETURNS = "Returns accepted within 30 days for unused items. The shop pays return shipping when an item arrives damaged or not as described.";

// The order as the buyer may see it: no email, no address, first name only.
export function orderForBuyer(invoiceId: string): BuyerOrder | null {
  const key = invoiceId.trim().toUpperCase();
  const pending = pendingOrderByKey(key);
  if (pending) {
    return {
      invoice_id: pending.key,
      item: pending.item.name,
      amount: pending.amount,
      buyer_first_name: pending.buyer.name.split(" ")[0],
      state: "PAID_NOT_SHIPPED",
      carrier: null,
      tracking_number: null,
      last_event: null,
      signed_by: null,
      shipped_at: null,
      service: pending.shipping.label,
      returns_policy: SHOP_RETURNS,
      refundable_before_shipping: true,
    };
  }
  const s = scenarioByKey(key);
  if (!s) return null;
  const f = s.store.fulfillment;
  // The page opens with just an order number, so a scan's street address is cut down to
  // the town: "418 Alder St, Denver, CO 80203" becomes "Denver, CO".
  const town = (loc: string) => loc.replace(/^[^,]*\d[^,]*,\s*/, "").replace(/\s+\d{5}(-\d{4})?$/, "");
  const scan = f.carrier_events.at(-1);
  const last = scan ? { ...scan, location: town(scan.location), status: scan.status.replace(/\s+at\s+\d[^,;]*/i, "") } : null;
  const delivered = s.tracker_status === "DELIVERED" || Boolean(f.signed_by) || /deliver/i.test(last?.status ?? "");
  return {
    invoice_id: s.key,
    item: s.item.name,
    amount: s.amount,
    buyer_first_name: s.buyer.name.split(" ")[0],
    state: delivered ? "DELIVERED" : f.shipped_at ? "SHIPPED" : "PAID_NOT_SHIPPED",
    carrier: f.carrier,
    tracking_number: f.tracking_number,
    last_event: last,
    signed_by: f.signed_by,
    shipped_at: f.shipped_at,
    service: f.service,
    returns_policy: s.store.policies.returns,
    refundable_before_shipping: false,
  };
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// The answer to "Where is my order?", from the shop's shipping records.
export function whereAnswer(o: BuyerOrder): string {
  if (o.state === "PAID_NOT_SHIPPED") return `Your order is paid and being packed. It ships within 2 business days by ${o.service ?? "tracked post"}, and you'll get the tracking number by email.`;
  const track = o.tracking_number ? `${o.carrier} tracking ${o.tracking_number}` : `${o.service ?? o.carrier ?? "post"}, which has no tracking`;
  if (o.state === "DELIVERED") {
    const when = o.last_event ? ` on ${day(o.last_event.at)}` : "";
    return `The carrier shows it delivered${when}${o.last_event?.location ? ` (${o.last_event.location})` : ""}${o.signed_by ? `, signed for by ${o.signed_by}` : ""}. ${track}. If you can't find it, tell us below and we'll sort it out.`;
  }
  const scan = o.last_event ? ` Latest scan: ${o.last_event.status}, ${o.last_event.location}, ${day(o.last_event.at)}.` : "";
  return `It shipped${o.shipped_at ? ` on ${day(o.shipped_at)}` : ""} by ${track}.${scan}${o.tracking_number ? "" : " Untracked post can take up to 3 weeks; if it hasn't come by then, tell us below and we'll refund or resend it."}`;
}

export function submitFix(invoiceId: string, input: { kind: FixKind; wants?: FixWants | null; note?: string }): FixRequest {
  const o = orderForBuyer(invoiceId);
  if (!o) throw new FixError("We couldn't find that order. Check the order number in your confirmation email.", 404);
  const all = store();
  const note = (input.note ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (input.kind !== "WHERE") {
    if (all.some((r) => r.invoice_id === o.invoice_id && r.status === "OPEN")) throw new FixError("The shop already has your request for this order and will answer soon.", 409);
    if (input.kind === "PROBLEM" && note.length < 5) throw new FixError("Tell the shop in a few words what's wrong.", 400);
    if (input.kind === "CANCEL" && o.state !== "PAID_NOT_SHIPPED") throw new FixError("This order has already shipped, so it can't be cancelled. Tell us what's wrong instead.", 400);
  }
  const now = new Date().toISOString();
  const answered = input.kind === "WHERE";
  const req: FixRequest = {
    id: `FIX-${o.invoice_id}-${all.length + 1}`,
    invoice_id: o.invoice_id,
    buyer: o.buyer_first_name,
    item: o.item,
    amount: o.amount,
    kind: input.kind,
    wants: input.kind === "WHERE" ? null : input.kind === "CANCEL" ? "REFUND" : input.wants ?? "REFUND",
    note,
    at: now,
    status: answered ? "ANSWERED" : "OPEN",
    answer: answered ? whereAnswer(o) : null,
    answered_at: answered ? now : null,
    answered_by: answered ? "auto" : null,
  };
  all.unshift(req);
  if (all.length > MAX_REQUESTS) all.length = MAX_REQUESTS;
  return req;
}

export function listFixRequests(): FixRequest[] {
  return [...store()];
}

// The seller answers an open request. The refund itself, when there is one, goes through
// the normal order action (POST /api/orders/{invoice}/action) before this is called.
export function answerFix(id: string, answer: string): FixRequest {
  const req = store().find((r) => r.id === id);
  if (!req) throw new FixError("That request no longer exists.", 404);
  if (req.status === "ANSWERED") throw new FixError("That request was already answered.", 409);
  const text = answer.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!text) throw new FixError("Write the answer the buyer will see.", 400);
  Object.assign(req, { status: "ANSWERED", answer: text, answered_at: new Date().toISOString(), answered_by: "seller" });
  return req;
}

export function resetFix() {
  g.__rebuttalFix?.delete(tenant());
}

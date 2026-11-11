// Paid orders that arrived through PayPal's PAYMENT.CAPTURE.COMPLETED webhook, waiting to
// ship. The dispute shield checks each one before the seller ships it, on the live
// sandbox (the shared demo account or a seller's own) and in the Simulator, where the
// same event is delivered through the same code by "Simulate a paid order".
//
// Kept in memory per tenant. The shared sandbox tenant is also mirrored to
// data/paid-orders.json, so a dev server restart keeps it (the hosted demo is stateless).

import fs from "node:fs";
import path from "node:path";
import { lruGet, tenant } from "./visitor";

export type PaidOrder = {
  order_id: string;
  invoice_id: string;
  capture_id: string;
  amount: { currency_code: string; value: string };
  paid_at: string;
  event_id: string | null;
};

const MAX_ORDERS = 100;
const FILE = path.join(process.cwd(), "data", "paid-orders.json");
const g = globalThis as unknown as { __rebuttalPaidOrders?: Map<string, PaidOrder[]> };

function list(t = tenant()): PaidOrder[] {
  g.__rebuttalPaidOrders ??= new Map();
  return lruGet<PaidOrder[]>(g.__rebuttalPaidOrders, t, () => {
    if (t !== "sandbox") return [];
    try {
      return JSON.parse(fs.readFileSync(FILE, "utf8")) as PaidOrder[];
    } catch {
      return [];
    }
  }, 500);
}

function save(t: string, orders: PaidOrder[]) {
  if (t !== "sandbox") return;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(orders, null, 2));
  } catch {
    // read-only disk: the orders stay in memory
  }
}

// The paid order a PAYMENT.CAPTURE.COMPLETED event describes, or null when it doesn't
// say which PayPal order and invoice it paid.
export function paidOrderFromEvent(event: { id?: unknown; resource?: Record<string, any> }): PaidOrder | null {
  const r = event.resource ?? {};
  const orderId = r.supplementary_data?.related_ids?.order_id;
  const invoiceId = r.invoice_id ?? r.custom_id;
  if (typeof r.id !== "string" || typeof orderId !== "string" || typeof invoiceId !== "string" || !invoiceId.trim()) return null;
  return {
    order_id: orderId,
    invoice_id: invoiceId.trim(),
    capture_id: r.id,
    amount: { currency_code: String(r.amount?.currency_code ?? "USD"), value: String(r.amount?.value ?? "0") },
    paid_at: typeof r.create_time === "string" ? r.create_time : new Date().toISOString(),
    event_id: typeof event.id === "string" ? event.id : null,
  };
}

// Records a paid order once; returns false when it was already known.
export function recordPaidOrder(o: PaidOrder): boolean {
  const t = tenant();
  const orders = list(t);
  if (orders.some((x) => x.order_id === o.order_id)) return false;
  orders.unshift(o);
  if (orders.length > MAX_ORDERS) orders.length = MAX_ORDERS;
  save(t, orders);
  return true;
}

export function paidOrders(): PaidOrder[] {
  return [...list()];
}

export function resetPaidOrders() {
  g.__rebuttalPaidOrders?.delete(tenant());
}

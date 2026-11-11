import { beforeEach, describe, expect, it } from "vitest";
import { paidOrderFromEvent, paidOrders, recordPaidOrder, resetPaidOrders } from "../src/lib/paid-orders";
import { paypal } from "../src/lib/paypal";
import { resetMock, simulatedPaymentEvent } from "../src/lib/paypal/mock";
import { runAs, type Visitor } from "../src/lib/visitor";

process.env.PAYPAL_MODE = "mock";
const V: Visitor = { id: "9a9a9a9a-1111-2222-3333-444444444444", mode: "mock" };
const as = <T>(fn: () => Promise<T> | T) => runAs({ ...V }, fn);

describe("paid orders from PAYMENT.CAPTURE.COMPLETED", () => {
  beforeEach(() => as(() => (resetMock(), resetPaidOrders())));

  it("reads the PayPal order, invoice and capture from PayPal's capture resource", () => {
    const o = paidOrderFromEvent({
      id: "WH-9",
      resource: { id: "CAP-9", invoice_id: "JK-2001", amount: { currency_code: "USD", value: "42.00" }, create_time: "2026-11-11T10:00:00Z", supplementary_data: { related_ids: { order_id: "ORD-9" } } },
    });
    expect(o).toEqual({ order_id: "ORD-9", invoice_id: "JK-2001", capture_id: "CAP-9", amount: { currency_code: "USD", value: "42.00" }, paid_at: "2026-11-11T10:00:00Z", event_id: "WH-9" });
    expect(paidOrderFromEvent({ resource: { id: "CAP-1" } })).toBeNull();
  });

  it("shows a webhook-only order to the shield once it is paid, and only once", () =>
    as(async () => {
      const before = await paypal().ordersAwaitingShipment();
      expect(before.map((o) => o.invoice_id)).not.toContain("JK-1095");
      const event = simulatedPaymentEvent()!;
      expect(event.event_type).toBe("PAYMENT.CAPTURE.COMPLETED");
      const paid = paidOrderFromEvent(event)!;
      expect(recordPaidOrder(paid)).toBe(true);
      expect(recordPaidOrder(paid)).toBe(false); // PayPal may deliver the same event twice
      const after = await paypal().ordersAwaitingShipment();
      expect(after.map((o) => o.invoice_id)).toContain("JK-1095");
      expect(after).toHaveLength(before.length + 1);
      expect(simulatedPaymentEvent()).toBeNull();
      // The shield can read the paid order through PayPal's Orders API.
      const order = (await paypal().runTool("get_order", { id: paid.order_id })) as { purchase_units: Array<{ invoice_id: string }> };
      expect(order.purchase_units[0].invoice_id).toBe("JK-1095");
    }));

  it("keeps each visitor's paid orders apart", () =>
    as(async () => {
      recordPaidOrder(paidOrderFromEvent(simulatedPaymentEvent()!)!);
      expect(paidOrders()).toHaveLength(1);
      expect(runAs({ id: "9b9b9b9b-1111-2222-3333-444444444444", mode: "mock" }, () => paidOrders())).toHaveLength(0);
    }));
});

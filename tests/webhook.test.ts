import { describe, expect, it } from "vitest";
import { POST } from "../src/app/api/webhooks/paypal/route";

describe("PayPal webhook", () => {
  it("acknowledges events it doesn't use without a signature check, so PayPal stops retrying them", async () => {
    delete process.env.PAYPAL_WEBHOOK_ID; // verification would throw (500) if it ran
    const res = await POST(new Request("http://x/api/webhooks/paypal", { method: "POST", body: JSON.stringify({ id: "WH-1", event_type: "BILLING.SUBSCRIPTION.CREATED", resource: {} }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
  });

  it("checks the signature of a completed payment before trusting it", async () => {
    delete process.env.PAYPAL_WEBHOOK_ID;
    const res = await POST(new Request("http://x/api/webhooks/paypal", { method: "POST", body: JSON.stringify({ id: "WH-2", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP-1" } }) }));
    expect(res.status).toBe(500); // no webhook id to verify against, so nothing is recorded
  });
});

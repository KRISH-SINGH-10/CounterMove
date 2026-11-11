import { paypal } from "@/lib/paypal";
import { simulatedPaymentEvent } from "@/lib/paypal/mock";
import { visitor, withVisitor } from "@/lib/visitor";
import { ingestPayment } from "@/lib/webhooks/paypal";

export const maxDuration = 300;

// Simulator: a buyer pays for an order, and the simulator delivers the same
// PAYMENT.CAPTURE.COMPLETED webhook PayPal would, through the same code that starts the
// pre-ship check on a live order.
export const POST = withVisitor(async () => {
  if (paypal().mode !== "mock") return Response.json({ error: "Paid orders are simulated only in the Simulator. On the live sandbox they arrive from PayPal's webhook." }, { status: 400 });
  const event = simulatedPaymentEvent();
  if (!event) return Response.json({ error: "Every demo order is already paid. Use Simulator tools → Reset demo to start again." }, { status: 409 });
  const res = await ingestPayment(event, { ...visitor() });
  return Response.json({ ...(await res.json()), event_type: event.event_type }, { status: res.status });
});

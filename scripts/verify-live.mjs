// Calls each PayPal API Countermove uses against the real sandbox and prints what
// PayPal answered, without printing any secret:
//   node --env-file=.env.local scripts/verify-live.mjs
// Reads only, plus two writes that change nothing a buyer sees: creating an unpaid order,
// and a signature check of a made-up webhook (PayPal answers FAILURE, which proves the
// endpoint works). Refunds, evidence and offers need a buyer to pay or file a dispute
// first, so they are verified through the app (see README, "Seeding the sandbox").

const BASE = "https://api-m.sandbox.paypal.com";
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.log("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) first.");
  process.exit(1);
}

const results = [];
async function call(label, method, path, body, { token, form } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` };
  if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  else if (body !== undefined) headers["Content-Type"] = "application/json";
  const t = Date.now();
  let status = 0;
  let json = null;
  let debug = null;
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)), signal: AbortSignal.timeout(30_000) });
    status = res.status;
    debug = res.headers.get("paypal-debug-id");
    const text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = { error: String(e.message ?? e) };
  }
  results.push({ label, call: `${method} ${path.replace(/\?.*$/, "")}`, status, ms: Date.now() - t, debug });
  return { status, json };
}

const tok = await call("Sign in (OAuth)", "POST", "/v1/oauth2/token", undefined, { form: "grant_type=client_credentials" });
const token = tok.json?.access_token;
if (!token) {
  console.table(results);
  process.exit(1);
}
const o = { token };

const list = await call("List disputes", "GET", "/v1/customer/disputes?page_size=10", undefined, o);
const disputeId = list.json?.items?.[0]?.dispute_id;
let txn = null;
if (disputeId) {
  const d = await call("Read a dispute", "GET", `/v1/customer/disputes/${disputeId}`, undefined, o);
  txn = d.json?.disputed_transactions?.[0]?.seller_transaction_id ?? null;
}
if (txn) await call("Shipment tracking for its transaction", "GET", `/v1/shipping/trackers?transaction_id=${txn}`, undefined, o);
const end = new Date();
const start = new Date(end.getTime() - 30 * 86_400_000);
await call("Transaction search (30 days)", "GET", `/v1/reporting/transactions?start_date=${start.toISOString().slice(0, 19)}Z&end_date=${end.toISOString().slice(0, 19)}Z&fields=transaction_info&page_size=5`, undefined, o);
const order = await call("Create an order (unpaid)", "POST", "/v2/checkout/orders", { intent: "CAPTURE", purchase_units: [{ invoice_id: `VERIFY-${Date.now()}`, amount: { currency_code: "USD", value: "1.00" } }] }, o);
if (order.json?.id) await call("Read the order", "GET", `/v2/checkout/orders/${order.json.id}`, undefined, o);
await call("List webhooks", "GET", "/v1/notifications/webhooks", undefined, o);
const sig = await call("Verify a webhook signature", "POST", "/v1/notifications/verify-webhook-signature", {
  auth_algo: "SHA256withRSA", cert_url: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270", transmission_id: "verify-live-check",
  transmission_sig: "invalid", transmission_time: new Date().toISOString(), webhook_id: process.env.PAYPAL_WEBHOOK_ID ?? "0000000000000000", webhook_event: { id: "WH-VERIFY", event_type: "PAYMENT.CAPTURE.COMPLETED" },
}, o);
results.at(-1).note = sig.json?.verification_status ?? sig.json?.name ?? "";

console.table(results.map((r) => ({ API: r.label, Call: r.call, Status: r.status, ms: r.ms, "PayPal-Debug-Id": r.debug ?? "", Note: r.note ?? "" })));
const failed = results.filter((r) => r.status === 0 || r.status >= 500 || (r.status >= 400 && !r.label.startsWith("Verify")));
console.log(failed.length ? `${failed.length} call(s) failed.` : "Every call was answered by PayPal.");
process.exit(failed.length ? 1 : 0);

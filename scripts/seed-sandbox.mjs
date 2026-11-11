// Seeds the PayPal sandbox with real orders for the demo shop, so a dispute the sandbox
// buyer files lines up with the shop's records (get_store_records keys on invoice_id).
//
//   node scripts/seed-sandbox.mjs create [JK-1042 JK-1057 ...]   creates orders, prints buyer approval links
//   node scripts/seed-sandbox.mjs capture [--wait]               captures approved orders, adds carrier tracking
//
// Disputes themselves can only be filed by the buyer: after capture, log in to
// sandbox.paypal.com as the sandbox personal account and report a problem with the payment.
// Never prints credentials.
import fs from "node:fs";
import path from "node:path";

const BASE = "https://api-m.sandbox.paypal.com";
const DIR = path.join(process.cwd(), "data");
const PENDING = path.join(DIR, "sandbox-pending.json");
const ORDER_MAP = path.join(DIR, "sandbox-orders.json"); // read by src/lib/paypal/sandbox.ts

// Order details mirror src/lib/demo/scenarios.ts (kept here so the script runs without a TS build).
const ORDERS = {
  "JK-1042": {
    amount: "184.00", item: "Strata Runner 2 'Dusk', men's 10, deadstock", sku: "STR-RUN2-DUSK-10", name: "Dana Whitfield",
    address: { address_line_1: "418 Alder St", address_line_2: "Apt 3", admin_area_2: "Denver", admin_area_1: "CO", postal_code: "80203", country_code: "US" },
    tracking: { carrier: "UPS", tracking_number: "1Z84A9E70347215522", status: "DELIVERED" },
    file_as: "Item not received",
  },
  "JK-1057": {
    amount: "96.00", item: "Kestrel Low 'Sail', women's 8, lightly worn", sku: "KST-LOW-SAIL-W8", name: "Priya Raman",
    address: { address_line_1: "77 Union Ave", admin_area_2: "Brooklyn", admin_area_1: "NY", postal_code: "11211", country_code: "US" },
    tracking: { carrier: "USPS", tracking_number: "9400111899223847562190", status: "DELIVERED" },
    file_as: "Item significantly not as described (toe box dented)",
  },
  "JK-1063": {
    amount: "28.00", item: "Sneaker care kit with spare laces", sku: "ACC-CARE-KIT", name: "Marcus Lee",
    address: { address_line_1: "2210 Pine St", admin_area_2: "Seattle", admin_area_1: "WA", postal_code: "98101", country_code: "US" },
    tracking: null,
    file_as: "Item not received",
  },
};

async function token() {
  const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`OAuth failed (${res.status})`);
  return (await res.json()).access_token;
}

async function api(tok, method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", "PayPal-Request-Id": `seed-${Date.now()}-${Math.random()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${p} failed (${res.status}): ${text.slice(0, 400)}`);
  return json;
}

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n"); };

async function create(keys) {
  const tok = await token();
  const pending = readJson(PENDING, {});
  for (const key of keys) {
    const o = ORDERS[key];
    if (!o) throw new Error(`Unknown scenario ${key}. Known: ${Object.keys(ORDERS).join(", ")}`);
    // Sandbox invoice IDs must be unique per seller, so repeat runs add a suffix;
    // get_store_records ignores it.
    const invoice = `${key}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const order = await api(tok, "POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: key,
        invoice_id: invoice,
        description: `Laceline Resale order ${key}`,
        amount: { currency_code: "USD", value: o.amount, breakdown: { item_total: { currency_code: "USD", value: o.amount } } },
        items: [{ name: o.item, sku: o.sku, quantity: "1", category: "PHYSICAL_GOODS", unit_amount: { currency_code: "USD", value: o.amount } }],
        shipping: { name: { full_name: o.name }, address: o.address },
      }],
      payment_source: { paypal: { experience_context: { brand_name: "Laceline Resale", shipping_preference: "SET_PROVIDED_ADDRESS", user_action: "PAY_NOW", return_url: "https://example.com/paid", cancel_url: "https://example.com/cancelled" } } },
    });
    const approve = order.links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    pending[order.id] = { key, invoice, created: new Date().toISOString() };
    console.log(`${key}  $${o.amount}  order ${order.id}\n  Pay as the sandbox buyer: ${approve}`);
  }
  writeJson(PENDING, pending);
}

async function capture(wait) {
  const deadline = Date.now() + (wait ? 2 * 60 * 60 * 1000 : 0);
  for (;;) {
    const tok = await token();
    const pending = readJson(PENDING, {});
    const map = readJson(ORDER_MAP, {});
    for (const [orderId, p] of Object.entries(pending)) {
      const order = await api(tok, "GET", `/v2/checkout/orders/${orderId}`).catch((e) => {
        if (!/\(404\)/.test(e.message)) throw e;
        // Unpaid sandbox orders expire after a few hours; run `create` again for a new link.
        console.log(`${p.key}: order ${orderId} expired before the buyer paid; dropped.`);
        delete pending[orderId];
        writeJson(PENDING, pending);
        return null;
      });
      if (!order) continue;
      if (order.status !== "APPROVED" && order.status !== "COMPLETED") continue;
      const done = order.status === "COMPLETED" ? order : await api(tok, "POST", `/v2/checkout/orders/${orderId}/capture`, {});
      const cap = done.purchase_units[0].payments.captures[0];
      map[p.invoice] = orderId;
      delete pending[orderId];
      console.log(`${p.key}: captured ${cap.id} (${cap.status}), invoice ${p.invoice}`);
      const t = ORDERS[p.key].tracking;
      if (t) {
        // Orders v2 /track: the older /v1/shipping/trackers-batch needs an app feature the default app lacks (403).
        await api(tok, "POST", `/v2/checkout/orders/${orderId}/track`, { capture_id: cap.id, tracking_number: t.tracking_number, carrier: t.carrier, notify_payer: false })
          .then(() => console.log(`  tracking ${t.carrier} ${t.tracking_number} added`))
          .catch((e) => console.log(`  tracking not added: ${e.message}`));
      }
      console.log(`  Next: as the buyer, open Activity at sandbox.paypal.com, pick this payment, Report a problem: ${ORDERS[p.key].file_as}.`);
      writeJson(ORDER_MAP, map);
      writeJson(PENDING, pending);
    }
    const left = Object.keys(readJson(PENDING, {})).length;
    if (!left || Date.now() > deadline) { console.log(left ? `${left} order(s) still waiting for the buyer.` : "All seeded orders captured."); return; }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "create") await create(rest.length ? rest : ["JK-1042", "JK-1057"]);
else if (cmd === "capture") await capture(rest.includes("--wait"));
else console.log("Usage: node scripts/seed-sandbox.mjs create [JK-1042 ...] | capture [--wait]");

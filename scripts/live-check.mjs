// Checks the live services Countermove needs, without printing any secret:
//   node scripts/live-check.mjs
// 1. Gemini: lists the flash models this key sees, then sends a one-line prompt to
//    GEMINI_MODEL (default gemini-3.5-flash-lite), because a listed model can still be
//    retired for new keys, overloaded, or hang.
// 2. PayPal sandbox: lists disputes through the PayPal Agent Toolkit.
import { GoogleGenAI } from "@google/genai";
import { ALL_TOOLS_ENABLED, PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";

const want = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
let failed = false;

if (!process.env.GEMINI_API_KEY) {
  console.log("Gemini: GEMINI_API_KEY is not set");
  failed = true;
} else {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const names = [];
    for await (const m of await ai.models.list()) if (m.supportedActions?.includes("generateContent")) names.push(m.name.replace("models/", ""));
    const flash = names.filter((n) => /flash/.test(n));
    console.log(`Gemini: ${names.length} models; ${want} ${names.includes(want) ? "available" : "NOT available"}. Flash models: ${flash.join(", ")}`);
    if (!names.includes(want)) failed = true;
    const t0 = Date.now();
    const res = await ai.models.generateContent({ model: want, contents: "Reply with exactly: pong", config: { abortSignal: AbortSignal.timeout(45_000) } });
    console.log(`Gemini: ${want} answered "${(res.text ?? "").trim()}" in ${Date.now() - t0} ms`);
  } catch (e) {
    console.log(`Gemini: ${e.status ?? ""} ${String(e.message).slice(0, 200)}`);
    failed = true;
  }
}

const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.log("PayPal: PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set");
  failed = true;
} else {
  const tk = new PayPalAgentToolkit({ clientId: id, clientSecret: secret, configuration: { actions: ALL_TOOLS_ENABLED, context: { sandbox: true } } });
  tk.client._baseUrl = "https://api-m.sandbox.paypal.com"; // same override as src/lib/paypal/toolkit.ts
  const msg = await tk.handleToolCall({ id: "check", type: "function", function: { name: "list_disputes", arguments: JSON.stringify({ page_size: 10 }) } });
  const out = JSON.parse(msg.content);
  if (out.error) {
    console.log(`PayPal: list_disputes failed: ${String(out.error.message ?? JSON.stringify(out.error)).slice(0, 300)}`);
    failed = true;
  } else {
    console.log(`PayPal: sandbox reachable; ${out.items?.length ?? 0} dispute(s): ${(out.items ?? []).map((d) => `${d.dispute_id} ${d.reason} ${d.status}`).join("; ")}`);
  }
}
process.exit(failed ? 1 : 0);

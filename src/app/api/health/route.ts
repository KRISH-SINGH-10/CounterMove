import { connection } from "next/server";
import { databaseConfigured } from "../../../lib/store";
import { dbHealthy } from "../../../lib/store/db";

// Health check for Render and uptime monitors: no PayPal or model calls, so a ping
// never spends API quota. With a database configured it also checks the database is
// reachable, so Render restarts or alerts instead of serving errors.
const headers = { "Cache-Control": "no-store" };

// Outside a request (tests) there is nothing to opt out of prerendering.
async function live() {
  try {
    await connection();
  } catch {
    // not in a request
  }
}

export async function GET() {
  await live(); // checked per request, never prerendered at build time
  const db = databaseConfigured() ? await dbHealthy() : null;
  // What this server is set up with: yes/no only, never a value.
  const set = (name: string) => Boolean(process.env[name]?.trim());
  const configured = {
    database: set("DATABASE_URL"),
    gemini: set("GEMINI_API_KEY"),
    paypal_sandbox: set("PAYPAL_CLIENT_ID") && set("PAYPAL_CLIENT_SECRET"),
    paypal_webhook: set("PAYPAL_WEBHOOK_ID"),
    ag_grid_enterprise: set("AG_GRID_LICENSE_KEY"),
    ag_studio: set("AG_STUDIO_LICENSE_KEY"),
  };
  return Response.json({ ok: db !== false, service: "countermove", database: db === null ? "not configured" : db ? "ok" : "unreachable", configured }, { status: db === false ? 503 : 200, headers });
}

export async function HEAD() {
  await live();
  const ok = !databaseConfigured() || (await dbHealthy());
  return new Response(null, { status: ok ? 200 : 503, headers });
}

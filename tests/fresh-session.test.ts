import { describe, expect, it, vi } from "vitest";

// connection() only works inside a real Next request; the handlers are called directly here.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
import { GET as cases } from "../src/app/api/cases/route";
import { POST as reset } from "../src/app/api/demo/reset/route";
import { GET as network } from "../src/app/api/network/route";
import { GET as trail } from "../src/app/api/trail/route";
import { paypal } from "../src/lib/paypal";
import { runAs } from "../src/lib/visitor";

process.env.PAYPAL_MODE = "mock";
// The hosted demo seeds the shop's closed history (vitest.config turns it off by default).
process.env.REBUTTAL_SEED_HISTORY = "1";

// A judge opening the site for the first time: a brand-new visitor cookie, nothing else.
// Everything the Protect page shows must already be there.
const ID = "f0f0f0f0-aaaa-4bbb-8ccc-0123456789ab";
const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, { ...init, headers: { cookie: `rebuttal_visitor=${ID}; rebuttal_mode=mock` } });

type Net = { reports: number; shops: number; accounts: Array<{ pending_order: string | null; shops: number }> };

async function protectData() {
  const c = await (await cases(req("/api/cases"))).json();
  const n = (await (await network(req("/api/network"))).json()) as Net;
  const t = await (await trail(req("/api/trail"))).json();
  const orders = await runAs({ id: ID, mode: "mock" }, () => paypal().ordersAwaitingShipment());
  const buyers = new Set(c.cases.map((x: { dispute: { disputed_transactions: Array<{ buyer?: { email?: string } }> } }) => x.dispute.disputed_transactions[0]?.buyer?.email).filter(Boolean));
  return { c, n, t, orders, buyers };
}

describe("a fresh demo session", () => {
  it("has network reports, a reported buyer ordering now, paid orders, buyers, stats and API calls", async () => {
    const { c, n, t, orders, buyers } = await protectData();
    expect(c.mode).toBe("mock");
    expect(c.stats.kept).toBeGreaterThan(0);
    expect(c.stats.open).toBeGreaterThan(0);
    expect(n.reports).toBeGreaterThan(0);
    expect(n.shops).toBeGreaterThan(1);
    expect(n.accounts.filter((a) => a.pending_order).length).toBeGreaterThanOrEqual(1);
    expect(orders.map((o) => o.invoice_id).sort()).toEqual(["JK-1088", "JK-1090", "JK-1093"]);
    // The HIGH-risk forwarder order is from a buyer the network already reported.
    expect(n.accounts.some((a) => a.pending_order === "JK-1088")).toBe(true);
    expect(buyers.size).toBeGreaterThan(5);
    expect(t.calls.length).toBeGreaterThan(0);
  });

  it("is the same after Reset demo", async () => {
    const before = await protectData();
    expect((await reset(req("/api/demo/reset", { method: "POST" }))).status).toBe(200);
    const after = await protectData();
    expect(after.c.stats).toEqual(before.c.stats);
    expect(after.n.reports).toBe(before.n.reports);
    expect(after.n.accounts.filter((a) => a.pending_order).length).toBe(before.n.accounts.filter((a) => a.pending_order).length);
    expect(after.orders.map((o) => o.invoice_id).sort()).toEqual(before.orders.map((o) => o.invoice_id).sort());
    expect(after.buyers.size).toBe(before.buyers.size);
    expect(after.t.calls.length).toBeGreaterThan(0);
  });
});

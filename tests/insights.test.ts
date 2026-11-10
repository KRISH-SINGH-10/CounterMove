import { describe, expect, it } from "vitest";
import { historyCases } from "../src/lib/demo/history";
import { diagnose, forecastReserve } from "../src/lib/insights";
import type { CaseRecord, DisputeReason } from "../src/lib/types";

const NOW = Date.parse("2026-11-10T00:00:00Z");

function make(id: string, reason: DisputeReason, amount: number, extra: Partial<CaseRecord> = {}, daysAgo = 10): CaseRecord {
  const at = new Date(NOW - daysAgo * 86_400_000).toISOString();
  return {
    id,
    status: "NEW",
    trace: [],
    updated_at: at,
    dispute: {
      dispute_id: id,
      create_time: at,
      update_time: at,
      reason,
      status: "OPEN",
      dispute_amount: { currency_code: "USD", value: amount.toFixed(2) },
      dispute_life_cycle_stage: "INQUIRY",
      disputed_transactions: [{ seller_transaction_id: `T-${id}`, invoice_number: `INV-${id}`, buyer: { name: `Buyer ${id}` }, items: [{ item_description: "Speckled mug" }] }],
    },
    ...extra,
  } as CaseRecord;
}
const lost = (amount: number, by: "seller" | "autopilot" = "seller"): Partial<CaseRecord> => ({ outcome: { result: "REFUNDED", amount_kept: 0, amount_lost: amount, at: new Date(NOW).toISOString() }, submitted: { decision: "REFUND", at: new Date(NOW).toISOString(), response: "x", by } });
const won = (amount: number): Partial<CaseRecord> => ({ outcome: { result: "WON", amount_kept: amount, amount_lost: 0, at: new Date(NOW).toISOString() } });

describe("Dispute Reserve", () => {
  it("expects the AI's loss chance on an investigated fight and the full amount on a refund", () => {
    const fight = make("A", "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", 200, { recommendation: { decision: "FIGHT", win_probability: 0.9 } as CaseRecord["recommendation"] });
    const refund = make("B", "OTHER", 30, { recommendation: { decision: "REFUND", win_probability: 0 } as CaseRecord["recommendation"] });
    const r = forecastReserve([fight, refund], NOW);
    expect(r.open.find((x) => x.id === "A")?.expected_loss).toBe(20);
    expect(r.open.find((x) => x.id === "B")?.expected_loss).toBe(30);
    expect(r.open_expected).toBe(50);
  });

  it("uses the shop's own results for a claim type when a dispute isn't investigated", () => {
    const cases = [make("W", "UNAUTHORISED", 100, won(100)), make("L", "UNAUTHORISED", 100, lost(100)), make("O", "UNAUTHORISED", 80)];
    const r = forecastReserve(cases, NOW);
    expect(r.open[0].loss_share).toBe(0.5);
    expect(r.open[0].expected_loss).toBe(40);
  });

  it("forecasts new disputes from the last 90 days and adds them to the reserve", () => {
    const cases = [make("1", "OTHER", 60, lost(60), 5), make("2", "OTHER", 60, won(60), 40), make("3", "OTHER", 60, lost(60), 80), make("old", "OTHER", 500, lost(500), 200)];
    const r = forecastReserve(cases, NOW);
    expect(r.new_count).toBe(1); // 3 in 90 days = 1 per 30 days
    expect(r.new_expected).toBeGreaterThan(0);
    expect(r.reserve).toBe(Math.round((r.open_expected + r.new_expected) * 100) / 100);
  });

  it("gives a sensible reserve for the demo shop", () => {
    const r = forecastReserve(historyCases(), Date.now());
    expect(r.reserve).toBeGreaterThanOrEqual(0);
    expect(r.loss_share).toBeGreaterThan(0);
    expect(r.loss_share).toBeLessThan(1);
  });
});

describe("Dispute Doctor", () => {
  it("finds unprovable deliveries and proposes a signature rule", () => {
    const f = diagnose([make("1", "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", 80, lost(80)), make("2", "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", 120, lost(120)), make("3", "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", 200, won(200))]);
    const sig = f.find((x) => x.id === "signature")!;
    expect(sig.disputes).toBe(2);
    expect(sig.lost).toBe(200);
    expect(sig.fix).toMatch(/signature/i);
    expect(sig.action.kind).toBe("copy");
  });

  it("names the item behind repeated not-as-described disputes", () => {
    const f = diagnose([make("1", "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", 40, lost(40)), make("2", "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", 40, lost(20))]);
    expect(f.find((x) => x.id === "listing")?.cause).toContain("Speckled mug");
  });

  it("proposes a higher auto-refund limit, never above the hard cap", () => {
    const rules = { enabled: true, auto_refund_max: 30, auto_fight_min_win: 0, max_auto_amount: 40, negotiate_max_pct: 0.4 };
    const f = diagnose([make("1", "OTHER", 38, lost(38)), make("2", "OTHER", 55, lost(55)), make("3", "OTHER", 45, lost(45, "autopilot"))], rules);
    const fix = f.find((x) => x.id === "auto-refund")!;
    expect(fix.action).toEqual({ kind: "rule", label: "Raise auto-refund to $40", patch: { auto_refund_max: 40 } });
  });

  it("says nothing when there is no pattern, and orders findings by money lost", () => {
    expect(diagnose([make("1", "OTHER", 10, won(10))])).toEqual([]);
    const f = diagnose(historyCases(), { enabled: true, auto_refund_max: 30, auto_fight_min_win: 0, max_auto_amount: 250, negotiate_max_pct: 0.4 });
    expect(f.length).toBeGreaterThan(0);
    for (let i = 1; i < f.length; i++) expect(f[i - 1].lost).toBeGreaterThanOrEqual(f[i].lost);
  });
});

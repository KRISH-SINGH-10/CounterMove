"use client";

import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { forPhone, usePhone } from "./phone";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShieldRow } from "@/lib/shield";
import { money } from "./format";
import { gridTheme } from "./grid";
import { BUTTON } from "./ui";

const RISK_COLOR = { HIGH: "var(--danger)", MEDIUM: "var(--offer)", LOW: "var(--fight)" } as const;

type ShieldGridRow = ShieldRow & { detail?: true };
type Action = "REFUND" | "SIGNATURE" | "PAYPAL_ADDRESS";
type Ctx = { open: string | null; recheck: (id: string) => void; act: (invoiceId: string, action: Action) => Promise<string | null>; viewOnly: boolean };

const ACTIONS: Array<{ id: Action; label: string; hint: string }> = [
  { id: "REFUND", label: "Refund now", hint: "Give the money back through PayPal and don't ship." },
  { id: "SIGNATURE", label: "Require signature", hint: "Ship, but only with signature confirmation." },
  { id: "PAYPAL_ADDRESS", label: "Ship to PayPal address only", hint: "Ship only to the address on the PayPal transaction." },
];
const DONE_LABEL: Record<Action, string> = { REFUND: "Refunded", SIGNATURE: "Signature required", PAYPAL_ADDRESS: "PayPal address only" };

// Which of the three actions the agent's first suggested step points at, if any.
function suggested(steps: string[]): Action | null {
  const first = (steps[0] ?? "").toLowerCase();
  if (/refund/.test(first)) return "REFUND";
  if (/signature/.test(first)) return "SIGNATURE";
  if (/address/.test(first)) return "PAYPAL_ADDRESS";
  return null;
}

// A fixed locale, so the time reads the same wherever it is rendered.
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function HeadlineCell({ data, value }: ICellRendererParams<ShieldGridRow>) {
  return (
    <span className="flex w-full min-w-0 items-center gap-2">
      {data?.decision ? (
        <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: "var(--fight)", border: "1px solid currentColor" }}>✓ {DONE_LABEL[data.decision.action]}</span>
      ) : null}
      <span className="truncate">{value}</span>
    </span>
  );
}

// One clear action per risky order. A refund moves money, so it asks once more in the
// page before calling PayPal.
function OrderActions({ data, act }: { data: ShieldGridRow; act: Ctx["act"] }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = data.decision;
  if (d) {
    const r = d.receipt;
    return (
      <div className="mt-3 rounded-md border p-2.5 text-sm" style={{ borderColor: "var(--fight)" }} data-testid="order-decision">
        <p className="font-medium">
          <span aria-hidden style={{ color: "var(--fight)" }}>✓ </span>
          {d.action === "REFUND" ? `Refunded ${money(data.amount)} through PayPal` : d.action === "SIGNATURE" ? "Ship with signature confirmation only" : "Ship only to the address on the PayPal transaction"}
          <span className="font-normal text-muted"> · {clock(d.at)}</span>
        </p>
        {r ? (
          <p className="mt-1 break-all font-mono text-xs text-muted">
            {r.method} {r.endpoint} · HTTP {r.http_status ?? 200}{r.debug_id ? ` · debug id ${r.debug_id}` : ""}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">Saved as a shipping rule for this order. No PayPal call was needed.</p>
        )}
      </div>
    );
  }
  const pick = suggested(data.verdict?.actions ?? []);
  async function run(action: Action) {
    setBusy(action);
    setError(null);
    const failed = await act(data.invoice_id, action);
    setBusy(null);
    setConfirm(false);
    if (failed) setError(failed);
  }
  return (
    <div className="mt-3" data-testid="order-actions">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Take one action</h3>
      {confirm ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md border border-danger p-2 text-sm">
          <span>Refund {money(data.amount)} to {data.buyer} through PayPal and don&apos;t ship?</span>
          <button onClick={() => run("REFUND")} disabled={busy !== null} className="rounded-md px-3 py-1 text-sm font-semibold text-panel disabled:opacity-60" style={{ background: "var(--danger)" }}>
            {busy === "REFUND" ? "Refunding…" : "Confirm refund"}
          </button>
          <button onClick={() => setConfirm(false)} disabled={busy !== null} className={BUTTON.ghost}>Cancel</button>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              title={a.hint}
              disabled={busy !== null}
              onClick={() => (a.id === "REFUND" ? setConfirm(true) : run(a.id))}
              className={a.id === pick ? BUTTON.primary : BUTTON.secondary}
            >
              {busy === a.id ? "Saving…" : a.label}
              {a.id === pick ? <span className="ml-1.5 text-xs font-normal opacity-80">agent&apos;s pick</span> : null}
            </button>
          ))}
        </div>
      )}
      {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function BuyerCell({ data }: ICellRendererParams<ShieldGridRow>) {
  return (
    <div className="flex w-full min-w-0 flex-col leading-tight">
      <span className="font-medium">{data?.buyer}</span>
      <span className="block w-0 min-w-full truncate text-xs text-muted" title={data?.item}>{data?.item}</span>
    </div>
  );
}

function RiskCell({ data }: ICellRendererParams<ShieldGridRow>) {
  if (!data) return null;
  if (data.status === "CHECKING") return <span className="text-xs text-muted">Checking… {data.trace.at(-1)?.tool ? `(${data.trace.at(-1)!.tool})` : ""}</span>;
  if (data.status === "ERROR") return <span className="text-xs text-danger" title={data.error}>Check failed</span>;
  const v = data.verdict;
  if (!v) return null;
  return (
    <span className="flex items-center gap-2">
      <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: RISK_COLOR[v.risk], border: "1px solid currentColor" }}>{v.risk}</span>
      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-line sm:inline-block">
        <span className="block h-full rounded-full" style={{ width: `${Math.round(v.score)}%`, background: RISK_COLOR[v.risk] }} />
      </span>
      <span className="text-xs text-muted tabular">{Math.round(v.score)}</span>
    </span>
  );
}

function ExpandCell({ data, context }: ICellRendererParams<ShieldGridRow>) {
  if (!data?.verdict) return null;
  const open = (context as Ctx).open === data.order_id;
  return <span className="inline-block text-muted transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }} aria-hidden>▶</span>;
}

const COLS: ColDef<ShieldGridRow>[] = [
  { colId: "expand", headerName: "", width: 44, maxWidth: 44, sortable: false, resizable: false, cellRenderer: ExpandCell },
  { field: "invoice_id", headerName: "Order", width: 92, cellClass: "text-muted tabular" },
  { colId: "buyer", headerName: "Buyer", valueGetter: (p) => p.data?.buyer, cellRenderer: BuyerCell, flex: 1.1, minWidth: 160 },
  { field: "ship_to", headerName: "Ships to", flex: 1.2, minWidth: 160, tooltipField: "ship_to", cellRenderer: (p: ICellRendererParams<ShieldGridRow>) => <span className="truncate text-muted">{p.value}</span> },
  { colId: "amount", headerName: "Amount", width: 110, type: "rightAligned", valueGetter: (p) => Number(p.data?.amount ?? 0), valueFormatter: (p) => money(p.value), cellClass: "tabular font-medium justify-end" },
  { colId: "risk", headerName: "Dispute risk", width: 190, valueGetter: (p) => p.data?.verdict?.score ?? -1, cellRenderer: RiskCell, sort: "desc" },
  { colId: "headline", headerName: "Agent's read", valueGetter: (p) => p.data?.verdict?.headline ?? "", flex: 2, minWidth: 220, tooltipValueGetter: (p) => p.value, cellRenderer: HeadlineCell },
];

// What the agent found and what to do before shipping, under the order's row.
function ShieldDetail({ data, context }: ICellRendererParams<ShieldGridRow>) {
  const v = data?.verdict;
  if (!data || !v) return null;
  const { recheck, act, viewOnly } = context as Ctx;
  return (
    <div className="grid h-full gap-4 overflow-auto whitespace-normal border-l-4 bg-bg px-6 py-3 leading-normal md:grid-cols-2" style={{ borderColor: RISK_COLOR[v.risk] }}>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">What decided it: {v.score}/100 from fixed rules</h3>
        <ul className="mt-1 space-y-1 text-sm">
          {v.signals.map((s, i) => (
            <li key={i} className="flex gap-2 leading-snug">
              <span className="font-semibold" style={{ color: s.effect === "RAISES" ? "var(--danger)" : "var(--fight)" }}>{s.effect === "RAISES" ? "▲" : "▼"}</span>
              <span>
                {s.finding} <span className="text-xs text-muted">({s.source}{s.weight ? `, ${s.weight > 0 ? "+" : ""}${s.weight} pts` : ""})</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Before you ship</h3>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-snug">
          {v.actions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ol>
        {data.decision || (v.risk !== "LOW" && !viewOnly) ? <OrderActions data={data} act={act} /> : null}
        {data.notice ? <p className="mt-2 text-xs" style={{ color: "var(--offer)" }}>{data.notice}</p> : null}
        <p className="mt-2 text-xs text-muted">
          {data.model === "rules" ? "Rule-based check" : `Explained by ${data.model}`} · {data.trace.filter((t) => t.kind === "tool").map((t) => t.tool).join(", ")}
          {viewOnly ? null : (
            <>
              {" · "}
              <button onClick={() => recheck(data.order_id)} className="underline hover:text-ink">Re-check</button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// Dispute shield: paid orders waiting to ship, each checked by the agent for dispute
// risk before the seller ships it, using the buyer's dispute history with the shop.
export default function ShieldPanel({ viewOnly, empty = null }: { viewOnly: boolean; empty?: React.ReactNode }) {
  const phone = usePhone();
  const phoneCols = useMemo(() => forPhone(COLS, phone, ["invoice_id", "ship_to", "amount", "headline"], ["risk"]), [phone]);
  const [orders, setOrders] = useState<ShieldRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const grid = useRef<AgGridReact<ShieldGridRow>>(null);
  // The chevrons read `open` from the grid context, so redraw them when it changes.
  useEffect(() => {
    grid.current?.api?.refreshCells({ columns: ["expand"], force: true });
  }, [open]);

  // The "Refunded" / "Signature required" chip sits in a cell whose value doesn't change,
  // so redraw that column when an order's decision does.
  const decided = (orders ?? []).map((o) => `${o.order_id}:${o.decision?.action ?? ""}`).join("|");
  useEffect(() => {
    grid.current?.api?.refreshCells({ columns: ["headline"], force: true });
  }, [decided]);

  const load = useCallback(async () => {
    const res = await fetch("/api/orders", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    setError(null);
    setOrders(json.orders);
  }, []);

  const checking = orders?.some((o) => o.status === "CHECKING") ?? true;
  useEffect(() => {
    load();
    // Another panel acted on an order (a buyer request refunded it, Judge mode, or a
    // simulated payment arrived).
    window.addEventListener("countermove:refresh", load);
    return () => window.removeEventListener("countermove:refresh", load);
  }, [load]);
  useEffect(() => {
    if (!checking) return;
    const t = setInterval(load, 1200);
    return () => clearInterval(t);
  }, [checking, load]);

  async function recheck(id: string) {
    setOrders((os) => os?.map((o) => (o.order_id === id ? { ...o, status: "CHECKING", trace: [] } : o)) ?? null);
    const res = await fetch(`/api/orders/${id}/check`, { method: "POST" });
    if (!res.ok) setError((await res.json()).error);
    load();
  }

  // One action on a paid order (POST /api/orders/{invoice}/action). Returns the error
  // to show under the buttons, or null when it worked.
  async function act(invoiceId: string, action: Action): Promise<string | null> {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(invoiceId)}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const json = (await res.json().catch(() => ({}))) as { order?: ShieldRow; error?: string };
      if (!res.ok || !json.order) return json.error ?? "That didn't go through. Try again.";
      const updated = json.order;
      setOrders((os) => os?.map((o) => (o.order_id === updated.order_id ? updated : o)) ?? null);
      return null;
    } catch {
      return "Couldn't reach the server. Try again.";
    }
  }

  if (!orders) return null;
  if (!orders.length) return <>{empty}</>;
  // Flagged MEDIUM or HIGH and not acted on yet.
  const flagged = orders.filter((o) => o.to_review ?? (o.verdict && o.verdict.risk !== "LOW" && !o.decision));
  const held = flagged.reduce((n, o) => n + Number(o.amount), 0);
  const rows: ShieldGridRow[] = orders.flatMap((o) => (open === o.order_id && o.verdict ? [o, { ...o, detail: true as const }] : [o]));

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Dispute shield: paid orders, not shipped yet</h2>
          <p className="text-xs text-muted">Before you ship, the agent checks each PayPal order for dispute risk, including every dispute this buyer has filed with you before. Click a flagged order and take one action: refund it, require a signature, or ship to the PayPal address only.</p>
        </div>
        {flagged.length ? (
          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ color: "var(--danger)", border: "1px solid currentColor" }}>
            {flagged.length} to review before shipping (${held.toFixed(0)})
          </span>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}

      <div className="mt-3">
        <AgGridReact<ShieldGridRow>
          ref={grid}
          theme={gridTheme}
          rowData={rows}
          columnDefs={phoneCols}
          context={{ open, recheck, act, viewOnly }}
          domLayout="autoHeight"
          getRowId={(p) => `${p.data.order_id}${p.data.detail ? ":detail" : ""}`}
          isFullWidthRow={(p) => Boolean(p.rowNode.data?.detail)}
          fullWidthCellRenderer={ShieldDetail}
          getRowHeight={(p) => (p.data?.detail ? Math.max(216, 100 + 30 * (p.data.verdict?.signals.length ?? 0)) + (p.data.decision || p.data.verdict?.risk !== "LOW" ? 72 : 0) : 64)}
          // Highest risk first; a detail row sorts with its order and stays right under it.
          postSortRows={(p) => {
            const ordered = p.nodes.filter((n) => !n.data?.detail).flatMap((n) => {
              const d = p.nodes.find((x) => x.data?.detail && x.data.order_id === n.data?.order_id);
              return d ? [n, d] : [n];
            });
            p.nodes.splice(0, p.nodes.length, ...ordered);
          }}
          onRowClicked={(e) => e.data && !e.data.detail && e.data.verdict && setOpen(open === e.data.order_id ? null : e.data.order_id)}
          getRowClass={(p) => (p.data?.detail ? undefined : "cursor-pointer")}
          defaultColDef={{ cellStyle: { display: "flex", alignItems: "center" }, sortable: true }}
          suppressCellFocus
        />
      </div>
    </section>
  );
}

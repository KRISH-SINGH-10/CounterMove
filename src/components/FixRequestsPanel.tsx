"use client";

import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FixRequest } from "@/lib/fixfirst";
import { money } from "./format";
import { gridTheme } from "./grid";
import { forPhone, usePhone } from "./phone";
import { Badge, BUTTON, Card } from "./ui";

// Buyer requests from the "fix it first" page. The seller answers each in one click, so
// the buyer has no reason to open a PayPal dispute.

// Tells the dispute shield (and anything else on the page) to reload after an action.
export const REFRESH_EVENT = "countermove:refresh";

const KIND_LABEL: Record<FixRequest["kind"], string> = { WHERE: "Where is my order?", PROBLEM: "Something is wrong", CANCEL: "Cancel and refund" };
// Paid orders in the demo that haven't shipped: these can be refunded through PayPal.
const UNSHIPPED = /^JK-10(88|90|93)$/;

type Ctx = { busy: string | null; resolve: (r: FixRequest, how: "REFUND" | "REPLACEMENT") => void; viewOnly: boolean };

function AskCell({ data }: ICellRendererParams<FixRequest>) {
  if (!data) return null;
  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5 py-2 leading-snug">
      <span className="font-medium">{data.buyer}: {KIND_LABEL[data.kind]}</span>
      <span className="whitespace-normal text-xs text-muted">{data.item} · {money(data.amount)}{data.note ? ` · “${data.note}”` : ""}</span>
    </div>
  );
}

function AnswerCell({ data, context }: ICellRendererParams<FixRequest>) {
  if (!data) return null;
  const { busy, resolve, viewOnly } = context as Ctx;
  if (data.status === "ANSWERED") {
    return (
      <div className="flex w-full min-w-0 flex-col gap-0.5 py-2 leading-snug">
        <span className="text-xs font-semibold" style={{ color: "var(--fight)" }}>✓ {data.answered_by === "auto" ? "Answered at once from your shipping records" : "Answered by you"}</span>
        <span className="whitespace-normal text-xs text-muted">{data.answer}</span>
      </div>
    );
  }
  if (viewOnly) return <span className="text-xs text-muted">Waiting for the shop</span>;
  const canRefund = UNSHIPPED.test(data.invoice_id);
  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <button disabled={busy !== null} onClick={() => resolve(data, "REFUND")} className={`${data.wants === "REFUND" ? BUTTON.primary : BUTTON.secondary} !py-1 text-xs`}>
        {busy === data.id ? "Working…" : canRefund ? "Refund through PayPal" : "Agree to refund"}
      </button>
      <button disabled={busy !== null} onClick={() => resolve(data, "REPLACEMENT")} className={`${data.wants === "REPLACEMENT" ? BUTTON.primary : BUTTON.secondary} !py-1 text-xs`}>Send a replacement</button>
    </div>
  );
}

const COLS: ColDef<FixRequest>[] = [
  { field: "invoice_id", headerName: "Order", width: 92, cellClass: "text-muted tabular" },
  { colId: "ask", headerName: "Buyer asked", flex: 1.4, minWidth: 220, valueGetter: (p) => `${p.data?.buyer} ${p.data?.note}`, cellRenderer: AskCell, autoHeight: true },
  { colId: "status", headerName: "Status", width: 110, valueGetter: (p) => p.data?.status, cellRenderer: (p: ICellRendererParams<FixRequest>) => <Badge tone={p.value === "OPEN" ? "warn" : "good"}>{p.value === "OPEN" ? "Open" : "Answered"}</Badge>, sort: "desc", enableCellChangeFlash: true },
  { colId: "answer", headerName: "Your answer", flex: 1.6, minWidth: 260, valueGetter: (p) => p.data?.answer ?? "", cellRenderer: AnswerCell, autoHeight: true, sortable: false },
];

export default function FixRequestsPanel({ viewOnly }: { viewOnly: boolean }) {
  const [requests, setRequests] = useState<FixRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const phone = usePhone();
  const cols = useMemo(() => forPhone(COLS, phone, ["invoice_id", "status"], ["answer"]), [phone]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/fix", { cache: "no-store" });
      if (res.ok) setRequests((await res.json()).requests ?? []);
    } catch {
      // Keep what is on screen; the next poll tries again.
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 5000);
    window.addEventListener(REFRESH_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(REFRESH_EVENT, load);
    };
  }, [load]);

  // Agree to what the buyer asked for. An unshipped order is refunded through PayPal
  // first (the same action as the dispute shield's "Refund now"); then the buyer is told.
  async function resolve(r: FixRequest, how: "REFUND" | "REPLACEMENT") {
    setBusy(r.id);
    setError(null);
    try {
      let answer = how === "REPLACEMENT" ? "A replacement is on its way, at no cost to you. You'll get the tracking number by email." : `We've agreed to refund ${money(r.amount)}. It goes back through PayPal to the way you paid within 24 hours.`;
      if (how === "REFUND" && UNSHIPPED.test(r.invoice_id)) {
        const res = await fetch(`/api/orders/${encodeURIComponent(r.invoice_id)}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "REFUND" }) });
        const json = await res.json().catch(() => ({}));
        // 409: the order was already refunded from the dispute shield, which is fine.
        if (!res.ok && res.status !== 409) return setError(json.error ?? "PayPal didn't take the refund. Try again.");
        answer = `Your order is cancelled and ${money(r.amount)} has been refunded through PayPal to the way you paid.`;
      }
      const res = await fetch(`/api/fix/${encodeURIComponent(r.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setError(json.error ?? "That didn't go through. Try again.");
      await load();
      window.dispatchEvent(new Event(REFRESH_EVENT));
    } finally {
      setBusy(null);
    }
  }

  const open = requests.filter((r) => r.status === "OPEN").length;
  return (
    <Card
      title="Fix it first: buyer requests"
      subtitle="Each order email links a help page where the buyer gets tracking, a refund or a replacement from you, instead of opening a PayPal dispute. Tracking questions are answered at once from your shipping records."
      right={open ? <Badge tone="warn">{open} waiting for you</Badge> : undefined}
    >
      <p className="mb-3 text-sm">
        Try the buyer&apos;s page:{" "}
        {[["JK-1063", "an untracked care kit"], ["JK-1057", "a dented pair"], ["JK-1090", "an order not shipped yet"]].map(([id, what], i) => (
          <span key={id}>
            {i ? " · " : ""}
            <Link href={`/fix/${id}`} className="text-accent underline">{what} ({id})</Link>
          </span>
        ))}
      </p>
      {error ? <p className="mb-2 text-xs text-danger">{error}</p> : null}
      {requests.length ? (
        <div data-judge="fix">
        <AgGridReact<FixRequest>
          theme={gridTheme}
          rowData={requests}
          columnDefs={cols}
          context={{ busy, resolve, viewOnly } satisfies Ctx}
          domLayout="autoHeight"
          getRowId={(p) => p.data.id}
          defaultColDef={{ cellStyle: { display: "flex", alignItems: "center" }, sortable: true }}
          suppressCellFocus
        />
        </div>
      ) : (
        <p className="text-sm text-muted">No requests yet. Open one of the buyer pages above and ask for help to see it land here.</p>
      )}
    </Card>
  );
}

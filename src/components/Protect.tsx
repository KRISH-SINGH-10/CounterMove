"use client";

import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { forPhone, usePhone } from "./phone";
import { useEffect, useMemo, useState } from "react";
import type { ShieldRow } from "@/lib/shield";
import { useCases } from "./CasesProvider";
import { money, REASON_LABEL } from "./format";
import { gridTheme } from "./grid";
import FixRequestsPanel from "./FixRequestsPanel";
import Link from "next/link";
import NetworkPanel, { type NetworkSummary } from "./NetworkPanel";
import WelcomeTour from "./WelcomeTour";
import ShieldPanel from "./ShieldPanel";
import { Badge, Card, Empty, Kpi } from "./ui";

type Buyer = { email: string; name: string; disputes: number; disputed: number; open: number; claims: string; lastOutcome: string; pendingOrder: string | null };

function OrderCell({ data }: ICellRendererParams<Buyer>) {
  return data?.pendingOrder ? <Badge tone="bad" title="This buyer has a paid order waiting to ship. See the dispute shield above.">Ordered again: {data.pendingOrder}</Badge> : <span className="text-sm text-muted">None</span>;
}

const COLS: ColDef<Buyer>[] = [
  { field: "name", headerName: "Buyer", flex: 1, minWidth: 150 },
  { field: "email", headerName: "PayPal email", flex: 1.1, minWidth: 180, cellClass: "text-muted" },
  { field: "disputes", headerName: "Disputes", width: 130, type: "rightAligned", sort: "desc", sortIndex: 1, filter: "agNumberColumnFilter" },
  { field: "disputed", headerName: "Disputed", width: 120, type: "rightAligned", valueFormatter: (p) => money(p.value), cellClass: "tabular" },
  { field: "claims", headerName: "Claims", flex: 1, minWidth: 140 },
  { field: "lastOutcome", headerName: "Latest result", width: 140 },
  { field: "pendingOrder", headerName: "Open orders", flex: 1.2, minWidth: 220, cellRenderer: OrderCell, sort: "asc", sortIndex: 0, comparator: (a, b) => (a ? 0 : 1) - (b ? 0 : 1) },
];

// Before you ship: the dispute shield, and the buyers Countermove remembers from past disputes.
export default function Protect() {
  const phone = usePhone();
  const phoneCols = useMemo(() => forPhone(COLS, phone, ["email", "disputes", "disputed", "claims", "lastOutcome"], ["pendingOrder"]), [phone]);
  const { data } = useCases();
  const [orders, setOrders] = useState<ShieldRow[]>([]);
  const [net, setNet] = useState<NetworkSummary | null>(null);
  const toReview = orders.filter((o) => o.to_review).length;

  useEffect(() => {
    if (!data?.mode) return;
    const load = () => fetch("/api/orders", { cache: "no-store" }).then((r) => r.json()).then((j) => setOrders(j.orders ?? [])).catch(() => {});
    load();
    window.addEventListener("countermove:refresh", load);
    return () => window.removeEventListener("countermove:refresh", load);
  }, [data?.mode]);

  // Dispute memory: every buyer who has disputed with the shop, and whether they're ordering again.
  const buyers = useMemo<Buyer[]>(() => {
    const map = new Map<string, Buyer>();
    for (const c of data?.cases ?? []) {
      const b = c.dispute.disputed_transactions[0]?.buyer;
      const email = b?.email?.toLowerCase();
      if (!email) continue;
      const row = map.get(email) ?? { email, name: b?.name ?? email, disputes: 0, disputed: 0, open: 0, claims: "", lastOutcome: "Open", pendingOrder: null };
      row.disputes++;
      row.disputed += Number(c.dispute.dispute_amount.value);
      if (!c.outcome) row.open++;
      row.claims = [...new Set([...row.claims.split(", ").filter(Boolean), REASON_LABEL[c.dispute.reason]])].join(", ");
      row.lastOutcome = c.outcome ? c.outcome.result.charAt(0) + c.outcome.result.slice(1).toLowerCase() : "Open";
      row.pendingOrder = orders.find((o) => o.buyer === row.name)?.invoice_id ?? null;
      map.set(email, row);
    }
    return [...map.values()];
  }, [data, orders]);

  return (
    <div className="space-y-5">
      <WelcomeTour />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Stop scammers before you ship.</h1>
        <p className="mt-1 text-sm text-muted">Countermove is the seller trust network for PayPal: sellers share proof when a buyer is caught lying, every paid order is checked against it before it ships, and the disputes that still happen are settled without a fight.</p>
      </div>

      {/* The network and the money it protected come first. */}
      <section className="rounded-lg border p-4" style={{ borderColor: net?.ordering ? "var(--danger)" : "var(--accent)", background: net?.ordering ? "color-mix(in srgb, var(--danger) 7%, var(--panel))" : "var(--accent-soft)" }} data-testid="trust-banner">
        <div className="grid gap-4 md:grid-cols-[1.6fr_1fr_1fr] md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: net?.ordering ? "var(--danger)" : "var(--accent)" }}>Seller trust network</p>
            <p className="mt-1 text-lg font-semibold leading-snug">
              {net === null
                ? "Checking the network…"
                : net.ordering
                  ? `${net.ordering} buyer${net.ordering === 1 ? "" : "s"} other sellers caught ${net.ordering === 1 ? "is" : "are"} ordering from you right now.`
                  : "No reported buyer is ordering from you right now."}
            </p>
            <p className="mt-1 text-sm text-muted">{net ? `${net.reports} proven reports from ${net.shops} shops. You shared ${net.shared}.` : " "}{toReview ? ` ${toReview} paid order${toReview === 1 ? "" : "s"} to review before shipping.` : ""}</p>
          </div>
          <Kpi label="Money protected" value={data?.stats ? money(data.stats.kept) : "-"} tone="good" sub={data?.stats?.rulings ? `Won ${data.stats.won} of ${data.stats.rulings} PayPal rulings` : "Kept from disputes"} />
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Open disputes</div>
            <div className="mt-1 text-2xl font-semibold tabular">{data?.stats ? money(data.stats.at_risk) : "-"}</div>
            <Link href="/disputes" className="text-xs text-accent underline">{data?.stats ? `${data.stats.open} open · settle the rest` : "Open Disputes"}</Link>
          </div>
        </div>
      </section>

      <NetworkPanel mode={data?.mode} onSummary={setNet} />

      <ShieldPanel
        key={`${data?.mode}:${data?.cases.length ? "on" : "reset"}`}
        viewOnly={Boolean(data?.viewOnly)}
        empty={
          <Card title="Dispute shield" subtitle="Checks paid orders for dispute risk before you ship.">
            <Empty title="No paid orders waiting to ship">Each order is checked as PayPal&apos;s PAYMENT.CAPTURE.COMPLETED webhook arrives. Pay for a sandbox order to see it land here.</Empty>
          </Card>
        }
      />

      {data?.mode === "mock" ? <FixRequestsPanel viewOnly={Boolean(data.viewOnly)} /> : null}

      <Card title="Dispute memory" subtitle="Buyers who have disputed with you. The shield and the investigator both read this history.">
        {buyers.length ? (
          <AgGridReact<Buyer>
            theme={gridTheme}
            rowData={buyers}
            columnDefs={phoneCols}
            domLayout="autoHeight"
            rowHeight={48}
            pagination
            paginationPageSize={10}
            paginationPageSizeSelector={phone ? false : [10, 25, 50]}
            getRowId={(p) => p.data.email}
            defaultColDef={{ cellStyle: { display: "flex", alignItems: "center" }, sortable: true }}
            suppressCellFocus
          />
        ) : (
          <Empty title="No buyers to remember yet">Every buyer who disputes with you will be listed here, so the shield and the investigator can read their history.</Empty>
        )}
      </Card>
    </div>
  );
}

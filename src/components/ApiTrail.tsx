"use client";

import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { gridTheme } from "./grid";
import { forPhone, usePhone } from "./phone";
import { Empty } from "./ui";

// The PayPal API trail: every PayPal call the agent, autopilot, the seller's approvals
// and the server made (GET /api/trail), newest first. On a dispute page it lists that
// dispute's calls; on Insights, the whole session's.

type Call = {
  at: string;
  method: string;
  endpoint: string;
  status: number;
  debug_id: string | null;
  via: "simulator" | "rest" | "agent_toolkit";
  by: "agent" | "seller" | "autopilot" | "system";
  case_id: string | null;
  summary: string;
  uid?: string;
};

const BY_LABEL: Record<Call["by"], string> = { agent: "AI agent", seller: "You", autopilot: "Autopilot", system: "Server" };
const VIA_LABEL: Record<Call["via"], string> = { simulator: "Simulator", rest: "PayPal REST API", agent_toolkit: "PayPal Agent Toolkit" };

function CallCell({ data }: ICellRendererParams<Call>) {
  if (!data) return null;
  return (
    <div className="flex w-full min-w-0 flex-col justify-center leading-tight">
      <span className="truncate text-sm">{data.summary}</span>
      <span className="block w-0 min-w-full truncate font-mono text-xs text-muted" title={`${data.method} ${data.endpoint}`}>
        <span className="font-semibold">{data.method}</span> {data.endpoint}
      </span>
    </div>
  );
}

function StatusCell({ value }: ICellRendererParams<Call, number>) {
  if (value == null) return null;
  const ok = value >= 200 && value < 300;
  return (
    <span className="rounded px-1.5 py-0.5 font-mono text-xs font-semibold" style={{ color: ok ? "var(--fight)" : "var(--danger)", border: "1px solid currentColor" }}>
      {value === 0 ? "no answer" : value}
    </span>
  );
}

function ViaCell({ data }: ICellRendererParams<Call>) {
  if (!data) return null;
  const live = data.via !== "simulator";
  return (
    <span className="rounded px-1.5 py-0.5 text-xs" style={{ background: live ? "var(--accent-soft)" : "var(--bg)", color: live ? "var(--accent)" : "var(--muted)" }}>
      {VIA_LABEL[data.via]}
    </span>
  );
}

// A fixed locale and 24-hour clock, so the server and the browser print the same text.
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const COLS: ColDef<Call>[] = [
  { field: "at", headerName: "Time", width: 96, valueFormatter: (p) => (p.value ? clock(p.value) : ""), cellClass: "tabular text-muted", sort: "desc" },
  { colId: "call", headerName: "PayPal call", flex: 2.4, minWidth: 220, valueGetter: (p) => `${p.data?.method} ${p.data?.endpoint}`, cellRenderer: CallCell, filter: "agTextColumnFilter" },
  { field: "status", headerName: "Status", width: 92, cellRenderer: StatusCell, filter: "agNumberColumnFilter" },
  { field: "debug_id", headerName: "PayPal-Debug-Id", width: 150, cellClass: "font-mono text-xs text-muted", valueFormatter: (p) => p.value ?? "" },
  { field: "by", headerName: "Made by", width: 104, valueFormatter: (p) => BY_LABEL[p.value as Call["by"]] ?? "", filter: "agTextColumnFilter", filterValueGetter: (p) => (p.data ? BY_LABEL[p.data.by] : "") },
  { colId: "via", headerName: "Through", width: 172, valueGetter: (p) => (p.data ? VIA_LABEL[p.data.via] : ""), cellRenderer: ViaCell },
];

export default function ApiTrail({ caseId, refreshKey, pageSize = 8 }: { caseId?: string; refreshKey?: string | number; pageSize?: number }) {
  const [calls, setCalls] = useState<Call[] | null>(null);
  const phone = usePhone();
  const cols = useMemo(() => forPhone(COLS, phone, ["at", "debug_id", "by", "via"], ["status"]), [phone]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trail${caseId ? `?case=${encodeURIComponent(caseId)}` : ""}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { calls?: Call[] };
      setCalls((cur) => {
        const next = json.calls ?? [];
        // Keep the same array when nothing changed, so the grid doesn't redraw every poll.
        return cur && cur.length === next.length && cur[0]?.at === next[0]?.at ? cur : next;
      });
    } catch {
      // Keep what is on screen; the next poll tries again.
    }
  }, [caseId]);

  // Refresh right after an action on the page (refreshKey changes), then every 5 seconds
  // while the tab is visible.
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 5000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  if (!calls) return <p className="text-sm text-muted">Loading the trail…</p>;
  if (!calls.length) return <Empty title="No PayPal calls yet">Investigate or answer a dispute to see every API call the agent makes.</Empty>;

  // Two identical calls in the same millisecond still need their own row id.
  const seen = new Map<string, number>();
  const rows = calls.map((c) => {
    const key = `${c.at}|${c.method}|${c.endpoint}|${c.status}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return { ...c, uid: n ? `${key}|${n}` : key };
  });
  const writes = calls.filter((c) => c.method !== "GET").length;
  const failed = calls.filter((c) => c.status < 200 || c.status >= 300).length;
  return (
    <div data-testid="api-trail">
      <p className="mb-2 text-xs text-muted">
        {calls.length} call{calls.length === 1 ? "" : "s"}: {calls.length - writes} read{calls.length - writes === 1 ? "" : "s"}, {writes} write{writes === 1 ? "" : "s"}
        {failed ? <>, <span style={{ color: "var(--danger)" }}>{failed} failed</span> (each retry is its own row)</> : null}.
      </p>
      <AgGridReact<Call>
        theme={gridTheme}
        rowData={rows}
        columnDefs={cols}
        domLayout="autoHeight"
        rowHeight={52}
        getRowId={(p) => p.data.uid ?? p.data.at}
        pagination={calls.length > pageSize}
        paginationPageSize={pageSize}
        paginationPageSizeSelector={false}
        tooltipShowDelay={400}
        defaultColDef={{ cellStyle: { display: "flex", alignItems: "center" }, sortable: true }}
        suppressCellFocus
      />
    </div>
  );
}

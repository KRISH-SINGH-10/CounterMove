"use client";

import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { diagnose, forecastReserve, type Finding, type ReserveRow } from "@/lib/insights";
import type { CaseRecord } from "@/lib/types";
import { useCases } from "./CasesProvider";
import { money, REASON_LABEL } from "./format";
import { gridTheme } from "./grid";
import { forPhone, usePhone } from "./phone";
import { BUTTON, Card, Empty, Kpi } from "./ui";

// "After the dispute": what to set aside for the next 30 days (Dispute Reserve) and what
// to change so fewer disputes happen (Dispute Doctor). Both are worked out in the browser
// from the shop's own cases with fixed arithmetic and rules (src/lib/insights.ts).

const RESERVE_COLS: ColDef<ReserveRow>[] = [
  { field: "buyer", headerName: "Open dispute", flex: 1.2, minWidth: 140 },
  { colId: "claim", headerName: "Claim", flex: 1, minWidth: 120, valueGetter: (p) => (p.data ? REASON_LABEL[p.data.reason] : "") },
  { field: "amount", headerName: "Disputed", width: 110, type: "rightAligned", valueFormatter: (p) => money(p.value ?? 0), cellClass: "tabular" },
  { field: "loss_share", headerName: "Chance of loss", width: 130, type: "rightAligned", valueFormatter: (p) => `${Math.round((p.value ?? 0) * 100)}%`, cellClass: "tabular" },
  { field: "basis", headerName: "Based on", flex: 1.4, minWidth: 180, cellClass: "text-muted" },
  { field: "expected_loss", headerName: "Set aside", width: 110, type: "rightAligned", valueFormatter: (p) => money(p.value ?? 0), cellClass: "tabular font-medium", sort: "desc" },
];

export function ReservePanel({ cases }: { cases: CaseRecord[] }) {
  const router = useRouter();
  const phone = usePhone();
  const r = useMemo(() => forecastReserve(cases), [cases]);
  const cols = useMemo(() => forPhone(RESERVE_COLS, phone, ["claim", "amount", "loss_share", "basis"], ["expected_loss"]), [phone]);
  return (
    <Card title="Dispute Reserve: money at risk in the next 30 days" subtitle="What to keep in your PayPal balance so a refund never bounces. Worked out from your open disputes and your own results over the last 90 days: averages, not promises.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Set aside" value={money(r.reserve)} tone={r.reserve > 0 ? "warn" : "good"} sub="For the next 30 days" />
        <Kpi label="From open disputes" value={money(r.open_expected)} sub={`${r.open.length} open now`} />
        <Kpi label="From new disputes" value={money(r.new_expected)} sub={`About ${r.new_count} expected`} />
        <Kpi label="Your loss rate" value={`${Math.round(r.loss_share * 100)}%`} sub="Of disputed money refunded" />
      </div>
      {r.open.length ? (
        <div className="mt-3">
          <AgGridReact<ReserveRow>
            theme={gridTheme}
            rowData={r.open}
            columnDefs={cols}
            domLayout="autoHeight"
            rowHeight={44}
            getRowId={(p) => p.data.id}
            onRowClicked={(e) => e.data && router.push(`/cases/${e.data.id}`)}
            getRowClass={() => "cursor-pointer"}
            defaultColDef={{ cellStyle: { display: "flex", alignItems: "center" }, sortable: true }}
            suppressCellFocus
          />
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">No open disputes right now, so the reserve covers only the new ones your history says to expect.</p>
      )}
    </Card>
  );
}

type DoctorCtx = { apply: (f: Finding) => void; done: Record<string, string>; viewOnly: boolean };

function CauseCell({ data }: ICellRendererParams<Finding>) {
  if (!data) return null;
  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5 py-2 leading-snug">
      <span className="font-medium">{data.cause}</span>
      <span className="whitespace-normal text-xs text-muted">{data.evidence}</span>
    </div>
  );
}

function FixCell({ data, context }: ICellRendererParams<Finding>) {
  if (!data) return null;
  const { apply, done, viewOnly } = context as DoctorCtx;
  const state = done[data.id];
  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-1.5 py-2 leading-snug">
      <span className="whitespace-normal text-sm">{data.fix}</span>
      {state ? (
        <span className="text-xs font-medium" style={{ color: state.startsWith("!") ? "var(--danger)" : "var(--fight)" }}>{state.startsWith("!") ? state.slice(1) : `✓ ${state}`}</span>
      ) : data.action.kind === "rule" && viewOnly ? null : (
        <button onClick={() => apply(data)} className={`${BUTTON.secondary} !py-1 text-xs`}>{data.action.label}</button>
      )}
    </div>
  );
}

const DOCTOR_COLS: ColDef<Finding>[] = [
  { colId: "cause", headerName: "Why disputes happen", flex: 1.5, minWidth: 220, valueGetter: (p) => p.data?.cause, cellRenderer: CauseCell, autoHeight: true },
  { field: "disputes", headerName: "Disputes", width: 100, type: "rightAligned", cellClass: "tabular" },
  { field: "lost", headerName: "Refunded", width: 110, type: "rightAligned", valueFormatter: (p) => money(p.value ?? 0), cellClass: "tabular font-medium", sort: "desc" },
  { colId: "fix", headerName: "The fix", flex: 1.6, minWidth: 240, valueGetter: (p) => p.data?.fix, cellRenderer: FixCell, autoHeight: true, sortable: false },
];

export function DoctorPanel({ cases }: { cases: CaseRecord[] }) {
  const { rules, setRules, data } = useCases();
  const phone = usePhone();
  const [done, setDone] = useState<Record<string, string>>({});
  const findings = useMemo(() => diagnose(cases, rules), [cases, rules]);
  const cols = useMemo(() => forPhone(DOCTOR_COLS, phone, ["disputes", "lost"], ["fix"]), [phone]);
  const mark = (id: string, text: string) => setDone((d) => ({ ...d, [id]: text }));

  async function apply(f: Finding) {
    if (f.action.kind === "copy") {
      try {
        await navigator.clipboard.writeText(f.action.text);
        mark(f.id, "Copied. Paste it into your listing or shop policy.");
      } catch {
        mark(f.id, `!Couldn't copy. The text: ${f.action.text}`);
      }
      return;
    }
    if (!rules) return;
    const res = await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...rules, ...f.action.patch }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return mark(f.id, `!${json.error ?? "Couldn't change the rule."}`);
    setRules(json);
    mark(f.id, "Autopilot rule changed.");
  }

  const total = findings.reduce((s, f) => s + f.lost, 0);
  return (
    <Card
      title="Dispute Doctor: fix the causes"
      subtitle={findings.length ? `${findings.length} cause${findings.length === 1 ? "" : "s"} behind ${money(total)} of refunds, found in your own dispute history by fixed rules. Each has one fix you can apply now.` : "Looks for repeated causes in your dispute history and proposes one fix for each."}
    >
      {findings.length ? (
        <AgGridReact<Finding>
          theme={gridTheme}
          rowData={findings}
          columnDefs={cols}
          context={{ apply, done, viewOnly: Boolean(data?.viewOnly) } satisfies DoctorCtx}
          domLayout="autoHeight"
          getRowId={(p) => p.data.id}
          defaultColDef={{ cellStyle: { display: "flex", alignItems: "center" }, sortable: true }}
          suppressCellFocus
        />
      ) : (
        <Empty title="No repeated causes yet">Once a few disputes have closed, the causes behind them and a fix for each show up here.</Empty>
      )}
    </Card>
  );
}

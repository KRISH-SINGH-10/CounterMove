"use client";

import type { ColDef, IServerSideDatasource } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo, useState } from "react";
import { money } from "./format";
import { gridTheme } from "./grid";
import { BUTTON, Card } from "./ui";

// 1,000,000 simulated disputes behind AG Grid Enterprise's server-side row model: the
// grid asks POST /api/scale/rows for one block at a time with its sort, filters and
// grouping, and the server answers from Postgres (or memory when there is no database).

type Row = { id: number; buyer: string; claim: string; amount: number; decision: string; by: string; result: string; kept: number; refunded: number; closed: string };
type Last = { ms: number; source: string; rows: number; total: number };

const TEXT = { filter: "agTextColumnFilter", filterParams: { maxNumConditions: 1, buttons: ["reset"] } };
const NUM = { filter: "agNumberColumnFilter", filterParams: { maxNumConditions: 1, buttons: ["reset"] } };

const COLS: ColDef<Row>[] = [
  { field: "id", headerName: "#", width: 110, ...NUM },
  { field: "buyer", headerName: "Buyer", flex: 1, minWidth: 140, ...TEXT },
  { field: "claim", headerName: "Claim", flex: 1, minWidth: 150, enableRowGroup: true, initialRowGroup: true, initialHide: true, ...TEXT },
  { field: "amount", headerName: "Amount", width: 140, type: "rightAligned", aggFunc: "sum", valueFormatter: (p) => (p.value == null ? "" : money(p.value)), ...NUM },
  { field: "decision", headerName: "Decision", width: 140, enableRowGroup: true, ...TEXT },
  { field: "by", headerName: "Answered by", width: 130, enableRowGroup: true, ...TEXT },
  { field: "result", headerName: "Result", width: 120, enableRowGroup: true, ...TEXT },
  { field: "kept", headerName: "Kept", width: 130, type: "rightAligned", aggFunc: "sum", valueFormatter: (p) => (p.value == null ? "" : money(p.value)), ...NUM },
  { field: "refunded", headerName: "Refunded", width: 130, type: "rightAligned", aggFunc: "sum", valueFormatter: (p) => (p.value == null ? "" : money(p.value)), ...NUM },
  { field: "closed", headerName: "Closed", width: 130, filter: "agDateColumnFilter", filterParams: { maxNumConditions: 1, buttons: ["reset"] } },
];

// Stable objects: the grid re-reads them when their identity changes, so inline literals
// re-applied the default Claim grouping after each block loaded.
const AUTO_GROUP = { headerName: "Group", minWidth: 220, sortable: true };
const DEFAULT_COL = { sortable: true, resizable: true, cellStyle: { display: "flex", alignItems: "center" } };
const childCount = (d: { childCount?: number }) => d?.childCount ?? 0;

export default function MillionTest() {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<Last | null>(null);

  const datasource = useMemo<IServerSideDatasource<Row>>(
    () => ({
      getRows: async (params) => {
        try {
          const res = await fetch("/api/scale/rows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params.request) });
          const json = await res.json();
          if (!res.ok) return params.fail();
          params.success({ rowData: json.rows, rowCount: json.lastRow });
          setLast({ ms: json.ms, source: json.source, rows: json.rows.length, total: json.lastRow });
        } catch {
          params.fail();
        }
      },
    }),
    [],
  );

  return (
    <Card
      title="Scale check: 1,000,000 disputes, server-side"
      subtitle="Simulated disputes (fixed seed, not your shop's data) behind AG Grid's server-side row model. Sorting, filtering and grouping run on the server; only the rows on screen reach your browser."
      right={<button className={BUTTON.secondary} onClick={() => { setOpen((o) => !o); setLast(null); }}>{open ? "Close" : "Open 1,000,000 disputes"}</button>}
    >
      {open ? (
        <>
          <p className="mb-3 text-sm tabular" aria-live="polite">
            {last ? (
              <>
                Last block: <b>{last.rows} rows</b> of <b>{last.total.toLocaleString("en-US")}</b> in <b>{last.ms} ms</b> on the server, from{" "}
                <b>{last.source === "postgres" ? "Postgres" : "the in-memory store"}</b>. Try a filter, a sort, or drag a column into the group bar.
              </>
            ) : (
              "Loading the first block…"
            )}
          </p>
          <div style={{ height: 480 }} data-testid="million-grid">
            <AgGridReact<Row>
              theme={gridTheme}
              rowModelType="serverSide"
              serverSideDatasource={datasource}
              columnDefs={COLS}
              cacheBlockSize={100}
              maxBlocksInCache={20}
              rowGroupPanelShow="always"
              autoGroupColumnDef={AUTO_GROUP}
              suppressAggFuncInHeader
              getChildCount={childCount}
              defaultColDef={DEFAULT_COL}
              suppressCellFocus
            />
          </div>
        </>
      ) : null}
    </Card>
  );
}

"use client";

import type { ColumnState, GridApi } from "ag-grid-community";
import { useRef, useState } from "react";
import { BUTTON } from "./ui";

// "Ask the grid": the seller types a question in plain English, POST /api/grid-ask turns
// it into AG Grid filters, a sort and (Enterprise) row grouping, and this applies them to
// the grid. The answer is ordinary grid state, so the seller can keep adjusting it by hand.

type AskFilter = { filterType: "text" | "number" | "date"; type: string; filter?: string | number; filterTo?: number; dateFrom?: string; dateTo?: string };
type Answer = {
  filterModel: Record<string, AskFilter>;
  sort: Array<{ colId: string; sort: "asc" | "desc" }>;
  rowGroup: string[];
  explanation: string;
  replayed?: boolean;
};

type Props<T> = {
  grid: "disputes" | "outcomes";
  // The grid's API, read when a question is asked (the grid can remount).
  api: () => GridApi<T> | undefined | null;
  examples: string[];
  // Row grouping needs AG Grid Enterprise.
  enterprise?: boolean;
  placeholder?: string;
};

// A column using the Enterprise set filter takes a list of values instead of a text model.
function forColumn<T>(api: GridApi<T>, colId: string, f: AskFilter): unknown {
  const kind = api.getColumnDef(colId)?.filter;
  if (kind === "agSetColumnFilter" && f.filterType === "text") return { filterType: "set", values: [String(f.filter ?? "")] };
  return f;
}

export default function GridAsk<T>({ grid, api, examples, enterprise, placeholder }: Props<T>) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: "ok" | "error"; replayed?: boolean } | null>(null);
  // The grid as the seller had it before the first answer, so Clear puts it back.
  const before = useRef<{ columns: ColumnState[]; filters: Record<string, unknown> } | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    const g = api();
    if (!text || !g || busy) return;
    setQuestion(text);
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/grid-ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grid, question: text }) });
      const json = (await res.json().catch(() => ({}))) as Partial<Answer> & { error?: string };
      if (!res.ok) return setNote({ text: json.error ?? "The AI couldn't answer that. Try one of the examples.", tone: "error" });
      before.current ??= { columns: g.getColumnState(), filters: g.getFilterModel() };
      apply(g, json as Answer);
      setNote({ text: json.explanation ?? "Done.", tone: "ok", replayed: json.replayed });
    } catch {
      setNote({ text: "Couldn't reach the AI. Check your connection and try again.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  function apply(g: GridApi<T>, a: Answer) {
    // Only columns this grid really has; anything else is ignored rather than breaking the grid.
    const known = (id: string) => Boolean(g.getColumn(id));
    const model: Record<string, unknown> = {};
    for (const [id, f] of Object.entries(a.filterModel ?? {})) if (known(id)) model[id] = forColumn(g, id, f);
    g.setFilterModel(model);
    const sort = (a.sort ?? []).filter((s) => known(s.colId));
    g.applyColumnState({ state: sort.map((s, i) => ({ colId: s.colId, sort: s.sort, sortIndex: i })), defaultState: { sort: null } });
    if (enterprise) {
      const groups = (a.rowGroup ?? []).filter(known);
      if (groups.length) g.setRowGroupColumns(groups);
    }
  }

  function clear() {
    const g = api();
    const was = before.current;
    before.current = null;
    setNote(null);
    setQuestion("");
    if (!g) return;
    g.setFilterModel(was?.filters ?? null);
    if (was) g.applyColumnState({ state: was.columns, applyOrder: true });
  }

  return (
    <div className="rounded-lg border border-line bg-panel p-3" data-testid={`grid-ask-${grid}`}>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft text-sm font-semibold text-accent">AI</span>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
          maxLength={300}
          placeholder={placeholder ?? "Ask the grid in plain English"}
          aria-label="Ask the grid a question"
          className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm disabled:opacity-60"
        />
        <button type="submit" disabled={busy || question.trim().length < 3} className={BUTTON.primary}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">Try:</span>
        {examples.map((x) => (
          <button key={x} type="button" disabled={busy} onClick={() => ask(x)} className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-accent hover:text-accent disabled:opacity-60">
            {x}
          </button>
        ))}
      </div>
      {note ? (
        <p role="status" className="mt-2 text-sm" style={{ color: note.tone === "error" ? "var(--danger)" : undefined }}>
          {note.tone === "ok" ? <span aria-hidden className="mr-1 text-accent">▸</span> : null}
          {note.text}
          {note.tone === "ok" ? (
            <>
              {" "}
              <span className="text-xs text-muted">Gemini set this grid&apos;s filters and sort{note.replayed ? " (saved answer)" : ""}.</span>{" "}
              <button type="button" onClick={clear} className="text-xs text-accent underline">Clear</button>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

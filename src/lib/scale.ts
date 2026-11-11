// Scale check: 1,000,000 simulated disputes behind AG Grid's server-side row model. The
// grid asks for one block of rows at a time (with its sort, filters and grouping), and
// the server answers from Postgres when a database is configured, or from an in-memory
// column store otherwise (and whenever the database can't answer). Either way only the
// rows on screen ever reach the browser.
//
// The data is simulated with a fixed seed and labelled as such; it isn't any shop's.

import { query } from "./store/db";
import { databaseConfigured } from "./store";

export const SCALE_ROWS = 1_000_000;
const MAX_BLOCK = 500;

export const CLAIMS = ["Not received", "Not as described", "Unauthorized", "Credit not processed", "Duplicate"];
export const DECISIONS = ["Fight", "Partial refund", "Refund"];
export const RESULTS = ["Won", "Lost", "Settled", "Refunded"];
export const BY = ["Autopilot", "Seller"];
const FIRST = ["Dana", "Priya", "Marco", "Aiko", "Sam", "Lena", "Omar", "Grace", "Tom", "Zara", "Ravi", "Nina"];
const LAST = ["Whitfield", "Raman", "Rossi", "Tanaka", "Okafor", "Novak", "Haddad", "Kim", "Berg", "Silva"];
const START_DAY = Date.UTC(2025, 0, 1) / 86_400_000;

type ColType = "number" | "text" | "date";
// Columns the grid may sort, filter or group by. Anything else in a request is ignored.
export const SCALE_COLUMNS: Record<string, { type: ColType; group?: boolean; agg?: boolean }> = {
  id: { type: "number" },
  buyer: { type: "text" },
  claim: { type: "text", group: true },
  amount: { type: "number", agg: true },
  decision: { type: "text", group: true },
  by: { type: "text", group: true },
  result: { type: "text", group: true },
  kept: { type: "number", agg: true },
  refunded: { type: "number", agg: true },
  closed: { type: "date" },
};

// ---- The request AG Grid sends (IServerSideGetRowsRequest, the parts we use) ----------

export type ScaleRequest = {
  startRow?: number;
  endRow?: number;
  rowGroupCols?: Array<{ id?: string; field?: string }>;
  groupKeys?: string[];
  sortModel?: Array<{ colId: string; sort: "asc" | "desc" }>;
  filterModel?: Record<string, any> | null;
};
export type ScaleRow = Record<string, string | number | boolean | null>;
export type ScaleResult = { rows: ScaleRow[]; lastRow: number; source: "postgres" | "memory"; ms: number };

type Cond = { col: string; type: ColType; op: string; a?: number | string; b?: number | string; values?: string[] };
type Plan = { group: string | null; groupBy: string[]; keys: string[]; where: Cond[][]; sort: Array<{ col: string; desc: boolean }>; start: number; end: number };

// One filter model entry becomes a list of alternatives (OR) of single conditions.
function conditions(col: string, type: ColType, f: any): Cond[] | null {
  if (!f || typeof f !== "object") return null;
  if (Array.isArray(f.conditions) && f.conditions.length) {
    const parts = f.conditions.map((c: any) => conditions(col, type, c)).filter(Boolean) as Cond[][];
    if (!parts.length) return null;
    // AND of two conditions is returned as two separate groups by the caller; here OR.
    return f.operator === "AND" ? null : parts.flat();
  }
  if (f.filterType === "set") return Array.isArray(f.values) ? [{ col, type, op: "in", values: f.values.map(String) }] : null;
  const op = String(f.type ?? "");
  if (type === "number") {
    const a = Number(f.filter);
    if (!Number.isFinite(a)) return null;
    const b = Number(f.filterTo);
    return [{ col, type, op, a, ...(Number.isFinite(b) ? { b } : {}) }];
  }
  if (type === "date") {
    const a = String(f.dateFrom ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) return null;
    const b = String(f.dateTo ?? "").slice(0, 10);
    return [{ col, type, op, a, ...(/^\d{4}-\d{2}-\d{2}$/.test(b) ? { b } : {}) }];
  }
  const a = String(f.filter ?? "").trim().toLowerCase();
  return a ? [{ col, type, op, a }] : null;
}

export function plan(req: ScaleRequest): Plan {
  const groupBy = (req.rowGroupCols ?? []).map((c) => c.field ?? c.id ?? "").filter((c) => SCALE_COLUMNS[c]?.group).slice(0, 3);
  const keys = (req.groupKeys ?? []).map(String).slice(0, groupBy.length);
  const where: Cond[][] = [];
  for (const [col, f] of Object.entries(req.filterModel ?? {})) {
    const meta = SCALE_COLUMNS[col];
    if (!meta) continue;
    if (Array.isArray(f?.conditions) && f.operator === "AND") {
      for (const c of f.conditions) {
        const one = conditions(col, meta.type, c);
        if (one) where.push(one);
      }
    } else {
      const any = conditions(col, meta.type, f);
      if (any) where.push(any);
    }
  }
  keys.forEach((k, i) => where.push([{ col: groupBy[i], type: "text", op: "groupKey", a: k }]));
  const group = keys.length < groupBy.length ? groupBy[keys.length] : null;
  const sort = (req.sortModel ?? [])
    .map((s) => ({ col: s.colId === "ag-Grid-AutoColumn" && group ? group : s.colId, desc: s.sort === "desc" }))
    .filter((s) => SCALE_COLUMNS[s.col] && (!group || s.col === group || SCALE_COLUMNS[s.col].agg))
    .slice(0, 3);
  const start = Math.max(0, Math.floor(Number(req.startRow) || 0));
  const end = Math.min(start + MAX_BLOCK, Math.max(start + 1, Math.floor(Number(req.endRow) || start + 100)));
  return { group, groupBy, keys, where, sort, start, end };
}

// ---- In-memory column store -----------------------------------------------------------

type Store = { buyer: Uint8Array; claim: Uint8Array; decision: Uint8Array; by: Uint8Array; result: Uint8Array; amount: Float64Array; kept: Float64Array; refunded: Float64Array; closed: Uint16Array };
const g = globalThis as unknown as { __rebuttalScale?: Store; __rebuttalScaleCache?: Map<string, Int32Array> };
const BUYERS = FIRST.flatMap((f) => LAST.map((l) => `${f} ${l}`));

// Fixed seed, so every visitor and every restart sees the same million disputes.
function build(): Store {
  const n = SCALE_ROWS;
  const s: Store = { buyer: new Uint8Array(n), claim: new Uint8Array(n), decision: new Uint8Array(n), by: new Uint8Array(n), result: new Uint8Array(n), amount: new Float64Array(n), kept: new Float64Array(n), refunded: new Float64Array(n), closed: new Uint16Array(n) };
  let seed = 42;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < n; i++) {
    s.claim[i] = Math.floor(rnd() * rnd() * CLAIMS.length);
    const amount = Math.round((8 + rnd() * rnd() * 600) * 100) / 100;
    const r = rnd();
    const decision = r < 0.45 ? 0 : r < 0.7 ? 1 : 2;
    const won = decision === 0 && rnd() < 0.72;
    const kept = decision === 0 ? (won ? amount : 0) : decision === 1 ? Math.round(amount * (0.5 + rnd() * 0.3) * 100) / 100 : 0;
    s.amount[i] = amount;
    s.decision[i] = decision;
    s.kept[i] = kept;
    s.refunded[i] = Math.round((amount - kept) * 100) / 100;
    s.result[i] = decision === 0 ? (won ? 0 : 1) : decision === 1 ? 2 : 3;
    s.buyer[i] = Math.floor(rnd() * BUYERS.length);
    s.by[i] = rnd() < 0.4 ? 0 : 1;
    s.closed[i] = Math.floor(rnd() * 670);
  }
  return s;
}
const mem = () => (g.__rebuttalScale ??= build());

const LABELS: Record<string, string[]> = { claim: CLAIMS, decision: DECISIONS, result: RESULTS, by: BY, buyer: BUYERS };
const dayIso = (d: number) => new Date((START_DAY + d) * 86_400_000).toISOString().slice(0, 10);
const isoDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000 - START_DAY;

function value(s: Store, col: string, i: number): number | string {
  switch (col) {
    case "id": return i + 1;
    case "amount": return s.amount[i];
    case "kept": return s.kept[i];
    case "refunded": return s.refunded[i];
    case "closed": return s.closed[i];
    default: return LABELS[col][(s as unknown as Record<string, Uint8Array>)[col][i]];
  }
}

function test(c: Cond, v: number | string): boolean {
  if (c.op === "in") return c.values!.includes(String(v));
  if (c.op === "groupKey") return String(v) === c.a;
  if (c.type === "text") {
    const t = String(v).toLowerCase();
    const a = String(c.a);
    switch (c.op) {
      case "equals": return t === a;
      case "notEqual": return t !== a;
      case "startsWith": return t.startsWith(a);
      case "endsWith": return t.endsWith(a);
      case "notContains": return !t.includes(a);
      default: return t.includes(a);
    }
  }
  const n = Number(v);
  const a = c.type === "date" ? isoDay(String(c.a)) : Number(c.a);
  const b = c.b === undefined ? undefined : c.type === "date" ? isoDay(String(c.b)) : Number(c.b);
  switch (c.op) {
    case "equals": return n === a;
    case "notEqual": return n !== a;
    case "greaterThan": return n > a;
    case "greaterThanOrEqual": return n >= a;
    case "lessThan": return n < a;
    case "lessThanOrEqual": return n <= a;
    case "inRange": return b === undefined ? n >= a : n >= a && n <= b;
    default: return true;
  }
}

// Row indexes that pass the filters (and group keys), cached by the request's filters.
function matching(s: Store, where: Cond[][]): Int32Array {
  const key = JSON.stringify(where);
  const cache = (g.__rebuttalScaleCache ??= new Map());
  const hit = cache.get(key);
  if (hit) return hit;
  const out = new Int32Array(SCALE_ROWS);
  let n = 0;
  outer: for (let i = 0; i < SCALE_ROWS; i++) {
    for (const any of where) if (!any.some((c) => test(c, value(s, c.col, i)))) continue outer;
    out[n++] = i;
  }
  const res = out.slice(0, n);
  cache.set(key, res);
  if (cache.size > 30) cache.delete(cache.keys().next().value as string);
  return res;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function fromMemory(p: Plan): Omit<ScaleResult, "ms" | "source"> {
  const s = mem();
  const idx = matching(s, p.where);
  if (p.group) {
    const groups = new Map<string, { count: number; amount: number; kept: number; refunded: number }>();
    for (const i of idx) {
      const k = String(value(s, p.group, i));
      const cur = groups.get(k) ?? { count: 0, amount: 0, kept: 0, refunded: 0 };
      cur.count++;
      cur.amount += s.amount[i];
      cur.kept += s.kept[i];
      cur.refunded += s.refunded[i];
      groups.set(k, cur);
    }
    let rows: ScaleRow[] = [...groups.entries()].map(([k, a]) => ({ [p.group!]: k, childCount: a.count, amount: round2(a.amount), kept: round2(a.kept), refunded: round2(a.refunded) }));
    const sorts = p.sort.length ? p.sort : [{ col: p.group, desc: false }];
    rows.sort((x, y) => {
      for (const o of sorts) {
        const a = x[o.col] as number | string;
        const b = y[o.col] as number | string;
        if (a !== b) return (a < b ? -1 : 1) * (o.desc ? -1 : 1);
      }
      return 0;
    });
    rows = rows.slice(p.start, p.end);
    return { rows, lastRow: groups.size };
  }
  let order = idx;
  if (p.sort.length) {
    order = Int32Array.from(idx);
    const cols = p.sort.map((o) => ({ get: (i: number) => (o.col === "id" ? i : value(s, o.col, i)), dir: o.desc ? -1 : 1 }));
    order.sort((x, y) => {
      for (const c of cols) {
        const a = c.get(x);
        const b = c.get(y);
        if (a !== b) return (a < b ? -1 : 1) * c.dir;
      }
      return x - y;
    });
  }
  const rows: ScaleRow[] = [];
  for (let k = p.start; k < Math.min(p.end, order.length); k++) {
    const i = order[k];
    rows.push({ id: i + 1, buyer: BUYERS[s.buyer[i]], claim: CLAIMS[s.claim[i]], amount: s.amount[i], decision: DECISIONS[s.decision[i]], by: BY[s.by[i]], result: RESULTS[s.result[i]], kept: s.kept[i], refunded: s.refunded[i], closed: dayIso(s.closed[i]) });
  }
  return { rows, lastRow: order.length };
}

// ---- Postgres --------------------------------------------------------------------------

const QUOTED: Record<string, string> = { id: "id", buyer: "buyer", claim: "claim", amount: "amount", decision: "decision", by: '"by"', result: "result", kept: "kept", refunded: "refunded", closed: "closed" };

// Builds the WHERE clause with numbered parameters. Column names come only from the
// whitelist above, never from the request.
export function sqlWhere(where: Cond[][], params: unknown[]): string {
  const add = (v: unknown) => (params.push(v), `$${params.length}`);
  const one = (c: Cond): string => {
    const col = QUOTED[c.col];
    if (c.op === "in") return `${col} = any(${add(c.values)}::text[])`;
    if (c.op === "groupKey") return `${col} = ${add(c.a)}`;
    if (c.type === "text") {
      const like = (pat: string) => `lower(${col}) like ${add(pat)}`;
      const esc = String(c.a).replace(/[\\%_]/g, (m) => `\\${m}`);
      switch (c.op) {
        case "equals": return `lower(${col}) = ${add(c.a)}`;
        case "notEqual": return `lower(${col}) <> ${add(c.a)}`;
        case "startsWith": return like(`${esc}%`);
        case "endsWith": return like(`%${esc}`);
        case "notContains": return `not ${like(`%${esc}%`)}`;
        default: return like(`%${esc}%`);
      }
    }
    const cast = c.type === "date" ? "::date" : "::numeric";
    const ops: Record<string, string> = { equals: "=", notEqual: "<>", greaterThan: ">", greaterThanOrEqual: ">=", lessThan: "<", lessThanOrEqual: "<=" };
    if (c.op === "inRange") return c.b === undefined ? `${col} >= ${add(c.a)}${cast}` : `${col} between ${add(c.a)}${cast} and ${add(c.b)}${cast}`;
    return ops[c.op] ? `${col} ${ops[c.op]} ${add(c.a)}${cast}` : "true";
  };
  return where.length ? `where ${where.map((any) => `(${any.map(one).join(" or ")})`).join(" and ")}` : "";
}

let ready: Promise<void> | null = null;

// Creates and fills the table once (about 1M rows, generated inside Postgres), then
// keeps it. Until it is ready, requests are answered from memory.
function ensureTable(): Promise<void> {
  ready ??= (async () => {
    await query(`create table if not exists scale_disputes (
      id integer primary key, buyer text not null, claim text not null, amount numeric(10,2) not null,
      decision text not null, "by" text not null, result text not null, kept numeric(10,2) not null,
      refunded numeric(10,2) not null, closed date not null)`);
    const [{ n }] = await query<{ n: string }>("select count(*)::text as n from scale_disputes");
    if (Number(n) >= SCALE_ROWS) return;
    await query("truncate scale_disputes");
    // Same distributions as the in-memory store, from Postgres's own seeded random().
    await query(`select setseed(0.42)`);
    await query(`insert into scale_disputes
      select i, b.buyer, c.claim, x.amount, d.decision, case when random() < 0.4 then 'Autopilot' else 'Seller' end,
        case d.decision when 'Fight' then case when x.won then 'Won' else 'Lost' end when 'Partial refund' then 'Settled' else 'Refunded' end,
        x.kept, x.amount - x.kept, date '2025-01-01' + floor(random() * 670)::int
      from generate_series(1, ${SCALE_ROWS}) i
      cross join lateral (select (array[${CLAIMS.map((c) => `'${c}'`).join(",")}])[1 + floor(random() * random() * ${CLAIMS.length})::int] as claim) c
      cross join lateral (select (array[${BUYERS.map((b) => `'${b}'`).join(",")}])[1 + floor(random() * ${BUYERS.length})::int] as buyer) b
      cross join lateral (select r, case when r < 0.45 then 'Fight' when r < 0.7 then 'Partial refund' else 'Refund' end as decision from (select random() as r) q) d
      cross join lateral (select a as amount, w as won,
          case when d.r < 0.45 then case when w then a else 0 end when d.r < 0.7 then round(a * (0.5 + random() * 0.3)::numeric, 2) else 0 end as kept
        from (select round((8 + random() * random() * 600)::numeric, 2) as a, random() < 0.72 as w) v) x`);
    for (const col of ["claim", "decision", "result", "amount", "closed"]) await query(`create index if not exists scale_disputes_${col} on scale_disputes (${col})`);
    await query("analyze scale_disputes");
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

async function fromPostgres(p: Plan): Promise<Omit<ScaleResult, "ms" | "source">> {
  const params: unknown[] = [];
  const where = sqlWhere(p.where, params);
  const dir = (d: boolean) => (d ? "desc" : "asc");
  if (p.group) {
    const col = QUOTED[p.group];
    const order = (p.sort.length ? p.sort : [{ col: p.group, desc: false }]).map((o) => `${o.col === p.group ? col : o.col} ${dir(o.desc)}`).join(", ");
    const rows = await query(
      `select ${col} as "${p.group}", count(*)::int as "childCount", sum(amount)::float8 as amount, sum(kept)::float8 as kept, sum(refunded)::float8 as refunded
       from scale_disputes ${where} group by ${col} order by ${order} offset ${p.start} limit ${p.end - p.start}`,
      params,
    );
    const [{ n }] = await query<{ n: number }>(`select count(distinct ${col})::int as n from scale_disputes ${where}`, params);
    return { rows: rows as ScaleRow[], lastRow: n };
  }
  const order = [...p.sort.map((o) => `${QUOTED[o.col]} ${dir(o.desc)}`), "id asc"].join(", ");
  const rows = await query(
    `select id, buyer, claim, amount::float8 as amount, decision, "by", result, kept::float8 as kept, refunded::float8 as refunded, to_char(closed, 'YYYY-MM-DD') as closed
     from scale_disputes ${where} order by ${order} offset ${p.start} limit ${p.end - p.start}`,
    params,
  );
  const [{ n }] = await query<{ n: number }>(`select count(*)::int as n from scale_disputes ${where}`, params);
  return { rows: rows as ScaleRow[], lastRow: n };
}

export async function scaleRows(req: ScaleRequest): Promise<ScaleResult> {
  const t = performance.now();
  const p = plan(req);
  if (databaseConfigured()) {
    try {
      // The first request starts filling the table; it is answered from memory meanwhile.
      const fill = ensureTable();
      const done = await Promise.race([fill.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 50))]);
      if (done) return { ...(await fromPostgres(p)), source: "postgres", ms: Math.round(performance.now() - t) };
    } catch (e) {
      console.warn("scale check: Postgres unavailable, answering from memory:", e instanceof Error ? e.message : e);
    }
  }
  return { ...fromMemory(p), source: "memory", ms: Math.round(performance.now() - t) };
}

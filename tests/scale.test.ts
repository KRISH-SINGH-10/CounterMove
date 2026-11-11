import { describe, expect, it } from "vitest";
import { plan, scaleRows, SCALE_ROWS, sqlWhere } from "../src/lib/scale";

delete process.env.DATABASE_URL;

describe("1,000,000-row scale check (server-side row model)", () => {
  it("serves one block of a million rows, never more than 500", async () => {
    const r = await scaleRows({ startRow: 0, endRow: 100000 });
    expect(r.source).toBe("memory");
    expect(r.lastRow).toBe(SCALE_ROWS);
    expect(r.rows).toHaveLength(500);
    expect(r.rows[0]).toMatchObject({ id: 1 });
  }, 60_000);

  it("sorts, filters and pages on the server", async () => {
    const r = await scaleRows({
      startRow: 0,
      endRow: 50,
      sortModel: [{ colId: "amount", sort: "desc" }],
      filterModel: { claim: { filterType: "text", type: "equals", filter: "Unauthorized" }, amount: { filterType: "number", type: "greaterThan", filter: 100 } },
    });
    expect(r.lastRow).toBeGreaterThan(0);
    expect(r.lastRow).toBeLessThan(SCALE_ROWS);
    expect(r.rows.every((x) => x.claim === "Unauthorized" && Number(x.amount) > 100)).toBe(true);
    for (let i = 1; i < r.rows.length; i++) expect(Number(r.rows[i - 1].amount)).toBeGreaterThanOrEqual(Number(r.rows[i].amount));
  }, 60_000);

  it("groups with counts and sums, then opens a group", async () => {
    const top = await scaleRows({ startRow: 0, endRow: 100, rowGroupCols: [{ id: "claim", field: "claim" }], groupKeys: [] });
    expect(top.lastRow).toBe(5);
    expect(top.rows.reduce((s, r) => s + Number(r.childCount), 0)).toBe(SCALE_ROWS);
    const open = await scaleRows({ startRow: 0, endRow: 10, rowGroupCols: [{ id: "claim", field: "claim" }], groupKeys: ["Duplicate"] });
    const group = top.rows.find((r) => r.claim === "Duplicate")!;
    expect(open.lastRow).toBe(group.childCount);
    expect(open.rows.every((r) => r.claim === "Duplicate")).toBe(true);
  }, 60_000);

  it("ignores columns it doesn't know and builds parameterised SQL", () => {
    const p = plan({ sortModel: [{ colId: "password", sort: "asc" }], filterModel: { "1;drop table x": { filterType: "text", type: "contains", filter: "a" }, buyer: { filterType: "text", type: "contains", filter: "o'brien%" } } });
    expect(p.sort).toEqual([]);
    const params: unknown[] = [];
    const sql = sqlWhere(p.where, params);
    expect(sql).toBe("where (lower(buyer) like $1)");
    expect(params).toEqual([String.raw`%o'brien\%%`]);
  });
});

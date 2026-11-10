import { beforeEach, describe, expect, it } from "vitest";
import { answerFix, FixError, listFixRequests, orderForBuyer, resetFix, submitFix, whereAnswer } from "../src/lib/fixfirst";
import { runAs, type Visitor } from "../src/lib/visitor";

process.env.PAYPAL_MODE = "mock";
const V: Visitor = { id: "f1f1f1f1-1111-2222-3333-444444444444", mode: "mock" };
const as = <T>(fn: () => T) => runAs({ ...V }, fn);

describe("fix it first", () => {
  beforeEach(() => as(() => resetFix()));

  it("shows the buyer only a first name, the item and the shipping status", () => {
    const o = orderForBuyer("jk-1042")!;
    expect(o.buyer_first_name).toBe("Dana");
    expect(o.state).toBe("DELIVERED");
    expect(JSON.stringify(o)).not.toMatch(/@|Alder St/);
    expect(orderForBuyer("NOPE")).toBeNull();
  });

  it("answers a tracking question at once from the shipping records", () =>
    as(() => {
      const r = submitFix("JK-1042", { kind: "WHERE" });
      expect(r.status).toBe("ANSWERED");
      expect(r.answered_by).toBe("auto");
      expect(r.answer).toMatch(/signed for by WHITFIELD/);
      expect(whereAnswer(orderForBuyer("JK-1063")!)).toMatch(/no tracking/);
      expect(whereAnswer(orderForBuyer("JK-1090")!)).toMatch(/being packed/);
    }));

  it("queues a problem for the seller, who answers it once", () =>
    as(() => {
      const r = submitFix("JK-1057", { kind: "PROBLEM", wants: "REPLACEMENT", note: "One mug arrived chipped" });
      expect(r.status).toBe("OPEN");
      expect(listFixRequests()).toHaveLength(1);
      expect(() => submitFix("JK-1057", { kind: "PROBLEM", note: "again please" })).toThrow(FixError);
      const done = answerFix(r.id, "A replacement is on its way.");
      expect(done.status).toBe("ANSWERED");
      expect(done.answered_by).toBe("seller");
      expect(() => answerFix(r.id, "twice")).toThrow(/already answered/);
    }));

  it("refuses an empty problem, an unknown order and cancelling a shipped order", () =>
    as(() => {
      expect(() => submitFix("JK-1057", { kind: "PROBLEM", note: "  " })).toThrow(/few words/);
      expect(() => submitFix("NOPE", { kind: "WHERE" })).toThrow(/couldn't find/);
      expect(() => submitFix("JK-1042", { kind: "CANCEL" })).toThrow(/already shipped/);
      expect(submitFix("JK-1090", { kind: "CANCEL" }).wants).toBe("REFUND");
    }));

  it("keeps each visitor's requests apart", () => {
    as(() => submitFix("JK-1090", { kind: "CANCEL" }));
    expect(runAs({ id: "f2f2f2f2-1111-2222-3333-444444444444", mode: "mock" }, () => listFixRequests())).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { comparePhotos, compareLive, photosFor, savedForensics } from "../src/lib/forensics";

const answer = {
  verdict: "DAMAGED_IN_TRANSIT",
  confidence: 0.9,
  summary: "Packed intact, arrived chipped.",
  findings: [{ photo: "buyer", observation: "A chip on the rim." }],
  claim_checks: [{ claim: "Chipped", supported: "YES", why: "Visible chip." }],
  suggested_response: "Offer a replacement mug.",
};

describe("photo forensics", () => {
  it("has the three evidence photos for the chipped-mug dispute, and none for others", () => {
    expect(photosFor("JK-1057").map((p) => p.kind)).toEqual(["listing", "packing", "buyer"]);
    expect(photosFor("JK-1057-AB12")).toHaveLength(3); // seeded sandbox invoices carry a suffix
    expect(photosFor("JK-1042")).toEqual([]);
  });

  it("replays the saved Gemini comparison with no model call", async () => {
    const saved = savedForensics("JK-1057");
    expect(saved?.replayed).toBe(true);
    expect(saved?.verdict).toBe("DAMAGED_IN_TRANSIT");
    expect((await comparePhotos("JK-1057")).replayed).toBe(true);
  });

  it("sends all three images to the model and checks its answer", async () => {
    let parts: Array<{ inlineData?: { mimeType: string } }> = [];
    const r = await compareLive("JK-1057", {
      save: false,
      generate: async (args) => {
        parts = (args.contents as Array<{ parts: typeof parts }>)[0].parts;
        return { text: JSON.stringify(answer) };
      },
    });
    expect(parts.filter((p) => p.inlineData?.mimeType === "image/png")).toHaveLength(3);
    expect(r).toMatchObject({ verdict: "DAMAGED_IN_TRANSIT", replayed: false });
  });

  it("rejects an answer that doesn't fit, and a dispute with no photos", async () => {
    await expect(compareLive("JK-1057", { save: false, generate: async () => ({ text: JSON.stringify({ verdict: "GUILTY" }) }) })).rejects.toThrow(/couldn't compare/);
    await expect(compareLive("JK-1042", { save: false, generate: async () => ({ text: "{}" }) })).rejects.toThrow(/no photos/);
  });
});

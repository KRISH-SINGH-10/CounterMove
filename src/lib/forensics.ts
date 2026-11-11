// Photo forensics: Gemini compares the buyer's photo with the listing photo and the
// shop's packing photo, and says what the pictures show: damaged in transit, not as
// described, a different item, or matching the listing. The model only looks and
// reports; the seller still decides, and nothing is sent to PayPal from here.
//
// Each finished comparison is saved (cache/forensics/<invoice>.json) and replayed, like
// investigations, so the demo works with no AI quota. "Compare again" runs it live.
// The demo images are illustrations made for this project, not photos of real products.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { scenarioByKey } from "./demo/scenarios";
import { DEFAULT_GEMINI_FALLBACKS, DEFAULT_GEMINI_MODEL } from "./model/gemini";
import { takeModelCall } from "./rate-limit";

export type PhotoKind = "listing" | "packing" | "buyer";
export type EvidencePhoto = { kind: PhotoKind; url: string; caption: string };

const PHOTOS: Record<string, EvidencePhoto[]> = {
  "JK-1057": [
    { kind: "listing", url: "/evidence/JK-1057/listing.png", caption: "Listing photo the buyer saw" },
    { kind: "packing", url: "/evidence/JK-1057/packing.png", caption: "Shop's packing photo, before the box was sealed" },
    { kind: "buyer", url: "/evidence/JK-1057/buyer.png", caption: "Buyer's photo, sent with the dispute" },
  ],
};

// The photos for a dispute's invoice (seeded sandbox invoices carry a suffix).
export function photosFor(invoice?: string | null): EvidencePhoto[] {
  if (!invoice) return [];
  const key = Object.keys(PHOTOS).find((k) => invoice === k || invoice.startsWith(`${k}-`));
  return key ? PHOTOS[key] : [];
}

export const VERDICTS = ["DAMAGED_IN_TRANSIT", "NOT_AS_DESCRIBED", "DIFFERENT_ITEM", "MATCHES_LISTING", "INCONCLUSIVE"] as const;

const Finding = z.object({
  photo: z.enum(["listing", "packing", "buyer"]),
  observation: z.string().min(1).max(400),
});
export const ForensicsSchema = z.object({
  verdict: z.enum(VERDICTS),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(600),
  findings: z.array(Finding).min(1).max(8),
  // What the photos support, per part of the buyer's claim.
  claim_checks: z.array(z.object({ claim: z.string().min(1).max(200), supported: z.enum(["YES", "NO", "UNCLEAR"]), why: z.string().min(1).max(300) })).max(5),
  suggested_response: z.string().min(1).max(400),
});
export type Forensics = z.infer<typeof ForensicsSchema>;
export type ForensicsResult = Forensics & { invoice: string; model: string; saved_at: string; replayed: boolean };

// JSON schema for Gemini's structured output (the same shape as ForensicsSchema).
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: [...VERDICTS] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    summary: { type: "string" },
    findings: { type: "array", items: { type: "object", properties: { photo: { type: "string", enum: ["listing", "packing", "buyer"] }, observation: { type: "string" } }, required: ["photo", "observation"] } },
    claim_checks: { type: "array", items: { type: "object", properties: { claim: { type: "string" }, supported: { type: "string", enum: ["YES", "NO", "UNCLEAR"] }, why: { type: "string" } }, required: ["claim", "supported", "why"] } },
    suggested_response: { type: "string" },
  },
  required: ["verdict", "confidence", "summary", "findings", "claim_checks", "suggested_response"],
};

const SYSTEM = `You compare evidence photos for a PayPal dispute at a small online shop. You get the listing photo the buyer saw, the shop's packing photo taken before the box was sealed, and the buyer's photo sent with the dispute, plus the listing text and the buyer's words.

Look carefully and report only what the pictures show:
- Compare the item in each photo: shape, colour, pattern, count, and any damage such as chips, cracks or breaks. Read any date stamps.
- If the item left the shop intact (packing photo) and arrived damaged (buyer photo), say DAMAGED_IN_TRANSIT.
- If the item is the same but differs from the listing in a way the listing doesn't allow for, say NOT_AS_DESCRIBED.
- If the buyer's item is not the item that was sold or packed, say DIFFERENT_ITEM.
- If the buyer's photo matches the listing and the packing photo, say MATCHES_LISTING.
- If the photos can't settle it, say INCONCLUSIVE.
Check each part of the buyer's claim separately against the photos and the listing text. Differences the listing text explicitly allows for (for example, a colourway the listing says reads warmer in daylight) don't support a not-as-described claim.
Be plain and specific. Never invent details you can't see. The seller decides what to do; suggest a fair response in one or two sentences.`;

const dir = () => path.join(process.env.REBUTTAL_CACHE_DIR ?? path.join(process.cwd(), "cache", "investigations"), "..", "forensics");

function context(invoice: string) {
  const s = scenarioByKey(invoice);
  return {
    invoice,
    item: s?.item.name ?? null,
    claim: s?.reason ?? null,
    buyer_words: s?.buyer_messages_in_dispute ?? [],
    listing_text: s?.store.listing.description ?? null,
    returns_policy: s?.store.policies.returns ?? null,
  };
}

// Saved comparisons are keyed by the invoice and the exact images, so new photos never
// replay an old answer.
function cacheKey(invoice: string, photos: EvidencePhoto[]): string {
  const h = crypto.createHash("sha256").update(invoice);
  for (const p of photos) h.update(p.kind).update(fs.readFileSync(publicPath(p.url)));
  return `${invoice.replace(/[^A-Za-z0-9_-]/g, "")}-${h.digest("hex").slice(0, 12)}`;
}

const publicPath = (url: string) => path.join(process.cwd(), "public", url.replace(/^\//, ""));

export function savedForensics(invoice: string): ForensicsResult | null {
  const photos = photosFor(invoice);
  if (!photos.length) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dir(), `${cacheKey(invoice, photos)}.json`), "utf8"));
    const parsed = ForensicsSchema.safeParse(saved);
    return parsed.success ? { ...parsed.data, invoice, model: String(saved.model ?? "saved"), saved_at: String(saved.saved_at ?? ""), replayed: true } : null;
  } catch {
    return null;
  }
}

export class ForensicsError extends Error {
  constructor(message: string, readonly status: 404 | 502 | 503) {
    super(message);
  }
}

type Generate = (args: { model: string; contents: unknown; config: unknown }) => Promise<{ text?: string }>;

// Runs the comparison with Gemini and saves it. `generate` is injectable for tests.
export async function compareLive(invoice: string, opts: { generate?: Generate; save?: boolean } = {}): Promise<ForensicsResult> {
  const photos = photosFor(invoice);
  if (!photos.length) throw new ForensicsError("There are no photos for this dispute.", 404);
  if (!opts.generate && !process.env.GEMINI_API_KEY) throw new ForensicsError("Photo forensics needs GEMINI_API_KEY on the server.", 503);
  const generate: Generate = opts.generate ?? ((args) => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).models.generateContent(args as never));
  const parts: unknown[] = [{ text: `Dispute facts (JSON):\n${JSON.stringify(context(invoice), null, 2)}\n\nThe photos follow, each after its label.` }];
  for (const p of photos) {
    parts.push({ text: `Photo "${p.kind}": ${p.caption}.` });
    parts.push({ inlineData: { mimeType: "image/png", data: fs.readFileSync(publicPath(p.url)).toString("base64") } });
  }
  const models = [process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL, ...DEFAULT_GEMINI_FALLBACKS];
  let lastError: unknown;
  for (const model of [...new Set(models)]) {
    try {
      if (!opts.generate) takeModelCall();
      const res = await generate({
        model,
        contents: [{ role: "user", parts }],
        config: { systemInstruction: SYSTEM, temperature: 0, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, maxOutputTokens: 4096, abortSignal: AbortSignal.timeout(60_000) },
      });
      const parsed = ForensicsSchema.safeParse(JSON.parse(res.text ?? "null"));
      if (!parsed.success) {
        lastError = new Error(`The model's answer didn't fit: ${parsed.error.issues[0]?.message}`);
        continue;
      }
      const result: ForensicsResult = { ...parsed.data, invoice, model: `gemini:${model}`, saved_at: new Date().toISOString(), replayed: false };
      if (opts.save ?? !opts.generate) save(invoice, photos, result);
      return result;
    } catch (e) {
      if ((e as { status?: number }).status === 429 || (e as Error).name === "LiveLimitError") lastError = e;
      else lastError = e;
    }
  }
  throw new ForensicsError(`The AI couldn't compare the photos right now${lastError instanceof Error ? ` (${lastError.message.slice(0, 120)})` : ""}. Try again in a minute.`, 502);
}

function save(invoice: string, photos: EvidencePhoto[], r: ForensicsResult) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const { replayed: _r, ...rest } = r;
    fs.writeFileSync(path.join(dir(), `${cacheKey(invoice, photos)}.json`), JSON.stringify(rest, null, 2));
  } catch (e) {
    console.warn("Could not save the photo comparison:", e instanceof Error ? e.message : e);
  }
}

// The saved comparison when there is one (no AI quota spent), otherwise a live one.
export async function comparePhotos(invoice: string, fresh = false): Promise<ForensicsResult> {
  if (!fresh) {
    const saved = savedForensics(invoice);
    if (saved) return saved;
  }
  try {
    return await compareLive(invoice);
  } catch (e) {
    // The AI is down or over quota: fall back to the saved comparison if there is one.
    const saved = savedForensics(invoice);
    if (saved) return saved;
    throw e;
  }
}

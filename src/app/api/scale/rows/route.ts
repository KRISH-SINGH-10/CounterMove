import { scaleRows, type ScaleRequest } from "@/lib/scale";

export const maxDuration = 60;

// AG Grid's server-side row model asks for one block of the million simulated disputes at
// a time, with its sort, filters and grouping. The answer comes from Postgres when a
// database is configured, otherwise from an in-memory column store.
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 20_000) return Response.json({ error: "Request too large." }, { status: 413 });
  let body: ScaleRequest;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  try {
    return Response.json(await scaleRows(body), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("scale rows failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn't load these rows. Try again." }, { status: 500 });
  }
}

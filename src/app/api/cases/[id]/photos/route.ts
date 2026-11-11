import { getCase } from "@/lib/cases";
import { comparePhotos, ForensicsError, photosFor } from "@/lib/forensics";
import { liveRunLimit, LiveLimitError } from "@/lib/rate-limit";
import { withVisitor } from "@/lib/visitor";

export const maxDuration = 120;

// Photo forensics for one dispute: GET lists its evidence photos; POST compares them with
// Gemini (the saved comparison replays; ?fresh=1 runs it live).
export const GET = withVisitor(async (_req: Request, ctx: RouteContext<"/api/cases/[id]/photos">) => {
  const { id } = await ctx.params;
  const c = await getCase(id);
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ photos: photosFor(c.dispute.disputed_transactions[0]?.invoice_number) });
});

export const POST = withVisitor(async (req: Request, ctx: RouteContext<"/api/cases/[id]/photos">) => {
  const { id } = await ctx.params;
  const c = await getCase(id);
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  const invoice = c.dispute.disputed_transactions[0]?.invoice_number ?? "";
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (fresh) {
    const limited = liveRunLimit(req, "photo comparisons");
    if (limited) return limited;
  }
  try {
    return Response.json(await comparePhotos(invoice, fresh));
  } catch (e) {
    if (e instanceof ForensicsError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof LiveLimitError) return Response.json({ error: e.message }, { status: 429 });
    console.error("photo forensics failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "The AI couldn't compare the photos right now. Try again in a minute." }, { status: 502 });
  }
});

import { connection } from "next/server";
import { z } from "zod";
import { answerFix, FixError, orderForBuyer, submitFix } from "@/lib/fixfirst";
import { assertWritable, READ_ONLY_MESSAGE, withVisitor } from "@/lib/visitor";

const Ask = z.object({
  kind: z.enum(["WHERE", "PROBLEM", "CANCEL"], { errorMap: () => ({ message: "Choose what you need help with." }) }),
  wants: z.enum(["REFUND", "REPLACEMENT"]).nullish(),
  note: z.string().max(500, "Keep the note under 500 characters.").optional(),
});
const Answer = z.object({ answer: z.string().trim().min(1, "Write the answer the buyer will see.").max(500) });

// GET /api/fix/{invoice}: the order as the buyer may see it (first name, item, shipping status).
export const GET = withVisitor(async (_req: Request, ctx: RouteContext<"/api/fix/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  const order = orderForBuyer(id);
  if (!order) return Response.json({ error: "We couldn't find that order. Check the order number in your confirmation email." }, { status: 404 });
  return Response.json({ order });
});

// POST /api/fix/{invoice}: the buyer asks for help with an order.
export const POST = withVisitor(async (req: Request, ctx: RouteContext<"/api/fix/[id]">) => {
  const { id } = await ctx.params;
  const body = Ask.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Choose what you need help with." }, { status: 400 });
  try {
    return Response.json({ request: submitFix(id, body.data) });
  } catch (e) {
    if (e instanceof FixError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
});

// PATCH /api/fix/{request id}: the seller answers an open request.
export const PATCH = withVisitor(async (req: Request, ctx: RouteContext<"/api/fix/[id]">) => {
  const { id } = await ctx.params;
  try {
    assertWritable();
  } catch {
    return Response.json({ error: READ_ONLY_MESSAGE }, { status: 403 });
  }
  const body = Answer.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Write the answer the buyer will see." }, { status: 400 });
  try {
    return Response.json({ request: answerFix(id, body.data.answer) });
  } catch (e) {
    if (e instanceof FixError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
});

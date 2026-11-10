import { connection } from "next/server";
import { listFixRequests } from "@/lib/fixfirst";
import { withVisitor } from "@/lib/visitor";

// Buyer requests from the "fix it first" page, newest first, for the seller's Protect page.
export const GET = withVisitor(async () => {
  await connection();
  return Response.json({ requests: listFixRequests() });
});

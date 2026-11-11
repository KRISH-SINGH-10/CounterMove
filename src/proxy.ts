import { NextResponse, type NextRequest } from "next/server";

// A first-time visitor gets their simulator cookie on the first page load. Without it,
// the page's first API calls all arrive cookie-less at the same moment and each starts a
// different simulator, so the panels on one page would read different demo shops.
const VISITOR_COOKIE = "rebuttal_visitor";
const YEAR = 60 * 60 * 24 * 365;

export function proxy(request: NextRequest) {
  if (/^[a-f0-9-]{36}$/.test(request.cookies.get(VISITOR_COOKIE)?.value ?? "")) return NextResponse.next();
  const id = crypto.randomUUID();
  // The page being rendered sees the cookie too.
  const headers = new Headers(request.headers);
  const cookie = request.headers.get("cookie");
  headers.set("cookie", `${cookie ? `${cookie}; ` : ""}${VISITOR_COOKIE}=${id}`);
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(VISITOR_COOKIE, id, { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  return res;
}

// Pages only: API routes set the cookie themselves (withVisitor), and static files need none.
export const config = {
  matcher: ["/((?!api/|_next/|evidence/|favicon.ico|icon.svg).*)"],
};

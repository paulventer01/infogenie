import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Auth guard for the Next-owned dashboard routes (dev front door). If the
// `infogenie.sid` session cookie is absent, redirect to /login with a `?next=`
// so the user lands back where they were. The matcher is scoped to dashboard
// page paths only — it never touches /api, /_next, static assets, or the
// /login, /reset-password, /accept-invite auth pages.
export function middleware(req: NextRequest) {
  if (req.cookies.get("infogenie.sid")) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  const dest = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = "/login";
  url.search =
    dest && dest !== "/" ? `?next=${encodeURIComponent(dest)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/",
    "/analyse/:path*",
    "/create/:path*",
    "/reach/:path*",
    "/grow/:path*",
    "/manage/:path*",
    "/ai-team/:path*",
  ],
};

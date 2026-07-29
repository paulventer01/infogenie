import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(req: NextRequest) {
  const op = req.nextUrl.searchParams.get("op");
  const res = NextResponse.redirect(new URL("/", req.url));
  if (op === "logout") {
    res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  }
  return res;
}

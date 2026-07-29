import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, loginAgency } from "@/lib/session";

export async function POST(req: NextRequest) {
  const op = req.nextUrl.searchParams.get("op") || "login";

  if (op === "logout") {
    const res = NextResponse.redirect(new URL("/", req.url));
    res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  }

  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") || "").trim().toLowerCase();
  const password = String(form?.get("password") || "");

  if (!email || !email.includes("@")) {
    return NextResponse.redirect(new URL("/?error=email", req.url));
  }
  if (password !== "mvp") {
    return NextResponse.redirect(new URL("/?error=password", req.url));
  }

  const agency = await loginAgency(email);
  const res = NextResponse.redirect(new URL("/agency", req.url));
  res.cookies.set(SESSION_COOKIE, agency.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}

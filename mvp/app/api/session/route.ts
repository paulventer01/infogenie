import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, loginAgency } from "@/lib/session";

/** Prefer Cloudflare / proxy host so redirects don't send browsers to localhost. */
function publicUrl(req: NextRequest, path: string): URL {
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    req.nextUrl.host;
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (req.nextUrl.protocol.replace(":", "") || "https");
  return new URL(path, `${proto}://${host}`);
}

export async function POST(req: NextRequest) {
  const op = req.nextUrl.searchParams.get("op") || "login";

  if (op === "logout") {
    const res = NextResponse.redirect(publicUrl(req, "/"));
    res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  }

  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") || "").trim().toLowerCase();
  const password = String(form?.get("password") || "");

  if (!email || !email.includes("@")) {
    return NextResponse.redirect(publicUrl(req, "/?error=email"));
  }
  if (password !== "mvp") {
    return NextResponse.redirect(publicUrl(req, "/?error=password"));
  }

  const agency = await loginAgency(email);
  const res = NextResponse.redirect(publicUrl(req, "/agency"));
  res.cookies.set(SESSION_COOKIE, agency.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}

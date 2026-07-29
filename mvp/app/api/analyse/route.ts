import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readWorkspace, writeWorkspace } from "@/lib/store";
import { SESSION_COOKIE } from "@/lib/session";
import { runAnalysis } from "@/lib/analyse";

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  const ws = readWorkspace();
  if (!sid || !ws || ws.id !== sid) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    domain?: string;
    industry?: string;
  };
  const domain = String(body.domain || "").trim();
  if (!domain) return NextResponse.json({ ok: false, error: "domain_required" }, { status: 400 });
  const analysis = await runAnalysis({
    domain,
    industry: body.industry?.trim() || undefined,
  });
  writeWorkspace({ ...ws, analysis, results: null });
  return NextResponse.json({ ok: true, analysis });
}

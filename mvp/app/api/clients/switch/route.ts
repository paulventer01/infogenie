import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readAgency, switchActiveClient } from "@/lib/store";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  const agency = readAgency();
  if (!sid || !agency || agency.id !== sid) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { clientId?: string };
  const clientId = String(body.clientId || "");
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "client_required" }, { status: 400 });
  }
  switchActiveClient(agency, clientId);
  return NextResponse.json({ ok: true });
}

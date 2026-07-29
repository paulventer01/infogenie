import { cookies } from "next/headers";
import { createWorkspace, readWorkspace } from "./store";
import type { Workspace } from "./types";

export const SESSION_COOKIE = "ig_mvp_sid";

export async function getSessionWorkspace(): Promise<Workspace | null> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const ws = readWorkspace();
  if (!ws || ws.id !== sid) return null;
  return ws;
}

export async function loginWorkspace(email: string): Promise<Workspace> {
  const existing = readWorkspace();
  if (existing && existing.email === email.trim().toLowerCase()) return existing;
  return createWorkspace(email);
}

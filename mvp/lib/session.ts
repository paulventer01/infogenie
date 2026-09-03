import { cookies } from "next/headers";
import {
  createAgency,
  getActiveClient,
  readAgency,
  writeAgency,
} from "./store";
import { refreshAgencyAlerts } from "./alerts";
import type { AgencyAccount, ClientWorkspace } from "./types";

export const SESSION_COOKIE = "ig_mvp_sid";

export async function getSessionAgency(): Promise<AgencyAccount | null> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const agency = readAgency();
  if (!agency || agency.id !== sid) return null;
  return refreshAgencyAlerts(agency);
}

export async function getSessionClient(): Promise<{
  agency: AgencyAccount;
  client: ClientWorkspace;
} | null> {
  const agency = await getSessionAgency();
  if (!agency) return null;
  const client = getActiveClient(agency);
  if (!client) return null;
  return { agency, client };
}

/** Active client workspace — back-compat for Day 1–7 pages */
export async function getSessionWorkspace(): Promise<(ClientWorkspace & { email: string }) | null> {
  const ctx = await getSessionClient();
  if (!ctx) return null;
  return { ...ctx.client, email: ctx.agency.email };
}

export async function loginAgency(email: string): Promise<AgencyAccount> {
  const normalized = email.trim().toLowerCase();
  const existing = readAgency();
  if (existing && existing.email === normalized) {
    return refreshAgencyAlerts(existing);
  }
  return createAgency(normalized);
}

export async function persistAgency(agency: AgencyAccount): Promise<AgencyAccount> {
  return writeAgency(agency);
}

export async function loginWorkspace(email: string): Promise<ClientWorkspace & { email: string }> {
  const agency = await loginAgency(email);
  const client = getActiveClient(agency)!;
  return { ...client, email: agency.email };
}

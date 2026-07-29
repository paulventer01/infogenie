import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgencyAccount, ClientWorkspace, InstaReport, Workspace } from "./types";
import { defaultIntegrations } from "./connectors";
import { defaultTeam, seedAssignments } from "./capacity";

const DATA_DIR = join(process.cwd(), ".data");
const AGENCY_PATH = join(DATA_DIR, "agency.json");
const LEGACY_PATH = join(DATA_DIR, "workspace.json");

function ensure() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function defaultWhiteLabel(agencyName: string): AgencyAccount["whiteLabel"] {
  return {
    agencyName,
    accentColor: "#0F766E",
    tagline: "Performance marketing, reported your way",
    hideVendorBrand: true,
  };
}

function defaultCompliance(): AgencyAccount["compliance"] {
  return {
    gdprAcknowledged: false,
    consentLogged: false,
    dataResidencyNote: "EU / UK processing only (configure with legal)",
    dpaSigned: false,
  };
}

function normalizeTeamRole(raw: unknown): AgencyAccount["sessionRole"] {
  const v = String(raw || "strategist");
  if (v === "owner" || v === "manager" || v === "strategist" || v === "viewer") return v;
  return "strategist";
}

function normalizeWhiteLabel(
  raw: AgencyAccount["whiteLabel"] | undefined,
  agencyName: string
): AgencyAccount["whiteLabel"] {
  const base = defaultWhiteLabel(agencyName);
  if (!raw) return base;
  return {
    agencyName: raw.agencyName || agencyName,
    accentColor: raw.accentColor || base.accentColor,
    footerText: raw.footerText,
    tagline: raw.tagline ?? base.tagline,
    hideVendorBrand: raw.hideVendorBrand !== false,
  };
}

function normalizeTeam(team: AgencyAccount["team"] | undefined): AgencyAccount["team"] {
  const base = defaultTeam();
  if (!team?.length) return base;
  return team.map((m, i) => ({
    ...m,
    teamRole: normalizeTeamRole(m.teamRole ?? (i === 0 ? "owner" : "strategist")),
    weeklyCapacityHours: m.weeklyCapacityHours || 40,
    hourlyCost: m.hourlyCost || 50,
  }));
}

function emptyClient(name: string, owner: string, domain?: string): ClientWorkspace {
  return {
    id: randomUUID(),
    name,
    domain,
    owner,
    createdAt: new Date().toISOString(),
    retainerMonthly: 6500,
    analysis: null,
    drafts: [],
    campaigns: [],
    sequences: [],
    results: null,
    weeklyReport: null,
    alerts: [],
    integrations: defaultIntegrations(),
    metricHistory: [],
    approvals: [],
    acknowledgedAlertIds: [],
  };
}

function migrateLegacyWorkspace(raw: Workspace): AgencyAccount {
  const client = normalizeClient({
    id: raw.id,
    name: raw.analysis?.brandName || raw.domain || "Client workspace",
    domain: raw.analysis?.domain || raw.domain,
    owner: raw.email.split("@")[0] || "Unassigned",
    createdAt: raw.createdAt,
    retainerMonthly: raw.retainerMonthly || 7500,
    analysis: raw.analysis,
    drafts: raw.drafts || [],
    campaigns: raw.campaigns || [],
    sequences: raw.sequences || [],
    results: raw.results
      ? { ...raw.results, source: raw.results.source || "illustrative" }
      : null,
    weeklyReport: null,
    alerts: [],
    integrations: raw.integrations?.length
      ? raw.integrations
      : [
          { platform: "Meta Ads", status: "connected" },
          { platform: "Google Ads", status: "connected" },
          { platform: "GA4", status: "pending" },
          { platform: "LinkedIn Ads", status: "pending" },
          { platform: "HubSpot", status: "pending" },
        ],
    metricHistory: raw.metricHistory || [],
    approvals: raw.approvals || [],
    acknowledgedAlertIds: [],
  });
  const team = defaultTeam();
  return {
    id: raw.id,
    email: raw.email,
    agencyName: "My Agency",
    createdAt: raw.createdAt,
    activeClientId: client.id,
    clients: [client],
    prospects: [],
    whiteLabel: defaultWhiteLabel("My Agency"),
    dataMode: "strict",
    team,
    assignments: seedAssignments([client], team),
    compliance: defaultCompliance(),
    sessionRole: "owner",
  };
}

function normalizeClient(c: ClientWorkspace): ClientWorkspace {
  const integrations =
    c.integrations?.length >= 3 ? c.integrations : defaultIntegrations();
  return {
    ...c,
    retainerMonthly: c.retainerMonthly ?? 6500,
    acknowledgedAlertIds: c.acknowledgedAlertIds || [],
    alerts: c.alerts || [],
    integrations,
    metricHistory: c.metricHistory || [],
    approvals: c.approvals || [],
  };
}

function parseAgency(raw: unknown): AgencyAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.clients)) {
    const agency = raw as AgencyAccount;
    const clients = agency.clients.map(normalizeClient);
    const team = agency.team?.length ? normalizeTeam(agency.team) : defaultTeam();
    const assignments =
      agency.assignments?.length ? agency.assignments : seedAssignments(clients, team);
    return {
      ...agency,
      dataMode: agency.dataMode || "strict",
      clients,
      team,
      assignments,
      whiteLabel: normalizeWhiteLabel(agency.whiteLabel, agency.agencyName || "Agency"),
      compliance: {
        ...defaultCompliance(),
        ...(agency.compliance || {}),
      },
      sessionRole: normalizeTeamRole(agency.sessionRole ?? "owner"),
    };
  }
  if (o.email && o.id) return migrateLegacyWorkspace(raw as Workspace);
  return null;
}

export function readAgency(): AgencyAccount | null {
  ensure();
  if (existsSync(AGENCY_PATH)) {
    try {
      return parseAgency(JSON.parse(readFileSync(AGENCY_PATH, "utf8")));
    } catch {
      return null;
    }
  }
  if (existsSync(LEGACY_PATH)) {
    try {
      const legacy = JSON.parse(readFileSync(LEGACY_PATH, "utf8")) as Workspace;
      const agency = migrateLegacyWorkspace(legacy);
      writeAgency(agency);
      return agency;
    } catch {
      return null;
    }
  }
  return null;
}

export function writeAgency(agency: AgencyAccount): AgencyAccount {
  ensure();
  writeFileSync(AGENCY_PATH, JSON.stringify(agency, null, 2), "utf8");
  return agency;
}

export function createAgency(email: string): AgencyAccount {
  const normalized = email.trim().toLowerCase();
  const owner = normalized.split("@")[0] || "lead";
  const clients: ClientWorkspace[] = [
    {
      ...emptyClient("Northwind Retail", owner, "northwind.example"),
      retainerMonthly: 9000,
      integrations: [
        { platform: "Meta Ads", status: "connected", connectedAt: new Date().toISOString() },
        { platform: "Google Ads", status: "connected", connectedAt: new Date().toISOString() },
        { platform: "GA4", status: "pending" },
        { platform: "LinkedIn Ads", status: "pending" },
        { platform: "HubSpot", status: "connected", connectedAt: new Date().toISOString() },
      ],
    },
    {
      ...emptyClient("Beacon Fintech", "jamie", "beacon.example"),
      retainerMonthly: 12000,
      integrations: [
        { platform: "Meta Ads", status: "connected", connectedAt: new Date().toISOString() },
        {
          platform: "Google Ads",
          status: "broken",
          note: "OAuth token expired",
        },
        { platform: "GA4", status: "connected", connectedAt: new Date().toISOString() },
        { platform: "LinkedIn Ads", status: "pending" },
        { platform: "HubSpot", status: "pending" },
      ],
    },
    {
      ...emptyClient("Summit B2B", "alex", "summit.example"),
      retainerMonthly: 5500,
    },
  ];

  const team = defaultTeam();
  const agency: AgencyAccount = {
    id: randomUUID(),
    email: normalized,
    agencyName: "Demo Agency",
    createdAt: new Date().toISOString(),
    activeClientId: clients[0].id,
    clients,
    prospects: [],
    whiteLabel: defaultWhiteLabel("Demo Agency"),
    dataMode: "strict",
    team,
    assignments: seedAssignments(clients, team),
    compliance: defaultCompliance(),
    sessionRole: "owner",
  };
  return writeAgency(agency);
}

export function requireAgency(): AgencyAccount {
  const agency = readAgency();
  if (!agency) throw new Error("no_agency");
  return agency;
}

export function getActiveClient(agency: AgencyAccount): ClientWorkspace | null {
  if (!agency.activeClientId) return agency.clients[0] || null;
  return agency.clients.find((c) => c.id === agency.activeClientId) || agency.clients[0] || null;
}

export function updateClient(
  agency: AgencyAccount,
  clientId: string,
  updater: (client: ClientWorkspace) => ClientWorkspace
): AgencyAccount {
  const clients = agency.clients.map((c) => (c.id === clientId ? updater(c) : c));
  return writeAgency({ ...agency, clients });
}

export function updateActiveClient(
  agency: AgencyAccount,
  updater: (client: ClientWorkspace) => ClientWorkspace
): AgencyAccount {
  const active = getActiveClient(agency);
  if (!active) return agency;
  return updateClient(agency, active.id, updater);
}

export function switchActiveClient(agency: AgencyAccount, clientId: string): AgencyAccount {
  if (!agency.clients.some((c) => c.id === clientId)) return agency;
  return writeAgency({ ...agency, activeClientId: clientId });
}

export function addClient(
  agency: AgencyAccount,
  name: string,
  owner: string,
  domain?: string
): AgencyAccount {
  const client = emptyClient(name, owner, domain);
  const clients = [...agency.clients, client];
  return writeAgency({
    ...agency,
    clients,
    activeClientId: client.id,
    assignments: [
      ...agency.assignments,
      ...seedAssignments([client], agency.team).filter((a) => a.clientId === client.id),
    ],
  });
}

export function findProspectByToken(token: string): {
  agency: AgencyAccount;
  prospect: InstaReport;
} | null {
  const agency = readAgency();
  if (!agency) return null;
  const prospect = agency.prospects.find((p) => p.shareToken === token);
  if (!prospect) return null;
  return { agency, prospect };
}

export function readWorkspace(): ClientWorkspace | null {
  const agency = readAgency();
  if (!agency) return null;
  const client = getActiveClient(agency);
  if (!client) return null;
  return { ...client, email: agency.email } as ClientWorkspace & { email: string };
}

export function writeWorkspace(ws: ClientWorkspace & { email?: string }): ClientWorkspace {
  const agency = readAgency();
  if (!agency) throw new Error("no_agency");
  const { email: _e, ...client } = ws;
  return updateClient(agency, client.id, () => client as ClientWorkspace).clients.find(
    (c) => c.id === client.id
  )!;
}

export function createWorkspace(email: string): ClientWorkspace & { email: string } {
  const agency = createAgency(email);
  const client = getActiveClient(agency)!;
  return { ...client, email: agency.email };
}

export function requireWorkspace(): ClientWorkspace {
  const ws = readWorkspace();
  if (!ws) throw new Error("no_workspace");
  return ws;
}

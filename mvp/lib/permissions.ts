import type { AgencyAccount, TeamRole } from "./types";

const ROLE_RANK: Record<TeamRole, number> = {
  viewer: 1,
  strategist: 2,
  manager: 3,
  owner: 4,
};

export function canEditWorkspace(role: TeamRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.strategist;
}

export function canManageClients(role: TeamRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.manager;
}

export function canManageSettings(role: TeamRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.owner;
}

export function roleLabel(role: TeamRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function complianceReady(agency: AgencyAccount): boolean {
  const c = agency.compliance;
  return Boolean(c?.gdprAcknowledged && c?.consentLogged && c?.dpaSigned);
}

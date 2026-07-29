import type { AgencyAccount, CapacityAssignment, ClientWorkspace, TeamMember } from "./types";

export type MemberUtilization = {
  member: TeamMember;
  assignedHours: number;
  capacity: number;
  utilizationPct: number;
  overloaded: boolean;
  clientHours: { clientId: string; clientName: string; hours: number }[];
};

export type ClientProfitability = {
  client: ClientWorkspace;
  hours: number;
  laborCost: number;
  retainer: number;
  margin: number;
  marginPct: number;
  draining: boolean;
};

export function defaultTeam(): TeamMember[] {
  return [
    {
      id: "tm-lead",
      name: "You (Lead)",
      role: "Marketing Manager",
      teamRole: "owner",
      weeklyCapacityHours: 40,
      hourlyCost: 85,
    },
    {
      id: "tm-jamie",
      name: "Jamie",
      role: "Strategist",
      teamRole: "strategist",
      weeklyCapacityHours: 40,
      hourlyCost: 55,
    },
    {
      id: "tm-alex",
      name: "Alex",
      role: "Media Buyer",
      teamRole: "manager",
      weeklyCapacityHours: 40,
      hourlyCost: 50,
    },
    {
      id: "tm-sam",
      name: "Sam",
      role: "Content",
      teamRole: "viewer",
      weeklyCapacityHours: 35,
      hourlyCost: 45,
    },
  ];
}

export function seedAssignments(
  clients: ClientWorkspace[],
  team: TeamMember[]
): CapacityAssignment[] {
  if (clients.length === 0) return [];
  const rows: CapacityAssignment[] = [];
  clients.forEach((c, idx) => {
    const owner =
      team.find((t) => t.name.toLowerCase().includes(c.owner.toLowerCase())) ||
      team[Math.min(idx + 1, team.length - 1)];
    rows.push({
      id: `asg-${c.id}-owner`,
      memberId: owner.id,
      clientId: c.id,
      hoursThisWeek: 8 + (idx % 3) * 4,
    });
    if (team[0]) {
      rows.push({
        id: `asg-${c.id}-lead`,
        memberId: team[0].id,
        clientId: c.id,
        hoursThisWeek: 3,
      });
    }
  });
  return rows;
}

export function memberUtilization(agency: AgencyAccount): MemberUtilization[] {
  return agency.team.map((member) => {
    const rows = agency.assignments.filter((a) => a.memberId === member.id);
    const assignedHours = rows.reduce((sum, a) => sum + a.hoursThisWeek, 0);
    const clientHours = rows.map((a) => {
      const client = agency.clients.find((c) => c.id === a.clientId);
      return {
        clientId: a.clientId,
        clientName: client?.name || "Unknown",
        hours: a.hoursThisWeek,
      };
    });
    const utilizationPct = Math.round((assignedHours / Math.max(member.weeklyCapacityHours, 1)) * 100);
    return {
      member,
      assignedHours,
      capacity: member.weeklyCapacityHours,
      utilizationPct,
      overloaded: utilizationPct > 90,
      clientHours,
    };
  });
}

export function clientProfitability(agency: AgencyAccount): ClientProfitability[] {
  return agency.clients.map((client) => {
    const rows = agency.assignments.filter((a) => a.clientId === client.id);
    let laborCost = 0;
    let hours = 0;
    for (const row of rows) {
      const member = agency.team.find((t) => t.id === row.memberId);
      if (!member) continue;
      hours += row.hoursThisWeek;
      laborCost += row.hoursThisWeek * member.hourlyCost;
    }
    // Approximate monthly margin from weekly labor × 4.3
    const monthlyLabor = Math.round(laborCost * 4.3);
    const retainer = client.retainerMonthly || 0;
    const margin = retainer - monthlyLabor;
    const marginPct = retainer > 0 ? Math.round((margin / retainer) * 100) : 0;
    return {
      client,
      hours,
      laborCost: monthlyLabor,
      retainer,
      margin,
      marginPct,
      draining: retainer > 0 ? marginPct < 20 : hours > 12,
    };
  });
}

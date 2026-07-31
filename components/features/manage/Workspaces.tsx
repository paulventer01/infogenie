"use client";

// Native React port of the legacy `workspaces` panel (was
// `window.buildWorkspaces` inline in app.js + `#view-workspaces`).
// Workspaces & Team console: lists workspaces, a recent-activity audit log and
// the team-members table from the existing Express API (`/api/workspaces`).
// Switching a workspace is a local selection; rows render real API data or an
// explicit empty state.

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface Workspace {
  id: string;
  name: string;
  active?: boolean;
  members?: number;
  campaigns?: number;
  plan?: string;
  color?: string;
}
interface Member {
  name: string;
  email: string;
  role: string;
  lastActive?: string;
  twofa?: boolean;
}
interface AuditEntry {
  user: string;
  role: string;
  action: string;
  when?: string;
  workspace?: string;
}
interface WorkspacesPayload {
  ok: boolean;
  error?: string;
  workspaces?: Workspace[];
  members?: Member[];
  audit?: AuditEntry[];
}

const ROLE_COLORS: Record<string, string> = {
  Owner: "#7E22CE",
  "Tenant Owner": "#7E22CE",
  Admin: "#1E40AF",
  Editor: "#10B981",
  Viewer: "#64748B",
  Member: "#64748B",
};
const roleColor = (r: string) => {
  if (ROLE_COLORS[r]) return ROLE_COLORS[r];
  if (/owner/i.test(r)) return "#7E22CE";
  if (/admin/i.test(r)) return "#1E40AF";
  return "#64748B";
};

export default function Workspaces() {
  const toast = useToast();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await apiGet<WorkspacesPayload>("/api/workspaces");
      if (cancelled) return;
      if (d.ok) {
        setWorkspaces(d.workspaces || []);
        setMembers(d.members || []);
        setAudit(d.audit || []);
      } else {
        setError(d.error || "Failed to load workspaces");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function switchWorkspace(id: string) {
    setWorkspaces((ws) => ws.map((w) => ({ ...w, active: w.id === id })));
    toast("✓ Switched workspace");
  }

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        <div style={{ textAlign: "center", color: "#64748B", padding: 40 }}>
          ⏳ Loading workspaces…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        <div
          style={{
            background: "#FEE2E2",
            border: "1px solid #FCA5A5",
            color: "#B91C1C",
            borderRadius: 10,
            padding: 14,
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  const activeWs = workspaces.find((w) => w.active);

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Workspaces &amp; Team
              </div>
              <h2 className="view-title">👥 Workspaces &amp; Team</h2>
              <p className="view-sub">
                Manage team members, assign roles and permissions, and organise
                work across multiple brand or client workspaces within a single
                InfoGenie account.
              </p>
            </div>
          </div>
        </div>
      </div>
    <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            background: "white",
            borderRadius: 12,
            padding: 18,
            border: "1px solid #E2E8F0",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 800, color: "#1E293B" }}>
              Workspaces ({workspaces.length})
            </div>
            <button
              onClick={() => toast("Workspace management is not available yet")}
              style={{
                padding: "6px 12px",
                background: "#BE185D",
                color: "white",
                border: "none",
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              + New Workspace
            </button>
          </div>
          {workspaces.length === 0 ? (
            <div
              style={{
                color: "#94A3B8",
                textAlign: "center",
                padding: 20,
                fontSize: 13,
              }}
            >
              No workspaces yet.
            </div>
          ) : (
            workspaces.map((w) => (
              <div
                key={w.id}
                onClick={() => switchWorkspace(w.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 12,
                  background: w.active ? "#FDF2F8" : "#F8FAFC",
                  border: `1.5px solid ${w.active ? "#F9A8D4" : "transparent"}`,
                  borderRadius: 8,
                  marginBottom: 8,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: `linear-gradient(135deg,${w.color || "#BE185D"},${(w.color || "#BE185D") + "aa"})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontWeight: 800,
                    fontSize: 16,
                  }}
                >
                  {(w.name || "?")[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#1E293B",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {w.name}{" "}
                    {w.active ? (
                      <span
                        style={{
                          fontSize: 10,
                          background: "#10B981",
                          color: "white",
                          padding: "2px 6px",
                          borderRadius: 99,
                          fontWeight: 700,
                        }}
                      >
                        CURRENT
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748B" }}>
                    {w.members ?? 0} members • {w.campaigns ?? 0} campaigns • {w.plan}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toast("Settings opened");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#94A3B8",
                    cursor: "pointer",
                    padding: 6,
                    fontSize: 16,
                  }}
                >
                  ⚙
                </button>
              </div>
            ))
          )}
        </div>

        <div
          style={{
            background: "white",
            borderRadius: 12,
            padding: 18,
            border: "1px solid #E2E8F0",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 800, color: "#1E293B" }}>Recent activity</div>
            <button
              onClick={() => toast("Audit log exported")}
              style={{
                padding: "6px 12px",
                background: "#F1F5F9",
                color: "#1E293B",
                border: "1px solid #E2E8F0",
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              ⬇ Export
            </button>
          </div>
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {audit.length === 0 ? (
              <div
                style={{
                  color: "#94A3B8",
                  textAlign: "center",
                  padding: 20,
                  fontSize: 13,
                }}
              >
                No recent activity.
              </div>
            ) : (
              audit.map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: 10,
                    borderBottom: "1px solid #F1F5F9",
                    fontSize: 13,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: `${roleColor(a.role)}20`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: roleColor(a.role),
                      fontWeight: 800,
                      fontSize: 12,
                      flexShrink: 0,
                    }}
                  >
                    {(a.user || "?")[0]}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#1E293B" }}>
                      <strong>{a.user}</strong> {a.action}
                    </div>
                    <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                      {a.when} • {a.workspace}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          background: "white",
          borderRadius: 12,
          border: "1px solid #E2E8F0",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            background: "#F8FAFC",
            borderBottom: "1px solid #E2E8F0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 800, color: "#1E293B" }}>
              Team Members ({members.length})
            </div>
            <div style={{ fontSize: 12, color: "#64748B" }}>
              Workspace: {activeWs ? activeWs.name : "—"}
            </div>
          </div>
          <button
            onClick={() => toast("Team management is not available yet")}
            style={{
              padding: "8px 16px",
              background: "#BE185D",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            + Invite Member
          </button>
        </div>
        {members.length === 0 ? (
          <div
            style={{
              color: "#94A3B8",
              textAlign: "center",
              padding: 34,
              fontSize: 13,
            }}
          >
            No team members yet.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: "#F8FAFC" }}>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "10px 18px",
                    color: "#64748B",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".05em",
                  }}
                >
                  MEMBER
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "10px 18px",
                    color: "#64748B",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  ROLE
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "10px 18px",
                    color: "#64748B",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  LAST ACTIVE
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "10px 18px",
                    color: "#64748B",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  2FA
                </th>
                <th style={{ textAlign: "right", padding: "10px 18px" }} />
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={i} style={{ borderTop: "1px solid #F1F5F9" }}>
                  <td style={{ padding: "11px 18px" }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          background: `linear-gradient(135deg,${roleColor(m.role)},${roleColor(m.role) + "aa"})`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "white",
                          fontWeight: 800,
                          fontSize: 12,
                        }}
                      >
                        {(m.name || "?")[0]}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, color: "#1E293B" }}>
                          {m.name}
                        </div>
                        <div style={{ fontSize: 11, color: "#64748B" }}>
                          {m.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "11px 18px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "3px 10px",
                        background: `${roleColor(m.role)}15`,
                        color: roleColor(m.role),
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {m.role}
                    </span>
                  </td>
                  <td style={{ padding: "11px 18px", color: "#475569" }}>
                    {m.lastActive}
                  </td>
                  <td style={{ padding: "11px 18px" }}>
                    {m.twofa ? (
                      <span style={{ color: "#10B981", fontWeight: 700 }}>✓ ON</span>
                    ) : (
                      <span style={{ color: "#EF4444", fontWeight: 700 }}>⚠ OFF</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", padding: "11px 18px" }}>
                    <button
                      onClick={() => toast("Member settings opened")}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#94A3B8",
                        cursor: "pointer",
                        padding: 6,
                        fontSize: 14,
                      }}
                    >
                      ⋯
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
    </div>
  );
}

"use client";

// Native React port of the legacy `admin` panel (was `window.buildAdmin` +
// the `_admin*` helpers inline in app.js, rendering into `#view-admin`).
// Admin Portal: an owner/admin-only multi-tab workspace (Data Mode · Workspaces
// · Clients · Users & Roles · Platform APIs · Permissions · Audit Log · Issues)
// for managing tenants, members, platform API keys, the role/permission model,
// the audit trail and data-honesty issues. Every sub-tab fetches the SAME
// `/api/admin/*` Express endpoints the legacy builder used, via lib/api.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiBlob, type ApiResult } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

// ── Typed payloads ──────────────────────────────────────────────────────────
interface DataModeResult extends ApiResult {
  platformDefault?: string;
}
interface Workspace {
  id: number;
  name: string;
  slug: string;
  member_count?: number;
  client_count?: number;
  data_mode_default?: string;
  status?: string;
}
interface WorkspacesResult extends ApiResult {
  workspaces?: Workspace[];
}
interface Member {
  user_id: number;
  name?: string;
  email: string;
  status?: string;
  role_name?: string;
  role_key?: string;
  invited_by_email?: string;
}
interface MembersResult extends ApiResult {
  members?: Member[];
}
interface Role {
  key: string;
  name: string;
  scope: string;
  description?: string;
  permissionCount?: number;
  permissions?: string[];
}
interface RolesResult extends ApiResult {
  roles?: Role[];
}
interface Client {
  id: number;
  name: string;
  website?: string;
  tenant_name?: string;
  data_mode?: string;
}
interface ClientsResult extends ApiResult {
  clients?: Client[];
}
interface Membership {
  tenant: string;
  tenantId: number;
  role: string;
}
interface User {
  id: number;
  name?: string;
  email: string;
  is_owner?: boolean;
  platform_role?: string;
  memberships?: Membership[];
}
interface UsersResult extends ApiResult {
  users?: User[];
}
interface Invite {
  email: string;
  name?: string;
  workspace?: string;
  role_name?: string;
  invited_by_email?: string;
  tenant_id: number;
  user_id: number;
}
interface InvitesResult extends ApiResult {
  invites?: Invite[];
}
interface InviteActionResult extends ApiResult {
  emailSent?: boolean;
  email?: string;
  mailError?: string;
}
interface PermPermission {
  key: string;
  label: string;
}
interface PermArea {
  area: string;
  permissions?: PermPermission[];
}
interface PermComponent {
  view: string;
  permission?: string;
  permissionLabel?: string;
}
interface PermMatrixResult extends ApiResult {
  roles?: Role[];
  areas?: PermArea[];
  components?: PermComponent[];
}
interface LastTest {
  status?: string;
  message?: string;
  testedAt?: string;
}
interface PlatformKeyItem {
  key: string;
  label: string;
  desc?: string;
  configured?: boolean;
  masked?: string;
  source?: string;
  secret?: boolean;
  testable?: boolean;
  noTest?: boolean;
  lastTest?: LastTest;
}
interface PlatformKeyGroup {
  group: string;
  items?: PlatformKeyItem[];
}
interface PlatformKeysResult extends ApiResult {
  groups?: PlatformKeyGroup[];
}
interface KeyTestVerdict {
  status?: string;
  message?: string;
  lastTest?: LastTest;
}
interface TestKeyResult extends ApiResult {
  result?: KeyTestVerdict;
}
interface TestAllResult extends ApiResult {
  results?: Record<string, KeyTestVerdict>;
}
interface AuditEntry {
  created_at?: string;
  action?: string;
  actor_email?: string;
  actor_user_id?: number;
  target_email?: string;
  target_user_id?: number;
  workspace_name?: string;
  old_role?: string;
  new_role?: string;
  detail?: string;
}
interface AuditResult extends ApiResult {
  entries?: AuditEntry[];
}
interface Issue {
  id: number;
  severity?: string;
  title?: string;
  detail?: string;
  source?: string;
  occurrence_count?: number;
  tenant_name?: string;
  client_name?: string;
  route?: string;
  status?: string;
}
interface IssuesResult extends ApiResult {
  issues?: Issue[];
  counts?: Record<string, number>;
  severityCounts?: Record<string, number>;
}

// ── admin API helpers (mirror legacy _adminFetch: `/api/admin` prefix) ───────
const adminGet = <T extends object = ApiResult>(p: string) => apiFetch<T>("/api/admin" + p);
const adminSend = <T extends object = ApiResult>(p: string, method: string, body?: unknown) =>
  apiFetch<T>("/api/admin" + p, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

function errText(r: ApiResult): string {
  return r.error || "unknown error";
}

// Relative-time formatter for the platform-key health dots (e.g. "5m ago").
function relTime(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  if (s < 90) return "1m ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 30) return d + "d ago";
  const mo = Math.floor(d / 30);
  if (mo < 12) return mo + "mo ago";
  return Math.floor(mo / 12) + "y ago";
}

async function download(
  path: string,
  accept: string,
  filename: string,
  okMsg: string,
  toast: (m: string) => void,
): Promise<void> {
  try {
    const blob = await apiBlob("/api/admin" + path, { headers: { Accept: accept } });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(okMsg);
  } catch (e) {
    toast("⚠️ " + (e instanceof Error ? e.message : String(e)));
  }
}

const loadingBox = (
  <div style={{ padding: 30, textAlign: "center", color: "#64748B" }}>Loading…</div>
);

const TABS = [
  { id: "data-mode", label: "🎛️ Data Mode" },
  { id: "workspaces", label: "🏢 Workspaces" },
  { id: "clients", label: "👤 Clients" },
  { id: "users", label: "👥 Users & Roles" },
  { id: "platform-keys", label: "🔑 Platform APIs" },
  { id: "permissions", label: "🧩 Permissions" },
  { id: "audit", label: "📜 Audit Log" },
  { id: "issues", label: "🚨 Issues" },
] as const;

// ════════════════════════════════════════════════════════════════════════════
// Data Mode tab
// ════════════════════════════════════════════════════════════════════════════
function DataModeTab() {
  const toast = useToast();
  const [mode, setMode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await adminGet<DataModeResult>("/data-mode");
      if (cancelled) return;
      if (d.ok === false) setError(errText(d));
      else setMode(d.platformDefault || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function setPlatformMode(m: string) {
    const r = await adminSend<ApiResult>("/data-mode", "PUT", { mode: m });
    if (r.ok) {
      toast("✓ Platform data mode set to " + m);
      setReloadKey((k) => k + 1);
    } else {
      toast("⚠️ " + errText(r));
    }
  }

  if (error)
    return (
      <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 18, color: "#991B1B" }}>
        ⚠️ {error}
      </div>
    );
  if (mode === null) return loadingBox;

  const card = (m: string, title: string, desc: React.ReactNode, icon: string) => {
    const on = mode === m;
    const accent = m === "strict" ? "#0F766E" : "#B45309";
    return (
      <button
        onClick={() => setPlatformMode(m)}
        style={{
          flex: 1,
          textAlign: "left",
          cursor: "pointer",
          background: on ? (m === "strict" ? "#F0FDFA" : "#FFFBEB") : "#fff",
          border: `2px solid ${on ? accent : "#E2E8F0"}`,
          borderRadius: 12,
          padding: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 22 }}>{icon}</span>
          <span style={{ fontWeight: 800, color: "#1E293B", fontSize: 15 }}>{title}</span>
          {on && (
            <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: accent, background: accent + "1a", padding: "3px 10px", borderRadius: 99 }}>
              ACTIVE
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>{desc}</div>
      </button>
    );
  };

  return (
    <>
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, padding: 22, marginBottom: 18 }}>
        <div style={{ fontWeight: 800, color: "#1E293B", fontSize: 16, marginBottom: 4 }}>
          Platform data mode (default)
        </div>
        <div style={{ fontSize: 13, color: "#64748B", marginBottom: 16 }}>
          When a real data source is unavailable, this controls what InfoGenie shows. Workspaces and
          individual clients can override this below. This policy is identical in development and
          production.
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {card(
            "strict",
            "Strict — honest",
            <>
              Never show made-up numbers. When data is unavailable, show a clear &quot;data
              unavailable — reported to admin&quot; message and log an issue for you to fix.{" "}
              <strong>Recommended.</strong>
            </>,
            "🔒",
          )}
          {card(
            "demo",
            "Demo — badged",
            <>
              Show illustrative demo data so the screen is never empty, with a visible &quot;DEMO
              DATA&quot; badge on every fabricated value so no one mistakes it for real.
            </>,
            "🎭",
          )}
        </div>
      </div>
      <div style={{ background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 10, padding: 14, fontSize: 12.5, color: "#64748B" }}>
        <strong>How resolution works:</strong> a client&apos;s own setting wins → otherwise its
        workspace default → otherwise this platform default → otherwise <strong>strict</strong>.
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Workspaces tab
// ════════════════════════════════════════════════════════════════════════════
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 16px",
  color: "#64748B",
  fontSize: 11,
  fontWeight: 700,
};

function WorkspaceMembers({ tenantId }: { tenantId: number }) {
  const toast = useToast();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [tenantRoles, setTenantRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const [d, rd] = await Promise.all([
      adminGet<MembersResult>("/workspaces/" + tenantId + "/members"),
      adminGet<RolesResult>("/roles"),
    ]);
    if (d.ok === false) {
      setError(errText(d));
      return;
    }
    setMembers(d.members || []);
    setTenantRoles((rd.roles || []).filter((r) => r.scope === "tenant"));
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [d, rd] = await Promise.all([
        adminGet<MembersResult>("/workspaces/" + tenantId + "/members"),
        adminGet<RolesResult>("/roles"),
      ]);
      if (cancelled) return;
      if (d.ok === false) {
        setError(errText(d));
        return;
      }
      setMembers(d.members || []);
      setTenantRoles((rd.roles || []).filter((r) => r.scope === "tenant"));
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  async function cancelInvite(userId: number) {
    if (!confirm("Cancel this pending invite?")) return;
    const r = await adminSend("/invites/" + tenantId + "/" + userId, "DELETE");
    if (r.ok) {
      toast("✓ Invite cancelled");
      refresh();
    } else toast("⚠️ " + errText(r));
  }
  async function resendInvite(userId: number) {
    const friendly: Record<string, string> = {
      not_a_pending_invite: "This invite is no longer pending",
      bad_id: "Invalid invite",
    };
    const r = await adminSend<InviteActionResult>(
      "/invites/" + tenantId + "/" + userId + "/resend",
      "POST",
    );
    if (r.ok) {
      toast(r.emailSent ? "✓ Invite re-sent to " + r.email : "Invite re-issued, but email failed: " + (r.mailError || "mail not configured"));
      refresh();
    } else toast("⚠️ " + (friendly[r.error || ""] || errText(r)));
  }
  async function removeMember(userId: number) {
    if (!confirm("Remove this user from the workspace?")) return;
    const r = await adminSend("/workspaces/" + tenantId + "/members/" + userId, "DELETE");
    if (r.ok) {
      toast("✓ Removed");
      refresh();
    } else toast("⚠️ " + errText(r));
  }
  async function setMemberRole(userId: number, roleKey: string) {
    const r = await adminSend("/workspaces/" + tenantId + "/members/" + userId, "PATCH", { roleKey });
    if (r.ok) toast("✓ Role updated");
    else toast("⚠️ " + errText(r));
    refresh();
  }

  if (error)
    return <div style={{ padding: 14, color: "#B91C1C", fontSize: 12 }}>⚠️ {error}</div>;
  if (members === null)
    return <div style={{ padding: 14, color: "#94A3B8", fontSize: 12 }}>Loading members…</div>;
  if (!members.length)
    return <div style={{ padding: 14, color: "#94A3B8", fontSize: 12 }}>No members yet.</div>;

  const cellTh: React.CSSProperties = {
    textAlign: "left",
    padding: "7px 12px",
    color: "#64748B",
    fontSize: 10,
    fontWeight: 700,
  };

  return (
    <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden", marginTop: 4 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ background: "#F8FAFC" }}>
          <tr>
            <th style={cellTh}>MEMBER</th>
            <th style={cellTh}>ROLE</th>
            <th style={cellTh}>STATUS</th>
            <th style={{ padding: "7px 12px" }} />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const pending = m.status === "invited";
            const name = m.name || m.email;
            return (
              <tr key={m.user_id} style={{ borderTop: "1px solid #EEF2F7" }}>
                <td style={{ padding: "8px 12px" }}>
                  <div style={{ fontWeight: 700, color: "#1E293B", fontSize: 12.5 }}>{name}</div>
                  <div style={{ fontSize: 11, color: "#94A3B8" }}>{m.email}</div>
                </td>
                <td style={{ padding: "8px 12px" }}>
                  {pending || !tenantRoles.length ? (
                    <span style={{ color: "#475569", fontSize: 12 }}>{m.role_name || "—"}</span>
                  ) : (
                    <select
                      value={m.role_key || ""}
                      onChange={(e) => setMemberRole(m.user_id, e.target.value)}
                      style={{ fontSize: 11, padding: "3px 6px", border: "1px solid #E2E8F0", borderRadius: 6 }}
                    >
                      {tenantRoles.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  {pending ? (
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#92400E", background: "#FEF3C7", padding: "2px 8px", borderRadius: 99, letterSpacing: ".3px" }}>
                      PENDING
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#065F46", background: "#D1FAE5", padding: "2px 8px", borderRadius: 99, letterSpacing: ".3px" }}>
                      ACTIVE
                    </span>
                  )}
                  {pending && m.invited_by_email && (
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>Invited by {m.invited_by_email}</div>
                  )}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}>
                  {pending ? (
                    <>
                      <button onClick={() => resendInvite(m.user_id)} style={{ border: "1px solid #BAE6FD", background: "#F0F9FF", color: "#0369A1", borderRadius: 6, fontSize: 11, padding: "4px 10px", cursor: "pointer", fontWeight: 700, marginRight: 6 }}>
                        Resend
                      </button>
                      <button onClick={() => cancelInvite(m.user_id)} style={{ border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", borderRadius: 6, fontSize: 11, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button onClick={() => removeMember(m.user_id)} style={{ border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", borderRadius: 6, fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WorkspacesTab() {
  const toast = useToast();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await adminGet<WorkspacesResult>("/workspaces");
      if (cancelled) return;
      if (d.ok === false) setError(errText(d));
      else setWorkspaces(d.workspaces || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function addWorkspace() {
    const name = prompt("New workspace name?");
    if (!name) return;
    const r = await adminSend("/workspaces", "POST", { name });
    if (r.ok) {
      toast("✓ Workspace created");
      setReloadKey((k) => k + 1);
    } else toast("⚠️ " + errText(r));
  }
  async function setWsMode(id: number, mode: string) {
    const r = await adminSend("/workspaces/" + id, "PATCH", { data_mode_default: mode });
    if (r.ok) toast("✓ Workspace data mode updated");
    else {
      toast("⚠️ " + errText(r));
      setReloadKey((k) => k + 1);
    }
  }

  if (error)
    return (
      <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 18, color: "#991B1B" }}>
        ⚠️ {error}
      </div>
    );
  if (workspaces === null) return loadingBox;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontWeight: 800, color: "#1E293B" }}>Workspaces ({workspaces.length})</div>
        <button onClick={addWorkspace} style={{ padding: "7px 14px", background: "#1E293B", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
          + New Workspace
        </button>
      </div>
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ background: "#F8FAFC" }}>
            <tr>
              <th style={thStyle}>WORKSPACE</th>
              <th style={thStyle}>MEMBERS</th>
              <th style={thStyle}>CLIENTS</th>
              <th style={thStyle}>DATA MODE DEFAULT</th>
              <th style={thStyle}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((w) => {
              const open = !!expanded[w.id];
              const mc = w.member_count || 0;
              return (
                <Fragment key={w.id}>
                  <tr style={{ borderTop: "1px solid #F1F5F9" }}>
                    <td style={{ padding: "11px 16px" }}>
                      <div style={{ fontWeight: 700, color: "#1E293B" }}>{w.name}</div>
                      <div style={{ fontSize: 11, color: "#94A3B8" }}>{w.slug}</div>
                    </td>
                    <td style={{ padding: "11px 16px", color: "#475569" }}>
                      <button
                        onClick={() => setExpanded((p) => ({ ...p, [w.id]: !p[w.id] }))}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "1px solid #E2E8F0", borderRadius: 7, padding: "4px 9px", fontSize: 12, color: "#334155", cursor: "pointer" }}
                      >
                        <span style={{ fontSize: 9, color: "#94A3B8" }}>{open ? "▼" : "▶"}</span>
                        {mc} member{mc === 1 ? "" : "s"}
                      </button>
                    </td>
                    <td style={{ padding: "11px 16px", color: "#475569" }}>{w.client_count || 0}</td>
                    <td style={{ padding: "11px 16px" }}>
                      <select
                        value={w.data_mode_default || "inherit"}
                        onChange={(e) => setWsMode(w.id, e.target.value)}
                        style={{ padding: "5px 8px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 12 }}
                      >
                        {["inherit", "demo", "strict"].map((m) => (
                          <option key={m} value={m}>
                            {m === "inherit" ? "Inherit platform" : m}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: "11px 16px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: w.status === "active" ? "#065F46" : "#92400E", background: w.status === "active" ? "#D1FAE5" : "#FEF3C7", padding: "3px 9px", borderRadius: 99 }}>
                        {w.status}
                      </span>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={5} style={{ padding: "0 16px 14px 16px", background: "#FBFCFE" }}>
                        <WorkspaceMembers tenantId={w.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Clients tab
// ════════════════════════════════════════════════════════════════════════════
function ClientsTab() {
  const toast = useToast();
  const [clients, setClients] = useState<Client[] | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [newWs, setNewWs] = useState("");
  const [newName, setNewName] = useState("");
  const [newSite, setNewSite] = useState("");
  // Read the active client preview context the legacy SPA may have set (guarded).
  const [previewId, setPreviewId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = (window as unknown as { _activeClientId?: number })._activeClientId;
    return typeof v === "number" ? v : null;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cd, wd] = await Promise.all([
        adminGet<ClientsResult>("/clients"),
        adminGet<WorkspacesResult>("/workspaces"),
      ]);
      if (cancelled) return;
      if (cd.ok === false) {
        setError(errText(cd));
        return;
      }
      setClients(cd.clients || []);
      const ws = wd.workspaces || [];
      setWorkspaces(ws);
      setNewWs((prev) => prev || (ws[0] ? String(ws[0].id) : ""));
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function addClient() {
    const name = newName.trim();
    if (!name) {
      toast("⚠️ Enter a client name");
      return;
    }
    const r = await adminSend("/clients", "POST", {
      tenantId: Number(newWs),
      name,
      website: newSite.trim(),
    });
    if (r.ok) {
      toast("✓ Client added");
      setNewName("");
      setNewSite("");
      setReloadKey((k) => k + 1);
    } else toast("⚠️ " + errText(r));
  }
  async function setClientMode(id: number, mode: string) {
    const r = await adminSend("/clients/" + id, "PATCH", { data_mode: mode });
    if (r.ok) toast("✓ Client data mode updated");
    else {
      toast("⚠️ " + errText(r));
      setReloadKey((k) => k + 1);
    }
  }
  function previewClient(id: number) {
    const turningOff = previewId === id;
    setPreviewId(turningOff ? null : id);
    toast(turningOff ? "👁 Stopped previewing client" : "👁 Now previewing as client #" + id);
  }
  async function archiveClient(id: number) {
    if (!confirm("Archive this client?")) return;
    const r = await adminSend("/clients/" + id, "DELETE");
    if (r.ok) {
      toast("✓ Client archived");
      setReloadKey((k) => k + 1);
    } else toast("⚠️ " + errText(r));
  }

  if (error)
    return (
      <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 18, color: "#991B1B" }}>
        ⚠️ {error}
      </div>
    );
  if (clients === null) return loadingBox;

  const lbl: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: "#64748B",
    display: "block",
    marginBottom: 4,
  };
  const inp: React.CSSProperties = {
    width: "100%",
    padding: "7px 10px",
    border: "1px solid #CBD5E1",
    borderRadius: 6,
    fontSize: 13,
  };

  return (
    <>
      <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: 14, marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={lbl}>WORKSPACE</label>
          <select value={newWs} onChange={(e) => setNewWs(e.target.value)} style={{ padding: "7px 10px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13 }}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={lbl}>CLIENT NAME</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Acme Corp" style={inp} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={lbl}>WEBSITE (optional)</label>
          <input value={newSite} onChange={(e) => setNewSite(e.target.value)} placeholder="acme.com" style={inp} />
        </div>
        <button onClick={addClient} style={{ padding: "8px 16px", background: "#1E293B", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          + Add Client
        </button>
      </div>
      {clients.length ? (
        <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: "#F8FAFC" }}>
              <tr>
                <th style={thStyle}>CLIENT</th>
                <th style={thStyle}>WORKSPACE</th>
                <th style={thStyle}>DATA MODE</th>
                <th style={{ textAlign: "right", padding: "10px 16px" }} />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid #F1F5F9" }}>
                  <td style={{ padding: "11px 16px" }}>
                    <div style={{ fontWeight: 700, color: "#1E293B" }}>{c.name}</div>
                    {c.website && <div style={{ fontSize: 11, color: "#94A3B8" }}>{c.website}</div>}
                  </td>
                  <td style={{ padding: "11px 16px", color: "#475569" }}>{c.tenant_name}</td>
                  <td style={{ padding: "11px 16px" }}>
                    <select
                      value={c.data_mode || "inherit"}
                      onChange={(e) => setClientMode(c.id, e.target.value)}
                      style={{ padding: "5px 8px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 12 }}
                    >
                      {["inherit", "demo", "strict"].map((m) => (
                        <option key={m} value={m}>
                          {m === "inherit" ? "Inherit workspace" : m}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "11px 16px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => previewClient(c.id)}
                      title="View the app as this client — applies its data mode across the dashboard"
                      style={{ background: previewId === c.id ? "#0F766E" : "none", border: "1px solid #5EEAD4", color: previewId === c.id ? "#fff" : "#0F766E", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", marginRight: 6 }}
                    >
                      {previewId === c.id ? "✓ Previewing" : "👁 Preview"}
                    </button>
                    <button onClick={() => archiveClient(c.id)} style={{ background: "none", border: "1px solid #FCA5A5", color: "#DC2626", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>
                      Archive
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ background: "white", border: "1px dashed #CBD5E1", borderRadius: 12, padding: 34, textAlign: "center", color: "#94A3B8" }}>
          No clients yet. Add one above to control its data mode.
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Users & Roles tab
// ════════════════════════════════════════════════════════════════════════════
function UsersTab() {
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteWs, setInviteWs] = useState("");
  const [inviteRole, setInviteRole] = useState("marketer");
  const [addWsByUser, setAddWsByUser] = useState<Record<number, string>>({});
  const [addRoleByUser, setAddRoleByUser] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ud, rd, wd, vd] = await Promise.all([
        adminGet<UsersResult>("/users"),
        adminGet<RolesResult>("/roles"),
        adminGet<WorkspacesResult>("/workspaces"),
        adminGet<InvitesResult>("/invites"),
      ]);
      if (cancelled) return;
      if (ud.ok === false) {
        setError(errText(ud));
        return;
      }
      setUsers(ud.users || []);
      setRoles(rd.roles || []);
      const ws = wd.workspaces || [];
      setWorkspaces(ws);
      setInvites(vd.invites || []);
      setInviteWs((prev) => prev || (ws[0] ? String(ws[0].id) : ""));
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const tenantRoles = roles.filter((r) => r.scope === "tenant");

  async function setPlatformRole(userId: number, roleKey: string) {
    const r = await adminSend("/users/" + userId + "/platform-role", "PATCH", { roleKey });
    if (r.ok) toast("✓ Platform role updated");
    else toast("⚠️ " + errText(r));
    setReloadKey((k) => k + 1);
  }
  async function setMemberRole(tenantId: number, userId: number, roleKey: string) {
    const r = await adminSend("/workspaces/" + tenantId + "/members/" + userId, "PATCH", { roleKey });
    if (r.ok) toast("✓ Role updated");
    else {
      toast("⚠️ " + errText(r));
      setReloadKey((k) => k + 1);
    }
  }
  async function removeMember(tenantId: number, userId: number) {
    if (!confirm("Remove this user from the workspace?")) return;
    const r = await adminSend("/workspaces/" + tenantId + "/members/" + userId, "DELETE");
    if (r.ok) {
      toast("✓ Removed");
      setReloadKey((k) => k + 1);
    } else toast("⚠️ " + errText(r));
  }
  async function addMember(userId: number) {
    const tenantId = Number(addWsByUser[userId]);
    const roleKey = addRoleByUser[userId] || "marketer";
    if (!tenantId) {
      toast("Pick a workspace first");
      return;
    }
    const r = await adminSend("/workspaces/" + tenantId + "/members", "POST", { userId, roleKey });
    if (r.ok) {
      toast("✓ Added to workspace");
      setReloadKey((k) => k + 1);
    } else toast("⚠️ " + errText(r));
  }
  async function sendInvite() {
    const email = inviteEmail.trim();
    const tenantId = Number(inviteWs);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast("Enter a valid email");
      return;
    }
    if (!tenantId) {
      toast("Pick a workspace first");
      return;
    }
    const friendly: Record<string, string> = {
      bad_email: "Enter a valid email",
      bad_role: "Pick a role",
      workspace_not_found: "Workspace not found",
      already_member: "That person is already in this workspace",
    };
    const r = await adminSend<InviteActionResult>("/invites", "POST", { email, tenantId, roleKey: inviteRole });
    if (r.ok) {
      toast(r.emailSent ? "✓ Invite emailed to " + email : "Invite created, but email failed: " + (r.mailError || "mail not configured"));
      setInviteEmail("");
      setReloadKey((k) => k + 1);
    } else toast("⚠️ " + (friendly[r.error || ""] || errText(r)));
  }
  async function cancelInvite(tenantId: number, userId: number) {
    if (!confirm("Cancel this pending invite?")) return;
    const r = await adminSend("/invites/" + tenantId + "/" + userId, "DELETE");
    if (r.ok) {
      toast("✓ Invite cancelled");
      setReloadKey((k) => k + 1);
    } else toast("⚠️ " + errText(r));
  }
  async function resendInvite(tenantId: number, userId: number) {
    const friendly: Record<string, string> = {
      not_a_pending_invite: "This invite is no longer pending",
      bad_id: "Invalid invite",
    };
    const r = await adminSend<InviteActionResult>("/invites/" + tenantId + "/" + userId + "/resend", "POST");
    if (r.ok) {
      toast(r.emailSent ? "✓ Invite re-sent to " + r.email : "Invite re-issued, but email failed: " + (r.mailError || "mail not configured"));
      setReloadKey((k) => k + 1);
    } else toast("⚠️ " + (friendly[r.error || ""] || errText(r)));
  }

  if (error)
    return (
      <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 18, color: "#991B1B" }}>
        ⚠️ {error}
      </div>
    );
  if (users === null) return loadingBox;

  return (
    <>
      {/* Invite control */}
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, marginBottom: 22 }}>
        <div style={{ fontWeight: 800, color: "#1E293B", marginBottom: 4 }}>Invite a teammate</div>
        <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 12 }}>
          Send an email invite to someone who doesn&apos;t have an InfoGenie account yet. They&apos;ll
          set a password and join the workspace in one step.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="teammate@company.com"
            style={{ flex: 1, minWidth: 200, fontSize: 13, padding: "8px 11px", border: "1px solid #E2E8F0", borderRadius: 8 }}
          />
          <select value={inviteWs} onChange={(e) => setInviteWs(e.target.value)} style={{ fontSize: 13, padding: "8px 11px", border: "1px solid #E2E8F0", borderRadius: 8 }}>
            {workspaces.length ? (
              workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))
            ) : (
              <option value="">No workspaces</option>
            )}
          </select>
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={{ fontSize: 13, padding: "8px 11px", border: "1px solid #E2E8F0", borderRadius: 8 }}>
            {tenantRoles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
          <button onClick={sendInvite} style={{ border: "none", background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 800, padding: "9px 16px", cursor: "pointer" }}>
            Send invite
          </button>
        </div>
      </div>

      {/* Pending invites */}
      <div style={{ fontWeight: 800, color: "#1E293B", margin: "0 0 12px" }}>
        Pending invites ({invites.length})
      </div>
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden", marginBottom: 22 }}>
        {invites.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: "#F8FAFC" }}>
              <tr>
                <th style={thStyle}>EMAIL</th>
                <th style={thStyle}>WORKSPACE</th>
                <th style={thStyle}>ROLE</th>
                <th style={thStyle}>INVITED</th>
                <th style={{ padding: "10px 16px" }} />
              </tr>
            </thead>
            <tbody>
              {invites.map((v) => (
                <tr key={v.tenant_id + "-" + v.user_id} style={{ borderTop: "1px solid #F1F5F9" }}>
                  <td style={{ padding: "10px 16px" }}>
                    <div style={{ fontWeight: 700, color: "#1E293B" }}>{v.email}</div>
                    {v.name && <div style={{ fontSize: 11, color: "#94A3B8" }}>{v.name}</div>}
                  </td>
                  <td style={{ padding: "10px 16px", color: "#334155" }}>{v.workspace}</td>
                  <td style={{ padding: "10px 16px", color: "#334155" }}>{v.role_name || "—"}</td>
                  <td style={{ padding: "10px 16px", fontSize: 11, color: "#94A3B8" }}>
                    {v.invited_by_email ? "by " + v.invited_by_email : ""}
                  </td>
                  <td style={{ padding: "10px 16px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => resendInvite(v.tenant_id, v.user_id)} style={{ border: "1px solid #BAE6FD", background: "#F0F9FF", color: "#0369A1", borderRadius: 6, fontSize: 11, padding: "4px 10px", cursor: "pointer", fontWeight: 700, marginRight: 6 }}>
                      Resend
                    </button>
                    <button onClick={() => cancelInvite(v.tenant_id, v.user_id)} style={{ border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", borderRadius: 6, fontSize: 11, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: 18, textAlign: "center", fontSize: 13, color: "#94A3B8" }}>
            No pending invites.
          </div>
        )}
      </div>

      {/* Platform users */}
      <div style={{ fontWeight: 800, color: "#1E293B", marginBottom: 12 }}>
        Platform users ({users.length})
      </div>
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden", marginBottom: 22 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ background: "#F8FAFC" }}>
            <tr>
              <th style={thStyle}>USER</th>
              <th style={thStyle}>PLATFORM ROLE</th>
              <th style={thStyle}>WORKSPACES &amp; ROLES</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const mems = u.memberships || [];
              const availWs = workspaces.filter((w) => !mems.some((m) => m.tenantId === w.id));
              return (
                <tr key={u.id} style={{ borderTop: "1px solid #F1F5F9" }}>
                  <td style={{ padding: "11px 16px", verticalAlign: "top" }}>
                    <div style={{ fontWeight: 700, color: "#1E293B" }}>{u.name || u.email}</div>
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>{u.email}</div>
                  </td>
                  <td style={{ padding: "11px 16px", verticalAlign: "top" }}>
                    {u.is_owner ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#7E22CE", background: "#F3E8FF", padding: "3px 9px", borderRadius: 99 }}>
                        OWNER
                      </span>
                    ) : (
                      <select
                        value={u.platform_role === "platform_admin" ? "platform_admin" : "none"}
                        onChange={(e) => setPlatformRole(u.id, e.target.value)}
                        style={{ fontSize: 12, padding: "4px 8px", border: "1px solid #E2E8F0", borderRadius: 7 }}
                      >
                        <option value="none">Regular user</option>
                        <option value="platform_admin">Platform Admin</option>
                      </select>
                    )}
                  </td>
                  <td style={{ padding: "11px 16px", verticalAlign: "top" }}>
                    {mems.length ? (
                      mems.map((m) => (
                        <div key={m.tenantId} style={{ display: "flex", alignItems: "center", gap: 6, margin: "3px 0" }}>
                          <span style={{ fontSize: 12, color: "#334155", minWidth: 120 }}>{m.tenant}</span>
                          <select
                            value={(tenantRoles.find((r) => r.name === m.role)?.key) || ""}
                            onChange={(e) => setMemberRole(m.tenantId, u.id, e.target.value)}
                            style={{ fontSize: 11, padding: "3px 6px", border: "1px solid #E2E8F0", borderRadius: 6 }}
                          >
                            {tenantRoles.map((r) => (
                              <option key={r.key} value={r.key}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                          <button onClick={() => removeMember(m.tenantId, u.id)} title="Remove from workspace" style={{ border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", borderRadius: 6, fontSize: 11, padding: "3px 7px", cursor: "pointer" }}>
                            Remove
                          </button>
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: 12, color: "#94A3B8" }}>No workspaces</div>
                    )}
                    {availWs.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                        <select
                          value={addWsByUser[u.id] || ""}
                          onChange={(e) => setAddWsByUser((p) => ({ ...p, [u.id]: e.target.value }))}
                          style={{ fontSize: 11, padding: "3px 6px", border: "1px solid #E2E8F0", borderRadius: 6 }}
                        >
                          <option value="">+ Add to workspace…</option>
                          {availWs.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={addRoleByUser[u.id] || "marketer"}
                          onChange={(e) => setAddRoleByUser((p) => ({ ...p, [u.id]: e.target.value }))}
                          style={{ fontSize: 11, padding: "3px 6px", border: "1px solid #E2E8F0", borderRadius: 6 }}
                        >
                          {tenantRoles.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                        <button onClick={() => addMember(u.id)} style={{ border: "1px solid #BBF7D0", background: "#F0FDF4", color: "#15803D", borderRadius: 6, fontSize: 11, padding: "3px 9px", cursor: "pointer", fontWeight: 700 }}>
                          Add
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* System roles */}
      <div style={{ fontWeight: 800, color: "#1E293B", marginBottom: 12 }}>System roles</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
        {roles.map((r) => (
          <div key={r.key} style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 10, padding: 14 }}>
            <div style={{ fontWeight: 700, color: "#1E293B" }}>{r.name}</div>
            <div style={{ fontSize: 11, color: "#94A3B8", margin: "3px 0 8px" }}>
              {r.scope} · {r.permissionCount} permissions
            </div>
            <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.4 }}>{r.description || ""}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Platform APIs tab
// ════════════════════════════════════════════════════════════════════════════
function healthColor(status?: string): string {
  if (status === "ok") return "#22C55E";
  if (status === "invalid") return "#EF4444";
  if (status === "unconfigured") return "#CBD5E1";
  if (status) return "#F59E0B";
  return "#CBD5E1";
}

function PlatformKeysTab() {
  const toast = useToast();
  const [groups, setGroups] = useState<PlatformKeyGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<Record<string, LastTest>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testMsg, setTestMsg] = useState<Record<string, { color: string; text: string }>>({});
  const [testingAll, setTestingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await adminGet<PlatformKeysResult>("/platform-keys");
      if (cancelled) return;
      if (d.ok === false) setError(errText(d));
      else {
        setGroups(d.groups || []);
        const seed: Record<string, LastTest> = {};
        (d.groups || []).forEach((g) =>
          (g.items || []).forEach((it) => {
            if (it.lastTest) seed[it.key] = it.lastTest;
          }),
        );
        setTests(seed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function saveKey(key: string) {
    const value = values[key] || "";
    if (value === "") {
      toast("⚠️ Enter a value to save");
      return;
    }
    const r = await adminSend("/platform-keys/" + encodeURIComponent(key), "PUT", { value });
    if (r.ok) {
      toast("✓ Saved " + key);
      setValues((p) => ({ ...p, [key]: "" }));
      setReloadKey((k) => k + 1);
    } else toast("⚠️ " + errText(r));
  }
  async function testKey(key: string) {
    setTesting((p) => ({ ...p, [key]: true }));
    setTestMsg((p) => ({ ...p, [key]: { color: "", text: "" } }));
    const r = await adminSend<TestKeyResult>("/platform-keys/" + encodeURIComponent(key) + "/test", "POST", {});
    if (r.ok && r.result) {
      const res = r.result;
      setTests((p) => ({ ...p, [key]: res.lastTest || { status: res.status, message: res.message, testedAt: new Date().toISOString() } }));
      const okv = res.status === "ok";
      setTestMsg((p) => ({ ...p, [key]: { color: okv ? "#15803D" : "#B91C1C", text: (okv ? "✓ " : "⚠️ ") + (res.message || (okv ? "OK" : "Failed")) } }));
    } else {
      setTestMsg((p) => ({ ...p, [key]: { color: "#B91C1C", text: "⚠️ " + errText(r) } }));
    }
    setTesting((p) => ({ ...p, [key]: false }));
  }
  async function testAll() {
    setTestingAll(true);
    const r = await adminSend<TestAllResult>("/platform-keys/test-all", "POST", {});
    if (r.ok && r.results) {
      const results = r.results;
      let ok = 0;
      let bad = 0;
      const nextTests: Record<string, LastTest> = {};
      const nextMsg: Record<string, { color: string; text: string }> = {};
      Object.keys(results).forEach((key) => {
        const res = results[key] || {};
        nextTests[key] = res.lastTest || { status: res.status, message: res.message, testedAt: new Date().toISOString() };
        const good = res.status === "ok";
        nextMsg[key] = { color: good ? "#15803D" : "#B91C1C", text: (good ? "✓ " : "⚠️ ") + (res.message || (good ? "OK" : "Failed")) };
        if (good) ok++;
        else bad++;
      });
      setTests((p) => ({ ...p, ...nextTests }));
      setTestMsg((p) => ({ ...p, ...nextMsg }));
      toast(`✓ Tested ${ok + bad} key(s) — ${ok} healthy, ${bad} need attention`);
    } else {
      toast("⚠️ " + errText(r));
    }
    setTestingAll(false);
  }

  if (error)
    return (
      <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 18, color: "#991B1B" }}>
        ⚠️ {error}
      </div>
    );
  if (groups === null) return loadingBox;

  const legendDot = (c: string, label: string) => (
    <span>
      <span style={{ width: 9, height: 9, borderRadius: 99, background: c, display: "inline-block", marginRight: 4 }} />
      {label}
    </span>
  );

  return (
    <>
      <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "16px 18px", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontWeight: 800, color: "#1E293B", fontSize: 16, marginBottom: 4 }}>
              🔑 Platform API Keys
            </div>
            <div style={{ fontSize: 13, color: "#64748B", lineHeight: 1.5 }}>
              These are the API keys InfoGenie operates on behalf of{" "}
              <strong>every workspace</strong> — the AI models, data vendors, and shared
              infrastructure. They are platform-wide (not per-workspace). Saving a key here stores it
              encrypted and uses it immediately; leaving a field blank keeps the existing value.
            </div>
            <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 8, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              {legendDot("#22C55E", "Healthy")}
              {legendDot("#EF4444", "Rejected")}
              {legendDot("#F59E0B", "Error")}
              {legendDot("#CBD5E1", "Not tested")}
            </div>
          </div>
          <button onClick={testAll} disabled={testingAll} style={{ border: "1px solid #CBD5E1", background: "#fff", color: "#334155", borderRadius: 8, fontSize: 13, padding: "9px 16px", cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }}>
            {testingAll ? "Testing all…" : "Test all"}
          </button>
        </div>
      </div>
      {groups.length ? (
        groups.map((g) => (
          <div key={g.group} style={{ marginBottom: 22 }}>
            <div style={{ fontWeight: 800, color: "#1E293B", fontSize: 15, marginBottom: 10 }}>{g.group}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 12 }}>
              {(g.items || []).map((it) => {
                const lt = tests[it.key];
                const ph = it.configured ? "Current: " + (it.masked || "") : it.secret ? "Not configured — paste a value to set" : "Not configured";
                const msg = testMsg[it.key];
                return (
                  <div key={it.key} style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: 14, background: "#fff" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: "#1E293B", fontSize: 14 }}>{it.label}</span>
                      {!it.configured ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", background: "#F1F5F9", padding: "3px 10px", borderRadius: 99 }}>
                          Not set
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 700, color: it.source === "db" ? "#0F766E" : "#B45309", background: it.source === "db" ? "#F0FDFA" : "#FFFBEB", padding: "3px 10px", borderRadius: 99 }}>
                          ● {it.source === "db" ? "Saved" : "From env"}
                        </span>
                      )}
                      {it.testable && (
                        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 99, background: healthColor(lt?.status), display: "inline-block", flex: "0 0 auto" }} />
                          <span suppressHydrationWarning style={{ fontSize: 11, color: "#94A3B8", fontStyle: lt?.testedAt ? "normal" : "italic" }}>
                            {lt?.testedAt ? relTime(lt.testedAt) : "never tested"}
                          </span>
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748B", marginBottom: 8 }}>{it.desc || ""}</div>
                    <div style={{ fontSize: 11, color: "#94A3B8", fontFamily: "monospace", marginBottom: 8 }}>{it.key}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        type={it.secret ? "password" : "text"}
                        value={values[it.key] || ""}
                        onChange={(e) => setValues((p) => ({ ...p, [it.key]: e.target.value }))}
                        placeholder={ph}
                        autoComplete="off"
                        style={{ flex: 1, minWidth: 200, padding: "8px 10px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: 13 }}
                      />
                      <button onClick={() => saveKey(it.key)} style={{ border: "1px solid #BBF7D0", background: "#F0FDF4", color: "#15803D", borderRadius: 8, fontSize: 12, padding: "8px 14px", cursor: "pointer", fontWeight: 700 }}>
                        Save
                      </button>
                      {it.testable ? (
                        <button onClick={() => testKey(it.key)} disabled={!!testing[it.key]} style={{ border: "1px solid #CBD5E1", background: "#fff", color: "#334155", borderRadius: 8, fontSize: 12, padding: "7px 12px", cursor: "pointer", fontWeight: 600 }}>
                          {testing[it.key] ? "Testing…" : "Test"}
                        </button>
                      ) : it.noTest ? (
                        <span title="No health endpoint to verify this value against" style={{ fontSize: 11, color: "#94A3B8", fontStyle: "italic", padding: "7px 4px" }}>
                          No test available
                        </span>
                      ) : null}
                    </div>
                    {msg && msg.text && (
                      <div style={{ fontSize: 12, marginTop: 6, color: msg.color }}>{msg.text}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      ) : (
        <div style={{ padding: 24, textAlign: "center", color: "#64748B" }}>No platform keys defined.</div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Permissions tab
// ════════════════════════════════════════════════════════════════════════════
function PermissionsTab() {
  const toast = useToast();
  const [data, setData] = useState<PermMatrixResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const viewLabelRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    // Build view → human label from the live nav links (read-only DOM access),
    // mirroring the legacy builder's single-source-of-truth approach.
    const vl: Record<string, string> = {};
    document.querySelectorAll(".nav-link[data-view]").forEach((el) => {
      const v = el.getAttribute("data-view");
      const textEl = el.querySelector(".ndl-text");
      if (v && textEl) vl[v] = (textEl.textContent || "").trim();
    });
    viewLabelRef.current = vl;
    (async () => {
      const d = await adminGet<PermMatrixResult>("/permissions-matrix");
      if (cancelled) return;
      if (d.ok === false) setError(errText(d));
      else {
        setData(d);
        if (d.roles && d.roles[0]) setSelectedRole(d.roles[0].key);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error)
    return (
      <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 18, color: "#991B1B" }}>
        ⚠️ {error}
      </div>
    );
  if (data === null) return loadingBox;

  const roles = data.roles || [];
  const areas = data.areas || [];
  const components = data.components || [];
  const viewLabel = viewLabelRef.current;
  const roleHas = roles.map((r) => ({ role: r, set: new Set(r.permissions || []) }));

  const areaByPerm: Record<string, string> = {};
  areas.forEach((a) => (a.permissions || []).forEach((p) => (areaByPerm[p.key] = a.area)));
  const mappedViews = new Set(components.map((c) => c.view));
  const unmappedViews = Object.entries(viewLabel)
    .filter(([v]) => !mappedViews.has(v))
    .sort(([a], [b]) => a.localeCompare(b));

  // View-as-role preview computation.
  const role = roles.find((r) => r.key === selectedRole);
  const has = new Set(role?.permissions || []);
  const allowed: PermComponent[] = [];
  const blocked: PermComponent[] = [];
  components.forEach((c) => {
    const okc = !c.permission || has.has(c.permission);
    (okc ? allowed : blocked).push(c);
  });
  const groupByArea = (list: PermComponent[]) => {
    const m: Record<string, PermComponent[]> = {};
    list.forEach((c) => {
      const area = (c.permission && areaByPerm[c.permission]) || "Other";
      (m[area] = m[area] || []).push(c);
    });
    return Object.keys(m)
      .sort()
      .map((area) => ({ area, items: m[area].sort((a, b) => a.view.localeCompare(b.view)) }));
  };
  const renderColumn = (list: PermComponent[], okc: boolean) => {
    if (!list.length) return <div style={{ fontSize: 12.5, color: "#94A3B8", padding: "10px 14px" }}>None.</div>;
    return groupByArea(list).map((g) => (
      <div key={g.area}>
        <div style={{ padding: "7px 14px", background: "#F8FAFC", fontSize: 10.5, fontWeight: 800, color: "#475569", letterSpacing: ".04em", textTransform: "uppercase", borderTop: "1px solid #F1F5F9" }}>
          {g.area}
        </div>
        {g.items.map((c) => {
          const label = viewLabel[c.view] || "";
          return (
            <div key={c.view} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderTop: "1px solid #F1F5F9" }}>
              <span style={{ color: okc ? "#15803D" : "#CBD5E1", fontWeight: 700, flexShrink: 0 }}>{okc ? "✓" : "✕"}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, color: "#1E293B", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {label || c.view}
                </div>
                {label && <div style={{ fontSize: 10, color: "#94A3B8", fontFamily: "ui-monospace,monospace" }}>{c.view}</div>}
              </div>
              <span style={{ fontSize: 11, color: "#94A3B8", flexShrink: 0, textAlign: "right" }}>
                {c.permissionLabel || (c.permission ? c.permission : "open to all")}
              </span>
            </div>
          );
        })}
      </div>
    ));
  };

  const todayCsv = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 18 }}>👁️</span>
        <div style={{ fontSize: 12.5, color: "#1E3A8A", lineHeight: 1.45 }}>
          <strong>Read-only.</strong> This is a live view of the platform&apos;s role &amp; permission
          model, pulled straight from the source of truth. Editing roles or building custom roles
          isn&apos;t available here.
        </div>
      </div>

      {/* Unmapped callout */}
      {unmappedViews.length === 0 ? (
        <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>✅</span>
          <div style={{ fontSize: 12.5, color: "#14532D", lineHeight: 1.45 }}>
            <strong>All nav screens are mapped.</strong> Every navigation screen has an entry in
            COMPONENT_MATRIX.
          </div>
        </div>
      ) : (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "14px 16px", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 18, lineHeight: 1.2 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#92400E" }}>
                {unmappedViews.length} unmapped screen{unmappedViews.length === 1 ? "" : "s"}
              </div>
              <div style={{ fontSize: 12, color: "#78350F", marginTop: 2 }}>
                These nav screens have no entry in COMPONENT_MATRIX and are visible to every role by
                default. Add them to the matrix if they should be gated.
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {unmappedViews.map(([v, lbl]) => (
              <span key={v} title={v} style={{ display: "inline-flex", flexDirection: "column", padding: "5px 10px", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 7 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#92400E" }}>{lbl || v}</span>
                <span style={{ fontSize: 10, color: "#B45309", fontFamily: "ui-monospace,monospace" }}>{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 4px" }}>
        <div style={{ fontWeight: 800, color: "#1E293B" }}>Roles × permissions</div>
        <div>
          <button onClick={() => download("/permissions-matrix/export", "text/csv", "permissions-matrix-" + todayCsv + ".csv", "✓ Permissions matrix exported", toast)} title="Download the role × permission grid and feature map as a CSV file" style={{ padding: "6px 12px", background: "#1E293B", border: "1px solid #1E293B", borderRadius: 7, fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer" }}>
            ⬇️ Download CSV
          </button>
          <button onClick={() => download("/permissions-matrix/export.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "permissions-matrix-" + todayCsv + ".xlsx", "✓ Permissions matrix exported as Excel", toast)} title="Download the role × permission grid and feature map as an Excel (.xlsx) workbook" style={{ padding: "6px 12px", background: "#217346", border: "1px solid #217346", borderRadius: 7, fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer", marginLeft: 6 }}>
            ⬇️ Download Excel
          </button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 12 }}>
        ✓ means the role grants that permission. Permissions are grouped by area; roles are columns.
      </div>

      {/* Matrix */}
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "auto", marginBottom: 26, maxHeight: "70vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
            <tr style={{ background: "#F1F5F9" }}>
              <th style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#64748B", position: "sticky", left: 0, background: "#F1F5F9", zIndex: 3, minWidth: 240 }}>
                PERMISSION
              </th>
              {roleHas.map(({ role: r }) => (
                <th key={r.key} title={r.description || ""} style={{ padding: "9px 8px", textAlign: "center", fontSize: 11, fontWeight: 700, color: "#1E293B", borderLeft: "1px solid #F1F5F9", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
                  {r.name}
                  <div style={{ fontSize: 9, fontWeight: 600, color: "#94A3B8", marginTop: 2 }}>{r.scope}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {areas.map((a) => (
              <Fragment key={"area-" + a.area}>
                <tr style={{ background: "#F8FAFC" }}>
                  <td colSpan={roleHas.length + 1} style={{ padding: "7px 12px", position: "sticky", left: 0, background: "#F8FAFC", fontSize: 11, fontWeight: 800, color: "#475569", letterSpacing: ".04em", textTransform: "uppercase" }}>
                    {a.area}
                  </td>
                </tr>
                {(a.permissions || []).map((p) => (
                  <tr key={a.area + "-" + p.key} style={{ borderTop: "1px solid #F1F5F9" }}>
                    <td style={{ padding: "8px 12px", position: "sticky", left: 0, background: "#fff", zIndex: 1, minWidth: 240 }}>
                      <div style={{ fontSize: 12.5, color: "#1E293B", fontWeight: 600 }}>{p.label}</div>
                      <div style={{ fontSize: 10, color: "#94A3B8", fontFamily: "ui-monospace,monospace" }}>{p.key}</div>
                    </td>
                    {roleHas.map(({ role: r, set }) => (
                      <td key={r.key} style={{ textAlign: "center", borderLeft: "1px solid #F1F5F9", color: set.has(p.key) ? "#15803D" : "#CBD5E1", fontWeight: set.has(p.key) ? 700 : 400 }}>
                        {set.has(p.key) ? "✓" : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* View as role */}
      <div style={{ fontWeight: 800, color: "#1E293B", margin: "0 0 4px" }}>View as this role</div>
      <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 12 }}>
        Pick a role to see exactly which app screens it can open and which are blocked — the answer to
        &quot;what does a Marketer see when they log in?&quot; (read-only; no impersonation).
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: "#475569" }}>Role</label>
        <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} style={{ padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: 13, background: "#fff", color: "#1E293B", minWidth: 220 }}>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name} · {r.scope}
            </option>
          ))}
        </select>
      </div>
      {role && (
        <div>
          <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px", marginBottom: 14 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "#1E293B" }}>
              {role.name} <span style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>· {role.scope}</span>
            </div>
            {role.description && <div style={{ fontSize: 12, color: "#64748B", marginTop: 3 }}>{role.description}</div>}
            <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>
              <strong style={{ color: "#15803D" }}>{allowed.length}</strong> screens accessible ·{" "}
              <strong style={{ color: "#B91C1C" }}>{blocked.length}</strong> blocked
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
            <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "auto", maxHeight: "60vh" }}>
              <div style={{ padding: "9px 14px", background: "#ECFDF5", fontSize: 12, fontWeight: 800, color: "#15803D", position: "sticky", top: 0, zIndex: 1 }}>
                ✓ Can access ({allowed.length})
              </div>
              {renderColumn(allowed, true)}
            </div>
            <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "auto", maxHeight: "60vh" }}>
              <div style={{ padding: "9px 14px", background: "#FEF2F2", fontSize: 12, fontWeight: 800, color: "#B91C1C", position: "sticky", top: 0, zIndex: 1 }}>
                ✕ Blocked ({blocked.length})
              </div>
              {renderColumn(blocked, false)}
            </div>
          </div>
        </div>
      )}

      <div style={{ height: 26 }} />

      {/* Feature → permission reference */}
      <div style={{ fontWeight: 800, color: "#1E293B", margin: "0 0 4px" }}>
        Feature → permission reference ({components.length})
      </div>
      <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 12 }}>
        Which permission each app screen requires — so you can answer &quot;what does a Marketer
        actually see?&quot;.
      </div>
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "auto", maxHeight: "60vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr style={{ background: "#F8FAFC" }}>
              <th style={{ textAlign: "left", padding: "9px 14px", color: "#64748B", fontSize: 11, fontWeight: 700 }}>SCREEN</th>
              <th style={{ textAlign: "left", padding: "9px 14px", color: "#64748B", fontSize: 11, fontWeight: 700 }}>REQUIRED PERMISSION</th>
              <th style={{ textAlign: "left", padding: "9px 14px", color: "#64748B", fontSize: 11, fontWeight: 700 }}>KEY</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c) => {
              const lbl = viewLabel[c.view] || "";
              return (
                <tr key={c.view} style={{ borderTop: "1px solid #F1F5F9" }}>
                  <td style={{ padding: "8px 14px" }}>
                    <div style={{ color: "#1E293B", fontWeight: 600, fontSize: 12.5 }}>{lbl || c.view}</div>
                    {lbl && <div style={{ color: "#94A3B8", fontFamily: "ui-monospace,monospace", fontSize: 10 }}>{c.view}</div>}
                  </td>
                  <td style={{ padding: "8px 14px", color: "#334155" }}>{c.permissionLabel || "—"}</td>
                  <td style={{ padding: "8px 14px", color: "#94A3B8", fontFamily: "ui-monospace,monospace", fontSize: 11 }}>{c.permission || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Audit Log tab
// ════════════════════════════════════════════════════════════════════════════
const AUDIT_ACTION_META: Record<string, { label: string; color: string; icon: string }> = {
  "membership.add": { label: "Member added", color: "#059669", icon: "➕" },
  "membership.role_change": { label: "Role changed", color: "#2563EB", icon: "🔄" },
  "membership.remove": { label: "Member removed", color: "#DC2626", icon: "➖" },
  "membership.accept": { label: "Invite accepted", color: "#16A34A", icon: "✅" },
  "platform_role.grant": { label: "Platform role granted", color: "#7C3AED", icon: "🛡️" },
  "platform_role.revoke": { label: "Platform role revoked", color: "#B45309", icon: "🚫" },
  "invite.send": { label: "Invite sent", color: "#0891B2", icon: "✉️" },
  "invite.resend": { label: "Invite resent", color: "#0EA5E9", icon: "🔁" },
  "invite.cancel": { label: "Invite cancelled", color: "#9333EA", icon: "🗑️" },
};

function AuditTab() {
  const toast = useToast();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auditAction, setAuditAction] = useState("");
  const [auditTenant, setAuditTenant] = useState("");

  const qs = () => {
    const parts: string[] = [];
    if (auditAction) parts.push("action=" + encodeURIComponent(auditAction));
    if (auditTenant) parts.push("tenantId=" + encodeURIComponent(auditTenant));
    return parts.length ? "?" + parts.join("&") : "";
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setEntries(null);
      const [wd, ad] = await Promise.all([
        adminGet<WorkspacesResult>("/workspaces"),
        adminGet<AuditResult>("/audit" + qs()),
      ]);
      if (cancelled) return;
      if (ad.ok === false) {
        setError(errText(ad));
        return;
      }
      setWorkspaces(wd.workspaces || []);
      setEntries(ad.entries || []);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditAction, auditTenant]);

  const meta = (a?: string) => AUDIT_ACTION_META[a || ""] || { label: a || "", color: "#64748B", icon: "•" };
  const fmtTime = (ts?: string) => {
    try {
      return new Date(ts || "").toLocaleString();
    } catch {
      return String(ts || "");
    }
  };
  const fmtRole = (r?: string) =>
    r ? <>{r}</> : <span style={{ color: "#94A3B8" }}>—</span>;

  const selStyle: React.CSSProperties = {
    padding: "6px 10px",
    border: "1px solid #E2E8F0",
    borderRadius: 7,
    fontSize: 12,
    color: "#475569",
  };

  if (error)
    return (
      <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 18, color: "#991B1B" }}>
        ⚠️ {error}
      </div>
    );

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, color: "#64748B" }}>
          A record of every role &amp; membership change made in the Admin Portal — newest first (last
          200).
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <select value={auditAction} onChange={(e) => setAuditAction(e.target.value)} style={selStyle}>
            <option value="">All actions</option>
            {Object.keys(AUDIT_ACTION_META).map((a) => (
              <option key={a} value={a}>
                {meta(a).label}
              </option>
            ))}
          </select>
          <select value={auditTenant} onChange={(e) => setAuditTenant(e.target.value)} style={selStyle}>
            <option value="">All workspaces</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button onClick={() => download("/audit/export" + qs(), "text/csv", "audit-log-" + new Date().toISOString().slice(0, 10) + ".csv", "✓ Audit log exported", toast)} title="Export the full filtered history as a CSV file" style={{ padding: "6px 12px", background: "#1E293B", border: "1px solid #1E293B", borderRadius: 7, fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer" }}>
            ⬇️ Download CSV
          </button>
        </div>
      </div>
      {entries === null ? (
        loadingBox
      ) : entries.length ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#64748B", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #E2E8F0" }}>When</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #E2E8F0" }}>Action</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #E2E8F0" }}>Who (actor)</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #E2E8F0" }}>Target user</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #E2E8F0" }}>Workspace</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #E2E8F0" }}>Change</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const m = meta(e.action);
                return (
                  <tr key={i} style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <td style={{ padding: "8px 10px", color: "#64748B", whiteSpace: "nowrap" }}>{fmtTime(e.created_at)}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 700, color: m.color }}>
                        {m.icon} {m.label}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", color: "#1E293B" }}>{e.actor_email || "#" + (e.actor_user_id || "?")}</td>
                    <td style={{ padding: "8px 10px", color: "#1E293B" }}>{e.target_email || "#" + (e.target_user_id || "?")}</td>
                    <td style={{ padding: "8px 10px", color: "#475569" }}>
                      {e.workspace_name ? e.workspace_name : <span style={{ color: "#94A3B8" }}>platform</span>}
                    </td>
                    <td style={{ padding: "8px 10px", color: "#475569" }}>
                      {fmtRole(e.old_role)} <span style={{ color: "#94A3B8" }}>→</span> {fmtRole(e.new_role)}
                      {e.detail && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{e.detail}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ background: "white", border: "1px dashed #CBD5E1", borderRadius: 12, padding: 34, textAlign: "center", color: "#94A3B8" }}>
          No role or membership changes recorded yet.
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Issues tab
// ════════════════════════════════════════════════════════════════════════════
const SEV_COLOR: Record<string, string> = {
  critical: "#DC2626",
  error: "#EA580C",
  warning: "#B45309",
  info: "#2563EB",
};

function IssuesTab() {
  const toast = useToast();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sevCounts, setSevCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [issueFilter, setIssueFilter] = useState("open");
  const [issueSeverity, setIssueSeverity] = useState("");
  const [issueTenant, setIssueTenant] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIssues(null);
      const wd = await adminGet<WorkspacesResult>("/workspaces");
      const qs = ["status=" + encodeURIComponent(issueFilter)];
      if (issueSeverity) qs.push("severity=" + encodeURIComponent(issueSeverity));
      if (issueTenant) qs.push("tenantId=" + encodeURIComponent(issueTenant));
      const d = await adminGet<IssuesResult>("/issues?" + qs.join("&"));
      if (cancelled) return;
      if (d.ok === false) {
        setError(errText(d));
        return;
      }
      setWorkspaces(wd.workspaces || []);
      setIssues(d.issues || []);
      setCounts(d.counts || {});
      setSevCounts(d.severityCounts || {});
    })();
    return () => {
      cancelled = true;
    };
  }, [issueFilter, issueSeverity, issueTenant, reloadKey]);

  async function issueAction(id: number, action: string) {
    const r = await adminSend("/issues/" + id, "PATCH", { action });
    if (r.ok) {
      toast("✓ Issue " + action + "d");
      setReloadKey((k) => k + 1);
    } else toast("⚠️ " + errText(r));
  }
  async function testIssue() {
    const r = await adminSend("/issues/test", "POST", {});
    if (r.ok) {
      toast("✓ Test issue raised — check inbox + email");
      setIssueFilter("open");
      setReloadKey((k) => k + 1);
    } else toast("⚠️ " + errText(r));
  }

  const filterBtn = (s: string, label: string) => (
    <button
      onClick={() => setIssueFilter(s)}
      style={{ padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1px solid ${issueFilter === s ? "#1E293B" : "#E2E8F0"}`, background: issueFilter === s ? "#1E293B" : "#fff", color: issueFilter === s ? "#fff" : "#475569" }}
    >
      {label}
      {counts[s] != null ? ` (${counts[s]})` : ""}
    </button>
  );

  const selStyle: React.CSSProperties = {
    padding: "6px 10px",
    border: "1px solid #E2E8F0",
    borderRadius: 7,
    fontSize: 12,
    color: "#475569",
  };

  if (error)
    return (
      <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 18, color: "#991B1B" }}>
        ⚠️ {error}
      </div>
    );

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {filterBtn("open", "Open")}
          {filterBtn("acknowledged", "Acknowledged")}
          {filterBtn("resolved", "Resolved")}
          <select value={issueSeverity} onChange={(e) => setIssueSeverity(e.target.value)} style={selStyle}>
            {["", "critical", "error", "warning", "info"].map((s) => (
              <option key={s} value={s}>
                {s ? "Severity: " + s + (sevCounts[s] != null ? " (" + sevCounts[s] + ")" : "") : "All severities"}
              </option>
            ))}
          </select>
          <select value={issueTenant} onChange={(e) => setIssueTenant(e.target.value)} style={selStyle}>
            <option value="">All workspaces</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <button onClick={testIssue} style={{ padding: "6px 12px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, fontWeight: 700, color: "#475569", cursor: "pointer" }}>
          ✉️ Send test issue
        </button>
      </div>
      {issues === null ? (
        loadingBox
      ) : issues.length ? (
        issues.map((i) => (
          <div key={i.id} style={{ background: "white", border: "1px solid #E2E8F0", borderLeft: `4px solid ${SEV_COLOR[i.severity || ""] || "#64748B"}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: "#1E293B" }}>{i.title}</div>
                <div style={{ fontSize: 12.5, color: "#64748B", marginTop: 3 }}>{i.detail || ""}</div>
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>
                  <span style={{ fontWeight: 700, color: SEV_COLOR[i.severity || ""] || "#64748B" }}>{i.severity}</span>
                  {" · "}
                  {i.source || ""} · seen {i.occurrence_count || 1}×{i.tenant_name ? " · " + i.tenant_name : ""}{" "}
                  {i.client_name ? " · " + i.client_name : ""}{" "}
                  {i.route && (
                    <code style={{ background: "#F1F5F9", padding: "1px 5px", borderRadius: 4 }}>{i.route}</code>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {i.status !== "acknowledged" && i.status !== "resolved" && (
                  <button onClick={() => issueAction(i.id, "acknowledge")} style={{ padding: "5px 10px", border: "1px solid #CBD5E1", background: "#fff", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                    Ack
                  </button>
                )}
                {i.status !== "resolved" ? (
                  <button onClick={() => issueAction(i.id, "resolve")} style={{ padding: "5px 10px", border: "1px solid #6EE7B7", background: "#ECFDF5", color: "#065F46", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                    Resolve
                  </button>
                ) : (
                  <button onClick={() => issueAction(i.id, "reopen")} style={{ padding: "5px 10px", border: "1px solid #CBD5E1", background: "#fff", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                    Reopen
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      ) : (
        <div style={{ background: "white", border: "1px dashed #CBD5E1", borderRadius: 12, padding: 34, textAlign: "center", color: "#94A3B8" }}>
          No {issueFilter} issues. 🎉
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Main Admin Portal
// ════════════════════════════════════════════════════════════════════════════
export default function Admin() {
  const [tab, setTab] = useState<string>("data-mode");
  const [gate, setGate] = useState<"loading" | "ok" | "error">("loading");
  const [gateMsg, setGateMsg] = useState<{ forbidden: boolean; text: string }>({ forbidden: false, text: "" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await adminGet<ApiResult>("/me");
      if (cancelled) return;
      if (me.ok) {
        setGate("ok");
      } else {
        const forbidden = /\b403\b/.test(me.error || "");
        setGateMsg({ forbidden, text: me.error || "request failed" });
        setGate("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="view" id="view-admin" style={{ display: "block" }}>
      <div className="view-header" style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)" }}>
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#CBD5E1" }}>
                <span className="bc-group" style={{ color: "rgba(203,213,225,.8)" }}>
                  Manage
                </span>{" "}
                <span className="bc-sep" style={{ color: "rgba(255,255,255,.3)" }}>
                  ›
                </span>{" "}
                Admin Portal
              </div>
              <h2 className="view-title">🛡️ Admin Portal</h2>
              <p className="view-sub">
                Manage workspaces, users, clients and data honesty. Control whether unavailable data
                is shown as clearly-badged demo data, or replaced with an honest &quot;data
                unavailable&quot; message.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        {gate === "loading" && (
          <div style={{ padding: 40, textAlign: "center", color: "#64748B" }}>Loading admin portal…</div>
        )}
        {gate === "error" && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 12, padding: 28, textAlign: "center", color: "#991B1B" }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🔒</div>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Admin access required</div>
            <div style={{ fontSize: 13, color: "#7F1D1D" }}>
              {gateMsg.forbidden ? "Your account is not a platform owner or admin." : gateMsg.text}
            </div>
          </div>
        )}
        {gate === "ok" && (
          <>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18, borderBottom: "1px solid #E2E8F0", paddingBottom: 2 }}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={"ig-admin-tab" + (tab === t.id ? " active" : "")}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div id="adminTabBody">
              {tab === "data-mode" && <DataModeTab />}
              {tab === "workspaces" && <WorkspacesTab />}
              {tab === "clients" && <ClientsTab />}
              {tab === "users" && <UsersTab />}
              {tab === "platform-keys" && <PlatformKeysTab />}
              {tab === "permissions" && <PermissionsTab />}
              {tab === "audit" && <AuditTab />}
              {tab === "issues" && <IssuesTab />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

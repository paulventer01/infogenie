"use client";

/**
 * Team Capacity & Workload — operational roster, utilization, queue matching.
 */

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface Assignment {
  id: string;
  work_item: string;
  hours: number;
  due_date?: string | null;
  status?: string;
}
interface Member {
  id: string;
  member_name: string;
  role?: string;
  weekly_hours: number;
  allocated_hours: number;
  utilization_pct: number;
  load: string;
  open_assignments: number;
  assignments?: Assignment[];
}
interface AgentTask {
  id: string | number;
  title: string;
  status?: string;
  priority?: string;
  due_date?: string | null;
  goal_title?: string;
  estimated_hours?: number;
}
interface Recommendation {
  task_id: string | number;
  task_title: string;
  goal_title?: string;
  estimated_hours?: number;
  priority?: string;
  suggested_member_id?: string | null;
  suggested_member_name?: string | null;
  reason?: string;
}
interface Alert {
  severity: string;
  message: string;
}
interface Totals {
  members: number;
  weekly_hours: number;
  allocated_hours: number;
  remaining_hours?: number;
  utilization_pct: number;
  overloaded: number;
  at_capacity: number;
  available: number;
  unassigned_task_hours: number;
  open_agent_tasks: number;
}
interface Summary {
  ok?: boolean;
  members: Member[];
  agent_workload: AgentTask[];
  recommendations?: Recommendation[];
  alerts?: Alert[];
  totals: Totals;
}

const LOAD_COLOR: Record<string, string> = {
  available: "#16A34A",
  busy: "#0EA5E9",
  at_capacity: "#F59E0B",
  overloaded: "#DC2626",
};

export default function Capacity() {
  const toast = useToast();
  const [data, setData] = useState<Summary | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("marketer");
  const [hours, setHours] = useState("40");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await apiGet<Summary>("/api/capacity/summary");
    setData({
      members: r.members || [],
      agent_workload: r.agent_workload || [],
      recommendations: r.recommendations || [],
      alerts: r.alerts || [],
      totals: r.totals || {
        members: 0, weekly_hours: 0, allocated_hours: 0, remaining_hours: 0,
        utilization_pct: 0, overloaded: 0, at_capacity: 0, available: 0,
        unassigned_task_hours: 0, open_agent_tasks: 0,
      },
    });
  }

  useEffect(() => {
    refresh().catch(() => setData(null));
  }, []);

  async function addMember() {
    if (!name.trim()) { toast("Name required"); return; }
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/capacity/members", {
      member_name: name.trim(), role, weekly_hours: +hours || 40,
    });
    if (!r.ok) { toast(r.error || "Failed"); return; }
    setName("");
    toast("Member added");
    refresh();
  }

  async function removeMember(id: string) {
    await apiDelete(`/api/capacity/members/${id}`);
    toast("Member deactivated");
    refresh();
  }

  async function seedUsers() {
    setBusy(true);
    const r = await apiPost<{ ok: boolean; seeded?: number; note?: string; error?: string }>("/api/capacity/seed-from-users", {});
    setBusy(false);
    if (!r.ok) { toast(r.error || "Seed failed"); return; }
    toast(r.seeded ? `Seeded ${r.seeded} teammate(s)` : (r.note || "No new members"));
    refresh();
  }

  async function assignBest(taskId: string | number) {
    setBusy(true);
    const r = await apiPost<{ ok: boolean; member_name?: string; error?: string }>("/api/capacity/assign-best", {
      task_id: taskId,
    });
    setBusy(false);
    if (!r.ok) { toast(r.error || "Assign failed — add teammates with free hours"); return; }
    toast(`Assigned to ${r.member_name}`);
    refresh();
  }

  const t = data?.totals;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#F0F9FF 0%,#F8FAFC 40%)", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.55rem", color: "#0F172A" }}>Team Capacity & Workload</h1>
            <p style={{ margin: "6px 0 0", color: "#64748B" }}>
              Who has hours this week, what is already allocated, and which open Marketing Goal tasks should go where.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={seedUsers} style={{ ...btnStyle, background: "#0369A1" }}>
            Seed from workspace users
          </button>
        </div>

        {(data?.alerts || []).map((a, i) => (
          <div key={i} style={{
            marginBottom: 10, padding: "10px 14px", borderRadius: 10, fontSize: "0.88rem",
            background: a.severity === "high" ? "#FEF2F2" : "#FFFBEB",
            border: `1px solid ${a.severity === "high" ? "#FECACA" : "#FDE68A"}`,
            color: a.severity === "high" ? "#991B1B" : "#92400E",
          }}>
            {a.message}
          </div>
        ))}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 20 }}>
          {[
            ["Members", t?.members ?? "—"],
            ["Weekly hours", t?.weekly_hours ?? "—"],
            ["Allocated", t?.allocated_hours ?? "—"],
            ["Remaining", t?.remaining_hours ?? "—"],
            ["Utilization", t ? `${t.utilization_pct}%` : "—"],
            ["Overloaded", t?.overloaded ?? "—"],
            ["Open queue", t?.open_agent_tasks ?? "—"],
            ["Unassigned hrs", t?.unassigned_task_hours ?? "—"],
          ].map(([label, val]) => (
            <div key={String(label)} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: "0.66rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0F172A", marginTop: 4 }}>{val}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, marginBottom: 18 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: "1rem" }}>Recommended assignments</h3>
          {(data?.recommendations || []).length === 0 ? (
            <div style={{ color: "#64748B", fontSize: "0.9rem" }}>No open agent tasks to place — or everyone is clear.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {(data?.recommendations || []).slice(0, 8).map((r) => (
                <div key={String(r.task_id)} style={{
                  display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center",
                  padding: "10px 12px", background: "#F8FAFC", borderRadius: 8,
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "#0F172A" }}>{r.task_title}</div>
                    <div style={{ fontSize: "0.82rem", color: "#64748B" }}>
                      {r.goal_title || "Goal"} · {r.estimated_hours || 1}h · {r.priority || "—"}
                      {r.suggested_member_name ? ` → ${r.suggested_member_name}` : ""}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#94A3B8" }}>{r.reason}</div>
                  </div>
                  <button
                    type="button"
                    disabled={busy || !r.suggested_member_id}
                    onClick={() => assignBest(r.task_id)}
                    style={btnStyle}
                  >
                    Assign best
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 22 }}>
          <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 18 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "1rem" }}>Add teammate</h3>
            <div style={{ display: "grid", gap: 8 }}>
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
              <input placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle} />
              <input placeholder="Weekly hours" value={hours} onChange={(e) => setHours(e.target.value)} style={inputStyle} />
              <button type="button" onClick={addMember} style={btnStyle}>Add member</button>
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 18 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>How to use this</h3>
            <ol style={{ margin: 0, paddingLeft: 18, color: "#475569", fontSize: "0.88rem", lineHeight: 1.55 }}>
              <li>Seed or add your marketers with weekly hour budgets.</li>
              <li>Open Marketing Goals create agent tasks automatically.</li>
              <li>Use <strong>Assign best</strong> to place queue items on the least-loaded person.</li>
              <li>Watch overloaded alerts before committing more work.</li>
            </ol>
          </div>
        </div>

        <h3 style={{ margin: "0 0 10px" }}>Team load</h3>
        <div style={{ display: "grid", gap: 10, marginBottom: 28 }}>
          {(data?.members || []).length === 0 && (
            <div style={{ padding: 18, background: "#fff", border: "1px dashed #CBD5E1", borderRadius: 12, color: "#64748B" }}>
              No teammates yet — seed from workspace users or add someone above.
            </div>
          )}
          {(data?.members || []).map((m) => (
            <div key={m.id} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, color: "#0F172A" }}>{m.member_name}</div>
                  <div style={{ fontSize: "0.85rem", color: "#64748B" }}>
                    {m.role || "marketer"} · {m.allocated_hours}/{m.weekly_hours}h
                    · {Math.max(0, m.weekly_hours - m.allocated_hours)}h free
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{
                    fontSize: "0.75rem", fontWeight: 700, padding: "4px 10px", borderRadius: 999,
                    color: LOAD_COLOR[m.load] || "#334155",
                    background: `${LOAD_COLOR[m.load] || "#334155"}18`,
                  }}>
                    {m.load.replace("_", " ")} · {m.utilization_pct}%
                  </span>
                  <button type="button" onClick={() => removeMember(m.id)} style={{ ...btnStyle, background: "#FEE2E2", color: "#991B1B" }}>Remove</button>
                </div>
              </div>
              <div style={{ marginTop: 10, height: 8, background: "#F1F5F9", borderRadius: 999, overflow: "hidden" }}>
                <div style={{
                  width: `${Math.min(100, m.utilization_pct)}%`,
                  height: "100%",
                  background: LOAD_COLOR[m.load] || "#0EA5E9",
                }} />
              </div>
              {(m.assignments || []).length > 0 && (
                <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "#475569", fontSize: "0.85rem" }}>
                  {m.assignments!.map((a) => (
                    <li key={a.id}>{a.work_item} · {a.hours}h{a.due_date ? ` · due ${a.due_date}` : ""}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <h3 style={{ margin: "0 0 10px" }}>Open agent task queue</h3>
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
          {(data?.agent_workload || []).length === 0 ? (
            <div style={{ padding: 18, color: "#64748B" }}>No open agent tasks — Marketing Goals queue is clear.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
              <thead>
                <tr style={{ background: "#F8FAFC", textAlign: "left" }}>
                  <th style={th}>Task</th>
                  <th style={th}>Goal</th>
                  <th style={th}>Priority</th>
                  <th style={th}>Est. hours</th>
                  <th style={th}>Due</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {(data?.agent_workload || []).map((w) => (
                  <tr key={String(w.id)} style={{ borderTop: "1px solid #E2E8F0" }}>
                    <td style={td}>{w.title}</td>
                    <td style={td}>{w.goal_title || "—"}</td>
                    <td style={td}>{w.priority || "—"}</td>
                    <td style={td}>{w.estimated_hours ?? "—"}</td>
                    <td style={td}>{w.due_date ? String(w.due_date).slice(0, 10) : "—"}</td>
                    <td style={td}>
                      <button type="button" disabled={busy} onClick={() => assignBest(w.id)} style={{ ...btnStyle, padding: "6px 10px", fontSize: "0.78rem" }}>
                        Assign best
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

const inputStyle: React.CSSProperties = {
  width: "100%", padding: 9, border: "1px solid #CBD5E1", borderRadius: 8, boxSizing: "border-box",
};
const btnStyle: React.CSSProperties = {
  padding: "9px 14px", border: "none", borderRadius: 8, background: "#0F766E",
  color: "#fff", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};
const th: React.CSSProperties = { padding: "10px 12px", color: "#64748B", fontWeight: 700, fontSize: "0.72rem", textTransform: "uppercase" };
const td: React.CSSProperties = { padding: "10px 12px", color: "#0F172A" };

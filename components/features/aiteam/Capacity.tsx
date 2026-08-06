"use client";

/**
 * Team Capacity & Workload — missing priority gap surface.
 * Members, weekly hours, utilization, open agent tasks.
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
  skills?: string[] | string;
  notes?: string;
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
interface Totals {
  members: number;
  weekly_hours: number;
  allocated_hours: number;
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
  const [assignMember, setAssignMember] = useState("");
  const [assignItem, setAssignItem] = useState("");
  const [assignHours, setAssignHours] = useState("2");

  async function refresh() {
    const r = await apiGet<Summary>("/api/capacity/summary");
    setData({
      members: r.members || [],
      agent_workload: r.agent_workload || [],
      totals: r.totals || {
        members: 0,
        weekly_hours: 0,
        allocated_hours: 0,
        utilization_pct: 0,
        overloaded: 0,
        at_capacity: 0,
        available: 0,
        unassigned_task_hours: 0,
        open_agent_tasks: 0,
      },
    });
  }

  useEffect(() => {
    refresh().catch(() => setData(null));
  }, []);

  async function addMember() {
    if (!name.trim()) {
      toast("Name required");
      return;
    }
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/capacity/members", {
      member_name: name.trim(),
      role,
      weekly_hours: +hours || 40,
    });
    if (!r.ok) {
      toast(r.error || "Failed");
      return;
    }
    setName("");
    toast("Member added");
    refresh();
  }

  async function removeMember(id: string) {
    await apiDelete(`/api/capacity/members/${id}`);
    toast("Member deactivated");
    refresh();
  }

  async function addAssignment() {
    if (!assignMember || !assignItem.trim()) {
      toast("Pick a member and work item");
      return;
    }
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/capacity/assignments", {
      member_id: assignMember,
      work_item: assignItem.trim(),
      hours: +assignHours || 2,
    });
    if (!r.ok) {
      toast(r.error || "Failed");
      return;
    }
    setAssignItem("");
    toast("Assigned");
    refresh();
  }

  const t = data?.totals;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#F0F9FF 0%,#F8FAFC 40%)", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ margin: 0, fontSize: "1.55rem", color: "#0F172A" }}>Team Capacity & Workload</h1>
        <p style={{ margin: "6px 0 22px", color: "#64748B" }}>
          See who has room this week, what is already allocated, and open agent tasks still unassigned.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 22 }}>
          {[
            ["Members", t?.members ?? "—"],
            ["Weekly hours", t?.weekly_hours ?? "—"],
            ["Allocated", t?.allocated_hours ?? "—"],
            ["Utilization", t ? `${t.utilization_pct}%` : "—"],
            ["Overloaded", t?.overloaded ?? "—"],
            ["Open agent tasks", t?.open_agent_tasks ?? "—"],
          ].map(([label, val]) => (
            <div key={String(label)} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ fontSize: "0.68rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
              <div style={{ fontSize: "1.35rem", fontWeight: 700, color: "#0F172A", marginTop: 4 }}>{val}</div>
            </div>
          ))}
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
            <h3 style={{ margin: "0 0 12px", fontSize: "1rem" }}>Assign work</h3>
            <div style={{ display: "grid", gap: 8 }}>
              <select value={assignMember} onChange={(e) => setAssignMember(e.target.value)} style={inputStyle}>
                <option value="">Select member…</option>
                {(data?.members || []).map((m) => (
                  <option key={m.id} value={m.id}>{m.member_name}</option>
                ))}
              </select>
              <input placeholder="Work item" value={assignItem} onChange={(e) => setAssignItem(e.target.value)} style={inputStyle} />
              <input placeholder="Hours" value={assignHours} onChange={(e) => setAssignHours(e.target.value)} style={inputStyle} />
              <button type="button" onClick={addAssignment} style={btnStyle}>Assign</button>
            </div>
          </div>
        </div>

        <h3 style={{ margin: "0 0 10px" }}>Team load</h3>
        <div style={{ display: "grid", gap: 10, marginBottom: 28 }}>
          {(data?.members || []).length === 0 && (
            <div style={{ padding: 18, background: "#fff", border: "1px dashed #CBD5E1", borderRadius: 12, color: "#64748B" }}>
              No teammates yet — add someone above to start tracking capacity.
            </div>
          )}
          {(data?.members || []).map((m) => (
            <div key={m.id} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, color: "#0F172A" }}>{m.member_name}</div>
                  <div style={{ fontSize: "0.85rem", color: "#64748B" }}>{m.role || "marketer"} · {m.allocated_hours}/{m.weekly_hours}h</div>
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

        <h3 style={{ margin: "0 0 10px" }}>Unassigned agent tasks</h3>
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
  width: "100%",
  padding: 9,
  border: "1px solid #CBD5E1",
  borderRadius: 8,
  boxSizing: "border-box",
};
const btnStyle: React.CSSProperties = {
  padding: "9px 14px",
  border: "none",
  borderRadius: 8,
  background: "#0F766E",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};
const th: React.CSSProperties = { padding: "10px 12px", color: "#64748B", fontWeight: 700, fontSize: "0.72rem", textTransform: "uppercase" };
const td: React.CSSProperties = { padding: "10px 12px", color: "#0F172A" };

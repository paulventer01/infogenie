"use client";

/**
 * Team Capacity & Workload — operational roster, utilization, queue matching.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiDelete, apiPatch, type ApiResult } from "@/lib/api";
import { accessLost, amount, assignmentError, assignmentPayload, calendarDay, memberDraft, memberError, memberPayload,
  newAssignment, newMember, responseError, validRoster, verifyCapacityAccess, type Context, type RosterMember } from "@/lib/capacityControls";

interface Assignment {
  id: string;
  work_item: string;
  hours: number | string;
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
  error?: string;
  members: Member[];
  agent_workload: AgentTask[];
  recommendations?: Recommendation[];
  alerts?: Alert[];
  totals: Totals;
}

function validSummary(r: Summary): boolean {
  const number = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  return !!r?.totals && ["members", "weekly_hours", "allocated_hours", "remaining_hours", "utilization_pct", "overloaded", "open_agent_tasks", "unassigned_task_hours"]
    .every((k) => number(r.totals[k as keyof Totals])) && Array.isArray(r.members) && r.members.every((m) => m && typeof m.id === "string"
      && typeof m.member_name === "string" && [m.weekly_hours, m.allocated_hours, m.utilization_pct].every(number) && typeof m.load === "string"
      && Array.isArray(m.assignments) && m.assignments.every((a) => a && typeof a.id === "string" && typeof a.work_item === "string"
        && amount(a.hours) !== null && a.status === "open" && (!a.due_date || calendarDay(a.due_date))))
    && Array.isArray(r.agent_workload) && r.agent_workload.every((w) => w && w.id != null && typeof w.title === "string")
    && Array.isArray(r.recommendations) && r.recommendations.every((v) => v && v.task_id != null && typeof v.task_title === "string")
    && Array.isArray(r.alerts) && r.alerts.every((a) => a && typeof a.message === "string");
}
type Review = { kind: "member" | "assignment" | "seed" | "deactivate" | "reactivate" | "status"; label: string; id?: string; status?: "done" | "cancelled" };

const LOAD_COLOR: Record<string, string> = {
  available: "#16A34A",
  busy: "#0EA5E9",
  at_capacity: "#F59E0B",
  overloaded: "#DC2626",
};

export default function Capacity() {
  const [data, setData] = useState<Summary | null>(null);
  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  const [member, setMember] = useState(newMember), [assignment, setAssignment] = useState(newAssignment);
  const [review, setReview] = useState<Review | null>(null);
  const [checking, setChecking] = useState(true), [canWrite, setCanWrite] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null), [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [seedMsg, setSeedMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const live = useRef(false), generation = useRef(0), listVersion = useRef(0), submitting = useRef(false);
  const context = useRef<Context>(), tail = useRef(Promise.resolve()), pending = useRef(0);
  const stopRequests = useCallback(() => { live.current = false; ++generation.current; ++listVersion.current; }, []);
  const clearContext = useCallback((message: string) => {
    ++generation.current; ++listVersion.current; context.current = undefined;
    setData(null); setRoster(null); setMember(newMember()); setAssignment(newAssignment()); setReview(null);
    setSeedMsg(null); setCanWrite(false); setAccessError(message); setLoading(false);
  }, []);
  const checkContext = useCallback(async () => {
    const epoch = generation.current, current = () => live.current && epoch === generation.current;
    const prior = tail.current; let release!: () => void;
    tail.current = new Promise<void>((resolve) => { release = resolve; });
    ++pending.current; setChecking(true);
    try {
      await prior; if (!current()) return null;
      const verified = await verifyCapacityAccess(context.current);
      if (!current()) return null;
      if (verified.lost || (!verified.error && !verified.canRead)) {
        clearContext(verified.error || "Project viewing access was revoked. Rows and drafts were cleared."); return null;
      }
      setAccessError(verified.error);
      if (verified.error) { ++listVersion.current; setData(null); setRoster(null); setLoading(false); }
      else { context.current = verified.context; setCanWrite(verified.canWrite === true); }
      return verified;
    } finally { release(); --pending.current; if (live.current) setChecking(pending.current > 0); }
  }, [clearContext]);
  const refresh = useCallback(async () => {
    const version = ++listVersion.current, epoch = generation.current;
    const current = () => live.current && version === listVersion.current && epoch === generation.current;
    setData(null); setRoster(null); setLoadError(null); setLoading(true);
    const before = await checkContext();
    if (!current() || !before || before.error) return null;
    const [members, summary] = await Promise.all([
      apiGet<ApiResult & { members?: RosterMember[] }>("/api/capacity/members"), apiGet<Summary>("/api/capacity/summary"),
    ]);
    if (!current()) return null;
    const rosterError = responseError(members) || (!validRoster(members.members) ? "Invalid roster response." : null);
    const summaryError = responseError(summary) || (!validSummary(summary) ? "Invalid summary response." : null);
    if (accessLost(rosterError) || accessLost(summaryError)) { clearContext(rosterError || summaryError!); return null; }
    const after = await checkContext();
    if (!current() || !after || after.error) return null;
    setRoster(rosterError ? null : members.members!); setData(summaryError ? null : summary); setLoading(false);
    setLoadError([rosterError && `Roster unavailable: ${rosterError}`, summaryError && `Workload unavailable: ${summaryError}`].filter(Boolean).join(" ") || null);
    return rosterError || summaryError ? null : { roster: members.members!, summary };
  }, [checkContext, clearContext]);
  useEffect(() => {
    live.current = true; void refresh();
    const recheck = () => { void checkContext(); };
    window.addEventListener("focus", recheck); document.addEventListener("visibilitychange", recheck);
    return () => { stopRequests();
      window.removeEventListener("focus", recheck); document.removeEventListener("visibilitychange", recheck); };
  }, [refresh, checkContext, stopRequests]);
  function reviewAction(action: Review) {
    if (submitting.current || !canWrite || !roster || !data) return;
    const error = action.kind === "member" ? memberError(member, roster) : action.kind === "assignment" ? assignmentError(assignment, roster) : null;
    setSeedMsg(error ? { tone: "err", text: error } : null); setReview(error ? null : action);
  }
  async function save() {
    if (!live.current || submitting.current || !canWrite || checking || accessError || !review) return;
    submitting.current = true; setBusy(true); setSeedMsg(null);
    const epoch = generation.current, current = () => live.current && epoch === generation.current;
    try {
      const fresh = await refresh();
      if (!current()) return;
      if (!fresh) { setSeedMsg({ tone: "err", text: "Save not attempted. Refresh to verify data and access. Draft retained." }); return; }
      const target = fresh.roster.find((m) => m.id === review.id);
      const invalid = review.kind === "member" ? memberError(member, fresh.roster) : review.kind === "assignment"
        ? assignmentError(assignment, fresh.roster) || (assignment.taskId && !fresh.summary.agent_workload.some((w) => String(w.id) === assignment.taskId) ? "Task is no longer in the loaded open queue. Review again." : null)
        : review.kind === "status" ? (!fresh.summary.members.some((m) => m.assignments?.some((a) => a.id === review.id && a.status === "open")) ? "Assignment is no longer open. Refresh and review again." : null)
        : ["deactivate", "reactivate"].includes(review.kind) && (!target || target.active !== (review.kind === "deactivate")) ? "Member status changed. Review again." : null;
      if (invalid) { setSeedMsg({ tone: "err", text: invalid }); setReview(null); return; }
      const before = await checkContext();
      if (!current() || !before) return;
      if (before.error || !before.canWrite) { setSeedMsg({ tone: "err", text: "Save not attempted. Project editing access is required. Draft retained." }); return; }
      const result = review.kind === "status" ? await apiPatch<ApiResult>(`/api/capacity/assignments/${encodeURIComponent(review.id!)}`, { status: review.status })
        : review.kind === "deactivate" ? await apiDelete<ApiResult>(`/api/capacity/members/${encodeURIComponent(review.id!)}`)
        : await apiPost<ApiResult>(`/api/capacity/${review.kind === "seed" ? "seed-from-users" : review.kind === "assignment" ? "assignments" : "members"}`,
          review.kind === "seed" ? {} : review.kind === "assignment" ? assignmentPayload(assignment)
            : review.kind === "reactivate" ? { ...memberPayload(memberDraft(target!), fresh.roster), active: true } : memberPayload(member, fresh.roster));
      if (!current()) return;
      const error = responseError(result) || (["member", "assignment", "reactivate"].includes(review.kind) && (typeof result.id !== "string" || !result.id) ? "Invalid save confirmation." : null)
        || (review.kind === "seed" && (!Number.isInteger(result.seeded) || Number(result.seeded) < 0 || !Array.isArray(result.added)) ? "Invalid seed confirmation." : null);
      if (accessLost(error)) { clearContext(error!); return; }
      const after = await checkContext();
      if (!current() || !after) return;
      if (error) {
        setSeedMsg({ tone: "err", text: `${error} ${review.kind === "seed" ? "Seeding may be partial or uncertain." : "Save not confirmed. Draft retained."} Verify the roster and assignments before retrying; the request may have reached the server.` });
        setReview(null); return;
      }
      if (after.error) {
        setReview(null); setSeedMsg({ tone: "warn", text: "Saved, but access verification and refresh failed. Draft retained for reference. Verify the lists; do not resubmit." }); return;
      }
      const savedText = review.kind === "seed" ? `Saved. Added ${result.seeded} teammate(s)${(result.added as string[]).length ? `: ${(result.added as string[]).join(", ")}` : ""}. ${typeof result.note === "string" ? result.note : ""}` : "Saved.";
      if (review.kind === "member") setMember(newMember());
      if (review.kind === "assignment") setAssignment(newAssignment());
      setReview(null);
      const refreshed = await refresh();
      if (current()) setSeedMsg({ tone: refreshed ? "ok" : "warn", text: savedText + (refreshed ? " Lists refreshed." : " Saved, but refresh failed. Refresh to verify; do not resubmit.") });
    } catch {
      if (current()) { setReview(null); setSeedMsg({ tone: "err", text: "Request uncertain; seeding may be partial. Draft retained. Verify the roster and assignments before retrying." }); }
    } finally { submitting.current = false; if (live.current) setBusy(false); }
  }
  function prefill(taskId: string | number) {
    if (submitting.current || !canWrite) return;
    const task = data?.agent_workload.find((w) => String(w.id) === String(taskId));
    const rec = data?.recommendations?.find((r) => String(r.task_id) === String(taskId));
    if (task) {
      setAssignment({ member_id: rec?.suggested_member_id || "", work_item: task.title, hours: rec?.estimated_hours == null && task.estimated_hours == null ? "" : String(rec?.estimated_hours ?? task.estimated_hours),
        due_date: calendarDay(task.due_date) || "", taskId: String(task.id) }); setReview(null); setSeedMsg(null);
    }
  }
  const locked = busy || !!review || !canWrite || !roster || !data;
  const t = data?.totals;
  if (checking || accessError) return <div style={{ padding: 28 }}><h1>Team Capacity &amp; Workload</h1>
    {checking ? <p role="status">Verifying account, workspace and project access…</p> : <><p role="alert">{accessError}</p>
      <p>Capacity data is hidden until access is verified. Temporary verification failures retain drafts.</p>
      <button type="button" disabled={busy} onClick={() => void refresh()} style={btnStyle}>Refresh capacity</button></>}
  </div>;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#F0F9FF 0%,#F8FAFC 40%)", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.55rem", color: "#0F172A" }}>Team Capacity & Workload</h1>
            <p style={{ margin: "6px 0 0", color: "#64748B" }}>
              Weekly capacity compared with base allocations and open assignments across all due dates.
            </p>
          </div>
          <button
            type="button"
            disabled={locked}
            onClick={() => reviewAction({ kind: "seed", label: "Seed from up to 40 workspace users, with default 40 weekly hours each. Includes active/invited workspace users; sends no invitations. Review the resulting roster after saving." })}
            style={{
              ...btnStyle,
              background: "#0369A1",
              color: "#FFFFFF",
              opacity: busy ? 0.75 : 1,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            Seed from workspace users
          </button>
        </div>

        <button type="button" disabled={busy || loading} onClick={() => void refresh()} style={btnStyle}>Refresh capacity</button>
        {loading && <p role="status">Loading roster and workload…</p>}
        {loadError && <p role="alert">{loadError} Failed data is withheld; refresh to try again.</p>}
        {!canWrite && <p role="status">Read-only access. Changes require project editing access.</p>}
        {review && <section aria-label="Review capacity change" style={{ background: "#FFFBEB", padding: 16, margin: "12px 0", borderRadius: 12 }}>
          <h3>Review before saving</h3><p>{review.label}</p>
          {review.kind === "member" && <p>{member.member_name} · {member.role} · {member.weekly_hours} weekly hours · {member.allocated_hours} base allocated hours · {member.active ? "Active" : "Inactive"}</p>}
          {review.kind === "assignment" && <p>Person: {roster?.find((m) => m.id === assignment.member_id)?.member_name} ({assignment.member_id}) · {assignment.work_item} · {assignment.hours}h · Due: {assignment.due_date || "None"}{assignment.taskId ? ` · Agent task ${assignment.taskId}` : " · Manual work"}</p>}
          <button type="button" disabled={busy} onClick={() => void save()} style={btnStyle}>Save change</button>{" "}
          <button type="button" disabled={busy} onClick={() => setReview(null)} style={btnStyle}>Back to draft</button>
        </section>}

        {seedMsg ? (
          <div
            role={seedMsg.tone === "err" ? "alert" : "status"}
            style={{
              marginBottom: 12,
              padding: "10px 14px",
              borderRadius: 10,
              fontSize: "0.88rem",
              lineHeight: 1.45,
              background: seedMsg.tone === "ok" ? "#ECFDF5" : seedMsg.tone === "warn" ? "#FFFBEB" : "#FEF2F2",
              border: `1px solid ${seedMsg.tone === "ok" ? "#A7F3D0" : seedMsg.tone === "warn" ? "#FDE68A" : "#FECACA"}`,
              color: seedMsg.tone === "ok" ? "#065F46" : seedMsg.tone === "warn" ? "#92400E" : "#991B1B",
            }}
          >
            {seedMsg.text}
          </div>
        ) : null}

        {(data?.alerts || []).map((a, i) => (
          <div key={i} style={{
            marginBottom: 10, padding: "10px 14px", borderRadius: 10, fontSize: "0.88rem",
            background: a.severity === "high" ? "#FEF2F2" : "#FFFBEB",
            border: `1px solid ${a.severity === "high" ? "#FECACA" : "#FDE68A"}`,
            color: a.severity === "high" ? "#991B1B" : "#92400E",
          }}>
            {a.message.replace("free this week", "remaining against weekly capacity (all due dates)")}
          </div>
        ))}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 20 }}>
          {[
            ["Active members", t?.members ?? "—"],
            ["Weekly hours", t?.weekly_hours ?? "—"],
            ["Allocated", t?.allocated_hours ?? "—"],
            ["Remaining", t?.remaining_hours ?? "—"],
            ["Utilization", t ? t.weekly_hours === 0 ? "N/A (0 capacity)" : `${t.utilization_pct}%` : "—"],
            ["Overloaded", t?.overloaded ?? "—"],
            ["Open queue", t?.open_agent_tasks ?? "—"],
            ["Listed queue est. hrs", t?.unassigned_task_hours ?? "—"],
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
            <div style={{ color: "#64748B", fontSize: "0.9rem" }}>{data ? "No assignment recommendations returned." : "Recommendations unavailable until workload loads."}</div>
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
                      {r.goal_title || "Goal"} · {r.estimated_hours ?? "—"}h estimate · {r.priority || "—"}
                      {r.suggested_member_name ? ` → ${r.suggested_member_name}` : ""}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#94A3B8" }}>{r.reason}</div>
                  </div>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => prefill(r.task_id)}
                    style={btnStyle}
                  >
                    Review assignment
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 22 }}>
          <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 18 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "1rem" }}>{member.id ? "Edit teammate" : "Add teammate"}</h3>
            <form aria-label="Roster details" onSubmit={(e) => { e.preventDefault(); reviewAction({ kind: "member", label: "Save these roster details. Skills, notes and active status are retained for existing members." }); }}>
              <fieldset disabled={locked} style={{ border: 0, padding: 0, display: "grid", gap: 8 }}>
                {([["member_name", "Name"], ["role", "Role"], ["weekly_hours", "Weekly hours (0–168)"], ["allocated_hours", "Base allocated hours (0–9999.99)"]] as const).map(([key, label]) => <label key={key}>{label}
                  <input name={key} value={member[key]} onChange={(e) => { setMember({ ...member, [key]: e.target.value }); setSeedMsg(null); }} style={inputStyle} />
                </label>)}
                <p>Base allocated hours exclude open assignments. Zero is valid; at most 2 decimal places. Status: {member.active ? "active" : "inactive"}.</p>
                <button type="submit" style={btnStyle}>Review member</button>
                <button type="button" onClick={() => setMember(newMember())} style={btnStyle}>New member draft</button>
              </fieldset>
            </form>
          </div>
          <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 18 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>How to use this</h3>
            <ol style={{ margin: 0, paddingLeft: 18, color: "#475569", fontSize: "0.88rem", lineHeight: 1.55 }}>
              <li>Seed or add your marketers with weekly hour budgets.</li>
              <li>Open Marketing Goals create agent tasks automatically.</li>
              <li>Review a recommendation or queue item, choose the person and hours, then explicitly save.</li>
              <li>Watch overloaded alerts before committing more work.</li>
            </ol>
            <h3>Assign work</h3>
            <form aria-label="Assignment details" onSubmit={(e) => { e.preventDefault(); reviewAction({ kind: "assignment", label: "Confirm the assigned person, work item and hours. This records capacity only; it does not execute providers or finish agent tasks." }); }}>
              <fieldset disabled={locked} style={{ border: 0, padding: 0, display: "grid", gap: 8 }}>
                <label>Assigned person<select name="member_id" value={assignment.member_id} onChange={(e) => setAssignment({ ...assignment, member_id: e.target.value })} style={inputStyle}>
                  <option value="">Choose an active person</option>{roster?.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.member_name} ({m.id})</option>)}
                </select></label>
                {([["work_item", "Work item"], ["hours", "Assigned hours (>0–9999.99)"], ["due_date", "Due date (optional YYYY-MM-DD)"]] as const).map(([key, label]) => <label key={key}>{label}
                  <input name={key} value={assignment[key]} readOnly={key === "work_item" && !!assignment.taskId} onChange={(e) => setAssignment({ ...assignment, [key]: e.target.value })} style={inputStyle} />
                </label>)}
                {assignment.taskId && <p>Agent task {assignment.taskId}: prefilled hours are priority-based estimates. Review the person and hours before saving.</p>}
                <button type="submit" style={btnStyle}>Review assigned person and hours</button>
                <button type="button" onClick={() => setAssignment(newAssignment())} style={btnStyle}>New manual assignment</button>
              </fieldset>
            </form>
          </div>
        </div>

        <h3 style={{ margin: "0 0 10px" }}>Full roster</h3>
        {roster?.length === 0 && <p>No teammates yet. Add a member or explicitly review seeding from workspace users.</p>}
        {roster?.map((m) => <div key={m.id} style={{ marginBottom: 8 }}>
          {m.member_name} · {m.role || "—"} · {m.active ? "Active" : "Inactive"} · {m.weekly_hours} weekly hours · {m.allocated_hours} base allocated hours{" "}
          <button type="button" disabled={locked} onClick={() => { setMember(memberDraft(m)); setSeedMsg(null); }} style={btnStyle}>Edit {m.member_name}</button>{" "}
          <button type="button" disabled={locked} onClick={() => reviewAction({ kind: m.active ? "deactivate" : "reactivate", id: m.id,
            label: `${m.active ? "Deactivate" : "Reactivate"} ${m.member_name}? ${m.active ? "Open work must be done or cancelled first; deactivation does not close assignments." : `Review ${m.weekly_hours} weekly hours and ${m.allocated_hours} base allocated hours before reactivation.`}` })} style={btnStyle}>{m.active ? "Deactivate" : "Reactivate"} {m.member_name}</button>
        </div>)}
        <h3 style={{ margin: "18px 0 10px" }}>Team load</h3>
        <p>Open allocations include all due dates. Done/cancelled controls close only the capacity assignment, not the underlying agent task.</p>
        <div style={{ display: "grid", gap: 10, marginBottom: 28 }}>
          {data && data.members.length === 0 && (
            <div style={{ padding: 18, background: "#fff", border: "1px dashed #CBD5E1", borderRadius: 12, color: "#64748B" }}>
              No active teammates in the workload summary.
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
                    {m.weekly_hours === 0 ? "No weekly capacity · utilization N/A" : `${m.load.replace("_", " ")} · ${m.utilization_pct}%`}
                  </span>
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
                    <li key={a.id}>{a.work_item} · {a.hours}h{a.due_date ? ` · due ${calendarDay(a.due_date)}` : ""}{" "}
                      {(["done", "cancelled"] as const).map((status) => <button key={status} type="button" disabled={locked}
                        onClick={() => reviewAction({ kind: "status", id: a.id, status, label: `Mark ${a.work_item} ${status}? This closes only this capacity assignment; the underlying agent task stays unchanged.` })}
                        style={{ ...btnStyle, padding: "4px 8px", marginLeft: 4 }}>Mark {status}</button>)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <h3 style={{ margin: "0 0 10px" }}>Open agent task queue</h3>
        {data && <p>Showing {data.agent_workload.length} listed tasks of {data.totals.open_agent_tasks} total open tasks (list cap: 100). Priority-based hours are estimates for this listed subset, including tasks already assigned.</p>}
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
          {(data?.agent_workload || []).length === 0 ? (
            <div style={{ padding: 18, color: "#64748B" }}>{data ? data.totals.open_agent_tasks === 0 ? "No open agent tasks." : "No tasks returned in the listed subset." : "Task queue unavailable until workload loads."}</div>
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
                      <button type="button" disabled={locked} onClick={() => prefill(w.id)} style={{ ...btnStyle, padding: "6px 10px", fontSize: "0.78rem" }}>
                        Review assignment
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

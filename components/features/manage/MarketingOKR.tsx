"use client";

// Marketing OKR Tracker — set quarterly marketing objectives, add key results
// with optional auto-tracking from live campaign data (spend, impressions,
// clicks, conversions, ROAS), and monitor progress with status badges.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

// ── types ─────────────────────────────────────────────────────────────────────

interface KeyResult {
  id: string;
  title: string;
  metric_type: string;
  linked_channel: string;
  target_value: number;
  current_value: number;
  unit: string;
  updated_at: string;
}

interface Objective {
  id: string;
  title: string;
  description: string;
  quarter: string;
  owner_email: string;
  status: "on_track" | "at_risk" | "off_track" | "complete";
  key_results: KeyResult[];
  created_at: string;
}

interface ObjResp   { ok: boolean; objectives?: Objective[]; error?: string; }
interface QtrResp   { ok: boolean; quarters?: string[]; current?: string; }
interface SaveResp  { ok: boolean; id?: string; error?: string; }
interface RefreshR  { ok: boolean; status?: string; key_results?: KeyResult[]; error?: string; }

// ── constants ─────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  on_track:  { label: "On Track",  color: "#15803d", bg: "#dcfce7", icon: "🟢" },
  at_risk:   { label: "At Risk",   color: "#92400e", bg: "#fef9c3", icon: "🟡" },
  off_track: { label: "Off Track", color: "#b91c1c", bg: "#fee2e2", icon: "🔴" },
  complete:  { label: "Complete",  color: "#1d4ed8", bg: "#eff6ff", icon: "✅" },
};

const METRIC_TYPES = [
  { value: "manual",      label: "Manual update" },
  { value: "spend",       label: "💰 Ad spend (auto)" },
  { value: "impressions", label: "👁 Impressions (auto)" },
  { value: "clicks",      label: "🖱 Clicks (auto)" },
  { value: "conversions", label: "🎯 Conversions (auto)" },
  { value: "roas",        label: "📈 ROAS (auto)" },
  { value: "leads",       label: "👤 Leads (auto)" },
];

const CHANNELS = ["", "Google", "Meta", "TikTok", "Microsoft", "LinkedIn", "Email", "SEO", "Other"];

// ── sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 70 ? "#16a34a" : pct >= 40 ? "#ca8a04" : "#dc2626";
  return (
    <div style={{ height: 7, background: "#e2e8f0", borderRadius: 99, overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s" }} />
    </div>
  );
}

function KrRow({
  kr,
  onDelete,
}: {
  kr: KeyResult;
  onDelete: () => void;
}) {
  const pct = kr.target_value > 0
    ? Math.min(100, Math.round((Number(kr.current_value) / Number(kr.target_value)) * 100))
    : 0;
  const isAuto = kr.metric_type !== "manual";
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{kr.title}</div>
        <div style={{ color: "#64748b", fontSize: "0.76rem", marginTop: 2 }}>
          {METRIC_TYPES.find(m => m.value === kr.metric_type)?.label}
          {kr.linked_channel ? ` · ${kr.linked_channel}` : ""}
          {isAuto && <span style={{ marginLeft: 6, background: "#f0fdf4", color: "#166534", borderRadius: 8, padding: "1px 6px", fontSize: "0.7rem" }}>auto</span>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180 }}>
        <ProgressBar pct={pct} />
        <div style={{ fontSize: "0.82rem", fontWeight: 700, minWidth: 38, textAlign: "right" }}>{pct}%</div>
      </div>
      <div style={{ fontSize: "0.82rem", color: "#475569", minWidth: 120, textAlign: "right" }}>
        {Number(kr.current_value).toLocaleString()}{kr.unit} / {Number(kr.target_value).toLocaleString()}{kr.unit}
      </div>
      <button onClick={onDelete} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: "0.9rem", padding: "2px 6px" }} title="Remove">✕</button>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function MarketingOKR() {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [quarters, setQuarters]     = useState<string[]>([]);
  const [currentQ, setCurrentQ]     = useState("");
  const [selQ, setSelQ]             = useState("");
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  // modals
  const [showAddObj,  setShowAddObj]  = useState(false);
  const [showAddKr,   setShowAddKr]   = useState<string | null>(null); // objective id
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());

  // forms
  const [objForm, setObjForm] = useState({ title: "", description: "", owner_email: "" });
  const [krForm,  setKrForm]  = useState({
    title: "", metric_type: "manual", linked_channel: "", target_value: "", current_value: "", unit: "",
  });
  const [saving, setSaving] = useState(false);

  async function load(q: string) {
    setLoading(true);
    const r = await apiGet<ObjResp>(`/api/okr/objectives${q ? `?quarter=${q}` : ""}`);
    setObjectives(r.ok && r.objectives ? r.objectives : []);
    setLoading(false);
  }

  useEffect(() => {
    apiGet<QtrResp>("/api/okr/quarters").then(r => {
      if (r.ok) {
        setQuarters(r.quarters ?? []);
        const q = r.current ?? "";
        setCurrentQ(q);
        setSelQ(q);
        load(q);
      }
    });
  }, []);

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function saveObjective() {
    if (!objForm.title.trim()) return;
    setSaving(true);
    const r = await apiPost<SaveResp>("/api/okr/objectives", {
      title: objForm.title, description: objForm.description,
      quarter: selQ, owner_email: objForm.owner_email,
    });
    setSaving(false);
    if (r.ok) { setShowAddObj(false); setObjForm({ title: "", description: "", owner_email: "" }); load(selQ); }
    else alert(r.error || "Failed to save");
  }

  async function deleteObjective(id: string) {
    if (!confirm("Delete this objective and all its key results?")) return;
    await apiDelete(`/api/okr/objectives/${id}`);
    load(selQ);
  }

  async function saveKr(objId: string) {
    if (!krForm.title.trim()) return;
    setSaving(true);
    const r = await apiPost<SaveResp>(`/api/okr/objectives/${objId}/key-results`, {
      title: krForm.title, metric_type: krForm.metric_type,
      linked_channel: krForm.linked_channel,
      target_value: parseFloat(krForm.target_value) || 0,
      current_value: parseFloat(krForm.current_value) || 0,
      unit: krForm.unit,
    });
    setSaving(false);
    if (r.ok) { setShowAddKr(null); setKrForm({ title: "", metric_type: "manual", linked_channel: "", target_value: "", current_value: "", unit: "" }); load(selQ); }
    else alert(r.error || "Failed to save");
  }

  async function deleteKr(krId: string) {
    await apiDelete(`/api/okr/key-results/${krId}`);
    load(selQ);
  }

  async function refreshObjective(id: string) {
    setRefreshing(id);
    const r = await apiPost<RefreshR>(`/api/okr/objectives/${id}/refresh`, {});
    setRefreshing(null);
    if (r.ok) load(selQ);
    else alert(r.error || "Refresh failed");
  }

  async function markComplete(obj: Objective) {
    await apiPost<SaveResp>("/api/okr/objectives", {
      id: obj.id, title: obj.title, description: obj.description,
      quarter: obj.quarter, owner_email: obj.owner_email, status: "complete",
    });
    load(selQ);
  }

  const onTrack  = objectives.filter(o => o.status === "on_track").length;
  const atRisk   = objectives.filter(o => o.status === "at_risk").length;
  const offTrack = objectives.filter(o => o.status === "off_track").length;
  const complete = objectives.filter(o => o.status === "complete").length;

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Marketing OKRs
              </div>
              <h2 className="view-title">🎯 Marketing OKR Tracker</h2>
              <p className="view-sub">
                Set quarterly marketing objectives, attach key results with
                targets, and track real progress from live campaign data — spend,
                clicks, conversions, and ROAS update automatically.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>

        {/* Controls */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
          <select
            value={selQ}
            onChange={e => { setSelQ(e.target.value); load(e.target.value); }}
            className="form-control"
            style={{ maxWidth: 160 }}
          >
            {quarters.map(q => (
              <option key={q} value={q}>{q}{q === currentQ ? " (current)" : ""}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={() => setShowAddObj(true)}>
            + Add Objective
          </button>
        </div>

        {/* Summary pills */}
        {objectives.length > 0 && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 22 }}>
            {(["on_track","at_risk","off_track","complete"] as const).map(key => {
              const sm = STATUS_META[key];
              const val = key === "on_track" ? onTrack : key === "at_risk" ? atRisk : key === "off_track" ? offTrack : complete;
              return (
                <div key={key} style={{ background: sm.bg, color: sm.color, borderRadius: 20, padding: "5px 14px", fontSize: "0.83rem", fontWeight: 600 }}>
                  {sm.icon} {val} {sm.label}
                </div>
              );
            })}
          </div>
        )}

        {/* Objectives list */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading…</div>
        ) : objectives.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 40, textAlign: "center", color: "#64748b" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>🎯</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No objectives for {selQ}</div>
            <div style={{ fontSize: "0.88rem", marginBottom: 18 }}>
              Add your first marketing objective for this quarter.
            </div>
            <button className="btn btn-primary" onClick={() => setShowAddObj(true)}>
              + Add Objective
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {objectives.map(obj => {
              const sm = STATUS_META[obj.status] || STATUS_META.on_track;
              const isOpen = expanded.has(obj.id);
              const krs = obj.key_results || [];
              const avgPct = krs.length
                ? Math.round(krs.reduce((s, kr) => s + (kr.target_value > 0 ? Math.min(100, (Number(kr.current_value) / Number(kr.target_value)) * 100) : 0), 0) / krs.length)
                : 0;
              return (
                <div key={obj.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
                  {/* Header */}
                  <div
                    onClick={() => toggleExpanded(obj.id)}
                    style={{ padding: "16px 20px", cursor: "pointer", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}
                  >
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontWeight: 700, fontSize: "1rem" }}>{obj.title}</div>
                      {obj.description && (
                        <div style={{ color: "#64748b", fontSize: "0.83rem", marginTop: 3 }}>{obj.description}</div>
                      )}
                      {obj.owner_email && (
                        <div style={{ color: "#94a3b8", fontSize: "0.76rem", marginTop: 2 }}>👤 {obj.owner_email}</div>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      {krs.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 120 }}>
                          <ProgressBar pct={avgPct} />
                          <span style={{ fontSize: "0.83rem", fontWeight: 700 }}>{avgPct}%</span>
                        </div>
                      )}
                      <div style={{ background: sm.bg, color: sm.color, borderRadius: 20, padding: "4px 12px", fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {sm.icon} {sm.label}
                      </div>
                      <div style={{ color: "#64748b", fontSize: "0.8rem" }}>{krs.length} KRs</div>
                      <span style={{ color: "#94a3b8" }}>{isOpen ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {/* Body */}
                  {isOpen && (
                    <div style={{ borderTop: "1px solid #e2e8f0", padding: "14px 20px" }}>
                      {/* Key results */}
                      {krs.length > 0 ? (
                        krs.map(kr => (
                          <KrRow key={kr.id} kr={kr} onDelete={() => deleteKr(kr.id)} />
                        ))
                      ) : (
                        <div style={{ color: "#94a3b8", fontSize: "0.85rem", paddingBottom: 10 }}>
                          No key results yet — add one below.
                        </div>
                      )}

                      {/* Actions */}
                      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => setShowAddKr(obj.id)}
                        >
                          + Key Result
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={refreshing === obj.id}
                          onClick={() => refreshObjective(obj.id)}
                        >
                          {refreshing === obj.id ? "⏳ Refreshing…" : "⚡ Refresh from campaigns"}
                        </button>
                        {obj.status !== "complete" && (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => markComplete(obj)}
                          >
                            ✅ Mark complete
                          </button>
                        )}
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ color: "#dc2626", borderColor: "#fecaca" }}
                          onClick={() => deleteObjective(obj.id)}
                        >
                          🗑 Delete
                        </button>
                      </div>

                      {/* Inline add-KR form */}
                      {showAddKr === obj.id && (
                        <div style={{ marginTop: 16, background: "#f8fafc", borderRadius: 8, padding: 16, border: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 700, marginBottom: 12, fontSize: "0.9rem" }}>Add Key Result</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <input className="form-control" placeholder="Key result title*"
                              value={krForm.title} onChange={e => setKrForm(f => ({ ...f, title: e.target.value }))} />
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                              <div>
                                <label style={{ fontSize: "0.8rem", color: "#64748b" }}>Tracking method</label>
                                <select className="form-control"
                                  value={krForm.metric_type} onChange={e => setKrForm(f => ({ ...f, metric_type: e.target.value }))}>
                                  {METRIC_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                </select>
                              </div>
                              <div>
                                <label style={{ fontSize: "0.8rem", color: "#64748b" }}>Channel filter (optional)</label>
                                <select className="form-control"
                                  value={krForm.linked_channel} onChange={e => setKrForm(f => ({ ...f, linked_channel: e.target.value }))}>
                                  {CHANNELS.map(c => <option key={c} value={c}>{c || "All channels"}</option>)}
                                </select>
                              </div>
                              <div>
                                <label style={{ fontSize: "0.8rem", color: "#64748b" }}>Target value*</label>
                                <input className="form-control" type="number" placeholder="e.g. 50000"
                                  value={krForm.target_value} onChange={e => setKrForm(f => ({ ...f, target_value: e.target.value }))} />
                              </div>
                              <div>
                                <label style={{ fontSize: "0.8rem", color: "#64748b" }}>
                                  {krForm.metric_type === "manual" ? "Current value" : "Starting value (auto-updates)"}
                                </label>
                                <input className="form-control" type="number" placeholder="e.g. 0"
                                  value={krForm.current_value} onChange={e => setKrForm(f => ({ ...f, current_value: e.target.value }))} />
                              </div>
                            </div>
                            <input className="form-control" placeholder="Unit (e.g. $, %, leads)"
                              value={krForm.unit} onChange={e => setKrForm(f => ({ ...f, unit: e.target.value }))} />
                            {krForm.metric_type !== "manual" && (
                              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "8px 12px", fontSize: "0.8rem", color: "#1d4ed8" }}>
                                ⚡ This key result will auto-update from your campaign data when you click <strong>Refresh from campaigns</strong>.
                              </div>
                            )}
                            <div style={{ display: "flex", gap: 8 }}>
                              <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => saveKr(obj.id)}>
                                {saving ? "Saving…" : "Save Key Result"}
                              </button>
                              <button className="btn btn-outline btn-sm" onClick={() => setShowAddKr(null)}>Cancel</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add Objective modal */}
        {showAddObj && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div style={{ background: "#fff", borderRadius: 14, padding: 28, width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
              <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: 18 }}>🎯 New Objective — {selQ}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ fontSize: "0.85rem", color: "#64748b" }}>Objective title*</label>
                  <input className="form-control" placeholder="e.g. Drive 40% more organic leads this quarter"
                    value={objForm.title} onChange={e => setObjForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: "0.85rem", color: "#64748b" }}>Description (optional)</label>
                  <textarea className="form-control" rows={2} placeholder="Context, motivation or strategy…"
                    value={objForm.description} onChange={e => setObjForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: "0.85rem", color: "#64748b" }}>Owner email (optional)</label>
                  <input className="form-control" type="email" placeholder="team@example.com"
                    value={objForm.owner_email} onChange={e => setObjForm(f => ({ ...f, owner_email: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button className="btn btn-primary" disabled={saving} onClick={saveObjective}>
                  {saving ? "Saving…" : "Create Objective"}
                </button>
                <button className="btn btn-outline" onClick={() => setShowAddObj(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

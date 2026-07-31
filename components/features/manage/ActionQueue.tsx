"use client";

// Daily Action Queue — surfaces ranked AI recommendations from the Decision
// Engine (T95) alongside live optimizer signals and budget goals in one
// actionable "what to do today" dashboard inspired by Madgicx.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Recommendation {
  id: number;
  category: string;
  title: string;
  recommendation: string;
  expected_impact: string;
  confidence_pct: number;
  cost_estimate: string;
  time_to_result: string;
  priority_score: number;
  data_sources: string;
  why_best?: string;
  problem_summary?: string;
  change_summary?: string;
  entities?: {
    from?: { name?: string; channel?: string; roas?: number | null }[];
    to?: { name?: string; channel?: string; roas?: number | null }[];
    affected?: { name?: string; type?: string }[];
  };
  acted_at?: string | null;
  created_at: string;
}

interface RecsResp   { ok: boolean; recommendations?: Recommendation[]; error?: string; }
interface AnalyseR   {
  ok: boolean;
  recommendations?: Recommendation[];
  summary?: string;
  top_opportunity?: string;
  future_risks?: string[];
  future_opportunities?: string[];
  learning_applied?: { categories_tracked?: number; preferred_count?: number; avoided_count?: number; memory_lessons?: number };
  generated_at?: string;
  error?: string;
}
interface BudgetResp { ok: boolean; summary?: { target_cents: number; actual_cents: number; by_channel: Record<string, { target_cents: number; actual_cents: number }> }; error?: string; }
interface OptimResp  { ok: boolean; campaigns?: { id: string; name: string; platform: string; roas_7d: number; target_roas: number; status: string }[]; error?: string; }

const CAT_META: Record<string, { icon: string; color: string; bg: string }> = {
  budget:      { icon: "💰", color: "#92400e", bg: "#fef9c3" },
  channel:     { icon: "📡", color: "#1e3a5f", bg: "#dbeafe" },
  creative:    { icon: "🎨", color: "#5b21b6", bg: "#ede9fe" },
  audience:    { icon: "👥", color: "#065f46", bg: "#d1fae5" },
  seo:         { icon: "🔍", color: "#0c4a6e", bg: "#e0f2fe" },
  lifecycle:   { icon: "🔄", color: "#7c3aed", bg: "#f3e8ff" },
  competitive: { icon: "⚔️", color: "#991b1b", bg: "#fee2e2" },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ConfidencePill({ pct }: { pct: number }) {
  const color = pct >= 75 ? "#16a34a" : pct >= 55 ? "#ca8a04" : "#dc2626";
  return (
    <span style={{ fontSize: "0.73rem", fontWeight: 700, color, background: color + "18", borderRadius: 10, padding: "2px 7px" }}>
      {pct}% confidence
    </span>
  );
}

export default function ActionQueue() {
  const [recs, setRecs]           = useState<Recommendation[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastGen, setLastGen]     = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [acted, setActed]         = useState<Set<number>>(new Set());
  const [budget, setBudget]       = useState<BudgetResp["summary"] | null>(null);
  const [campaigns, setCampaigns] = useState<OptimResp["campaigns"]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [catFilter, setCatFilter] = useState("all");
  const [foresight, setForesight] = useState<{ risks: string[]; opportunities: string[]; learning?: AnalyseR["learning_applied"] }>({ risks: [], opportunities: [] });

  async function loadRecs() {
    const r = await apiGet<RecsResp>("/api/decision-engine/recommendations");
    if (r.ok && r.recommendations?.length) {
      setRecs(r.recommendations);
      setLastGen(r.recommendations[0]?.created_at || null);
    }
    setLoading(false);
  }

  async function loadSidebars() {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [b, o] = await Promise.all([
      apiGet<BudgetResp>(`/api/budget/summary?month=${month}`),
      apiGet<OptimResp>("/api/optimizer/campaigns"),
    ]);
    if (b.ok) setBudget(b.summary ?? null);
    if (o.ok) setCampaigns(o.campaigns ?? []);
  }

  useEffect(() => {
    loadRecs();
    loadSidebars();
  }, []);

  async function refresh() {
    setRefreshing(true);
    const analysis_snapshot =
      typeof window !== "undefined"
        ? (window as unknown as { analysisData?: Record<string, unknown> }).analysisData || null
        : null;
    const r = await apiPost<AnalyseR>("/api/decision-engine/analyse", {
      replace_open: true,
      analysis_snapshot,
    });
    setRefreshing(false);
    if (r.ok) {
      setForesight({
        risks: r.future_risks || [],
        opportunities: r.future_opportunities || [],
        learning: r.learning_applied,
      });
      // Reload from DB so ids/why_best are authoritative
      await loadRecs();
      setDismissed(new Set());
      setActed(new Set());
      if (r.generated_at) setLastGen(r.generated_at);
    }
  }

  async function doAct(id: number) {
    await apiPost(`/api/decision-engine/act/${id}`, {});
    setActed(prev => new Set([...prev, id]));
  }

  async function doDismiss(id: number) {
    await apiPost(`/api/decision-engine/dismiss/${id}`, {});
    setDismissed(prev => new Set([...prev, id]));
  }

  const visible = recs.filter(r => !dismissed.has(r.id));
  const cats = ["all", ...Array.from(new Set(visible.map(r => r.category)))];
  const filtered = catFilter === "all" ? visible : visible.filter(r => r.category === catFilter);
  const pendingCount = visible.filter(r => !acted.has(r.id)).length;

  // Budget gauge helpers
  const spendPct = budget
    ? Math.min(100, Math.round((budget.actual_cents / (budget.target_cents || 1)) * 100))
    : null;
  const spendColor = spendPct == null ? "#64748b" : spendPct > 95 ? "#dc2626" : spendPct > 80 ? "#ca8a04" : "#16a34a";

  // Campaign health
  const atRisk = (campaigns ?? []).filter(c => c.roas_7d < c.target_roas * 0.5).length;
  const performing = (campaigns ?? []).filter(c => c.roas_7d >= c.target_roas * 1.5).length;

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Daily Action Queue
              </div>
              <h2 className="view-title">🚀 Daily Action Queue</h2>
              <p className="view-sub">
                AI-ranked actions for today — budget moves, creative fixes, channel
                shifts, and growth opportunities synthesised from all your platform
                data.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>

          {/* ── Main column ────────────────────────────────── */}
          <div style={{ flex: "1 1 480px", minWidth: 320 }}>

            {/* Header bar */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 18px", marginBottom: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: "1rem" }}>
                  {loading ? "Loading…" : `${pendingCount} action${pendingCount !== 1 ? "s" : ""} for you`}
                </div>
                {lastGen && (
                  <div style={{ color: "#94a3b8", fontSize: "0.76rem", marginTop: 1 }}>
                    Updated {timeAgo(lastGen)}
                  </div>
                )}
              </div>
              <button
                className="btn btn-primary"
                onClick={refresh}
                disabled={refreshing}
                style={{ whiteSpace: "nowrap" }}
              >
                {refreshing ? "⏳ Generating…" : "✨ Refresh with AI"}
              </button>
            </div>

            {(foresight.risks.length > 0 || foresight.opportunities.length > 0 || foresight.learning) && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginBottom: 14 }}>
                {foresight.risks.length > 0 && (
                  <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#DC2626", marginBottom: 6 }}>🔮 Future risks</div>
                    <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                      {foresight.risks.slice(0, 4).map((r, i) => (
                        <li key={i} style={{ fontSize: "0.8rem", color: "#7F1D1D", lineHeight: 1.45, marginBottom: 3 }}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {foresight.opportunities.length > 0 && (
                  <div style={{ background: "#ECFDF5", border: "1.5px solid #A7F3D0", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#059669", marginBottom: 6 }}>🔭 Future opportunities</div>
                    <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                      {foresight.opportunities.slice(0, 4).map((o, i) => (
                        <li key={i} style={{ fontSize: "0.8rem", color: "#064E3B", lineHeight: 1.45, marginBottom: 3 }}>{o}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {foresight.learning && (
                  <div style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#2563EB", marginBottom: 6 }}>🧠 Learning applied</div>
                    <div style={{ fontSize: "0.8rem", color: "#1E3A8A", lineHeight: 1.5 }}>
                      {foresight.learning.preferred_count || 0} past acts · {foresight.learning.avoided_count || 0} dismissed · {foresight.learning.memory_lessons || 0} memory lessons shaping this run
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Category filter */}
            {cats.length > 2 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {cats.map(c => {
                  const meta = CAT_META[c];
                  const active = catFilter === c;
                  return (
                    <button
                      key={c}
                      onClick={() => setCatFilter(c)}
                      style={{
                        border: `1.5px solid ${active ? (meta?.color || "#0ea5e9") : "#e2e8f0"}`,
                        background: active ? (meta?.bg || "#f0f9ff") : "#fff",
                        color: active ? (meta?.color || "#0369a1") : "#64748b",
                        borderRadius: 20, padding: "4px 12px", fontSize: "0.79rem",
                        fontWeight: active ? 700 : 500, cursor: "pointer",
                      }}
                    >
                      {meta?.icon ? `${meta.icon} ` : ""}{c === "all" ? "All" : c}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Cards */}
            {loading ? (
              <div style={{ textAlign: "center", padding: 48, color: "#64748b" }}>
                Loading recommendations…
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 36, textAlign: "center", color: "#64748b" }}>
                <div style={{ fontSize: "2rem", marginBottom: 8 }}>🎉</div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>All caught up!</div>
                <div style={{ fontSize: "0.86rem", marginBottom: 18 }}>
                  No pending actions. Click <strong>Refresh with AI</strong> to generate new ones.
                </div>
                <button className="btn btn-primary" onClick={refresh} disabled={refreshing}>
                  {refreshing ? "Generating…" : "✨ Generate new actions"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filtered.map(rec => {
                  const meta = CAT_META[rec.category] || { icon: "💡", color: "#475569", bg: "#f1f5f9" };
                  const isActed = acted.has(rec.id) || !!rec.acted_at;
                  const isOpen = expandedId === rec.id;
                  return (
                    <div
                      key={rec.id}
                      style={{
                        background: "#fff",
                        border: `1px solid ${isActed ? "#dcfce7" : "#e2e8f0"}`,
                        borderLeft: `4px solid ${isActed ? "#16a34a" : meta.color}`,
                        borderRadius: 10,
                        opacity: isActed ? 0.75 : 1,
                      }}
                    >
                      {/* Top row */}
                      <div
                        onClick={() => setExpandedId(isOpen ? null : rec.id)}
                        style={{ padding: "12px 16px", cursor: "pointer", display: "flex", gap: 10, alignItems: "flex-start" }}
                      >
                        <div style={{ fontSize: "1.3rem", lineHeight: 1, paddingTop: 2 }}>{meta.icon}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 3 }}>
                            <span style={{ background: meta.bg, color: meta.color, borderRadius: 10, padding: "2px 8px", fontSize: "0.72rem", fontWeight: 700 }}>
                              {rec.category}
                            </span>
                            <ConfidencePill pct={rec.confidence_pct} />
                            <span style={{ color: "#94a3b8", fontSize: "0.72rem", marginLeft: "auto" }}>
                              Priority {rec.priority_score}
                            </span>
                          </div>
                          <div style={{ fontWeight: 700, fontSize: "0.93rem" }}>{rec.title}</div>
                          <div style={{ color: "#64748b", fontSize: "0.82rem", marginTop: 3 }}>
                            {rec.expected_impact} · {rec.time_to_result}
                          </div>
                          {(rec.entities?.from?.length || rec.entities?.to?.length) ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                              {(rec.entities?.from || []).map((e, i) => (
                                <span key={`f-${i}`} style={{ background: "#FEE2E2", color: "#991B1B", borderRadius: 5, padding: "2px 7px", fontSize: "0.68rem", fontWeight: 700 }}>
                                  From: {e.name}{e.roas != null ? ` · ${e.roas}×` : ""}
                                </span>
                              ))}
                              {(rec.entities?.to || []).map((e, i) => (
                                <span key={`t-${i}`} style={{ background: "#DCFCE7", color: "#166534", borderRadius: 5, padding: "2px 7px", fontSize: "0.68rem", fontWeight: 700 }}>
                                  To: {e.name}{e.roas != null ? ` · ${e.roas}×` : ""}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <span style={{ color: "#94a3b8", fontSize: "0.8rem", flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
                      </div>

                      {/* Expanded detail */}
                      {isOpen && (
                        <div style={{ padding: "0 16px 14px 16px", borderTop: "1px solid #f1f5f9" }}>
                          {rec.problem_summary && (
                            <p style={{ color: "#9A3412", fontSize: "0.82rem", margin: "10px 0 6px", background: "#FFF7ED", padding: "8px 10px", borderRadius: 8 }}>
                              <strong>Not working:</strong> {rec.problem_summary}
                            </p>
                          )}
                          {rec.change_summary && (
                            <p style={{ color: "#1E3A8A", fontSize: "0.82rem", margin: "0 0 8px", background: "#EFF6FF", padding: "8px 10px", borderRadius: 8 }}>
                              <strong>Change:</strong> {rec.change_summary}
                            </p>
                          )}
                          <p style={{ color: "#334155", fontSize: "0.87rem", margin: "10px 0" }}>
                            {rec.recommendation}
                          </p>
                          {rec.why_best && (
                            <p style={{ color: "#78716C", fontSize: "0.82rem", margin: "0 0 10px", fontStyle: "italic" }}>
                              <strong style={{ fontStyle: "normal", color: "#B45309" }}>Why best:</strong> {rec.why_best}
                            </p>
                          )}
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "0.79rem", color: "#64748b", marginBottom: 12 }}>
                            <span>💰 Cost: {rec.cost_estimate}</span>
                            <span>📊 Sources: {rec.data_sources}</span>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            {!isActed ? (
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => doAct(rec.id)}
                              >
                                🚀 Launch
                              </button>
                            ) : (
                              <span style={{ fontSize: "0.82rem", color: "#16a34a", fontWeight: 700 }}>✓ Launched</span>
                            )}
                            <button
                              className="btn btn-outline btn-sm"
                              style={{ color: "#94a3b8" }}
                              onClick={() => doDismiss(rec.id)}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Collapsed quick actions */}
                      {!isOpen && (
                        <div style={{ padding: "0 16px 12px 42px", display: "flex", gap: 8 }}>
                          {!isActed ? (
                            <button className="btn btn-primary btn-sm" onClick={() => doAct(rec.id)}>
                              🚀 Launch
                            </button>
                          ) : (
                            <span style={{ fontSize: "0.8rem", color: "#16a34a", fontWeight: 700 }}>✓ Launched</span>
                          )}
                          <button
                            className="btn btn-outline btn-sm"
                            style={{ color: "#94a3b8", fontSize: "0.77rem" }}
                            onClick={() => doDismiss(rec.id)}
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Sidebar: monthly goals + campaign health ───── */}
          <div style={{ width: 260, flexShrink: 0 }}>

            {/* Monthly goals */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: "0.93rem", marginBottom: 12 }}>📅 Monthly goals</div>
              {budget ? (
                <>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: 4 }}>
                      <span style={{ color: "#64748b" }}>💰 Ad spend</span>
                      <span style={{ fontWeight: 700 }}>
                        ${Math.round(budget.actual_cents / 100).toLocaleString()} / ${Math.round(budget.target_cents / 100).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ height: 7, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${spendPct ?? 0}%`, height: "100%", background: spendColor, borderRadius: 99 }} />
                    </div>
                    <div style={{ fontSize: "0.73rem", color: spendColor, marginTop: 2, fontWeight: 600 }}>
                      {spendPct}% of budget used
                    </div>
                  </div>
                  {Object.entries(budget.by_channel || {}).slice(0, 4).map(([ch, vals]) => {
                    const pct = vals.target_cents > 0 ? Math.min(100, Math.round((vals.actual_cents / vals.target_cents) * 100)) : 0;
                    return (
                      <div key={ch} style={{ marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.77rem", marginBottom: 2 }}>
                          <span style={{ color: "#64748b" }}>{ch}</span>
                          <span style={{ fontWeight: 600 }}>{pct}%</span>
                        </div>
                        <div style={{ height: 5, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "#0ea5e9", borderRadius: 99 }} />
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div style={{ color: "#94a3b8", fontSize: "0.83rem" }}>
                  Set your monthly budget in the Budget Board to see goals here.
                </div>
              )}
            </div>

            {/* Campaign health */}
            {(campaigns ?? []).length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 18px" }}>
                <div style={{ fontWeight: 700, fontSize: "0.93rem", marginBottom: 12 }}>📊 Campaign health</div>
                {atRisk > 0 && (
                  <div style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 8, padding: "8px 10px", fontSize: "0.81rem", fontWeight: 600, marginBottom: 8 }}>
                    ⚠ {atRisk} campaign{atRisk > 1 ? "s" : ""} below 50% ROAS target
                  </div>
                )}
                {performing > 0 && (
                  <div style={{ background: "#dcfce7", color: "#15803d", borderRadius: 8, padding: "8px 10px", fontSize: "0.81rem", fontWeight: 600, marginBottom: 8 }}>
                    🚀 {performing} campaign{performing > 1 ? "s" : ""} ready to scale
                  </div>
                )}
                {(campaigns ?? []).slice(0, 5).map(c => {
                  const ratio = c.target_roas > 0 ? c.roas_7d / c.target_roas : 0;
                  const color = ratio >= 1.5 ? "#16a34a" : ratio >= 0.5 ? "#ca8a04" : "#dc2626";
                  return (
                    <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.8rem" }}>
                      <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#334155" }}>
                        {c.name}
                      </div>
                      <div style={{ fontWeight: 700, color, marginLeft: 8, flexShrink: 0 }}>
                        {c.roas_7d?.toFixed(1)}x
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

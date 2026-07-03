"use client";
import { useState, useEffect } from "react";
import { apiPost, apiGet, apiDelete } from "@/lib/api";

interface Touchpoint {
  channel: string;
  spend: string;
  impressions: string;
  clicks: string;
  leads: string;
  customers: string;
  revenue: string;
}

interface ModelRow {
  channel: string;
  spend: number;
  revenue: number;
  customers: number;
  credit: number;
  position: number;
}

interface AttributionRun {
  id: number;
  name: string;
  date_range: string;
  total_spend: number;
  total_revenue: number;
  total_leads: number;
  total_customers: number;
  models: Record<string, ModelRow[]>;
  insights: { type: string; text: string }[];
  created_at: string;
}

const MODELS = [
  { key: "first_touch",    label: "First Touch",     desc: "100% credit to the first channel the customer interacted with.", color: "#6366F1" },
  { key: "last_touch",     label: "Last Touch",      desc: "100% credit to the final channel before conversion.", color: "#059669" },
  { key: "linear",         label: "Linear",          desc: "Equal credit shared across all touchpoints.", color: "#D97706" },
  { key: "position_based", label: "Position-Based",  desc: "40% first, 40% last, 20% shared across middle channels.", color: "#DC2626" },
  { key: "time_decay",     label: "Time Decay",      desc: "More recent touchpoints receive exponentially more credit.", color: "#7C3AED" },
];

const EMPTY_TP: Touchpoint = { channel: "", spend: "", impressions: "", clicks: "", leads: "", customers: "", revenue: "" };
const CHANNELS = ["Google Ads","Meta Ads","TikTok Ads","LinkedIn Ads","Email","Organic Search","Direct","Referral","Social Organic","YouTube","Display","Podcast","Affiliate","Other"];

function fmt(n: number, prefix = "$") {
  if (n === undefined || n === null) return "—";
  if (n >= 1000000) return prefix + (n / 1000000).toFixed(1) + "M";
  if (n >= 1000)    return prefix + (n / 1000).toFixed(1) + "K";
  return prefix + n.toFixed(2);
}
function fmtN(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000)    return (n / 1000).toFixed(1) + "K";
  return String(Math.round(n));
}

export default function AttributionDashboard() {
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([
    { ...EMPTY_TP, channel: "Google Ads" },
    { ...EMPTY_TP, channel: "Meta Ads" },
    { ...EMPTY_TP, channel: "Email" },
  ]);
  const [name, setName]       = useState("Q2 2026");
  const [dateRange, setDateRange] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<AttributionRun | null>(null);
  const [activeModel, setActiveModel] = useState("linear");
  const [history, setHistory] = useState<AttributionRun[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    apiGet<{ ok: boolean; runs: AttributionRun[] }>("/api/attribution/history").then(d => {
      if (d.ok) setHistory(d.runs || []);
    });
  }, []);

  function addRow() { setTouchpoints(p => [...p, { ...EMPTY_TP }]); }
  function removeRow(i: number) { setTouchpoints(p => p.filter((_, idx) => idx !== i)); }
  function updateRow(i: number, field: keyof Touchpoint, val: string) {
    setTouchpoints(p => p.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  }

  async function run() {
    setError(null);
    if (touchpoints.every(t => !t.channel.trim())) return setError("Add at least one touchpoint.");
    setLoading(true);
    const d = await apiPost<{ ok: boolean; error?: string } & Partial<AttributionRun>>(
      "/api/attribution/model",
      { name, date_range: dateRange, touchpoints: touchpoints.map(t => ({
        channel: t.channel, spend: +t.spend || 0, impressions: +t.impressions || 0,
        clicks: +t.clicks || 0, leads: +t.leads || 0, customers: +t.customers || 0, revenue: +t.revenue || 0,
      })) }
    );
    setLoading(false);
    if (!d.ok) { setError(d.error || "Failed"); return; }
    const run: AttributionRun = d as unknown as AttributionRun;
    setResult(run);
    setHistory(p => [{ ...run, id: run.run_id as unknown as number, name, created_at: new Date().toISOString() } as AttributionRun, ...p]);
  }

  async function deleteRun(id: number) {
    await apiDelete(`/api/attribution/run/${id}`);
    setHistory(p => p.filter(r => r.id !== id));
    if (result && (result as unknown as { run_id: number }).run_id === id) setResult(null);
  }

  function loadRun(run: AttributionRun) {
    setResult(run);
    setHistoryOpen(false);
  }

  const modelRows: ModelRow[] = result?.models?.[activeModel] || [];
  const totalCredit = modelRows.reduce((s, r) => s + (r.credit || 0), 0);

  return (
    <div style={{ fontFamily: "Inter, sans-serif", background: "#F8FAFF", minHeight: "100vh" }}>
      {/* Hero */}
      <div style={{ background: "linear-gradient(135deg, #0A1F4E 0%, #1E3A8A 60%, #3B82F6 100%)", padding: "28px 28px 24px", position: "relative" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: "0.65rem", fontWeight: 800, background: "rgba(255,255,255,.15)", color: "#E0E7FF", padding: "3px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: ".07em" }}>GROW</span>
            <span style={{ color: "rgba(255,255,255,.3)", fontSize: "0.65rem" }}>›</span>
            <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "rgba(255,255,255,.55)", textTransform: "uppercase", letterSpacing: ".07em" }}>Attribution Modeling</span>
          </div>
          <h2 style={{ margin: 0, fontFamily: "Sora, sans-serif", fontSize: "1.55rem", fontWeight: 900, color: "#fff" }}>🧮 Multi-Touch Attribution</h2>
          <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,.7)", fontSize: "0.85rem", maxWidth: 520 }}>
            Model revenue credit across every marketing channel — first-touch, last-touch, linear, position-based, and time-decay — to see which channels truly drive growth.
          </p>
          <button onClick={() => setHistoryOpen(o => !o)} style={{ marginTop: 12, padding: "6px 16px", background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 20, color: "#fff", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
            📋 Past runs ({history.length})
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px" }}>

        {/* History panel */}
        {historyOpen && history.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 10 }}>Past Attribution Runs</div>
            {history.map(r => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, background: "#F9FAFB", marginBottom: 6 }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>{r.name}</span>
                  {r.date_range && <span style={{ color: "#6B7280", fontSize: "0.72rem", marginLeft: 8 }}>{r.date_range}</span>}
                  <span style={{ color: "#6B7280", fontSize: "0.72rem", marginLeft: 8 }}>
                    {fmt(+r.total_spend)} spend · {fmt(+r.total_revenue)} revenue · {fmtN(+r.total_customers)} customers
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => loadRun(r)} style={{ padding: "3px 10px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, color: "#1D4ED8", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer" }}>Load</button>
                  <button onClick={() => deleteRun(r.id)} style={{ padding: "3px 10px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, color: "#DC2626", fontSize: "0.72rem", cursor: "pointer" }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Input card */}
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, overflow: "hidden", marginBottom: 20 }}>
          <div style={{ background: "linear-gradient(135deg, #F8FAFF, #EFF4FF)", padding: "14px 18px", borderBottom: "1px solid #E8EEF8", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: "0.88rem", color: "#0A1628" }}>Channel Touchpoints</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Run name" style={{ padding: "5px 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.78rem", width: 130 }} />
              <input value={dateRange} onChange={e => setDateRange(e.target.value)} placeholder="e.g. Apr–Jun 2026" style={{ padding: "5px 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.78rem", width: 140 }} />
              <button onClick={addRow} style={{ padding: "5px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, color: "#1D4ED8", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>+ Add Channel</button>
            </div>
          </div>
          <div style={{ padding: 16, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #E5E7EB" }}>
                  {["Channel","Spend ($)","Impressions","Clicks","Leads","Customers","Revenue ($)",""].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700, color: "#374151", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {touchpoints.map((tp, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "5px 4px" }}>
                      <select value={tp.channel} onChange={e => updateRow(i, "channel", e.target.value)} style={{ padding: "4px 8px", border: "1px solid #D1D5DB", borderRadius: 6, fontSize: "0.78rem", width: 150 }}>
                        <option value="">Custom…</option>
                        {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {!CHANNELS.includes(tp.channel) && (
                        <input value={tp.channel} onChange={e => updateRow(i, "channel", e.target.value)} placeholder="Channel name" style={{ marginTop: 4, padding: "3px 6px", border: "1px solid #D1D5DB", borderRadius: 6, fontSize: "0.75rem", width: 140, display: "block" }} />
                      )}
                    </td>
                    {(["spend","impressions","clicks","leads","customers","revenue"] as (keyof Touchpoint)[]).map(f => (
                      <td key={f} style={{ padding: "5px 4px" }}>
                        <input type="number" min="0" value={tp[f]} onChange={e => updateRow(i, f, e.target.value)}
                          style={{ padding: "4px 8px", border: "1px solid #D1D5DB", borderRadius: 6, fontSize: "0.78rem", width: 90 }} />
                      </td>
                    ))}
                    <td style={{ padding: "5px 4px" }}>
                      <button onClick={() => removeRow(i)} disabled={touchpoints.length <= 1} style={{ padding: "3px 8px", background: "#FEF2F2", border: "none", borderRadius: 6, color: "#DC2626", cursor: "pointer", fontSize: "0.78rem" }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginTop: 8 }}>Channels are ordered top→bottom (first touchpoint → last touchpoint before conversion).</div>
          </div>
          {error && <div style={{ margin: "0 16px 12px", padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, color: "#991B1B", fontSize: "0.78rem" }}>⚠️ {error}</div>}
          <div style={{ padding: "12px 16px", borderTop: "1px solid #F3F4F6", display: "flex", justifyContent: "flex-end" }}>
            <button onClick={run} disabled={loading} style={{ padding: "9px 24px", background: loading ? "#F3F4F6" : "linear-gradient(135deg, #1D4ED8, #3B82F6)", border: "none", borderRadius: 20, color: loading ? "#9CA3AF" : "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: loading ? "not-allowed" : "pointer", boxShadow: loading ? "none" : "0 2px 8px rgba(59,130,246,.35)" }}>
              {loading ? "⏳ Modelling…" : "🧮 Model Attribution"}
            </button>
          </div>
        </div>

        {/* Results */}
        {result && (() => {
          const models = result.models || {};
          const currentRows = (models[activeModel] || []) as ModelRow[];
          const totals = { spend: +result.total_spend, revenue: +result.total_revenue, leads: +result.total_leads, customers: +result.total_customers };

          return (
            <>
              {/* Summary stats */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                {[
                  { label: "Total Spend", value: fmt(totals.spend), sub: "all channels", color: "#DC2626" },
                  { label: "Total Revenue", value: fmt(totals.revenue), sub: "attributed", color: "#059669" },
                  { label: "Blended ROAS", value: totals.spend > 0 ? (totals.revenue / totals.spend).toFixed(2) + "x" : "—", sub: "revenue / spend", color: "#7C3AED" },
                  { label: "Customers", value: fmtN(totals.customers), sub: "converted", color: "#1D4ED8" },
                ].map(s => (
                  <div key={s.label} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
                    <div style={{ fontSize: "0.7rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>{s.label}</div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
                    <div style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* Model tabs */}
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, overflow: "hidden", marginBottom: 20 }}>
                <div style={{ borderBottom: "1px solid #E5E7EB", display: "flex", overflowX: "auto" }}>
                  {MODELS.map(m => (
                    <button key={m.key} onClick={() => setActiveModel(m.key)} style={{
                      padding: "10px 16px", border: "none", borderBottom: activeModel === m.key ? `2px solid ${m.color}` : "2px solid transparent",
                      background: "none", fontWeight: activeModel === m.key ? 700 : 500, fontSize: "0.78rem",
                      color: activeModel === m.key ? m.color : "#6B7280", cursor: "pointer", whiteSpace: "nowrap"
                    }}>{m.label}</button>
                  ))}
                </div>
                {(() => {
                  const m = MODELS.find(x => x.key === activeModel)!;
                  return (
                    <div style={{ padding: 16 }}>
                      <div style={{ fontSize: "0.75rem", color: "#6B7280", marginBottom: 14, padding: "8px 12px", background: "#F9FAFB", borderRadius: 8 }}>ℹ️ {m.desc}</div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                        <thead>
                          <tr style={{ borderBottom: "2px solid #E5E7EB" }}>
                            {["Channel","Spend","Revenue (actual)","Attributed Credit","Credit %","ROAS","CPA"].map(h => (
                              <th key={h} style={{ textAlign: "left", padding: "7px 10px", fontWeight: 700, color: "#374151", whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {currentRows.map((r, i) => {
                            const creditPct = totalCredit > 0 ? ((r.credit / totalCredit) * 100) : 0;
                            const roas = r.spend > 0 ? (r.credit / r.spend).toFixed(2) : "—";
                            const cpa  = r.spend > 0 && r.customers > 0 ? fmt(r.spend / r.customers) : "—";
                            return (
                              <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                                <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                                  <span style={{ background: m.color + "15", color: m.color, padding: "2px 8px", borderRadius: 20, fontSize: "0.75rem" }}>{r.channel}</span>
                                </td>
                                <td style={{ padding: "8px 10px", color: "#374151" }}>{fmt(r.spend)}</td>
                                <td style={{ padding: "8px 10px", color: "#374151" }}>{fmt(r.revenue)}</td>
                                <td style={{ padding: "8px 10px", fontWeight: 700, color: m.color }}>{fmt(r.credit)}</td>
                                <td style={{ padding: "8px 10px" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ flex: 1, height: 6, background: "#F3F4F6", borderRadius: 3, overflow: "hidden" }}>
                                      <div style={{ height: "100%", width: `${creditPct}%`, background: m.color, borderRadius: 3 }} />
                                    </div>
                                    <span style={{ fontSize: "0.75rem", color: "#374151", minWidth: 36 }}>{creditPct.toFixed(1)}%</span>
                                  </div>
                                </td>
                                <td style={{ padding: "8px 10px", color: "#059669", fontWeight: 600 }}>{typeof roas === "string" ? roas : roas + "x"}</td>
                                <td style={{ padding: "8px 10px", color: "#374151" }}>{cpa}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>

              {/* Model comparison bar chart */}
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 16, marginBottom: 20 }}>
                <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>📊 Credit Comparison Across All Models</div>
                {(models.linear || []).map((row: ModelRow, ri: number) => (
                  <div key={ri} style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.78rem", color: "#374151", marginBottom: 4 }}>{row.channel}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {MODELS.map(m => {
                        const mr = (models[m.key] || [])[ri];
                        const pct = totalCredit > 0 && mr ? (mr.credit / totalCredit) * 100 : 0;
                        return (
                          <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: "0.68rem", color: "#6B7280", minWidth: 110 }}>{m.label}</span>
                            <div style={{ flex: 1, height: 8, background: "#F3F4F6", borderRadius: 4, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: m.color, borderRadius: 4, transition: "width .4s ease" }} />
                            </div>
                            <span style={{ fontSize: "0.7rem", color: m.color, fontWeight: 700, minWidth: 44, textAlign: "right" }}>{pct.toFixed(1)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* AI Insights */}
              {result.insights && result.insights.length > 0 && (
                <div style={{ background: "linear-gradient(135deg, #1E3A8A, #1D4ED8)", border: "1px solid #3B82F6", borderRadius: 14, padding: 16 }}>
                  <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: "0.88rem", color: "#fff", marginBottom: 12 }}>💡 Attribution Insights</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                    {result.insights.map((ins, i) => (
                      <div key={i} style={{ background: "rgba(255,255,255,.1)", borderRadius: 10, padding: "10px 14px", fontSize: "0.8rem", color: "#E0E7FF", lineHeight: 1.5 }}>
                        {ins.text}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface PredictionMeta { id?: number; created_at?: string; expires_at?: string; }

interface CompetitorMove {
  competitor: string; move: string; probability: number; timeframe: string; impact: "low" | "medium" | "high";
}
interface MonthlyBreakdown { month: string; [key: string]: number | string; }

interface CompetitorPrediction {
  confidence: number; summary: string; predictions: CompetitorMove[];
  evidence: string[]; recommended_action: string; watch_signals: string[]; _meta?: PredictionMeta; cached?: boolean;
}
interface CampaignPrediction {
  confidence: number; summary: string;
  best_case: { leads: number; customers: number; revenue: number; roas: number };
  expected_case: { leads: number; customers: number; revenue: number; roas: number };
  worst_case: { leads: number; customers: number; revenue: number; roas: number };
  evidence: string[]; recommended_action: string; key_risks: string[];
  monthly_breakdown: MonthlyBreakdown[]; _meta?: PredictionMeta; cached?: boolean;
}
interface ChurnPrediction {
  confidence: number; summary: string;
  predicted_churn_rate_30d: number; predicted_churn_rate_90d: number; revenue_at_risk: number;
  top_risk_drivers: string[];
  evidence: string[]; recommended_action: string; retention_levers: string[];
  monthly_breakdown: MonthlyBreakdown[]; _meta?: PredictionMeta; cached?: boolean;
}
interface RevenuePrediction {
  confidence: number; summary: string;
  best_case_90d: number; expected_case_90d: number; worst_case_90d: number;
  evidence: string[]; recommended_action: string; growth_levers: string[];
  scenario_data: MonthlyBreakdown[]; _meta?: PredictionMeta; cached?: boolean;
}

type PanelState<T> = { data: T | null; loading: boolean; error: string | null };

function confidenceColor(c: number) {
  if (c >= 70) return "#10B981";
  if (c >= 40) return "#F59E0B";
  return "#EF4444";
}

function ConfidenceBadge({ score }: { score: number }) {
  const color = confidenceColor(score);
  const label = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: ".7rem", fontWeight: 800, color, background: color + "18",
      borderRadius: 20, padding: "3px 10px",
    }}>
      ● {score}% {label} confidence
    </span>
  );
}

function LastUpdated({ meta }: { meta?: PredictionMeta }) {
  if (!meta?.created_at) return null;
  const d = new Date(meta.created_at);
  const label = d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <span style={{ fontSize: ".68rem", color: "var(--text-muted, #9CA3AF)", marginLeft: "auto" }}>
      Updated {label}
    </span>
  );
}

function EvidenceChips({ items, color = "#6B7280" }: { items: string[]; color?: string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {(items || []).slice(0, 5).map((item, i) => (
        <span key={i} style={{
          fontSize: ".72rem", color: "var(--text, #374151)",
          background: color + "14", border: `1px solid ${color}30`,
          borderRadius: 6, padding: "3px 8px", lineHeight: 1.4,
        }}>
          {item}
        </span>
      ))}
    </div>
  );
}

function RecommendedAction({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div style={{
      marginTop: 12, padding: "10px 13px",
      background: "linear-gradient(135deg,#0066FF08,#00C9C808)",
      border: "1px solid #0066FF22", borderRadius: 8,
      fontSize: ".8rem", color: "var(--text, #111827)", lineHeight: 1.6,
    }}>
      <strong style={{ color: "#0066FF" }}>▶ Action: </strong>{text}
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <p style={{ margin: "0 0 4px", fontSize: ".72rem", fontWeight: 700, color: "var(--text-muted,#6B7280)", textTransform: "uppercase", letterSpacing: ".05em" }}>
      {text}
    </p>
  );
}

function PanelShell({ icon, title, color, meta, children }: { icon: string; title: string; color: string; meta?: PredictionMeta; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--card-bg, #fff)",
      border: `1px solid var(--border, #E5E7EB)`,
      borderTop: `3px solid ${color}`,
      borderRadius: 12, padding: "18px 20px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: ".95rem", fontWeight: 800, color: "var(--text, #111827)", display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
          <span style={{ fontSize: "1.15rem" }}>{icon}</span> {title}
        </h2>
        <LastUpdated meta={meta} />
      </div>
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {[80, 60, 90, 50].map((w, i) => (
        <div key={i} style={{
          height: 14, borderRadius: 7, background: "var(--border, #E5E7EB)",
          width: `${w}%`, animation: "pulse 1.5s ease-in-out infinite",
        }} />
      ))}
    </div>
  );
}

function ErrorState({ msg }: { msg: string }) {
  return <p style={{ margin: 0, fontSize: ".8rem", color: "#EF4444" }}>⚠ {msg}</p>;
}

// ─── Revenue Scenario SVG Chart ────────────────────────────────────────────
function RevenueChart({ data }: { data: MonthlyBreakdown[] }) {
  if (!data?.length) return null;
  const best  = data.map(d => Number(d.best) || 0);
  const exp   = data.map(d => Number(d.expected) || 0);
  const worst = data.map(d => Number(d.worst) || 0);
  const allVals = [...best, ...exp, ...worst];
  const max = Math.max(...allVals, 1);
  const W = 280, H = 100, PAD = 12;
  const xs = data.map((_, i) => PAD + (i / Math.max(1, data.length - 1)) * (W - PAD * 2));
  const ys = (vals: number[]) => vals.map(v => H - PAD - (v / max) * (H - PAD * 2));
  function polyline(vals: number[], stroke: string, dash?: string) {
    const pts = xs.map((x, i) => `${x},${ys(vals)[i]}`).join(' ');
    return <polyline points={pts} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />;
  }
  const fmt = (v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
  return (
    <div style={{ marginTop: 4 }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {polyline(best, "#10B981")}
        {polyline(exp, "#3B82F6")}
        {polyline(worst, "#EF4444", "4 3")}
        {xs.map((x, i) => (
          <g key={i}>
            <circle cx={x} cy={ys(exp)[i]} r={3} fill="#3B82F6" />
            <text x={x} y={H - 1} textAnchor="middle" fontSize={9} fill="var(--text-muted,#9CA3AF)">{data[i].month as string}</text>
          </g>
        ))}
        <text x={xs[xs.length-1] + 4} y={ys(best)[best.length-1]} fontSize={9} fill="#10B981" textAnchor="start">{fmt(best[best.length-1])}</text>
        <text x={xs[xs.length-1] + 4} y={ys(exp)[exp.length-1]} fontSize={9} fill="#3B82F6" textAnchor="start">{fmt(exp[exp.length-1])}</text>
        <text x={xs[xs.length-1] + 4} y={ys(worst)[worst.length-1]} fontSize={9} fill="#EF4444" textAnchor="start">{fmt(worst[worst.length-1])}</text>
      </svg>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
        {[["#10B981","Best"], ["#3B82F6","Expected"], ["#EF4444","Worst"]].map(([c, l]) => (
          <span key={l} style={{ fontSize: ".7rem", display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted,#6B7280)" }}>
            <span style={{ width: 18, height: 2, background: c, display: "inline-block", borderRadius: 2 }} />{l}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Panel: Competitor Moves ───────────────────────────────────────────────
function CompetitorPanel({ state }: { state: PanelState<CompetitorPrediction> }) {
  const { data, loading, error } = state;
  const impactColor = (imp: string) => imp === "high" ? "#EF4444" : imp === "medium" ? "#F59E0B" : "#10B981";
  return (
    <PanelShell icon="🏆" title="Competitor Move Forecast" color="#EF4444" meta={data?._meta}>
      {loading ? <Skeleton /> : error ? <ErrorState msg={error} /> : !data ? null : (
        <>
          <ConfidenceBadge score={data.confidence} />
          <p style={{ margin: 0, fontSize: ".82rem", color: "var(--text, #374151)", lineHeight: 1.6 }}>{data.summary}</p>
          {(data.predictions || []).slice(0, 3).map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", background: "var(--bg, #F9FAFB)", borderRadius: 8 }}>
              <span style={{ fontSize: ".72rem", fontWeight: 800, color: impactColor(p.impact), background: impactColor(p.impact) + "18", borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap" }}>
                {p.probability}% · {p.timeframe}
              </span>
              <div>
                <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--text,#111827)" }}>{p.competitor}</div>
                <div style={{ fontSize: ".75rem", color: "var(--text-muted,#6B7280)", marginTop: 2 }}>{p.move}</div>
              </div>
            </div>
          ))}
          {(data.watch_signals || []).length > 0 && (
            <div>
              <SectionLabel text="Watch Signals" />
              <EvidenceChips items={data.watch_signals} color="#EF4444" />
            </div>
          )}
          <div>
            <SectionLabel text="Evidence" />
            <EvidenceChips items={data.evidence} color="#EF4444" />
          </div>
          <RecommendedAction text={data.recommended_action} />
        </>
      )}
    </PanelShell>
  );
}

// ─── Panel: Campaign Outcome ───────────────────────────────────────────────
function CampaignPanel({ state }: { state: PanelState<CampaignPrediction> }) {
  const { data, loading, error } = state;
  return (
    <PanelShell icon="🚀" title="Campaign Outcome Forecast" color="#3B82F6" meta={data?._meta}>
      {loading ? <Skeleton /> : error ? <ErrorState msg={error} /> : !data ? null : (
        <>
          <ConfidenceBadge score={data.confidence} />
          <p style={{ margin: 0, fontSize: ".82rem", color: "var(--text, #374151)", lineHeight: 1.6 }}>{data.summary}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {[
              { label: "Best", d: data.best_case, color: "#10B981" },
              { label: "Expected", d: data.expected_case, color: "#3B82F6" },
              { label: "Worst", d: data.worst_case, color: "#EF4444" },
            ].map(({ label, d, color }) => (
              <div key={label} style={{ textAlign: "center", padding: "10px 6px", background: color + "0F", borderRadius: 8, border: `1px solid ${color}30` }}>
                <div style={{ fontSize: ".68rem", fontWeight: 700, color, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "var(--text,#111827)" }}>
                  ${(d?.revenue || 0).toLocaleString()}
                </div>
                <div style={{ fontSize: ".68rem", color: "var(--text-muted,#6B7280)" }}>{d?.leads || 0} leads · {d?.roas || 0}x ROAS</div>
              </div>
            ))}
          </div>
          {data.monthly_breakdown?.length > 0 && <RevenueChart data={data.monthly_breakdown.map(m => ({ month: m.month, best: m.revenue_best as number, expected: m.revenue_expected as number, worst: m.revenue_worst as number }))} />}
          {(data.key_risks || []).length > 0 && (
            <div>
              <SectionLabel text="Key Risks" />
              <EvidenceChips items={data.key_risks} color="#F59E0B" />
            </div>
          )}
          <div>
            <SectionLabel text="Evidence" />
            <EvidenceChips items={data.evidence} color="#3B82F6" />
          </div>
          <RecommendedAction text={data.recommended_action} />
        </>
      )}
    </PanelShell>
  );
}

// ─── Panel: Churn Trajectory ───────────────────────────────────────────────
function ChurnPanel({ state }: { state: PanelState<ChurnPrediction> }) {
  const { data, loading, error } = state;
  return (
    <PanelShell icon="⚠️" title="Churn Trajectory" color="#F59E0B" meta={data?._meta}>
      {loading ? <Skeleton /> : error ? <ErrorState msg={error} /> : !data ? null : (
        <>
          <ConfidenceBadge score={data.confidence} />
          <p style={{ margin: 0, fontSize: ".82rem", color: "var(--text, #374151)", lineHeight: 1.6 }}>{data.summary}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { label: "30-day churn", value: `${data.predicted_churn_rate_30d ?? 0}%` },
              { label: "90-day churn", value: `${data.predicted_churn_rate_90d ?? 0}%` },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: "center", padding: "10px 8px", background: "#F59E0B0F", borderRadius: 8, border: "1px solid #F59E0B30" }}>
                <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#F59E0B" }}>{value}</div>
                <div style={{ fontSize: ".7rem", color: "var(--text-muted,#6B7280)" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Top 3 Risk Drivers — explicit as required */}
          {(data.top_risk_drivers || []).length > 0 && (
            <div>
              <SectionLabel text="Top 3 Risk Drivers" />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                {data.top_risk_drivers.slice(0, 3).map((driver, i) => (
                  <div key={i} style={{
                    display: "flex", gap: 10, alignItems: "flex-start",
                    padding: "7px 10px", borderRadius: 7,
                    background: "#EF444408", border: "1px solid #EF444420",
                  }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: 10, flexShrink: 0,
                      background: "#EF4444", color: "#fff",
                      fontSize: ".7rem", fontWeight: 800,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>{i + 1}</span>
                    <span style={{ fontSize: ".8rem", color: "var(--text,#374151)", lineHeight: 1.5 }}>{driver}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(data.retention_levers || []).length > 0 && (
            <div>
              <SectionLabel text="Retention Levers" />
              <EvidenceChips items={data.retention_levers} color="#F59E0B" />
            </div>
          )}
          <div>
            <SectionLabel text="Evidence" />
            <EvidenceChips items={data.evidence} color="#F59E0B" />
          </div>
          <RecommendedAction text={data.recommended_action} />
        </>
      )}
    </PanelShell>
  );
}

// ─── Panel: Revenue Scenarios ──────────────────────────────────────────────
function RevenuePanel({ state, onExportPdf }: { state: PanelState<RevenuePrediction>; onExportPdf: () => void }) {
  const { data, loading, error } = state;
  return (
    <PanelShell icon="💹" title="90-Day Revenue Scenarios" color="#10B981" meta={data?._meta}>
      {loading ? <Skeleton /> : error ? <ErrorState msg={error} /> : !data ? null : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <ConfidenceBadge score={data.confidence} />
            <button
              onClick={onExportPdf}
              style={{
                marginLeft: "auto", padding: "4px 12px", borderRadius: 6,
                border: "1px solid var(--border,#E5E7EB)", background: "var(--card-bg,#fff)",
                color: "var(--text,#374151)", fontSize: ".72rem", fontWeight: 700, cursor: "pointer",
              }}
            >
              ⬇ Export PDF
            </button>
          </div>
          <p style={{ margin: 0, fontSize: ".82rem", color: "var(--text, #374151)", lineHeight: 1.6 }}>{data.summary}</p>

          {/* 3-scenario summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {[
              { label: "Best", value: data.best_case_90d, color: "#10B981" },
              { label: "Expected", value: data.expected_case_90d, color: "#3B82F6" },
              { label: "Worst", value: data.worst_case_90d, color: "#EF4444" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: "center", padding: "10px 6px", background: color + "0F", borderRadius: 8, border: `1px solid ${color}30` }}>
                <div style={{ fontSize: ".68rem", fontWeight: 700, color, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "var(--text,#111827)" }}>
                  ${(value || 0).toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          {/* Monthly comparison table */}
          {(data.scenario_data || []).length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <SectionLabel text="Month-by-Month Comparison" />
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".78rem", marginTop: 6 }}>
                <thead>
                  <tr style={{ background: "var(--bg,#F9FAFB)" }}>
                    {["Month", "Best Case", "Expected", "Worst Case"].map(h => (
                      <th key={h} style={{ padding: "6px 10px", textAlign: h === "Month" ? "left" : "right", fontWeight: 700, color: "var(--text-muted,#6B7280)", borderBottom: "1px solid var(--border,#E5E7EB)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.scenario_data.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border,#E5E7EB)" }}>
                      <td style={{ padding: "6px 10px", color: "var(--text,#374151)", fontWeight: 600 }}>{row.month as string}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", color: "#10B981", fontWeight: 700 }}>${Number(row.best || 0).toLocaleString()}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", color: "#3B82F6", fontWeight: 700 }}>${Number(row.expected || 0).toLocaleString()}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", color: "#EF4444", fontWeight: 700 }}>${Number(row.worst || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.scenario_data?.length > 0 && <RevenueChart data={data.scenario_data} />}

          {(data.growth_levers || []).length > 0 && (
            <div>
              <SectionLabel text="Growth Levers" />
              <EvidenceChips items={data.growth_levers} color="#10B981" />
            </div>
          )}
          <div>
            <SectionLabel text="Evidence" />
            <EvidenceChips items={data.evidence} color="#10B981" />
          </div>
          <RecommendedAction text={data.recommended_action} />
        </>
      )}
    </PanelShell>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────
export default function PredictiveIntelligence() {
  const [competitor, setCompetitor] = useState<PanelState<CompetitorPrediction>>({ data: null, loading: false, error: null });
  const [campaign, setCampaign]     = useState<PanelState<CampaignPrediction>>({ data: null, loading: false, error: null });
  const [churn, setChurn]           = useState<PanelState<ChurnPrediction>>({ data: null, loading: false, error: null });
  const [revenue, setRevenue]       = useState<PanelState<RevenuePrediction>>({ data: null, loading: false, error: null });
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const loaded = useRef(false);

  const anyLoading = competitor.loading || campaign.loading || churn.loading || revenue.loading;

  async function fetchPanel<T>(
    url: string,
    setter: React.Dispatch<React.SetStateAction<PanelState<T>>>,
    force = false,
  ) {
    setter(s => ({ ...s, loading: true, error: null }));
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(force ? { force: true } : {}),
      });
      const j = await r.json();
      if (j.ok) setter({ data: j as T, loading: false, error: null });
      else setter(s => ({ ...s, loading: false, error: j.error || "Failed" }));
    } catch (e: unknown) {
      setter(s => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Network error" }));
    }
  }

  const loadAll = useCallback((force = false) => {
    fetchPanel<CompetitorPrediction>("/api/predictions/competitor-moves", setCompetitor, force);
    fetchPanel<CampaignPrediction>("/api/predictions/campaign-outcome", setCampaign, force);
    fetchPanel<ChurnPrediction>("/api/predictions/churn-trajectory", setChurn, force);
    fetchPanel<RevenuePrediction>("/api/predictions/revenue-scenario", setRevenue, force);
  }, []);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    loadAll(false);
  }, [loadAll]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadAll(true);
    setLastRefresh(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    setRefreshing(false);
  };

  const handleExportPdf = () => {
    window.print();
  };

  const allEmpty = !anyLoading && !competitor.data && !campaign.data && !churn.data && !revenue.data;

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
        @media print {
          nav, .no-print { display: none !important; }
          body { background: #fff; }
          [style*="border-top: 3px"] { break-inside: avoid; }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 16, flexWrap: "wrap" }} className="no-print">
        <div>
          <h1 style={{ margin: 0, fontSize: "1.45rem", fontWeight: 800, color: "var(--text, #111827)" }}>
            🔮 Predictive Intelligence
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: ".85rem", color: "var(--text-muted, #6B7280)" }}>
            AI-powered forecasts for competitor moves, campaign outcomes, churn trajectory, and 90-day revenue — cached for 6 hours.
            {lastRefresh && <span style={{ marginLeft: 8 }}>Last run: {lastRefresh}</span>}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || anyLoading}
          style={{
            padding: "10px 20px", borderRadius: 8, border: "none", cursor: refreshing || anyLoading ? "not-allowed" : "pointer",
            background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "#fff",
            fontSize: ".82rem", fontWeight: 700, whiteSpace: "nowrap",
            opacity: refreshing || anyLoading ? 0.65 : 1,
          }}
        >
          {refreshing || anyLoading ? "⏳ Running…" : "🔄 Refresh All Predictions"}
        </button>
      </div>

      {/* 2 × 2 grid */}
      {!allEmpty && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(460px,1fr))", gap: 20 }}>
          <CompetitorPanel state={competitor} />
          <CampaignPanel state={campaign} />
          <ChurnPanel state={churn} />
          <RevenuePanel state={revenue} onExportPdf={handleExportPdf} />
        </div>
      )}

      {/* Empty state */}
      {allEmpty && (
        <div style={{
          marginTop: 32, textAlign: "center", padding: "60px 24px",
          background: "var(--card-bg, #fff)", border: "1px solid var(--border, #E5E7EB)", borderRadius: 16,
        }}>
          <div style={{ fontSize: "3rem", marginBottom: 14 }}>🔮</div>
          <h3 style={{ margin: "0 0 8px", color: "var(--text,#111827)", fontSize: "1.1rem" }}>
            No predictions yet
          </h3>
          <p style={{ margin: "0 0 20px", color: "var(--text-muted,#6B7280)", fontSize: ".85rem" }}>
            Click <strong>Refresh All Predictions</strong> to generate your first AI forecast. Predictions update automatically every 6 hours once generated.
          </p>
          <button
            onClick={handleRefresh}
            style={{
              padding: "11px 24px", borderRadius: 8, border: "none", cursor: "pointer",
              background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "#fff",
              fontSize: ".85rem", fontWeight: 700,
            }}
          >
            Run First Prediction
          </button>
        </div>
      )}
    </div>
  );
}

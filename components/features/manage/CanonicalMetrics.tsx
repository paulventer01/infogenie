"use client";

/**
 * Canonical Metrics — single source of truth for spend, ROAS, CAC, pacing,
 * goals vs actuals, and provenance. Other panels should read from this engine.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Kpi {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  delta_pct?: number | null;
  kind?: "measured" | "modelled" | "projected" | string;
  confidence?: number | null;
}
interface GoalRow {
  source: string;
  label: string;
  target: number;
  actual: number | null;
  unit?: string;
  pct?: number | null;
  status?: string;
}
interface PaceAction {
  priority?: string;
  action: string;
  detail: string;
}
interface Pacing {
  pace_pct?: number | null;
  pace_status?: string;
  projected_month_end_cents?: number;
  target_cents?: number;
  spent_cents?: number;
  recommended_daily_cents?: number;
  days_remaining?: number;
  actions?: PaceAction[];
}
interface Snap {
  ok?: boolean;
  days?: number;
  spend?: number;
  blended_roas?: number | null;
  true_roas?: number | null;
  cac?: number | null;
  waste_cents?: number;
  spend_by_channel?: Record<string, number>;
  kpis?: Kpi[];
  goals_vs_actuals?: GoalRow[];
  pacing?: Pacing | null;
  daily?: { day: string; spend: number; revenue: number }[];
  provenance?: { source: string; field: string; note?: string | null }[];
  deltas?: Record<string, number | null>;
  definition_version?: string;
  error?: string;
}

function fmt(v: number | null | undefined, unit: string) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  if (unit === "$") return "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (unit === "x") return `${v}x`;
  if (unit === "%") return `${v}%`;
  return String(v);
}

function deltaColor(pct: number | null | undefined, key: string) {
  if (pct == null) return "#64748B";
  const invert = key === "cac" || key === "waste_cents" || key === "spend";
  const good = invert ? pct <= 0 : pct >= 0;
  return good ? "#16A34A" : "#DC2626";
}

export default function CanonicalMetrics({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await apiGet<Snap>(`/api/metrics/canonical?days=${days}`);
    if (!r || r.error) {
      setError(r?.error || "Failed to load canonical metrics");
      setLoading(false);
      return;
    }
    setSnap(r);
    setLoading(false);
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const maxDaily = Math.max(1, ...(snap?.daily || []).map((d) => d.spend));
  const pace = snap?.pacing;

  return (
    <div
      style={{
        minHeight: embedded ? "auto" : "100vh",
        background: embedded ? "transparent" : "linear-gradient(180deg,#ECFDF5 0%,#F8FAFC 45%)",
        padding: embedded ? "8px 24px 32px" : "28px 32px",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 20 }}>
          {!embedded ? (
            <div>
              <div style={{ fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#0F766E" }}>
                Single source of truth
              </div>
              <h1 style={{ margin: "6px 0 6px", fontSize: "1.6rem", color: "#0F172A" }}>Canonical Metrics</h1>
              <p style={{ margin: 0, color: "#64748B", maxWidth: 560 }}>
                Spend, CPA, CAC, LTV, blended &amp; true ROAS, waste, goals vs actuals, and pacing — one versioned dictionary every report and Ask answer must use. Figures are labelled measured / modelled / projected.
              </p>
            </div>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F766E" }}>
              Goals vs actuals · pacing · ROAS
              {snap?.definition_version ? ` · defs ${snap.definition_version}` : ""}
            </div>
          )}
          <select
            value={days}
            onChange={(e) => setDays(+e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #A7F3D0", fontWeight: 600 }}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>

        {loading && <div style={{ padding: 40, color: "#64748B" }}>Loading canonical snapshot…</div>}
        {error && <div style={{ padding: 20, color: "#B91C1C" }}>{error}</div>}

        {!loading && snap && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 18 }}>
              {(snap.kpis || []).map((k) => (
                <div key={k.key} style={{ background: "#fff", border: "1px solid #D1FAE5", borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                    <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>{k.label}</div>
                    {k.kind ? (
                      <span style={{
                        fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em",
                        color: k.kind === "measured" ? "#065F46" : k.kind === "projected" ? "#1D4ED8" : "#9A3412",
                        background: k.kind === "measured" ? "#ECFDF5" : k.kind === "projected" ? "#EFF6FF" : "#FFF7ED",
                        borderRadius: 999, padding: "1px 6px",
                      }}>{k.kind}</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: "1.35rem", fontWeight: 800, color: "#0F172A", marginTop: 4 }}>{fmt(k.value, k.unit)}</div>
                  {k.delta_pct != null && (
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color: deltaColor(k.delta_pct, k.key), marginTop: 2 }}>
                      {k.delta_pct >= 0 ? "+" : ""}{k.delta_pct}% vs prior
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => goToView(router, "contribution-record")}
                style={{
                  padding: "10px 14px", borderRadius: 10, border: "1px solid #FDBA74",
                  background: "#FFF7ED", color: "#9A3412", fontWeight: 800, fontSize: 13, cursor: "pointer",
                }}
              >
                Open contribution system of record →
              </button>
            </div>

            {pace && pace.pace_status && pace.pace_status !== "unknown" && (
              <div style={{
                background: "#fff", border: "1px solid #FCD34D", borderRadius: 12, padding: 16, marginBottom: 18,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#B45309", textTransform: "uppercase", letterSpacing: "0.06em" }}>Live pacing</div>
                    <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "#0F172A", marginTop: 4 }}>
                      {(pace.pace_status || "").replace(/_/g, " ")} · {pace.pace_pct ?? "—"}% of expected
                    </div>
                    <div style={{ color: "#64748B", fontSize: "0.88rem", marginTop: 4 }}>
                      Spent {fmt((pace.spent_cents || 0) / 100, "$")} of {fmt((pace.target_cents || 0) / 100, "$")} ·
                      projected month-end {fmt((pace.projected_month_end_cents || 0) / 100, "$")} ·
                      recommend {fmt((pace.recommended_daily_cents || 0) / 100, "$")}/day ·
                      {pace.days_remaining ?? 0} days left
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => goToView(router, "budget-board")}
                    style={{ alignSelf: "center", padding: "8px 14px", borderRadius: 8, border: "none", background: "#0F766E", color: "#fff", fontWeight: 700, cursor: "pointer" }}
                  >
                    Open Budget Board
                  </button>
                </div>
                {(pace.actions || []).length > 0 && (
                  <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: "#334155", fontSize: "0.88rem" }}>
                    {pace.actions!.slice(0, 4).map((a, i) => (
                      <li key={i}><strong>{a.action}</strong> — {a.detail}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14, marginBottom: 18 }}>
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: "1rem" }}>Daily spend / revenue</h3>
                {(snap.daily || []).length === 0 ? (
                  <div style={{ color: "#64748B" }}>No optimizer performance rows yet for this window.</div>
                ) : (
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120 }}>
                    {(snap.daily || []).slice(-40).map((d) => (
                      <div key={d.day} title={`${d.day}: $${d.spend} spend / $${d.revenue} rev`} style={{
                        flex: 1, background: "#0F766E", opacity: 0.75 + 0.25 * (d.spend / maxDaily),
                        height: `${Math.max(4, (d.spend / maxDaily) * 100)}%`, borderRadius: 2,
                      }} />
                    ))}
                  </div>
                )}
              </div>
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: "1rem" }}>Spend by channel</h3>
                {Object.keys(snap.spend_by_channel || {}).length === 0 ? (
                  <div style={{ color: "#64748B" }}>No channel spend yet.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {Object.entries(snap.spend_by_channel || {})
                      .sort((a, b) => b[1] - a[1])
                      .map(([ch, v]) => (
                        <div key={ch} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                          <span style={{ color: "#334155", fontWeight: 600 }}>{ch}</span>
                          <span style={{ color: "#0F172A", fontWeight: 800 }}>{fmt(v, "$")}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, marginBottom: 18 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: "1rem" }}>Goals vs actuals</h3>
              {(snap.goals_vs_actuals || []).length === 0 ? (
                <div style={{ color: "#64748B" }}>No OKRs or Marketing Goals yet — set them under Marketing OKRs / Marketing Goals.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#64748B" }}>
                      <th style={{ padding: "8px 6px" }}>Goal</th>
                      <th style={{ padding: "8px 6px" }}>Source</th>
                      <th style={{ padding: "8px 6px" }}>Target</th>
                      <th style={{ padding: "8px 6px" }}>Actual</th>
                      <th style={{ padding: "8px 6px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(snap.goals_vs_actuals || []).map((g, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "8px 6px", fontWeight: 600 }}>{g.label}</td>
                        <td style={{ padding: "8px 6px" }}>{g.source}</td>
                        <td style={{ padding: "8px 6px" }}>{g.target}{g.unit || ""}</td>
                        <td style={{ padding: "8px 6px" }}>{g.actual ?? "—"}{g.unit || ""}</td>
                        <td style={{ padding: "8px 6px", fontWeight: 700, color: g.status === "on-track" ? "#16A34A" : g.status === "at-risk" ? "#F59E0B" : "#DC2626" }}>
                          {g.status}{g.pct != null ? ` (${g.pct}%)` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <details style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 14 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, color: "#0F172A" }}>Provenance ({(snap.provenance || []).length} sources)</summary>
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "#475569", fontSize: "0.85rem" }}>
                {(snap.provenance || []).map((p, i) => (
                  <li key={i}><code>{p.source}</code> → {p.field}{p.note ? ` (${p.note})` : ""}</li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { apiPost } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────
interface DailyPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  leads: number;
}

interface PeriodData {
  label: string;
  start: string;
  end: string;
  totals: {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    leads: number;
    hs_contacts: number | null;
  };
  daily: DailyPoint[];
}

interface ComparisonResult {
  period_a: PeriodData;
  period_b: PeriodData;
  organic?: { etv: number; organic_count: number } | null;
}

// ── Date helpers ───────────────────────────────────────────────────────────
function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }

function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function presets() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return [
    { label: "Last 7 days vs prior 7",
      a: { start: fmtDate(addDays(today, -7)), end: fmtDate(addDays(today, -1)) },
      b: { start: fmtDate(addDays(today, -14)), end: fmtDate(addDays(today, -8)) } },
    { label: "Last 30 days vs prior 30",
      a: { start: fmtDate(addDays(today, -30)), end: fmtDate(addDays(today, -1)) },
      b: { start: fmtDate(addDays(today, -60)), end: fmtDate(addDays(today, -31)) } },
    { label: "This month vs last month",
      a: { start: fmtDate(new Date(today.getFullYear(), today.getMonth(), 1)), end: fmtDate(addDays(today, -1)) },
      b: { start: fmtDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
           end: fmtDate(new Date(today.getFullYear(), today.getMonth(), 0)) } },
    { label: "Last 90 days vs prior 90",
      a: { start: fmtDate(addDays(today, -90)), end: fmtDate(addDays(today, -1)) },
      b: { start: fmtDate(addDays(today, -180)), end: fmtDate(addDays(today, -91)) } },
  ];
}

// ── Delta badge ────────────────────────────────────────────────────────────
function Delta({ a, b, fmt }: { a: number; b: number; fmt?: (n: number) => string }) {
  if (b === 0 && a === 0) return <span style={{ color: "#9CA3AF", fontSize: ".78rem" }}>—</span>;
  const pct = b === 0 ? 100 : ((a - b) / Math.abs(b)) * 100;
  const up = pct >= 0;
  const color = up ? "#16A34A" : "#DC2626";
  const arrow = up ? "▲" : "▼";
  return (
    <span style={{ fontSize: ".78rem", fontWeight: 700, color, display: "inline-flex", alignItems: "center", gap: 2 }}>
      {arrow} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────
function KpiCard({
  label, icon, current, prior, fmt, highlight, onClick, active,
}: {
  label: string; icon: string;
  current: number; prior: number;
  fmt: (n: number) => string;
  highlight?: boolean; onClick?: () => void; active?: boolean;
}) {
  return (
    <div onClick={onClick}
      style={{ background: active ? "#EFF6FF" : "#fff",
        border: `1px solid ${active ? "#93C5FD" : "#E5E7EB"}`, borderRadius: 10,
        padding: "14px 18px", cursor: onClick ? "pointer" : "default",
        transition: "border-color .15s" }}>
      <div style={{ fontSize: ".72rem", color: "#6B7280", textTransform: "uppercase",
        letterSpacing: ".05em", marginBottom: 6 }}>{icon} {label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111827", marginBottom: 4 }}>
        {fmt(current)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ".8rem" }}>
        <Delta a={current} b={prior} />
        <span style={{ color: "#9CA3AF" }}>vs {fmt(prior)}</span>
      </div>
    </div>
  );
}

// ── Dual-line Chart ────────────────────────────────────────────────────────
function DualChart({ result, metric }: { result: ComparisonResult; metric: keyof DailyPoint }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef  = useRef<any>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    // Dynamically import Chart.js (already loaded on window in InfoGenie)
    const Chart = (window as any).Chart;
    if (!Chart) return;

    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const a = result.period_a.daily;
    const b = result.period_b.daily;
    const len = Math.max(a.length, b.length);
    const labels = Array.from({ length: len }, (_, i) => `Day ${i + 1}`);

    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: result.period_a.label,
            data: a.map(d => d[metric] ?? 0),
            borderColor: '#2563EB',
            backgroundColor: 'rgba(37,99,235,.08)',
            fill: true,
            tension: 0.35,
            pointRadius: len > 30 ? 0 : 3,
            borderWidth: 2,
          },
          {
            label: result.period_b.label,
            data: b.map(d => d[metric] ?? 0),
            borderColor: '#9CA3AF',
            backgroundColor: 'rgba(156,163,175,.05)',
            fill: false,
            tension: 0.35,
            pointRadius: len > 30 ? 0 : 3,
            borderWidth: 2,
            borderDash: [5, 3],
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 16 } },
          tooltip: { callbacks: {
            label: (ctx: any) => ` ${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString()}`,
          }},
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 10 } },
          y: { grid: { color: '#F3F4F6' }, ticks: { font: { size: 10 } }, beginAtZero: true },
        },
      },
    });

    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [result, metric]);

  return (
    <div style={{ height: 220, position: "relative" }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// ── Metric config ──────────────────────────────────────────────────────────
const METRICS: { key: keyof DailyPoint; label: string; icon: string; fmt: (n: number) => string }[] = [
  { key: "spend",       label: "Ad Spend",    icon: "💰", fmt: n => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
  { key: "impressions", label: "Impressions",  icon: "👁️",  fmt: n => n.toLocaleString() },
  { key: "clicks",      label: "Clicks",       icon: "🖱️",  fmt: n => n.toLocaleString() },
  { key: "leads",       label: "Leads",        icon: "🎯",  fmt: n => n.toLocaleString() },
  { key: "conversions", label: "Conversions",  icon: "✅",  fmt: n => n.toLocaleString() },
];

// ── Main component ─────────────────────────────────────────────────────────
export default function PeriodComparison() {
  const PRESETS = presets();
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [periodA, setPeriodA] = useState(PRESETS[0].a);
  const [periodB, setPeriodB] = useState(PRESETS[0].b);
  const [domain, setDomain]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<ComparisonResult | null>(null);
  const [activeMetric, setActiveMetric] = useState<keyof DailyPoint>("spend");
  const [tab, setTab] = useState<"overview" | "daily">("overview");

  const applyPreset = useCallback((i: number) => {
    setSelectedPreset(i);
    setPeriodA(PRESETS[i].a);
    setPeriodB(PRESETS[i].b);
  }, [PRESETS]);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiPost<ComparisonResult & { ok: boolean; error?: string }>("/api/period-comparison/fetch", {
        period_a: periodA, period_b: periodB, domain: domain.trim() || undefined,
      });
      if (!r.ok) { setError(r.error || "Failed"); return; }
      setResult(r as ComparisonResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [periodA, periodB, domain]);

  // Auto-fetch on mount
  useEffect(() => { fetch(); }, []); // eslint-disable-line

  const a = result?.period_a;
  const b = result?.period_b;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", padding: "20px 24px", maxWidth: 960, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 6px", color: "#111827" }}>
          📅 Period Comparison
        </h1>
        <p style={{ margin: 0, color: "#6B7280", fontSize: ".88rem" }}>
          Compare marketing performance across two time periods — ad spend, leads, impressions, and conversions.
        </p>
      </div>

      {/* Controls */}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
        padding: "16px 20px", marginBottom: 16 }}>

        {/* Preset buttons */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {PRESETS.map((p, i) => (
            <button key={i} onClick={() => applyPreset(i)}
              style={{ padding: "6px 14px", borderRadius: 8, border: "none", fontSize: ".8rem",
                fontWeight: 600, cursor: "pointer",
                background: selectedPreset === i ? "#2563EB" : "#F3F4F6",
                color: selectedPreset === i ? "#fff" : "#374151" }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Date rows */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: ".74rem", color: "#6B7280", marginBottom: 4, textTransform: "uppercase",
              letterSpacing: ".05em" }}>Current period</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="date" value={periodA.start}
                onChange={e => { setSelectedPreset(-1); setPeriodA(p => ({ ...p, start: e.target.value })); }}
                style={{ padding: "6px 10px", border: "1px solid #D1D5DB", borderRadius: 7, fontSize: ".85rem" }} />
              <span style={{ color: "#9CA3AF" }}>→</span>
              <input type="date" value={periodA.end}
                onChange={e => { setSelectedPreset(-1); setPeriodA(p => ({ ...p, end: e.target.value })); }}
                style={{ padding: "6px 10px", border: "1px solid #D1D5DB", borderRadius: 7, fontSize: ".85rem" }} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: ".74rem", color: "#6B7280", marginBottom: 4, textTransform: "uppercase",
              letterSpacing: ".05em" }}>Compare to</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="date" value={periodB.start}
                onChange={e => { setSelectedPreset(-1); setPeriodB(p => ({ ...p, start: e.target.value })); }}
                style={{ padding: "6px 10px", border: "1px solid #D1D5DB", borderRadius: 7, fontSize: ".85rem" }} />
              <span style={{ color: "#9CA3AF" }}>→</span>
              <input type="date" value={periodB.end}
                onChange={e => { setSelectedPreset(-1); setPeriodB(p => ({ ...p, end: e.target.value })); }}
                style={{ padding: "6px 10px", border: "1px solid #D1D5DB", borderRadius: 7, fontSize: ".85rem" }} />
            </div>
          </div>
        </div>

        {/* Domain + run */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="text" placeholder="Optional: your domain for organic estimates (e.g. acme.com)"
            value={domain} onChange={e => setDomain(e.target.value)}
            style={{ flex: 1, padding: "7px 12px", border: "1px solid #D1D5DB", borderRadius: 8,
              fontSize: ".85rem", outline: "none" }} />
          <button onClick={fetch} disabled={loading}
            style={{ padding: "8px 20px", background: loading ? "#E5E7EB" : "#2563EB",
              color: loading ? "#9CA3AF" : "#fff", border: "none", borderRadius: 8,
              fontWeight: 700, fontSize: ".85rem", cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "⏳ Loading…" : "⟳ Compare"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8,
          padding: "10px 16px", color: "#DC2626", fontSize: ".85rem", marginBottom: 14 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Results */}
      {result && a && b && (
        <>
          {/* Period labels */}
          <div style={{ display: "flex", gap: 16, marginBottom: 14, alignItems: "center", fontSize: ".82rem" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ display: "inline-block", width: 14, height: 3, background: "#2563EB", borderRadius: 2 }} />
              <span style={{ color: "#374151", fontWeight: 600 }}>{a.label}</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ display: "inline-block", width: 14, height: 3, background: "#9CA3AF", borderRadius: 2,
                border: "none", backgroundImage: "repeating-linear-gradient(90deg,#9CA3AF 0,#9CA3AF 4px,transparent 4px,transparent 7px)" }} />
              <span style={{ color: "#9CA3AF" }}>{b.label}</span>
            </span>
          </div>

          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
            {METRICS.map(m => (
              <KpiCard key={m.key}
                label={m.label} icon={m.icon}
                current={a.totals[m.key as keyof typeof a.totals] as number}
                prior={b.totals[m.key as keyof typeof b.totals] as number}
                fmt={m.fmt}
                active={activeMetric === m.key}
                onClick={() => setActiveMetric(m.key)}
              />
            ))}
          </div>

          {/* HubSpot contacts card */}
          {(a.totals.hs_contacts !== null || b.totals.hs_contacts !== null) && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ fontSize: ".72rem", color: "#6B7280", textTransform: "uppercase",
                  letterSpacing: ".05em", marginBottom: 6 }}>🟠 HubSpot new contacts</div>
                <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111827", marginBottom: 4 }}>
                  {(a.totals.hs_contacts ?? 0).toLocaleString()}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ".8rem" }}>
                  <Delta a={a.totals.hs_contacts ?? 0} b={b.totals.hs_contacts ?? 0} />
                  <span style={{ color: "#9CA3AF" }}>vs {(b.totals.hs_contacts ?? 0).toLocaleString()}</span>
                </div>
              </div>
              {result.organic && (
                <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 18px" }}>
                  <div style={{ fontSize: ".72rem", color: "#6B7280", textTransform: "uppercase",
                    letterSpacing: ".05em", marginBottom: 6 }}>🌿 Organic estimate (DataForSEO)</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111827", marginBottom: 4 }}>
                    {Math.round(result.organic.etv).toLocaleString()}<span style={{ fontSize: ".9rem", fontWeight: 400, color: "#6B7280" }}>/mo</span>
                  </div>
                  <div style={{ fontSize: ".8rem", color: "#9CA3AF" }}>
                    {result.organic.organic_count.toLocaleString()} organic keywords
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Chart */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
            padding: "16px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: ".88rem", color: "#111827", marginBottom: 4 }}>
              {METRICS.find(m => m.key === activeMetric)?.icon}{" "}
              {METRICS.find(m => m.key === activeMetric)?.label} — day by day
            </div>
            <div style={{ fontSize: ".76rem", color: "#9CA3AF", marginBottom: 12 }}>
              Click any metric card above to switch the chart
            </div>
            <DualChart result={result} metric={activeMetric} />
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {(["overview", "daily"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding: "7px 16px", borderRadius: 8, border: "none", fontWeight: 600,
                  fontSize: ".82rem", cursor: "pointer",
                  background: tab === t ? "#111827" : "#F3F4F6",
                  color: tab === t ? "#fff" : "#374151" }}>
                {t === "overview" ? "📊 Summary" : "📅 Day-by-day"}
              </button>
            ))}
          </div>

          {/* Summary table */}
          {tab === "overview" && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
                <thead>
                  <tr style={{ background: "#F9FAFB" }}>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600,
                      color: "#374151", fontSize: ".76rem", textTransform: "uppercase", letterSpacing: ".04em" }}>
                      Metric
                    </th>
                    <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700, color: "#2563EB" }}>
                      {a.label}
                    </th>
                    <th style={{ padding: "10px 16px", textAlign: "right", color: "#9CA3AF" }}>
                      {b.label}
                    </th>
                    <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: "#374151" }}>
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map((m, i) => {
                    const va = a.totals[m.key as keyof typeof a.totals] as number;
                    const vb = b.totals[m.key as keyof typeof b.totals] as number;
                    return (
                      <tr key={m.key} style={{ borderTop: "1px solid #F3F4F6",
                        background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                        <td style={{ padding: "10px 16px", color: "#374151" }}>{m.icon} {m.label}</td>
                        <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700, color: "#111827" }}>
                          {m.fmt(va)}
                        </td>
                        <td style={{ padding: "10px 16px", textAlign: "right", color: "#9CA3AF" }}>
                          {m.fmt(vb)}
                        </td>
                        <td style={{ padding: "10px 16px", textAlign: "right" }}>
                          <Delta a={va} b={vb} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Day-by-day table */}
          {tab === "daily" && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem", minWidth: 700 }}>
                <thead>
                  <tr style={{ background: "#F9FAFB" }}>
                    {["Date", "Period", "Spend", "Impressions", "Clicks", "Leads", "Conversions"].map(h => (
                      <th key={h} style={{ padding: "9px 12px", textAlign: h === "Date" || h === "Period" ? "left" : "right",
                        fontWeight: 600, color: "#374151", fontSize: ".74rem", textTransform: "uppercase",
                        letterSpacing: ".04em", borderBottom: "2px solid #E5E7EB" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...a.daily.map(d => ({ ...d, which: "A" })), ...b.daily.map(d => ({ ...d, which: "B" }))]
                    .sort((x, y) => x.date.localeCompare(y.date))
                    .map((d, i) => (
                      <tr key={`${d.which}-${d.date}`} style={{ borderBottom: "1px solid #F3F4F6",
                        background: d.which === "A" ? "#F8FAFF" : "#fff" }}>
                        <td style={{ padding: "7px 12px", color: "#374151", fontWeight: 500 }}>{d.date}</td>
                        <td style={{ padding: "7px 12px" }}>
                          <span style={{ fontSize: ".72rem", padding: "1px 7px", borderRadius: 99,
                            background: d.which === "A" ? "#DBEAFE" : "#F3F4F6",
                            color: d.which === "A" ? "#1D4ED8" : "#9CA3AF", fontWeight: 600 }}>
                            {d.which === "A" ? "Current" : "Prior"}
                          </span>
                        </td>
                        <td style={{ padding: "7px 12px", textAlign: "right" }}>${d.spend.toLocaleString()}</td>
                        <td style={{ padding: "7px 12px", textAlign: "right" }}>{d.impressions.toLocaleString()}</td>
                        <td style={{ padding: "7px 12px", textAlign: "right" }}>{d.clicks.toLocaleString()}</td>
                        <td style={{ padding: "7px 12px", textAlign: "right" }}>{d.leads.toLocaleString()}</td>
                        <td style={{ padding: "7px 12px", textAlign: "right" }}>{d.conversions.toLocaleString()}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
          padding: "40px 24px", textAlign: "center", color: "#9CA3AF" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>📅</div>
          <div style={{ fontWeight: 600, color: "#374151", marginBottom: 6 }}>Select a period and compare</div>
          <div style={{ fontSize: ".85rem" }}>
            Choose a preset above or set custom dates, then click Compare.
          </div>
        </div>
      )}
    </div>
  );
}

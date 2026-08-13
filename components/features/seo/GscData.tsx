"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { apiPost } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────
interface Overview {
  etv: number;
  keywords_count: number;
  pos_1: number;
  pos_2_3: number;
  pos_4_10: number;
  pos_11_20: number;
  pos_21_30: number;
  avg_position: number;
}
interface KwRow {
  keyword: string;
  position: number;
  volume: number;
  clicks: number;
  ctr: number;
  url: string;
  competition: string;
  trend: number[];
}
interface PageRow {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_pos: number;
  keywords: number;
}
interface HistPoint { date: string; etv: number; keywords: number; avg_pos: number; }
interface PosDist   { label: string; count: number; }
interface GscResult {
  domain: string;
  overview: Overview | null;
  keywords: KwRow[];
  pages: PageRow[];
  history: HistPoint[];
  positionDist: PosDist[];
}

// ── Helpers ────────────────────────────────────────────────────────────────
const LOCATIONS = [
  { code: 2840, label: "🇺🇸 United States" },
  { code: 2826, label: "🇬🇧 United Kingdom" },
  { code: 2124, label: "🇨🇦 Canada" },
  { code: 2036, label: "🇦🇺 Australia" },
  { code: 2276, label: "🇩🇪 Germany" },
  { code: 2250, label: "🇫🇷 France" },
  { code: 2356, label: "🇮🇳 India" },
];

function fmt(n: number, prefix = "") {
  if (n >= 1_000_000) return prefix + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return prefix + (n / 1_000).toFixed(1) + "K";
  return prefix + n.toLocaleString();
}

function Delta({ val, invert }: { val: number; invert?: boolean }) {
  if (val === 0) return <span style={{ color: "#9CA3AF", fontSize: ".76rem" }}>—</span>;
  const up = invert ? val < 0 : val > 0;
  return (
    <span style={{ color: up ? "#16A34A" : "#DC2626", fontSize: ".76rem", fontWeight: 700 }}>
      {up ? "▲" : "▼"} {Math.abs(val).toFixed(1)}%
    </span>
  );
}

// ── Mini sparkline ─────────────────────────────────────────────────────────
function Spark({ data, color = "#2563EB" }: { data: number[]; color?: string }) {
  if (!data.length) return null;
  const w = 56, h = 20;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * (h - 2) - 1;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────
function KpiCard({ label, icon, value, sub, active, onClick }: {
  label: string; icon: string; value: string; sub?: string;
  active?: boolean; onClick?: () => void;
}) {
  return (
    <div onClick={onClick}
      style={{ background: "#fff", border: `1.5px solid ${active ? "#2563EB" : "#E5E7EB"}`,
        borderRadius: 10, padding: "14px 18px", cursor: onClick ? "pointer" : "default",
        transition: "border-color .15s", minWidth: 0 }}>
      <div style={{ fontSize: ".72rem", color: "#6B7280", textTransform: "uppercase",
        letterSpacing: ".05em", marginBottom: 6 }}>{icon} {label}</div>
      <div style={{ fontSize: "1.55rem", fontWeight: 800, color: active ? "#2563EB" : "#111827",
        marginBottom: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: ".76rem", color: "#9CA3AF" }}>{sub}</div>}
    </div>
  );
}

// ── Trend chart ────────────────────────────────────────────────────────────
function TrendChart({ history, metric, label }: {
  history: HistPoint[]; metric: keyof HistPoint; label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ch  = useRef<any>(null);
  useEffect(() => {
    if (!ref.current || !history.length) return;
    const C = (window as any).Chart;
    if (!C) return;
    if (ch.current) { ch.current.destroy(); ch.current = null; }
    ch.current = new C(ref.current, {
      type: "line",
      data: {
        labels: history.map(h => h.date.slice(0, 7)),
        datasets: [{
          label,
          data: history.map(h => h[metric]),
          borderColor: "#2563EB",
          backgroundColor: "rgba(37,99,235,.08)",
          fill: true, tension: 0.35,
          pointRadius: history.length > 12 ? 0 : 3, borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: (c: any) => ` ${label}: ${Number(c.raw).toLocaleString()}`,
          }},
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 12 } },
          y: { grid: { color: "#F3F4F6" }, ticks: { font: { size: 10 } }, beginAtZero: true },
        },
      },
    });
    return () => { if (ch.current) { ch.current.destroy(); ch.current = null; } };
  }, [history, metric, label]);
  return <div style={{ height: 200, position: "relative" }}><canvas ref={ref} /></div>;
}

// ── Position distribution bar ─────────────────────────────────────────────
function PosBars({ dist }: { dist: PosDist[] }) {
  const total = dist.reduce((s, d) => s + d.count, 0) || 1;
  const colors = ["#2563EB", "#0f766e", "#D97706", "#9CA3AF"];
  return (
    <div style={{ display: "flex", gap: 6, height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
      {dist.map((d, i) => (
        <div key={d.label} title={`${d.label}: ${d.count}`}
          style={{ flex: d.count / total, background: colors[i], minWidth: d.count ? 4 : 0 }} />
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
type Tab = "keywords" | "pages";
type ChartMetric = "etv" | "keywords" | "avg_pos";

export default function GscData() {
  const [domain, setDomain]   = useState("");
  const [loc, setLoc]         = useState(2840);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<GscResult | null>(null);
  const [tab, setTab]         = useState<Tab>("keywords");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("etv");
  const [kwSort, setKwSort]   = useState<keyof KwRow>("clicks");
  const [pgSort, setPgSort]   = useState<keyof PageRow>("clicks");
  const [kwDir, setKwDir]     = useState<1 | -1>(-1);
  const [pgDir, setPgDir]     = useState<1 | -1>(-1);
  const [kwFilter, setKwFilter] = useState("");

  const run = useCallback(async () => {
    if (!domain.trim()) return;
    setLoading(true); setError(null);
    try {
      const r = await apiPost<GscResult & { ok: boolean; error?: string }>("/api/gsc-data/fetch", {
        domain: domain.trim(), location_code: loc,
      });
      if (!r.ok) { setError(r.error || "Failed to fetch"); return; }
      setResult(r as GscResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally { setLoading(false); }
  }, [domain, loc]);

  const kws = result?.keywords
    .filter(k => !kwFilter || k.keyword.toLowerCase().includes(kwFilter.toLowerCase()))
    .sort((a, b) => kwDir * (Number(a[kwSort]) - Number(b[kwSort]))) ?? [];

  const pgs = result?.pages
    .slice()
    .sort((a, b) => pgDir * (Number(a[pgSort]) - Number(b[pgSort]))) ?? [];

  const sortKw = (col: keyof KwRow) => {
    if (kwSort === col) setKwDir(d => d === -1 ? 1 : -1);
    else { setKwSort(col); setKwDir(-1); }
  };
  const sortPg = (col: keyof PageRow) => {
    if (pgSort === col) setPgDir(d => d === -1 ? 1 : -1);
    else { setPgSort(col); setPgDir(-1); }
  };

  const thStyle = (col: string, active: boolean): React.CSSProperties => ({
    padding: "9px 12px", textAlign: col === "keyword" || col === "url" ? "left" : "right",
    fontWeight: 600, color: active ? "#2563EB" : "#374151",
    fontSize: ".74rem", textTransform: "uppercase", letterSpacing: ".04em",
    borderBottom: "2px solid #E5E7EB", cursor: "pointer", whiteSpace: "nowrap",
    userSelect: "none",
  });

  const ov = result?.overview;
  const totalClicks      = result?.keywords.reduce((s, k) => s + k.clicks, 0) ?? 0;
  const totalImpressions = result?.keywords.reduce((s, k) => s + k.volume, 0) ?? 0;
  const overallCtr       = totalImpressions > 0 ? (totalClicks / totalImpressions * 100).toFixed(1) : "0.0";
  const avgPos           = ov?.avg_position ?? 0;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", padding: "20px 24px", maxWidth: 1100, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 5px", color: "#111827" }}>
          🔍 Search Console Data
        </h1>
        <p style={{ margin: 0, color: "#6B7280", fontSize: ".88rem" }}>
          Organic search performance powered by DataForSEO — clicks, impressions, CTR, avg position &amp; keyword rankings.
        </p>
      </div>

      {/* Search bar */}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
        padding: "14px 18px", marginBottom: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="text" placeholder="Enter domain — e.g. shopify.com"
          value={domain} onChange={e => setDomain(e.target.value)}
          onKeyDown={e => e.key === "Enter" && run()}
          style={{ flex: "1 1 280px", padding: "8px 12px", border: "1px solid #D1D5DB",
            borderRadius: 8, fontSize: ".9rem", outline: "none" }} />
        <select value={loc} onChange={e => setLoc(Number(e.target.value))}
          style={{ padding: "8px 10px", border: "1px solid #D1D5DB", borderRadius: 8,
            fontSize: ".85rem", background: "#fff", cursor: "pointer" }}>
          {LOCATIONS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button onClick={run} disabled={loading || !domain.trim()}
          style={{ padding: "9px 22px", background: loading ? "#E5E7EB" : "#2563EB",
            color: loading ? "#9CA3AF" : "#fff", border: "none", borderRadius: 8,
            fontWeight: 700, fontSize: ".88rem", cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "⏳ Fetching…" : "🔍 Analyse"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8,
          padding: "10px 16px", color: "#DC2626", fontSize: ".85rem", marginBottom: 14 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Results */}
      {result && ov && (
        <>
          {/* Domain badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8,
              padding: "5px 14px", fontSize: ".85rem", fontWeight: 700, color: "#1D4ED8" }}>
              {result.domain}
            </div>
            <span style={{ fontSize: ".8rem", color: "#9CA3AF" }}>
              {ov.keywords_count.toLocaleString()} organic keywords · DataForSEO estimate
            </span>
          </div>

          {/* KPI cards — click to switch chart */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
            <KpiCard label="Clicks (est.)" icon="🖱️"
              value={fmt(totalClicks)}
              sub={`ETV: ${fmt(ov.etv)}`}
              active={chartMetric === "etv"}
              onClick={() => setChartMetric("etv")} />
            <KpiCard label="Impressions (vol.)" icon="👁️"
              value={fmt(totalImpressions)}
              sub={`${ov.keywords_count.toLocaleString()} keywords`}
              active={chartMetric === "keywords"}
              onClick={() => setChartMetric("keywords")} />
            <KpiCard label="CTR (est.)" icon="📊"
              value={`${overallCtr}%`}
              sub="based on position CTR curve" />
            <KpiCard label="Avg Position" icon="📍"
              value={avgPos > 0 ? String(avgPos) : "—"}
              sub={`Top 3: ${(ov.pos_1 + ov.pos_2_3).toLocaleString()} · 4–10: ${ov.pos_4_10.toLocaleString()}`}
              active={chartMetric === "avg_pos"}
              onClick={() => setChartMetric("avg_pos")} />
          </div>

          {/* Position distribution */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
            padding: "12px 18px", marginBottom: 14 }}>
            <div style={{ fontSize: ".76rem", fontWeight: 600, color: "#374151",
              marginBottom: 8, textTransform: "uppercase", letterSpacing: ".04em" }}>
              Position distribution
            </div>
            <PosBars dist={result.positionDist} />
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {result.positionDist.map((d, i) => {
                const colors = ["#2563EB", "#0f766e", "#D97706", "#9CA3AF"];
                return (
                  <span key={d.label} style={{ fontSize: ".78rem", color: "#374151", display: "flex",
                    alignItems: "center", gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2,
                      background: colors[i], display: "inline-block" }} />
                    {d.label}: <strong>{d.count.toLocaleString()}</strong>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Trend chart */}
          {result.history.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
              padding: "14px 18px", marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: ".88rem", color: "#111827", marginBottom: 12 }}>
                {chartMetric === "etv" ? "🖱️ Estimated Traffic (monthly)" :
                 chartMetric === "keywords" ? "🔑 Keyword Count (monthly)" :
                 "📍 Avg Position (monthly)"}
                <span style={{ fontWeight: 400, color: "#9CA3AF", fontSize: ".78rem",
                  marginLeft: 8 }}>click a KPI card to switch metric</span>
              </div>
              <TrendChart
                history={result.history}
                metric={chartMetric}
                label={chartMetric === "etv" ? "Est. traffic" :
                       chartMetric === "keywords" ? "Keywords" : "Avg position"} />
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "2px solid #E5E7EB" }}>
            {(["keywords", "pages"] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding: "8px 18px", border: "none", fontWeight: 600,
                  fontSize: ".84rem", cursor: "pointer", background: "transparent",
                  color: tab === t ? "#2563EB" : "#6B7280",
                  borderBottom: `2px solid ${tab === t ? "#2563EB" : "transparent"}`,
                  marginBottom: -2 }}>
                {t === "keywords" ? `🔑 Keywords (${result.keywords.length})` :
                 `📄 Pages (${result.pages.length})`}
              </button>
            ))}
          </div>

          {/* Keywords tab */}
          {tab === "keywords" && (
            <>
              <div style={{ marginBottom: 10 }}>
                <input type="text" placeholder="🔍 Filter keywords…"
                  value={kwFilter} onChange={e => setKwFilter(e.target.value)}
                  style={{ padding: "7px 12px", border: "1px solid #D1D5DB", borderRadius: 8,
                    fontSize: ".85rem", width: 260, outline: "none" }} />
              </div>
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
                overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
                  <thead>
                    <tr style={{ background: "#F9FAFB" }}>
                      <th style={{ ...thStyle("keyword", false), textAlign: "left" }}>Keyword</th>
                      {(["position", "clicks", "volume", "ctr"] as (keyof KwRow)[]).map(col => (
                        <th key={col} onClick={() => sortKw(col)}
                          style={thStyle(col, kwSort === col)}>
                          {col === "position" ? "Pos" : col === "clicks" ? "Clicks" :
                           col === "volume" ? "Volume" : "CTR"}
                          {kwSort === col ? (kwDir === -1 ? " ↓" : " ↑") : ""}
                        </th>
                      ))}
                      <th style={{ ...thStyle("url", false), textAlign: "left", maxWidth: 200 }}>URL</th>
                      <th style={{ padding: "9px 12px", fontSize: ".74rem", color: "#374151",
                        fontWeight: 600, textTransform: "uppercase", borderBottom: "2px solid #E5E7EB" }}>
                        Trend
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {kws.slice(0, 50).map((k, i) => (
                      <tr key={k.keyword}
                        style={{ borderBottom: "1px solid #F3F4F6",
                          background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                        <td style={{ padding: "8px 12px", fontWeight: 500, color: "#111827" }}>
                          {k.keyword}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>
                          <span style={{
                            display: "inline-block", padding: "1px 7px", borderRadius: 99, fontSize: ".78rem",
                            fontWeight: 700,
                            background: k.position <= 3 ? "#DCFCE7" : k.position <= 10 ? "#DBEAFE" :
                              k.position <= 20 ? "#FEF9C3" : "#F3F4F6",
                            color: k.position <= 3 ? "#166534" : k.position <= 10 ? "#1D4ED8" :
                              k.position <= 20 ? "#92400E" : "#9CA3AF",
                          }}>#{k.position}</span>
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>{fmt(k.clicks)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>{fmt(k.volume)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>{k.ctr}%</td>
                        <td style={{ padding: "8px 12px", maxWidth: 200, overflow: "hidden",
                          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {k.url && (
                            <a href={`https://${result.domain}${k.url.startsWith("/") ? "" : "/"}${k.url}`}
                              target="_blank" rel="noopener noreferrer"
                              style={{ color: "#2563EB", textDecoration: "none", fontSize: ".78rem" }}
                              title={k.url}>
                              {k.url.length > 36 ? "…" + k.url.slice(-34) : k.url || "(root)"}
                            </a>
                          )}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <Spark data={k.trend} color={k.position <= 10 ? "#2563EB" : "#9CA3AF"} />
                        </td>
                      </tr>
                    ))}
                    {kws.length === 0 && (
                      <tr><td colSpan={7} style={{ padding: "24px", textAlign: "center", color: "#9CA3AF" }}>
                        No keywords match your filter.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Pages tab */}
          {tab === "pages" && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
                <thead>
                  <tr style={{ background: "#F9FAFB" }}>
                    <th style={{ ...thStyle("url", false), textAlign: "left" }}>Page</th>
                    {(["clicks", "impressions", "ctr", "avg_pos", "keywords"] as (keyof PageRow)[]).map(col => (
                      <th key={col} onClick={() => sortPg(col)}
                        style={thStyle(col, pgSort === col)}>
                        {col === "avg_pos" ? "Avg Pos" : col === "keywords" ? "KWs" :
                         col === "impressions" ? "Impr." : col.charAt(0).toUpperCase() + col.slice(1)}
                        {pgSort === col ? (pgDir === -1 ? " ↓" : " ↑") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pgs.map((p, i) => (
                    <tr key={p.url} style={{ borderBottom: "1px solid #F3F4F6",
                      background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                      <td style={{ padding: "8px 12px", maxWidth: 300, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <a href={`https://${result.domain}${p.url.startsWith("/") ? "" : "/"}${p.url === "(not set)" ? "" : p.url}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ color: "#2563EB", textDecoration: "none", fontSize: ".82rem" }}
                          title={p.url}>
                          {p.url === "(not set)" ? "(not set)" :
                           p.url.length > 50 ? "…" + p.url.slice(-48) : p.url}
                        </a>
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>
                        {fmt(p.clicks)}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>
                        {fmt(p.impressions)}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>
                        {p.ctr}%
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>
                        <span style={{
                          display: "inline-block", padding: "1px 7px", borderRadius: 99, fontSize: ".78rem",
                          fontWeight: 700,
                          background: p.avg_pos <= 3 ? "#DCFCE7" : p.avg_pos <= 10 ? "#DBEAFE" : "#F3F4F6",
                          color: p.avg_pos <= 3 ? "#166534" : p.avg_pos <= 10 ? "#1D4ED8" : "#9CA3AF",
                        }}>
                          {p.avg_pos > 0 ? `#${p.avg_pos}` : "—"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#6B7280" }}>
                        {p.keywords}
                      </td>
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
          padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: 12 }}>🔍</div>
          <div style={{ fontWeight: 700, fontSize: "1rem", color: "#374151", marginBottom: 8 }}>
            Enter a domain to see organic search data
          </div>
          <div style={{ fontSize: ".85rem", color: "#9CA3AF", maxWidth: 380, margin: "0 auto" }}>
            Powered by DataForSEO — enter any domain (e.g. <code>shopify.com</code>) to see ranked keywords,
            estimated clicks, impressions, CTR, avg position and top pages.
          </div>
        </div>
      )}
    </div>
  );
}

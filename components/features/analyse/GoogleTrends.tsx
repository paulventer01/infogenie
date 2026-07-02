"use client";

// Google Trends explorer — interest over time, related queries, rising topics,
// trending searches today, and side-by-side keyword comparison. No API key
// needed; backed by the unofficial google-trends-api npm package.

import { useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";

interface TimelinePoint { formattedTime: string; value: number[]; }
interface RelatedQuery  { query: string; value: number; }
interface TrendingItem  { title: { query: string; exploreLink?: string }; formattedTraffic?: string; articles?: { title: string; url: string }[] }

interface InterestResp  { ok: boolean; keywords?: string[]; timeline?: TimelinePoint[]; cached?: boolean; error?: string; }
interface RelatedResp   { ok: boolean; keyword?: string; relatedQueries?: { top: RelatedQuery[]; rising: RelatedQuery[] }; relatedTopics?: { top: unknown[]; rising: unknown[] }; cached?: boolean; error?: string; }
interface TrendingResp  { ok: boolean; geo?: string; trends?: TrendingItem[]; cached?: boolean; error?: string; }
interface CompareResp   { ok: boolean; keywords?: string[]; timeline?: TimelinePoint[]; cached?: boolean; error?: string; }

const PERIODS = [
  { k: "1d", label: "24h" }, { k: "7d", label: "7d" },
  { k: "1m", label: "1m" }, { k: "3m", label: "3m" },
  { k: "12m", label: "12m" }, { k: "5y", label: "5y" },
];

const GEO_OPTIONS = [
  { k: "", label: "Worldwide" }, { k: "US", label: "United States" },
  { k: "GB", label: "United Kingdom" }, { k: "CA", label: "Canada" },
  { k: "AU", label: "Australia" }, { k: "IN", label: "India" },
  { k: "DE", label: "Germany" }, { k: "FR", label: "France" },
];

const COLORS = ["#0ea5e9","#8b5cf6","#10b981","#f59e0b","#ef4444"];

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const W = 120, H = 36, pad = 3;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1 || 1)) * (W - 2 * pad);
    const y = H - pad - (v / max) * (H - 2 * pad);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

function InterestChart({ timeline, keywords }: { timeline: TimelinePoint[]; keywords: string[] }) {
  if (!timeline.length) return (
    <div style={{ padding: 32, textAlign: "center", color: "#94a3b8", fontSize: "0.86rem" }}>No data points returned.</div>
  );
  const maxVal = Math.max(...timeline.flatMap(t => t.value), 1);
  const W = 100, H = 80;
  return (
    <div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
        {keywords.map((kw, i) => (
          <span key={kw} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.82rem" }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: COLORS[i % COLORS.length], display: "inline-block" }} />
            {kw}
          </span>
        ))}
      </div>
      {/* Minimalist SVG chart */}
      <div style={{ overflowX: "auto" }}>
        <svg width={Math.max(600, timeline.length * 8)} height={120} style={{ display: "block" }}>
          {keywords.map((_, ki) => {
            const pts = timeline.map((t, i) => {
              const x = 30 + (i / (timeline.length - 1 || 1)) * (Math.max(600, timeline.length * 8) - 50);
              const y = 10 + (1 - (t.value[ki] || 0) / maxVal) * 90;
              return `${x},${y}`;
            }).join(" ");
            return (
              <polyline key={ki} points={pts} fill="none"
                stroke={COLORS[ki % COLORS.length]} strokeWidth={2} strokeLinejoin="round" opacity={0.9} />
            );
          })}
          {/* X-axis labels — first, middle, last */}
          {[0, Math.floor((timeline.length - 1) / 2), timeline.length - 1].map(idx => {
            const t = timeline[idx];
            if (!t) return null;
            const x = 30 + (idx / (timeline.length - 1 || 1)) * (Math.max(600, timeline.length * 8) - 50);
            return (
              <text key={idx} x={x} y={115} textAnchor="middle"
                style={{ fontSize: "0.6rem", fill: "#94a3b8" }}>{t.formattedTime}</text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export default function GoogleTrends() {
  const [tab, setTab] = useState<"interest" | "related" | "trending" | "compare">("interest");

  // Interest over time
  const [keyword, setKeyword]   = useState("");
  const [period, setPeriod]     = useState("12m");
  const [geo, setGeo]           = useState("");
  const [interest, setInterest] = useState<InterestResp | null>(null);

  // Related queries
  const [relKw, setRelKw]       = useState("");
  const [related, setRelated]   = useState<RelatedResp | null>(null);

  // Trending
  const [trendGeo, setTrendGeo] = useState("US");
  const [trending, setTrending] = useState<TrendingResp | null>(null);

  // Compare
  const [compareKws, setCompareKws] = useState("");
  const [compareGeo, setCompareGeo] = useState("");
  const [comparePeriod, setComparePeriod] = useState("12m");
  const [compareData, setCompareData]     = useState<CompareResp | null>(null);

  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function fetchInterest() {
    if (!keyword.trim()) return;
    setLoading(true); setError("");
    const r = await apiGet<InterestResp>(`/api/google-trends/interest?keyword=${encodeURIComponent(keyword)}&period=${period}&geo=${geo}`);
    if (!r.ok) setError(r.error || "Failed to fetch");
    else setInterest(r);
    setLoading(false);
  }

  async function fetchRelated() {
    if (!relKw.trim()) return;
    setLoading(true); setError("");
    const r = await apiGet<RelatedResp>(`/api/google-trends/related?keyword=${encodeURIComponent(relKw)}&geo=${geo}`);
    if (!r.ok) setError(r.error || "Failed to fetch");
    else setRelated(r);
    setLoading(false);
  }

  async function fetchTrending() {
    setLoading(true); setError("");
    const r = await apiGet<TrendingResp>(`/api/google-trends/trending?geo=${trendGeo}`);
    if (!r.ok) setError(r.error || "Failed to fetch");
    else setTrending(r);
    setLoading(false);
  }

  async function fetchCompare() {
    if (!compareKws.trim()) return;
    setLoading(true); setError("");
    const r = await apiGet<CompareResp>(`/api/google-trends/compare?keywords=${encodeURIComponent(compareKws)}&geo=${compareGeo}&period=${comparePeriod}`);
    if (!r.ok) setError(r.error || "Failed to fetch");
    else setCompareData(r);
    setLoading(false);
  }

  // Auto-fetch trending on mount and when tab switches
  useEffect(() => {
    if (tab === "trending") fetchTrending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, trendGeo]);

  function handleKeywordChange(v: string) {
    setKeyword(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">SEO</span>{" "}
                <span className="bc-sep">›</span> Google Trends
              </div>
              <h2 className="view-title">📈 Google Trends</h2>
              <p className="view-sub">
                Free real-time keyword trend signals — interest over time, rising
                queries, related topics, and daily trending searches. No API key
                required.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 20, paddingBottom: 56 }}>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #e2e8f0" }}>
          {([
            { k: "interest",  label: "📊 Interest over time" },
            { k: "related",   label: "🔗 Related queries" },
            { k: "trending",  label: "🔥 Trending now" },
            { k: "compare",   label: "⚖️ Compare keywords" },
          ] as const).map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              padding: "8px 16px", border: 0, background: "none", cursor: "pointer",
              fontWeight: tab === t.k ? 700 : 500,
              color: tab === t.k ? "#0ea5e9" : "#64748b",
              borderBottom: tab === t.k ? "2px solid #0ea5e9" : "2px solid transparent",
              marginBottom: -2, fontSize: "0.88rem", whiteSpace: "nowrap",
            }}>{t.label}</button>
          ))}
        </div>

        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", color: "#b91c1c", fontSize: "0.86rem", marginBottom: 14 }}>
            {error}
          </div>
        )}

        {/* ── Interest over time ─────────────────────────── */}
        {tab === "interest" && (
          <div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 240px" }}>
                <label style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Keyword</label>
                <input className="form-control" value={keyword} onChange={e => handleKeywordChange(e.target.value)}
                  placeholder="e.g. AI marketing" onKeyDown={e => e.key === "Enter" && fetchInterest()} />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Period</label>
                <div style={{ display: "flex", gap: 4 }}>
                  {PERIODS.map(p => (
                    <button key={p.k} onClick={() => setPeriod(p.k)} style={{
                      padding: "6px 10px", borderRadius: 6, border: "1.5px solid",
                      borderColor: period === p.k ? "#0ea5e9" : "#e2e8f0",
                      background: period === p.k ? "#f0f9ff" : "#fff",
                      color: period === p.k ? "#0369a1" : "#64748b",
                      fontWeight: period === p.k ? 700 : 500, fontSize: "0.78rem", cursor: "pointer",
                    }}>{p.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Region</label>
                <select className="form-control" value={geo} onChange={e => setGeo(e.target.value)}>
                  {GEO_OPTIONS.map(g => <option key={g.k} value={g.k}>{g.label}</option>)}
                </select>
              </div>
              <button className="btn btn-primary" onClick={fetchInterest} disabled={loading || !keyword.trim()}>
                {loading ? "Loading…" : "Search"}
              </button>
            </div>

            {interest && !error && (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ fontWeight: 700, marginBottom: 14 }}>
                  Interest over time: <span style={{ color: "#0ea5e9" }}>{interest.keywords?.join(", ")}</span>
                  {interest.cached && <span style={{ fontSize: "0.73rem", color: "#94a3b8", marginLeft: 8 }}>(cached)</span>}
                </div>
                <InterestChart timeline={interest.timeline || []} keywords={interest.keywords || []} />
              </div>
            )}

            {!interest && !loading && (
              <div style={{ padding: "32px 0", textAlign: "center", color: "#94a3b8", fontSize: "0.88rem" }}>
                Enter a keyword above and click Search to see its Google Trends data.
              </div>
            )}
          </div>
        )}

        {/* ── Related queries ────────────────────────────── */}
        {tab === "related" && (
          <div>
            <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 240px" }}>
                <label style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Keyword</label>
                <input className="form-control" value={relKw} onChange={e => setRelKw(e.target.value)}
                  placeholder="e.g. content marketing" onKeyDown={e => e.key === "Enter" && fetchRelated()} />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Region</label>
                <select className="form-control" value={geo} onChange={e => setGeo(e.target.value)}>
                  {GEO_OPTIONS.map(g => <option key={g.k} value={g.k}>{g.label}</option>)}
                </select>
              </div>
              <button className="btn btn-primary" onClick={fetchRelated} disabled={loading || !relKw.trim()}>
                {loading ? "Loading…" : "Search"}
              </button>
            </div>

            {related && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {/* Top queries */}
                <div style={{ flex: "1 1 260px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 18px" }}>
                  <div style={{ fontWeight: 700, marginBottom: 12, fontSize: "0.9rem" }}>🔝 Top related queries</div>
                  {(related.relatedQueries?.top || []).slice(0, 10).map((q, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.85rem" }}>
                      <span>{q.query}</span>
                      <span style={{ color: "#94a3b8" }}>{q.value}</span>
                    </div>
                  ))}
                  {!(related.relatedQueries?.top?.length) && <div style={{ color: "#94a3b8", fontSize: "0.83rem" }}>No data</div>}
                </div>
                {/* Rising queries */}
                <div style={{ flex: "1 1 260px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 18px" }}>
                  <div style={{ fontWeight: 700, marginBottom: 12, fontSize: "0.9rem" }}>🚀 Rising queries</div>
                  {(related.relatedQueries?.rising || []).slice(0, 10).map((q, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.85rem" }}>
                      <span>{q.query}</span>
                      <span style={{ background: "#dcfce7", color: "#15803d", borderRadius: 8, padding: "1px 7px", fontSize: "0.73rem", fontWeight: 700 }}>
                        {q.value === 5000 ? "Breakout" : "+" + q.value + "%"}
                      </span>
                    </div>
                  ))}
                  {!(related.relatedQueries?.rising?.length) && <div style={{ color: "#94a3b8", fontSize: "0.83rem" }}>No data</div>}
                </div>
              </div>
            )}

            {!related && !loading && (
              <div style={{ padding: "32px 0", textAlign: "center", color: "#94a3b8", fontSize: "0.88rem" }}>
                Enter a keyword to discover related and rising searches.
              </div>
            )}
          </div>
        )}

        {/* ── Trending now ───────────────────────────────── */}
        {tab === "trending" && (
          <div>
            <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Country</label>
                <select className="form-control" value={trendGeo} onChange={e => setTrendGeo(e.target.value)}>
                  {GEO_OPTIONS.filter(g => g.k).map(g => <option key={g.k} value={g.k}>{g.label}</option>)}
                </select>
              </div>
              <button className="btn btn-outline" onClick={fetchTrending} disabled={loading}>
                {loading ? "Loading…" : "🔄 Refresh"}
              </button>
            </div>

            {loading && <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Fetching trends…</div>}

            {trending && !loading && (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
                {(trending.trends || []).slice(0, 20).map((t, i) => (
                  <div key={i} style={{ padding: "12px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={{ fontWeight: 800, color: "#94a3b8", width: 24, flexShrink: 0, fontSize: "0.8rem" }}>{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.93rem", marginBottom: 2 }}>{t.title?.query}</div>
                      {t.formattedTraffic && (
                        <span style={{ background: "#fef9c3", color: "#78350f", borderRadius: 8, padding: "1px 7px", fontSize: "0.74rem", fontWeight: 700 }}>
                          🔍 {t.formattedTraffic} searches
                        </span>
                      )}
                      {t.articles?.slice(0, 1).map((a, ai) => (
                        <div key={ai} style={{ marginTop: 4 }}>
                          <a href={a.url} target="_blank" rel="noreferrer"
                            style={{ fontSize: "0.78rem", color: "#0ea5e9", textDecoration: "none" }}>
                            {a.title}
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!trending.trends?.length && (
                  <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>No trending data available for this region.</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Compare keywords ───────────────────────────── */}
        {tab === "compare" && (
          <div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 300px" }}>
                <label style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>
                  Keywords (comma-separated, 2–5)
                </label>
                <input className="form-control" value={compareKws} onChange={e => setCompareKws(e.target.value)}
                  placeholder="e.g. ChatGPT, Claude, Gemini" onKeyDown={e => e.key === "Enter" && fetchCompare()} />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Period</label>
                <div style={{ display: "flex", gap: 4 }}>
                  {PERIODS.map(p => (
                    <button key={p.k} onClick={() => setComparePeriod(p.k)} style={{
                      padding: "6px 10px", borderRadius: 6, border: "1.5px solid",
                      borderColor: comparePeriod === p.k ? "#0ea5e9" : "#e2e8f0",
                      background: comparePeriod === p.k ? "#f0f9ff" : "#fff",
                      color: comparePeriod === p.k ? "#0369a1" : "#64748b",
                      fontWeight: comparePeriod === p.k ? 700 : 500, fontSize: "0.78rem", cursor: "pointer",
                    }}>{p.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Region</label>
                <select className="form-control" value={compareGeo} onChange={e => setCompareGeo(e.target.value)}>
                  {GEO_OPTIONS.map(g => <option key={g.k} value={g.k}>{g.label}</option>)}
                </select>
              </div>
              <button className="btn btn-primary" onClick={fetchCompare} disabled={loading || !compareKws.trim()}>
                {loading ? "Loading…" : "Compare"}
              </button>
            </div>

            {compareData && !error && (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ fontWeight: 700, marginBottom: 14 }}>
                  Comparing: {compareData.keywords?.map((kw, i) => (
                    <span key={kw} style={{ color: COLORS[i % COLORS.length], marginRight: 10 }}>{kw}</span>
                  ))}
                  {compareData.cached && <span style={{ fontSize: "0.73rem", color: "#94a3b8", marginLeft: 6 }}>(cached)</span>}
                </div>
                <InterestChart timeline={compareData.timeline || []} keywords={compareData.keywords || []} />
                {/* Summary: avg interest per keyword */}
                {(compareData.keywords || []).length > 0 && (
                  <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                    {(compareData.keywords || []).map((kw, ki) => {
                      const vals = (compareData.timeline || []).map(t => t.value[ki] || 0);
                      const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
                      const max = vals.length ? Math.max(...vals) : 0;
                      return (
                        <div key={kw} style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 14px", minWidth: 120 }}>
                          <div style={{ color: COLORS[ki % COLORS.length], fontWeight: 700, fontSize: "0.85rem", marginBottom: 4 }}>{kw}</div>
                          <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Avg: <strong>{avg}</strong></div>
                          <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Peak: <strong>{max}</strong></div>
                          <MiniSparkline data={vals.slice(-24)} color={COLORS[ki % COLORS.length]} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!compareData && !loading && (
              <div style={{ padding: "32px 0", textAlign: "center", color: "#94a3b8", fontSize: "0.88rem" }}>
                Enter 2–5 comma-separated keywords to compare their search interest.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SERSite {
  id: number;
  title: string;
  name: string;
  is_active: number;
  keyword_count: number;
  check_freq: string;
  guest_link: string;
}

interface SEREngine {
  site_engine_id: number;
  search_engine_id: number;
  name?: string;
  country_name?: string;
  language_name?: string;
  device?: string;
}

interface SERKeyword {
  id: number;
  keyword: string;
  group_id?: number;
  tags?: string[];
}

interface SERPosition {
  keyword_id: number;
  keyword?: string;
  position: number | null;
  prev_position: number | null;
  url: string | null;
  volume?: number;
  cpc?: number;
  competition?: number;
}

interface SERSummary {
  [key: string]: unknown;
  keywords_in_top_3?: number;
  keywords_in_top_10?: number;
  keywords_in_top_20?: number;
  keywords_in_top_50?: number;
  avg_position?: number;
  visibility?: number;
}

interface HistoryPoint {
  date: string;
  value: number;
  search_engine_id?: number;
}

interface Settings {
  site_id: number;
  site_title: string;
  site_url: string;
  engine_id: number | null;
  engine_label: string | null;
}

type Tab = "overview" | "keywords" | "history" | "competitors";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FREQ_LABEL: Record<string, string> = {
  check_daily:   "Daily",
  check_weekly:  "Weekly",
  check_monthly: "Monthly",
};

function delta(pos: number | null, prev: number | null) {
  if (pos === null || prev === null || prev === 0) return null;
  return prev - pos; // positive = improvement (moved up)
}

function DeltaBadge({ d }: { d: number | null }) {
  if (d === null) return <span style={{ color: "#9CA3AF", fontSize: ".75rem" }}>—</span>;
  if (d === 0) return <span style={{ color: "#9CA3AF", fontSize: ".75rem" }}>→</span>;
  const up = d > 0;
  return (
    <span style={{ color: up ? "#16A34A" : "#DC2626", fontSize: ".78rem", fontWeight: 600 }}>
      {up ? "▲" : "▼"}{Math.abs(d)}
    </span>
  );
}

function PosBadge({ pos }: { pos: number | null }) {
  if (pos === null || pos === 0) {
    return <span style={{ color: "#9CA3AF", fontSize: ".82rem" }}>—</span>;
  }
  const bg = pos <= 3 ? "#FEF9C3" : pos <= 10 ? "#F0FDF4" : pos <= 20 ? "#EFF6FF" : "#F9FAFB";
  const color = pos <= 3 ? "#92400E" : pos <= 10 ? "#15803D" : pos <= 20 ? "#1D4ED8" : "#6B7280";
  return (
    <span style={{ background: bg, color, fontSize: ".82rem", fontWeight: 700,
      borderRadius: 6, padding: "2px 8px" }}>
      #{pos}
    </span>
  );
}

// ── Mini sparkline (pure CSS/SVG) ─────────────────────────────────────────────

function Sparkline({ points, invert = true }: { points: number[]; invert?: boolean }) {
  if (!points.length) return null;
  const w = 120, h = 36;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const coords = points.map((v, i) => {
    const x = (i / Math.max(1, points.length - 1)) * w;
    const raw = (v - min) / range;
    const y = invert ? (1 - raw) * h : raw * h; // invert = lower pos = higher on chart
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={coords} fill="none" stroke="#2563EB" strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SeRanking() {
  const [status, setStatus]         = useState<{ configured: boolean; user?: { email: string } } | null>(null);
  const [sites, setSites]           = useState<SERSite[]>([]);
  const [selectedSite, setSelected] = useState<SERSite | null>(null);
  const [engines, setEngines]       = useState<SEREngine[]>([]);
  const [selectedEngine, setEngine] = useState<SEREngine | null>(null);
  const [keywords, setKeywords]     = useState<SERKeyword[]>([]);
  const [positions, setPositions]   = useState<SERPosition[]>([]);
  const [summary, setSummary]       = useState<SERSummary | null>(null);
  const [history, setHistory]       = useState<HistoryPoint[]>([]);
  const [competitors, setCompetitors] = useState<{ url: string; name: string }[]>([]);
  const [settings, setSettings]     = useState<Settings | null>(null);
  const [tab, setTab]               = useState<Tab>("overview");
  const [loading, setLoading]       = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [recheckMsg, setRecheckMsg] = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const savedEngineId               = useRef<number | null>(null);

  // ── Load status + sites ──────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const [st, sitesRes] = await Promise.all([
          apiGet<{ configured: boolean; user?: { email: string } }>("/api/seranking/status"),
          apiGet<{ ok: boolean; sites: SERSite[] }>("/api/seranking/sites").catch(() => ({ ok: false, sites: [] as SERSite[] })),
        ]);
        setStatus(st);
        if (sitesRes.ok && sitesRes.sites?.length) {
          setSites(sitesRes.sites);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── When sites load, pick first (or saved) site ──────────────────────────

  useEffect(() => {
    if (!sites.length) return;
    // Load saved settings to determine preferred site
    apiGet<{ ok: boolean; settings: Settings | null }>(`/api/seranking/sites/${sites[0].id}/settings`)
      .then(r => {
        setSettings(r.settings);
        const preferred = r.settings?.site_id
          ? sites.find(s => s.id === r.settings!.site_id) || sites[0]
          : sites[0];
        setSelected(preferred);
        savedEngineId.current = r.settings?.engine_id || null;
      })
      .catch(() => setSelected(sites[0]));
  }, [sites]);

  // ── When site selected, load engines ─────────────────────────────────────

  useEffect(() => {
    if (!selectedSite) return;
    (async () => {
      try {
        const r = await apiGet<{ ok: boolean; engines: SEREngine[] }>(
          `/api/seranking/sites/${selectedSite.id}/search-engines`
        );
        const engs = r.engines || [];
        setEngines(engs);
        // Restore saved engine or pick first
        const saved = savedEngineId.current
          ? engs.find(e => e.site_engine_id === savedEngineId.current)
          : null;
        setEngine(saved || engs[0] || null);
      } catch {}
    })();
  }, [selectedSite]);

  // ── When engine selected, load all data ──────────────────────────────────

  const loadData = useCallback(async () => {
    if (!selectedSite) return;
    setDataLoading(true);
    const siteId = selectedSite.id;
    const engineParam = selectedEngine ? `?site_engine_id=${selectedEngine.site_engine_id}` : "";
    const engineParamAmp = selectedEngine ? `&site_engine_id=${selectedEngine.site_engine_id}` : "";

    try {
      const [kw, pos, sum, hist, comp] = await Promise.all([
        apiGet<{ ok: boolean; keywords: SERKeyword[] }>(`/api/seranking/sites/${siteId}/keywords${engineParam}`).catch(() => ({ ok: false, keywords: [] as SERKeyword[] })),
        apiGet<{ ok: boolean; positions: SERPosition[] }>(`/api/seranking/sites/${siteId}/positions${engineParam ? "?" + engineParam.slice(1) : ""}`).catch(() => ({ ok: false, positions: [] as SERPosition[] })),
        apiGet<{ ok: boolean; summary: SERSummary }>(`/api/seranking/sites/${siteId}/summary${engineParam}`).catch(() => ({ ok: false, summary: null as SERSummary | null })),
        apiGet<{ ok: boolean; history: HistoryPoint[] }>(`/api/seranking/sites/${siteId}/history?type=avg_pos${engineParamAmp}`).catch(() => ({ ok: false, history: [] as HistoryPoint[] })),
        apiGet<{ ok: boolean; competitors: { url: string; name: string }[] }>(`/api/seranking/sites/${siteId}/competitors`).catch(() => ({ ok: false, competitors: [] as {url:string;name:string}[] })),
      ]);
      setKeywords(kw.keywords || []);
      setPositions(pos.positions || []);
      setSummary(sum.summary || null);
      setHistory(hist.history || []);
      setCompetitors(comp.competitors || []);
    } catch (e) {
      console.warn("[seranking] data load error:", e);
    } finally {
      setDataLoading(false);
    }
  }, [selectedSite, selectedEngine]);

  useEffect(() => { if (selectedEngine !== undefined) loadData(); }, [loadData, selectedEngine]);

  // ── Merge keyword names into positions ───────────────────────────────────

  const enrichedPositions = positions.map(p => ({
    ...p,
    keyword: p.keyword || keywords.find(k => k.id === p.keyword_id)?.keyword || String(p.keyword_id),
  }));

  const filtered = enrichedPositions.filter(p =>
    !search || (p.keyword || "").toLowerCase().includes(search.toLowerCase())
  );

  // ── Save settings ────────────────────────────────────────────────────────

  const saveSettings = useCallback(async (site: SERSite, engine: SEREngine | null) => {
    if (!site) return;
    try {
      await apiPut(`/api/seranking/sites/${site.id}/settings`, {
        site_title: site.title,
        site_url: site.name,
        engine_id: engine?.site_engine_id || null,
        engine_label: engine ? [engine.country_name, engine.device].filter(Boolean).join(" · ") : null,
      });
    } catch {}
  }, []);

  const handleSiteChange = (siteId: number) => {
    const s = sites.find(x => x.id === siteId);
    if (s) { setSelected(s); setEngine(null); saveSettings(s, null); }
  };

  const handleEngineChange = (eid: number) => {
    const e = engines.find(x => x.site_engine_id === eid);
    if (e && selectedSite) { setEngine(e); saveSettings(selectedSite, e); }
  };

  const handleRecheck = async () => {
    if (!selectedSite) return;
    setRechecking(true);
    try {
      const r = await apiPost<{ message: string }>(`/api/seranking/sites/${selectedSite.id}/recheck`, {});
      setRecheckMsg(r.message || "Re-check triggered.");
      setTimeout(() => setRecheckMsg(null), 4000);
    } catch (e) {
      setRecheckMsg("Re-check failed — check your SE Ranking plan limits.");
    } finally {
      setRechecking(false);
    }
  };

  // ── Computed stats ────────────────────────────────────────────────────────

  const top3   = summary?.keywords_in_top_3  ?? enrichedPositions.filter(p => p.position && p.position <= 3).length;
  const top10  = summary?.keywords_in_top_10 ?? enrichedPositions.filter(p => p.position && p.position <= 10).length;
  const top20  = summary?.keywords_in_top_20 ?? enrichedPositions.filter(p => p.position && p.position <= 20).length;
  const avgPos = summary?.avg_position
    ?? (enrichedPositions.filter(p => p.position && p.position > 0).reduce((s, p) => s + (p.position || 0), 0)
        / Math.max(1, enrichedPositions.filter(p => p.position && p.position > 0).length));
  const histValues = history.map(h => h.value || (h as unknown as Record<string, number>).avg_pos || 0).filter(Boolean);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ padding: 60, textAlign: "center", color: "#9CA3AF" }}>
      <div style={{ fontSize: "2rem", marginBottom: 8 }}>⏳</div>Connecting to SE Ranking…
    </div>
  );

  if (error) return (
    <div style={{ padding: 40, textAlign: "center", color: "#6B7280" }}>
      <div style={{ fontSize: "2rem", marginBottom: 8 }}>⚠️</div>
      <div style={{ fontWeight: 600 }}>Could not load SE Ranking data</div>
      <div style={{ fontSize: ".85rem", marginTop: 4 }}>{error}</div>
    </div>
  );

  if (!status?.configured) return (
    <div style={{ padding: 40, maxWidth: 600, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 8px" }}>📊 SE Ranking</h1>
      <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10,
        padding: "16px 20px", fontSize: ".9rem", color: "#92400E" }}>
        <strong>SE Ranking is not configured.</strong> Add your <code>SERANKING_API_KEY</code> in the Secrets panel to connect your account.
      </div>
    </div>
  );

  const noKeywords = keywords.length === 0 && !dataLoading;

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto", fontFamily: "inherit" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#111827", margin: 0 }}>
            📊 SE Ranking
          </h1>
          <div style={{ fontSize: ".85rem", color: "#6B7280", marginTop: 2 }}>
            Connected as <strong>{status?.user?.email}</strong>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Site selector */}
          {sites.length > 0 && (
            <select value={selectedSite?.id || ""} onChange={e => handleSiteChange(Number(e.target.value))}
              style={{ padding: "7px 12px", border: "1px solid #E5E7EB", borderRadius: 8,
                fontSize: ".85rem", background: "#fff", cursor: "pointer", minWidth: 180 }}>
              {sites.map(s => (
                <option key={s.id} value={s.id}>{s.title || s.name}</option>
              ))}
            </select>
          )}
          {/* Search engine selector */}
          {engines.length > 0 && (
            <select value={selectedEngine?.site_engine_id || ""} onChange={e => handleEngineChange(Number(e.target.value))}
              style={{ padding: "7px 12px", border: "1px solid #E5E7EB", borderRadius: 8,
                fontSize: ".85rem", background: "#fff", cursor: "pointer", minWidth: 160 }}>
              {engines.map(e => (
                <option key={e.site_engine_id} value={e.site_engine_id}>
                  {[e.country_name, e.language_name, e.device].filter(Boolean).join(" · ") || `Engine #${e.site_engine_id}`}
                </option>
              ))}
            </select>
          )}
          <button onClick={loadData} disabled={dataLoading}
            style={{ padding: "7px 14px", background: "#EFF6FF", color: "#2563EB",
              border: "1px solid #BFDBFE", borderRadius: 8, fontSize: ".85rem",
              cursor: dataLoading ? "not-allowed" : "pointer", fontWeight: 600, opacity: dataLoading ? .6 : 1 }}>
            {dataLoading ? "⏳ Loading…" : "↻ Refresh"}
          </button>
          <button onClick={handleRecheck} disabled={rechecking || noKeywords}
            style={{ padding: "7px 14px", background: rechecking ? "#F3F4F6" : "#2563EB",
              color: rechecking ? "#9CA3AF" : "#fff", border: "none", borderRadius: 8,
              fontSize: ".85rem", cursor: rechecking || noKeywords ? "not-allowed" : "pointer",
              fontWeight: 600, opacity: noKeywords ? .5 : 1 }}
            title={noKeywords ? "Add keywords in SE Ranking first" : "Trigger a manual rank check"}>
            {rechecking ? "Checking…" : "🔄 Re-check now"}
          </button>
        </div>
      </div>

      {/* Recheck toast */}
      {recheckMsg && (
        <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8,
          padding: "10px 16px", marginBottom: 16, color: "#15803D", fontSize: ".88rem" }}>
          ✅ {recheckMsg}
        </div>
      )}

      {/* Site status bar */}
      {selectedSite && (
        <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8,
          padding: "10px 14px", marginBottom: 16, display: "flex", gap: 20, flexWrap: "wrap",
          fontSize: ".82rem", color: "#6B7280", alignItems: "center" }}>
          <span>🌐 <strong style={{ color: "#111827" }}>{selectedSite.name}</strong></span>
          <span>📋 {selectedSite.keyword_count} keyword{selectedSite.keyword_count !== 1 ? "s" : ""} tracked</span>
          <span>🔁 {FREQ_LABEL[selectedSite.check_freq] || selectedSite.check_freq}</span>
          <span style={{ color: selectedSite.is_active ? "#16A34A" : "#9CA3AF" }}>
            {selectedSite.is_active ? "✅ Active" : "⏸ Paused"}
          </span>
          {selectedSite.guest_link && (
            <a href={selectedSite.guest_link} target="_blank" rel="noreferrer"
              style={{ color: "#2563EB", textDecoration: "none", marginLeft: "auto" }}>
              Open in SE Ranking ↗
            </a>
          )}
        </div>
      )}

      {/* ── No keywords empty state ─────────────────────────────────── */}
      {noKeywords && (
        <div style={{ background: "#F9FAFB", border: "1px dashed #D1D5DB", borderRadius: 12,
          padding: "40px 32px", textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: "3rem", marginBottom: 12 }}>🔍</div>
          <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#374151", marginBottom: 8 }}>
            No keywords tracked yet
          </div>
          <div style={{ color: "#6B7280", fontSize: ".9rem", maxWidth: 460, margin: "0 auto 20px" }}>
            Add keywords to your SE Ranking project and their ranking positions will appear here automatically.
          </div>
          <a href={`https://online.seranking.com/`} target="_blank" rel="noreferrer"
            style={{ display: "inline-block", padding: "10px 24px", background: "#2563EB",
              color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 600, fontSize: ".9rem" }}>
            Add keywords in SE Ranking →
          </a>
        </div>
      )}

      {/* Stats row */}
      {!noKeywords && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Avg position",    value: avgPos ? avgPos.toFixed(1) : "—",  icon: "📍" },
            { label: "Top 3",           value: top3 ?? "—",                       icon: "🥇" },
            { label: "Top 10",          value: top10 ?? "—",                      icon: "🏆" },
            { label: "Top 20",          value: top20 ?? "—",                      icon: "📈" },
            { label: "Total keywords",  value: keywords.length || selectedSite?.keyword_count || "—", icon: "🔑" },
          ].map(c => (
            <div key={c.label} style={{ background: "#fff", border: "1px solid #E5E7EB",
              borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: "1.2rem", marginBottom: 4 }}>{c.icon}</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827" }}>{c.value}</div>
              <div style={{ fontSize: ".76rem", color: "#6B7280", marginTop: 2 }}>{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "2px solid #E5E7EB" }}>
        {(["overview", "keywords", "history", "competitors"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "8px 18px", background: "none", border: "none", cursor: "pointer",
              fontWeight: tab === t ? 700 : 400, color: tab === t ? "#2563EB" : "#6B7280",
              borderBottom: tab === t ? "2px solid #2563EB" : "2px solid transparent",
              marginBottom: -2, fontSize: ".88rem", textTransform: "capitalize" }}>
            {t === "overview" ? "📊 Overview" : t === "keywords" ? "🔑 Keywords" : t === "history" ? "📈 History" : "🏁 Competitors"}
          </button>
        ))}
      </div>

      {/* ── Overview tab ──────────────────────────────────────────────── */}
      {tab === "overview" && !noKeywords && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Avg position sparkline */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ fontWeight: 700, fontSize: ".9rem", color: "#111827", marginBottom: 8 }}>
              Average position (30 days)
            </div>
            {histValues.length > 1 ? (
              <Sparkline points={histValues} invert />
            ) : (
              <div style={{ color: "#9CA3AF", fontSize: ".85rem" }}>
                {dataLoading ? "Loading…" : "Not enough data yet. Check back after your next ranking check."}
              </div>
            )}
            {histValues.length > 0 && (
              <div style={{ marginTop: 8, fontSize: ".82rem", color: "#6B7280" }}>
                Latest: <strong style={{ color: "#111827" }}>
                  #{histValues[histValues.length - 1]?.toFixed(1)}
                </strong>
                {histValues.length > 1 && (
                  <span style={{ marginLeft: 8 }}>
                    <DeltaBadge d={Math.round(histValues[0] - histValues[histValues.length - 1])} />
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Distribution */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ fontWeight: 700, fontSize: ".9rem", color: "#111827", marginBottom: 12 }}>
              Position distribution
            </div>
            {[
              { label: "Top 3",    count: top3,  color: "#FBBF24", max: keywords.length || 1 },
              { label: "4–10",     count: (top10 ?? 0) - (top3 ?? 0), color: "#34D399", max: keywords.length || 1 },
              { label: "11–20",    count: (top20 ?? 0) - (top10 ?? 0), color: "#60A5FA", max: keywords.length || 1 },
              { label: "21–100+",  count: (keywords.length || 0) - (top20 ?? 0), color: "#D1D5DB", max: keywords.length || 1 },
            ].map(r => (
              <div key={r.label} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".78rem",
                  color: "#6B7280", marginBottom: 2 }}>
                  <span>{r.label}</span><span>{r.count}</span>
                </div>
                <div style={{ height: 8, background: "#F3F4F6", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: r.color, borderRadius: 4,
                    width: `${Math.round(((r.count || 0) / r.max) * 100)}%`, transition: "width .5s" }} />
                </div>
              </div>
            ))}
          </div>

          {/* Top movers */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "16px 18px",
            gridColumn: "1 / -1" }}>
            <div style={{ fontWeight: 700, fontSize: ".9rem", color: "#111827", marginBottom: 10 }}>
              Top movers
            </div>
            {enrichedPositions.length === 0 ? (
              <div style={{ color: "#9CA3AF", fontSize: ".85rem" }}>No position data yet.</div>
            ) : (
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: ".78rem", color: "#6B7280", marginBottom: 6 }}>📈 Biggest gainers</div>
                  {enrichedPositions
                    .map(p => ({ ...p, d: delta(p.position, p.prev_position) }))
                    .filter(p => (p.d || 0) > 0)
                    .sort((a, b) => (b.d || 0) - (a.d || 0))
                    .slice(0, 5)
                    .map(p => (
                      <div key={p.keyword_id} style={{ display: "flex", justifyContent: "space-between",
                        padding: "5px 0", borderBottom: "1px solid #F3F4F6", fontSize: ".82rem" }}>
                        <span style={{ color: "#374151", overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap", maxWidth: 160 }}>{p.keyword}</span>
                        <span style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                          <PosBadge pos={p.position || null} />
                          <DeltaBadge d={p.d} />
                        </span>
                      </div>
                    ))}
                  {enrichedPositions.filter(p => delta(p.position, p.prev_position) || 0 > 0).length === 0 && (
                    <div style={{ color: "#9CA3AF", fontSize: ".82rem" }}>No gainers yet</div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: ".78rem", color: "#6B7280", marginBottom: 6 }}>📉 Biggest drops</div>
                  {enrichedPositions
                    .map(p => ({ ...p, d: delta(p.position, p.prev_position) }))
                    .filter(p => (p.d || 0) < 0)
                    .sort((a, b) => (a.d || 0) - (b.d || 0))
                    .slice(0, 5)
                    .map(p => (
                      <div key={p.keyword_id} style={{ display: "flex", justifyContent: "space-between",
                        padding: "5px 0", borderBottom: "1px solid #F3F4F6", fontSize: ".82rem" }}>
                        <span style={{ color: "#374151", overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap", maxWidth: 160 }}>{p.keyword}</span>
                        <span style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                          <PosBadge pos={p.position || null} />
                          <DeltaBadge d={p.d} />
                        </span>
                      </div>
                    ))}
                  {enrichedPositions.filter(p => (delta(p.position, p.prev_position) || 0) < 0).length === 0 && (
                    <div style={{ color: "#9CA3AF", fontSize: ".82rem" }}>No drops yet</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Keywords tab ──────────────────────────────────────────────── */}
      {tab === "keywords" && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <input type="text" placeholder="Filter keywords…" value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, padding: "8px 12px", border: "1px solid #E5E7EB", borderRadius: 8,
                fontSize: ".88rem", outline: "none" }} />
            <span style={{ fontSize: ".82rem", color: "#9CA3AF", alignSelf: "center" }}>
              {filtered.length} / {enrichedPositions.length}
            </span>
          </div>
          {noKeywords ? (
            <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>No keywords tracked yet.</div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
                <thead>
                  <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
                    {["Keyword", "Position", "Change", "Landing URL"].map(h => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600,
                        color: "#374151", fontSize: ".78rem", textTransform: "uppercase", letterSpacing: ".04em" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((p, i) => (
                    <tr key={p.keyword_id} style={{ borderBottom: "1px solid #F3F4F6",
                      background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                      <td style={{ padding: "9px 14px", color: "#111827" }}>{p.keyword}</td>
                      <td style={{ padding: "9px 14px" }}><PosBadge pos={p.position || null} /></td>
                      <td style={{ padding: "9px 14px" }}><DeltaBadge d={delta(p.position || null, p.prev_position || null)} /></td>
                      <td style={{ padding: "9px 14px", maxWidth: 260 }}>
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noreferrer"
                            style={{ color: "#2563EB", fontSize: ".78rem", textDecoration: "none",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                            {p.url.replace(/^https?:\/\//, "")}
                          </a>
                        ) : <span style={{ color: "#9CA3AF" }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div style={{ padding: "24px", textAlign: "center", color: "#9CA3AF" }}>No keywords match your filter.</div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── History tab ───────────────────────────────────────────────── */}
      {tab === "history" && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "20px 24px" }}>
          <div style={{ fontWeight: 700, fontSize: ".95rem", color: "#111827", marginBottom: 16 }}>
            Average position — last 30 days
          </div>
          {histValues.length < 2 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>
              {dataLoading ? "Loading…" : "No history data yet. Ranking data appears after the first scheduled check."}
            </div>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem", minWidth: 400 }}>
                  <thead>
                    <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
                      <th style={{ padding: "8px 12px", textAlign: "left", color: "#374151", fontWeight: 600 }}>Date</th>
                      <th style={{ padding: "8px 12px", textAlign: "right", color: "#374151", fontWeight: 600 }}>Avg Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice(-30).reverse().map((h, i) => {
                      const val = h.value || (h as unknown as Record<string, number>).avg_pos || 0;
                      const prev = history[history.length - i - 2];
                      const prevVal = prev ? (prev.value || (prev as unknown as Record<string, number>).avg_pos || 0) : 0;
                      return (
                        <tr key={h.date} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "7px 12px", color: "#374151" }}>{h.date}</td>
                          <td style={{ padding: "7px 12px", textAlign: "right" }}>
                            <span style={{ fontWeight: 600, color: "#111827" }}>#{val.toFixed(1)}</span>
                            <span style={{ marginLeft: 8 }}>
                              <DeltaBadge d={prevVal ? Math.round(prevVal - val) : null} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Competitors tab ───────────────────────────────────────────── */}
      {tab === "competitors" && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "20px 24px" }}>
          <div style={{ fontWeight: 700, fontSize: ".95rem", color: "#111827", marginBottom: 16 }}>
            Tracked competitors
          </div>
          {competitors.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>🏁</div>
              No competitors added yet.
              <div style={{ fontSize: ".85rem", marginTop: 6 }}>
                Add competitor URLs in SE Ranking → your project settings.
              </div>
              <a href="https://online.seranking.com/" target="_blank" rel="noreferrer"
                style={{ display: "inline-block", marginTop: 12, padding: "8px 20px",
                  background: "#2563EB", color: "#fff", borderRadius: 8, textDecoration: "none",
                  fontSize: ".88rem", fontWeight: 600 }}>
                Open SE Ranking →
              </a>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {competitors.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                  background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB" }}>
                  <img src={`https://www.google.com/s2/favicons?domain=${c.url}&sz=20`} alt=""
                    style={{ width: 20, height: 20, borderRadius: 3 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: ".88rem", color: "#111827" }}>{c.name || c.url}</div>
                    {c.name && c.url !== c.name && (
                      <div style={{ fontSize: ".76rem", color: "#9CA3AF" }}>{c.url}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

// Rank Tracker — competitive Position Tracking suite.
// Extends the original domain+keyword tracker with competitors, keyword SoV,
// rankings distribution, pages, cannibalization, and SERP-feature views.

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiDelete, apiPatch } from "@/lib/api";

interface Keyword {
  id: number;
  keyword: string;
  target_domain: string;
  country: string;
  device?: string;
  language?: string;
  competitors?: string[];
  last_position: number | null;
  last_url?: string | null;
  last_run_at: string | null;
  last_features?: Record<string, unknown>;
  last_competitor_positions?: Record<string, { position?: number | null; url?: string }>;
}
interface KeywordsResult { ok: boolean; keywords?: Keyword[] }
interface ScanResult {
  ok: boolean; error?: string; note?: string;
  target?: { position?: number | null };
  features?: Record<string, boolean>;
}
interface ScanAllResult { ok: boolean; error?: string; scanned?: number; total?: number }
interface HistoryRun {
  ran_at: string;
  target_position: number | null;
  target_url?: string;
  total_results?: string | number;
  serp_features?: Record<string, unknown>;
  competitor_positions?: Record<string, { position?: number | null }>;
}
interface HistoryResult { ok: boolean; runs?: HistoryRun[] }
interface AddResult { ok: boolean; error?: string }
interface OpenAiResult { ok?: boolean; choices?: { message?: { content?: string } }[] }
interface LandscapeResult {
  ok: boolean;
  summary?: {
    keywords: number;
    visibility_pct: number;
    estimated_traffic: number;
    average_position: number | null;
    distribution: Record<string, number>;
    targets?: number;
  };
  targets?: { key: string; country: string; language: string; device: string; label: string; keywords: number }[];
  share_of_voice?: {
    domain: string; share_pct: number; points: number; visibility?: number;
    visibility_delta?: number; keywords?: number; is_target?: boolean;
  }[];
  competition_map?: {
    domain: string; keywords: number; average_position: number | null;
    visibility: number; visibility_delta: number; is_target?: boolean;
  }[];
  winners_losers?: {
    winners: { domain: string; visibility: number; visibility_delta: number }[];
    losers: { domain: string; visibility: number; visibility_delta: number }[];
  };
  pages?: { url: string; keyword_count: number; best_position: number | null; keywords: { keyword: string; position: number | null }[] }[];
  cannibalization?: { keyword: string; country: string; urls: { url: string; position: number }[] }[];
  competitors_tracked?: string[];
  competitors_discovered?: { domain: string; keywords: number; best_position: number | null; sample_url?: string }[];
  features_present?: Record<string, number>;
  keywords?: {
    id: number; keyword: string; position: number | null; url?: string;
    country?: string; device?: string; language?: string;
    competitor_positions?: Record<string, { position?: number | null }>;
    serp_features?: Record<string, boolean | string[]>;
  }[];
}
interface DevicesLocationsResult {
  ok: boolean;
  targets?: {
    key: string; label: string; country: string; language: string; device: string;
    keywords: number; ranked: number; average_position: number | null; visibility_pct: number;
  }[];
  matrix?: {
    keyword: string; target_domain: string;
    by_target: Record<string, { position: number | null; delta: number | null; id: number }>;
  }[];
}
interface AnalysisCompetitor {
  name?: string; domain?: string; url?: string; topKeywords?: string[];
}
interface AnalysisData {
  url?: string; brandName?: string; industryKey?: string; industryName?: string;
  subNiche?: string;
  keywords?: (string | { keyword?: string; term?: string })[];
  competitors?: AnalysisCompetitor[];
  industry?: { name?: string; keywords?: string[] };
  companyProfile?: { subNiche?: string; businessSummary?: string };
}

type TabId =
  | "overview"
  | "distribution"
  | "sov"
  | "pages"
  | "cannibalization"
  | "competitors"
  | "map"
  | "devices"
  | "features"
  | "history";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Landscape" },
  { id: "distribution", label: "Rankings Distribution" },
  { id: "sov", label: "Share of Voice" },
  { id: "map", label: "Competition Map" },
  { id: "pages", label: "Pages" },
  { id: "cannibalization", label: "Cannibalization" },
  { id: "competitors", label: "Competitors" },
  { id: "devices", label: "Devices & Locations" },
  { id: "features", label: "SERP Features" },
];

const COUNTRIES: [string, string][] = [
  ["us", "🇺🇸 United States"],
  ["gb", "🇬🇧 United Kingdom"],
  ["au", "🇦🇺 Australia"],
  ["ca", "🇨🇦 Canada"],
  ["za", "🇿🇦 South Africa"],
  ["mu", "🇲🇺 Mauritius"],
  ["de", "🇩🇪 Germany"],
  ["fr", "🇫🇷 France"],
  ["es", "🇪🇸 Spain"],
  ["it", "🇮🇹 Italy"],
  ["nl", "🇳🇱 Netherlands"],
  ["br", "🇧🇷 Brazil"],
  ["mx", "🇲🇽 Mexico"],
  ["in", "🇮🇳 India"],
  ["sg", "🇸🇬 Singapore"],
  ["ae", "🇦🇪 UAE"],
  ["global", "🌐 Global"],
];
const COUNTRY_LABEL: Record<string, string> = Object.fromEntries(COUNTRIES);

const FEATURE_OPTS: [string, string][] = [
  ["", "All SERP features"],
  ["featured_snippet", "Featured snippets"],
  ["people_also_ask", "People Also Ask"],
  ["local_pack", "Local pack"],
  ["images", "Images"],
  ["video", "Video"],
  ["sitelinks", "Sitelinks"],
  ["ai_overview", "AI Overview"],
  ["knowledge_graph", "Knowledge graph"],
];

function countryLabel(code: string | null | undefined): string {
  const raw = String(code || "us").toLowerCase().trim();
  const key = raw === "globa" ? "global" : raw;
  return COUNTRY_LABEL[key] || raw.toUpperCase();
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

function analysisKeywordPool(): string[] {
  const ad = getAnalysisData();
  const seen = new Set<string>();
  const pool: string[] = [];
  const push = (raw: unknown) => {
    let s = "";
    if (typeof raw === "string") s = raw;
    else if (raw && typeof raw === "object") {
      const o = raw as { keyword?: string; term?: string };
      s = o.keyword || o.term || "";
    }
    const t = String(s || "").trim();
    if (!t || t.length > 80) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    pool.push(t);
  };
  (ad.keywords || []).forEach(push);
  (ad.competitors || []).forEach((c) => (c.topKeywords || []).forEach(push));
  (ad.industry?.keywords || []).forEach(push);
  if (ad.subNiche) push(ad.subNiche);
  if (ad.companyProfile?.subNiche) push(ad.companyProfile.subNiche);
  return pool;
}

function analysisNicheLabel(): string {
  const ad = getAnalysisData();
  return (
    ad.subNiche ||
    ad.companyProfile?.subNiche ||
    ad.industryName ||
    ad.industry?.name ||
    ad.industryKey ||
    ""
  );
}

function analysisCompetitorDomains(): string[] {
  const ad = getAnalysisData();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of ad.competitors || []) {
    const d = String(c.domain || c.url || "")
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .toLowerCase();
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out.slice(0, 8);
}

function toast(msg: string) {
  (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
}

function posColor(p: number | null | undefined): string {
  if (p == null) return "#9CA3AF";
  if (p <= 3) return "#15803D";
  if (p <= 10) return "#F59E0B";
  return "#DC2626";
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontSize: "1.45rem", fontWeight: 800, color: "#0A1628", marginTop: 4 }}>{value}</div>
      {sub ? <div style={{ fontSize: "0.72rem", color: "#9CA3AF", marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

export default function SerpTracker() {
  const autoDomain = (getAnalysisData().url || "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  const seedPool = analysisKeywordPool();
  const kwPlaceholder = seedPool[0] || analysisNicheLabel() || "keyword from your analysis";

  const [keyword, setKeyword] = useState("");
  const [domainV, setDomainV] = useState(autoDomain);
  const [country, setCountry] = useState("us");
  const [device, setDevice] = useState("desktop");
  const [language, setLanguage] = useState("en");
  const [mtCountry, setMtCountry] = useState("mu");
  const [mtDevice, setMtDevice] = useState("mobile");
  const [mtLanguage, setMtLanguage] = useState("en");
  const [competitorsCsv, setCompetitorsCsv] = useState(analysisCompetitorDomains().join(", "));
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [tab, setTab] = useState<TabId>("overview");
  const [featureFilter, setFeatureFilter] = useState("");
  const [landscape, setLandscape] = useState<LandscapeResult | null>(null);
  const [devicesLoc, setDevicesLoc] = useState<DevicesLocationsResult | null>(null);
  const [sovEnabled, setSovEnabled] = useState(true);
  const [wlMode, setWlMode] = useState<"competitors" | "winners">("competitors");
  const kwIdx = useRef(0);

  const [detail, setDetail] = useState<{ keyword: string; runs: HistoryRun[] } | null>(null);

  const refreshLandscape = useCallback(async () => {
    const q = featureFilter ? `?feature=${encodeURIComponent(featureFilter)}` : "";
    const r = await apiGet<LandscapeResult>(`/api/serp-tracker/landscape${q}`);
    if (r.ok) setLandscape(r);
    const dl = await apiGet<DevicesLocationsResult>("/api/serp-tracker/devices-locations");
    if (dl.ok) setDevicesLoc(dl);
  }, [featureFilter]);

  async function refresh() {
    const r = await apiGet<KeywordsResult>("/api/serp-tracker/keywords");
    setKeywords(r.ok ? r.keywords || [] : []);
    setLoaded(true);
    await refreshLandscape();
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshLandscape();
  }, [refreshLandscape]);

  async function add() {
    if (!keyword.trim() || !domainV.trim()) {
      toast("⚠️ Keyword + domain required");
      return;
    }
    setAdding(true);
    try {
      const competitors = competitorsCsv
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const r = await apiPost<AddResult>("/api/serp-tracker/keywords", {
        keyword,
        target_domain: domainV,
        country,
        device,
        language,
        competitors,
      });
      if (!r.ok) {
        toast("❌ " + (r.error || "failed"));
        return;
      }
      setKeyword("");
      toast("✅ Tracking added");
      refresh();
    } finally {
      setAdding(false);
    }
  }

  async function saveCompetitorsGlobal() {
    if (!keywords.length) {
      toast("⚠️ Add a keyword first");
      return;
    }
    const competitors = competitorsCsv
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const r = await apiPatch<{ ok: boolean; error?: string }>(
      `/api/serp-tracker/keywords/${keywords[0].id}/competitors`,
      { competitors, apply_all: true },
    );
    if (!r.ok) {
      toast("❌ " + (r.error || "failed"));
      return;
    }
    toast(`✅ Competitors saved (${competitors.length})`);
    refresh();
  }

  async function addMultitarget() {
    setCloning(true);
    try {
      const r = await apiPost<{ ok: boolean; error?: string; created?: number; target?: { label: string } }>(
        "/api/serp-tracker/multitarget",
        {
          country: mtCountry,
          device: mtDevice,
          language: mtLanguage,
          target_domain: domainV || undefined,
        },
      );
      if (!r.ok) {
        toast("❌ " + (r.error || "failed"));
        return;
      }
      toast(`✅ Added target ${r.target?.label || ""} (${r.created || 0} keywords)`);
      setTab("devices");
      refresh();
    } finally {
      setCloning(false);
    }
  }

  async function suggest() {
    const fromAnalysis = analysisKeywordPool().slice(0, 24);
    if (fromAnalysis.length) {
      const idx = kwIdx.current % fromAnalysis.length;
      setKeyword(fromAnalysis[idx]);
      kwIdx.current = idx + 1;
      toast(`✨ Keyword from your analysis (${idx + 1}/${fromAnalysis.length})`);
      return;
    }
    const ad = getAnalysisData();
    const domain = domainV || ad.url || "";
    if (!domain) {
      toast("⚠️ Run an analysis first or enter your domain — then AI Suggest will fill keywords from it.");
      return;
    }
    const niche = analysisNicheLabel();
    const summary = ad.companyProfile?.businessSummary || "";
    setSuggesting(true);
    try {
      const r = await apiPost<OpenAiResult>("/api/openai", {
        model: "gpt-5-mini",
        messages: [{
          role: "user",
          content: [
            `Suggest one high-value SEO keyword to track in Google SERP rankings for the website "${domain}".`,
            niche ? `Industry / sub-niche: ${niche}.` : "",
            summary ? `Business: ${summary}` : "",
            "The keyword MUST be directly relevant to this exact business and industry.",
            "Reply with ONLY the keyword phrase — no explanation, no quotes.",
          ].filter(Boolean).join(" "),
        }],
      });
      const suggested = (r.choices?.[0]?.message?.content || "")
        .trim()
        .replace(/^["'.]+|["'.]+$/g, "");
      if (suggested) setKeyword(suggested);
      else toast("No suggestion returned — enter a keyword manually.");
    } catch {
      toast("AI Suggest failed — enter keyword manually.");
    } finally {
      setSuggesting(false);
    }
  }

  async function scan(id: number) {
    toast("⏳ Scanning Google…");
    const r = await apiPost<ScanResult>(`/api/serp-tracker/scan/${id}`);
    if (!r.ok) { toast("❌ " + (r.error || "failed")); return; }
    if (r.note) { toast("ℹ️ " + r.note); return; }
    toast(r.target?.position ? `✅ Ranked #${r.target.position}` : "⚠️ Not in top 20");
    refresh();
    try { document.dispatchEvent(new CustomEvent("ig:journey-updated")); } catch { /* noop */ }
  }

  async function scanAll() {
    toast("⏳ Scanning all keywords…");
    const r = await apiPost<ScanAllResult>("/api/serp-tracker/scan-all");
    if (!r.ok) { toast("❌ " + (r.error || "failed")); return; }
    toast(`✅ Scanned ${r.scanned}/${r.total}`);
    refresh();
    try { document.dispatchEvent(new CustomEvent("ig:journey-updated")); } catch { /* noop */ }
  }

  async function del(id: number) {
    if (!confirm("Delete this keyword and its history?")) return;
    await apiDelete(`/api/serp-tracker/keywords/${id}`);
    refresh();
  }

  async function showHistory(id: number, kw: string) {
    const r = await apiGet<HistoryResult>(`/api/serp-tracker/history/${id}`);
    setDetail({ keyword: kw, runs: r.ok ? r.runs || [] : [] });
    setTab("history");
  }

  async function addDiscovered(domain: string) {
    const next = competitorsCsv
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!next.includes(domain)) next.push(domain);
    setCompetitorsCsv(next.join(", "));
    setTab("competitors");
    toast(`➕ ${domain} added to competitor list — click Save Competitors`);
  }

  const s = landscape?.summary;
  const dist = s?.distribution || {};
  const distMax = Math.max(1, ...Object.values(dist));

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Rank Tracker
              </div>
              <h2 className="view-title">📍 Rank Tracker</h2>
              <p className="view-sub">
                Track your domain vs competitors across keywords — visibility, Share of Voice,
                pages, cannibalization, and SERP features.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {/* Track form */}
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 140px 120px 110px auto", gap: 10, alignItems: "end" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label style={lbl}>Keyword</label>
                <button onClick={suggest} disabled={suggesting} style={aiBtn}>
                  {suggesting ? "⏳" : "✨ AI Suggest"}
                </button>
              </div>
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={kwPlaceholder} style={trInput} />
            </div>
            <div>
              <label style={{ ...lbl, marginBottom: 4 }}>
                Your domain <span style={{ color: "#15803D", fontWeight: 600 }}>(auto-filled)</span>
              </label>
              <input
                value={domainV}
                onChange={(e) => setDomainV(e.target.value)}
                placeholder={autoDomain || "yourdomain.com"}
                style={{ ...trInput, background: autoDomain ? "#F0FDF4" : "#fff" }}
              />
            </div>
            <div>
              <label style={{ ...lbl, marginBottom: 4 }}>Location</label>
              <select value={country} onChange={(e) => setCountry(e.target.value)} style={{ ...trInput, fontSize: "0.82rem", background: "#fff" }}>
                {COUNTRIES.map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ ...lbl, marginBottom: 4 }}>Language</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ ...trInput, fontSize: "0.82rem", background: "#fff" }}>
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="es">Spanish</option>
                <option value="pt">Portuguese</option>
                <option value="af">Afrikaans</option>
                <option value="ar">Arabic</option>
                <option value="hi">Hindi</option>
                <option value="ja">Japanese</option>
                <option value="zh">Chinese</option>
              </select>
            </div>
            <div>
              <label style={{ ...lbl, marginBottom: 4 }}>Device</label>
              <select value={device} onChange={(e) => setDevice(e.target.value)} style={{ ...trInput, fontSize: "0.82rem", background: "#fff" }}>
                <option value="desktop">Desktop</option>
                <option value="mobile">Mobile</option>
              </select>
            </div>
            <button type="button" className="ig-btn-primary" onClick={add} disabled={adding} style={primaryBtn}>
              {adding ? "⏳…" : "+ Track"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 10, marginTop: 12, alignItems: "end" }}>
            <div>
              <label style={{ ...lbl, marginBottom: 4 }}>Competitors (comma-separated)</label>
              <input
                value={competitorsCsv}
                onChange={(e) => setCompetitorsCsv(e.target.value)}
                placeholder="competitor1.com, competitor2.com"
                style={trInput}
              />
            </div>
            <button onClick={saveCompetitorsGlobal} style={outlineBtn}>Save Competitors</button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8 }}>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#374151" }}>Share of Voice</span>
              <button
                type="button"
                className={`ig-toggle${sovEnabled ? " is-on" : ""}`}
                onClick={() => setSovEnabled((v) => !v)}
                aria-pressed={sovEnabled}
                aria-label="Share of Voice"
              />
            </div>
            <select
              value={featureFilter}
              onChange={(e) => setFeatureFilter(e.target.value)}
              style={{ ...trInput, fontSize: "0.78rem", background: "#fff" }}
              title="Filter landscape by SERP feature"
            >
              {FEATURE_OPTS.map(([v, label]) => (
                <option key={v || "all"} value={v}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
          <StatCard label="Visibility" value={`${s?.visibility_pct ?? 0}%`} sub={`${s?.keywords ?? 0} keywords`} />
          <StatCard label="Est. traffic" value={String(s?.estimated_traffic ?? 0)} sub="CTR-weighted / mo" />
          <StatCard label="Avg position" value={s?.average_position != null ? String(s.average_position) : "—"} />
          <StatCard
            label="Top 3 / Top 10"
            value={`${dist["1-3"] || 0} / ${(dist["1-3"] || 0) + (dist["4-10"] || 0)}`}
            sub={`${dist.unranked || 0} unranked`}
          />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12, borderBottom: "1px solid #E5E7EB", paddingBottom: 8 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "7px 12px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: "0.78rem",
                fontWeight: 700,
                background: tab === t.id ? "#0f766e" : "transparent",
                color: tab === t.id ? "#fff" : "#374151",
                WebkitTextFillColor: tab === t.id ? "#fff" : "#374151",
              }}
            >
              {t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={scanAll} className="ig-btn-secondary" style={outlineBtn}>
            ⚡ Scan All
          </button>
        </div>

        {tab === "overview" && (
          <div>
            <KeywordTable keywords={keywords} loaded={loaded} onScan={scan} onHistory={showHistory} onDel={del} />
          </div>
        )}

        {tab === "distribution" && (
          <div style={panel}>
            <h3 style={h3}>Rankings distribution</h3>
            {(["1-3", "4-10", "11-20", "21+", "unranked"] as const).map((key) => {
              const n = dist[key] || 0;
              const pct = Math.round((n / distMax) * 100);
              return (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "90px 1fr 40px", gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#374151" }}>{key}</div>
                  <div style={{ background: "#F3F4F6", borderRadius: 6, height: 18, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: key === "1-3" ? "#15803D" : key === "4-10" ? "#0284c7" : key === "unranked" ? "#9CA3AF" : "#0f766e" }} />
                  </div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 800, color: "#0A1628", textAlign: "right" }}>{n}</div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "sov" && (
          <div style={panel}>
            <h3 style={h3}>Keyword Share of Voice</h3>
            {!sovEnabled ? (
              <p style={{ color: "#6B7280", fontSize: "0.85rem" }}>Toggle Share of Voice on above to include this view in your workflow.</p>
            ) : !(landscape?.share_of_voice || []).length ? (
              <p style={{ color: "#6B7280", fontSize: "0.85rem" }}>Scan keywords to compute competitive visibility SoV.</p>
            ) : (
              <table style={table}>
                <thead>
                  <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                    <th style={trTh}>Domain</th>
                    <th style={trTh}>Share</th>
                    <th style={trTh}>Visibility pts</th>
                  </tr>
                </thead>
                <tbody>
                  {(landscape?.share_of_voice || []).map((row) => (
                    <tr key={row.domain} style={{ borderTop: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "9px 12px", fontWeight: row.is_target ? 800 : 600, color: "#0A1628" }}>
                        {row.domain}{row.is_target ? " (you)" : ""}
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, background: "#F3F4F6", height: 10, borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(100, row.share_pct)}%`, height: "100%", background: row.is_target ? "#0f766e" : "#64748B" }} />
                          </div>
                          <span style={{ fontWeight: 800, fontSize: "0.8rem", minWidth: 48 }}>{row.share_pct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: "9px 12px", color: "#6B7280", fontSize: "0.8rem" }}>{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "pages" && (
          <div style={panel}>
            <h3 style={h3}>Ranking pages</h3>
            {!(landscape?.pages || []).length ? (
              <p style={{ color: "#6B7280", fontSize: "0.85rem" }}>No ranking URLs yet — run a scan.</p>
            ) : (
              <table style={table}>
                <thead>
                  <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                    <th style={trTh}>URL</th>
                    <th style={trTh}>Keywords</th>
                    <th style={trTh}>Best pos</th>
                  </tr>
                </thead>
                <tbody>
                  {(landscape?.pages || []).map((p) => (
                    <tr key={p.url} style={{ borderTop: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "9px 12px", fontSize: "0.78rem", maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: "#0f766e" }}>{p.url}</a>
                      </td>
                      <td style={{ padding: "9px 12px", color: "#374151", fontSize: "0.78rem" }}>
                        {p.keyword_count}: {(p.keywords || []).slice(0, 4).map((k) => k.keyword).join(", ")}
                        {(p.keywords || []).length > 4 ? "…" : ""}
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        <PosBadge pos={p.best_position} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "cannibalization" && (
          <div style={panel}>
            <h3 style={h3}>Keyword cannibalization</h3>
            <p style={{ color: "#6B7280", fontSize: "0.8rem", marginTop: 0 }}>
              Keywords where multiple URLs from your domain appear in the same SERP.
            </p>
            {!(landscape?.cannibalization || []).length ? (
              <p style={{ color: "#6B7280", fontSize: "0.85rem" }}>No cannibalization detected in latest scans.</p>
            ) : (
              (landscape?.cannibalization || []).map((c) => (
                <div key={c.keyword} style={{ border: "1px solid #FECACA", background: "#FEF2F2", borderRadius: 8, padding: 12, marginBottom: 8 }}>
                  <div style={{ fontWeight: 800, color: "#991B1B", marginBottom: 6 }}>{c.keyword}</div>
                  {(c.urls || []).map((u) => (
                    <div key={u.url} style={{ fontSize: "0.78rem", color: "#374151", marginBottom: 4 }}>
                      <PosBadge pos={u.position} />{" "}
                      <a href={u.url} target="_blank" rel="noopener noreferrer" style={{ color: "#0f766e" }}>{u.url}</a>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}

        {tab === "competitors" && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={panel}>
              <h3 style={h3}>Tracked competitors</h3>
              {(landscape?.competitors_tracked || []).length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(landscape?.competitors_tracked || []).map((d) => (
                    <span key={d} style={chip}>{d}</span>
                  ))}
                </div>
              ) : (
                <p style={{ color: "#6B7280", fontSize: "0.85rem" }}>Add competitors above and click Save Competitors.</p>
              )}
              <table style={{ ...table, marginTop: 12 }}>
                <thead>
                  <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                    <th style={trTh}>Keyword</th>
                    <th style={trTh}>You</th>
                    {(landscape?.competitors_tracked || []).slice(0, 5).map((d) => (
                      <th key={d} style={trTh}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(landscape?.keywords || []).map((k) => (
                    <tr key={k.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600, fontSize: "0.8rem" }}>{k.keyword}</td>
                      <td style={{ padding: "8px 12px" }}><PosBadge pos={k.position} /></td>
                      {(landscape?.competitors_tracked || []).slice(0, 5).map((d) => (
                        <td key={d} style={{ padding: "8px 12px" }}>
                          <PosBadge pos={k.competitor_positions?.[d]?.position ?? null} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={panel}>
              <h3 style={h3}>Competitors discovery</h3>
              <p style={{ color: "#6B7280", fontSize: "0.8rem", marginTop: 0 }}>
                Domains ranking for your tracked keywords that are not yet on your competitor list.
              </p>
              {!(landscape?.competitors_discovered || []).length ? (
                <p style={{ color: "#6B7280", fontSize: "0.85rem" }}>Scan to discover rivals.</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                      <th style={trTh}>Domain</th>
                      <th style={trTh}>Keywords</th>
                      <th style={trTh}>Best pos</th>
                      <th style={trTh}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(landscape?.competitors_discovered || []).map((c) => (
                      <tr key={c.domain} style={{ borderTop: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "8px 12px", fontWeight: 600 }}>{c.domain}</td>
                        <td style={{ padding: "8px 12px" }}>{c.keywords}</td>
                        <td style={{ padding: "8px 12px" }}><PosBadge pos={c.best_position} /></td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>
                          <button onClick={() => addDiscovered(c.domain)} style={outlineBtn}>+ Add</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {tab === "map" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
            <div style={panel}>
              <h3 style={h3}>Competition Map</h3>
              <p style={{ color: "#6B7280", fontSize: "0.78rem", marginTop: 0 }}>
                X = keywords ranking · Y = average position (better toward top) · bubble size = visibility
              </p>
              <CompetitionMapChart points={landscape?.competition_map || []} />
            </div>
            <div style={panel}>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  onClick={() => setWlMode("competitors")}
                  style={{
                    ...outlineBtn,
                    background: wlMode === "competitors" ? "#0A1628" : "#fff",
                    color: wlMode === "competitors" ? "#fff" : "#374151",
                    WebkitTextFillColor: wlMode === "competitors" ? "#fff" : "#374151",
                  }}
                >
                  Competitors
                </button>
                <button
                  onClick={() => setWlMode("winners")}
                  style={{
                    ...outlineBtn,
                    background: wlMode === "winners" ? "#0A1628" : "#fff",
                    color: wlMode === "winners" ? "#fff" : "#374151",
                    WebkitTextFillColor: wlMode === "winners" ? "#fff" : "#374151",
                  }}
                >
                  Winners &amp; Losers
                </button>
              </div>
              {wlMode === "competitors" ? (
                <table style={table}>
                  <thead>
                    <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                      <th style={trTh}>Competitor</th>
                      <th style={trTh}>Visibility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(landscape?.competition_map || []).slice(0, 12).map((c) => (
                      <tr key={c.domain} style={{ borderTop: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "8px 12px", fontWeight: c.is_target ? 800 : 600 }}>
                          {c.domain}{c.is_target ? " (you)" : ""}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <span style={{ fontWeight: 800 }}>{c.visibility.toFixed(1)}</span>{" "}
                          <span style={{
                            fontSize: "0.74rem", fontWeight: 700,
                            color: c.visibility_delta > 0 ? "#15803D" : c.visibility_delta < 0 ? "#DC2626" : "#9CA3AF",
                          }}>
                            {c.visibility_delta > 0 ? "+" : ""}{c.visibility_delta.toFixed(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#15803D", marginBottom: 6 }}>WINNERS</div>
                  {(landscape?.winners_losers?.winners || []).length ? (landscape?.winners_losers?.winners || []).map((c) => (
                    <div key={"w-" + c.domain} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #F3F4F6", fontSize: "0.8rem" }}>
                      <span>{c.domain}</span>
                      <span style={{ color: "#15803D", fontWeight: 800 }}>+{c.visibility_delta.toFixed(1)}</span>
                    </div>
                  )) : <p style={{ color: "#6B7280", fontSize: "0.8rem" }}>Scan twice to see movement.</p>}
                  <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#DC2626", margin: "14px 0 6px" }}>LOSERS</div>
                  {(landscape?.winners_losers?.losers || []).length ? (landscape?.winners_losers?.losers || []).map((c) => (
                    <div key={"l-" + c.domain} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #F3F4F6", fontSize: "0.8rem" }}>
                      <span>{c.domain}</span>
                      <span style={{ color: "#DC2626", fontWeight: 800 }}>{c.visibility_delta.toFixed(1)}</span>
                    </div>
                  )) : <p style={{ color: "#6B7280", fontSize: "0.8rem" }}>No visibility losses yet.</p>}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "devices" && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={panel}>
              <h3 style={h3}>Add multitarget (location · language · device)</h3>
              <p style={{ color: "#6B7280", fontSize: "0.8rem", marginTop: 0 }}>
                Clone your tracked keywords into another Google target — compare desktop vs mobile or Mauritius vs US.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
                <div>
                  <label style={{ ...lbl, marginBottom: 4 }}>Location</label>
                  <select value={mtCountry} onChange={(e) => setMtCountry(e.target.value)} style={{ ...trInput, background: "#fff" }}>
                    {COUNTRIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ ...lbl, marginBottom: 4 }}>Language</label>
                  <select value={mtLanguage} onChange={(e) => setMtLanguage(e.target.value)} style={{ ...trInput, background: "#fff" }}>
                    <option value="en">English</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="es">Spanish</option>
                    <option value="pt">Portuguese</option>
                    <option value="af">Afrikaans</option>
                    <option value="ar">Arabic</option>
                    <option value="hi">Hindi</option>
                  </select>
                </div>
                <div>
                  <label style={{ ...lbl, marginBottom: 4 }}>Device</label>
                  <select value={mtDevice} onChange={(e) => setMtDevice(e.target.value)} style={{ ...trInput, background: "#fff" }}>
                    <option value="desktop">Desktop</option>
                    <option value="mobile">Mobile</option>
                  </select>
                </div>
                <button onClick={addMultitarget} disabled={cloning} style={primaryBtn}>
                  {cloning ? "⏳…" : "+ Add target"}
                </button>
              </div>
            </div>

            <div style={panel}>
              <h3 style={h3}>Targets overview</h3>
              {!(devicesLoc?.targets || []).length ? (
                <p style={{ color: "#6B7280", fontSize: "0.85rem" }}>No targets yet.</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                      <th style={trTh}>Target</th>
                      <th style={trTh}>Keywords</th>
                      <th style={trTh}>Ranked</th>
                      <th style={trTh}>Avg pos</th>
                      <th style={trTh}>Visibility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(devicesLoc?.targets || []).map((t) => (
                      <tr key={t.key} style={{ borderTop: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "8px 12px", fontWeight: 700 }}>{t.label}</td>
                        <td style={{ padding: "8px 12px" }}>{t.keywords}</td>
                        <td style={{ padding: "8px 12px" }}>{t.ranked}</td>
                        <td style={{ padding: "8px 12px" }}><PosBadge pos={t.average_position} /></td>
                        <td style={{ padding: "8px 12px", fontWeight: 800 }}>{t.visibility_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={panel}>
              <h3 style={h3}>Compare positions across targets</h3>
              {!(devicesLoc?.matrix || []).length || (devicesLoc?.targets || []).length < 2 ? (
                <p style={{ color: "#6B7280", fontSize: "0.85rem" }}>
                  Add a second location/device target, then Scan All to compare positions side-by-side.
                </p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={table}>
                    <thead>
                      <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                        <th style={trTh}>Keyword</th>
                        {(devicesLoc?.targets || []).map((t) => (
                          <th key={t.key} style={trTh}>{t.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(devicesLoc?.matrix || []).slice(0, 40).map((row) => (
                        <tr key={row.keyword + row.target_domain} style={{ borderTop: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "8px 12px", fontWeight: 600, fontSize: "0.8rem" }}>{row.keyword}</td>
                          {(devicesLoc?.targets || []).map((t) => {
                            const cell = row.by_target[t.key];
                            return (
                              <td key={t.key} style={{ padding: "8px 12px" }}>
                                {cell ? (
                                  <span>
                                    <PosBadge pos={cell.position} />
                                    {cell.delta != null && cell.delta !== 0 ? (
                                      <span style={{
                                        marginLeft: 6, fontSize: "0.7rem", fontWeight: 800,
                                        color: cell.delta > 0 ? "#15803D" : "#DC2626",
                                      }}>
                                        {cell.delta > 0 ? "▲" : "▼"}{Math.abs(cell.delta)}
                                      </span>
                                    ) : null}
                                  </span>
                                ) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "features" && (
          <div style={panel}>
            <h3 style={h3}>SERP features across tracked keywords</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
              {Object.entries(landscape?.features_present || {}).map(([k, n]) => (
                <div key={k} style={{ background: "#F9FAFB", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 700, textTransform: "uppercase" }}>{k.replace(/_/g, " ")}</div>
                  <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#0A1628" }}>{n}</div>
                </div>
              ))}
            </div>
            <table style={table}>
              <thead>
                <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                  <th style={trTh}>Keyword</th>
                  <th style={trTh}>Pos</th>
                  <th style={trTh}>Features</th>
                </tr>
              </thead>
              <tbody>
                {(landscape?.keywords || []).map((k) => {
                  const f = k.serp_features || {};
                  const flags = Object.entries(f)
                    .filter(([key, v]) => key !== "types" && v === true)
                    .map(([key]) => key.replace(/_/g, " "));
                  return (
                    <tr key={k.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>{k.keyword}</td>
                      <td style={{ padding: "8px 12px" }}><PosBadge pos={k.position} /></td>
                      <td style={{ padding: "8px 12px", fontSize: "0.76rem", color: "#374151" }}>
                        {flags.length ? flags.map((x) => <span key={x} style={{ ...chip, marginRight: 4 }}>{x}</span>) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {(tab === "history" || detail) && detail && (
          <div style={{ ...panel, marginTop: tab === "history" ? 0 : 14 }}>
            {!detail.runs.length ? (
              <div style={{ textAlign: "center", color: "#6B7280", padding: 20 }}>
                No scan history yet for &quot;{detail.keyword}&quot;
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontWeight: 800, color: "#0A1628" }}>📈 Position history — {detail.keyword}</div>
                  <button onClick={() => setDetail(null)} style={{ background: "transparent", border: "none", color: "#6B7280", cursor: "pointer", fontSize: "1.1rem" }}>×</button>
                </div>
                <table style={table}>
                  <thead>
                    <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                      <th style={histTh}>When</th>
                      <th style={histTh}>Position</th>
                      <th style={histTh}>URL</th>
                      <th style={histTh}>Features</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.runs.map((x, i) => {
                      const flags = Object.entries(x.serp_features || {})
                        .filter(([key, v]) => key !== "types" && v === true)
                        .map(([key]) => key.replace(/_/g, " "));
                      return (
                        <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "7px 10px", color: "#374151" }}>{new Date(x.ran_at).toLocaleString()}</td>
                          <td style={{ padding: "7px 10px" }}><PosBadge pos={x.target_position} /></td>
                          <td style={{ padding: "7px 10px", fontSize: "0.76rem", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {x.target_url ? <a href={x.target_url} target="_blank" rel="noopener noreferrer" style={{ color: "#0f766e" }}>{x.target_url}</a> : "—"}
                          </td>
                          <td style={{ padding: "7px 10px", fontSize: "0.72rem", color: "#6B7280" }}>{flags.join(", ") || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CompetitionMapChart({
  points,
}: {
  points: {
    domain: string;
    keywords: number;
    average_position: number | null;
    visibility: number;
    is_target?: boolean;
  }[];
}) {
  const W = 560, H = 320, PAD = 36;
  const data = points.filter((p) => p.average_position != null && p.keywords > 0);
  if (!data.length) {
    return (
      <div style={{ height: 280, displayContent: "center", textAlign: "center", color: "#6B7280", fontSize: "0.85rem" }}>
        Scan keywords to plot the competition map.
      </div>
    );
  }
  const maxKw = Math.max(...data.map((d) => d.keywords), 1);
  const maxVis = Math.max(...data.map((d) => d.visibility), 1);
  const maxPos = Math.max(...data.map((d) => d.average_position || 1), 10);
  const xScale = (kw: number) => PAD + (kw / maxKw) * (W - PAD * 2);
  // Y inverted: position 1 at top
  const yScale = (pos: number) => PAD + (pos / maxPos) * (H - PAD * 2);
  const rScale = (vis: number) => 8 + (vis / maxVis) * 22;
  const colors = ["#0f766e", "#0284c7", "#16a34a", "#0EA5E9", "#64748B", "#334155", "#059669", "#38bdf8"];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: "#FAFAFA", borderRadius: 8 }}>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#D1D5DB" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#D1D5DB" />
      <text x={W / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#6B7280">Number of Keywords</text>
      <text x={14} y={H / 2} textAnchor="middle" fontSize="11" fill="#6B7280" transform={`rotate(-90 14 ${H / 2})`}>Average Position</text>
      {data.map((p, i) => {
        const cx = xScale(p.keywords);
        const cy = yScale(p.average_position || maxPos);
        const r = rScale(p.visibility);
        const fill = p.is_target ? "#0f766e" : colors[i % colors.length];
        return (
          <g key={p.domain}>
            <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.55} stroke={fill} strokeWidth={1.5} />
            <text x={cx} y={cy - r - 4} textAnchor="middle" fontSize="9" fontWeight={700} fill="#0A1628">
              {p.domain.replace(/^www\./, "").slice(0, 18)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PosBadge({ pos }: { pos: number | null | undefined }) {
  return (
    <span style={{
      display: "inline-block", minWidth: 34, textAlign: "center",
      background: posColor(pos ?? null), color: "#fff", padding: "3px 8px",
      borderRadius: 4, fontWeight: 800, fontSize: "0.78rem",
    }}>
      {pos == null ? "—" : "#" + pos}
    </span>
  );
}

function KeywordTable({
  keywords, loaded, onScan, onHistory, onDel,
}: {
  keywords: Keyword[];
  loaded: boolean;
  onScan: (id: number) => void;
  onHistory: (id: number, kw: string) => void;
  onDel: (id: number) => void;
}) {
  if (!loaded) return null;
  if (!keywords.length) {
    return (
      <div style={{ background: "#F9FAFB", border: "1px dashed #D1D5DB", borderRadius: 10, padding: 30, textAlign: "center", color: "#6B7280" }}>
        No keywords tracked yet — add one above.
      </div>
    );
  }
  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, overflow: "hidden" }}>
      <table style={table}>
        <thead>
          <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
            <th style={trTh}>Keyword</th>
            <th style={trTh}>Domain</th>
            <th style={trTh}>Target</th>
            <th style={trTh}>Position</th>
            <th style={trTh}>Competitors</th>
            <th style={trTh}>Last scan</th>
            <th style={{ padding: "9px 12px" }}></th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((k) => (
            <tr key={k.id} style={{ borderTop: "1px solid #F3F4F6" }}>
              <td style={{ padding: "9px 12px", color: "#0A1628", fontWeight: 600 }}>{k.keyword}</td>
              <td style={{ padding: "9px 12px", color: "#374151" }}>{k.target_domain}</td>
              <td style={{ padding: "9px 12px", color: "#374151", fontSize: "0.76rem", fontWeight: 600, whiteSpace: "nowrap" }}>
                {countryLabel(k.country)} · {(k.language || "en").toUpperCase()} · {k.device === "mobile" ? "Mobile" : "Desktop"}
              </td>
              <td style={{ padding: "9px 12px" }}><PosBadge pos={k.last_position} /></td>
              <td style={{ padding: "9px 12px", fontSize: "0.74rem", color: "#6B7280" }}>
                {(k.competitors || []).slice(0, 3).join(", ") || "—"}
              </td>
              <td style={{ padding: "9px 12px", color: "#9CA3AF", fontSize: "0.76rem" }}>
                {k.last_run_at ? new Date(k.last_run_at).toLocaleString() : "never"}
              </td>
              <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                <button onClick={() => onScan(k.id)} style={scanBtn}>Scan</button>{" "}
                <button onClick={() => onHistory(k.id, k.keyword)} style={outlineBtn}>History</button>{" "}
                <button onClick={() => onDel(k.id)} style={{ ...outlineBtn, borderColor: "#FCA5A5", color: "#DC2626" }}>🗑</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#6B7280" };
const trInput: React.CSSProperties = {
  width: "100%", padding: "9px 12px", border: "1px solid #D1D5DB", borderRadius: 8,
  fontSize: "0.86rem", boxSizing: "border-box",
};
const trTh: React.CSSProperties = {
  padding: "9px 12px", fontSize: "0.7rem", color: "#6B7280", fontWeight: 700,
  textTransform: "uppercase", letterSpacing: ".04em",
};
const histTh: React.CSSProperties = { padding: "7px 10px", fontSize: "0.68rem", color: "#6B7280" };
const panel: React.CSSProperties = { background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 18px" };
const h3: React.CSSProperties = { margin: "0 0 10px", color: "#0A1628", fontSize: "1.02rem" };
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" };
const chip: React.CSSProperties = {
  display: "inline-block", background: "#F3F4F6", borderRadius: 999, padding: "3px 10px",
  fontSize: "0.72rem", fontWeight: 700, color: "#374151",
};
const primaryBtn: React.CSSProperties = {
  padding: "10px 18px",
  background: "linear-gradient(135deg, #0f766e 0%, #0284c7 100%)",
  border: "none",
  borderRadius: 10,
  fontSize: "0.82rem",
  fontWeight: 800,
  color: "#fff",
  WebkitTextFillColor: "#fff",
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(15, 118, 110, 0.25)",
  whiteSpace: "nowrap",
};
const outlineBtn: React.CSSProperties = {
  padding: "8px 12px",
  background: "#fff",
  border: "1.5px solid rgba(11,18,32,0.14)",
  color: "#0b1220",
  borderRadius: 10,
  fontSize: "0.76rem",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const scanBtn: React.CSSProperties = {
  padding: "5px 10px",
  background: "linear-gradient(135deg, #0f766e 0%, #0284c7 100%)",
  border: "none",
  color: "#fff",
  borderRadius: 8,
  fontSize: "0.74rem",
  fontWeight: 700,
  cursor: "pointer",
  WebkitTextFillColor: "#fff",
};
const aiBtn: React.CSSProperties = {
  padding: "2px 8px", background: "linear-gradient(135deg,#0f766e,#0284c7)", border: "none",
  borderRadius: 5, color: "#fff", WebkitTextFillColor: "#fff", fontSize: "0.62rem", fontWeight: 700, cursor: "pointer",
};

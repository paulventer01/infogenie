"use client";

import { useState, useRef, useEffect } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface TikTokAuthor {
  name?: string;
  nickname?: string;
}
interface TikTokItem {
  playCount?: number | string;
  diggCount?: number | string;
  commentCount?: number | string;
  shareCount?: number | string;
  authorMeta?: TikTokAuthor;
  author?: TikTokAuthor;
  authorNickname?: string;
  text?: string;
  description?: string;
  webVideoUrl?: string;
  videoUrl?: string;
}
interface StartResponse {
  ok: boolean;
  error?: string;
  run_id?: string;
  dataset_id?: string;
}
interface StatusResponse {
  ok?: boolean;
  error?: string;
  status?: "pending" | "failed" | "succeeded" | string;
  items?: TikTokItem[];
}
interface AnalysisData {
  brandName?: string;
  brand?: string;
  companyName?: string;
  url?: string;
  domain?: string;
  industry?: string;
  niche?: string;
  targetAudience?: string;
  competitors?: Array<{ name?: string; domain?: string }>;
  keywords?: string[];
  targetKeywords?: string[];
}

type Banner = { kind: "spinner" | "error" | "info" | "success" | "nokey"; msg: string } | null;

// Returns true when the video author appears to be the brand's own account.
// Strips punctuation/spaces from both sides then checks containment in both
// directions — e.g. "cmtrading" matches "@cmtrading" or "@cmtradingglobal".
function isBrandAuthor(author: string, brand: string): boolean {
  if (!author || !brand) return false;
  const norm = (s: string) =>
    s.toLowerCase().replace(/[@\s\-_.]/g, "").replace(/[^a-z0-9]/g, "");
  const a = norm(author);
  const b = norm(brand);
  if (!a || !b || b.length < 3) return false;
  return a.includes(b) || b.includes(a);
}

function fmt(n: number | string | undefined): string {
  const v = parseInt(String(n)) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return String(v);
}

function getDefaultKeyword(): string {
  const ad = (typeof window !== "undefined" ? (window as unknown as { analysisData?: AnalysisData }).analysisData : undefined) || {};
  if (ad.brandName) return ad.brandName;
  if (ad.brand && typeof ad.brand === "string") return ad.brand;
  if (ad.companyName) return ad.companyName;
  const dom = String(ad.url || ad.domain || "")
    .replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].split(".")[0].trim();
  return dom ? dom.charAt(0).toUpperCase() + dom.slice(1) : "";
}

function getSuggestions(): string[] {
  const ad = (typeof window !== "undefined" ? (window as unknown as { analysisData?: AnalysisData }).analysisData : undefined) || {};
  const suggestions: string[] = [];

  // Brand / company name
  const brand = ad.brandName || ad.brand || ad.companyName || "";
  if (brand) suggestions.push(brand);

  // Competitor names
  if (Array.isArray(ad.competitors)) {
    ad.competitors.slice(0, 4).forEach((c) => {
      const name = c?.name;
      if (name && name !== brand) suggestions.push(name);
    });
  }

  // Keywords from analysis
  const kws = ad.keywords || ad.targetKeywords || [];
  if (Array.isArray(kws)) {
    kws.slice(0, 4).forEach((k) => {
      if (k && !suggestions.includes(k)) suggestions.push(k);
    });
  }

  // Industry / niche as a hashtag seed
  if (ad.industry && !suggestions.includes(ad.industry)) suggestions.push(ad.industry);
  if (ad.niche && !suggestions.includes(ad.niche)) suggestions.push(ad.niche);

  return suggestions.filter(Boolean).slice(0, 8);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function OrganicSocial() {
  const [keyword, setKeyword] = useState(() => getDefaultKeyword());
  const [limit, setLimit] = useState(20);
  const [running, setRunning] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [items, setItems] = useState<TikTokItem[] | null>(null);
  const [lastKeyword, setLastKeyword] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const suggestRef = useRef<HTMLDivElement>(null);

  // Auto-fill from analysisData on mount
  useEffect(() => {
    const kw = getDefaultKeyword();
    if (kw && !keyword) setKeyword(kw);
  }, []);

  // Close suggestions dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (suggestRef.current && !suggestRef.current.contains(e.target as Node)) {
        setShowSuggest(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  function openSuggest() {
    const s = getSuggestions();
    setSuggestions(s);
    setShowSuggest(true);
  }

  function pickSuggestion(s: string) {
    setKeyword(s);
    setShowSuggest(false);
  }

  async function run() {
    const kw = keyword.trim();
    if (!kw) {
      setBanner({ kind: "error", msg: "Enter a brand, keyword or hashtag to search" });
      return;
    }
    setRunning(true);
    setItems(null);
    setBanner({ kind: "spinner", msg: "Starting Apify TikTok Scraper…" });
    const d = await apiPost<StartResponse>("/api/apify/tiktok-organic", { keyword: kw, limit });
    if (!d.ok) {
      setRunning(false);
      setBanner(
        d.error?.includes("APIFY_API_KEY")
          ? { kind: "nokey", msg: "Organic Social Monitor" }
          : { kind: "error", msg: d.error || "Failed to start" },
      );
      return;
    }
    setBanner({ kind: "spinner", msg: "TikTok scrape running… checking every 8s (usually 30–90s)" });
    await poll(d.run_id || "", d.dataset_id || "", kw);
  }

  async function poll(runId: string, datasetId: string, kw: string) {
    const MAX = 40;
    for (let attempt = 0; attempt < MAX; attempt++) {
      await delay(8000);
      const url = `/api/apify/run-status?run_id=${encodeURIComponent(runId)}&dataset_id=${encodeURIComponent(datasetId || "")}&limit=${limit || 25}`;
      const d = await apiGet<StatusResponse>(url);
      if (d.error) { setRunning(false); setBanner({ kind: "error", msg: d.error }); return; }
      if (d.status === "failed") { setRunning(false); setBanner({ kind: "error", msg: "Scrape failed: " + (d.error || "unknown") }); return; }
      if (d.status === "pending") {
        setBanner({ kind: "spinner", msg: `Still running… attempt ${attempt + 1}/${MAX} (${(attempt + 1) * 8}s elapsed)` });
        continue;
      }
      setRunning(false);
      setBanner({ kind: "success", msg: `✓ Scraped ${(d.items || []).length} results` });
      setItems(d.items || []);
      setLastKeyword(kw);
      return;
    }
    setRunning(false);
    setBanner({ kind: "error", msg: "Apify timed out — try a smaller result count." });
  }

  function exportCsv() {
    const list = items || [];
    const rows: (string | number)[][] = [["Author", "Description", "Views", "Likes", "Comments", "Shares", "EngagementRate%", "URL"]];
    list.forEach((v) => {
      const views = parseInt(String(v.playCount)) || 0;
      const likes = parseInt(String(v.diggCount)) || 0;
      rows.push([
        v.authorMeta?.name || v.author?.nickname || "",
        '"' + (v.text || v.description || "").replace(/"/g, '""').replace(/\n/g, " ") + '"',
        views, likes,
        parseInt(String(v.commentCount)) || 0,
        parseInt(String(v.shareCount)) || 0,
        views > 0 ? ((likes / views) * 100).toFixed(2) : "0",
        v.webVideoUrl || v.videoUrl || "",
      ]);
    });
    const csv = rows.map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "tiktok_organic_" + (lastKeyword || "export").replace(/\W+/g, "_") + ".csv";
    a.click();
  }

  return (
    <div style={{ background: "#EFF4FF", minHeight: "100vh", paddingBottom: 56 }}>
      <div className="view-header-wrap">
        <div className="view-header">
          <div className="container">
            <div className="vh-inner">
              <div>
                <div className="breadcrumb">
                  <span className="bc-group">Analyse</span>{" "}
                  <span className="bc-sep">›</span> Organic Social Monitor
                </div>
                <h2 className="view-title">📱 Organic Social Monitor</h2>
                <p className="view-sub">
                  Tracks competitors&apos; organic posts across Instagram,
                  LinkedIn, Twitter/X and TikTok — posting frequency, engagement
                  rates, and top-performing content so you can benchmark your own
                  strategy.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes _ttGlow  { 0%,100%{opacity:.5} 50%{opacity:1} }
        @keyframes _ttPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
        @keyframes _ttSpin  { to{transform:rotate(360deg)} }
        @keyframes _ttFadeUp{ from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .tt-card-hover      { transition: transform .2s, box-shadow .2s; }
        .tt-card-hover:hover{ transform: translateY(-3px); box-shadow: 0 14px 40px rgba(0,80,200,.18) !important; }
        .tt-search-input:focus { border-color: rgba(0,102,255,.8) !important; box-shadow: 0 0 0 3px rgba(0,102,255,.15) !important; outline: none; }
        .tt-search-btn:hover:not(:disabled) { transform: translateY(-1px) !important; box-shadow: 0 8px 28px rgba(0,102,255,.5) !important; }
        .tt-cnt-pill { transition: all .15s; }
        .tt-suggest-item:hover { background: rgba(0,102,255,.08) !important; }
        .tt-watch-btn:hover { background: rgba(0,102,255,.2) !important; }
        .tt-export-btn:hover { background: rgba(0,80,200,.08) !important; }
      `}</style>

      {/* ── HERO BANNER ─────────────────────────────────────────────────── */}
      <div style={{
        background: "linear-gradient(135deg, #0A1F4E 0%, #0D2D6B 50%, #0A3A80 100%)",
        position: "relative", overflow: "hidden",
        borderBottom: "1px solid rgba(255,255,255,.08)",
      }}>
        {/* corner glows */}
        <div style={{ position:"absolute", top:-60, left:-60, width:320, height:320, background:"radial-gradient(circle,rgba(0,153,255,.28) 0%,transparent 65%)", pointerEvents:"none", animation:"_ttGlow 4s ease infinite" }} />
        <div style={{ position:"absolute", bottom:-60, right:-40, width:280, height:280, background:"radial-gradient(circle,rgba(0,201,200,.22) 0%,transparent 65%)", pointerEvents:"none", animation:"_ttGlow 4s ease infinite 2s" }} />
        {/* subtle dot grid */}
        <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px)", backgroundSize:"28px 28px", pointerEvents:"none" }} />

        <div className="container" style={{ position:"relative", paddingTop:40, paddingBottom:40 }}>
          <div style={{ display:"flex", alignItems:"center", gap:22 }}>
            {/* Icon tile */}
            <div style={{
              flexShrink:0, width:68, height:68,
              background:"rgba(255,255,255,.1)",
              border:"1.5px solid rgba(255,255,255,.2)", borderRadius:18,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:"2rem",
              boxShadow:"4px 4px 0 rgba(0,200,255,.5),-4px -4px 0 rgba(0,201,200,.5)",
              animation:"_ttPulse 3s ease infinite",
              backdropFilter:"blur(4px)",
            }}>📱</div>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                <span style={{ fontSize:"0.6rem", fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase", color:"rgba(255,255,255,.5)" }}>ANALYSE</span>
                <span style={{ color:"rgba(255,255,255,.3)", fontSize:"0.6rem" }}>›</span>
                <span style={{ fontSize:"0.6rem", fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase", color:"rgba(100,200,255,.9)" }}>ORGANIC SOCIAL MONITOR</span>
                <span style={{ background:"rgba(0,200,255,.2)", border:"1px solid rgba(0,200,255,.45)", color:"#7FDFFF", fontSize:"0.55rem", fontWeight:800, padding:"2px 8px", borderRadius:20, letterSpacing:"0.06em" }}>● LIVE</span>
              </div>
              <h1 style={{ margin:"0 0 6px", fontSize:"2rem", fontWeight:900, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.02em", lineHeight:1.1 }}>
                Organic Social Monitor
              </h1>
              <p style={{ margin:0, fontSize:"0.88rem", color:"rgba(255,255,255,.65)", lineHeight:1.5 }}>
                Track any brand or keyword&apos;s TikTok content — views, engagement &amp; top creators. Powered by Apify.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop:24 }}>

        {/* ── SEARCH BAR ─────────────────────────────────────────────────── */}
        <div style={{ background:"#fff", border:"1px solid #D1DCF5", borderRadius:18, padding:"20px 22px", marginBottom:20, boxShadow:"0 2px 16px rgba(0,60,160,.08)" }}>
          {/* AI Suggest row */}
          <div style={{ marginBottom:10, position:"relative" }} ref={suggestRef}>
            <button
              onClick={openSuggest}
              style={{
                background:"linear-gradient(135deg,#0050CC,#0066FF)",
                color:"#fff", border:"none", borderRadius:8,
                padding:"6px 14px", fontSize:"0.75rem", fontWeight:700,
                cursor:"pointer", display:"inline-flex", alignItems:"center", gap:6,
                boxShadow:"0 2px 10px rgba(0,102,255,.35)",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
              AI Suggest
            </button>

            {/* Suggestions dropdown */}
            {showSuggest && (
              <div style={{
                position:"absolute", top:"calc(100% + 6px)", left:0, zIndex:200,
                background:"#fff", border:"1px solid #D1DCF5", borderRadius:12,
                boxShadow:"0 8px 32px rgba(0,60,160,.14)", minWidth:240, overflow:"hidden",
              }}>
                {suggestions.length === 0 ? (
                  <div style={{ padding:"12px 16px", fontSize:"0.82rem", color:"#6B7280" }}>
                    Run an analysis first to get keyword suggestions
                  </div>
                ) : (
                  <>
                    <div style={{ padding:"8px 14px 6px", fontSize:"0.62rem", fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#6B7280", borderBottom:"1px solid #F0F4FF" }}>
                      From your analysis
                    </div>
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        className="tt-suggest-item"
                        onClick={() => pickSuggestion(s)}
                        style={{
                          width:"100%", textAlign:"left", background:"transparent",
                          border:"none", padding:"9px 16px", fontSize:"0.86rem",
                          color:"#0A1628", cursor:"pointer", display:"flex",
                          alignItems:"center", gap:10, fontWeight: i === 0 ? 700 : 500,
                        }}
                      >
                        <span style={{ fontSize:"0.75rem", opacity:.5 }}>
                          {i === 0 ? "🏷" : "🔎"}
                        </span>
                        {s}
                        {i === 0 && <span style={{ marginLeft:"auto", fontSize:"0.6rem", color:"#0066FF", fontWeight:700, background:"rgba(0,102,255,.1)", padding:"2px 6px", borderRadius:6 }}>brand</span>}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Input + pills + button row */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto", gap:12, alignItems:"center" }}>
            {/* Input */}
            <div style={{ position:"relative" }}>
              <div style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:"1rem", pointerEvents:"none", opacity:.4 }}>🔎</div>
              <input
                data-ig-skip=""
                className="tt-search-input"
                style={{
                  width:"100%", boxSizing:"border-box",
                  background:"#F5F8FF", border:"1.5px solid #C7D8F5",
                  borderRadius:12, padding:"13px 14px 13px 42px",
                  color:"#0A1628", fontSize:"0.95rem",
                  transition:"border-color .2s, box-shadow .2s",
                  fontFamily:"inherit",
                }}
                placeholder="Brand, keyword or hashtag — e.g. Nike, #CleanTok"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !running && run()}
              />
            </div>

            {/* Count pills */}
            <div style={{ display:"flex", gap:6 }}>
              {[10, 20, 30].map((n) => (
                <button
                  key={n}
                  className="tt-cnt-pill"
                  onClick={() => setLimit(n)}
                  style={{
                    background: limit === n ? "#0066FF" : "#F0F4FF",
                    border: `1.5px solid ${limit === n ? "#0050CC" : "#C7D8F5"}`,
                    color: limit === n ? "#fff" : "#4B6FA0",
                    borderRadius:9, padding:"9px 14px", fontSize:"0.8rem",
                    fontWeight:700, cursor:"pointer",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>

            {/* Search button */}
            <button
              className="tt-search-btn"
              disabled={running}
              onClick={run}
              style={{
                background: running ? "#7BA8E8" : "linear-gradient(135deg,#0050CC 0%,#0066FF 100%)",
                color:"#fff", border:"none", borderRadius:12,
                padding:"13px 26px", fontWeight:800, fontSize:"0.9rem",
                cursor: running ? "not-allowed" : "pointer",
                display:"flex", alignItems:"center", gap:8,
                boxShadow: running ? "none" : "0 4px 18px rgba(0,102,255,.4)",
                whiteSpace:"nowrap", fontFamily:"inherit",
                transition:"transform .15s, box-shadow .15s",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              {running ? "Searching…" : "Search TikTok"}
            </button>
          </div>

          {/* Status banner */}
          {banner && (
            <div style={{ marginTop:12 }}>
              <StatusBanner banner={banner} />
            </div>
          )}
        </div>

        {/* ── RESULTS ───────────────────────────────────────────────────── */}
        {items && (
          <ResultsView items={items} keyword={lastKeyword} onExport={exportCsv} />
        )}
      </div>
    </div>
  );
}

function StatusBanner({ banner }: { banner: Banner }) {
  if (!banner) return null;

  if (banner.kind === "nokey") {
    return (
      <div style={{ background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:14, padding:28, textAlign:"center", marginTop:8 }}>
        <div style={{ fontSize:"2.5rem", marginBottom:10 }}>🔑</div>
        <div style={{ fontWeight:800, fontSize:"1rem", color:"#1E3A8A", marginBottom:6, fontFamily:"'Sora',sans-serif" }}>APIFY_API_KEY required</div>
        <div style={{ fontSize:"0.84rem", color:"#374151", maxWidth:400, margin:"0 auto 18px", lineHeight:1.6 }}>
          {banner.msg} uses Apify&apos;s scraping platform. Add your free API key to unlock it.
        </div>
        <a href="https://console.apify.com/sign-up" target="_blank" rel="noopener noreferrer"
          style={{ display:"inline-block", padding:"11px 26px", background:"linear-gradient(135deg,#0050CC,#0066FF)", color:"#fff", borderRadius:10, fontWeight:700, fontSize:"0.87rem", textDecoration:"none", boxShadow:"0 4px 18px rgba(0,102,255,.35)" }}>
          Get Free Apify Key →
        </a>
        <div style={{ fontSize:"0.72rem", color:"#9CA3AF", marginTop:12 }}>
          Add it in <strong style={{ color:"#6B7280" }}>Settings → Integrations → Apify</strong>
        </div>
      </div>
    );
  }

  if (banner.kind === "spinner") {
    return (
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0" }}>
        <div style={{ width:16, height:16, border:"2.5px solid #0066FF", borderTopColor:"transparent", borderRadius:"50%", animation:"_ttSpin 0.75s linear infinite", flexShrink:0 }} />
        <span style={{ fontSize:"0.84rem", color:"#4B6FA0" }}>{banner.msg}</span>
      </div>
    );
  }

  const cfg = {
    error:   { bg:"#FEF2F2", border:"#FECACA",  fg:"#991B1B" },
    success: { bg:"#F0FDF4", border:"#BBF7D0",  fg:"#14532D" },
    info:    { bg:"#EFF6FF", border:"#BFDBFE",  fg:"#1E40AF" },
  } as const;
  const c = cfg[banner.kind as keyof typeof cfg] || cfg.info;
  return (
    <div style={{ background:c.bg, border:`1px solid ${c.border}`, color:c.fg, padding:"10px 15px", borderRadius:10, fontSize:"0.84rem" }}>
      {banner.msg}
    </div>
  );
}

function VideoCard({ v, isTop }: { v: TikTokItem; isTop: boolean }) {
  const views    = parseInt(String(v.playCount))    || 0;
  const likes    = parseInt(String(v.diggCount))    || 0;
  const comments = parseInt(String(v.commentCount)) || 0;
  const shares   = parseInt(String(v.shareCount))   || 0;
  const author   = v.authorMeta?.name || v.author?.nickname || v.authorNickname || "unknown";
  const desc     = (v.text || v.description || "").slice(0, 180);
  const url      = v.webVideoUrl || v.videoUrl || "";
  const erNum    = views > 0 ? (likes / views) * 100 : 0;
  const er       = erNum.toFixed(2);
  const erColor  = erNum > 2 ? "#059669" : erNum > 0.5 ? "#D97706" : "#DC2626";
  const erBg     = erNum > 2 ? "#ECFDF5" : erNum > 0.5 ? "#FFFBEB" : "#FEF2F2";
  const initials = author.slice(0, 2).toUpperCase();
  const tags     = (v.text || "").match(/#\w+/g) || [];

  return (
    <div
      className="tt-card-hover"
      style={{
        background:"#fff",
        border:`1px solid ${isTop ? "#93C5FD" : "#D1DCF5"}`,
        borderRadius:16, overflow:"hidden", position:"relative",
        boxShadow: isTop ? "0 0 0 2px rgba(0,102,255,.15)" : "0 2px 12px rgba(0,60,160,.06)",
      }}
    >
      {isTop && <div style={{ height:3, background:"linear-gradient(90deg,#0050CC,#0099FF,#00C9C8)" }} />}
      <div style={{ padding:"16px 18px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <div style={{ flexShrink:0, width:38, height:38, background:"linear-gradient(135deg,#0050CC,#0099FF)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:"0.8rem", fontWeight:900, boxShadow:"0 2px 8px rgba(0,102,255,.3)" }}>
            {initials}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:800, fontSize:"0.88rem", color:"#0A1628", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>@{author}</div>
            {isTop && <div style={{ fontSize:"0.62rem", color:"#0066FF", fontWeight:700, letterSpacing:"0.06em" }}>👑 TOP PERFORMING</div>}
          </div>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="tt-watch-btn"
              style={{ flexShrink:0, background:"rgba(0,102,255,.1)", border:"1px solid rgba(0,102,255,.25)", color:"#0050CC", fontSize:"0.72rem", fontWeight:800, padding:"5px 12px", borderRadius:20, textDecoration:"none", transition:"background .15s" }}>
              ▶ Watch
            </a>
          )}
        </div>
        <div style={{ fontSize:"0.8rem", color:"#374151", lineHeight:1.6, marginBottom:10, minHeight:40 }}>
          {desc}{desc.length >= 180 ? "…" : ""}
        </div>
        {tags.length > 0 && (
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:12 }}>
            {tags.slice(0, 3).map((t, ti) => (
              <span key={ti} style={{ background:"#EFF6FF", border:"1px solid #BFDBFE", color:"#1D4ED8", fontSize:"0.62rem", padding:"2px 7px", borderRadius:20, fontWeight:600 }}>{t}</span>
            ))}
          </div>
        )}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
          {([["👁", fmt(views), "Views"], ["❤️", fmt(likes), "Likes"], ["💬", fmt(comments), "Cmts"], ["🔁", fmt(shares), "Shares"]] as [string,string,string][]).map(([ic, val, lbl], ci) => (
            <div key={ci} style={{ background:"#F5F8FF", border:"1px solid #E0EAFF", borderRadius:10, padding:"8px 4px", textAlign:"center" }}>
              <div style={{ fontSize:"0.85rem", marginBottom:2 }}>{ic}</div>
              <div style={{ fontSize:"0.8rem", fontWeight:800, color:"#0A1628" }}>{val}</div>
              <div style={{ fontSize:"0.57rem", color:"#6B88B0", textTransform:"uppercase", letterSpacing:"0.05em" }}>{lbl}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ fontSize:"0.6rem", color:"#8899BB", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", flexShrink:0 }}>Engagement</div>
          <div style={{ flex:1, height:5, background:"#E8EFFF", borderRadius:4, overflow:"hidden" }}>
            <div style={{ width:`${Math.min(erNum * 20, 100)}%`, height:"100%", background:erColor, borderRadius:4, transition:"width .6s ease" }} />
          </div>
          <span style={{ fontSize:"0.72rem", fontWeight:800, color:erColor, background:erBg, padding:"2px 7px", borderRadius:20, flexShrink:0 }}>{er}%</span>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ emoji, title, count, accent }: { emoji: string; title: string; count: number; accent: string }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
      <div style={{ width:4, height:24, background:accent, borderRadius:2, flexShrink:0 }} />
      <span style={{ fontSize:"0.62rem", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:accent }}>{emoji} {title}</span>
      <span style={{ background:accent, color:"#fff", borderRadius:20, padding:"2px 9px", fontSize:"0.62rem", fontWeight:800 }}>{count}</span>
    </div>
  );
}

function ResultsView({ items, keyword, onExport }: { items: TikTokItem[]; keyword: string; onExport: () => void }) {
  if (!items.length) {
    return (
      <div style={{ background:"#EFF6FF", border:"1px solid #BFDBFE", color:"#1E40AF", padding:"10px 14px", borderRadius:10, fontSize:"0.84rem" }}>
        No videos found — try a different keyword or hashtag
      </div>
    );
  }

  // Split into brand's own channel vs third-party mentions
  const isHashtagSearch = keyword.startsWith("#");
  const brandVideos  = isHashtagSearch ? [] : items.filter((v) => {
    const author = v.authorMeta?.name || v.author?.nickname || v.authorNickname || "";
    return isBrandAuthor(author, keyword);
  });
  const mentionVideos = isHashtagSearch ? items : items.filter((v) => {
    const author = v.authorMeta?.name || v.author?.nickname || v.authorNickname || "";
    return !isBrandAuthor(author, keyword);
  });

  const allForStats = items;
  const totalViews = allForStats.reduce((a, v) => a + (parseInt(String(v.playCount)) || 0), 0);
  const totalLikes = allForStats.reduce((a, v) => a + (parseInt(String(v.diggCount)) || 0), 0);
  const avgEr = totalViews > 0 ? ((totalLikes / totalViews) * 100).toFixed(2) : "0";

  const stats: [string, string, string, string][] = [
    ["📹", String(items.length), "Videos", "#0066FF"],
    ["👁", fmt(totalViews), "Total Views", "#0099DD"],
    ["❤️", fmt(totalLikes), "Total Likes", "#E05A00"],
    ["📊", avgEr + "%", "Avg ER", "#5B21B6"],
  ];

  return (
    <div style={{ animation:"_ttFadeUp .35s ease both" }}>
      {/* Stat row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
        {stats.map(([ic, val, label, col], i) => (
          <div key={i} style={{ background:"#fff", border:"1px solid #D1DCF5", borderRadius:14, padding:"17px 18px", position:"relative", overflow:"hidden", boxShadow:"0 2px 10px rgba(0,60,160,.06)" }}>
            <div style={{ position:"absolute", top:-12, right:-12, fontSize:"2.8rem", opacity:.07, pointerEvents:"none" }}>{ic}</div>
            <div style={{ fontSize:"0.6rem", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#6B88B0", marginBottom:5 }}>{label}</div>
            <div style={{ fontSize:"1.45rem", fontWeight:900, color:col, fontFamily:"'Sora',sans-serif", lineHeight:1 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Results header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div>
          <div style={{ fontSize:"0.6rem", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#8899BB", marginBottom:3 }}>TIKTOK RESULTS</div>
          <div style={{ fontSize:"1.02rem", fontWeight:800, color:"#0A1628", fontFamily:"'Sora',sans-serif" }}>
            Results for <span style={{ color:"#0066FF" }}>&quot;{keyword}&quot;</span>
          </div>
        </div>
        <button
          className="tt-export-btn"
          onClick={onExport}
          style={{ background:"#F0F4FF", border:"1px solid #C7D8F5", color:"#0050CC", borderRadius:10, padding:"9px 18px", fontSize:"0.78rem", fontWeight:700, cursor:"pointer", transition:"all .15s" }}
        >
          ⬇ Export CSV
        </button>
      </div>

      {/* Brand channel section */}
      {!isHashtagSearch && (
        <>
          {brandVideos.length > 0 ? (
            <div style={{ marginBottom:28 }}>
              <SectionHeader emoji="🏢" title={`${keyword} — Official Channel`} count={brandVideos.length} accent="#0066FF" />
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))", gap:14 }}>
                {brandVideos.map((v, i) => <VideoCard key={i} v={v} isTop={i === 0 && (parseInt(String(v.playCount)) || 0) > 0} />)}
              </div>
            </div>
          ) : (
            <div style={{ background:"#FEF3C7", border:"1px solid #FCD34D", borderRadius:10, padding:"12px 16px", marginBottom:20, fontSize:"0.82rem", color:"#92400E" }}>
              ⚠️ <strong>No official {keyword} channel videos found in these results.</strong>{" "}
              The scraper found only third-party content that mentions &ldquo;{keyword}&rdquo;. Try searching for their exact TikTok handle (e.g. <em>@{keyword.toLowerCase().split(" ").join("")}</em>) if you know it.
            </div>
          )}
        </>
      )}

      {/* Mentions / hashtag results */}
      {mentionVideos.length > 0 && (
        <div>
          <SectionHeader
            emoji={isHashtagSearch ? "🔎" : "💬"}
            title={isHashtagSearch ? `Videos tagged ${keyword}` : `3rd-party mentions of "${keyword}"`}
            count={mentionVideos.length}
            accent={isHashtagSearch ? "#0066FF" : "#6B7280"}
          />
          {!isHashtagSearch && (
            <div style={{ fontSize:"0.72rem", color:"#6B7280", marginBottom:12, marginTop:-6 }}>
              These creators mentioned or hashtagged &ldquo;{keyword}&rdquo; but are not the brand&apos;s official account.
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))", gap:14 }}>
            {mentionVideos.map((v, i) => <VideoCard key={i} v={v} isTop={isHashtagSearch && i === 0 && (parseInt(String(v.playCount)) || 0) > 0} />)}
          </div>
        </div>
      )}
    </div>
  );
}

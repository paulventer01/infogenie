"use client";

import { useState } from "react";
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

type Banner = { kind: "spinner" | "error" | "info" | "success" | "nokey"; msg: string } | null;

function fmt(n: number | string | undefined): string {
  const v = parseInt(String(n)) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return String(v);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function OrganicSocial() {
  const [keyword, setKeyword] = useState("");
  const [limit, setLimit] = useState(20);
  const [running, setRunning] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [items, setItems] = useState<TikTokItem[] | null>(null);
  const [lastKeyword, setLastKeyword] = useState("");

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
    setBanner({ kind: "spinner", msg: "TikTok scrape running… checking every 8s (usually 30-90s)" });
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
    <div style={{ background: "var(--bg-page,#F4F6FB)", minHeight: "100vh", paddingBottom: 56 }}>
      <style>{`
        @keyframes _ttGlow { 0%,100%{opacity:.6} 50%{opacity:1} }
        @keyframes _ttPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
        @keyframes _ttSpin  { to{transform:rotate(360deg)} }
        @keyframes _ttFadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .tt-card-hover { transition: transform .2s, box-shadow .2s; }
        .tt-card-hover:hover { transform: translateY(-3px); box-shadow: 0 14px 40px rgba(255,0,80,.18) !important; }
        .tt-cnt-pill { transition: all .15s; }
        .tt-search-btn { transition: transform .15s, box-shadow .15s; }
        .tt-search-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 28px rgba(255,0,80,.5), inset 0 1px 0 rgba(255,255,255,.15) !important; }
        .tt-search-input:focus { border-color: rgba(255,0,80,.8) !important; box-shadow: 0 0 0 3px rgba(255,0,80,.12) !important; }
        .tt-watch-btn:hover { background: rgba(255,0,80,.25) !important; }
        .tt-export-btn:hover { background: rgba(255,255,255,.1) !important; color: #fff !important; }
      `}</style>

      {/* ── HERO BANNER ─────────────────────────────────────────────────── */}
      <div style={{
        background: "#0A0A0A", position: "relative", overflow: "hidden",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        {/* corner glows */}
        <div style={{ position:"absolute", top:-60, left:-60, width:320, height:320, background:"radial-gradient(circle,rgba(255,0,80,.22) 0%,transparent 65%)", pointerEvents:"none", animation:"_ttGlow 4s ease infinite" }} />
        <div style={{ position:"absolute", bottom:-60, right:-40, width:280, height:280, background:"radial-gradient(circle,rgba(0,201,200,.18) 0%,transparent 65%)", pointerEvents:"none", animation:"_ttGlow 4s ease infinite 2s" }} />
        {/* grid texture */}
        <div style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px)", backgroundSize:"40px 40px", pointerEvents:"none" }} />

        <div className="container" style={{ position:"relative", paddingTop:40, paddingBottom:40 }}>
          <div style={{ display:"flex", alignItems:"center", gap:22 }}>
            {/* Icon tile */}
            <div style={{
              flexShrink:0, width:68, height:68, background:"#000",
              border:"2px solid rgba(255,255,255,0.1)", borderRadius:18,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:"2rem",
              boxShadow:"4px 4px 0 #FF0050,-4px -4px 0 #00C9C8",
              animation:"_ttPulse 3s ease infinite",
            }}>📱</div>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                <span style={{ fontSize:"0.6rem", fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase", color:"rgba(255,255,255,.35)" }}>ANALYSE</span>
                <span style={{ color:"rgba(255,255,255,.2)", fontSize:"0.55rem" }}>›</span>
                <span style={{ fontSize:"0.6rem", fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase", color:"rgba(255,0,80,.85)" }}>ORGANIC SOCIAL MONITOR</span>
                <span style={{ background:"rgba(255,0,80,.15)", border:"1px solid rgba(255,0,80,.4)", color:"#FF0050", fontSize:"0.55rem", fontWeight:800, padding:"2px 8px", borderRadius:20, letterSpacing:"0.06em" }}>● LIVE</span>
              </div>
              <h1 style={{ margin:"0 0 6px", fontSize:"2rem", fontWeight:900, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.02em", lineHeight:1.1 }}>
                Organic Social Monitor
              </h1>
              <p style={{ margin:0, fontSize:"0.88rem", color:"rgba(255,255,255,.42)", lineHeight:1.5 }}>
                Track any brand or keyword&apos;s TikTok content — views, engagement &amp; top creators. Powered by Apify.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop:24 }}>

        {/* ── SEARCH BAR ─────────────────────────────────────────────────── */}
        <div style={{ background:"#111", border:"1px solid rgba(255,255,255,.08)", borderRadius:18, padding:"20px 22px", marginBottom:20 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto", gap:12, alignItems:"center" }}>
            {/* Input */}
            <div style={{ position:"relative" }}>
              <div style={{ position:"absolute", left:15, top:"50%", transform:"translateY(-50%)", fontSize:"1rem", pointerEvents:"none", opacity:.45 }}>🔎</div>
              <input
                className="tt-search-input"
                style={{
                  width:"100%", boxSizing:"border-box",
                  background:"rgba(255,255,255,.05)", border:"1.5px solid rgba(255,255,255,.12)",
                  borderRadius:12, padding:"13px 14px 13px 42px",
                  color:"#fff", fontSize:"0.95rem", outline:"none",
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
                    background: limit === n ? "rgba(255,0,80,.2)" : "rgba(255,255,255,.05)",
                    border: `1.5px solid ${limit === n ? "rgba(255,0,80,.55)" : "rgba(255,255,255,.12)"}`,
                    color: limit === n ? "#FF0050" : "rgba(255,255,255,.5)",
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
                background: running ? "rgba(255,0,80,.45)" : "linear-gradient(135deg,#FF0050 0%,#FF3B5C 100%)",
                color:"#fff", border:"none", borderRadius:12,
                padding:"13px 26px", fontWeight:800, fontSize:"0.9rem",
                cursor: running ? "not-allowed" : "pointer",
                display:"flex", alignItems:"center", gap:8,
                boxShadow:"0 4px 20px rgba(255,0,80,.4),inset 0 1px 0 rgba(255,255,255,.15)",
                whiteSpace:"nowrap", fontFamily:"inherit",
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
      <div style={{ background:"rgba(13,31,53,0.98)", border:"1px solid rgba(255,0,80,.25)", borderRadius:14, padding:28, textAlign:"center", marginTop:8 }}>
        <div style={{ fontSize:"2.5rem", marginBottom:10 }}>🔑</div>
        <div style={{ fontWeight:800, fontSize:"1rem", color:"#fff", marginBottom:6, fontFamily:"'Sora',sans-serif" }}>APIFY_API_KEY required</div>
        <div style={{ fontSize:"0.84rem", color:"rgba(255,255,255,.45)", maxWidth:400, margin:"0 auto 18px", lineHeight:1.6 }}>
          {banner.msg} uses Apify&apos;s scraping platform. Add your free API key to unlock it.
        </div>
        <a href="https://console.apify.com/sign-up" target="_blank" rel="noopener noreferrer"
          style={{ display:"inline-block", padding:"11px 26px", background:"linear-gradient(135deg,#FF0050,#FF3B5C)", color:"#fff", borderRadius:10, fontWeight:700, fontSize:"0.87rem", textDecoration:"none", boxShadow:"0 4px 18px rgba(255,0,80,.4)" }}>
          Get Free Apify Key →
        </a>
        <div style={{ fontSize:"0.72rem", color:"rgba(255,255,255,.28)", marginTop:12 }}>
          Add it in <strong style={{ color:"rgba(255,255,255,.45)" }}>Settings → Integrations → Apify</strong>
        </div>
      </div>
    );
  }

  if (banner.kind === "spinner") {
    return (
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0" }}>
        <div style={{ width:16, height:16, border:"2.5px solid #FF0050", borderTopColor:"transparent", borderRadius:"50%", animation:"_ttSpin 0.75s linear infinite", flexShrink:0 }} />
        <span style={{ fontSize:"0.84rem", color:"rgba(255,255,255,.5)" }}>{banner.msg}</span>
      </div>
    );
  }

  const cfg = {
    error:   { bg:"rgba(220,38,38,.12)",  border:"rgba(220,38,38,.35)",  fg:"#FCA5A5" },
    success: { bg:"rgba(16,185,129,.12)", border:"rgba(16,185,129,.35)", fg:"#6EE7B7" },
    info:    { bg:"rgba(0,102,255,.12)",  border:"rgba(0,102,255,.35)",  fg:"#93C5FD" },
  } as const;
  const c = cfg[banner.kind as keyof typeof cfg] || cfg.info;
  return (
    <div style={{ background:c.bg, border:`1px solid ${c.border}`, color:c.fg, padding:"10px 15px", borderRadius:10, fontSize:"0.84rem" }}>
      {banner.msg}
    </div>
  );
}

function ResultsView({ items, keyword, onExport }: { items: TikTokItem[]; keyword: string; onExport: () => void }) {
  if (!items.length) {
    return (
      <div style={{ background:"rgba(0,102,255,.08)", border:"1px solid rgba(0,102,255,.25)", color:"#93C5FD", padding:"10px 14px", borderRadius:10, fontSize:"0.84rem" }}>
        No videos found — try a different keyword or hashtag
      </div>
    );
  }

  const totalViews = items.reduce((a, v) => a + (parseInt(String(v.playCount)) || 0), 0);
  const totalLikes = items.reduce((a, v) => a + (parseInt(String(v.diggCount)) || 0), 0);
  const avgEr = totalViews > 0 ? ((totalLikes / totalViews) * 100).toFixed(2) : "0";

  const stats: [string, string, string, string][] = [
    ["📹", String(items.length), "Videos", "#FF0050"],
    ["👁", fmt(totalViews), "Total Views", "#00C9C8"],
    ["❤️", fmt(totalLikes), "Total Likes", "#F59E0B"],
    ["📊", avgEr + "%", "Avg ER", "#818CF8"],
  ];

  return (
    <div style={{ animation:"_ttFadeUp .35s ease both" }}>
      {/* Stat row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
        {stats.map(([ic, val, label, col], i) => (
          <div key={i} style={{ background:"#111", border:"1px solid rgba(255,255,255,.07)", borderRadius:14, padding:"17px 18px", position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", top:-16, right:-14, fontSize:"2.8rem", opacity:.07, pointerEvents:"none" }}>{ic}</div>
            <div style={{ fontSize:"0.6rem", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"rgba(255,255,255,.35)", marginBottom:5 }}>{label}</div>
            <div style={{ fontSize:"1.45rem", fontWeight:900, color:col, fontFamily:"'Sora',sans-serif", lineHeight:1 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Results header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div>
          <div style={{ fontSize:"0.6rem", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"rgba(255,255,255,.3)", marginBottom:3 }}>TIKTOK RESULTS</div>
          <div style={{ fontSize:"1.02rem", fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>
            Results for <span style={{ color:"#FF0050" }}>&quot;{keyword}&quot;</span>
          </div>
        </div>
        <button
          className="tt-export-btn"
          onClick={onExport}
          style={{ background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.12)", color:"rgba(255,255,255,.6)", borderRadius:10, padding:"9px 18px", fontSize:"0.78rem", fontWeight:700, cursor:"pointer", transition:"all .15s" }}
        >
          ⬇ Export CSV
        </button>
      </div>

      {/* Video cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))", gap:14 }}>
        {items.map((v, i) => {
          const views    = parseInt(String(v.playCount))    || 0;
          const likes    = parseInt(String(v.diggCount))    || 0;
          const comments = parseInt(String(v.commentCount)) || 0;
          const shares   = parseInt(String(v.shareCount))   || 0;
          const author   = v.authorMeta?.name || v.author?.nickname || v.authorNickname || "unknown";
          const desc     = (v.text || v.description || "").slice(0, 180);
          const url      = v.webVideoUrl || v.videoUrl || "";
          const erNum    = views > 0 ? (likes / views) * 100 : 0;
          const er       = erNum.toFixed(2);
          const erColor  = erNum > 2 ? "#34D399" : erNum > 0.5 ? "#FBBF24" : "#F87171";
          const isTop    = i === 0 && views > 0;
          const initials = author.slice(0, 2).toUpperCase();
          const tags     = (v.text || "").match(/#\w+/g) || [];

          return (
            <div
              key={i}
              className="tt-card-hover"
              style={{
                background:"#111",
                border:`1px solid ${isTop ? "rgba(255,0,80,.4)" : "rgba(255,255,255,.07)"}`,
                borderRadius:16, overflow:"hidden", position:"relative",
                animationDelay:`${(i * 0.04).toFixed(2)}s`,
              }}
            >
              {/* top accent line for #1 */}
              {isTop && <div style={{ height:2, background:"linear-gradient(90deg,#FF0050,#FF3B5C,#FF6B8A)" }} />}

              <div style={{ padding:"16px 18px" }}>
                {/* Creator row */}
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                  <div style={{ flexShrink:0, width:38, height:38, background:"linear-gradient(135deg,#FF0050,#FF3B5C)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:"0.8rem", fontWeight:900, boxShadow:"0 2px 10px rgba(255,0,80,.35)" }}>
                    {initials}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:800, fontSize:"0.88rem", color:"#fff", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>@{author}</div>
                    {isTop && <div style={{ fontSize:"0.62rem", color:"#FF0050", fontWeight:700, letterSpacing:"0.06em" }}>👑 TOP PERFORMING</div>}
                  </div>
                  {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="tt-watch-btn"
                      style={{ flexShrink:0, background:"rgba(255,0,80,.12)", border:"1px solid rgba(255,0,80,.3)", color:"#FF0050", fontSize:"0.72rem", fontWeight:800, padding:"5px 12px", borderRadius:20, textDecoration:"none", transition:"background .15s" }}>
                      ▶ Watch
                    </a>
                  )}
                </div>

                {/* Description */}
                <div style={{ fontSize:"0.8rem", color:"rgba(255,255,255,.52)", lineHeight:1.6, marginBottom:10, minHeight:40 }}>
                  {desc}{desc.length >= 180 ? "…" : ""}
                </div>

                {/* Hashtag pills */}
                {tags.length > 0 && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:12 }}>
                    {tags.slice(0, 3).map((t, ti) => (
                      <span key={ti} style={{ background:"rgba(255,0,80,.1)", border:"1px solid rgba(255,0,80,.25)", color:"#FF6B8A", fontSize:"0.62rem", padding:"2px 7px", borderRadius:20, fontWeight:600 }}>{t}</span>
                    ))}
                  </div>
                )}

                {/* Metrics grid */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
                  {([["👁", fmt(views), "Views"], ["❤️", fmt(likes), "Likes"], ["💬", fmt(comments), "Cmts"], ["🔁", fmt(shares), "Shares"]] as [string,string,string][]).map(([ic, val, lbl], ci) => (
                    <div key={ci} style={{ background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.06)", borderRadius:10, padding:"8px 4px", textAlign:"center" }}>
                      <div style={{ fontSize:"0.85rem", marginBottom:2 }}>{ic}</div>
                      <div style={{ fontSize:"0.8rem", fontWeight:800, color:"#fff" }}>{val}</div>
                      <div style={{ fontSize:"0.57rem", color:"rgba(255,255,255,.3)", textTransform:"uppercase", letterSpacing:"0.05em" }}>{lbl}</div>
                    </div>
                  ))}
                </div>

                {/* ER bar */}
                <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ fontSize:"0.6rem", color:"rgba(255,255,255,.3)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", flexShrink:0 }}>Engagement</div>
                  <div style={{ flex:1, height:4, background:"rgba(255,255,255,.07)", borderRadius:4, overflow:"hidden" }}>
                    <div style={{ width:`${Math.min(erNum * 20, 100)}%`, height:"100%", background:erColor, borderRadius:4, transition:"width .6s ease" }} />
                  </div>
                  <div style={{ fontSize:"0.75rem", fontWeight:800, color:erColor, flexShrink:0 }}>{er}%</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

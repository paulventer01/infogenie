"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

interface DomainStats {
  organicKeywords?: number; paidKeywords?: number;
  monthlyOrganicClicks?: number; monthlyPaidClicks?: number;
  totalMonthlyValue?: number; monthlyBudget?: number;
  averageOrganicRank?: number; strength?: number;
  [k: string]: unknown;
}
interface DomainResp  { ok: boolean; domain?: string; stats?: DomainStats; error?: string; }
interface KwRow       { keyword?: string; searchVolume?: number; rank?: number; clicks?: number; costPerClick?: number; value?: number; isNewToTop10?: boolean; [k: string]: unknown; }
interface KwResp      { ok: boolean; keywords?: KwRow[]; error?: string; }
interface CompRow     { domain?: string; commonKeywords?: number; [k: string]: unknown; }
interface CompResp    { ok: boolean; competitors?: CompRow[]; error?: string; }

const COUNTRIES = [
  { k:"US", flag:"🇺🇸", label:"United States"  },
  { k:"GB", flag:"🇬🇧", label:"United Kingdom"  },
  { k:"CA", flag:"🇨🇦", label:"Canada"          },
  { k:"AU", flag:"🇦🇺", label:"Australia"       },
  { k:"DE", flag:"🇩🇪", label:"Germany"         },
  { k:"FR", flag:"🇫🇷", label:"France"          },
  { k:"IN", flag:"🇮🇳", label:"India"           },
  { k:"ES", flag:"🇪🇸", label:"Spain"           },
  { k:"AE", flag:"🇦🇪", label:"UAE"             },
  { k:"ZA", flag:"🇿🇦", label:"South Africa"    },
];

function fmtNum(n: number|null|undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+"M";
  if (n >= 1_000) return (n/1_000).toFixed(1)+"k";
  return String(n);
}
function fmtMoney(n: number|null|undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return "$"+(n/1_000_000).toFixed(1)+"M";
  if (n >= 1_000) return "$"+(n/1_000).toFixed(1)+"k";
  return "$"+n.toFixed(0);
}

function getAnalysisDomain(): string {
  if (typeof window === "undefined") return "";
  const ad = (window as unknown as Record<string,unknown>).analysisData as Record<string,unknown>|undefined;
  if (!ad) return "";
  const url = String(ad.url || ad.domain || "");
  if (!url) return "";
  return url.replace(/^https?:\/\//i,"").replace(/^www\./i,"").split("/")[0].trim();
}

export default function SpyFu() {
  const [domain, setDomain]   = useState("");
  const [country, setCountry] = useState("US");
  const [tab, setTab]         = useState<"overview"|"organic"|"paid"|"competitors">("overview");
  const [compType, setCompType] = useState<"organic"|"paid">("organic");

  const [stats, setStats]       = useState<DomainStats|null>(null);
  const [organicKws, setOrganicKws] = useState<KwRow[]>([]);
  const [paidKws, setPaidKws]   = useState<KwRow[]>([]);
  const [competitors, setComp]  = useState<CompRow[]>([]);

  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [noKey, setNoKey]       = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const d = getAnalysisDomain();
    if (d) setDomain(d);
  }, []);

  async function runSearch() {
    const d = domain.trim();
    if (!d) return;
    setLoading(true); setError(""); setSearched(true); setStats(null);
    try {
      const [r1, r2, r3, r4] = await Promise.all([
        apiGet<DomainResp>(`/api/spyfu/domain?domain=${encodeURIComponent(d)}&countryCode=${country}`),
        apiGet<KwResp>(`/api/spyfu/organic-keywords?domain=${encodeURIComponent(d)}&countryCode=${country}`),
        apiGet<KwResp>(`/api/spyfu/paid-keywords?domain=${encodeURIComponent(d)}&countryCode=${country}`),
        apiGet<CompResp>(`/api/spyfu/competitors?domain=${encodeURIComponent(d)}&countryCode=${country}&type=organic`),
      ]);
      if (!r1.ok && r1.error?.toLowerCase().includes("not configured")) { setNoKey(true); setLoading(false); return; }
      if (!r1.ok) { setError(r1.error || "Failed to fetch domain stats"); setLoading(false); return; }
      setNoKey(false);
      setStats(r1.stats || null);
      setOrganicKws(r2.keywords || []);
      setPaidKws(r3.keywords || []);
      setComp(r4.competitors || []);
    } catch(e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  async function fetchCompetitors(type: "organic"|"paid") {
    setCompType(type); setLoading(true);
    try {
      const r = await apiGet<CompResp>(`/api/spyfu/competitors?domain=${encodeURIComponent(domain)}&countryCode=${country}&type=${type}`);
      setComp(r.competitors || []);
    } catch { /* silent */ }
    setLoading(false);
  }

  const flagOf = (k: string) => COUNTRIES.find(c=>c.k===k)?.flag || "🌐";

  return (
    <div className="view-header-wrap">
      {/* ── Page header ── */}
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Compete</span>
                <span className="bc-sep">›</span> SpyFu
              </div>
              <h2 className="view-title">🕵️ SpyFu — Competitor Intelligence</h2>
              <p className="view-sub">Historical PPC budgets, organic keyword rankings, and competitor maps for any domain — data Google doesn&apos;t show you.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop:24, paddingBottom:64 }}>

        {/* ── No-key banner ── */}
        {noKey && (
          <div style={{
            background:"linear-gradient(135deg,#4c1d95,#6d28d9)",
            borderRadius:14, padding:"20px 24px", marginBottom:20, color:"#fff",
            display:"flex", gap:16, alignItems:"flex-start", flexWrap:"wrap",
          }}>
            <div style={{ fontSize:"2rem" }}>🔑</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:"1rem", marginBottom:6 }}>SpyFu API key not configured</div>
              <div style={{ opacity:.85, fontSize:"0.88rem", lineHeight:1.7 }}>
                1. Sign up at <strong>spyfu.com</strong> (paid plan required) &nbsp;·&nbsp;
                2. Go to <strong>Account → API</strong> and copy your key &nbsp;·&nbsp;
                3. Add it as <code style={{ background:"rgba(255,255,255,.15)", padding:"1px 6px", borderRadius:4 }}>SPYFU_API_KEY</code> in <strong>Manage → 🔑 Platform APIs</strong>
              </div>
            </div>
            <a href="https://www.spyfu.com/account/apikey" target="_blank" rel="noreferrer"
              style={{ background:"#fff", color:"#6d28d9", borderRadius:8, padding:"9px 18px", fontWeight:800, fontSize:"0.85rem", textDecoration:"none", whiteSpace:"nowrap", alignSelf:"center" }}>
              Get API key ↗
            </a>
          </div>
        )}

        {/* ── Search card ── */}
        <div style={{
          background:"linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#0c4a6e 100%)",
          borderRadius:16, padding:"28px 28px 24px", marginBottom:24,
          boxShadow:"0 8px 32px rgba(15,23,42,.3)",
        }}>
          <div style={{ color:"rgba(255,255,255,.6)", fontSize:"0.72rem", fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase", marginBottom:16 }}>
            🔍 Intelligence Report
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto", gap:12, alignItems:"flex-end" }}>
            {/* Domain */}
            <div>
              <label style={{ color:"rgba(255,255,255,.7)", fontSize:"0.72rem", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.5px", display:"block", marginBottom:6 }}>
                Domain
              </label>
              <div style={{ position:"relative" }}>
                <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:"0.9rem", pointerEvents:"none" }}>🌐</span>
                <input
                  value={domain}
                  onChange={e => setDomain(e.target.value)}
                  onKeyDown={e => e.key==="Enter" && runSearch()}
                  placeholder="e.g. competitor.com"
                  style={{
                    width:"100%", padding:"11px 12px 11px 36px", borderRadius:9,
                    border:"1.5px solid rgba(255,255,255,.2)",
                    background:"rgba(255,255,255,.1)", color:"#fff",
                    fontSize:"0.92rem", boxSizing:"border-box", outline:"none",
                  }}
                />
              </div>
            </div>

            {/* Country */}
            <div>
              <label style={{ color:"rgba(255,255,255,.7)", fontSize:"0.72rem", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.5px", display:"block", marginBottom:6 }}>
                Country
              </label>
              <select
                value={country}
                onChange={e => setCountry(e.target.value)}
                style={{
                  padding:"11px 14px", borderRadius:9,
                  border:"1.5px solid rgba(255,255,255,.2)",
                  background:"rgba(255,255,255,.1)", color:"#fff",
                  fontSize:"0.88rem", cursor:"pointer", outline:"none", minWidth:160,
                }}
              >
                {COUNTRIES.map(c => <option key={c.k} value={c.k} style={{ background:"#1e3a5f" }}>{c.flag} {c.label}</option>)}
              </select>
            </div>

            {/* Spy button */}
            <button
              onClick={runSearch}
              disabled={loading || !domain.trim()}
              style={{
                padding:"11px 28px", borderRadius:9, border:"none",
                background: loading || !domain.trim()
                  ? "rgba(255,255,255,.2)"
                  : "linear-gradient(135deg,#2563eb,#0ea5e9)",
                color:"#fff", fontWeight:800, fontSize:"0.92rem", cursor: loading || !domain.trim() ? "not-allowed" : "pointer",
                whiteSpace:"nowrap", boxShadow:"0 2px 12px rgba(14,165,233,.4)",
                transition:"opacity .2s",
              }}
            >
              {loading ? "⏳ Scanning…" : `${flagOf(country)} Spy`}
            </button>
          </div>

          {!searched && !loading && (
            <div style={{ marginTop:16, color:"rgba(255,255,255,.45)", fontSize:"0.82rem" }}>
              Enter any domain to reveal their organic + paid search profile, top keywords, and closest competitors.
            </div>
          )}
        </div>

        {/* ── Error ── */}
        {error && (
          <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:10, padding:"12px 16px", color:"#b91c1c", fontSize:"0.87rem", marginBottom:18, display:"flex", gap:10, alignItems:"center" }}>
            <span>⚠️</span> {error}
          </div>
        )}

        {/* ── Loading skeleton ── */}
        {loading && (
          <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, padding:32, textAlign:"center" }}>
            <div style={{ fontSize:"2.5rem", marginBottom:12 }}>🕵️</div>
            <div style={{ fontWeight:700, color:"#0f172a", marginBottom:6 }}>Pulling intelligence on {domain}…</div>
            <div style={{ color:"#64748b", fontSize:"0.85rem" }}>Fetching PPC budgets, organic rankings, and competitor data</div>
            <div style={{ display:"flex", gap:6, justifyContent:"center", marginTop:20 }}>
              {[0,1,2].map(i => (
                <div key={i} style={{
                  width:8, height:8, borderRadius:"50%",
                  background: i===0?"#2563eb":i===1?"#0ea5e9":"#7c3aed",
                  animation:`pulse ${0.6+i*0.2}s ease-in-out infinite alternate`,
                }} />
              ))}
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {stats && !loading && (
          <>
            {/* KPI cards */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginBottom:24 }}>
              {[
                { label:"Organic Keywords", value:fmtNum(stats.organicKeywords),      grad:"linear-gradient(135deg,#0ea5e9,#2563eb)", icon:"🔍" },
                { label:"Paid Keywords",    value:fmtNum(stats.paidKeywords),          grad:"linear-gradient(135deg,#7c3aed,#a855f7)", icon:"💳" },
                { label:"SEO Clicks/mo",    value:fmtNum(stats.monthlyOrganicClicks),  grad:"linear-gradient(135deg,#059669,#10b981)", icon:"📈" },
                { label:"PPC Clicks/mo",    value:fmtNum(stats.monthlyPaidClicks),     grad:"linear-gradient(135deg,#d97706,#f59e0b)", icon:"🖱️" },
                { label:"SEO Value/mo",     value:fmtMoney(stats.totalMonthlyValue),   grad:"linear-gradient(135deg,#0d9488,#14b8a6)", icon:"💎" },
                { label:"PPC Budget/mo",    value:fmtMoney(stats.monthlyBudget),       grad:"linear-gradient(135deg,#dc2626,#ef4444)", icon:"💰" },
              ].map(m => (
                <div key={m.label} style={{
                  background:m.grad, borderRadius:12, padding:"16px 18px", color:"#fff",
                  boxShadow:"0 4px 16px rgba(0,0,0,.12)",
                }}>
                  <div style={{ fontSize:"1.3rem", marginBottom:6 }}>{m.icon}</div>
                  <div style={{ fontSize:"0.68rem", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.5px", opacity:.8, marginBottom:4 }}>{m.label}</div>
                  <div style={{ fontSize:"1.7rem", fontWeight:900, lineHeight:1 }}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div style={{ display:"flex", gap:4, marginBottom:20, background:"#f8fafc", borderRadius:10, padding:4, width:"fit-content" }}>
              {([
                { id:"overview",     icon:"🏠", label:"Overview"     },
                { id:"organic",      icon:"🔍", label:"Organic"      },
                { id:"paid",         icon:"💳", label:"Paid"         },
                { id:"competitors",  icon:"🏆", label:"Competitors"  },
              ] as const).map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  padding:"8px 18px", borderRadius:8, border:"none", cursor:"pointer",
                  background: tab===t.id ? "#fff" : "transparent",
                  color: tab===t.id ? "#1e3a5f" : "#64748b",
                  fontWeight: tab===t.id ? 800 : 600,
                  fontSize:"0.84rem",
                  boxShadow: tab===t.id ? "0 1px 4px rgba(0,0,0,.12)" : "none",
                  transition:"all .15s",
                }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {tab==="overview"     && <OverviewTab stats={stats} domain={domain} />}
            {tab==="organic"      && <KwTable rows={organicKws} type="organic" />}
            {tab==="paid"         && <KwTable rows={paidKws}    type="paid"    />}
            {tab==="competitors"  && <CompTab competitors={competitors} compType={compType} onSwitch={fetchCompetitors} loading={loading} />}
          </>
        )}
      </div>
    </div>
  );
}

function OverviewTab({ stats, domain }: { stats: DomainStats; domain: string }) {
  const ratio = stats.organicKeywords && stats.paidKeywords
    ? (stats.organicKeywords / Math.max(stats.paidKeywords, 1)).toFixed(1) : null;
  const orgPct = stats.organicKeywords && stats.paidKeywords
    ? Math.round((stats.organicKeywords / (stats.organicKeywords + stats.paidKeywords)) * 100) : 50;

  const signal = (stats.monthlyBudget ?? 0) > 10000
    ? { text:"Heavy PPC spender — monitor their ad copy and landing pages closely.", color:"#dc2626", icon:"🔥" }
    : (stats.monthlyBudget ?? 0) > 0
    ? { text:"Moderate PPC investment — they&apos;re actively testing paid channels.", color:"#d97706", icon:"⚡" }
    : { text:"Organic-first strategy — SEO is their main growth lever.", color:"#059669", icon:"🌱" };

  return (
    <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
      {/* SEO vs PPC balance */}
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, padding:"22px 24px", flex:"1 1 320px", boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
        <div style={{ fontWeight:800, color:"#0f172a", marginBottom:16, fontSize:"0.96rem" }}>📊 {domain} — Channel balance</div>
        <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.8rem", fontWeight:600, color:"#64748b", marginBottom:6 }}>
            <span>🔵 Organic ({orgPct}%)</span>
            <span>🟣 Paid ({100-orgPct}%)</span>
          </div>
          <div style={{ display:"flex", height:10, borderRadius:10, overflow:"hidden", background:"#f1f5f9" }}>
            <div style={{ width:`${orgPct}%`, background:"linear-gradient(90deg,#0ea5e9,#2563eb)", transition:"width .5s" }} />
            <div style={{ flex:1,            background:"linear-gradient(90deg,#7c3aed,#a855f7)" }} />
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {[
            { label:"Organic/Paid ratio", value: ratio ? `${ratio}:1` : "—" },
            { label:"Avg. organic rank",  value: stats.averageOrganicRank ? `#${Number(stats.averageOrganicRank).toFixed(1)}` : "—" },
            { label:"Domain strength",    value: stats.strength != null ? `${stats.strength}/100` : "—" },
          ].map(r => (
            <div key={r.label} style={{ background:"#f8fafc", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:"0.7rem", color:"#94a3b8", fontWeight:700, textTransform:"uppercase", marginBottom:3 }}>{r.label}</div>
              <div style={{ fontSize:"1.1rem", fontWeight:800, color:"#0f172a" }}>{r.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Strategy signal */}
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, padding:"22px 24px", flex:"1 1 240px", boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
        <div style={{ fontWeight:800, color:"#0f172a", marginBottom:14, fontSize:"0.96rem" }}>💡 Strategy signal</div>
        <div style={{
          background:`${signal.color}11`, border:`1.5px solid ${signal.color}33`,
          borderRadius:10, padding:"14px 16px", display:"flex", gap:12, alignItems:"flex-start",
        }}>
          <span style={{ fontSize:"1.5rem" }}>{signal.icon}</span>
          <div style={{ fontSize:"0.88rem", color:"#334155", lineHeight:1.7 }}>
            {signal.text}
            {(stats.organicKeywords ?? 0) > 5000 && <><br /><strong>Strong content moat</strong> with broad keyword coverage.</>}
          </div>
        </div>
      </div>
    </div>
  );
}

function KwTable({ rows, type }: { rows: KwRow[]; type:"organic"|"paid" }) {
  if (!rows.length) return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, padding:"48px 32px", textAlign:"center", color:"#94a3b8" }}>
      <div style={{ fontSize:"2rem", marginBottom:10 }}>{type==="organic"?"🔍":"💳"}</div>
      <div style={{ fontWeight:600 }}>No {type} keyword data found for this domain.</div>
    </div>
  );
  return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.86rem" }}>
        <thead>
          <tr style={{ background:"linear-gradient(90deg,#f8fafc,#f1f5f9)", borderBottom:"2px solid #e2e8f0" }}>
            <th style={{ textAlign:"left",  padding:"12px 16px", fontWeight:800, color:"#475569" }}>Keyword</th>
            <th style={{ textAlign:"right", padding:"12px 16px", fontWeight:800, color:"#475569" }}>Volume</th>
            <th style={{ textAlign:"right", padding:"12px 16px", fontWeight:800, color:"#475569" }}>{type==="organic"?"Rank":"CPC"}</th>
            <th style={{ textAlign:"right", padding:"12px 16px", fontWeight:800, color:"#475569" }}>Clicks</th>
            <th style={{ textAlign:"right", padding:"12px 16px", fontWeight:800, color:"#475569" }}>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom:"1px solid #f1f5f9", background: i%2===0?"#fff":"#fafbfc" }}>
              <td style={{ padding:"10px 16px", color:"#1e293b", fontWeight:600 }}>
                {r.keyword}
                {r.isNewToTop10 && (
                  <span style={{ marginLeft:7, background:"#dcfce7", color:"#15803d", borderRadius:6, padding:"1px 7px", fontSize:"0.7rem", fontWeight:700 }}>↑ New</span>
                )}
              </td>
              <td style={{ padding:"10px 16px", textAlign:"right", color:"#64748b" }}>{fmtNum(r.searchVolume)}</td>
              <td style={{ padding:"10px 16px", textAlign:"right" }}>
                {type==="organic"
                  ? <span style={{
                      fontWeight:800,
                      color: (r.rank??99)<=3 ? "#059669" : (r.rank??99)<=10 ? "#d97706" : "#64748b",
                      background: (r.rank??99)<=3 ? "#dcfce7" : (r.rank??99)<=10 ? "#fef3c7" : "transparent",
                      padding:"2px 7px", borderRadius:6,
                    }}>#{r.rank ?? "—"}</span>
                  : <span style={{ color:"#7c3aed", fontWeight:700 }}>${r.costPerClick?.toFixed(2) ?? "—"}</span>
                }
              </td>
              <td style={{ padding:"10px 16px", textAlign:"right", color:"#64748b" }}>{fmtNum(r.clicks)}</td>
              <td style={{ padding:"10px 16px", textAlign:"right", fontWeight:700, color:"#059669" }}>{fmtMoney(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompTab({ competitors, compType, onSwitch, loading }: {
  competitors: CompRow[]; compType:"organic"|"paid";
  onSwitch:(t:"organic"|"paid")=>void; loading:boolean;
}) {
  return (
    <div>
      <div style={{ display:"flex", gap:6, marginBottom:16 }}>
        {(["organic","paid"] as const).map(t => (
          <button key={t} onClick={() => onSwitch(t)} style={{
            padding:"8px 18px", borderRadius:20, border:"1.5px solid",
            borderColor: compType===t ? "#2563eb" : "#e2e8f0",
            background: compType===t ? "linear-gradient(135deg,#2563eb,#0ea5e9)" : "#fff",
            color: compType===t ? "#fff" : "#64748b",
            fontWeight:700, fontSize:"0.84rem", cursor:"pointer",
            boxShadow: compType===t ? "0 2px 8px rgba(37,99,235,.3)" : "none",
          }}>
            {t==="organic" ? "🔍 Organic" : "💳 Paid"} competitors
          </button>
        ))}
      </div>
      {loading && (
        <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, padding:32, textAlign:"center", color:"#94a3b8" }}>
          Loading…
        </div>
      )}
      {!loading && (
        <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.87rem" }}>
            <thead>
              <tr style={{ background:"linear-gradient(90deg,#f8fafc,#f1f5f9)", borderBottom:"2px solid #e2e8f0" }}>
                <th style={{ textAlign:"left",  padding:"12px 16px", fontWeight:800, color:"#475569" }}>#</th>
                <th style={{ textAlign:"left",  padding:"12px 16px", fontWeight:800, color:"#475569" }}>Domain</th>
                <th style={{ textAlign:"right", padding:"12px 16px", fontWeight:800, color:"#475569" }}>Common Keywords</th>
              </tr>
            </thead>
            <tbody>
              {competitors.map((c, i) => (
                <tr key={i} style={{ borderBottom:"1px solid #f1f5f9", background:i%2===0?"#fff":"#fafbfc" }}>
                  <td style={{ padding:"10px 16px", color:"#94a3b8", fontWeight:800 }}>{i+1}</td>
                  <td style={{ padding:"10px 16px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{
                        width:28, height:28, borderRadius:7, background:"linear-gradient(135deg,#e0e7ff,#dbeafe)",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:"0.75rem", fontWeight:800, color:"#2563eb",
                      }}>
                        {(c.domain||"?")[0].toUpperCase()}
                      </div>
                      <a href={`https://${c.domain}`} target="_blank" rel="noreferrer"
                        style={{ color:"#2563eb", fontWeight:700, textDecoration:"none", fontSize:"0.9rem" }}>
                        {c.domain}
                      </a>
                    </div>
                  </td>
                  <td style={{ padding:"10px 16px", textAlign:"right" }}>
                    <span style={{ background:"#eff6ff", color:"#2563eb", borderRadius:8, padding:"3px 10px", fontWeight:700, fontSize:"0.82rem" }}>
                      {fmtNum(c.commonKeywords)}
                    </span>
                  </td>
                </tr>
              ))}
              {!competitors.length && (
                <tr><td colSpan={3} style={{ padding:"40px 32px", textAlign:"center", color:"#94a3b8" }}>
                  <div style={{ fontSize:"1.8rem", marginBottom:8 }}>🏆</div>
                  No competitors found for this domain.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

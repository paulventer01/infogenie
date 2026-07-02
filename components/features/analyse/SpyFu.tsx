"use client";

// SpyFu — competitor PPC + SEO spy intelligence.
// Shows domain overview (organic/paid keyword counts, SEO value, PPC budget),
// top organic + paid keywords, and organic/paid competitor lists.
// Requires SPYFU_API_KEY via Manage → 🔑 Platform APIs.

import { useState } from "react";
import { apiGet } from "@/lib/api";

interface DomainStats {
  organicKeywords?: number; paidKeywords?: number;
  monthlyOrganicClicks?: number; monthlyPaidClicks?: number;
  totalMonthlyValue?: number; monthlyBudget?: number;
  averageOrganicRank?: number; strength?: number;
  [k: string]: unknown;
}
interface DomainResp { ok: boolean; domain?: string; stats?: DomainStats; error?: string; }

interface KwRow {
  keyword?: string; searchVolume?: number; rank?: number;
  clicks?: number; costPerClick?: number; value?: number;
  isNewToTop10?: boolean; [k: string]: unknown;
}
interface KwResp { ok: boolean; keywords?: KwRow[]; totalRows?: number; error?: string; }

interface CompRow { domain?: string; commonKeywords?: number; [k: string]: unknown; }
interface CompResp { ok: boolean; competitors?: CompRow[]; error?: string; }

const COUNTRIES = [
  { k:"US",label:"United States"},{ k:"GB",label:"United Kingdom"},
  { k:"CA",label:"Canada"},{ k:"AU",label:"Australia"},
  { k:"DE",label:"Germany"},{ k:"FR",label:"France"},
  { k:"IN",label:"India"},{ k:"ES",label:"Spain"},
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

function SetupPrompt() {
  return (
    <div className="container" style={{ paddingTop: 32 }}>
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, padding:36, maxWidth:520 }}>
        <div style={{ fontSize:"2rem", marginBottom:10 }}>🕵️</div>
        <div style={{ fontWeight:700, fontSize:"1.05rem", marginBottom:8 }}>SpyFu API key not configured</div>
        <div style={{ color:"#64748b", fontSize:"0.88rem", marginBottom:18 }}>
          To connect SpyFu:
          <ol style={{ paddingLeft:20, marginTop:8, lineHeight:1.8 }}>
            <li>Sign up at <strong>spyfu.com</strong> (paid plan required for API access)</li>
            <li>Go to <strong>Account → API</strong> and copy your API key</li>
            <li>Add it as <code>SPYFU_API_KEY</code> in <strong>Manage → 🔑 Platform APIs</strong></li>
          </ol>
        </div>
        <a href="https://www.spyfu.com/account/apikey" target="_blank" rel="noreferrer"
          style={{ display:"inline-block", padding:"9px 18px", background:"#7c3aed", color:"#fff", borderRadius:8, fontWeight:700, fontSize:"0.88rem", textDecoration:"none" }}>
          Get SpyFu API key ↗
        </a>
      </div>
    </div>
  );
}

export default function SpyFu() {
  const [configured]   = useState<boolean>(true); // setup prompt shown inline if key absent
  const [domain, setDomain]       = useState("");
  const [country, setCountry]     = useState("US");
  const [tab, setTab]             = useState<"overview"|"organic"|"paid"|"competitors">("overview");
  const [compType, setCompType]   = useState<"organic"|"paid">("organic");

  const [stats, setStats]         = useState<DomainStats|null>(null);
  const [organicKws, setOrganicKws] = useState<KwRow[]>([]);
  const [paidKws, setPaidKws]     = useState<KwRow[]>([]);
  const [competitors, setCompetitors] = useState<CompRow[]>([]);

  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [noKey, setNoKey]         = useState(false);
  const [searched, setSearched]   = useState(false);

  async function runSearch() {
    if (!domain.trim()) return;
    setLoading(true); setError(""); setSearched(true);
    try {
      // fetch all four in parallel
      const [r1, r2, r3, r4] = await Promise.all([
        apiGet<DomainResp>(`/api/spyfu/domain?domain=${encodeURIComponent(domain)}&countryCode=${country}`),
        apiGet<KwResp>(`/api/spyfu/organic-keywords?domain=${encodeURIComponent(domain)}&countryCode=${country}`),
        apiGet<KwResp>(`/api/spyfu/paid-keywords?domain=${encodeURIComponent(domain)}&countryCode=${country}`),
        apiGet<CompResp>(`/api/spyfu/competitors?domain=${encodeURIComponent(domain)}&countryCode=${country}&type=organic`),
      ]);
      if (!r1.ok && r1.error?.includes('not configured')) { setNoKey(true); return; }
      if (!r1.ok) throw new Error(r1.error || "Failed to fetch domain stats");
      setStats(r1.stats || null);
      setOrganicKws(r2.keywords || []);
      setPaidKws(r3.keywords || []);
      setCompetitors(r4.competitors || []);
    } catch(e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  async function fetchCompetitors(type: "organic"|"paid") {
    setCompType(type); setLoading(true);
    try {
      const r = await apiGet<CompResp>(`/api/spyfu/competitors?domain=${encodeURIComponent(domain)}&countryCode=${country}&type=${type}`);
      setCompetitors(r.competitors || []);
    } catch {}
    setLoading(false);
  }

  if (noKey) return (
    <div className="view-header-wrap"><div className="view-header"><div className="container"><div className="vh-inner"><div>
      <h2 className="view-title">🕵️ SpyFu — Competitor Intelligence</h2>
    </div></div></div></div>
    <SetupPrompt />
    </div>
  );

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb"><span className="bc-group">Compete</span> <span className="bc-sep">›</span> SpyFu</div>
              <h2 className="view-title">🕵️ SpyFu — Competitor Intelligence</h2>
              <p className="view-sub">Historical PPC budgets, organic keyword rankings, and competitor maps for any domain — data Google doesn&apos;t show you.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop:20, paddingBottom:56 }}>

        {/* Search bar */}
        <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap", alignItems:"flex-end" }}>
          <div style={{ flex:"1 1 280px" }}>
            <label style={{ fontSize:"0.8rem", color:"#64748b", fontWeight:600, display:"block", marginBottom:4 }}>Domain</label>
            <input className="form-control" value={domain} onChange={e => setDomain(e.target.value)}
              placeholder="e.g. competitor.com" onKeyDown={e => e.key==="Enter" && runSearch()} />
          </div>
          <div>
            <label style={{ fontSize:"0.8rem", color:"#64748b", fontWeight:600, display:"block", marginBottom:4 }}>Country</label>
            <select className="form-control" value={country} onChange={e => setCountry(e.target.value)}>
              {COUNTRIES.map(c => <option key={c.k} value={c.k}>{c.label}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={runSearch} disabled={loading || !domain.trim()}>
            {loading ? "Loading…" : "🔍 Spy"}
          </button>
        </div>

        {error && <div style={{ background:"#fee2e2", border:"1px solid #fecaca", borderRadius:8, padding:"10px 14px", color:"#b91c1c", fontSize:"0.86rem", marginBottom:14 }}>{error}</div>}

        {!searched && !loading && (
          <div style={{ padding:"40px 0", textAlign:"center", color:"#94a3b8", fontSize:"0.88rem" }}>
            Enter a competitor&apos;s domain to see their SEO + PPC profile.
          </div>
        )}

        {stats && (
          <>
            {/* Overview KPI cards */}
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:20 }}>
              {[
                { label:"Organic Keywords",  value: fmtNum(stats.organicKeywords),     color:"#0ea5e9", icon:"🔍" },
                { label:"Paid Keywords",     value: fmtNum(stats.paidKeywords),        color:"#7c3aed", icon:"💳" },
                { label:"Monthly SEO Clicks",value: fmtNum(stats.monthlyOrganicClicks),color:"#16a34a", icon:"📈" },
                { label:"Monthly PPC Clicks",value: fmtNum(stats.monthlyPaidClicks),   color:"#f59e0b", icon:"🖱️" },
                { label:"SEO Value/mo",      value: fmtMoney(stats.totalMonthlyValue), color:"#10b981", icon:"💎" },
                { label:"PPC Budget/mo",     value: fmtMoney(stats.monthlyBudget),     color:"#ef4444", icon:"💰" },
              ].map(m => (
                <div key={m.label} style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, padding:"14px 18px", flex:"1 1 150px", minWidth:130 }}>
                  <div style={{ fontSize:"1.2rem", marginBottom:4 }}>{m.icon}</div>
                  <div style={{ color:"#64748b", fontSize:"0.74rem", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.4px", marginBottom:4 }}>{m.label}</div>
                  <div style={{ fontSize:"1.6rem", fontWeight:800, color:m.color }}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div style={{ display:"flex", gap:4, marginBottom:16, borderBottom:"2px solid #e2e8f0" }}>
              {(["overview","organic","paid","competitors"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding:"8px 16px", border:0, background:"none", cursor:"pointer",
                  fontWeight: tab===t ? 700 : 500,
                  color: tab===t ? "#7c3aed" : "#64748b",
                  borderBottom: tab===t ? "2px solid #7c3aed" : "2px solid transparent",
                  marginBottom:-2, fontSize:"0.88rem",
                }}>
                  {t==="overview" ? "🏠 Overview" : t==="organic" ? "🔍 Organic Keywords" : t==="paid" ? "💳 Paid Keywords" : "🏆 Competitors"}
                </button>
              ))}
            </div>

            {tab === "overview" && <OverviewTab stats={stats} domain={domain} />}
            {tab === "organic" && <KwTable rows={organicKws} type="organic" />}
            {tab === "paid"    && <KwTable rows={paidKws}    type="paid" />}
            {tab === "competitors" && (
              <CompTab competitors={competitors} compType={compType} onSwitch={fetchCompetitors} loading={loading} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OverviewTab({ stats, domain }: { stats: DomainStats; domain: string }) {
  const ratio = stats.organicKeywords && stats.paidKeywords
    ? (stats.organicKeywords / Math.max(stats.paidKeywords, 1)).toFixed(1)
    : null;
  return (
    <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, padding:"18px 20px", flex:"1 1 320px" }}>
        <div style={{ fontWeight:700, marginBottom:12 }}>📊 {domain} — SEO vs PPC balance</div>
        <div style={{ fontSize:"0.86rem", color:"#334155", lineHeight:1.9 }}>
          <div>Organic / Paid keyword ratio: <strong>{ratio ? `${ratio}:1` : "—"}</strong></div>
          <div>Avg. organic rank: <strong>{stats.averageOrganicRank ? `#${Number(stats.averageOrganicRank).toFixed(1)}` : "—"}</strong></div>
          <div>Domain strength: <strong>{stats.strength ?? "—"}{stats.strength ? "/100" : ""}</strong></div>
        </div>
        {ratio && (
          <div style={{ marginTop:14 }}>
            <div style={{ display:"flex", gap:0, height:8, borderRadius:8, overflow:"hidden" }}>
              <div style={{ flex: stats.organicKeywords || 1, background:"#0ea5e9" }} />
              <div style={{ flex: stats.paidKeywords || 1,   background:"#7c3aed" }} />
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.74rem", color:"#94a3b8", marginTop:4 }}>
              <span>🔵 Organic</span><span>🟣 Paid</span>
            </div>
          </div>
        )}
      </div>
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, padding:"18px 20px", flex:"1 1 240px" }}>
        <div style={{ fontWeight:700, marginBottom:12 }}>💡 Quick read</div>
        <div style={{ fontSize:"0.84rem", color:"#334155", lineHeight:1.8 }}>
          {(stats.monthlyBudget ?? 0) > 10000
            ? "Heavy PPC spender — monitor their ad copy and landing pages closely."
            : (stats.monthlyBudget ?? 0) > 0
            ? "Moderate PPC investment — they're testing paid channels."
            : "Organic-first strategy — SEO is their main growth lever."}
          {(stats.organicKeywords ?? 0) > 5000 && " Strong content moat with broad keyword coverage."}
        </div>
      </div>
    </div>
  );
}

function KwTable({ rows, type }: { rows: KwRow[]; type:"organic"|"paid" }) {
  if (!rows.length) return (
    <div style={{ padding:40, textAlign:"center", color:"#94a3b8" }}>No {type} keyword data found for this domain.</div>
  );
  return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, overflow:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.86rem" }}>
        <thead>
          <tr style={{ background:"#f8fafc", borderBottom:"2px solid #e2e8f0" }}>
            <th style={{ textAlign:"left", padding:"10px 14px", fontWeight:700 }}>Keyword</th>
            <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>Volume</th>
            {type==="organic"
              ? <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>Rank</th>
              : <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>CPC</th>}
            <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>Clicks</th>
            <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom:"1px solid #f1f5f9" }}>
              <td style={{ padding:"8px 14px", color:"#334155" }}>
                {r.keyword}
                {r.isNewToTop10 && <span style={{ marginLeft:6, background:"#dcfce7", color:"#15803d", borderRadius:6, padding:"1px 6px", fontSize:"0.72rem", fontWeight:700 }}>New</span>}
              </td>
              <td style={{ padding:"8px 14px", textAlign:"right" }}>{fmtNum(r.searchVolume)}</td>
              <td style={{ padding:"8px 14px", textAlign:"right" }}>
                {type==="organic"
                  ? <span style={{ color: (r.rank??99)<=3?"#16a34a":(r.rank??99)<=10?"#ca8a04":"#64748b", fontWeight:700 }}>#{r.rank}</span>
                  : <span>${r.costPerClick?.toFixed(2) ?? "—"}</span>}
              </td>
              <td style={{ padding:"8px 14px", textAlign:"right" }}>{fmtNum(r.clicks)}</td>
              <td style={{ padding:"8px 14px", textAlign:"right" }}>{fmtMoney(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompTab({ competitors, compType, onSwitch, loading }: { competitors: CompRow[]; compType:"organic"|"paid"; onSwitch:(t:"organic"|"paid")=>void; loading:boolean }) {
  return (
    <div>
      <div style={{ display:"flex", gap:6, marginBottom:14 }}>
        {(["organic","paid"] as const).map(t => (
          <button key={t} onClick={() => onSwitch(t)} style={{
            padding:"6px 14px", borderRadius:20, border:"1.5px solid",
            borderColor: compType===t ? "#7c3aed" : "#e2e8f0",
            background: compType===t ? "#f5f3ff" : "#fff",
            color: compType===t ? "#7c3aed" : "#64748b",
            fontWeight: compType===t ? 700 : 500, fontSize:"0.82rem", cursor:"pointer",
          }}>
            {t==="organic" ? "🔍 Organic" : "💳 Paid"} competitors
          </button>
        ))}
      </div>
      {loading && <div style={{ textAlign:"center", padding:32, color:"#94a3b8" }}>Loading…</div>}
      {!loading && (
        <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, overflow:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.86rem" }}>
            <thead>
              <tr style={{ background:"#f8fafc", borderBottom:"2px solid #e2e8f0" }}>
                <th style={{ textAlign:"left", padding:"10px 14px", fontWeight:700 }}>#</th>
                <th style={{ textAlign:"left", padding:"10px 14px", fontWeight:700 }}>Domain</th>
                <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>Common Keywords</th>
              </tr>
            </thead>
            <tbody>
              {competitors.map((c, i) => (
                <tr key={i} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"8px 14px", color:"#94a3b8", fontWeight:700 }}>{i+1}</td>
                  <td style={{ padding:"8px 14px" }}>
                    <a href={`https://${c.domain}`} target="_blank" rel="noreferrer"
                      style={{ color:"#7c3aed", fontWeight:600, textDecoration:"none" }}>{c.domain}</a>
                  </td>
                  <td style={{ padding:"8px 14px", textAlign:"right" }}>{fmtNum(c.commonKeywords)}</td>
                </tr>
              ))}
              {!competitors.length && (
                <tr><td colSpan={3} style={{ padding:32, textAlign:"center", color:"#94a3b8" }}>No competitors found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

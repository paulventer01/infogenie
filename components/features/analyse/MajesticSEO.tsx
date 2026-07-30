"use client";

// Majestic SEO — Trust Flow, Citation Flow, Topical Trust Flow, backlinks,
// referring domains, and anchor text analysis. Uses the OpenApps free tier
// (1000 req/day, Fresh Index only).
// Requires MAJESTIC_API_KEY via Manage → 🔑 Platform APIs.

import { useState } from "react";
import { apiGet } from "@/lib/api";

interface TopicalTF { topic: string; value: number; }
interface Metrics {
  trustFlow: number|null; citationFlow: number|null;
  refDomains: number|null; extBackLinks: number|null;
  refIPs: number|null; indexedUrls: number|null;
  deletedBackLinks: number|null;
  topicalTF: TopicalTF[];
}
interface ItemResp { ok: boolean; url?: string; metrics?: Metrics; error?: string; }

interface BacklinkRow { SourceURL?:string; AnchorText?:string; TrustFlow?:number; CitationFlow?:number; FlagRedirect?:number; FlagNoFollow?:number; [k:string]:unknown; }
interface BLResp { ok:boolean; backlinks?:BacklinkRow[]; total?:number; error?:string; }

interface AnchorRow { AnchorText?:string; TotalLinks?:number; DeletedLinks?:number; [k:string]:unknown; }
interface AnchorResp { ok:boolean; anchors?:AnchorRow[]; error?:string; }

interface RefDomainRow { RefDomain?:string; TrustFlow?:number; CitationFlow?:number; TotalBackLinks?:number; [k:string]:unknown; }
interface RDResp { ok:boolean; refDomains?:RefDomainRow[]; error?:string; }

function fmtNum(n:number|null|undefined) {
  if (n==null) return "—";
  if (n>=1_000_000) return (n/1_000_000).toFixed(1)+"M";
  if (n>=1_000) return (n/1_000).toFixed(1)+"k";
  return String(n);
}

function TFBar({ tf, cf }: { tf:number|null; cf:number|null }) {
  const t = tf ?? 0, c = cf ?? 0, mx = 100;
  return (
    <div style={{ marginTop:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.75rem", color:"#64748b", marginBottom:3 }}>
        <span>Trust Flow</span><span style={{ fontWeight:700, color:"#0ea5e9" }}>{t}</span>
      </div>
      <div style={{ background:"#e2e8f0", borderRadius:6, height:8, marginBottom:8 }}>
        <div style={{ width:`${(t/mx)*100}%`, background:"#0ea5e9", height:"100%", borderRadius:6 }} />
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.75rem", color:"#64748b", marginBottom:3 }}>
        <span>Citation Flow</span><span style={{ fontWeight:700, color:"#8b5cf6" }}>{c}</span>
      </div>
      <div style={{ background:"#e2e8f0", borderRadius:6, height:8 }}>
        <div style={{ width:`${(c/mx)*100}%`, background:"#8b5cf6", height:"100%", borderRadius:6 }} />
      </div>
    </div>
  );
}

function SetupPrompt() {
  return (
    <div className="container" style={{ paddingTop:32 }}>
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, padding:36, maxWidth:540 }}>
        <div style={{ fontSize:"2rem", marginBottom:10 }}>🔗</div>
        <div style={{ fontWeight:700, fontSize:"1.05rem", marginBottom:8 }}>Majestic API key not configured</div>
        <div style={{ color:"#64748b", fontSize:"0.88rem", marginBottom:6 }}>
          Majestic offers a <strong>free OpenApps tier</strong> — 1,000 requests/day on the Fresh Index, no subscription required.
        </div>
        <div style={{ color:"#64748b", fontSize:"0.88rem", marginBottom:18 }}>
          <ol style={{ paddingLeft:20, marginTop:8, lineHeight:1.8 }}>
            <li>Create a free account at <strong>majestic.com</strong></li>
            <li>Go to <strong>Account → API → OpenApp keys</strong></li>
            <li>Generate an OpenApps key and copy it</li>
            <li>Add it as <code>MAJESTIC_API_KEY</code> in <strong>Manage → 🔑 Platform APIs</strong></li>
          </ol>
        </div>
        <a href="https://majestic.com/account/api-key" target="_blank" rel="noreferrer"
          style={{ display:"inline-block", padding:"9px 18px", background:"#dc2626", color:"#fff", borderRadius:8, fontWeight:700, fontSize:"0.88rem", textDecoration:"none" }}>
          Get Majestic API key (free) ↗
        </a>
      </div>
    </div>
  );
}

export default function MajesticSEO() {
  const [url, setUrl]         = useState("");
  const [datasource, setDs]   = useState<"fresh"|"historic">("fresh");
  const [tab, setTab]         = useState<"overview"|"backlinks"|"refdomains"|"anchors">("overview");

  const [metrics, setMetrics] = useState<Metrics|null>(null);
  const [backlinks, setBacklinks]   = useState<BacklinkRow[]>([]);
  const [refDomains, setRefDomains] = useState<RefDomainRow[]>([]);
  const [anchors, setAnchors]       = useState<AnchorRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [noKey, setNoKey]     = useState(false);
  const [searched, setSearched] = useState(false);

  async function runSearch() {
    if (!url.trim()) return;
    setLoading(true); setError(""); setSearched(true);
    try {
      const enc = encodeURIComponent(url.trim());
      const ds  = `datasource=${datasource}`;
      const [r1, r2, r3, r4] = await Promise.all([
        apiGet<ItemResp>(`/api/majestic/item?url=${enc}&${ds}`),
        apiGet<BLResp>(`/api/majestic/backlinks?url=${enc}&${ds}&count=25`),
        apiGet<RDResp>(`/api/majestic/ref-domains?url=${enc}&${ds}&count=25`),
        apiGet<AnchorResp>(`/api/majestic/anchors?url=${enc}&${ds}&count=25`),
      ]);
      if (!r1.ok && r1.error?.includes('not configured')) { setNoKey(true); return; }
      if (!r1.ok) throw new Error(r1.error || "Failed to fetch");
      setMetrics(r1.metrics || null);
      setBacklinks(r2.backlinks || []);
      setRefDomains(r3.refDomains || []);
      setAnchors(r4.anchors || []);
    } catch(e:unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  if (noKey) return (
    <div className="view-header-wrap"><div className="view-header ig-panel-hero"><div className="container"><div className="vh-inner"><div>
      <h2 className="view-title">🔗 Majestic — Backlink Authority</h2>
    </div></div></div></div>
    <SetupPrompt />
    </div>
  );

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb"><span className="bc-group">SEO</span> <span className="bc-sep">›</span> Backlinks</div>
              <h2 className="view-title">🔗 Majestic — Backlink Authority</h2>
              <p className="view-sub">
                Industry-standard Trust Flow &amp; Citation Flow scores, Topical Trust Flow categories, backlink records, and referring domain profiles.
                {" "}<span style={{ fontSize:"0.78rem", color:"#94a3b8" }}>Powered by Majestic OpenApps (free tier, Fresh Index)</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop:20, paddingBottom:56 }}>

        {/* Search bar */}
        <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap", alignItems:"flex-end" }}>
          <div style={{ flex:"1 1 280px" }}>
            <label style={{ fontSize:"0.8rem", color:"#64748b", fontWeight:600, display:"block", marginBottom:4 }}>Domain or URL</label>
            <input className="form-control" value={url} onChange={e => setUrl(e.target.value)}
              placeholder="e.g. competitor.com or competitor.com/page" onKeyDown={e => e.key==="Enter" && runSearch()} />
          </div>
          <div>
            <label style={{ fontSize:"0.8rem", color:"#64748b", fontWeight:600, display:"block", marginBottom:4 }}>Index</label>
            <div style={{ display:"flex", gap:4 }}>
              {(["fresh","historic"] as const).map(ds => (
                <button key={ds} onClick={() => setDs(ds)} style={{
                  padding:"7px 14px", borderRadius:6, border:"1.5px solid",
                  borderColor: datasource===ds ? "#dc2626" : "#e2e8f0",
                  background: datasource===ds ? "#fef2f2" : "#fff",
                  color: datasource===ds ? "#dc2626" : "#64748b",
                  fontWeight: datasource===ds ? 700 : 500, fontSize:"0.82rem", cursor:"pointer",
                  textTransform:"capitalize",
                }}>{ds}</button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" onClick={runSearch} disabled={loading || !url.trim()}
            style={{ background:"#dc2626", borderColor:"#dc2626" }}>
            {loading ? "Loading…" : "🔍 Analyse"}
          </button>
        </div>

        {error && <div style={{ background:"#fee2e2", border:"1px solid #fecaca", borderRadius:8, padding:"10px 14px", color:"#b91c1c", fontSize:"0.86rem", marginBottom:14 }}>{error}</div>}

        {!searched && !loading && (
          <div style={{ padding:"40px 0", textAlign:"center", color:"#94a3b8", fontSize:"0.88rem" }}>
            Enter any domain or URL to see its Trust Flow, Citation Flow, and backlink profile.
          </div>
        )}

        {metrics && (
          <>
            {/* KPI cards */}
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:20 }}>
              {[
                { label:"Trust Flow",       value: metrics.trustFlow ?? "—",     color:"#0ea5e9", tip:"Editorial quality of links (0–100)" },
                { label:"Citation Flow",    value: metrics.citationFlow ?? "—",  color:"#8b5cf6", tip:"Volume of links pointing to this site (0–100)" },
                { label:"TF/CF Ratio",      value: (metrics.trustFlow && metrics.citationFlow) ? (metrics.trustFlow / metrics.citationFlow).toFixed(2) : "—", color:"#16a34a", tip:">0.5 = high quality, <0.2 = spammy" },
                { label:"Ref. Domains",     value: fmtNum(metrics.refDomains),   color:"#f59e0b", tip:"Unique domains linking in" },
                { label:"Backlinks",        value: fmtNum(metrics.extBackLinks), color:"#334155", tip:"Total external backlinks" },
                { label:"Ref. IPs",         value: fmtNum(metrics.refIPs),       color:"#64748b", tip:"Unique IPs linking in" },
              ].map(m => (
                <div key={m.label} title={m.tip}
                  style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, padding:"14px 18px", flex:"1 1 140px", minWidth:120, cursor:"help" }}>
                  <div style={{ color:"#64748b", fontSize:"0.72rem", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.4px", marginBottom:4 }}>{m.label}</div>
                  <div style={{ fontSize:"1.6rem", fontWeight:800, color:m.color }}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div style={{ display:"flex", gap:4, marginBottom:16, borderBottom:"2px solid #e2e8f0" }}>
              {([
                {k:"overview",  l:"📊 Overview"},
                {k:"backlinks", l:"🔗 Backlinks"},
                {k:"refdomains",l:"🌐 Ref. Domains"},
                {k:"anchors",   l:"⚓ Anchor Text"},
              ] as const).map(t => (
                <button key={t.k} onClick={() => setTab(t.k)} style={{
                  padding:"8px 16px", border:0, background:"none", cursor:"pointer",
                  fontWeight: tab===t.k ? 700 : 500,
                  color: tab===t.k ? "#dc2626" : "#64748b",
                  borderBottom: tab===t.k ? "2px solid #dc2626" : "2px solid transparent",
                  marginBottom:-2, fontSize:"0.88rem",
                }}>{t.l}</button>
              ))}
            </div>

            {tab === "overview"   && <OverviewTab metrics={metrics} />}
            {tab === "backlinks"  && <BacklinksTable rows={backlinks} />}
            {tab === "refdomains" && <RefDomainsTable rows={refDomains} />}
            {tab === "anchors"    && <AnchorsTable rows={anchors} />}
          </>
        )}
      </div>
    </div>
  );
}

function OverviewTab({ metrics }: { metrics: Metrics }) {
  const tf = metrics.trustFlow ?? 0;
  const cf = metrics.citationFlow ?? 0;
  const ratio = cf > 0 ? tf / cf : 0;
  const quality = ratio >= 0.5 ? { label:"High quality", color:"#16a34a", desc:"Link profile looks editorial and natural." }
    : ratio >= 0.2 ? { label:"Mixed", color:"#ca8a04", desc:"Mix of quality and lower-grade links." }
    : { label:"Low quality", color:"#dc2626", desc:"High volume of potentially spammy links." };

  return (
    <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, padding:"18px 20px", flex:"1 1 280px" }}>
        <div style={{ fontWeight:700, marginBottom:12 }}>TF / CF Gauge</div>
        <TFBar tf={metrics.trustFlow} cf={metrics.citationFlow} />
        <div style={{ marginTop:14, fontSize:"0.84rem" }}>
          <span style={{ background: quality.color+"22", color: quality.color, borderRadius:8, padding:"3px 10px", fontWeight:700, fontSize:"0.8rem" }}>
            {quality.label}
          </span>
          <div style={{ color:"#64748b", marginTop:8 }}>{quality.desc}</div>
        </div>
      </div>

      {metrics.topicalTF.length > 0 && (
        <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, padding:"18px 20px", flex:"1 1 280px" }}>
          <div style={{ fontWeight:700, marginBottom:12 }}>🏷️ Topical Trust Flow</div>
          <div style={{ fontSize:"0.84rem", color:"#64748b", marginBottom:10 }}>What topics this site is authoritative on:</div>
          {metrics.topicalTF.slice(0, 6).map((t, i) => (
            <div key={i} style={{ marginBottom:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.82rem", marginBottom:2 }}>
                <span style={{ color:"#334155", fontWeight: i===0 ? 700 : 400 }}>{t.topic}</span>
                <span style={{ color:"#0ea5e9", fontWeight:700 }}>{t.value}</span>
              </div>
              <div style={{ background:"#e2e8f0", borderRadius:6, height:5 }}>
                <div style={{ width:`${Math.min(100,(t.value/(metrics.topicalTF[0]?.value||1))*100)}%`, background:"#0ea5e9", height:"100%", borderRadius:6 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BacklinksTable({ rows }: { rows: BacklinkRow[] }) {
  if (!rows.length) return <div style={{ padding:40, textAlign:"center", color:"#94a3b8" }}>No backlinks found.</div>;
  return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, overflow:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.83rem" }}>
        <thead>
          <tr style={{ background:"#f8fafc", borderBottom:"2px solid #e2e8f0" }}>
            <th style={{ textAlign:"left", padding:"10px 14px", fontWeight:700 }}>Source URL</th>
            <th style={{ textAlign:"left", padding:"10px 14px", fontWeight:700 }}>Anchor Text</th>
            <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>TF</th>
            <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>CF</th>
            <th style={{ textAlign:"center", padding:"10px 14px", fontWeight:700 }}>Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom:"1px solid #f1f5f9" }}>
              <td style={{ padding:"8px 14px", maxWidth:280, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                <a href={r.SourceURL} target="_blank" rel="noreferrer"
                  style={{ color:"#0ea5e9", textDecoration:"none", fontSize:"0.82rem" }}>{r.SourceURL}</a>
              </td>
              <td style={{ padding:"8px 14px", color:"#334155" }}>{r.AnchorText || <em style={{ color:"#94a3b8" }}>none</em>}</td>
              <td style={{ padding:"8px 14px", textAlign:"right", fontWeight:700, color:"#0ea5e9" }}>{r.TrustFlow ?? "—"}</td>
              <td style={{ padding:"8px 14px", textAlign:"right", color:"#8b5cf6" }}>{r.CitationFlow ?? "—"}</td>
              <td style={{ padding:"8px 14px", textAlign:"center", fontSize:"0.72rem" }}>
                {r.FlagNoFollow ? <span style={{ background:"#fef9c3", color:"#78350f", borderRadius:4, padding:"1px 5px" }}>nofollow</span> : ""}
                {r.FlagRedirect ? <span style={{ background:"#ede9fe", color:"#5b21b6", borderRadius:4, padding:"1px 5px", marginLeft:3 }}>redirect</span> : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RefDomainsTable({ rows }: { rows: RefDomainRow[] }) {
  if (!rows.length) return <div style={{ padding:40, textAlign:"center", color:"#94a3b8" }}>No referring domains found.</div>;
  return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, overflow:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.85rem" }}>
        <thead>
          <tr style={{ background:"#f8fafc", borderBottom:"2px solid #e2e8f0" }}>
            <th style={{ textAlign:"left", padding:"10px 14px", fontWeight:700 }}>Referring Domain</th>
            <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>TF</th>
            <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>CF</th>
            <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>Backlinks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom:"1px solid #f1f5f9" }}>
              <td style={{ padding:"8px 14px" }}>
                <a href={`https://${r.RefDomain}`} target="_blank" rel="noreferrer"
                  style={{ color:"#dc2626", textDecoration:"none", fontWeight:600 }}>{r.RefDomain}</a>
              </td>
              <td style={{ padding:"8px 14px", textAlign:"right", fontWeight:700, color:"#0ea5e9" }}>{r.TrustFlow ?? "—"}</td>
              <td style={{ padding:"8px 14px", textAlign:"right", color:"#8b5cf6" }}>{r.CitationFlow ?? "—"}</td>
              <td style={{ padding:"8px 14px", textAlign:"right" }}>{fmtNum(r.TotalBackLinks)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnchorsTable({ rows }: { rows: AnchorRow[] }) {
  if (!rows.length) return <div style={{ padding:40, textAlign:"center", color:"#94a3b8" }}>No anchor text data found.</div>;
  const total = rows.reduce((s, r) => s + (r.TotalLinks ?? 0), 0) || 1;
  return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, overflow:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.85rem" }}>
        <thead>
          <tr style={{ background:"#f8fafc", borderBottom:"2px solid #e2e8f0" }}>
            <th style={{ textAlign:"left", padding:"10px 14px", fontWeight:700 }}>Anchor Text</th>
            <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>Links</th>
            <th style={{ textAlign:"right", padding:"10px 14px", fontWeight:700 }}>Deleted</th>
            <th style={{ padding:"10px 14px", fontWeight:700, width:140 }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const pct = Math.round(((r.TotalLinks ?? 0) / total) * 100);
            return (
              <tr key={i} style={{ borderBottom:"1px solid #f1f5f9" }}>
                <td style={{ padding:"8px 14px", color:"#334155" }}>{r.AnchorText || <em style={{ color:"#94a3b8" }}>none / image</em>}</td>
                <td style={{ padding:"8px 14px", textAlign:"right", fontWeight:600 }}>{fmtNum(r.TotalLinks)}</td>
                <td style={{ padding:"8px 14px", textAlign:"right", color:"#94a3b8" }}>{fmtNum(r.DeletedLinks)}</td>
                <td style={{ padding:"8px 14px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ flex:1, background:"#e2e8f0", borderRadius:4, height:6 }}>
                      <div style={{ width:`${pct}%`, background:"#dc2626", height:"100%", borderRadius:4 }} />
                    </div>
                    <span style={{ fontSize:"0.76rem", color:"#64748b", width:32, textAlign:"right" }}>{pct}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

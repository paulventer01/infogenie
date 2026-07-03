"use client";
import { useState } from "react";

const COUNTRY_OPTIONS = [
  { k: "us", label: "🇺🇸 United States" }, { k: "gb", label: "🇬🇧 United Kingdom" },
  { k: "ca", label: "🇨🇦 Canada" },        { k: "au", label: "🇦🇺 Australia" },
  { k: "de", label: "🇩🇪 Germany" },        { k: "fr", label: "🇫🇷 France" },
  { k: "in", label: "🇮🇳 India" },          { k: "br", label: "🇧🇷 Brazil" },
];

function Pill({ value, label, color = "#0ea5e9" }: { value: any; label: string; color?: string }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 18px", flex: "1 1 130px", minWidth: 120 }}>
      <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, color }}>
        {value === null || value === undefined ? "—" : Number.isFinite(Number(value)) && Number(value) > 999
          ? Number(value).toLocaleString() : String(value)}
      </div>
    </div>
  );
}

function DRMeter({ value }: { value: number | null }) {
  if (value === null) return <div style={{ color: "#94a3b8" }}>—</div>;
  const color = value >= 70 ? "#10b981" : value >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f8fafc", borderRadius: 10, padding: "14px 18px", flex: "0 0 110px" }}>
      <svg viewBox="0 0 80 50" width={80} height={50}>
        <path d="M5 45 A35 35 0 0 1 75 45" fill="none" stroke="#e2e8f0" strokeWidth={8} strokeLinecap="round" />
        <path d="M5 45 A35 35 0 0 1 75 45" fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
          strokeDasharray={`${(value / 100) * 110} 110`} />
      </svg>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color, marginTop: -8 }}>{value}</div>
      <div style={{ fontSize: "0.7rem", color: "#94a3b8", fontWeight: 600 }}>Domain Rating</div>
    </div>
  );
}

export default function AhrefsIntel() {
  const [tab, setTab] = useState<"overview" | "backlinks" | "keywords" | "gap">("overview");
  const [target, setTarget] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [country, setCountry] = useState("us");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [overview, setOverview] = useState<any>(null);
  const [backlinks, setBacklinks] = useState<any[]>([]);
  const [kwData, setKwData] = useState<any[]>([]);
  const [gapData, setGapData] = useState<any[]>([]);

  async function post(path: string, body: object) {
    const r = await fetch(`/api/ahrefs/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    return r.json();
  }

  async function run(action: () => Promise<void>) {
    setLoading(true); setError("");
    try { await action(); }
    catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  const TABS = [
    { k: "overview" as const,  label: "🏠 Overview" },
    { k: "backlinks" as const, label: "🔗 Backlinks" },
    { k: "keywords" as const,  label: "🔑 Organic Keywords" },
    { k: "gap" as const,       label: "🎯 Content Gap" },
  ];

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb"><span className="bc-group">SEO</span> <span className="bc-sep">›</span> Ahrefs</div>
              <h2 className="view-title">🔍 Ahrefs Intelligence</h2>
              <p className="view-sub">Domain Rating, authoritative backlinks, organic keyword rankings, and content gap analysis from the world's largest backlink index.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 20, paddingBottom: 56 }}>

        <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #e2e8f0" }}>
          {TABS.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              padding: "8px 14px", border: 0, background: "none", cursor: "pointer",
              fontWeight: tab === t.k ? 700 : 500,
              color: tab === t.k ? "#f59e0b" : "#64748b",
              borderBottom: tab === t.k ? "2px solid #f59e0b" : "2px solid transparent",
              marginBottom: -2, fontSize: "0.85rem", whiteSpace: "nowrap",
            }}>{t.label}</button>
          ))}
        </div>

        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", color: "#b91c1c", fontSize: "0.85rem", marginBottom: 14 }}>
            ⚠️ {error}
            {error.includes("not configured") && <span style={{ marginLeft: 8 }}>Add <code>AHREFS_API_KEY</code> in <strong>Manage → Platform APIs</strong>.</span>}
          </div>
        )}

        {/* Controls */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20, alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 220px" }}>
            <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Target domain / URL</label>
            <input className="form-control" value={target} onChange={e => setTarget(e.target.value)} placeholder="example.com" />
          </div>
          {tab === "gap" && (
            <div style={{ flex: "1 1 260px" }}>
              <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Competitors (comma-separated)</label>
              <input className="form-control" value={competitors} onChange={e => setCompetitors(e.target.value)} placeholder="competitor1.com, competitor2.com" />
            </div>
          )}
          {(tab === "keywords" || tab === "gap") && (
            <div>
              <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Country</label>
              <select className="form-control" value={country} onChange={e => setCountry(e.target.value)}>
                {COUNTRY_OPTIONS.map(o => <option key={o.k} value={o.k}>{o.label}</option>)}
              </select>
            </div>
          )}
          <button className="btn btn-primary" style={{ background: "#f59e0b", borderColor: "#f59e0b" }} disabled={loading || !target.trim()} onClick={() => {
            if (tab === "overview")  run(async () => { const d = await post("overview",  { target: target.trim() }); if (!d.ok) throw new Error(d.error); setOverview(d.overview); });
            if (tab === "backlinks") run(async () => { const d = await post("backlinks", { target: target.trim(), limit: 25 }); if (!d.ok) throw new Error(d.error); setBacklinks(d.backlinks || []); });
            if (tab === "keywords")  run(async () => { const d = await post("keywords",  { target: target.trim(), country, limit: 20 }); if (!d.ok) throw new Error(d.error); setKwData(d.keywords || []); });
            if (tab === "gap")       run(async () => { const c = competitors.split(",").map(x => x.trim()).filter(Boolean); const d = await post("content-gap", { target: target.trim(), competitors: c, country, limit: 20 }); if (!d.ok) throw new Error(d.error); setGapData(d.gaps || []); });
          }}>
            {loading ? "Loading…" : tab === "gap" ? "Find Gaps" : "Analyse"}
          </button>
        </div>

        {/* Overview */}
        {tab === "overview" && overview && (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <DRMeter value={overview.domainRating} />
            <Pill label="URL Rating"      value={overview.urlRating}    color="#f59e0b" />
            <Pill label="Backlinks"       value={overview.backlinks}    color="#0ea5e9" />
            <Pill label="Ref. Domains"    value={overview.refDomains}   color="#8b5cf6" />
            <Pill label="Org. Keywords"   value={overview.orgKeywords}  color="#10b981" />
            <Pill label="Org. Traffic"    value={overview.orgTraffic}   color="#10b981" />
          </div>
        )}
        {tab === "overview" && !overview && !loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>Enter a domain above to analyse its Ahrefs authority metrics.</div>
        )}

        {/* Backlinks */}
        {tab === "backlinks" && backlinks.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Source Page", "Domain", "DR", "Anchor", "Traffic", "Type", "First Seen"].map(h => (
                    <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {backlinks.map((b, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <a href={b.urlFrom} target="_blank" rel="noreferrer" style={{ color: "#0ea5e9", textDecoration: "none" }}>{b.title || b.urlFrom}</a>
                    </td>
                    <td style={{ padding: "8px 12px", color: "#475569" }}>{b.domainFrom}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ background: (b.domainRating||0) >= 60 ? "#dcfce7" : (b.domainRating||0) >= 30 ? "#fef9c3" : "#f1f5f9", color: (b.domainRating||0) >= 60 ? "#15803d" : "#78350f", borderRadius: 6, padding: "1px 6px", fontWeight: 700, fontSize: "0.75rem" }}>
                        {b.domainRating ?? "—"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", color: "#64748b", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.anchor || "—"}</td>
                    <td style={{ padding: "8px 12px", color: "#64748b" }}>{b.traffic?.toLocaleString() ?? "—"}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ background: b.dofollow ? "#dcfce7" : "#f1f5f9", color: b.dofollow ? "#15803d" : "#64748b", borderRadius: 6, padding: "1px 6px", fontSize: "0.72rem", fontWeight: 600 }}>
                        {b.dofollow ? "dofollow" : "nofollow"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", color: "#94a3b8", whiteSpace: "nowrap" }}>{b.firstSeen ? b.firstSeen.slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "backlinks" && !backlinks.length && !loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>Enter a domain to see its top referring pages.</div>
        )}

        {/* Keywords */}
        {tab === "keywords" && kwData.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Keyword", "Position", "Volume", "KD", "CPC", "Traffic", "URL"].map(h => (
                    <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kwData.map((k, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 600 }}>{k.keyword}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ background: (k.position||99) <= 3 ? "#dcfce7" : (k.position||99) <= 10 ? "#fef9c3" : "#f1f5f9", color: (k.position||99) <= 3 ? "#15803d" : "#78350f", borderRadius: 6, padding: "2px 7px", fontWeight: 700, fontSize: "0.76rem" }}>
                        #{k.position ?? "—"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px" }}>{k.searchVolume?.toLocaleString() ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontWeight: 700, color: (k.difficulty||0) > 70 ? "#ef4444" : (k.difficulty||0) > 40 ? "#f59e0b" : "#10b981" }}>{k.difficulty ?? "—"}</td>
                    <td style={{ padding: "8px 12px", color: "#64748b" }}>{k.cpc ? `$${Number(k.cpc).toFixed(2)}` : "—"}</td>
                    <td style={{ padding: "8px 12px", color: "#64748b" }}>{k.traffic?.toLocaleString() ?? "—"}</td>
                    <td style={{ padding: "8px 12px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {k.url ? <a href={k.url} target="_blank" rel="noreferrer" style={{ color: "#0ea5e9", textDecoration: "none", fontSize: "0.76rem" }}>{k.url.replace(/^https?:\/\//, "")}</a> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "keywords" && !kwData.length && !loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>Enter a domain to see its top organic keyword rankings.</div>
        )}

        {/* Content Gap */}
        {tab === "gap" && gapData.length > 0 && (
          <div>
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: "0.84rem", color: "#78350f" }}>
              💡 <strong>{gapData.length} keyword gap{gapData.length !== 1 ? "s" : ""} found</strong> — keywords your competitors rank for that <strong>{target}</strong> does not.
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Keyword", "Volume", "KD", "Best Position", "CPC"].map(h => (
                      <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gapData.map((g, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>{g.keyword}</td>
                      <td style={{ padding: "8px 12px" }}>{g.searchVolume?.toLocaleString() ?? "—"}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 700, color: (g.difficulty||0) > 70 ? "#ef4444" : (g.difficulty||0) > 40 ? "#f59e0b" : "#10b981" }}>{g.difficulty ?? "—"}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ background: "#dcfce7", color: "#15803d", borderRadius: 6, padding: "2px 7px", fontWeight: 700, fontSize: "0.76rem" }}>
                          #{g.bestPosition ?? "?"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", color: "#64748b" }}>{g.cpc ? `$${Number(g.cpc).toFixed(2)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {tab === "gap" && !gapData.length && !loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>
            Enter your domain and at least one competitor to find keyword gaps.
          </div>
        )}

      </div>
    </div>
  );
}

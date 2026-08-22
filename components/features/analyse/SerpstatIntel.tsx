"use client";
import { useState } from "react";

const SE_OPTIONS = [
  { k: "g_us", label: "🇺🇸 Google US" }, { k: "g_uk", label: "🇬🇧 Google UK" },
  { k: "g_ca", label: "🇨🇦 Google CA" }, { k: "g_au", label: "🇦🇺 Google AU" },
  { k: "g_de", label: "🇩🇪 Google DE" }, { k: "g_fr", label: "🇫🇷 Google FR" },
  { k: "g_in", label: "🇮🇳 Google IN" }, { k: "g_br", label: "🇧🇷 Google BR" },
  { k: "g_nl", label: "🇳🇱 Google NL" }, { k: "g_es", label: "🇪🇸 Google ES" },
];

function Metric({ label, value, delta, format = "number" }: { label: string; value: any; delta?: any; format?: string }) {
  const formatted = value === null || value === undefined ? "—"
    : format === "pct" ? `${Number(value).toFixed(1)}%`
    : format === "dollar" ? `$${Number(value).toFixed(2)}`
    : Number.isFinite(Number(value)) && Number(value) > 999 ? Number(value).toLocaleString() : String(value);

  const deltaColor = delta > 0 ? "#10b981" : delta < 0 ? "#ef4444" : "#94a3b8";
  return (
    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 18px", flex: "1 1 130px", minWidth: 120 }}>
      <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0f172a" }}>{formatted}</div>
      {delta !== undefined && delta !== null && (
        <div style={{ fontSize: "0.72rem", color: deltaColor, fontWeight: 600, marginTop: 2 }}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta).toLocaleString()}
        </div>
      )}
    </div>
  );
}

export default function SerpstatIntel() {
  const [tab, setTab] = useState<"domain" | "keywords" | "competitors" | "research">("domain");
  const [domain, setDomain] = useState("");
  const [keyword, setKeyword] = useState("");
  const [se, setSe] = useState("g_us");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [summary, setSummary] = useState<any>(null);
  const [kws, setKws] = useState<any[]>([]);
  const [comps, setComps] = useState<any[]>([]);
  const [research, setResearch] = useState<any>(null);

  async function post(path: string, body: object) {
    const r = await fetch(`/api/serpstat/${path}`, {
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
    { k: "domain" as const,      label: "🏠 Domain Summary" },
    { k: "keywords" as const,    label: "🔑 Top Keywords" },
    { k: "competitors" as const, label: "⚔️ Competitors" },
    { k: "research" as const,    label: "🔍 Keyword Research" },
  ];

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb"><span className="bc-group">SEO</span> <span className="bc-sep">›</span> Serpstat</div>
              <h2 className="view-title">📈 Serpstat Intelligence</h2>
              <p className="view-sub">Domain visibility score, top organic keywords, competitor overlap, and keyword research across 230+ regional Google databases.</p>
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
              color: tab === t.k ? "#0284c7" : "#64748b",
              borderBottom: tab === t.k ? "2px solid #0284c7" : "2px solid transparent",
              marginBottom: -2, fontSize: "0.85rem", whiteSpace: "nowrap",
            }}>{t.label}</button>
          ))}
        </div>

        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", color: "#b91c1c", fontSize: "0.85rem", marginBottom: 14 }}>
            ⚠️ {error}
            {error.includes("not configured") && <span style={{ marginLeft: 8 }}>Add <code>SERPSTAT_API_KEY</code> in <strong>Manage → Platform APIs</strong>.</span>}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20, alignItems: "flex-end" }}>
          {tab !== "research" ? (
            <div style={{ flex: "1 1 220px" }}>
              <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Domain</label>
              <input className="form-control" value={domain} onChange={e => setDomain(e.target.value)} placeholder="example.com" />
            </div>
          ) : (
            <div style={{ flex: "1 1 220px" }}>
              <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Keyword</label>
              <input className="form-control" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="e.g. project management software" />
            </div>
          )}
          <div>
            <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Search Engine</label>
            <select className="form-control" value={se} onChange={e => setSe(e.target.value)}>
              {SE_OPTIONS.map(o => <option key={o.k} value={o.k}>{o.label}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" style={{ background: "#0284c7", borderColor: "#0284c7" }} disabled={loading}
            onClick={() => {
              if (tab === "domain")      run(async () => { const d = await post("domain",      { domain: domain.trim(), se }); if (!d.ok) throw new Error(d.error); setSummary(d.summary); });
              if (tab === "keywords")    run(async () => { const d = await post("keywords",    { domain: domain.trim(), se, limit: 20 }); if (!d.ok) throw new Error(d.error); setKws(d.keywords || []); });
              if (tab === "competitors") run(async () => { const d = await post("competitors", { domain: domain.trim(), se, limit: 10 }); if (!d.ok) throw new Error(d.error); setComps(d.competitors || []); });
              if (tab === "research")    run(async () => { const d = await post("keyword-research", { keyword: keyword.trim(), se, limit: 10 }); if (!d.ok) throw new Error(d.error); setResearch(d); });
            }}>
            {loading ? "Loading…" : "Search"}
          </button>
        </div>

        {/* Domain Summary */}
        {tab === "domain" && summary && (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <Metric label="Visibility Score"   value={summary.visibilityScore}   format="pct" />
              <Metric label="Organic Keywords"   value={summary.organicKeywords} />
              <Metric label="Organic Traffic"    value={summary.organicTraffic} />
              <Metric label="Paid Keywords"      value={summary.paidKeywords} />
              <Metric label="Paid Traffic"       value={summary.paidTraffic} />
              <Metric label="New Keywords"       value={summary.newKeywords}    delta={summary.newKeywords} />
              <Metric label="Lost Keywords"      value={summary.lostKeywords}   delta={summary.lostKeywords ? -summary.lostKeywords : undefined} />
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px", background: "#dcfce7", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontWeight: 700, color: "#15803d", fontSize: "0.85rem", marginBottom: 4 }}>▲ Keywords Rising</div>
                <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#15803d" }}>{summary.riseKeywords?.toLocaleString() ?? "—"}</div>
              </div>
              <div style={{ flex: "1 1 200px", background: "#fee2e2", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontWeight: 700, color: "#b91c1c", fontSize: "0.85rem", marginBottom: 4 }}>▼ Keywords Falling</div>
                <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#b91c1c" }}>{summary.fellKeywords?.toLocaleString() ?? "—"}</div>
              </div>
            </div>
          </div>
        )}
        {tab === "domain" && !summary && !loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>Enter a domain to see its Serpstat visibility metrics.</div>
        )}

        {/* Top Keywords */}
        {tab === "keywords" && kws.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Keyword", "Position", "Volume", "Traffic", "CPC", "Difficulty", "URL"].map(h => (
                    <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kws.map((k, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 600 }}>{k.keyword}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ background: (k.position||99) <= 3 ? "#dcfce7" : (k.position||99) <= 10 ? "#fef9c3" : "#f1f5f9", color: (k.position||99) <= 3 ? "#15803d" : "#78350f", borderRadius: 6, padding: "2px 7px", fontWeight: 700, fontSize: "0.76rem" }}>
                        #{k.position ?? "—"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px" }}>{k.searchVolume?.toLocaleString() ?? "—"}</td>
                    <td style={{ padding: "8px 12px", color: "#64748b" }}>{k.trafficShare?.toLocaleString() ?? "—"}</td>
                    <td style={{ padding: "8px 12px", color: "#64748b" }}>{k.cpc ? `$${Number(k.cpc).toFixed(2)}` : "—"}</td>
                    <td style={{ padding: "8px 12px", fontWeight: 700, color: (k.difficulty||0) > 70 ? "#ef4444" : (k.difficulty||0) > 40 ? "#f59e0b" : "#10b981" }}>{k.difficulty ?? "—"}</td>
                    <td style={{ padding: "8px 12px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {k.url ? <a href={k.url} target="_blank" rel="noreferrer" style={{ color: "#0284c7", textDecoration: "none", fontSize: "0.75rem" }}>{k.url.replace(/^https?:\/\//, "")}</a> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "keywords" && !kws.length && !loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>Enter a domain to see its top ranking keywords.</div>
        )}

        {/* Competitors */}
        {tab === "competitors" && comps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {comps.map((c, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700, flex: "1 1 160px" }}>
                  <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" style={{ color: "#0284c7", textDecoration: "none" }}>{c.domain}</a>
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#0284c7" }}>{c.relevance?.toFixed(2) ?? "—"}</div>
                    <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Relevance</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{c.commonKeywords?.toLocaleString() ?? "—"}</div>
                    <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Common KWs</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{c.organicKeywords?.toLocaleString() ?? "—"}</div>
                    <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Org. KWs</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{c.organicTraffic?.toLocaleString() ?? "—"}</div>
                    <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Est. Traffic</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === "competitors" && !comps.length && !loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>Enter a domain to discover its organic competitors.</div>
        )}

        {/* Keyword Research */}
        {tab === "research" && research && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {research.metrics && (
              <div style={{ flex: "0 0 280px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 14 }}>&ldquo;{research.metrics.keyword}&rdquo;</div>
                {[
                  { label: "Monthly Volume",  value: research.metrics.searchVolume?.toLocaleString() || "—" },
                  { label: "CPC",             value: research.metrics.cpc ? `$${Number(research.metrics.cpc).toFixed(2)}` : "—" },
                  { label: "Difficulty",      value: research.metrics.difficulty ? `${research.metrics.difficulty}/100` : "—" },
                  { label: "Competition",     value: research.metrics.competition ? `${(research.metrics.competition * 100).toFixed(0)}%` : "—" },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.84rem" }}>
                    <span style={{ color: "#64748b" }}>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            )}
            {research.relatedKeywords?.length > 0 && (
              <div style={{ flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ fontWeight: 700, marginBottom: 12, fontSize: "0.9rem" }}>🔗 Related Keywords</div>
                {research.relatedKeywords.map((r: any, i: number) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.82rem", gap: 8 }}>
                    <span style={{ flex: 1, fontWeight: 500 }}>{r.keyword}</span>
                    <span style={{ color: "#64748b", minWidth: 60, textAlign: "right" }}>{r.searchVolume?.toLocaleString() || "—"}/mo</span>
                    <span style={{ color: "#0ea5e9", minWidth: 40, textAlign: "right" }}>{r.cpc ? `$${Number(r.cpc).toFixed(2)}` : "—"}</span>
                    <span style={{ fontWeight: 700, minWidth: 40, textAlign: "right", color: (r.difficulty||0) > 70 ? "#ef4444" : (r.difficulty||0) > 40 ? "#f59e0b" : "#10b981" }}>
                      {r.difficulty ? `KD ${r.difficulty}` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === "research" && !research && !loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>Enter a keyword to research its volume, difficulty, and related suggestions.</div>
        )}

      </div>
    </div>
  );
}

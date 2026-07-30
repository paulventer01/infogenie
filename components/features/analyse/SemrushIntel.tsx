"use client";
import { useState } from "react";

const DB_OPTIONS = [
  { k: "us", label: "🇺🇸 United States" }, { k: "uk", label: "🇬🇧 United Kingdom" },
  { k: "ca", label: "🇨🇦 Canada" },        { k: "au", label: "🇦🇺 Australia" },
  { k: "de", label: "🇩🇪 Germany" },        { k: "fr", label: "🇫🇷 France" },
  { k: "in", label: "🇮🇳 India" },          { k: "es", label: "🇪🇸 Spain" },
  { k: "br", label: "🇧🇷 Brazil" },         { k: "nl", label: "🇳🇱 Netherlands" },
];

function StatCard({ label, value, sub }: { label: string; value: string | number | null; sub?: string }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 18px", minWidth: 130, flex: "1 1 130px" }}>
      <div style={{ fontSize: "0.74rem", color: "#64748b", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>
        {value === null || value === undefined ? "—" : Number.isFinite(Number(value)) && Number(value) > 999
          ? Number(value).toLocaleString() : value}
      </div>
      {sub && <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Bar({ pct, color = "#0ea5e9" }: { pct: number; color?: string }) {
  return (
    <div style={{ height: 6, background: "#e2e8f0", borderRadius: 4, overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.4s" }} />
    </div>
  );
}

export default function SemrushIntel() {
  const [tab, setTab] = useState<"overview" | "keywords" | "competitors" | "lookup">("overview");
  const [domain, setDomain] = useState("");
  const [keyword, setKeyword] = useState("");
  const [db, setDb] = useState("us");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);

  const [overview, setOverview] = useState<any>(null);
  const [keywords, setKeywords] = useState<any[]>([]);
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [lookupData, setLookupData] = useState<any>(null);

  async function checkStatus() {
    const r = await fetch("/api/semrush/status");
    const d = await r.json();
    setConfigured(d.configured);
    return d.configured;
  }

  async function post(path: string, body: object) {
    const r = await fetch(`/api/semrush/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    return r.json();
  }

  async function run(action: () => Promise<void>) {
    setLoading(true); setError("");
    try {
      if (configured === null) { const ok = await checkStatus(); if (!ok) { setError("SEMRUSH_API_KEY not configured — add it via Manage → Platform APIs"); setLoading(false); return; } }
      await action();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function fetchOverview() {
    if (!domain.trim()) return;
    await run(async () => {
      const d = await post("domain-overview", { domain: domain.trim(), database: db });
      if (!d.ok) throw new Error(d.error);
      setOverview(d.overview);
    });
  }

  async function fetchKeywords() {
    if (!domain.trim()) return;
    await run(async () => {
      const d = await post("keywords", { domain: domain.trim(), database: db, limit: 20 });
      if (!d.ok) throw new Error(d.error);
      setKeywords(d.keywords || []);
    });
  }

  async function fetchCompetitors() {
    if (!domain.trim()) return;
    await run(async () => {
      const d = await post("competitors", { domain: domain.trim(), database: db, limit: 10 });
      if (!d.ok) throw new Error(d.error);
      setCompetitors(d.competitors || []);
    });
  }

  async function fetchLookup() {
    if (!keyword.trim()) return;
    await run(async () => {
      const d = await post("keyword-lookup", { keyword: keyword.trim(), database: db });
      if (!d.ok) throw new Error(d.error);
      setLookupData(d);
    });
  }

  const TABS = [
    { k: "overview" as const,     label: "🏠 Domain Overview" },
    { k: "keywords" as const,     label: "🔑 Top Keywords" },
    { k: "competitors" as const,  label: "⚔️ Competitors" },
    { k: "lookup" as const,       label: "🔍 Keyword Lookup" },
  ];

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb"><span className="bc-group">SEO</span> <span className="bc-sep">›</span> Semrush</div>
              <h2 className="view-title">📊 Semrush Intelligence</h2>
              <p className="view-sub">Domain traffic estimates, organic keyword rankings, competitor discovery, and keyword metrics powered by Semrush.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 20, paddingBottom: 56 }}>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #e2e8f0" }}>
          {TABS.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              padding: "8px 14px", border: 0, background: "none", cursor: "pointer",
              fontWeight: tab === t.k ? 700 : 500,
              color: tab === t.k ? "#0ea5e9" : "#64748b",
              borderBottom: tab === t.k ? "2px solid #0ea5e9" : "2px solid transparent",
              marginBottom: -2, fontSize: "0.85rem", whiteSpace: "nowrap",
            }}>{t.label}</button>
          ))}
        </div>

        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", color: "#b91c1c", fontSize: "0.85rem", marginBottom: 14 }}>
            ⚠️ {error}
            {error.includes("not configured") && (
              <span style={{ marginLeft: 8 }}>
                Add <code>SEMRUSH_API_KEY</code> in <strong>Manage → Platform APIs</strong>.
              </span>
            )}
          </div>
        )}

        {/* Shared controls */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20, alignItems: "flex-end" }}>
          {tab !== "lookup" && (
            <div style={{ flex: "1 1 240px" }}>
              <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Domain</label>
              <input className="form-control" value={domain} onChange={e => setDomain(e.target.value)}
                placeholder="example.com" onKeyDown={e => e.key === "Enter" && (tab === "overview" ? fetchOverview() : tab === "keywords" ? fetchKeywords() : fetchCompetitors())} />
            </div>
          )}
          {tab === "lookup" && (
            <div style={{ flex: "1 1 240px" }}>
              <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Keyword</label>
              <input className="form-control" value={keyword} onChange={e => setKeyword(e.target.value)}
                placeholder="e.g. email marketing software" onKeyDown={e => e.key === "Enter" && fetchLookup()} />
            </div>
          )}
          <div>
            <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Database</label>
            <select className="form-control" value={db} onChange={e => setDb(e.target.value)}>
              {DB_OPTIONS.map(o => <option key={o.k} value={o.k}>{o.label}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" disabled={loading}
            onClick={tab === "overview" ? fetchOverview : tab === "keywords" ? fetchKeywords : tab === "competitors" ? fetchCompetitors : fetchLookup}>
            {loading ? "Loading…" : "Search"}
          </button>
        </div>

        {/* ── Domain Overview ── */}
        {tab === "overview" && overview && (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <StatCard label="Authority Score"    value={overview.authorityScore}    sub="0–100 domain strength" />
              <StatCard label="Organic Keywords"   value={overview.organicKeywords}   sub="ranking in top 100" />
              <StatCard label="Organic Traffic"    value={overview.organicTraffic}    sub="monthly visits est." />
              <StatCard label="Traffic Cost"       value={overview.organicTrafficCost ? `$${Number(overview.organicTrafficCost).toLocaleString()}` : null} sub="equiv. paid value / mo" />
              <StatCard label="Paid Keywords"      value={overview.paidKeywords}      sub="active Google Ads" />
              <StatCard label="Paid Traffic"       value={overview.paidTraffic}       sub="monthly paid visits est." />
            </div>
          </div>
        )}
        {tab === "overview" && !overview && !loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>Enter a domain above to see its Semrush overview.</div>
        )}

        {/* ── Top Keywords ── */}
        {tab === "keywords" && keywords.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Keyword", "Pos", "Volume", "KD", "CPC", "Traffic"].map(h => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keywords.map((k, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "9px 14px", fontWeight: 600 }}>{k.keyword}</td>
                    <td style={{ padding: "9px 14px" }}>
                      <span style={{ background: k.position <= 3 ? "#dcfce7" : k.position <= 10 ? "#fef9c3" : "#f1f5f9", color: k.position <= 3 ? "#15803d" : k.position <= 10 ? "#78350f" : "#64748b", borderRadius: 6, padding: "2px 8px", fontWeight: 700, fontSize: "0.78rem" }}>
                        #{k.position || "—"}
                      </span>
                    </td>
                    <td style={{ padding: "9px 14px", color: "#0f172a" }}>{k.searchVolume?.toLocaleString() || "—"}</td>
                    <td style={{ padding: "9px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: "0.78rem", fontWeight: 700, minWidth: 28 }}>{k.difficulty || "—"}</span>
                        {k.difficulty > 0 && <Bar pct={k.difficulty} color={k.difficulty > 70 ? "#ef4444" : k.difficulty > 40 ? "#f59e0b" : "#10b981"} />}
                      </div>
                    </td>
                    <td style={{ padding: "9px 14px", color: "#64748b" }}>{k.cpc > 0 ? `$${k.cpc.toFixed(2)}` : "—"}</td>
                    <td style={{ padding: "9px 14px", color: "#64748b" }}>{k.competition ? (k.competition * 100).toFixed(0) + "%" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "keywords" && !keywords.length && !loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>Enter a domain to see its top ranking keywords.</div>
        )}

        {/* ── Competitors ── */}
        {tab === "competitors" && competitors.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {competitors.map((c, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700, flex: "1 1 160px", fontSize: "0.95rem" }}>
                  <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" style={{ color: "#0ea5e9", textDecoration: "none" }}>{c.domain}</a>
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{c.commonKeywords?.toLocaleString() || "—"}</div>
                    <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Common KWs</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{c.organicKeywords?.toLocaleString() || "—"}</div>
                    <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Org. Keywords</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{c.organicTraffic?.toLocaleString() || "—"}</div>
                    <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Est. Traffic</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#0ea5e9" }}>{c.competitorScore ? (c.competitorScore * 100).toFixed(0) + "%" : "—"}</div>
                    <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Overlap</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === "competitors" && !competitors.length && !loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>Enter a domain to find its organic competitors.</div>
        )}

        {/* ── Keyword Lookup ── */}
        {tab === "lookup" && lookupData && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {lookupData.metrics && (
              <div style={{ flex: "0 0 300px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: 14, color: "#0f172a" }}>
                  &ldquo;{lookupData.metrics.keyword}&rdquo;
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { label: "Monthly Volume",   value: lookupData.metrics.searchVolume?.toLocaleString() || "—" },
                    { label: "CPC",              value: lookupData.metrics.cpc > 0 ? `$${lookupData.metrics.cpc.toFixed(2)}` : "—" },
                    { label: "Keyword Difficulty", value: lookupData.metrics.difficulty ? `${lookupData.metrics.difficulty}/100` : "—" },
                    { label: "Competition",      value: lookupData.metrics.competition ? (lookupData.metrics.competition * 100).toFixed(0) + "%" : "—" },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.85rem" }}>
                      <span style={{ color: "#64748b" }}>{row.label}</span>
                      <strong>{row.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {lookupData.relatedKeywords?.length > 0 && (
              <div style={{ flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ fontWeight: 700, marginBottom: 12, fontSize: "0.9rem" }}>🔗 Related Keywords</div>
                {lookupData.relatedKeywords.map((r: any, i: number) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.82rem", gap: 8 }}>
                    <span style={{ flex: 1, fontWeight: 500 }}>{r.keyword}</span>
                    <span style={{ color: "#64748b", minWidth: 60, textAlign: "right" }}>{r.searchVolume?.toLocaleString() || "—"} / mo</span>
                    <span style={{ color: "#0ea5e9", minWidth: 40, textAlign: "right" }}>{r.cpc > 0 ? `$${r.cpc.toFixed(2)}` : "—"}</span>
                    <span style={{ color: r.difficulty > 70 ? "#ef4444" : r.difficulty > 40 ? "#f59e0b" : "#10b981", minWidth: 40, textAlign: "right", fontWeight: 700 }}>{r.difficulty ? `KD ${r.difficulty}` : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === "lookup" && !lookupData && !loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>Enter a keyword to get its Semrush metrics and related suggestions.</div>
        )}

      </div>
    </div>
  );
}

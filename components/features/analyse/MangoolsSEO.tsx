"use client";

// Mangools SEO — KWFinder keywords, SiteProfiler domain metrics, gap analysis,
// and backlink profiles. Requires MANGOOLS_API_KEY via Manage → Platform APIs.
// Token: https://mangools.com/api-token · API: https://api.mangools.com/v3

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface KwRow {
  keyword?: string;
  searchVolume?: number | null;
  cpc?: number | null;
  ppc?: number | null;
  difficulty?: number | null;
}
interface OverviewMetrics {
  trustFlow: number | null;
  citationFlow: number | null;
  refIPs: number | null;
  mozPda: number | null;
  mozUpa: number | null;
  topRank: number | null;
}
interface SiteComp {
  domain?: string;
  domainId?: string;
  topRank?: number;
  score?: number;
  trustFlow?: number;
  citationFlow?: number;
}
interface Profile {
  trustFlow: number | null;
  citationFlow: number | null;
  extBackLinks: number | null;
  refDomains: number | null;
  refIPs: number | null;
}

const LOCATIONS = [
  { id: 2840, label: "🇺🇸 United States" },
  { id: 2826, label: "🇬🇧 United Kingdom" },
  { id: 2124, label: "🇨🇦 Canada" },
  { id: 2036, label: "🇦🇺 Australia" },
  { id: 2276, label: "🇩🇪 Germany" },
  { id: 2250, label: "🇫🇷 France" },
  { id: 2356, label: "🇮🇳 India" },
  { id: 2724, label: "🇪🇸 Spain" },
  { id: 2710, label: "🇿🇦 South Africa" },
];

function fmtNum(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "k";
  return String(Math.round(v * 100) / 100);
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return "$" + Number(n).toFixed(2);
}

function kdColor(kd: number | null | undefined) {
  if (kd == null) return "#64748b";
  if (kd <= 29) return "#059669";
  if (kd <= 59) return "#d97706";
  return "#dc2626";
}

function Pill({ label, value, color = "#0f172a" }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 18px", flex: "1 1 120px", minWidth: 110 }}>
      <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "1.35rem", fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

function getAnalysisDomain(): string {
  if (typeof window === "undefined") return "";
  const ad = (window as unknown as Record<string, unknown>).analysisData as Record<string, unknown> | undefined;
  if (!ad) return "";
  const url = String(ad.url || ad.domain || "");
  if (!url) return "";
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].trim();
}

export default function MangoolsSEO() {
  const [tab, setTab] = useState<"keywords" | "domain" | "gap" | "backlinks">("keywords");
  const [seed, setSeed] = useState("");
  const [domain, setDomain] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [locationId, setLocationId] = useState(2840);

  const [related, setRelated] = useState<KwRow[]>([]);
  const [compKws, setCompKws] = useState<KwRow[]>([]);
  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [siteComps, setSiteComps] = useState<SiteComp[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [refDomains, setRefDomains] = useState<Array<Record<string, unknown>>>([]);
  const [anchors, setAnchors] = useState<Array<Record<string, unknown>>>([]);
  const [gapResult, setGapResult] = useState<unknown>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [noKey, setNoKey] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const d = getAnalysisDomain();
    if (d) { setDomain(d); setSeed(d.split(".")[0] || ""); }
  }, []);

  async function ensureConfigured() {
    const st = await apiGet<{ ok: boolean; configured?: boolean }>("/api/mangools/status");
    if (!st.configured) { setNoKey(true); return false; }
    setNoKey(false);
    return true;
  }

  async function runKeywords() {
    const kw = seed.trim();
    const d = domain.trim();
    if (!kw && !d) return;
    setLoading(true); setError(""); setSearched(true);
    try {
      if (!(await ensureConfigured())) { setLoading(false); return; }
      const loc = `location_id=${locationId}`;
      const jobs: Promise<unknown>[] = [];
      if (kw) {
        jobs.push(apiGet<{ ok: boolean; keywords?: KwRow[]; error?: string }>(
          `/api/mangools/related-keywords?kw=${encodeURIComponent(kw)}&${loc}`
        ).then(r => { if (!r.ok) throw new Error(r.error || "Related keywords failed"); setRelated(r.keywords || []); }));
      } else setRelated([]);
      if (d) {
        jobs.push(apiGet<{ ok: boolean; keywords?: KwRow[]; error?: string }>(
          `/api/mangools/competitor-keywords?url=${encodeURIComponent(d)}&${loc}`
        ).then(r => { if (!r.ok) throw new Error(r.error || "Competitor keywords failed"); setCompKws(r.keywords || []); }));
      } else setCompKws([]);
      await Promise.all(jobs);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  async function runDomain() {
    const d = domain.trim();
    if (!d) return;
    setLoading(true); setError(""); setSearched(true);
    try {
      if (!(await ensureConfigured())) { setLoading(false); return; }
      const enc = encodeURIComponent(d);
      const [ov, sc] = await Promise.all([
        apiGet<{ ok: boolean; metrics?: OverviewMetrics; error?: string }>(`/api/mangools/overview?url=${enc}`),
        apiGet<{ ok: boolean; competitors?: SiteComp[]; error?: string }>(`/api/mangools/site-competitors?url=${enc}`),
      ]);
      if (!ov.ok) throw new Error(ov.error || "Overview failed");
      setOverview(ov.metrics || null);
      setSiteComps(sc.competitors || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  async function runGap() {
    const d = domain.trim();
    const comps = competitors.split(",").map(s => s.trim()).filter(Boolean);
    if (!d || !comps.length) { setError("Domain and at least one competitor required"); return; }
    setLoading(true); setError(""); setSearched(true);
    try {
      if (!(await ensureConfigured())) { setLoading(false); return; }
      const r = await apiPost<{ ok: boolean; result?: unknown; error?: string }>("/api/mangools/gap-analysis", {
        domain: d, competitors: comps, location_id: locationId,
      });
      if (!r.ok) throw new Error(r.error || "Gap analysis failed");
      setGapResult(r.result || null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  async function runBacklinks() {
    const d = domain.trim();
    if (!d) return;
    setLoading(true); setError(""); setSearched(true);
    try {
      if (!(await ensureConfigured())) { setLoading(false); return; }
      const r = await apiGet<{
        ok: boolean; profile?: Profile; refDomains?: Array<Record<string, unknown>>;
        anchors?: Array<Record<string, unknown>>; error?: string;
      }>(`/api/mangools/backlink-profile?url=${encodeURIComponent(d)}`);
      if (!r.ok) throw new Error(r.error || "Backlink profile failed");
      setProfile(r.profile || null);
      setRefDomains(r.refDomains || []);
      setAnchors(r.anchors || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  function runActive() {
    if (tab === "keywords") return runKeywords();
    if (tab === "domain") return runDomain();
    if (tab === "gap") return runGap();
    return runBacklinks();
  }

  const TABS = [
    { k: "keywords" as const, label: "🔑 Keywords" },
    { k: "domain" as const, label: "🏠 Domain" },
    { k: "gap" as const, label: "🎯 Gap analysis" },
    { k: "backlinks" as const, label: "🔗 Backlinks" },
  ];

  if (noKey) {
    return (
      <div className="view-header-wrap">
        <div className="view-header ig-panel-hero">
          <div className="container"><div className="vh-inner"><div>
            <h2 className="view-title">🥭 Mangools — SEO Toolkit</h2>
          </div></div></div>
        </div>
        <div className="container" style={{ paddingTop: 32 }}>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 36, maxWidth: 560 }}>
            <div style={{ fontSize: "2rem", marginBottom: 10 }}>🔑</div>
            <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 8 }}>Mangools API key not configured</div>
            <div style={{ color: "#64748b", fontSize: "0.88rem", marginBottom: 18, lineHeight: 1.7 }}>
              <ol style={{ paddingLeft: 20, margin: 0 }}>
                <li>Create a free account at <strong>mangools.com</strong></li>
                <li>Copy your token from <strong>mangools.com/api-token</strong></li>
                <li>Save it as <code>MANGOOLS_API_KEY</code> in <strong>Manage → Platform APIs</strong></li>
              </ol>
            </div>
            <a href="https://mangools.com/api-token" target="_blank" rel="noreferrer"
              style={{ display: "inline-block", padding: "9px 18px", background: "#0d9488", color: "#fff", borderRadius: 8, fontWeight: 700, fontSize: "0.88rem", textDecoration: "none" }}>
              Get API token ↗
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb"><span className="bc-group">SEO</span> <span className="bc-sep">›</span> Mangools</div>
              <h2 className="view-title">🥭 Mangools — SEO Toolkit</h2>
              <p className="view-sub">
                KWFinder keyword research, SiteProfiler domain metrics, keyword gap analysis, and LinkMiner-backed backlink profiles — powered by the Mangools API.
              </p>
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
              color: tab === t.k ? "#0d9488" : "#64748b",
              borderBottom: tab === t.k ? "2px solid #0d9488" : "2px solid transparent",
              marginBottom: -2, fontSize: "0.85rem", whiteSpace: "nowrap",
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20, alignItems: "flex-end" }}>
          {(tab === "keywords") && (
            <div style={{ flex: "1 1 180px" }}>
              <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Seed keyword</label>
              <input className="form-control" value={seed} onChange={e => setSeed(e.target.value)}
                placeholder="e.g. seo tools" onKeyDown={e => e.key === "Enter" && runActive()} />
            </div>
          )}
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>
              {tab === "keywords" ? "Domain (optional)" : "Domain / URL"}
            </label>
            <input className="form-control" value={domain} onChange={e => setDomain(e.target.value)}
              placeholder="e.g. competitor.com" onKeyDown={e => e.key === "Enter" && runActive()} />
          </div>
          {tab === "gap" && (
            <div style={{ flex: "1 1 240px" }}>
              <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Competitors (comma-separated)</label>
              <input className="form-control" value={competitors} onChange={e => setCompetitors(e.target.value)}
                placeholder="ahrefs.com, semrush.com" />
            </div>
          )}
          {(tab === "keywords" || tab === "gap") && (
            <div>
              <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Location</label>
              <select className="form-control" value={locationId} onChange={e => setLocationId(Number(e.target.value))} style={{ minWidth: 170 }}>
                {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
          )}
          <button className="btn btn-primary" onClick={runActive} disabled={loading}
            style={{ background: "#0d9488", borderColor: "#0d9488" }}>
            {loading ? "Loading…" : "🔍 Analyse"}
          </button>
        </div>

        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", color: "#b91c1c", fontSize: "0.86rem", marginBottom: 14 }}>
            {error}
            {/not configured/i.test(error) && <span> — add <code>MANGOOLS_API_KEY</code> in Manage → Platform APIs.</span>}
          </div>
        )}

        {!searched && !loading && (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: "0.88rem" }}>
            Enter a keyword or domain, then click Analyse.
          </div>
        )}

        {tab === "keywords" && searched && !loading && (
          <div style={{ display: "grid", gap: 24 }}>
            {!!related.length && (
              <KwTable title="Related keywords" rows={related} />
            )}
            {!!compKws.length && (
              <KwTable title={`Competitor keywords — ${domain}`} rows={compKws} />
            )}
            {!related.length && !compKws.length && (
              <div style={{ color: "#94a3b8", fontSize: "0.88rem" }}>No keyword rows returned for this query.</div>
            )}
          </div>
        )}

        {tab === "domain" && overview && (
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
              <Pill label="Trust Flow" value={fmtNum(overview.trustFlow)} color="#0d9488" />
              <Pill label="Citation Flow" value={fmtNum(overview.citationFlow)} color="#0891b2" />
              <Pill label="Moz DA" value={fmtNum(overview.mozPda)} />
              <Pill label="Moz PA" value={fmtNum(overview.mozUpa)} />
              <Pill label="Ref IPs" value={fmtNum(overview.refIPs)} />
              <Pill label="Top Rank" value={fmtNum(overview.topRank)} />
            </div>
            {!!siteComps.length && (
              <div>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>Organic competitors</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "8px 6px" }}>Domain</th>
                      <th style={{ padding: "8px 6px" }}>Score</th>
                      <th style={{ padding: "8px 6px" }}>Top rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siteComps.slice(0, 40).map((c, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 6px", fontWeight: 600 }}>{c.domain || c.domainId}</td>
                        <td style={{ padding: "8px 6px" }}>{fmtNum(c.score ?? null)}</td>
                        <td style={{ padding: "8px 6px" }}>{fmtNum(c.topRank ?? null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "gap" && gapResult != null && (
          <pre style={{
            background: "#0f172a", color: "#e2e8f0", borderRadius: 10, padding: 16,
            fontSize: "0.78rem", overflow: "auto", maxHeight: 480,
          }}>
            {JSON.stringify(gapResult, null, 2)}
          </pre>
        )}

        {tab === "backlinks" && profile && (
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
              <Pill label="Trust Flow" value={fmtNum(profile.trustFlow)} color="#0d9488" />
              <Pill label="Citation Flow" value={fmtNum(profile.citationFlow)} color="#0891b2" />
              <Pill label="Backlinks" value={fmtNum(profile.extBackLinks)} />
              <Pill label="Ref domains" value={fmtNum(profile.refDomains)} />
              <Pill label="Ref IPs" value={fmtNum(profile.refIPs)} />
            </div>
            {!!refDomains.length && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>Referring domains</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "8px 6px" }}>Domain</th>
                      <th style={{ padding: "8px 6px" }}>TF</th>
                      <th style={{ padding: "8px 6px" }}>CF</th>
                      <th style={{ padding: "8px 6px" }}>Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refDomains.slice(0, 30).map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 6px", fontWeight: 600 }}>{String(r.domain || "")}</td>
                        <td style={{ padding: "8px 6px" }}>{fmtNum(r.trustFlow as number)}</td>
                        <td style={{ padding: "8px 6px" }}>{fmtNum(r.citationFlow as number)}</td>
                        <td style={{ padding: "8px 6px" }}>{fmtNum(r.matchedLinks as number)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!!anchors.length && (
              <div>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>Anchor text</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "8px 6px" }}>Anchor</th>
                      <th style={{ padding: "8px 6px" }}>Ref domains</th>
                    </tr>
                  </thead>
                  <tbody>
                    {anchors.slice(0, 30).map((a, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 6px" }}>{String(a.anchorText || a.anchor || "")}</td>
                        <td style={{ padding: "8px 6px" }}>{fmtNum(a.refDomains as number)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function KwTable({ title, rows }: { title: string; rows: KwRow[] }) {
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{title} <span style={{ color: "#94a3b8", fontWeight: 500 }}>({rows.length})</span></div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
            <th style={{ padding: "8px 6px" }}>Keyword</th>
            <th style={{ padding: "8px 6px" }}>Volume</th>
            <th style={{ padding: "8px 6px" }}>CPC</th>
            <th style={{ padding: "8px 6px" }}>KD</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "8px 6px", fontWeight: 600 }}>{r.keyword}</td>
              <td style={{ padding: "8px 6px" }}>{fmtNum(r.searchVolume)}</td>
              <td style={{ padding: "8px 6px" }}>{fmtMoney(r.cpc)}</td>
              <td style={{ padding: "8px 6px", color: kdColor(r.difficulty), fontWeight: 700 }}>{fmtNum(r.difficulty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

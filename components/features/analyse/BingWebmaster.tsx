"use client";

// Bing Webmaster Tools — surfaces Bing-specific keyword performance, page
// stats, and site activity alongside Google data for a fuller SEO picture.
// Requires BING_WEBMASTER_API_KEY (set via Manage → Platform APIs).

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

interface Site { Url: string; IsVerified: boolean; }
interface SitesResp { ok: boolean; sites?: Site[]; error?: string; }
interface StatusResp { ok: boolean; configured?: boolean; }

interface PageStat {
  Query: string;
  Impressions: number;
  Clicks: number;
  AvgImpressions: number;
  AvgClicks: number;
  AvgPosition: number;
}
interface PageStatsResp { ok: boolean; pageStats?: PageStat[]; error?: string; }

interface ActivityItem { Date: string; Impressions: number; Clicks: number; }
interface ActivityResp { ok: boolean; activity?: ActivityItem[] | { Impressions?: number; Clicks?: number; Position?: number }; error?: string; }

interface KeywordRow {
  Query: string;
  Impressions: number;
  Clicks: number;
  Ctr: number;
  AvgPosition: number;
}
interface KwResp { ok: boolean; keywords?: KeywordRow[]; error?: string; }

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}
function fmtPos(p: number | null | undefined) {
  if (p == null || p === 0) return "—";
  return p.toFixed(1);
}

export default function BingWebmaster() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [sites, setSites]           = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState("");
  const [tab, setTab]               = useState<"keywords" | "pages" | "activity">("keywords");

  const [keywords, setKeywords]     = useState<KeywordRow[]>([]);
  const [pageStats, setPageStats]   = useState<PageStat[]>([]);
  const [activity, setActivity]     = useState<ActivityItem[] | null>(null);
  const [activitySummary, setActivitySummary] = useState<{ Impressions?: number; Clicks?: number; Position?: number } | null>(null);

  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [sitesError, setSitesError] = useState("");

  useEffect(() => {
    apiGet<StatusResp>("/api/bing-webmaster/status").then(r => {
      setConfigured(!!r.configured);
      if (r.configured) loadSites();
    });
  }, []);

  async function loadSites() {
    const r = await apiGet<SitesResp>("/api/bing-webmaster/sites");
    if (r.ok && r.sites?.length) {
      setSites(r.sites);
      setSelectedSite(r.sites[0]?.Url || "");
    } else {
      setSitesError(r.error || "No verified sites found");
    }
  }

  useEffect(() => {
    if (selectedSite) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite, tab]);

  async function loadData() {
    if (!selectedSite) return;
    setLoading(true);
    setError("");
    try {
      if (tab === "keywords") {
        const r = await apiGet<KwResp>(`/api/bing-webmaster/keywords?siteUrl=${encodeURIComponent(selectedSite)}`);
        if (!r.ok) throw new Error(r.error || "Failed to load keywords");
        setKeywords(r.keywords || []);
      } else if (tab === "pages") {
        const r = await apiGet<PageStatsResp>(`/api/bing-webmaster/page-stats?siteUrl=${encodeURIComponent(selectedSite)}`);
        if (!r.ok) throw new Error(r.error || "Failed to load page stats");
        setPageStats(r.pageStats || []);
      } else {
        const r = await apiGet<ActivityResp>(`/api/bing-webmaster/activity?siteUrl=${encodeURIComponent(selectedSite)}&period=30`);
        if (!r.ok) throw new Error(r.error || "Failed to load activity");
        if (Array.isArray(r.activity)) setActivity(r.activity as ActivityItem[]);
        else setActivitySummary(r.activity as { Impressions?: number; Clicks?: number; Position?: number });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  if (configured === false) {
    return (
      <div className="view-header-wrap">
        <div className="view-header"><div className="container"><div className="vh-inner"><div>
          <h2 className="view-title">🔷 Bing Webmaster Tools</h2>
        </div></div></div></div>
        <div className="container" style={{ paddingTop: 32 }}>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 36, maxWidth: 520 }}>
            <div style={{ fontSize: "2rem", marginBottom: 10 }}>🔷</div>
            <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 8 }}>Bing Webmaster API key not configured</div>
            <div style={{ color: "#64748b", fontSize: "0.88rem", marginBottom: 18 }}>
              To connect Bing Webmaster Tools:
              <ol style={{ paddingLeft: 20, marginTop: 8, lineHeight: 1.8 }}>
                <li>Sign in at <strong>bing.com/webmasters</strong> and verify your site</li>
                <li>Go to <strong>Settings → API Access</strong> and generate an API key</li>
                <li>Add it as <code>BING_WEBMASTER_API_KEY</code> in <strong>Manage → 🔑 Platform APIs</strong></li>
              </ol>
            </div>
            <a href="https://www.bing.com/webmasters/" target="_blank" rel="noreferrer"
              style={{ display: "inline-block", padding: "9px 18px", background: "#0078d4", color: "#fff", borderRadius: 8, fontWeight: 700, fontSize: "0.88rem", textDecoration: "none" }}>
              Open Bing Webmaster Tools ↗
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">SEO</span>{" "}
                <span className="bc-sep">›</span> Bing Webmaster Tools
              </div>
              <h2 className="view-title">🔷 Bing Webmaster Tools</h2>
              <p className="view-sub">
                Bing-specific keyword performance, page rankings, and site
                activity — a free second data source alongside Google Search
                Console.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 20, paddingBottom: 56 }}>

        {/* Site selector */}
        {sites.length > 0 && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.84rem", color: "#64748b", fontWeight: 600 }}>Site:</label>
            <select
              className="form-control"
              style={{ maxWidth: 360 }}
              value={selectedSite}
              onChange={e => setSelectedSite(e.target.value)}
            >
              {sites.map(s => (
                <option key={s.Url} value={s.Url}>{s.Url}</option>
              ))}
            </select>
          </div>
        )}

        {sitesError && (
          <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 8, padding: "10px 14px", fontSize: "0.86rem", color: "#78350f", marginBottom: 14 }}>
            ⚠ {sitesError}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "2px solid #e2e8f0", paddingBottom: 0 }}>
          {(["keywords", "pages", "activity"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "8px 18px", border: 0, background: "none", cursor: "pointer",
                fontWeight: tab === t ? 700 : 500,
                color: tab === t ? "#0078d4" : "#64748b",
                borderBottom: tab === t ? "2px solid #0078d4" : "2px solid transparent",
                marginBottom: -2, fontSize: "0.9rem",
              }}
            >
              {t === "keywords" ? "🔍 Keywords" : t === "pages" ? "📄 Pages" : "📊 Activity"}
            </button>
          ))}
        </div>

        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: "0.86rem", color: "#b91c1c", marginBottom: 14 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: "#64748b" }}>Loading Bing data…</div>
        ) : tab === "keywords" ? (
          <KeywordsTable rows={keywords} />
        ) : tab === "pages" ? (
          <PagesTable rows={pageStats} />
        ) : (
          <ActivityView items={activity} summary={activitySummary} />
        )}
      </div>
    </div>
  );
}

function KeywordsTable({ rows }: { rows: KeywordRow[] }) {
  if (!rows.length) return (
    <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
      <div style={{ fontSize: "2rem", marginBottom: 8 }}>🔍</div>
      No keyword data available for the selected site yet. Bing populates this once your site has search traffic.
    </div>
  );
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.87rem" }}>
        <thead>
          <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
            <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700 }}>Query</th>
            <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>Impressions</th>
            <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>Clicks</th>
            <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>CTR</th>
            <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>Avg Position</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "9px 14px", color: "#334155" }}>{r.Query}</td>
              <td style={{ padding: "9px 14px", textAlign: "right" }}>{fmtNum(r.Impressions)}</td>
              <td style={{ padding: "9px 14px", textAlign: "right" }}>{fmtNum(r.Clicks)}</td>
              <td style={{ padding: "9px 14px", textAlign: "right" }}>
                {r.Ctr != null ? (r.Ctr * 100).toFixed(1) + "%" : "—"}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right" }}>
                <span style={{
                  color: r.AvgPosition <= 3 ? "#16a34a" : r.AvgPosition <= 10 ? "#ca8a04" : "#dc2626",
                  fontWeight: 700,
                }}>
                  #{fmtPos(r.AvgPosition)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PagesTable({ rows }: { rows: PageStat[] }) {
  if (!rows.length) return (
    <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
      No page stats available yet.
    </div>
  );
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.87rem" }}>
        <thead>
          <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
            <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700 }}>Query</th>
            <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>Impressions</th>
            <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>Clicks</th>
            <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>Avg Position</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "9px 14px", color: "#334155" }}>{r.Query}</td>
              <td style={{ padding: "9px 14px", textAlign: "right" }}>{fmtNum(r.Impressions)}</td>
              <td style={{ padding: "9px 14px", textAlign: "right" }}>{fmtNum(r.Clicks)}</td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontWeight: 700 }}>
                #{fmtPos(r.AvgPosition)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityView({
  items,
  summary,
}: {
  items: ActivityItem[] | null;
  summary: { Impressions?: number; Clicks?: number; Position?: number } | null;
}) {
  if (!items && !summary) {
    return <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>No activity data available yet.</div>;
  }
  if (summary) {
    return (
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {[
          { label: "Total Impressions (30d)", value: fmtNum(summary.Impressions), color: "#0078d4" },
          { label: "Total Clicks (30d)", value: fmtNum(summary.Clicks), color: "#16a34a" },
          { label: "Avg Position", value: summary.Position ? "#" + summary.Position.toFixed(1) : "—", color: "#7c3aed" },
        ].map(m => (
          <div key={m.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 22px", flex: "1 1 160px", minWidth: 140 }}>
            <div style={{ color: "#64748b", fontSize: "0.78rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
              {m.label}
            </div>
            <div style={{ fontSize: "1.8rem", fontWeight: 800, color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.87rem" }}>
        <thead>
          <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
            <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700 }}>Date</th>
            <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>Impressions</th>
            <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>Clicks</th>
          </tr>
        </thead>
        <tbody>
          {(items || []).map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "8px 14px" }}>{row.Date}</td>
              <td style={{ padding: "8px 14px", textAlign: "right" }}>{fmtNum(row.Impressions)}</td>
              <td style={{ padding: "8px 14px", textAlign: "right" }}>{fmtNum(row.Clicks)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

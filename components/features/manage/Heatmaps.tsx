"use client";

// Native React port of the legacy `heatmaps` panel (was `window.buildHeatmaps`
// in public/js/ig_manage_pack.js + `#view-heatmaps`). Microsoft Clarity wrapper:
// reads/saves project config and shows derived insights against the existing
// Express API (`GET`/`POST /api/heatmaps/config`, `GET /api/heatmaps/insights`).

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Config {
  project_id?: string;
  has_token?: boolean;
  snippet?: string;
  dashboard_url?: string;
}
interface LandingPage {
  title?: string;
  slug?: string;
  traffic_total?: number;
  conv_total?: number;
}
interface Insights {
  days?: number;
  note?: string;
  byUrl?: unknown[];
  byDevice?: unknown[];
  landingPages?: LandingPage[];
  notes?: string[];
}

export default function Heatmaps() {
  const [config, setConfig] = useState<Config | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pid, setPid] = useState("");
  const [token, setToken] = useState("");

  async function load() {
    setError(null);
    const c = await apiGet<Config>("/api/heatmaps/config");
    const ins = await apiGet<Insights>("/api/heatmaps/insights");
    setConfig(c);
    setInsights(ins);
    setPid(c.project_id || "");
    setToken("");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await apiGet<Config>("/api/heatmaps/config");
        const ins = await apiGet<Insights>("/api/heatmaps/insights");
        if (cancelled) return;
        setConfig(c);
        setInsights(ins);
        setPid(c.project_id || "");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    await apiPost("/api/heatmaps/config", {
      project_id: pid.trim(),
      api_token: token.trim(),
    });
    load();
  }

  if (error) {
    return (
      <div className="view-header-wrap">
        <Header />
        <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
          <div style={{ color: "#DC2626" }}>{error}</div>
        </div>
      </div>
    );
  }

  const c = config;
  const ins = insights;

  return (
    <div className="view-header-wrap">
      <Header />
      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {!c || !ins ? (
          <div style={{ color: "#9CA3AF" }}>Loading…</div>
        ) : (
          <>
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 18,
                marginBottom: 18,
              }}
            >
              <h3 style={{ margin: "0 0 10px", fontFamily: "Sora,sans-serif" }}>
                🔌 Connect Microsoft Clarity (free)
              </h3>
              <p style={{ color: "#6B7280", fontSize: "0.85rem", margin: "0 0 12px" }}>
                1. Sign up at{" "}
                <a
                  href="https://clarity.microsoft.com"
                  target="_blank"
                  rel="noopener"
                  style={{ color: "#0066FF" }}
                >
                  clarity.microsoft.com
                </a>{" "}
                (free, no card). 2. Create a project, copy the <strong>Project ID</strong>. 3.
                (Optional) Generate an API token in Settings → Data Export.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr auto",
                  gap: 8,
                  alignItems: "end",
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      marginBottom: 3,
                    }}
                  >
                    PROJECT ID
                  </label>
                  <input
                    value={pid}
                    onChange={(e) => setPid(e.target.value)}
                    style={{
                      width: "100%",
                      padding: 9,
                      border: "1px solid #D1D5DB",
                      borderRadius: 6,
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      marginBottom: 3,
                    }}
                  >
                    API TOKEN (optional)
                  </label>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={c.has_token ? "(set — replace to update)" : "paste token"}
                    style={{
                      width: "100%",
                      padding: 9,
                      border: "1px solid #D1D5DB",
                      borderRadius: 6,
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <button
                  onClick={save}
                  style={{
                    background: "#0066FF",
                    color: "#fff",
                    border: 0,
                    padding: "10px 22px",
                    borderRadius: 7,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  💾 Save
                </button>
              </div>
            </div>

            {c.snippet && (
              <div
                style={{
                  background: "#FEF3C7",
                  border: "1px solid #FCD34D",
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 18,
                }}
              >
                <div style={{ fontWeight: 800, color: "#92400E", marginBottom: 6 }}>
                  📋 Paste this snippet on your site (before &lt;/head&gt;) to start collecting data
                </div>
                <pre
                  style={{
                    background: "#fff",
                    padding: 10,
                    borderRadius: 6,
                    fontSize: "0.74rem",
                    overflowX: "auto",
                    margin: 0,
                  }}
                >
                  {c.snippet}
                </pre>
              </div>
            )}

            {c.dashboard_url && (
              <a
                href={c.dashboard_url}
                target="_blank"
                rel="noopener"
                style={{
                  display: "inline-block",
                  marginBottom: 18,
                  background: "linear-gradient(135deg,#FF6B35,#F97316)",
                  color: "#fff",
                  padding: "10px 22px",
                  borderRadius: 7,
                  fontWeight: 800,
                  textDecoration: "none",
                }}
              >
                🔗 Open Clarity Dashboard →
              </a>
            )}

            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 18,
              }}
            >
              <h3 style={{ margin: "0 0 12px", fontFamily: "Sora,sans-serif" }}>
                📊 Insights (last {ins.days || 3} day{ins.days === 1 ? "" : "s"})
              </h3>
              {ins.note && (
                <div
                  style={{
                    background: "#F0F9FF",
                    border: "1px solid #BAE6FD",
                    color: "#075985",
                    padding: 10,
                    borderRadius: 6,
                    marginBottom: 14,
                    fontSize: "0.84rem",
                  }}
                >
                  {ins.note}
                </div>
              )}
              {ins.byUrl && ins.byUrl.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Top URLs (Clarity)</div>
                  <pre
                    style={{
                      background: "#F9FAFB",
                      padding: 10,
                      borderRadius: 6,
                      fontSize: "0.78rem",
                      overflowX: "auto",
                    }}
                  >
                    {JSON.stringify(ins.byUrl.slice(0, 8), null, 2)}
                  </pre>
                </div>
              )}
              {ins.byDevice && ins.byDevice.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>By Device</div>
                  <pre
                    style={{
                      background: "#F9FAFB",
                      padding: 10,
                      borderRadius: 6,
                      fontSize: "0.78rem",
                      overflowX: "auto",
                    }}
                  >
                    {JSON.stringify(ins.byDevice, null, 2)}
                  </pre>
                </div>
              )}
              <div>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Your tracked landing pages</div>
                {ins.landingPages && ins.landingPages.length > 0 ? (
                  <table
                    style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}
                  >
                    <thead>
                      <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                        <th style={{ padding: 8 }}>Page</th>
                        <th style={{ padding: 8 }}>Traffic</th>
                        <th style={{ padding: 8 }}>Conversions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ins.landingPages.map((p, i) => (
                        <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                          <td style={{ padding: 8 }}>{p.title || p.slug}</td>
                          <td style={{ padding: 8 }}>{p.traffic_total || 0}</td>
                          <td style={{ padding: 8 }}>{p.conv_total || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ color: "#9CA3AF", fontSize: "0.85rem" }}>
                    No landing pages yet — build some in Reach → Landing Pages.
                  </div>
                )}
              </div>
              {(ins.notes || []).length > 0 && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 10,
                    background: "#FEF2F2",
                    color: "#991B1B",
                    borderRadius: 6,
                    fontSize: "0.78rem",
                  }}
                >
                  {(ins.notes || []).map((n, i) => (
                    <span key={i}>
                      {n}
                      {i < (ins.notes || []).length - 1 ? <br /> : null}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="view-header">
      <div className="container">
        <div className="vh-inner">
          <div>
            <div className="breadcrumb">
              <span className="bc-group">Manage</span> <span className="bc-sep">›</span> Heatmaps
            </div>
            <h2 className="view-title">🔥 Heatmaps + Session Replay</h2>
            <p className="view-sub">
              Free heatmaps, session recordings and rage-click data via Microsoft Clarity. Connect
              once, then see what visitors actually do on your site — alongside your existing
              landing-page list.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

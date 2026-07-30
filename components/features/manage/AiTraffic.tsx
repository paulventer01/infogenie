"use client";

// Native React port of the legacy `ai-traffic` panel (was
// `window.buildAiTrafficMonitor` in public/js/ig_content_traffic.js +
// `#view-ai-traffic`). Reads registered sites and per-site AI-referral stats and
// registers new sites against the existing Express API
// (`/api/ai-traffic/sites`, `/api/ai-traffic/stats`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface Site {
  id: string;
  name: string;
  domain: string;
  created_at: string;
}

interface BySource {
  source: string;
  hits: number;
  share: number;
  icon?: string;
}

interface SiteStats {
  ok?: boolean;
  total?: number;
  trend?: number | null;
  bySource?: BySource[];
}

interface SitesResult {
  ok?: boolean;
  sites?: Site[];
}

export default function AiTraffic() {
  const toast = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [stats, setStats] = useState<SiteStats[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  async function load() {
    setError(null);
    try {
      const sr = await apiGet<SitesResult>("/api/ai-traffic/sites");
      const list = sr.sites || [];
      const st = await Promise.all(
        list.map((s) =>
          apiGet<SiteStats>(
            "/api/ai-traffic/stats?sid=" + encodeURIComponent(s.id),
          ).catch(() => ({ ok: false, total: 0 }) as SiteStats),
        ),
      );
      setSites(list);
      setStats(st);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_error");
      setLoaded(true);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sr = await apiGet<SitesResult>("/api/ai-traffic/sites");
      if (cancelled) return;
      const list = sr.sites || [];
      const st = await Promise.all(
        list.map((s) =>
          apiGet<SiteStats>(
            "/api/ai-traffic/stats?sid=" + encodeURIComponent(s.id),
          ).catch(() => ({ ok: false, total: 0 }) as SiteStats),
        ),
      );
      if (cancelled) return;
      setSites(list);
      setStats(st);
      setLoaded(true);
    })().catch((e) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : "load_error");
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function register() {
    const n = name.trim();
    const d = domain.trim();
    if (!n || !d) {
      toast("⚠️ Name and domain required");
      return;
    }
    setRegistering(true);
    try {
      const r = await apiPost<{ ok: boolean; error?: string }>(
        "/api/ai-traffic/sites",
        { name: n, domain: d },
      );
      if (!r.ok) {
        toast("⚠️ " + (r.error || "failed"));
        return;
      }
      setName("");
      setDomain("");
      toast("✅ Site registered!");
      await load();
    } catch (e) {
      toast("❌ " + (e instanceof Error ? e.message : "error"));
    } finally {
      setRegistering(false);
    }
  }

  function copySnippet(snippet: string) {
    navigator.clipboard
      ?.writeText(snippet)
      .then(() => toast("✅ Snippet copied!"))
      .catch(() => {});
  }

  const totalHits = stats.reduce((a, s) => a + (s.total || 0), 0);
  const allSources: Record<string, number> = {};
  stats.forEach((s) =>
    (s.bySource || []).forEach((b) => {
      allSources[b.source] = (allSources[b.source] || 0) + b.hits;
    }),
  );
  const topSource = Object.entries(allSources).sort((a, b) => b[1] - a[1])[0];

  return (
    <div>
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> AI Traffic Monitor
              </div>
              <h2 className="view-title">🤖 AI Traffic Monitor</h2>
              <p className="view-sub">
                Track referrals from ChatGPT, Perplexity, Claude, Gemini, Copilot
                and 10+ other AI engines. Paste a one-line script on your site and
                see real-time AI referral trends with source breakdown and
                period-over-period growth.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 56 }}
      >
        <div
          style={{
            background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
            borderRadius: 12,
            padding: 18,
            marginBottom: 16,
            color: '#0f172a',
          }}
        >
          <h3
            style={{
              margin: "0 0 6px",
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
            }}
          >
            🤖 AI Traffic Monitor
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: "0.8rem",
              color: "#475569",
              lineHeight: 1.45,
            }}
          >
            Track how much traffic your site receives from ChatGPT, Perplexity,
            Claude, Gemini and other AI engines. Paste a tiny script on your site
            to start tracking.
          </p>
        </div>

        {loaded && sites.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 10,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Total AI Referrals (30d)
              </div>
              <div
                style={{ fontSize: "2rem", fontWeight: 900, color: "#0A1628" }}
              >
                {totalHits.toLocaleString()}
              </div>
            </div>
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 10,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Top AI Source
              </div>
              <div
                style={{ fontSize: "2rem", fontWeight: 900, color: "#0A1628" }}
              >
                {topSource ? topSource[0] : "—"}
              </div>
              {topSource && (
                <div
                  style={{
                    fontSize: "0.74rem",
                    color: "#6B7280",
                    marginTop: 2,
                  }}
                >
                  {topSource[1]} hits
                </div>
              )}
            </div>
          </div>
        )}

        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: "0.84rem",
              fontWeight: 800,
              color: "#0A1628",
              marginBottom: 12,
            }}
          >
            ➕ Register a Site
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr auto",
              gap: 10,
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
                  marginBottom: 4,
                }}
              >
                SITE NAME
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Blog"
                style={{
                  width: "100%",
                  padding: 7,
                  border: "1px solid #D1D5DB",
                  borderRadius: 5,
                  fontSize: "0.84rem",
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
                  marginBottom: 4,
                }}
              >
                DOMAIN
              </label>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="myblog.com"
                style={{
                  width: "100%",
                  padding: 7,
                  border: "1px solid #D1D5DB",
                  borderRadius: 5,
                  fontSize: "0.84rem",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <button
              onClick={register}
              disabled={registering}
              style={{
                padding: "8px 16px",
                background: '#eef4ff',
                border: "none",
                borderRadius: 6,
                color: "#0f172a",
                fontSize: "0.82rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {registering ? "…" : "Register"}
            </button>
          </div>
        </div>

        <div>
          {error ? (
            <div style={{ color: "#991B1B" }}>Error: {error}</div>
          ) : !loaded ? (
            <div style={{ color: "#6B7280" }}>Loading…</div>
          ) : sites.length === 0 ? (
            <div
              style={{
                background: "#F9FAFB",
                border: "1px dashed #D1D5DB",
                borderRadius: 10,
                padding: 28,
                textAlign: "center",
                color: "#6B7280",
              }}
            >
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>🤖</div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                No sites registered yet
              </div>
              <div style={{ fontSize: "0.8rem" }}>
                Register your first site above to start tracking AI referral
                traffic.
              </div>
            </div>
          ) : (
            sites.map((site, i) => {
              const st = stats[i] || {};
              const snippet = `<script src="${origin}/api/ai-traffic/embed.js?sid=${site.id}" async></script>`;
              return (
                <div
                  key={site.id}
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "start",
                      marginBottom: 12,
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontWeight: 800,
                          color: "#0A1628",
                          fontSize: "0.92rem",
                        }}
                      >
                        {site.name}
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "#6B7280" }}>
                        {site.domain} · Registered{" "}
                        {new Date(site.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "1.3rem",
                          fontWeight: 900,
                          color: "#0A1628",
                        }}
                      >
                        {(st.total || 0).toLocaleString()}
                      </span>
                      <span
                        style={{
                          fontSize: "0.68rem",
                          color: "#6B7280",
                          fontWeight: 700,
                        }}
                      >
                        AI hits
                        <br />
                        last 30d
                      </span>
                      {st.trend !== null && st.trend !== undefined && (
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: "0.68rem",
                            fontWeight: 800,
                            background: st.trend >= 0 ? "#ECFDF5" : "#FEF2F2",
                            color: st.trend >= 0 ? "#065F46" : "#991B1B",
                          }}
                        >
                          {st.trend >= 0 ? "↑" : "↓"} {Math.abs(st.trend)}%
                        </span>
                      )}
                    </div>
                  </div>
                  {(st.bySource || []).length ? (
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 12,
                      }}
                    >
                      {(st.bySource || []).map((b, bi) => (
                        <div
                          key={bi}
                          style={{
                            background: "#F9FAFB",
                            border: "1px solid #E5E7EB",
                            borderRadius: 7,
                            padding: "6px 10px",
                            textAlign: "center",
                            minWidth: 70,
                          }}
                        >
                          <div style={{ fontSize: "1rem" }}>{b.icon || "🤖"}</div>
                          <div
                            style={{
                              fontSize: "0.78rem",
                              fontWeight: 700,
                              color: "#0A1628",
                            }}
                          >
                            {b.source}
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "#6B7280" }}>
                            {b.hits} hits · {b.share}%
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: "0.78rem",
                        color: "#9CA3AF",
                        marginBottom: 10,
                      }}
                    >
                      No AI referrals recorded yet.
                    </div>
                  )}
                  <div
                    style={{
                      background: "#F9FAFB",
                      border: "1px solid #E5E7EB",
                      borderRadius: 7,
                      padding: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: "#6B7280",
                        marginBottom: 5,
                      }}
                    >
                      TRACKING SNIPPET — paste in your site &lt;head&gt;
                    </div>
                    <code
                      style={{
                        fontSize: "0.72rem",
                        color: "#374151",
                        wordBreak: "break-all",
                        display: "block",
                      }}
                    >
                      {snippet}
                    </code>
                    <button
                      onClick={() => copySnippet(snippet)}
                      style={{
                        marginTop: 6,
                        padding: "4px 10px",
                        background: "#DBEAFE",
                        border: "none",
                        borderRadius: 5,
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: "#1D4ED8",
                        cursor: "pointer",
                      }}
                    >
                      📋 Copy snippet
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

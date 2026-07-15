"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Visitor {
  id: number;
  company_name: string | null;
  company_domain: string | null;
  company_industry: string | null;
  company_size: string | null;
  company_country: string | null;
  company_linkedin: string | null;
  company_logo: string | null;
  company_description: string | null;
  isp_name: string | null;
  is_company: boolean;
  pages: { url: string; title: string; ts: string }[];
  visit_count: number;
  intent_score: number;
  first_seen: string;
  last_seen: string;
  enriched: boolean;
}

interface Stats {
  today: number;
  week: number;
  high_intent: number;
  pages_today: number;
}

interface SnippetData {
  token: string;
  snippet: string;
  host: string;
}

const INTENT_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: "🔥 High Intent", color: "#DC2626", bg: "#FEF2F2" },
  warm: { label: "⚡ Warm",       color: "#D97706", bg: "#FFFBEB" },
  low:  { label: "👀 Browsing",   color: "#6B7280", bg: "#F9FAFB" },
};

function intentLevel(score: number) {
  if (score >= 70) return "high";
  if (score >= 40) return "warm";
  return "low";
}

function ago(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function CompanyLogo({ logo, name }: { logo: string | null; name: string | null }) {
  const [err, setErr] = useState(false);
  if (!err && logo) {
    return (
      <img
        src={logo}
        alt=""
        onError={() => setErr(true)}
        style={{ width: 28, height: 28, borderRadius: 4, objectFit: "contain",
                 border: "1px solid #E5E7EB", background: "#F9FAFB", flexShrink: 0 }}
      />
    );
  }
  const initials = (name || "?").split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <div style={{ width: 28, height: 28, borderRadius: 4, background: "#EFF6FF",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.68rem", fontWeight: 700, color: "#2563EB", flexShrink: 0 }}>
      {initials}
    </div>
  );
}

export default function VisitorIntel() {
  const [tab, setTab]         = useState<"visitors" | "setup">("visitors");
  const [stats, setStats]     = useState<Stats | null>(null);
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [snippet, setSnippet] = useState<SnippetData | null>(null);
  const [copied, setCopied]   = useState(false);
  const [intent, setIntent]   = useState("all");
  const [days, setDays]       = useState(7);
  const [search, setSearch]   = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [enrolling, setEnrolling] = useState<number | null>(null);
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [s, v] = await Promise.all([
        apiGet<Stats>("/api/visitor-intel/stats"),
        apiGet<{ visitors: Visitor[]; total: number }>(
          `/api/visitor-intel/visitors?intent=${intent}&days=${days}&q=${encodeURIComponent(search)}&limit=50`
        ),
      ]);
      setStats(s);
      setVisitors(v.visitors || []);
      setTotal(v.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [intent, days, search]);

  const loadSnippet = useCallback(async () => {
    try {
      const s = await apiGet<SnippetData>("/api/visitor-intel/snippet");
      setSnippet(s);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "setup") loadSnippet(); }, [tab, loadSnippet]);

  const handleCopy = () => {
    if (!snippet?.snippet) return;
    navigator.clipboard.writeText(snippet.snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleEnroll = async (id: number, name: string | null) => {
    setEnrolling(id);
    try {
      const r = await apiPost<{ message: string }>(`/api/visitor-intel/visitors/${id}/enroll`, {});
      setEnrollMsg(r.message || `${name || "Visitor"} queued for outreach.`);
      setTimeout(() => setEnrollMsg(null), 4000);
    } catch (e) {
      setEnrollMsg("Enroll failed — check your Journey Builder config.");
    } finally {
      setEnrolling(null);
    }
  };

  const handleDelete = async (id: number) => {
    await apiDelete(`/api/visitor-intel/visitors/${id}`);
    setVisitors(v => v.filter(x => x.id !== id));
  };

  if (error) return (
    <div style={{ padding: 40, textAlign: "center", color: "#6B7280" }}>
      <div style={{ fontSize: "2rem", marginBottom: 8 }}>⚠️</div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Could not load Visitor Intelligence</div>
      <div style={{ fontSize: ".85rem" }}>{error}</div>
      <button onClick={load} style={{ marginTop: 16, padding: "8px 20px", borderRadius: 8,
        background: "#2563EB", color: "#fff", border: "none", cursor: "pointer", fontSize: ".9rem" }}>
        Retry
      </button>
    </div>
  );

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1080, margin: "0 auto", fontFamily: "inherit" }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#111827", margin: 0 }}>
          🔍 Visitor Intelligence
        </h1>
        <p style={{ fontSize: ".9rem", color: "#6B7280", margin: "4px 0 0" }}>
          Identify the companies browsing your site and turn them into pipeline.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Companies today",  value: stats?.today ?? "—",       icon: "🏢" },
          { label: "High-intent (7d)", value: stats?.high_intent ?? "—", icon: "🔥" },
          { label: "Total this week",  value: stats?.week ?? "—",        icon: "📅" },
          { label: "Pages tracked today", value: stats?.pages_today ?? "—", icon: "📄" },
        ].map(c => (
          <div key={c.label} style={{ background: "#fff", border: "1px solid #E5E7EB",
            borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: "1.4rem", marginBottom: 4 }}>{c.icon}</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#111827" }}>{c.value}</div>
            <div style={{ fontSize: ".78rem", color: "#6B7280", marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Enroll toast */}
      {enrollMsg && (
        <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8,
          padding: "10px 16px", marginBottom: 16, color: "#15803D", fontSize: ".88rem" }}>
          ✅ {enrollMsg}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "2px solid #E5E7EB" }}>
        {(["visitors", "setup"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "8px 18px", background: "none", border: "none", cursor: "pointer",
              fontWeight: tab === t ? 700 : 400, color: tab === t ? "#2563EB" : "#6B7280",
              borderBottom: tab === t ? "2px solid #2563EB" : "2px solid transparent",
              marginBottom: -2, fontSize: ".9rem", transition: "all .15s" }}>
            {t === "visitors" ? "Live Visitors" : "🛠 Tracking Setup"}
          </button>
        ))}
      </div>

      {/* ── Visitors tab ─────────────────────────────────────────────────── */}
      {tab === "visitors" && (
        <>
          {/* Filters */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text" placeholder="Search company, domain, industry…"
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 200, padding: "8px 12px", border: "1px solid #E5E7EB",
                borderRadius: 8, fontSize: ".88rem", outline: "none" }}
            />
            <select value={intent} onChange={e => setIntent(e.target.value)}
              style={{ padding: "8px 12px", border: "1px solid #E5E7EB", borderRadius: 8,
                fontSize: ".88rem", background: "#fff", cursor: "pointer" }}>
              <option value="all">All intent levels</option>
              <option value="high">🔥 High intent (70+)</option>
              <option value="warm">⚡ Warm (40–69)</option>
              <option value="low">👀 Browsing (&lt;40)</option>
            </select>
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              style={{ padding: "8px 12px", border: "1px solid #E5E7EB", borderRadius: 8,
                fontSize: ".88rem", background: "#fff", cursor: "pointer" }}>
              <option value={1}>Last 24 hours</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <button onClick={load}
              style={{ padding: "8px 16px", background: "#EFF6FF", color: "#2563EB",
                border: "1px solid #BFDBFE", borderRadius: 8, fontSize: ".88rem",
                cursor: "pointer", fontWeight: 600 }}>
              ↻ Refresh
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 60, color: "#9CA3AF" }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>⏳</div>
              Loading visitor data…
            </div>
          ) : visitors.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, background: "#F9FAFB",
              borderRadius: 12, border: "1px dashed #D1D5DB" }}>
              <div style={{ fontSize: "3rem", marginBottom: 12 }}>🔍</div>
              <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#374151", marginBottom: 8 }}>
                No visitors identified yet
              </div>
              <div style={{ color: "#6B7280", fontSize: ".9rem", maxWidth: 380, margin: "0 auto" }}>
                Add the tracking pixel to your website and companies will start appearing here within minutes of their first visit.
              </div>
              <button onClick={() => setTab("setup")}
                style={{ marginTop: 20, padding: "10px 24px", background: "#2563EB", color: "#fff",
                  border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: ".9rem" }}>
                Set up tracking pixel →
              </button>
            </div>
          ) : (
            <>
              <div style={{ fontSize: ".82rem", color: "#6B7280", marginBottom: 10 }}>
                {total} companies found
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {visitors.map(v => {
                  const level  = intentLevel(v.intent_score);
                  const badge  = INTENT_LABEL[level];
                  const isOpen = expanded === v.id;
                  const displayName = v.company_name || v.isp_name || v.company_domain || "Unknown visitor";

                  return (
                    <div key={v.id} style={{ background: "#fff", border: "1px solid #E5E7EB",
                      borderRadius: 10, overflow: "hidden",
                      boxShadow: isOpen ? "0 2px 12px rgba(0,0,0,.06)" : "none",
                      transition: "box-shadow .2s" }}>

                      {/* Row */}
                      <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 12,
                        cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : v.id)}>

                        <CompanyLogo logo={v.company_logo} name={displayName} />

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: ".9rem", color: "#111827",
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {displayName}
                            {!v.is_company && (
                              <span style={{ marginLeft: 6, fontSize: ".72rem", color: "#9CA3AF",
                                fontWeight: 400 }}>(residential / ISP)</span>
                            )}
                          </div>
                          <div style={{ fontSize: ".78rem", color: "#6B7280", marginTop: 1 }}>
                            {[v.company_industry, v.company_size ? `${v.company_size} employees` : null,
                              v.company_country].filter(Boolean).join(" · ")}
                          </div>
                        </div>

                        <div style={{ textAlign: "center", minWidth: 70 }}>
                          <div style={{ fontWeight: 700, fontSize: "1rem", color: "#111827" }}>
                            {v.visit_count}
                          </div>
                          <div style={{ fontSize: ".72rem", color: "#6B7280" }}>
                            {v.visit_count === 1 ? "page" : "pages"}
                          </div>
                        </div>

                        <div style={{ textAlign: "center", minWidth: 60 }}>
                          <div style={{ fontWeight: 700, fontSize: "1rem",
                            color: level === "high" ? "#DC2626" : level === "warm" ? "#D97706" : "#6B7280" }}>
                            {v.intent_score}
                          </div>
                          <div style={{ fontSize: ".72rem", color: "#6B7280" }}>score</div>
                        </div>

                        <div style={{ minWidth: 90, textAlign: "center" }}>
                          <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 20,
                            fontSize: ".72rem", fontWeight: 600,
                            background: badge.bg, color: badge.color }}>
                            {badge.label}
                          </span>
                        </div>

                        <div style={{ minWidth: 80, fontSize: ".78rem", color: "#6B7280", textAlign: "right" }}>
                          {ago(v.last_seen)}
                        </div>

                        <div style={{ fontSize: ".85rem", color: "#9CA3AF", marginLeft: 4 }}>
                          {isOpen ? "▲" : "▼"}
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isOpen && (
                        <div style={{ borderTop: "1px solid #F3F4F6", padding: "14px 16px",
                          background: "#FAFAFA", display: "flex", gap: 20, flexWrap: "wrap" }}>

                          <div style={{ flex: 2, minWidth: 220 }}>
                            <div style={{ fontWeight: 600, fontSize: ".82rem", color: "#374151",
                              marginBottom: 8 }}>Pages visited</div>
                            {v.pages.length === 0 ? (
                              <div style={{ color: "#9CA3AF", fontSize: ".8rem" }}>No pages recorded</div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                {v.pages.slice(0, 8).map((pg, i) => (
                                  <div key={i} style={{ fontSize: ".8rem", color: "#374151",
                                    display: "flex", gap: 8, alignItems: "flex-start" }}>
                                    <span style={{ color: "#9CA3AF", minWidth: 14, fontSize: ".75rem" }}>
                                      {i + 1}.
                                    </span>
                                    <div>
                                      <div style={{ color: "#1D4ED8", wordBreak: "break-all" }}>
                                        {pg.title || pg.url}
                                      </div>
                                      <div style={{ color: "#9CA3AF", fontSize: ".73rem" }}>
                                        {pg.url !== pg.title ? pg.url : ""} · {ago(pg.ts)}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {v.pages.length > 8 && (
                                  <div style={{ fontSize: ".77rem", color: "#9CA3AF" }}>
                                    +{v.pages.length - 8} more pages
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {v.company_description && (
                            <div style={{ flex: 2, minWidth: 200 }}>
                              <div style={{ fontWeight: 600, fontSize: ".82rem", color: "#374151",
                                marginBottom: 6 }}>About</div>
                              <div style={{ fontSize: ".82rem", color: "#6B7280", lineHeight: 1.5 }}>
                                {v.company_description}
                              </div>
                              {v.company_linkedin && (
                                <a href={v.company_linkedin} target="_blank" rel="noreferrer"
                                  style={{ display: "inline-flex", alignItems: "center", gap: 4,
                                    marginTop: 8, fontSize: ".8rem", color: "#0077B5", textDecoration: "none" }}>
                                  🔷 LinkedIn profile →
                                </a>
                              )}
                            </div>
                          )}

                          <div style={{ display: "flex", flexDirection: "column", gap: 8,
                            justifyContent: "flex-start", minWidth: 160 }}>
                            <button
                              onClick={() => handleEnroll(v.id, v.company_name)}
                              disabled={enrolling === v.id}
                              style={{ padding: "8px 14px", background: "#2563EB", color: "#fff",
                                border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600,
                                fontSize: ".82rem", opacity: enrolling === v.id ? .6 : 1 }}>
                              {enrolling === v.id ? "Queuing…" : "🚀 Start outreach"}
                            </button>
                            <button
                              onClick={() => handleDelete(v.id)}
                              style={{ padding: "7px 14px", background: "none", color: "#9CA3AF",
                                border: "1px solid #E5E7EB", borderRadius: 8, cursor: "pointer",
                                fontSize: ".82rem" }}>
                              Remove
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Setup tab ────────────────────────────────────────────────────── */}
      {tab === "setup" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10,
            padding: "16px 20px" }}>
            <div style={{ fontWeight: 700, fontSize: ".95rem", color: "#1E40AF", marginBottom: 6 }}>
              How it works
            </div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: ".88rem", color: "#1D4ED8",
              lineHeight: 1.8 }}>
              <li>Copy the snippet below and paste it into the <code>&lt;head&gt;</code> of every page on your website</li>
              <li>When someone visits your site, InfoGenie identifies their company using IP intelligence</li>
              <li>Companies appear in the Visitors tab with intent scores based on which pages they browse</li>
              <li>Click <strong>Start outreach</strong> to route high-intent companies into your Journey Builder</li>
            </ol>
          </div>

          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
            padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: ".95rem", color: "#111827" }}>
                Your tracking snippet
              </div>
              <button onClick={handleCopy}
                style={{ padding: "7px 16px", background: copied ? "#F0FDF4" : "#2563EB",
                  color: copied ? "#15803D" : "#fff", border: copied ? "1px solid #BBF7D0" : "none",
                  borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: ".85rem",
                  transition: "all .2s" }}>
                {copied ? "✓ Copied!" : "Copy snippet"}
              </button>
            </div>
            {snippet ? (
              <pre style={{ background: "#1E293B", color: "#E2E8F0", borderRadius: 8, padding: 16,
                fontSize: ".78rem", lineHeight: 1.7, overflowX: "auto", margin: 0,
                whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {snippet.snippet}
              </pre>
            ) : (
              <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>Loading snippet…</div>
            )}
            <div style={{ marginTop: 12, fontSize: ".8rem", color: "#9CA3AF" }}>
              Paste this into your website's <code>&lt;head&gt;</code> tag — works with any CMS, Webflow, WordPress, Shopify, or custom HTML.
            </div>
          </div>

          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10,
            padding: "14px 18px" }}>
            <div style={{ fontWeight: 600, fontSize: ".88rem", color: "#92400E", marginBottom: 4 }}>
              ⚠️ Privacy note
            </div>
            <div style={{ fontSize: ".83rem", color: "#78350F", lineHeight: 1.6 }}>
              This feature identifies companies at the IP level — not individual people. Make sure your website's privacy policy mentions that you use analytics tools to identify company-level visitors for B2B outreach purposes. This is standard practice for B2B intent data (used by Clearbit Reveal, Leadfeeder, Warmly, etc.).
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

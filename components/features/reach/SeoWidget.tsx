"use client";

// Native React port of the legacy `seo-widget` panel (was `window.buildSeoWidget`
// in public/js/ig_seo.js + `#view-seo-widget` in index.html). Generates an
// embeddable SEO-audit lead-capture widget and lists captured leads, backed by
// the existing Express API (`/api/seo-widget/*`) via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Site {
  id: string;
  name: string;
  accent: string;
  lead_count: number;
}

interface SitesResult {
  ok: boolean;
  error?: string;
  sites: Site[];
}

interface Lead {
  email: string;
  url: string;
  score: number;
  grade: string;
  created_at: string;
}

interface LeadsResult {
  ok: boolean;
  error?: string;
  leads: Lead[];
}

function fmtN(v: number | undefined): string {
  return Number(v || 0).toLocaleString();
}

function safeUrl(u: string): string {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) ? x.href : "#";
  } catch {
    return "#";
  }
}

export default function SeoWidget() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [name, setName] = useState("");
  const [accent, setAccent] = useState("#0066FF");
  const [ctaText, setCtaText] = useState("Get my free SEO audit");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [leadsMap, setLeadsMap] = useState<Record<string, Lead[]>>({});
  const [leadsEmpty, setLeadsEmpty] = useState<Record<string, boolean>>({});

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function loadSites() {
    const r = await apiGet<SitesResult>("/api/seo-widget/sites");
    if (!r.ok) {
      setSites([]);
      return;
    }
    setSites(r.sites || []);
  }

  useEffect(() => {
    loadSites();
  }, []);

  async function createSite() {
    if (!name.trim()) {
      alert("Site name required");
      return;
    }
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/seo-widget/sites", {
      name: name.trim(),
      accent,
      ctaText: ctaText.trim(),
      ownerEmail: ownerEmail.trim(),
    });
    if (!r.ok) {
      alert(r.error);
      return;
    }
    setName("");
    loadSites();
  }

  async function deleteSite(id: string) {
    if (!confirm("Delete this widget? Leads will be removed too.")) return;
    await apiDelete(`/api/seo-widget/sites/${id}`);
    loadSites();
  }

  async function viewLeads(id: string) {
    const r = await apiGet<LeadsResult>(`/api/seo-widget/sites/${id}/leads`);
    if (!r.ok || !r.leads.length) {
      setLeadsMap((m) => ({ ...m, [id]: [] }));
      setLeadsEmpty((m) => ({ ...m, [id]: true }));
      return;
    }
    setLeadsMap((m) => ({ ...m, [id]: r.leads }));
    setLeadsEmpty((m) => ({ ...m, [id]: false }));
  }

  function snippetFor(id: string) {
    return `<div id="infogenie-seo-widget"></div>\n<script src="${origin}/api/seo-widget/embed/${id}.js" async></script>`;
  }

  async function copySnippet(id: string) {
    try {
      await navigator.clipboard.writeText(snippetFor(id));
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  const labelStyle = {
    display: "block",
    fontSize: "0.66rem",
    fontWeight: 700,
    color: "#6B7280",
    marginBottom: 3,
  } as const;
  const inputStyle = {
    width: "100%",
    padding: 8,
    border: "1px solid #D1D5DB",
    borderRadius: 5,
    fontSize: "0.84rem",
    boxSizing: "border-box",
  } as const;

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> Embeddable Audit Widget
              </div>
              <h2 className="view-title">🧩 Embeddable Audit Widget</h2>
              <p className="view-sub">
                Generate a copy-pasteable script tag for your own marketing site. Visitors enter a URL → get a teaser SEO
                score → leave their email for the full report. Every lead is captured and listed below.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
            marginBottom: 18,
          }}
        >
          <h3 style={{ margin: "0 0 12px", fontSize: "1rem", color: "#0A1628" }}>➕ Create a new widget</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 2fr 2fr 1fr",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
              <label style={labelStyle}>SITE NAME</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Agency" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>ACCENT</label>
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                style={{ width: "100%", height: 35, padding: 2, border: "1px solid #D1D5DB", borderRadius: 5, boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={labelStyle}>CTA TEXT</label>
              <input value={ctaText} onChange={(e) => setCtaText(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>YOUR EMAIL (opt.)</label>
              <input
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="you@agency.com"
                style={inputStyle}
              />
            </div>
            <div>
              <button
                onClick={createSite}
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg,#0f766e,#0066FF)",
                  color: "#fff",
                  border: "none",
                  padding: "9px 14px",
                  borderRadius: 6,
                  fontSize: "0.82rem",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>

        <div>
          {sites === null ? null : sites.length === 0 ? (
            <div style={{ color: "#9CA3AF", textAlign: "center", padding: 30 }}>
              No widgets yet — create your first one above.
            </div>
          ) : (
            sites.map((s) => {
              const leads = leadsMap[s.id];
              const isEmpty = leadsEmpty[s.id];
              return (
                <div
                  key={s.id}
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: 18,
                    marginBottom: 14,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12, marginBottom: 12 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: "1.04rem", color: "#0A1628" }}>
                        {s.name}{" "}
                        <span
                          style={{
                            background: s.accent,
                            display: "inline-block",
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            verticalAlign: "middle",
                            marginLeft: 6,
                          }}
                        />
                      </h3>
                      <div style={{ fontSize: "0.74rem", color: "#6B7280", marginTop: 3 }}>
                        ID: <code style={{ fontSize: "0.72rem" }}>{s.id}</code> · {fmtN(s.lead_count)} leads captured
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => viewLeads(s.id)}
                        style={{
                          background: "#fff",
                          border: "1px solid #D1D5DB",
                          color: "#374151",
                          padding: "6px 12px",
                          borderRadius: 5,
                          fontSize: "0.76rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        👥 Leads ({fmtN(s.lead_count)})
                      </button>
                      <button
                        onClick={() => deleteSite(s.id)}
                        style={{
                          background: "#fff",
                          border: "1px solid #FCA5A5",
                          color: "#B91C1C",
                          padding: "6px 12px",
                          borderRadius: 5,
                          fontSize: "0.76rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 700, marginBottom: 5 }}>
                    📋 EMBED SNIPPET — paste anywhere on your marketing site
                  </div>
                  <pre
                    style={{
                      background: '#eef4ff',
                      color: '#0f766e',
                      padding: 12,
                      borderRadius: 8,
                      fontSize: "0.74rem",
                      lineHeight: 1.5,
                      overflowX: "auto",
                      margin: 0,
                    }}
                  >
                    <code>{snippetFor(s.id)}</code>
                  </pre>
                  <button
                    onClick={() => copySnippet(s.id)}
                    style={{
                      background: "#0066FF",
                      color: "#0f172a",
                      border: "none",
                      padding: "6px 14px",
                      borderRadius: 5,
                      fontSize: "0.76rem",
                      fontWeight: 700,
                      cursor: "pointer",
                      marginTop: 8,
                    }}
                  >
                    {copiedId === s.id ? "✓ Copied" : "📋 Copy snippet"}
                  </button>
                  <div style={{ marginTop: 14 }}>
                    {isEmpty ? (
                      <div style={{ color: "#9CA3AF", fontSize: "0.78rem", padding: 8 }}>No leads yet.</div>
                    ) : leads && leads.length ? (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                        <thead>
                          <tr style={{ background: "#F9FAFB" }}>
                            <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>Email</th>
                            <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>URL Audited</th>
                            <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>Score</th>
                            <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>When</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leads.map((l, i) => (
                            <tr key={i}>
                              <td style={{ padding: 6, borderBottom: "1px solid #F3F4F6" }}>{l.email}</td>
                              <td style={{ padding: 6, borderBottom: "1px solid #F3F4F6" }}>
                                <a
                                  href={safeUrl(l.url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: "#0066FF", textDecoration: "none" }}
                                >
                                  {l.url.slice(0, 50)}↗
                                </a>
                              </td>
                              <td style={{ padding: 6, borderBottom: "1px solid #F3F4F6" }}>
                                <strong>{fmtN(l.score)}</strong> · {l.grade}
                              </td>
                              <td style={{ padding: 6, borderBottom: "1px solid #F3F4F6" }}>
                                {new Date(l.created_at).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
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

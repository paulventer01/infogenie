"use client";

// Native React port of the legacy `link-prospector` panel (was
// `window.buildLinkProspector` + `#view-link-prospector` / `#lpWrap` in
// public/js/ig_intel_pack_b.js). Finds link-building prospects for a keyword +
// domain via the existing Express API through `lib/api`:
//   POST   /api/link-prospector/find       { keyword, domain }
//   GET    /api/link-prospector/runs
//   GET    /api/link-prospector/runs/:id
//   DELETE /api/link-prospector/runs/:id
// The "Draft" button hands a prospect to the Cold Email Writer view via the
// legacy `window._cePreset` global + cross-view navigation. The domain may be
// pre-filled by the Backlink Intel view through `window._lpPresetDomain`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Prospect {
  url?: string;
  title?: string;
  domain?: string;
  domain_strength?: string;
  content_relevance?: number;
  links_to_competitor?: boolean;
  contact_email?: string;
  contact_twitter?: string;
  priority_label?: string;
  priority_score?: number;
  outreach_angle?: string;
}
interface FindResult {
  ok: boolean;
  error?: string;
  prospects?: Prospect[];
  keyword?: string;
  domain?: string;
  total_found?: number;
  source?: string;
}
interface RunRow {
  id: number;
  keyword: string;
  domain: string;
  created_at: string;
  total_found?: number;
}
interface RunsResult {
  ok: boolean;
  runs?: RunRow[];
}
interface RunDetail {
  keyword?: string;
  domain?: string;
  prospects?: Prospect[];
}
interface RunResult {
  ok: boolean;
  error?: string;
  run?: RunDetail;
}

function safeUrl(u: string | undefined): string {
  if (!u) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(u) ? u : "https://" + u);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

export default function LinkProspector() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [domain, setDomain] = useState("");
  const [strengthFilter, setStrengthFilter] = useState("");
  const [relevanceFilter, setRelevanceFilter] = useState("0");

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState("");
  const [lastProspects, setLastProspects] = useState<Prospect[]>([]);
  const [source, setSource] = useState("");
  const [runs, setRuns] = useState<RunRow[]>([]);

  useEffect(() => {
    const preset = (window as unknown as { _lpPresetDomain?: string })
      ._lpPresetDomain;
    if (preset) {
      setDomain(preset);
      (window as unknown as { _lpPresetDomain?: string | null })._lpPresetDomain =
        null;
    }
    loadHistory();
  }, []);

  async function loadHistory() {
    const r = await apiGet<RunsResult>("/api/link-prospector/runs");
    setRuns(r.ok ? r.runs || [] : []);
  }

  async function find() {
    const k = keyword.trim();
    const d = domain.trim();
    if (!k) {
      setStatus("error");
      setError("⚠ Enter a keyword");
      return;
    }
    if (!d) {
      setStatus("error");
      setError("⚠ Enter your domain");
      return;
    }
    setStatus("loading");
    setError("");
    const r = await apiPost<FindResult>("/api/link-prospector/find", {
      keyword: k,
      domain: d,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setLastProspects(r.prospects || []);
    setSource(r.source || "");
    setStatus("done");
    loadHistory();
  }

  async function loadRun(id: number) {
    const r = await apiGet<RunResult>(`/api/link-prospector/runs/${id}`);
    if (!r.ok || !r.run) return;
    setLastProspects(r.run.prospects || []);
    setKeyword(r.run.keyword || "");
    setDomain(r.run.domain || "");
    setSource("");
    setStatus("done");
  }

  async function deleteRun(id: number) {
    if (!confirm("Delete this prospecting run?")) return;
    await apiDelete(`/api/link-prospector/runs/${id}`);
    loadHistory();
  }

  function draft(p: Prospect) {
    (
      window as unknown as {
        _cePreset?: {
          target_company: string;
          target_pain: string;
          sender_offer: string;
        };
      }
    )._cePreset = {
      target_company: p.domain || "",
      target_pain: `They published "${p.title || ""}" and may be interested in linking to content from ${domain} — ${p.outreach_angle || ""}`,
      sender_offer: `Link-worthy content on ${keyword}`,
    };
    goToView(router, "cold-email");
  }

  const relevanceNum = parseInt(relevanceFilter, 10) || 0;
  const filtered = lastProspects.filter((p) => {
    if (strengthFilter === "high" && p.domain_strength !== "high") return false;
    if (
      strengthFilter === "medium" &&
      !(p.domain_strength === "high" || p.domain_strength === "medium")
    )
      return false;
    if (relevanceNum > 0 && (p.content_relevance || 0) < relevanceNum)
      return false;
    return true;
  });

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Link Prospector
              </div>
              <h2 className="view-title">🎯 Link Prospector</h2>
              <p className="view-sub">
                Enter a keyword and your domain — get a ranked list of 10-20 pages
                most likely to link to you, enriched with domain strength, content
                relevance, competitor link history, and contact details. One click
                sends any prospect to the Cold Email Writer.
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
            padding: 20,
            marginBottom: 20,
          }}
        >
          <h3
            style={{
              margin: "0 0 14px",
              color: "#0A1628",
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
              fontWeight: 800,
            }}
          >
            🎯 Find Link Prospects
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
              <label style={fieldLabel}>TARGET KEYWORD</label>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="e.g. best email marketing tools"
                style={fieldInput}
              />
            </div>
            <div>
              <label style={fieldLabel}>YOUR DOMAIN</label>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="e.g. yoursite.com"
                style={fieldInput}
              />
            </div>
            <button
              onClick={find}
              disabled={status === "loading"}
              style={{
                background: "linear-gradient(135deg,#3B82F6,#1D4ED8)",
                color: "#fff",
                border: "none",
                padding: "9px 22px",
                borderRadius: 8,
                fontSize: "0.84rem",
                fontWeight: 800,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              🎯 Find Prospects
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            <label
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6B7280",
                marginRight: 8,
              }}
            >
              FILTER:
            </label>
            <select
              value={strengthFilter}
              onChange={(e) => setStrengthFilter(e.target.value)}
              style={{
                padding: "4px 8px",
                border: "1px solid #D1D5DB",
                borderRadius: 5,
                fontSize: "0.78rem",
                marginRight: 8,
              }}
            >
              <option value="">All strengths</option>
              <option value="high">High only</option>
              <option value="medium">Medium+</option>
            </select>
            <label
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6B7280",
                marginRight: 4,
              }}
            >
              Min relevance:
            </label>
            <select
              value={relevanceFilter}
              onChange={(e) => setRelevanceFilter(e.target.value)}
              style={{
                padding: "4px 8px",
                border: "1px solid #D1D5DB",
                borderRadius: 5,
                fontSize: "0.78rem",
              }}
            >
              <option value="0">Any</option>
              <option value="60">60+</option>
              <option value="70">70+</option>
              <option value="80">80+</option>
            </select>
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                background: "#EFF6FF",
                borderRadius: 12,
                color: "#1D4ED8",
              }}
            >
              <div style={{ fontSize: "1.8rem", marginBottom: 10 }}>🎯</div>
              <div style={{ fontSize: "0.85rem" }}>
                Finding link prospects for <strong>{keyword}</strong>…
                <br />
                <span style={{ opacity: 0.7 }}>
                  DataForSEO SERP + Perplexity + GPT-4o-mini · 30-60s
                </span>
              </div>
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              ⚠ {error}
            </div>
          )}
          {status === "done" && (
            <ProspectTable
              prospects={filtered}
              source={source}
              onDraft={draft}
            />
          )}
        </div>

        <div style={{ marginTop: 28 }}>
          {runs.length > 0 && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  color: "#0A1628",
                  fontSize: "0.88rem",
                  marginBottom: 12,
                }}
              >
                🕑 Recent Prospecting Runs
              </div>
              <div>
                {runs.map((row) => (
                  <div
                    key={row.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 0",
                      borderBottom: "1px solid #F3F4F6",
                      gap: 10,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: "0.82rem",
                          fontWeight: 700,
                          color: "#0A1628",
                        }}
                      >
                        {row.keyword} → {row.domain}
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>
                        {new Date(row.created_at).toLocaleString()} ·{" "}
                        {row.total_found || 0} prospects
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => loadRun(row.id)}
                        style={{
                          background: "#EFF6FF",
                          border: "1px solid #BFDBFE",
                          color: "#1D4ED8",
                          padding: "4px 10px",
                          borderRadius: 5,
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        📂 Load
                      </button>
                      <button
                        onClick={() => deleteRun(row.id)}
                        style={{
                          background: "#FEF2F2",
                          border: "1px solid #FECACA",
                          color: "#991B1B",
                          padding: "4px 10px",
                          borderRadius: 5,
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
  marginBottom: 4,
};
const fieldInput: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  fontSize: "0.84rem",
  boxSizing: "border-box",
};

function StrengthPill({ s }: { s: string }) {
  const cfg: Record<string, [string, string, string]> = {
    high: ["#ECFDF5", "#065F46", "High"],
    medium: ["#FEF3C7", "#92400E", "Medium"],
    low: ["#F3F4F6", "#374151", "Low"],
  };
  const c = cfg[s] || cfg.low;
  return (
    <span
      style={{
        background: c[0],
        color: c[1],
        padding: "2px 7px",
        borderRadius: 4,
        fontSize: "0.65rem",
        fontWeight: 800,
      }}
    >
      {c[2]}
    </span>
  );
}

function PriorityPill({ label, score }: { label: string; score: number }) {
  const col = label === "High" ? "#065F46" : label === "Medium" ? "#92400E" : "#374151";
  const bg = label === "High" ? "#ECFDF5" : label === "Medium" ? "#FEF3C7" : "#F3F4F6";
  return (
    <span
      style={{
        background: bg,
        color: col,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: "0.65rem",
        fontWeight: 800,
      }}
    >
      {score ? `${score} · ` : ""}
      {label}
    </span>
  );
}

const thProspect: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  color: "#6B7280",
  fontSize: "0.65rem",
  fontWeight: 800,
};

function ProspectTable({
  prospects,
  source,
  onDraft,
}: {
  prospects: Prospect[];
  source: string;
  onDraft: (p: Prospect) => void;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #E5E7EB",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.88rem" }}>
          🎯 {prospects.length} Link Prospects
          {source === "template" && (
            <span
              style={{ fontSize: "0.7rem", color: "#9CA3AF", fontWeight: 400 }}
            >
              {" "}
              (demo data — connect DataForSEO for live results)
            </span>
          )}
        </div>
      </div>
      {prospects.length ? (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.82rem",
            }}
          >
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                <th style={thProspect}>#</th>
                <th style={thProspect}>PAGE / DOMAIN</th>
                <th style={thProspect}>STRENGTH</th>
                <th style={thProspect}>RELEVANCE</th>
                <th style={thProspect}>LINKS COMPETITORS</th>
                <th style={thProspect}>CONTACT</th>
                <th style={thProspect}>PRIORITY</th>
                <th style={thProspect}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p, i) => {
                const url = safeUrl(p.url);
                return (
                  <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                    <td
                      style={{
                        padding: "10px 12px",
                        verticalAlign: "top",
                        width: 36,
                        color: "#9CA3AF",
                        fontSize: "0.75rem",
                        textAlign: "center",
                      }}
                    >
                      {i + 1}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        verticalAlign: "top",
                        maxWidth: 260,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.82rem",
                          lineHeight: 1.35,
                          marginBottom: 3,
                        }}
                      >
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: "#0066FF",
                              fontWeight: 700,
                              textDecoration: "none",
                            }}
                          >
                            {p.title || p.url}
                          </a>
                        ) : (
                          p.title || p.url
                        )}
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "#6B7280" }}>
                        {p.domain || ""}
                      </div>
                      {p.outreach_angle && (
                        <div
                          style={{
                            fontSize: "0.69rem",
                            color: "#6B7280",
                            marginTop: 3,
                            fontStyle: "italic",
                          }}
                        >
                          &quot;{p.outreach_angle}&quot;
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        verticalAlign: "top",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <StrengthPill s={p.domain_strength || "low"} />
                    </td>
                    <td style={{ padding: "10px 12px", verticalAlign: "top" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <div
                          style={{
                            width: 60,
                            height: 6,
                            background: "#E5E7EB",
                            borderRadius: 3,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${p.content_relevance || 0}%`,
                              height: "100%",
                              background: "#3B82F6",
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: "0.72rem",
                            color: "#374151",
                            fontWeight: 700,
                          }}
                        >
                          {p.content_relevance || 0}
                        </span>
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        verticalAlign: "top",
                        textAlign: "center",
                      }}
                    >
                      {p.links_to_competitor ? (
                        <span
                          style={{
                            fontSize: "0.72rem",
                            background: "#FEF3C7",
                            color: "#92400E",
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontWeight: 700,
                          }}
                        >
                          ✓ Yes
                        </span>
                      ) : (
                        <span style={{ color: "#9CA3AF", fontSize: "0.72rem" }}>
                          —
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", verticalAlign: "top" }}>
                      {p.contact_email ? (
                        <span style={{ fontSize: "0.7rem", color: "#0066FF" }}>
                          {p.contact_email}
                        </span>
                      ) : p.contact_twitter ? (
                        <span style={{ fontSize: "0.7rem", color: "#1DA1F2" }}>
                          {p.contact_twitter}
                        </span>
                      ) : (
                        <span style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>
                          —
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        verticalAlign: "top",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <PriorityPill
                        label={p.priority_label || "Medium"}
                        score={p.priority_score || 0}
                      />
                    </td>
                    <td style={{ padding: "10px 12px", verticalAlign: "top" }}>
                      <button
                        onClick={() => onDraft(p)}
                        style={{
                          background: "#EFF6FF",
                          border: "1px solid #BFDBFE",
                          color: "#1D4ED8",
                          padding: "4px 10px",
                          borderRadius: 5,
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ✉️ Draft
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: "#9CA3AF",
            fontSize: "0.85rem",
          }}
        >
          No prospects match your filters.
        </div>
      )}
    </div>
  );
}

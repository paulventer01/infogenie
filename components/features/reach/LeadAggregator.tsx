"use client";

// Native React port of the legacy `lead-aggregator` panel (was
// `window.buildLeadAggregator` + `#view-lead-aggregator` in index.html, built in
// public/js/ig_intelligence_tools.js). Sweeps leads from AI web research and
// Apollo simultaneously via the existing Express API:
//   GET  /api/lead-aggregator/sources  — list active lead sources
//   POST /api/lead-aggregator/sweep    — run the multi-source sweep
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Source {
  available: boolean;
  label: string;
}

interface SourcesResult {
  ok: boolean;
  error?: string;
  sources?: Source[];
}

interface AggLead {
  name?: string;
  title?: string;
  company?: string;
  location?: string;
  email?: string;
  linkedin_url?: string;
  score?: number | string;
  source?: string;
  [key: string]: unknown;
}

interface SweepResult {
  ok: boolean;
  error?: string;
  total?: number;
  with_email?: number;
  with_linkedin?: number;
  source_counts?: Record<string, number>;
  leads?: AggLead[];
}

const COLUMNS = [
  "name",
  "title",
  "company",
  "location",
  "email",
  "linkedin_url",
  "score",
  "source",
] as const;

function Badge({
  label,
  color,
}: {
  label: string;
  color: "green" | "blue" | "purple" | "gray";
}) {
  const map: Record<string, [string, string]> = {
    green: ["#D1FAE5", "#065F46"],
    blue: ["#DBEAFE", "#1E40AF"],
    purple: ["#EDE9FE", "#5B21B6"],
    gray: ["#F3F4F6", "#374151"],
  };
  const [bg, fg] = map[color] || map.gray;
  return (
    <span
      style={{
        background: bg,
        color: fg,
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

export default function LeadAggregator() {
  const [industry, setIndustry] = useState("");
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [size, setSize] = useState("");
  const [sources, setSources] = useState<Source[] | null>(null);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiGet<SourcesResult>("/api/lead-aggregator/sources").then((d) => {
      if (d.ok && d.sources) setSources(d.sources);
    });
  }, []);

  async function sweep() {
    setLoading(true);
    setError("");
    setResult(null);
    const d = await apiPost<SweepResult>("/api/lead-aggregator/sweep", {
      industry: industry.trim(),
      role: role.trim(),
      location: location.trim(),
      company_size: size,
    });
    setLoading(false);
    if (!d.ok) {
      setError(d.error || "Sweep failed");
      return;
    }
    setResult(d);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid #D1D5DB",
    borderRadius: 7,
    fontSize: 13,
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#374151",
    marginBottom: 5,
  };

  const leads = result?.leads || [];

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span>{" "}
                Multi-Source Lead Sweep
              </div>
              <h2 className="view-title">🌐 Multi-Source Lead Aggregator</h2>
              <p className="view-sub">
                Sweep leads from AI web research and Apollo simultaneously. Deduplicates, scores, and
                ranks results — then push your best leads directly to HubSpot.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div>
            <label style={labelStyle}>Industry</label>
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="SaaS, FinTech…"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Target Role</label>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="VP Marketing, CMO…"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Location</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="United States, London…"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Company Size</label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              style={{ ...inputStyle, padding: 9 }}
            >
              <option value="">Any</option>
              <option value="1-10">1-10</option>
              <option value="11-50">11-50</option>
              <option value="51-200">51-200</option>
              <option value="201-1000">201-1000</option>
              <option value="1000+">1000+</option>
            </select>
          </div>
        </div>

        {sources && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 8 }}>
              ACTIVE SOURCES
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {sources.map((s, i) => (
                <span
                  key={i}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                    background: s.available ? "#D1FAE5" : "#F3F4F6",
                    color: s.available ? "#065F46" : "#9CA3AF",
                  }}
                >
                  {s.available ? "✓" : "-"} {s.label}
                </span>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={sweep}
          disabled={loading}
          style={{
            padding: "11px 28px",
            background: "#6366F1",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            marginBottom: 24,
          }}
        >
          🌐 Sweep All Sources
        </button>

        <div>
          {loading && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "32px 0",
                color: "#6B7280",
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  border: "2px solid #E5E7EB",
                  borderTopColor: "#6366F1",
                  borderRadius: "50%",
                  animation: "_laSpin 0.8s linear infinite",
                }}
              />
              <span>Sweeping all sources — this takes 20-40 seconds…</span>
              <style>{"@keyframes _laSpin{to{transform:rotate(360deg)}}"}</style>
            </div>
          )}

          {!loading && error && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 24,
                marginBottom: 16,
              }}
            >
              <p style={{ color: "#DC2626", margin: 0 }}>{error}</p>
            </div>
          )}

          {!loading && result && (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: 16,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <Badge label={`${result.total || 0} leads found`} color="green" />
                <Badge label={`${result.with_email || 0} with email`} color="purple" />
                <Badge label={`${result.with_linkedin || 0} with LinkedIn`} color="blue" />
                {Object.entries(result.source_counts || {}).map(([s, c]) => (
                  <Badge key={s} label={`${s}: ${c}`} color="blue" />
                ))}
              </div>

              {leads.length === 0 ? (
                <p style={{ color: "#6B7280", fontSize: 14 }}>No data found.</p>
              ) : (
                <div
                  style={{
                    overflowX: "auto",
                    borderRadius: 8,
                    border: "1px solid #E5E7EB",
                  }}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {COLUMNS.map((c) => (
                          <th
                            key={c}
                            style={{
                              padding: "10px 12px",
                              background: "#F9FAFB",
                              borderBottom: "1px solid #E5E7EB",
                              textAlign: "left",
                              fontSize: 12,
                              textTransform: "uppercase",
                              color: "#6B7280",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map((row, i) => (
                        <tr key={i}>
                          {COLUMNS.map((c) => (
                            <td
                              key={c}
                              style={{
                                padding: "10px 12px",
                                borderBottom: "1px solid #F3F4F6",
                                fontSize: 13,
                                color: "#111827",
                                maxWidth: 280,
                                wordBreak: "break-word",
                              }}
                            >
                              {row[c] != null ? String(row[c]) : ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

// Native React port of the legacy `data-provenance` panel (was
// `window.buildDataProvenance` in public/js/ig_moat_features.js +
// `#view-data-provenance`). Filters/lists provenance records with a summary and
// can log demo insights against the existing Express API
// (`GET /api/data-provenance/insights`, `POST /api/data-provenance/bulk-log`).

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Insight {
  insight_key?: string;
  insight_label?: string;
  source_type?: string;
  source_name?: string;
  source_url?: string;
  freshness_hours?: number | null;
  is_ai_estimated?: boolean;
  ai_model?: string;
  fetched_at?: string;
  created_at?: string;
}
interface Summary {
  total?: number;
  ai_estimated?: number;
  real_data?: number;
  sources?: Record<string, number>;
}
interface DPResult {
  ok: boolean;
  summary?: Summary;
  insights?: Insight[];
}

const DEMO_RECORDS = [
  {
    insight_key: "competitor_cpa",
    insight_label: "Competitor CPA Estimate",
    source_type: "ai_generated",
    source_name: "GPT-4o",
    is_ai_estimated: true,
    ai_model: "gpt-5",
    freshness_hours: 24,
  },
  {
    insight_key: "organic_traffic",
    insight_label: "Monthly Organic Traffic",
    source_type: "api",
    source_name: "DataForSEO",
    source_url: "https://dataforseo.com",
    is_ai_estimated: false,
    freshness_hours: 72,
  },
  {
    insight_key: "ad_ctr",
    insight_label: "Ad Click-Through Rate",
    source_type: "third_party",
    source_name: "Meta Ads API",
    is_ai_estimated: false,
    freshness_hours: 1,
  },
  {
    insight_key: "revenue_forecast",
    insight_label: "90-Day Revenue Forecast",
    source_type: "ai_generated",
    source_name: "InfoGenie MMM",
    is_ai_estimated: true,
    ai_model: "gpt-5",
    freshness_hours: 168,
  },
];

const TABLE_HEADERS = ["Insight", "Source", "Type", "Freshness", "AI?", "Model", "Fetched"];

export default function DataProvenance() {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [isAi, setIsAi] = useState("");
  const [summary, setSummary] = useState<Summary>({});
  const [insights, setInsights] = useState<Insight[] | null>(null);

  async function load() {
    const d = await apiGet<DPResult>(
      `/api/data-provenance/insights?search=${encodeURIComponent(search)}&source_type=${encodeURIComponent(source)}&is_ai=${encodeURIComponent(isAi)}`,
    );
    if (!d.ok) return;
    setSummary(d.summary || {});
    setInsights(d.insights || []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logDemo() {
    await apiPost("/api/data-provenance/bulk-log", { records: DEMO_RECORDS });
    load();
  }

  const total = summary.total || 0;
  const ai = summary.ai_estimated || 0;
  const real = summary.real_data || 0;
  const aiPct = total ? Math.round((ai / total) * 100) : 0;
  const sources = summary.sources || {};

  return (
    <div>
      <div className="view-header ig-panel-hero">
        <h2>🔍 Data Provenance</h2>
        <p className="view-sub">
          Every insight carries a source, freshness timestamp, and a real-vs-AI indicator. The
          marketing platform you can audit.
        </p>
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
          alignItems: "center",
        }}
      >
        <input
          className="form-control"
          style={{ maxWidth: 220 }}
          placeholder="Search insights…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="form-control"
          style={{ maxWidth: 160 }}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">All sources</option>
          <option value="api">Live API</option>
          <option value="scrape">Web scrape</option>
          <option value="ai_generated">AI generated</option>
          <option value="user_input">User input</option>
          <option value="database">Database</option>
          <option value="third_party">Third party</option>
        </select>
        <select
          className="form-control"
          style={{ maxWidth: 160 }}
          value={isAi}
          onChange={(e) => setIsAi(e.target.value)}
        >
          <option value="">All types</option>
          <option value="false">Real data only</option>
          <option value="true">AI estimated only</option>
        </select>
        <button className="btn btn-outline" onClick={load}>
          🔍 Filter
        </button>
        <button className="btn btn-sm btn-outline" onClick={logDemo}>
          + Log demo insight
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <div className="ig-card" style={{ padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{total}</div>
            <div style={{ fontSize: ".75rem", color: "#6b7280" }}>Total insights tracked</div>
          </div>
          <div
            className="ig-card"
            style={{ padding: 12, textAlign: "center", borderTop: "3px solid #10b981" }}
          >
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#10b981" }}>{real}</div>
            <div style={{ fontSize: ".75rem", color: "#6b7280" }}>Real data points</div>
          </div>
          <div
            className="ig-card"
            style={{ padding: 12, textAlign: "center", borderTop: "3px solid #f59e0b" }}
          >
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f59e0b" }}>{ai}</div>
            <div style={{ fontSize: ".75rem", color: "#6b7280" }}>AI-estimated points</div>
          </div>
          <div className="ig-card" style={{ padding: 12, textAlign: "center" }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: `conic-gradient(#f59e0b ${aiPct}%,#10b981 0)`,
                margin: "0 auto 4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: ".8rem",
                fontWeight: 700,
              }}
            >
              {aiPct}%
            </div>
            <div style={{ fontSize: ".75rem", color: "#6b7280" }}>AI-estimated ratio</div>
          </div>
          {Object.keys(sources).length > 0 && (
            <div className="ig-card" style={{ padding: 12 }}>
              <div
                style={{
                  fontSize: ".7rem",
                  fontWeight: 600,
                  color: "#6b7280",
                  marginBottom: 6,
                }}
              >
                BY SOURCE TYPE
              </div>
              {Object.entries(sources).map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: ".8rem",
                    margin: "2px 0",
                  }}
                >
                  <span>{k}</span>
                  <span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        {insights && insights.length === 0 && (
          <div className="ig-card" style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>
            No provenance records yet — insights tracked by InfoGenie will appear here automatically.
          </div>
        )}
        {insights && insights.length > 0 && (
          <div className="ig-card">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    {TABLE_HEADERS.map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "8px 12px",
                          textAlign: "left",
                          color: "#6b7280",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {insights.map((r, i) => {
                    const fresh = r.freshness_hours;
                    const freshLabel =
                      fresh == null
                        ? "—"
                        : fresh < 2
                          ? "< 2h"
                          : fresh < 24
                            ? `${fresh}h`
                            : `${Math.round(fresh / 24)}d`;
                    const freshCol =
                      fresh == null
                        ? "#9ca3af"
                        : fresh <= 24
                          ? "#10b981"
                          : fresh <= 168
                            ? "#f59e0b"
                            : "#ef4444";
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "8px 12px" }}>
                          <div style={{ fontWeight: 600 }}>
                            {r.insight_label || r.insight_key}
                          </div>
                          <div style={{ fontSize: ".75rem", color: "#9ca3af" }}>
                            {r.insight_key}
                          </div>
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          {r.source_url ? (
                            <a
                              href={r.source_url}
                              target="_blank"
                              rel="noopener"
                              style={{ color: "#3b82f6" }}
                            >
                              {r.source_name || r.source_type}
                            </a>
                          ) : (
                            <span>{r.source_name || r.source_type}</span>
                          )}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <span
                            style={{
                              background: "#f3f4f6",
                              borderRadius: 4,
                              padding: "2px 8px",
                              fontSize: ".75rem",
                            }}
                          >
                            {r.source_type || ""}
                          </span>
                        </td>
                        <td style={{ padding: "8px 12px", color: freshCol, fontWeight: 600 }}>
                          {freshLabel}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
                          {r.is_ai_estimated ? (
                            <span title="AI estimated" style={{ color: "#f59e0b", fontSize: "1rem" }}>
                              🤖
                            </span>
                          ) : (
                            <span title="Real data" style={{ color: "#10b981", fontSize: "1rem" }}>
                              ✓
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "8px 12px", fontSize: ".75rem", color: "#6b7280" }}>
                          {r.ai_model || "—"}
                        </td>
                        <td
                          style={{
                            padding: "8px 12px",
                            color: "#6b7280",
                            fontSize: ".75rem",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {new Date(r.fetched_at || r.created_at || "").toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

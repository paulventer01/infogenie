"use client";

// Native React port of the legacy `web-extractor` panel (was
// `window.buildWebExtractor` + `#view-web-extractor` in index.html). Extracts
// structured data from any public webpage in plain English via the existing
// Express API (`POST /api/web-extractor/extract`) through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiPost } from "@/lib/api";

interface ExtractResult {
  ok: boolean;
  error?: string;
  summary?: string;
  total_found?: number;
  source?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
}

const EXAMPLES = [
  "Extract all product names, prices, and descriptions",
  "Get the names and LinkedIn URLs of all team members",
  "Extract every FAQ question and answer",
  "List all integration partners with their logos and links",
  "Get all customer testimonials with name, company, and quote",
];

function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}) {
  if (!rows || !rows.length)
    return (
      <p style={{ color: "#6B7280", fontSize: 14 }}>No data found.</p>
    );
  return (
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
            {columns.map((c) => (
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
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
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
                  {String(r[c] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    green: { bg: "#D1FAE5", fg: "#065F46" },
    blue: { bg: "#DBEAFE", fg: "#1E40AF" },
    gray: { bg: "#F3F4F6", fg: "#374151" },
  };
  const c = map[color] || map.gray;
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
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

export default function WebExtractor() {
  const [url, setUrl] = useState("");
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExtractResult | null>(null);

  async function run() {
    const u = url.trim();
    const inst = instruction.trim();
    if (!u || !inst) {
      alert("Please enter a URL and extraction instruction");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const d = await apiPost<ExtractResult>("/api/web-extractor/extract", {
      url: u,
      instruction: inst,
    });
    if (!d.ok) {
      setStatus("error");
      setError(d.error || "Extraction failed");
      return;
    }
    setResult(d);
    setStatus("done");
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    border: "1px solid #D1D5DB",
    borderRadius: 8,
    fontSize: 14,
    boxSizing: "border-box",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> AI Web Extractor
              </div>
              <h2 className="view-title">🧲 AI Web Extractor</h2>
              <p className="view-sub">
                Extract any structured data from any public webpage in plain
                English — no code, no CSS selectors. Paste a URL, describe what
                you want, and get a clean table of results.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "#374151",
                marginBottom: 6,
              }}
            >
              Target URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/pricing"
              style={inputStyle}
            />
          </div>
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "#374151",
                marginBottom: 6,
              }}
            >
              What to Extract (plain English)
            </label>
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Extract all pricing tiers with their names and prices"
              style={inputStyle}
            />
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#6B7280",
              marginBottom: 8,
            }}
          >
            EXAMPLE PROMPTS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {EXAMPLES.map((e) => (
              <button
                key={e}
                onClick={() => setInstruction(e)}
                style={{
                  padding: "6px 12px",
                  background: "#F3F4F6",
                  border: "1px solid #E5E7EB",
                  borderRadius: 20,
                  fontSize: 12,
                  cursor: "pointer",
                  color: "#374151",
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={run}
          disabled={status === "loading"}
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
          🧲 Extract Data
        </button>

        <div>
          {status === "loading" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "32px 0",
                color: "#6B7280",
              }}
            >
              <span>Fetching page and extracting data with AI…</span>
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <p style={{ color: "#DC2626", margin: 0 }}>⚠️ {error}</p>
            </div>
          )}
          {status === "done" && result && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 16,
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: "#111827",
                      marginBottom: 4,
                    }}
                  >
                    Extraction Results
                  </div>
                  <div style={{ fontSize: 13, color: "#6B7280" }}>
                    {result.summary}
                  </div>
                </div>
                <div
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <Badge label={`${result.total_found} rows found`} color="green" />
                  <Badge
                    label={result.source === "openai" ? "AI" : "Template"}
                    color="blue"
                  />
                </div>
              </div>
              <DataTable columns={result.columns || []} rows={result.rows || []} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

// Native React port of the legacy `quora-mining` panel (was
// `window.buildQuoraMining` + `#view-quora-mining` in index.html). Mines the
// most-engaged Quora questions for a topic, with intent classification and a
// suggested response angle for each, via the existing Express API
// (`POST /api/quora-mining/mine`) through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiPost } from "@/lib/api";

interface QuoraQuestion {
  question?: string;
  intent?: string;
  answer_count?: number;
  view_count?: number;
  url?: string;
  top_answer_summary?: string;
  suggested_response_angle?: string;
}
interface MineResult {
  ok: boolean;
  error?: string;
  total?: number;
  topic?: string;
  questions?: QuoraQuestion[];
}

const INTENT_COLOR: Record<string, string> = {
  informational: "#0066FF",
  comparison: "#7C3AED",
  recommendation: "#EC4899",
  complaint: "#DC2626",
  "how-to": "#0E9F6E",
  definition: "#F59E0B",
};

function safeUrl(u?: string): string {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}
function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export default function QuoraMining() {
  const [topic, setTopic] = useState("");
  const [brand, setBrand] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<MineResult | null>(null);

  async function run() {
    const t = topic.trim();
    if (!t) {
      setStatus("error");
      setError("⚠ Topic required");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<MineResult>("/api/quora-mining/mine", {
      topic: t,
      brand: brand.trim(),
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setResult(r);
    setStatus("idle");
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: 8,
    border: "1px solid #D1D5DB",
    borderRadius: 5,
    fontSize: "0.84rem",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#6B7280",
    marginBottom: 3,
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Quora Mining
              </div>
              <h2 className="view-title">❓ Quora Mining</h2>
              <p className="view-sub">
                Discover the most-engaged Quora questions in your topic, with
                intent classification and a suggested response angle for each —
                content gold for SEO and answer marketing.
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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr",
              gap: 10,
            }}
          >
            <div>
              <label style={labelStyle}>TOPIC *</label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                placeholder="e.g. CRM software for small business"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>YOUR BRAND (opt.)</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                placeholder="e.g. HubSpot"
                style={inputStyle}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                onClick={run}
                disabled={status === "loading"}
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg,#B92B27,#DC2626)",
                  color: "#fff",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: 6,
                  fontSize: "0.84rem",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                ❓ Mine Quora
              </button>
            </div>
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ color: "#9CA3AF" }}>⏳ Searching Quora (20-40s)…</div>
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
              {error}
            </div>
          )}
          {status === "idle" && result && (
            <>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: "14px 18px",
                  marginBottom: 14,
                }}
              >
                <strong style={{ color: "#0A1628", fontSize: "0.96rem" }}>
                  {n(result.total)} Quora questions about &quot;
                  {result.topic}&quot;
                </strong>
                <span
                  style={{
                    color: "#6B7280",
                    fontSize: "0.8rem",
                    marginLeft: 8,
                  }}
                >
                  Sorted by engagement (answers + views)
                </span>
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {(result.questions || []).map((q, i) => {
                  const c =
                    INTENT_COLOR[(q.intent || "informational").toLowerCase()] ||
                    "#6B7280";
                  const url = safeUrl(q.url);
                  return (
                    <div
                      key={i}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderLeft: `4px solid ${c}`,
                        borderRadius: 10,
                        padding: "14px 16px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          marginBottom: 8,
                          alignItems: "flex-start",
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <strong
                            style={{ color: "#0A1628", fontSize: "0.92rem" }}
                          >
                            {i + 1}. {q.question || ""}
                          </strong>
                        </div>
                        <span
                          style={{
                            background: c,
                            color: "#fff",
                            padding: "2px 10px",
                            borderRadius: 12,
                            fontSize: "0.68rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {q.intent || ""}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "0.74rem",
                          color: "#6B7280",
                          marginBottom: 6,
                        }}
                      >
                        📝 {n(q.answer_count)} answers · 👁{" "}
                        {n(q.view_count).toLocaleString()} views{" "}
                        {url && (
                          <>
                            ·{" "}
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: "#B92B27",
                                textDecoration: "none",
                                fontWeight: 700,
                              }}
                            >
                              View on Quora ↗
                            </a>
                          </>
                        )}
                      </div>
                      {q.top_answer_summary && (
                        <div
                          style={{
                            background: "#F9FAFB",
                            padding: "8px 12px",
                            borderRadius: 6,
                            fontSize: "0.8rem",
                            color: "#374151",
                            marginBottom: 8,
                          }}
                        >
                          <strong>Top answer:</strong> {q.top_answer_summary}
                        </div>
                      )}
                      {q.suggested_response_angle && (
                        <div
                          style={{
                            background: "#FEF3C7",
                            borderLeft: "3px solid #F59E0B",
                            padding: "8px 12px",
                            borderRadius: 4,
                            fontSize: "0.82rem",
                            color: "#78350F",
                          }}
                        >
                          <strong>💡 Your angle:</strong>{" "}
                          {q.suggested_response_angle}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

// Native React port of the legacy `glassdoor` panel (was `window.buildGlassdoor`
// in ig_intel_pack_a.js and `#view-glassdoor` in index.html). Pulls current
// employee reviews for a company via the existing Express API:
//   POST /api/glassdoor/scan   { company }
// Pre-fills the company picker from the legacy `window.analysisData` global set
// by the SPA competitor analysis.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useState } from "react";
import { apiPost } from "@/lib/api";

const SENT_COLOR: Record<string, [string, string]> = {
  positive: ["#ECFDF5", "#065F46"],
  neutral: ["#F3F4F6", "#374151"],
  negative: ["#FEF2F2", "#991B1B"],
};

interface GdReview {
  title?: string;
  role?: string;
  tenure?: string;
  rating?: number | string;
  date?: string;
  sentiment?: string;
  pros?: string;
  cons?: string;
}
interface GdResp {
  ok?: boolean;
  error?: string;
  company?: string;
  overall_rating?: number | string;
  ceo_approval?: number | null;
  recommend_pct?: number | null;
  total_reviews?: number;
  culture_signals?: string[];
  top_praises?: string[];
  top_complaints?: string[];
  reviews?: GdReview[];
}

interface AnalysisCompetitor {
  name?: string;
  domain?: string;
}
interface AnalysisData {
  brandName?: string;
  competitors?: AnalysisCompetitor[];
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function Glassdoor() {
  const { ownBrand, compNames } = useMemo(() => {
    const ad = getAnalysisData();
    const b = ad.brandName || "";
    const comps = Array.isArray(ad.competitors)
      ? ad.competitors
          .map((c) => c.name || c.domain)
          .filter((n): n is string => !!n)
          .slice(0, 15)
      : [];
    return { ownBrand: b, compNames: comps };
  }, []);

  const [pick, setPick] = useState("");
  const [company, setCompany] = useState("");
  const [result, setResult] = useState<GdResp | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    setCompany(ownBrand);
  }, [ownBrand]);

  function onPickChange(v: string) {
    setPick(v);
    if (v) setCompany(v);
  }

  async function scan() {
    const c = company.trim();
    if (!c) {
      setStatus("error");
      setErrMsg("⚠ Company required");
      setResult(null);
      return;
    }
    setStatus("loading");
    setErrMsg("");
    setResult(null);
    const r = await apiPost<GdResp>("/api/glassdoor/scan", { company: c });
    if (!r.ok) {
      setStatus("error");
      setErrMsg(r.error || "failed");
      return;
    }
    setResult(r);
    setStatus("idle");
  }

  const pickerOpts = [
    ...(ownBrand ? [{ value: ownBrand, label: `${ownBrand} (your brand)` }] : []),
    ...compNames.map((n) => ({ value: n, label: n })),
  ];

  const ratingNum =
    result && Number.isFinite(Number(result.overall_rating))
      ? Number(result.overall_rating)
      : null;
  const ratingPct = ratingNum ? Math.min(100, Math.max(0, (ratingNum / 5) * 100)) : 0;

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Glassdoor Sentiment
              </div>
              <h2 className="view-title">🏢 Glassdoor Sentiment</h2>
              <p className="view-sub">
                Pull current employee reviews for any competitor — overall
                rating, CEO approval, top complaints, top praises and culture
                signals about strategy and management.
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
              gridTemplateColumns: "3fr 1fr",
              gap: 10,
              marginBottom: 10,
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
                COMPANY *{" "}
                <span style={{ color: "#15803D", fontWeight: 600 }}>
                  (auto-filled from your analysis)
                </span>
              </label>
              {pickerOpts.length > 0 ? (
                <select
                  value={pick}
                  onChange={(e) => onPickChange(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    border: "1.5px solid #D1D5DB",
                    borderRadius: 5,
                    fontSize: "0.78rem",
                    background: "#F9FAFB",
                    marginBottom: 5,
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">
                    — Pick from your analysis (or type manually below) —
                  </option>
                  {pickerOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: "#9CA3AF",
                    marginBottom: 5,
                  }}
                >
                  💡 Run an analysis to unlock brand/competitor pickers.
                </div>
              )}
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="e.g. Salesforce — or pick from list above"
                style={{
                  width: "100%",
                  padding: 8,
                  border: "1px solid #D1D5DB",
                  borderRadius: 5,
                  fontSize: "0.84rem",
                  boxSizing: "border-box",
                  background: company ? "#F0FDF4" : "#fff",
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                onClick={scan}
                disabled={status === "loading"}
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg,#0E9F6E,#14B8A6)",
                  color: "#fff",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: 6,
                  fontSize: "0.84rem",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                🏢 Scan Glassdoor
              </button>
            </div>
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ color: "#9CA3AF" }}>
              ⏳ Searching Glassdoor (20-40s)…
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
              {errMsg}
            </div>
          )}
          {status === "idle" && result && (
            <>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: "16px 20px",
                  marginBottom: 14,
                }}
              >
                <h3 style={{ margin: "0 0 12px", color: "#0A1628" }}>
                  🏢 {result.company}
                </h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    gap: 14,
                    textAlign: "center",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "1.6rem",
                        fontWeight: 800,
                        color: "#0E9F6E",
                      }}
                    >
                      {ratingNum !== null ? ratingNum.toFixed(1) : "—"}
                    </div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "#6B7280",
                        fontWeight: 700,
                      }}
                    >
                      OVERALL ⭐
                    </div>
                    <div
                      style={{
                        background: "#E5E7EB",
                        height: 5,
                        borderRadius: 3,
                        marginTop: 6,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          background: "#0E9F6E",
                          height: "100%",
                          width: `${ratingPct}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: "1.6rem",
                        fontWeight: 800,
                        color: "#0066FF",
                      }}
                    >
                      {num(result.ceo_approval) || "—"}
                      {result.ceo_approval != null ? "%" : ""}
                    </div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "#6B7280",
                        fontWeight: 700,
                      }}
                    >
                      CEO APPROVAL
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: "1.6rem",
                        fontWeight: 800,
                        color: "#0f766e",
                      }}
                    >
                      {num(result.recommend_pct) || "—"}
                      {result.recommend_pct != null ? "%" : ""}
                    </div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "#6B7280",
                        fontWeight: 700,
                      }}
                    >
                      RECOMMEND
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: "1.6rem",
                        fontWeight: 800,
                        color: "#374151",
                      }}
                    >
                      {num(result.total_reviews) || "—"}
                    </div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "#6B7280",
                        fontWeight: 700,
                      }}
                    >
                      REVIEWS
                    </div>
                  </div>
                </div>
              </div>

              {(result.culture_signals || []).length > 0 && (
                <div
                  style={{
                    background: "linear-gradient(135deg,#F3E8FF,#FAE8FF)",
                    borderRadius: 12,
                    padding: "16px 20px",
                    marginBottom: 14,
                    borderLeft: "4px solid #0f766e",
                  }}
                >
                  <h3
                    style={{
                      margin: "0 0 8px",
                      color: "#5B21B6",
                      fontSize: "0.96rem",
                    }}
                  >
                    🎯 Culture Signals (Strategic)
                  </h3>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 22,
                      color: "#0A1628",
                      fontSize: "0.85rem",
                      lineHeight: 1.65,
                    }}
                  >
                    {(result.culture_signals || []).map((s, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    background: "#ECFDF5",
                    border: "1px solid #A7F3D0",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <h4 style={{ margin: "0 0 8px", color: "#065F46" }}>
                    👍 Top Praises
                  </h4>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 20,
                      color: "#065F46",
                      fontSize: "0.82rem",
                      lineHeight: 1.6,
                    }}
                  >
                    {(result.top_praises || []).length ? (
                      (result.top_praises || []).map((t, i) => (
                        <li key={i}>{t}</li>
                      ))
                    ) : (
                      <li>
                        <em>None</em>
                      </li>
                    )}
                  </ul>
                </div>
                <div
                  style={{
                    background: "#FEF2F2",
                    border: "1px solid #FECACA",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <h4 style={{ margin: "0 0 8px", color: "#991B1B" }}>
                    👎 Top Complaints
                  </h4>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 20,
                      color: "#991B1B",
                      fontSize: "0.82rem",
                      lineHeight: 1.6,
                    }}
                  >
                    {(result.top_complaints || []).length ? (
                      (result.top_complaints || []).map((t, i) => (
                        <li key={i}>{t}</li>
                      ))
                    ) : (
                      <li>
                        <em>None</em>
                      </li>
                    )}
                  </ul>
                </div>
              </div>

              <h3
                style={{
                  color: "#0A1628",
                  fontSize: "1rem",
                  margin: "16px 0 10px",
                }}
              >
                💬 Recent Reviews ({(result.reviews || []).length})
              </h3>
              <div style={{ display: "grid", gap: 10 }}>
                {(result.reviews || []).map((rev, i) => {
                  const sk = (rev.sentiment || "neutral").toLowerCase();
                  const c = SENT_COLOR[sk] || SENT_COLOR.neutral;
                  return (
                    <div
                      key={i}
                      style={{
                        background: c[0],
                        border: "1px solid #E5E7EB",
                        borderLeft: `4px solid ${c[1]}`,
                        borderRadius: 8,
                        padding: "12px 14px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          marginBottom: 6,
                          alignItems: "flex-start",
                        }}
                      >
                        <div>
                          <strong
                            style={{ color: "#0A1628", fontSize: "0.9rem" }}
                          >
                            {rev.title || "(no title)"}
                          </strong>{" "}
                          <span style={{ color: "#6B7280", fontSize: "0.74rem" }}>
                            · {rev.role || ""} · {rev.tenure || ""}
                          </span>
                        </div>
                        <div style={{ whiteSpace: "nowrap" }}>
                          <span style={{ fontWeight: 800, color: c[1] }}>
                            {Number.isFinite(Number(rev.rating))
                              ? Number(rev.rating).toFixed(1) + "⭐"
                              : ""}
                          </span>{" "}
                          <span
                            style={{
                              color: "#9CA3AF",
                              fontSize: "0.72rem",
                              marginLeft: 6,
                            }}
                          >
                            {rev.date || ""}
                          </span>
                        </div>
                      </div>
                      {rev.pros && (
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "#065F46",
                            marginTop: 4,
                          }}
                        >
                          <strong>Pros:</strong> {rev.pros}
                        </div>
                      )}
                      {rev.cons && (
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "#991B1B",
                            marginTop: 4,
                          }}
                        >
                          <strong>Cons:</strong> {rev.cons}
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

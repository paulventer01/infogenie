"use client";

// Native React port of the legacy `voc` panel (was `window.buildVoc` + `_voc*`
// helpers in app.js and `#view-voc` in index.html). Mines themes from recent
// brand mentions via the existing Express API:
//   POST /api/voc/mine   { brand, days }
// Pre-fills the brand/competitor picker from the legacy `window.analysisData`
// global set by the SPA competitor analysis.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useState } from "react";
import { apiPost } from "@/lib/api";

const KIND_COLOR: Record<string, string> = {
  praise: "#15803D",
  complaint: "#B91C1C",
  question: "#0891B2",
  feature_request: "#7C3AED",
  neutral: "#6B7280",
};
const KIND_BG: Record<string, string> = {
  praise: "#D1FAE5",
  complaint: "#FEE2E2",
  question: "#CFFAFE",
  feature_request: "#EDE9FE",
  neutral: "#F3F4F6",
};

interface Theme {
  kind?: string;
  label?: string;
  frequency?: number;
  share?: number;
  sentiment_score?: number;
  top_quotes?: string[];
  recommended_action?: string;
}
interface VocResp {
  ok?: boolean;
  error?: string;
  themes?: Theme[];
  summary?: string;
  brand?: string;
  mention_count?: number;
  days?: number;
  source?: string;
}

interface AnalysisCompetitor {
  name?: string;
  domain?: string;
}
interface AnalysisData {
  brandName?: string;
  competitors?: AnalysisCompetitor[];
}

function toast(msg: string) {
  if (typeof window !== "undefined") {
    (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
  }
}
function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

export default function Voc() {
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
  const [brand, setBrand] = useState("");
  const [daysSel, setDaysSel] = useState("14");
  const [customDays, setCustomDays] = useState("14");
  const [result, setResult] = useState<VocResp | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "empty">(
    "idle",
  );
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    setBrand(ownBrand);
  }, [ownBrand]);

  function onPickChange(v: string) {
    setPick(v);
    if (v) setBrand(v);
  }

  async function go() {
    if (!brand.trim()) {
      toast("⚠️ Brand required");
      return;
    }
    const days = daysSel === "custom" ? customDays : daysSel;
    setStatus("loading");
    setErrMsg("");
    setResult(null);
    const r = await apiPost<VocResp>("/api/voc/mine", {
      brand: brand.trim(),
      days: Number(days),
    });
    if (!r.ok) {
      setStatus("error");
      setErrMsg(r.error || "failed");
      return;
    }
    if (!r.themes || !r.themes.length) {
      setResult(r);
      setStatus("empty");
      return;
    }
    setResult(r);
    setStatus("idle");
  }

  const pickerOpts = [
    ...(ownBrand ? [{ value: ownBrand, label: `${ownBrand} (your brand)` }] : []),
    ...compNames.map((n) => ({ value: n, label: n })),
  ];

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Voice of Customer
              </div>
              <h2 className="view-title">🗣️ Voice of Customer Mining</h2>
              <p className="view-sub">
                AI clusters every recent mention into themes — top complaints,
                top praises, feature requests — with sample quotes and a
                recommended action per theme.
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
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 160px auto",
              gap: 12,
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
                Brand{" "}
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
                    padding: "8px 10px",
                    border: "1.5px solid #D1D5DB",
                    borderRadius: 8,
                    fontSize: "0.82rem",
                    background: "#F9FAFB",
                    marginBottom: 6,
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
                    fontSize: "0.72rem",
                    color: "#9CA3AF",
                    marginBottom: 6,
                  }}
                >
                  💡 Run an analysis from the top-right{" "}
                  <strong>+ Analyse</strong> button to unlock brand/competitor
                  pickers.
                </div>
              )}
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Nike — or pick from list above"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.88rem",
                  boxSizing: "border-box",
                  background: brand ? "#F0FDF4" : "#fff",
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
                Days back
              </label>
              <select
                value={daysSel}
                onChange={(e) => {
                  const v = e.target.value;
                  setDaysSel(v);
                  if (v !== "custom") setCustomDays(v);
                }}
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.85rem",
                  background: "#fff",
                  marginBottom: 5,
                  boxSizing: "border-box",
                }}
              >
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="60">Last 60 days</option>
                <option value="90">Last 90 days</option>
                <option value="custom">Custom…</option>
              </select>
              {daysSel === "custom" && (
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  placeholder="Days (1-365)"
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    border: "1px solid #D1D5DB",
                    borderRadius: 8,
                    fontSize: "0.8rem",
                    boxSizing: "border-box",
                  }}
                />
              )}
            </div>
            <button
              onClick={go}
              disabled={status === "loading"}
              style={{
                padding: "10px 22px",
                background: "#0EA5E9",
                border: "2px solid #0EA5E9",
                borderRadius: 8,
                fontSize: "0.84rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              🔍 Mine Themes
            </button>
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 20,
                color: "#6B7280",
              }}
            >
              ⏳ Pulling mentions and clustering themes…
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
          {status === "empty" && result && (
            <div
              style={{
                background: "#FEF3C7",
                color: "#92400E",
                padding: "14px 18px",
                borderRadius: 10,
                fontSize: "0.85rem",
              }}
            >
              {result.summary || "No themes found."}
            </div>
          )}
          {status === "idle" && result && result.themes && (
            <>
              <div
                style={{
                  background: "linear-gradient(135deg,#0EA5E9 0%,#0369A1 100%)",
                  color: "#fff",
                  borderRadius: "12px 12px 0 0",
                  padding: "18px 22px",
                }}
              >
                <div
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    opacity: 0.9,
                  }}
                >
                  {result.brand} · {result.mention_count} mentions · last{" "}
                  {result.days}d · {(result.source || "").toUpperCase()}
                </div>
                <div
                  style={{
                    fontSize: "0.95rem",
                    lineHeight: 1.55,
                    marginTop: 6,
                    color: "#fff",
                    WebkitTextFillColor: "#fff",
                  }}
                >
                  {result.summary || ""}
                </div>
              </div>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderTop: 0,
                  borderRadius: "0 0 12px 12px",
                  padding: "18px 22px",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(380px,1fr))",
                    gap: 14,
                  }}
                >
                  {result.themes.map((t, i) => {
                    const kc = KIND_COLOR[t.kind || ""] || "#6B7280";
                    const kbg = KIND_BG[t.kind || ""] || "#F3F4F6";
                    const sharePct = Math.round((t.share || 0) * 100);
                    return (
                      <div
                        key={i}
                        style={{
                          background: kbg,
                          border: `1px solid ${kc}33`,
                          borderLeft: `4px solid ${kc}`,
                          borderRadius: 8,
                          padding: "14px 16px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 8,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 800,
                              color: "#0A1628",
                              fontSize: "0.95rem",
                            }}
                          >
                            {t.label || ""}
                          </div>
                          <span
                            style={{
                              background: kc,
                              color: "#fff",
                              fontSize: "0.62rem",
                              fontWeight: 800,
                              padding: "3px 8px",
                              borderRadius: 5,
                              textTransform: "uppercase",
                            }}
                          >
                            {t.kind || ""}
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 14,
                            fontSize: "0.74rem",
                            color: "#374151",
                            marginBottom: 8,
                          }}
                        >
                          <span>📊 {t.frequency || 0} mentions</span>
                          <span>🔵 {sharePct}% share</span>
                          <span>
                            {(t.sentiment_score || 0) >= 0 ? "😊" : "😟"}{" "}
                            {(t.sentiment_score || 0).toFixed(2)}
                          </span>
                        </div>
                        {(t.top_quotes || []).length > 0 && (
                          <div
                            style={{
                              background: "#fff",
                              borderRadius: 6,
                              padding: "8px 12px",
                              marginBottom: 10,
                            }}
                          >
                            {(t.top_quotes || []).map((q, j) => (
                              <div
                                key={j}
                                style={{
                                  fontSize: "0.78rem",
                                  color: "#374151",
                                  fontStyle: "italic",
                                  lineHeight: 1.45,
                                  marginBottom: 4,
                                }}
                              >
                                &quot;{q}&quot;
                              </div>
                            ))}
                          </div>
                        )}
                        {t.recommended_action && (
                          <div
                            style={{
                              fontSize: "0.78rem",
                              color: "#0A1628",
                              background: "#fff",
                              borderRadius: 6,
                              padding: "8px 12px",
                            }}
                          >
                            <strong style={{ color: kc }}>→ Action:</strong>{" "}
                            {t.recommended_action}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

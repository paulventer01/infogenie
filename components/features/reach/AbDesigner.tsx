"use client";

// Native React port of the legacy `ab-designer` panel (was
// `window.buildAbDesigner` / `_abGo` / `_abCopy` inline in app.js +
// `#view-ab-designer` in index.html). Generates scientifically-angled A/B test
// variants for any piece of copy against the existing Express API
// (`POST /api/ab-designer/generate`) via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiPost } from "@/lib/api";

interface AbVariant {
  label?: string;
  angle?: string;
  copy?: string;
  why?: string;
  predicted_lift?: string;
}

interface AbResult {
  ok: boolean;
  error?: string;
  source?: string;
  hypothesis?: string;
  primary_metric?: string;
  recommended_split?: string;
  sample_size_note?: string;
  variants?: AbVariant[];
}

const KINDS: [string, string][] = [
  ["email_subject", "📧 Email subject line"],
  ["ad_headline", "📰 Ad headline"],
  ["ad_body", "📝 Ad body copy"],
  ["cta_button", "🔘 CTA button"],
  ["landing_hero", "🎯 Landing page hero"],
  ["push_notification", "📱 Push notification"],
  ["sms", "💬 SMS"],
  ["social_caption", "📣 Social caption"],
];

const ANGLE_COLOR: Record<string, string> = {
  control: "#6B7280",
  emotional: "#EC4899",
  rational: "#0891B2",
  FOMO: "#DC2626",
  social_proof: "#059669",
  curiosity: "#7C3AED",
  benefit_led: "#15803D",
  loss_aversion: "#B91C1C",
  urgency: "#EA580C",
  authority: "#1E40AF",
  novelty: "#DB2777",
};

function showToast(msg: string) {
  (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
  marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontSize: "0.88rem",
  boxSizing: "border-box",
};

export default function AbDesigner() {
  const [brand, setBrand] = useState("");
  const [kind, setKind] = useState("email_subject");
  const [count, setCount] = useState(4);
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [original, setOriginal] = useState("");

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState("");
  const [result, setResult] = useState<AbResult | null>(null);

  async function go() {
    if (!original.trim()) {
      showToast("⚠️ Paste the original copy first");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<AbResult>("/api/ab-designer/generate", {
      brand,
      element_kind: kind,
      original,
      goal,
      audience,
      count,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setResult(r);
    setStatus("done");
  }

  async function copy(s: string) {
    try {
      await navigator.clipboard.writeText(s);
      showToast("✅ Copied");
    } catch (e) {
      showToast("❌ " + (e instanceof Error ? e.message : "copy failed"));
    }
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> A/B Test Designer
              </div>
              <h2 className="view-title">🧪 AI A/B Test Designer</h2>
              <p className="view-sub">
                Drop in any subject line, ad headline, CTA or hero copy and get
                scientifically-angled variants with a hypothesis, primary metric,
                predicted lift, and recommended split.
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
              gridTemplateColumns: "1fr 1fr 100px",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label style={labelStyle}>Brand (optional)</label>
              <input
                placeholder="e.g. Nike"
                style={inputStyle}
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Element type</label>
              <select
                style={inputStyle}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {KINDS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Variants</label>
              <input
                type="number"
                min={2}
                max={6}
                style={inputStyle}
                value={count}
                onChange={(e) =>
                  setCount(parseInt(e.target.value, 10) || 4)
                }
              />
            </div>
            <div>
              <label style={labelStyle}>Goal</label>
              <input
                placeholder="e.g. drive 10% more click-throughs"
                style={inputStyle}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Audience</label>
              <input
                placeholder="e.g. lapsed customers, 30-50"
                style={inputStyle}
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Original copy (control)</label>
            <textarea
              rows={3}
              placeholder="Paste the existing subject line, headline, CTA, etc."
              style={{
                ...inputStyle,
                fontSize: "0.86rem",
                fontFamily: "inherit",
                resize: "vertical",
              }}
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
            />
          </div>
          <button
            onClick={go}
            disabled={status === "loading"}
            style={{
              marginTop: 12,
              padding: "10px 22px",
              background: "#F59E0B",
              border: "2px solid #F59E0B",
              borderRadius: 8,
              fontSize: "0.84rem",
              fontWeight: 800,
              color: "#fff",
              WebkitTextFillColor: "#fff",
              cursor: "pointer",
              textShadow: "0 1px 2px rgba(0,0,0,.4)",
            }}
          >
            🧪 Design Variants
          </button>
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
              ⏳ Designing {count} variants…
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
              {error}
            </div>
          )}
          {status === "done" && result && (
            <>
              <div
                style={{
                  background:
                    "linear-gradient(135deg,#F59E0B 0%,#D97706 100%)",
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
                  HYPOTHESIS · {(result.source || "").toUpperCase()}
                </div>
                <div
                  style={{
                    fontSize: "1.05rem",
                    fontWeight: 800,
                    marginTop: 4,
                    color: "#fff",
                    WebkitTextFillColor: "#fff",
                  }}
                >
                  {result.hypothesis || ""}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 18,
                    marginTop: 10,
                    fontSize: "0.78rem",
                  }}
                >
                  <div>
                    <strong>Primary metric:</strong> {result.primary_metric || ""}
                  </div>
                  <div>
                    <strong>Recommended split:</strong>{" "}
                    {result.recommended_split || ""}
                  </div>
                </div>
              </div>
              <div
                style={{
                  background: "#FEF3C7",
                  color: "#92400E",
                  padding: "10px 22px",
                  fontSize: "0.78rem",
                }}
              >
                📊 {result.sample_size_note || ""}
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
                    gridTemplateColumns:
                      "repeat(auto-fill,minmax(320px,1fr))",
                    gap: 12,
                  }}
                >
                  {(result.variants || []).map((v, i) => {
                    const ac = ANGLE_COLOR[v.angle || ""] || "#6B7280";
                    return (
                      <div
                        key={i}
                        style={{
                          background: "#F9FAFB",
                          border: "1px solid #E5E7EB",
                          borderTop: `3px solid ${ac}`,
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
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                            }}
                          >
                            <span
                              style={{
                                background: ac,
                                color: "#fff",
                                width: 28,
                                height: 28,
                                borderRadius: 6,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontWeight: 800,
                                fontSize: "0.92rem",
                              }}
                            >
                              {v.label || ""}
                            </span>
                            <span
                              style={{
                                fontSize: "0.7rem",
                                color: "#6B7280",
                                textTransform: "uppercase",
                                fontWeight: 700,
                              }}
                            >
                              {v.angle || ""}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: "0.74rem",
                              fontWeight: 800,
                              color:
                                v.angle === "control" ? "#6B7280" : "#15803D",
                            }}
                          >
                            {v.predicted_lift || ""}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "0.92rem",
                            color: "#0A1628",
                            fontWeight: 600,
                            lineHeight: 1.45,
                            marginBottom: 8,
                          }}
                        >
                          {v.copy || ""}
                        </div>
                        <div
                          style={{
                            fontSize: "0.74rem",
                            color: "#6B7280",
                            lineHeight: 1.45,
                            fontStyle: "italic",
                          }}
                        >
                          {v.why || ""}
                        </div>
                        <button
                          onClick={() => copy(v.copy || "")}
                          style={{
                            marginTop: 8,
                            padding: "5px 10px",
                            background: "#fff",
                            border: "1.5px solid #D1D5DB",
                            borderRadius: 5,
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            color: "#374151",
                            cursor: "pointer",
                          }}
                        >
                          📋 Copy
                        </button>
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

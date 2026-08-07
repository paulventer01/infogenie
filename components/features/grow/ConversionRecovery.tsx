"use client";

// Native React port of the legacy `conversion-recovery` panel (was
// `window.buildConversionRecovery` in public/js/ig_intelligence_tools.js +
// `#view-conversion-recovery` in index.html). Computes a server-side tracking
// "Recovery Score" and generates an AI step-by-step setup guide against the
// existing Express API (`POST /api/conversion-recovery/score` and
// `POST /api/conversion-recovery/setup-guide`) via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiPost } from "@/lib/api";

interface ScoreResult {
  ok: boolean;
  error?: string;
  score: number;
  breakdown?: Record<string, number>;
  total_loss_pct: number;
  recoverable_pct: number;
  monthly_missed_value?: number;
}

interface GuideStep {
  step: number;
  title: string;
  time_estimate: string;
  description: string;
  code?: string;
}
interface GuideResult {
  ok: boolean;
  error?: string;
  overview?: string;
  steps?: GuideStep[];
  expected_recovery_pct?: number;
  docs_url?: string;
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 5,
};
const selStyle: React.CSSProperties = {
  width: "100%",
  padding: 9,
  border: "1px solid #D1D5DB",
  borderRadius: 7,
  fontSize: 13,
};
const inputStyle: React.CSSProperties = {
  ...selStyle,
  boxSizing: "border-box",
};
const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E5E7EB",
  borderRadius: 12,
  padding: 24,
  marginBottom: 16,
};

function Spinner({ msg }: { msg: string }) {
  return (
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
          animation: "spin 0.8s linear infinite",
        }}
      />
      <span>{msg}</span>
    </div>
  );
}

export default function ConversionRecovery() {
  // Recovery score form
  const [platform, setPlatform] = useState("meta");
  const [pixelType, setPixelType] = useState("client_side");
  const [spend, setSpend] = useState("");
  const [browser, setBrowser] = useState("false");
  const [scoreState, setScoreState] = useState<"idle" | "loading" | "done">(
    "idle",
  );
  const [scoreErr, setScoreErr] = useState("");
  const [score, setScore] = useState<ScoreResult | null>(null);

  // Setup guide form
  const [guidePlatform, setGuidePlatform] = useState("meta");
  const [goal, setGoal] = useState("purchase");
  const [bizPlatform, setBizPlatform] = useState("shopify");
  const [lang, setLang] = useState("node");
  const [guideState, setGuideState] = useState<"idle" | "loading" | "done">(
    "idle",
  );
  const [guideErr, setGuideErr] = useState("");
  const [guide, setGuide] = useState<GuideResult | null>(null);

  async function runScore() {
    setScoreState("loading");
    setScoreErr("");
    setScore(null);
    const d = await apiPost<ScoreResult>("/api/conversion-recovery/score", {
      platform,
      pixel_type: pixelType,
      monthly_ad_spend: Number(spend) || 0,
      browser_targeting: browser === "true",
    });
    if (!d.ok) {
      setScoreErr(d.error || "Failed");
      setScoreState("idle");
      return;
    }
    setScore(d);
    setScoreState("done");
  }

  async function runGuide() {
    setGuideState("loading");
    setGuideErr("");
    setGuide(null);
    const d = await apiPost<GuideResult>(
      "/api/conversion-recovery/setup-guide",
      {
        platform: guidePlatform,
        goal,
        business_platform: bizPlatform,
        server_lang: lang,
      },
    );
    if (!d.ok) {
      setGuideErr(d.error || "Failed");
      setGuideState("idle");
      return;
    }
    setGuide(d);
    setGuideState("done");
  }

  const scoreColor =
    score && score.score >= 80
      ? "#059669"
      : score && score.score >= 60
        ? "#D97706"
        : "#DC2626";

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span>{" "}
                <span className="bc-sep">›</span> Conversion Recovery
              </div>
              <h2 className="view-title">🔄 Conversion Recovery Assistant</h2>
              <p className="view-sub">
                Recover the 20–40% of conversions lost to iOS14+, Safari ITP,
                and ad blockers. Get your Recovery Score, see which events you&apos;re
                missing, and generate a step-by-step server-side tracking setup
                guide.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 56 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            marginBottom: 28,
          }}
        >
          {/* Recovery Score Calculator */}
          <div style={cardStyle}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>
              📊 Recovery Score Calculator
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <label style={labelStyle}>Primary Ad Platform</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  style={selStyle}
                >
                  <option value="meta">Meta (Facebook / Instagram)</option>
                  <option value="google">Google Ads</option>
                  <option value="tiktok">TikTok Ads</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Current Pixel Type</label>
                <select
                  value={pixelType}
                  onChange={(e) => setPixelType(e.target.value)}
                  style={selStyle}
                >
                  <option value="client_side">Client-side pixel only</option>
                  <option value="server_side">
                    Server-side (CAPI/API) only
                  </option>
                  <option value="both">Both client + server</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Monthly Ad Spend ($)</label>
                <input
                  type="number"
                  placeholder="10000"
                  value={spend}
                  onChange={(e) => setSpend(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Geo Targeting?</label>
                <select
                  value={browser}
                  onChange={(e) => setBrowser(e.target.value)}
                  style={selStyle}
                >
                  <option value="false">No browser targeting</option>
                  <option value="true">Yes, browser/OS targeting</option>
                </select>
              </div>
            </div>
            <button
              onClick={runScore}
              style={{
                width: "100%",
                padding: 10,
                background: "#6366F1",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Calculate Recovery Score
            </button>
            <div style={{ marginTop: 16 }}>
              {scoreState === "loading" && <Spinner msg="Calculating…" />}
              {scoreErr && <p style={{ color: "#DC2626" }}>{scoreErr}</p>}
              {scoreState === "done" && score && (
                <>
                  <div style={{ textAlign: "center", marginBottom: 16 }}>
                    <div
                      style={{
                        fontSize: 48,
                        fontWeight: 800,
                        color: scoreColor,
                      }}
                    >
                      {score.score}
                    </div>
                    <div style={{ fontSize: 13, color: "#6B7280" }}>
                      Recovery Score (out of 100)
                    </div>
                  </div>
                  <div
                    style={{
                      background: "#FEF3C7",
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#92400E",
                      }}
                    >
                      You&apos;re losing ~{score.total_loss_pct}% of conversions
                    </div>
                    <div style={{ fontSize: 13, color: "#92400E" }}>
                      ~{score.recoverable_pct}% is recoverable with server-side
                      tracking
                      {score.monthly_missed_value
                        ? ` (≈$${score.monthly_missed_value.toLocaleString()}/mo)`
                        : ""}
                    </div>
                  </div>
                  {Object.entries(score.breakdown || {}).map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "5px 0",
                        borderBottom: "1px solid #F3F4F6",
                        fontSize: 13,
                      }}
                    >
                      <span style={{ color: "#6B7280" }}>
                        {k.replace(/_/g, " ")}
                      </span>
                      <span style={{ color: "#DC2626", fontWeight: 600 }}>
                        -{v}%
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Server-Side Setup Guide */}
          <div style={cardStyle}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>
              🛠️ Server-Side Setup Guide
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <label style={labelStyle}>Platform</label>
                <select
                  value={guidePlatform}
                  onChange={(e) => setGuidePlatform(e.target.value)}
                  style={selStyle}
                >
                  <option value="meta">Meta Conversions API</option>
                  <option value="google">Google Enhanced Conversions</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Conversion Goal</label>
                <select
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  style={selStyle}
                >
                  <option value="purchase">Purchase</option>
                  <option value="lead">Lead / Form Submit</option>
                  <option value="signup">Sign Up</option>
                  <option value="add_to_cart">Add to Cart</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Your Platform</label>
                <select
                  value={bizPlatform}
                  onChange={(e) => setBizPlatform(e.target.value)}
                  style={selStyle}
                >
                  <option value="shopify">Shopify</option>
                  <option value="woocommerce">WooCommerce</option>
                  <option value="custom">Custom / Other</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Server Language</label>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  style={selStyle}
                >
                  <option value="node">Node.js</option>
                  <option value="python">Python</option>
                  <option value="php">PHP</option>
                </select>
              </div>
            </div>
            <button
              onClick={runGuide}
              style={{
                width: "100%",
                padding: 10,
                background: "#059669",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Generate Setup Guide
            </button>
            <div style={{ marginTop: 16 }}>
              {guideState === "loading" && (
                <Spinner msg="Generating setup guide with AI — 15-30s…" />
              )}
              {guideErr && <p style={{ color: "#DC2626" }}>{guideErr}</p>}
              {guideState === "done" && guide && (
                <>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#374151",
                      marginBottom: 12,
                    }}
                  >
                    {guide.overview || ""}
                  </div>
                  {(guide.steps || []).map((s) => (
                    <div
                      key={s.step}
                      style={{
                        border: "1px solid #E5E7EB",
                        borderRadius: 8,
                        marginBottom: 10,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          background: "#F9FAFB",
                          padding: "10px 14px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <strong style={{ fontSize: 13, color: "#111827" }}>
                          Step {s.step}: {s.title}
                        </strong>
                        <span style={{ fontSize: 12, color: "#6B7280" }}>
                          {s.time_estimate}
                        </span>
                      </div>
                      <div style={{ padding: "12px 14px" }}>
                        <p
                          style={{
                            margin: "0 0 10px",
                            fontSize: 13,
                            color: "#374151",
                          }}
                        >
                          {s.description}
                        </p>
                        {s.code && (
                          <pre
                            style={{
                              background: "#1F2937",
                              color: "#F9FAFB",
                              padding: 14,
                              borderRadius: 7,
                              fontSize: 12,
                              overflowX: "auto",
                              whiteSpace: "pre-wrap",
                              margin: 0,
                            }}
                          >
                            {s.code}
                          </pre>
                        )}
                      </div>
                    </div>
                  ))}
                  {guide.expected_recovery_pct ? (
                    <div
                      style={{
                        background: "#D1FAE5",
                        borderRadius: 8,
                        padding: "10px 14px",
                        fontSize: 13,
                        color: "#065F46",
                      }}
                    >
                      <strong>Expected recovery:</strong>{" "}
                      {guide.expected_recovery_pct}% of lost conversions
                    </div>
                  ) : null}
                  {guide.docs_url ? (
                    <a
                      href={guide.docs_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-block",
                        marginTop: 10,
                        fontSize: 13,
                        color: "#6366F1",
                      }}
                    >
                      📖 Official Docs →
                    </a>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

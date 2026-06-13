"use client";

// Native React port of the legacy `press-release` panel
// (was `window.buildPressRelease` / `window._prGo` in app.js ~19027 filling
// `#prWrap`, header from `#view-press-release` in index.html). Drafts AP-style
// press releases via the existing Express API:
//   POST /api/press-release/generate
//     → { ok, release:{ headline, subhead, dateline, body, quote{text,attribution},
//                        boilerplate, contact{name,email} }, source }
// "Publish to Social" reuses the legacy global window._spPublishFromEl (still
// shipped in public/js/ig_intel_pack_a.js).

import { useRef, useState } from "react";
import { apiPost } from "@/lib/api";

interface PressQuote {
  text?: string;
  attribution?: string;
}
interface PressContact {
  name?: string;
  email?: string;
}
interface PressRelease {
  headline?: string;
  subhead?: string;
  dateline?: string;
  body?: string;
  quote?: PressQuote;
  boilerplate?: string;
  contact?: PressContact;
}
interface GenerateResult {
  ok: boolean;
  error?: string;
  release?: PressRelease;
  source?: string;
}

const KINDS: Array<{ value: string; label: string }> = [
  { value: "crisis_response", label: "🚨 Crisis Response" },
  { value: "product_launch", label: "🚀 Product Launch" },
  { value: "milestone", label: "🏆 Milestone" },
  { value: "counter_competitor", label: "⚔️ Counter Competitor" },
  { value: "partnership", label: "🤝 Partnership" },
  { value: "custom", label: "📝 Custom" },
];

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

declare global {
  interface Window {
    _spPublishFromEl?: (elId: string, label: string, platforms: string[]) => void;
    showToast?: (msg: string) => void;
  }
}

function toast(msg: string) {
  if (typeof window !== "undefined" && window.showToast) window.showToast(msg);
}

export default function PressRelease() {
  const [brand, setBrand] = useState("Nike");
  const [kind, setKind] = useState("crisis_response");
  const [spoke, setSpoke] = useState("");
  const [head, setHead] = useState("");
  const [ctx, setCtx] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [release, setRelease] = useState<PressRelease | null>(null);
  const [source, setSource] = useState("");
  const fullRef = useRef<HTMLDivElement>(null);

  async function generate() {
    if (!brand.trim()) return toast("⚠️ Brand required");
    if (!ctx.trim()) return toast("⚠️ Context required");
    setLoading(true);
    setError("");
    setRelease(null);
    const r = await apiPost<GenerateResult>("/api/press-release/generate", {
      brand: brand.trim(),
      kind,
      context: ctx,
      spokesperson: spoke,
      headline_hint: head,
    });
    setLoading(false);
    if (!r.ok || !r.release) {
      setError(r.error || "failed");
      return;
    }
    setRelease(r.release);
    setSource(r.source || "");
  }

  async function copyAll() {
    const el = fullRef.current;
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.innerText || el.textContent || "");
      toast("✅ Copied to clipboard");
    } catch (e) {
      toast("❌ " + (e instanceof Error ? e.message : "copy failed"));
    }
  }

  function publish() {
    window._spPublishFromEl?.("prFull", "Publish press release excerpt", [
      "linkedin",
      "facebook",
      "twitter",
    ]);
  }

  return (
    <>
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Press Releases
              </div>
              <h2 className="view-title">📰 AI Press Release Generator</h2>
              <p className="view-sub">
                Draft AP-style press releases for crisis response, product
                launches, milestones, partnerships and competitor
                counter-positioning. Pull context from any Crisis Incident or
                Battle Card.
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
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label style={labelStyle}>Brand</label>
              <input
                placeholder="e.g. Nike"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Type</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                style={inputStyle}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Spokesperson (optional)</label>
              <input
                placeholder="e.g. Jane Doe, CEO"
                value={spoke}
                onChange={(e) => setSpoke(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Headline hint (optional)</label>
              <input
                placeholder="e.g. emphasise innovation"
                value={head}
                onChange={(e) => setHead(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Context (what&apos;s the news?)</label>
            <textarea
              rows={5}
              placeholder="Describe the situation, news, or angle the release should cover. Be specific — facts, dates, numbers."
              value={ctx}
              onChange={(e) => setCtx(e.target.value)}
              style={{
                ...inputStyle,
                padding: "10px 12px",
                fontSize: "0.86rem",
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
          </div>
          <button
            onClick={generate}
            disabled={loading}
            style={{
              marginTop: 12,
              padding: "10px 22px",
              background: "#EC4899",
              border: "2px solid #EC4899",
              borderRadius: 8,
              fontSize: "0.84rem",
              fontWeight: 800,
              color: "#fff",
              WebkitTextFillColor: "#fff",
              cursor: "pointer",
              textShadow: "0 1px 2px rgba(0,0,0,.4)",
            }}
          >
            📰 Generate Press Release
          </button>
        </div>

        <div>
          {loading && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 20,
                color: "#6B7280",
              }}
            >
              ⏳ Drafting press release…
            </div>
          )}
          {error && !loading && (
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
          {release && !loading && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: "28px 32px",
                fontFamily: "Georgia,serif",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                  fontFamily: "system-ui,sans-serif",
                }}
              >
                <div
                  style={{
                    fontSize: "0.66rem",
                    color: "#9CA3AF",
                    fontWeight: 700,
                    letterSpacing: ".1em",
                  }}
                >
                  FOR IMMEDIATE RELEASE · {(source || "").toUpperCase()}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={copyAll}
                    style={{
                      padding: "6px 12px",
                      background: "#fff",
                      border: "2px solid #D1D5DB",
                      borderRadius: 5,
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: "#374151",
                      cursor: "pointer",
                    }}
                  >
                    📋 Copy All
                  </button>
                  <button
                    onClick={publish}
                    style={{
                      padding: "6px 12px",
                      background: "linear-gradient(135deg,#FF5722,#FF7043)",
                      border: "none",
                      borderRadius: 5,
                      fontSize: "0.7rem",
                      fontWeight: 800,
                      color: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    📤 Publish to Social
                  </button>
                </div>
              </div>
              <div id="prFull" ref={fullRef}>
                <h1
                  style={{
                    fontSize: "1.6rem",
                    color: "#0A1628",
                    margin: "0 0 8px",
                    lineHeight: 1.25,
                  }}
                >
                  {release.headline || ""}
                </h1>
                <div
                  style={{
                    fontSize: "1rem",
                    color: "#475569",
                    marginBottom: 18,
                    fontStyle: "italic",
                  }}
                >
                  {release.subhead || ""}
                </div>
                <div
                  style={{
                    fontSize: "0.86rem",
                    color: "#0A1628",
                    fontWeight: 700,
                    marginBottom: 14,
                  }}
                >
                  {release.dateline || ""}
                </div>
                <div
                  style={{
                    fontSize: "0.95rem",
                    color: "#1F2937",
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                    marginBottom: 18,
                  }}
                >
                  {release.body || ""}
                </div>
                {release.quote && (
                  <blockquote
                    style={{
                      borderLeft: "4px solid #EC4899",
                      padding: "10px 18px",
                      margin: "18px 0",
                      background: "#FDF2F8",
                      fontStyle: "italic",
                      color: "#1F2937",
                      fontSize: "0.95rem",
                      lineHeight: 1.6,
                    }}
                  >
                    &quot;{release.quote.text || ""}&quot;
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: "0.8rem",
                        color: "#6B7280",
                        fontStyle: "normal",
                        fontWeight: 600,
                      }}
                    >
                      — {release.quote.attribution || ""}
                    </div>
                  </blockquote>
                )}
                <div
                  style={{
                    marginTop: 20,
                    paddingTop: 16,
                    borderTop: "1px solid #E5E7EB",
                    fontSize: "0.85rem",
                    color: "#475569",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {release.boilerplate || ""}
                </div>
                {release.contact && (
                  <div
                    style={{
                      marginTop: 14,
                      fontSize: "0.78rem",
                      color: "#6B7280",
                    }}
                  >
                    Press contact: <strong>{release.contact.name || ""}</strong> —{" "}
                    {release.contact.email || ""}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

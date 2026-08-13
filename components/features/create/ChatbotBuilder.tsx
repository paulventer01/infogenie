"use client";

// Native React port of the legacy `chatbot-builder` panel (was
// `window.buildChatbotBuilder` in `public/js/ig_intel_pack_a.js` +
// `#view-chatbot-builder` in index.html). Generates a website FAQ chatbot —
// greeting, Q&A, fallback, lead-capture fields and a copy-pasteable embed
// snippet — from a one-line description via the existing Express API
// (`POST /api/chatbot/generate`) through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiPost } from "@/lib/api";

interface FaqEntry {
  kind?: string;
  q?: string;
  a?: string;
}
interface LeadField {
  label?: string;
  key?: string;
  required?: boolean;
}
interface ChatbotResult {
  ok: boolean;
  error?: string;
  id?: number | string;
  brand?: string;
  accent?: string;
  greeting?: string;
  quick_replies?: string[];
  faq?: FaqEntry[];
  fallback?: string;
  lead_fields?: LeadField[];
}

const TONES = ["friendly", "professional", "playful", "concise", "enthusiastic"];

export default function ChatbotBuilder() {
  const [brand, setBrand] = useState("");
  const [audience, setAudience] = useState("");
  const [description, setDescription] = useState("");
  const [tone, setTone] = useState("friendly");
  const [accent, setAccent] = useState("#6366F1");

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState("");
  const [result, setResult] = useState<ChatbotResult | null>(null);
  const [copied, setCopied] = useState(false);

  const safeAccent = result
    ? /^#[0-9a-f]{3,8}$/i.test(result.accent || "")
      ? (result.accent as string)
      : "#6366F1"
    : "#6366F1";

  function buildEmbedSnippet(r: ChatbotResult): string {
    const id = Number(r.id) || 0;
    const cfg = JSON.stringify(
      {
        id: Number(r.id),
        greeting: r.greeting,
        faq: r.faq,
        fallback: r.fallback,
        lead_fields: r.lead_fields,
        accent: safeAccent,
      },
      null,
      2,
    );
    const safeBrand = brand.replace(/[<>]/g, "");
    const attrBrand = brand.replace(/"/g, "&quot;");
    const jsBrand = brand.replace(/'/g, "\\'");
    return `<!-- ${safeBrand} chatbot -->
<div id="ig-chatbot-${id}" data-brand="${attrBrand}"></div>
<script>
(function(){
  var cfg = ${cfg};
  // TODO: wire cfg into your chatbot frontend (Tidio, Crisp, Intercom, or custom).
  console.log('${jsBrand} chatbot config loaded:', cfg);
})();
<\/script>`;
  }

  async function generate() {
    if (!brand.trim()) {
      setStatus("error");
      setError("⚠ Brand required");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<ChatbotResult>("/api/chatbot/generate", {
      brand: brand.trim(),
      description: description.trim(),
      audience: audience.trim(),
      tone,
      accent,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setResult(r);
    setStatus("done");
  }

  function copySnippet() {
    if (!result) return;
    const text = buildEmbedSnippet(result);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      });
    }
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#6B7280",
    marginBottom: 3,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: 8,
    border: "1px solid #D1D5DB",
    borderRadius: 5,
    fontSize: "0.84rem",
    boxSizing: "border-box",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Chatbot Builder
              </div>
              <h2 className="view-title">💬 Chatbot Builder</h2>
              <p className="view-sub">
                Generate a website FAQ chatbot — greeting, 8-15 Q&amp;A entries,
                fallback handler, lead-capture form and a copy-pasteable embed
                snippet — all from a one-line description.
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
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div>
              <label style={labelStyle}>BRAND NAME *</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Acme Inc"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>AUDIENCE</label>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. small-business owners"
                style={inputStyle}
              />
            </div>
          </div>
          <label style={labelStyle}>PRODUCT / SERVICE DESCRIPTION</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="e.g. We sell AI-powered marketing intelligence software starting at $99/month. Self-serve signup, 14-day free trial. Integrates with HubSpot and Salesforce."
            style={{ ...inputStyle, marginBottom: 10, fontFamily: "inherit" }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <div>
              <label style={labelStyle}>TONE</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                style={{ ...inputStyle, padding: 7 }}
              >
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>ACCENT COLOR</label>
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                style={{ ...inputStyle, padding: 3, height: 34 }}
              />
            </div>
          </div>
          <button
            onClick={generate}
            disabled={status === "loading"}
            style={{
              background: "linear-gradient(135deg,#6366F1,#0284c7)",
              color: "#fff",
              border: "none",
              padding: "10px 20px",
              borderRadius: 6,
              fontSize: "0.84rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            💬 Generate Chatbot
          </button>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ color: "#9CA3AF" }}>
              ⏳ GPT-4o-mini drafting greeting + FAQ + lead-capture (10-20s)…
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
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 18,
              }}
            >
              <div>
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    overflow: "hidden",
                    borderLeft: `4px solid ${safeAccent}`,
                  }}
                >
                  <div
                    style={{
                      background: safeAccent,
                      color: "#fff",
                      padding: "12px 16px",
                      fontWeight: 800,
                    }}
                  >
                    💬 {result.brand}{" "}
                    <span
                      style={{
                        opacity: 0.8,
                        fontWeight: 500,
                        fontSize: "0.8rem",
                      }}
                    >
                      · Live preview
                    </span>
                  </div>
                  <div
                    style={{
                      padding: "14px 16px",
                      background: "#F9FAFB",
                      fontSize: "0.85rem",
                      color: "#0A1628",
                      borderBottom: "1px solid #F3F4F6",
                    }}
                  >
                    <strong>Bot:</strong> {result.greeting}
                  </div>
                  <div
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      borderBottom: "1px solid #F3F4F6",
                    }}
                  >
                    {(result.quick_replies || []).map((q, i) => (
                      <span
                        key={i}
                        style={{
                          background: "#fff",
                          border: `1px solid ${safeAccent}`,
                          color: safeAccent,
                          padding: "4px 10px",
                          borderRadius: 14,
                          fontSize: "0.74rem",
                          fontWeight: 700,
                        }}
                      >
                        {q}
                      </span>
                    ))}
                  </div>
                  <div style={{ maxHeight: 340, overflowY: "auto" }}>
                    {(result.faq || []).map((f, i) => (
                      <div
                        key={i}
                        style={{
                          padding: "10px 16px",
                          borderBottom: "1px solid #F3F4F6",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: "#6B7280",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            marginBottom: 3,
                          }}
                        >
                          {f.kind}
                        </div>
                        <div
                          style={{
                            fontSize: "0.84rem",
                            fontWeight: 700,
                            color: "#0A1628",
                            marginBottom: 4,
                          }}
                        >
                          Q: {f.q}
                        </div>
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "#374151",
                            lineHeight: 1.5,
                          }}
                        >
                          A: {f.a}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      padding: "12px 16px",
                      background: "#F9FAFB",
                      fontSize: "0.78rem",
                      color: "#6B7280",
                      fontStyle: "italic",
                    }}
                  >
                    Fallback: {result.fallback}
                  </div>
                </div>
              </div>
              <div>
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 14,
                  }}
                >
                  <h3
                    style={{
                      margin: "0 0 8px",
                      fontSize: "0.92rem",
                      color: "#0A1628",
                    }}
                  >
                    📝 Lead-capture fields
                  </h3>
                  {(result.lead_fields || []).map((lf, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "6px 0",
                        borderBottom: "1px solid #F3F4F6",
                        fontSize: "0.82rem",
                      }}
                    >
                      <span>
                        <strong>{lf.label}</strong>{" "}
                        <code
                          style={{
                            background: "#F3F4F6",
                            padding: "1px 6px",
                            borderRadius: 4,
                            fontSize: "0.72rem",
                            color: "#6B7280",
                          }}
                        >
                          {lf.key}
                        </code>
                      </span>
                      {lf.required ? (
                        <span
                          style={{
                            color: "#DC2626",
                            fontWeight: 700,
                            fontSize: "0.72rem",
                          }}
                        >
                          REQUIRED
                        </span>
                      ) : (
                        <span
                          style={{ color: "#9CA3AF", fontSize: "0.72rem" }}
                        >
                          optional
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    background: '#eef4ff',
                    borderRadius: 12,
                    padding: 14,
                    color: "#E5E7EB",
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
                    <h3
                      style={{ margin: 0, fontSize: "0.92rem", color: "#0f172a" }}
                    >
                      📋 Embed snippet
                    </h3>
                    <button
                      onClick={copySnippet}
                      style={{
                        background: safeAccent,
                        color: "#0f172a",
                        border: "none",
                        padding: "5px 12px",
                        borderRadius: 5,
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {copied ? "✓ Copied" : "📋 Copy"}
                    </button>
                  </div>
                  <pre
                    style={{
                      background: "#1F2937",
                      padding: 10,
                      borderRadius: 6,
                      fontSize: "0.7rem",
                      color: '#0f766e',
                      overflow: "auto",
                      maxHeight: 280,
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {buildEmbedSnippet(result)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

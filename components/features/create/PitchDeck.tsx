"use client";

// Native React port of the legacy `pitch-deck` panel (was
// `window.buildPitchDeck` + `#view-pitch-deck` in index.html, defined in
// public/js/ig_design_studio.js). Generates a structured pitch deck via the
// existing Express API (`POST /api/pitch-deck/generate`,
// `GET /api/pitch-deck/history`) through `lib/api`, and exports a PPTX via the
// binary endpoint `POST /api/pitch-deck/export-pptx` (`lib/api` `apiBlob`).
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiBlob } from "@/lib/api";

interface Slide {
  type?: string;
  headline?: string;
  subheadline?: string;
  stat?: string;
  stat_label?: string;
  bullets?: string[];
  speaker_notes?: string;
}
interface DeckResult {
  ok: boolean;
  error?: string;
  id?: number;
  deck_title: string;
  tagline?: string;
  slides: Slide[];
  source?: string;
}
interface DeckHistory {
  id: number;
  deck_title: string;
  goal: string;
  slide_count: number;
  created_at: string;
}

const TYPE_EMOJI: Record<string, string> = {
  title: "🎯",
  problem: "💔",
  solution: "✅",
  market: "📈",
  product: "🚀",
  how_it_works: "⚙️",
  traction: "📊",
  business_model: "💰",
  team: "👥",
  roadmap: "🗺️",
  cta: "🎯",
  custom: "📌",
};
const GOAL_LABEL: Record<string, string> = {
  investor: "🏦 Investor",
  sales: "🤝 Sales",
  marketing: "📣 Marketing",
  product: "🚀 Product",
  internal: "🏢 Internal",
};

function toast(msg: string, ok = true) {
  if (typeof document === "undefined") return;
  const t = document.createElement("div");
  t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${ok ? "#22C55E" : "#EF4444"};color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18)`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

async function downloadPptx(body: unknown, filename: string) {
  const blob = await apiBlob("/api/pitch-deck/export-pptx", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  border: "1.5px solid #E2E8F0",
  padding: "28px 32px",
  marginBottom: 24,
};
const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
  display: "block",
  marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  border: "1.5px solid #E2E8F0",
  borderRadius: 10,
  fontSize: 14,
  color: "#1E293B",
  outline: "none",
  boxSizing: "border-box",
};

export default function PitchDeck() {
  const [brand, setBrand] = useState("");
  const [goal, setGoal] = useState("investor");
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [numSlides, setNumSlides] = useState("12");
  const [extra, setExtra] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<DeckResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [history, setHistory] = useState<DeckHistory[]>([]);

  async function loadHistory() {
    const r = await apiGet<{ ok: boolean; decks?: DeckHistory[] }>(
      "/api/pitch-deck/history",
    );
    if (r.ok && r.decks?.length) setHistory(r.decks);
    else setHistory([]);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function generate() {
    if (!brand.trim() && !product.trim()) {
      toast("Enter a brand name or product description first.", false);
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<DeckResult>("/api/pitch-deck/generate", {
      brand: brand.trim(),
      product: product.trim(),
      goal,
      audience: audience.trim(),
      extra: extra.trim(),
      num_slides: parseInt(numSlides, 10),
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "Generation failed");
      return;
    }
    setResult(r);
    setStatus("idle");
    loadHistory();
  }

  async function exportDeck() {
    if (!result) return;
    setExporting(true);
    try {
      await downloadPptx(
        {
          id: result.id,
          slides: result.slides,
          deck_title: result.deck_title,
          tagline: result.tagline,
        },
        `pitch-deck-${(result.deck_title || "deck").replace(/\s+/g, "_").toLowerCase()}.pptx`,
      );
      toast("PPTX downloaded!", true);
    } catch {
      toast("Export failed — try again", false);
    } finally {
      setExporting(false);
    }
  }

  async function reExport(id: number) {
    try {
      await downloadPptx({ id }, `pitch-deck-${id}.pptx`);
      toast("PPTX downloaded!", true);
    } catch {
      toast("Export failed", false);
    }
  }

  return (
    <div className="view-header-wrap">
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Pitch Deck Builder
              </div>
              <h2 className="view-title">📊 AI Pitch Deck Builder</h2>
              <p className="view-sub">
                Generate a fully-structured pitch deck in seconds — investor,
                sales, marketing, or product. Exports as a polished PPTX with
                speaker notes ready to present.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={cardStyle}>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#1E293B",
              margin: "0 0 6px",
            }}
          >
            Generate Your Pitch Deck
          </h3>
          <p style={{ color: "#64748B", fontSize: 14, margin: "0 0 24px" }}>
            Fill in the details below and get a fully-structured deck with
            speaker notes — exported as a polished PPTX.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div>
              <label style={labelStyle}>Brand / Company Name *</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                type="text"
                placeholder="e.g. InfoGenie"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Deck Goal</label>
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                style={{ ...inputStyle, background: "#fff" }}
              >
                <option value="investor">🏦 Investor Pitch</option>
                <option value="sales">🤝 Sales Deck</option>
                <option value="marketing">📣 Marketing / Brand Story</option>
                <option value="product">🚀 Product Demo / Launch</option>
                <option value="internal">🏢 Internal Strategy / OKRs</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Product / Service Description *</label>
            <textarea
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              rows={3}
              placeholder="What does your company do? Who is it for? What's the core value proposition?"
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div>
              <label style={labelStyle}>Target Audience</label>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                type="text"
                placeholder="e.g. Marketing teams at Series B SaaS"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Number of Slides</label>
              <select
                value={numSlides}
                onChange={(e) => setNumSlides(e.target.value)}
                style={{ ...inputStyle, background: "#fff" }}
              >
                <option value="8">8 slides (concise)</option>
                <option value="10">10 slides</option>
                <option value="12">12 slides (recommended)</option>
                <option value="15">15 slides (detailed)</option>
                <option value="18">18 slides (comprehensive)</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>
              Additional context{" "}
              <span style={{ fontWeight: 400, color: "#94A3B8" }}>
                (optional)
              </span>
            </label>
            <input
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              type="text"
              placeholder="e.g. raising $2M, 32 customers, NPS 72, closing June 30"
              style={inputStyle}
            />
          </div>

          <button
            onClick={generate}
            disabled={status === "loading"}
            style={{
              background: "#6366F1",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "13px 28px",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            📊 Generate Pitch Deck
          </button>
        </div>

        <div style={{ marginTop: 8 }}>
          {status === "loading" && (
            <div style={{ textAlign: "center", padding: "64px 24px" }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  border: "4px solid #E5E7EB",
                  borderTopColor: "#6366F1",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  margin: "0 auto 16px",
                }}
              />
              <p style={{ color: "#64748B", fontSize: 14 }}>
                Building your pitch deck… this takes 20-30 seconds
              </p>
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1.5px solid #FECACA",
                borderRadius: 12,
                padding: 20,
                color: "#DC2626",
              }}
            >
              {error}
            </div>
          )}
          {status === "idle" && result && (
            <div style={cardStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                  marginBottom: 20,
                }}
              >
                <div>
                  <h3
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      color: "#1E293B",
                      margin: "0 0 4px",
                    }}
                  >
                    {result.deck_title}
                  </h3>
                  {result.tagline && (
                    <p
                      style={{
                        color: "#6366F1",
                        fontSize: 14,
                        fontWeight: 600,
                        margin: 0,
                      }}
                    >
                      &quot;{result.tagline}&quot;
                    </p>
                  )}
                </div>
                <button
                  onClick={exportDeck}
                  disabled={exporting}
                  style={{
                    background: "#22C55E",
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    padding: "11px 22px",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {exporting ? "⏳ Preparing…" : "⬇️ Download PPTX"}
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
                  gap: 16,
                }}
              >
                {(result.slides || []).map((s, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#F8FAFC",
                      borderRadius: 12,
                      border: "1.5px solid #E2E8F0",
                      padding: 16,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 8,
                      }}
                    >
                      <span
                        style={{
                          background: "#EEF2FF",
                          borderRadius: 6,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#6366F1",
                        }}
                      >
                        {i + 1}
                      </span>
                      <span style={{ fontSize: 14 }}>
                        {TYPE_EMOJI[s.type || ""] || "📌"}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#94A3B8",
                          textTransform: "uppercase",
                        }}
                      >
                        {s.type || "slide"}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: "#1E293B",
                        margin: "0 0 6px",
                      }}
                    >
                      {s.headline}
                    </p>
                    {s.subheadline && (
                      <p
                        style={{
                          fontSize: 12,
                          color: "#64748B",
                          margin: "0 0 8px",
                          fontStyle: "italic",
                        }}
                      >
                        {s.subheadline}
                      </p>
                    )}
                    {s.stat && (
                      <>
                        <div
                          style={{
                            fontSize: 22,
                            fontWeight: 800,
                            color: "#6366F1",
                            margin: "4px 0 2px",
                          }}
                        >
                          {s.stat}
                        </div>
                        {s.stat_label && (
                          <div style={{ fontSize: 11, color: "#94A3B8" }}>
                            {s.stat_label}
                          </div>
                        )}
                      </>
                    )}
                    {(s.bullets || []).slice(0, 3).map((b, bi) => (
                      <div
                        key={bi}
                        style={{
                          fontSize: 12,
                          color: "#475569",
                          marginTop: 4,
                          paddingLeft: 10,
                          borderLeft: "2px solid #6366F1",
                        }}
                      >
                        {b}
                      </div>
                    ))}
                    {s.speaker_notes && (
                      <details style={{ marginTop: 8 }}>
                        <summary
                          style={{
                            fontSize: 11,
                            color: "#94A3B8",
                            cursor: "pointer",
                          }}
                        >
                          📝 Speaker notes
                        </summary>
                        <p
                          style={{
                            fontSize: 11,
                            color: "#64748B",
                            margin: "4px 0 0",
                            lineHeight: 1.5,
                          }}
                        >
                          {s.speaker_notes}
                        </p>
                      </details>
                    )}
                  </div>
                ))}
              </div>

              {result.source === "template" && (
                <p
                  style={{
                    marginTop: 16,
                    fontSize: 12,
                    color: "#94A3B8",
                    textAlign: "right",
                  }}
                >
                  ⚠️ Template used (AI unavailable) — add an OpenAI key for
                  AI-generated decks
                </p>
              )}
            </div>
          )}
        </div>

        {history.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ ...cardStyle, marginTop: 0 }}>
              <h4
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#1E293B",
                  margin: "0 0 16px",
                }}
              >
                Recent Decks
              </h4>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {history.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "#F8FAFC",
                      borderRadius: 10,
                      padding: "12px 16px",
                      border: "1.5px solid #E2E8F0",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "#1E293B",
                        }}
                      >
                        {d.deck_title}
                      </span>
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          background: "#EEF2FF",
                          color: "#6366F1",
                          padding: "2px 8px",
                          borderRadius: 6,
                          fontWeight: 600,
                        }}
                      >
                        {GOAL_LABEL[d.goal] || d.goal}
                      </span>
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          color: "#94A3B8",
                        }}
                      >
                        {d.slide_count} slides ·{" "}
                        {new Date(d.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      onClick={() => reExport(d.id)}
                      style={{
                        background: "#F1F5F9",
                        border: "none",
                        borderRadius: 8,
                        padding: "7px 14px",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        color: "#374151",
                      }}
                    >
                      ⬇️ PPTX
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

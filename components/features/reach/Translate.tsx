"use client";

// Native React port of the legacy `translate` panel (was
// `window.buildTranslation` in public/js/ig_customer_engagement.js +
// `#view-translate`). Translates a drip sequence to any language while
// preserving brand voice via the existing Express API
// (`POST /api/drips/translate`) through lib/api.

import { useState } from "react";
import { apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface Step {
  subject: string;
  body: string;
}
interface TranslateResponse {
  ok: boolean;
  error?: string;
  translated_sequence?: Step[];
  target_language?: string;
  step_count?: number;
}

export default function Translate() {
  const toast = useToast();
  const [lang, setLang] = useState("");
  const [brand, setBrand] = useState("");
  const [steps, setSteps] = useState<Step[]>([{ subject: "", body: "" }]);
  const [translating, setTranslating] = useState(false);
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [lastTranslated, setLastTranslated] = useState<Step[] | null>(null);

  function updateStep(i: number, key: keyof Step, value: string) {
    setSteps((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)),
    );
  }
  function addStep() {
    setSteps((prev) => [...prev, { subject: "", body: "" }]);
  }
  function delStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function translate() {
    if (!lang.trim()) {
      toast("Enter a target language.");
      return;
    }
    const seq = steps.filter((s) => s.subject || s.body);
    if (!seq.length) {
      toast("Add at least one step with content.");
      return;
    }
    setTranslating(true);
    const d = await apiPost<TranslateResponse>("/api/drips/translate", {
      sequence: seq,
      target_language: lang.trim(),
      brand_name: brand.trim(),
    });
    setTranslating(false);
    if (!d.ok) {
      toast(d.error || "Translation failed");
      return;
    }
    setResult(d);
    setLastTranslated(d.translated_sequence || null);
    toast(`${d.step_count} steps translated to ${d.target_language}!`);
  }

  function copy() {
    if (!lastTranslated) return;
    navigator.clipboard
      .writeText(JSON.stringify(lastTranslated, null, 2))
      .then(() => toast("Copied!"));
  }

  return (
    <div>
      <div className="view-header">
        <h2>🌍 AI Campaign Translator</h2>
        <p className="view-sub">
          Translate an entire drip sequence to any language while preserving your
          brand voice, placeholders, and formatting.
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          maxWidth: 1200,
        }}
      >
        <div>
          <div className="ig-card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>
              Source Sequence
            </h3>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label>Target Language</label>
                <input
                  className="form-control"
                  placeholder="e.g. Spanish, French, German, Japanese"
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label>Brand Name</label>
                <input
                  className="form-control"
                  placeholder="Your brand name"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
              </div>
            </div>
            <div>
              {steps.map((s, i) => (
                <div
                  key={i}
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "0.82rem",
                        color: "#374151",
                      }}
                    >
                      Step {i + 1}
                    </span>
                    {i > 0 && (
                      <button
                        onClick={() => delStep(i)}
                        style={{
                          padding: "2px 8px",
                          background: "#fee2e2",
                          color: "#b91c1c",
                          border: "1px solid #fca5a5",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: "0.78rem",
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <input
                    className="form-control"
                    placeholder="Subject line…"
                    style={{ marginBottom: 6, fontSize: "0.85rem" }}
                    value={s.subject}
                    onChange={(e) => updateStep(i, "subject", e.target.value)}
                  />
                  <textarea
                    className="form-control"
                    rows={3}
                    placeholder="Email body…"
                    style={{ fontSize: "0.85rem" }}
                    value={s.body}
                    onChange={(e) => updateStep(i, "body", e.target.value)}
                  />
                </div>
              ))}
            </div>
            <button
              onClick={addStep}
              style={{
                marginTop: 8,
                padding: "7px 16px",
                background: "#f1f5f9",
                border: "1px solid #e2e8f0",
                borderRadius: 7,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.85rem",
              }}
            >
              + Add Email Step
            </button>
            <button
              className="btn btn-primary"
              style={{ marginTop: 12, width: "100%" }}
              disabled={translating}
              onClick={translate}
            >
              {translating ? "⏳ Translating…" : "🌍 Translate All Steps"}
            </button>
          </div>
        </div>
        <div>
          <div className="ig-card">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Translated Sequence</h3>
              <button
                onClick={copy}
                disabled={!lastTranslated}
                style={{
                  padding: "5px 12px",
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: "0.82rem",
                }}
              >
                📋 Copy JSON
              </button>
            </div>
            <div>
              {result === null ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 40,
                    color: "#94a3b8",
                    fontSize: "0.9rem",
                  }}
                >
                  Paste your drip steps on the left and click Translate.
                </div>
              ) : (
                (result.translated_sequence || []).map((s, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "0.82rem",
                        color: "#374151",
                        marginBottom: 6,
                      }}
                    >
                      Step {i + 1} → {result.target_language}
                    </div>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        color: "#6366f1",
                        marginBottom: 4,
                      }}
                    >
                      {s.subject}
                    </div>
                    <div
                      style={{
                        fontSize: "0.83rem",
                        color: "#374151",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {s.body}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

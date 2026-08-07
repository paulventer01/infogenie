"use client";

// Native React port of the legacy `ai-segments` panel (was
// `window.buildAiSegments` in public/js/ig_customer_engagement.js +
// `#view-ai-segments`). Asks the AI to suggest complementary audience segments
// via the existing Express API (`POST /api/audiences/ai-suggest`) through lib/api.

import { useState } from "react";
import { apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface Suggestion {
  name?: string;
  description?: string;
  rationale?: string;
  rules?: { conditions?: unknown[] } & Record<string, unknown>;
}
interface SuggestResponse {
  ok: boolean;
  error?: string;
  suggestions?: Suggestion[];
}

const ICONS = ["🎯", "👥", "💡", "🔥", "⭐"];

export default function AiSegments() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  async function run() {
    setLoading(true);
    setSuggestions(null);
    const d = await apiPost<SuggestResponse>("/api/audiences/ai-suggest", {});
    setLoading(false);
    if (!d.ok) {
      toast(d.error || "Error");
      return;
    }
    setSuggestions(d.suggestions || []);
  }

  return (
    <div>
      <div className="view-header ig-panel-hero">
        <h2>🧠 AI Segment Suggestions</h2>
        <p className="view-sub">
          Let AI analyse your existing audiences and propose new high-value
          segments you haven&apos;t thought of yet.
        </p>
      </div>
      <div style={{ maxWidth: 900 }}>
        <div className="ig-card" style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <p style={{ margin: 0, fontSize: "0.88rem", color: "#374151" }}>
              AI reviews your existing segments and suggests 5 complementary
              audiences with rationale and rule templates.
            </p>
            <button
              className="btn btn-primary"
              style={{ padding: "10px 22px", whiteSpace: "nowrap" }}
              disabled={loading}
              onClick={run}
            >
              {loading ? "⏳ Analysing…" : "🤖 Suggest Segments"}
            </button>
          </div>
          {loading && (
            <div
              style={{
                textAlign: "center",
                padding: 32,
                color: "#6b7280",
                fontSize: "0.9rem",
              }}
            >
              ⏳ Loading…
            </div>
          )}
        </div>
        <div>
          {suggestions !== null &&
            (suggestions.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: 40,
                  color: "#94a3b8",
                  fontSize: "0.9rem",
                }}
              >
                No suggestions returned.
              </div>
            ) : (
              suggestions.map((s, i) => (
                <div
                  key={i}
                  className="ig-card"
                  style={{ marginBottom: 12, borderLeft: "4px solid #6366f1" }}
                >
                  <div style={{ display: "flex", alignItems: "start", gap: 12 }}>
                    <div style={{ fontSize: "1.5rem" }}>{ICONS[i] || "📌"}</div>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: "0.95rem",
                          marginBottom: 4,
                        }}
                      >
                        {s.name}
                      </div>
                      <div
                        style={{
                          fontSize: "0.85rem",
                          color: "#374151",
                          marginBottom: 6,
                        }}
                      >
                        {s.description}
                      </div>
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "#6b7280",
                          fontStyle: "italic",
                          marginBottom: 8,
                        }}
                      >
                        💡 {s.rationale}
                      </div>
                      {s.rules?.conditions?.length ? (
                        <div
                          style={{
                            fontSize: "0.78rem",
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderRadius: 6,
                            padding: 8,
                            fontFamily: "monospace",
                          }}
                        >
                          {JSON.stringify(s.rules, null, 2).slice(0, 200)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            ))}
        </div>
      </div>
    </div>
  );
}

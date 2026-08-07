"use client";

// Native React port of the legacy `question-miner` panel (was
// `window.buildQuestionMiner` + `#view-question-miner` in index.html). Pulls
// People-Also-Ask + related queries for a seed keyword, groups them by
// What/Why/How/etc, and one-clicks any into the Content Calendar — via the
// existing Express API (`POST /api/question-miner/mine` and
// `POST /api/question-miner/to-calendar`) through `lib/api`. Pre-fills the seed
// from the legacy `window.analysisData` global.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiPost } from "@/lib/api";

interface MinedQuestion {
  question: string;
}
interface MineResult {
  ok: boolean;
  error?: string;
  total?: number;
  seed?: string;
  source?: string;
  grouped?: Record<string, MinedQuestion[]>;
}
interface AnalysisData {
  industry?: string | { name?: string };
  brandName?: string;
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || {}
  );
}
function autoSeed(): string {
  const ad = getAnalysisData();
  const industry =
    typeof ad.industry === "string"
      ? ad.industry
      : (ad.industry && ad.industry.name) || "";
  return industry || ad.brandName || "";
}

export default function QuestionMiner() {
  const [seed, setSeed] = useState("");
  const [prefilled, setPrefilled] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "empty">(
    "empty",
  );
  const [error, setError] = useState("");
  const [result, setResult] = useState<MineResult | null>(null);
  const [added, setAdded] = useState<Record<string, "done" | "fail">>({});

  useEffect(() => {
    const s = autoSeed();
    if (s) {
      setSeed(s);
      setPrefilled(true);
    }
  }, []);

  async function run() {
    const s = seed.trim();
    if (!s) {
      setStatus("error");
      setError(
        "⚠️ Please enter a keyword or topic to mine questions for.",
      );
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    setAdded({});
    const r = await apiPost<MineResult>("/api/question-miner/mine", { seed: s });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setResult(r);
    setStatus("idle");
  }

  async function addToCalendar(question: string) {
    const r = await apiPost("/api/question-miner/to-calendar", {
      question,
      channel: "blog",
    });
    setAdded((prev) => ({ ...prev, [question]: r.ok ? "done" : "fail" }));
  }

  const buckets = result?.grouped ? Object.keys(result.grouped).sort() : [];

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Question Mining
              </div>
              <h2 className="view-title">❔ Question Mining</h2>
              <p className="view-sub">
                What are people actually typing into Google about your topic?
                Pulls People Also Ask + related queries, groups them by
                What/Why/How/etc, and one-clicks any of them into your Content
                Calendar.
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
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <label
              style={{
                display: "block",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6B7280",
                marginBottom: 3,
              }}
            >
              SEED KEYWORD / TOPIC{" "}
              {prefilled && (
                <span style={{ color: "#15803D", fontWeight: 600 }}>
                  (auto-filled from your analysis)
                </span>
              )}
            </label>
            <input
              value={seed}
              onChange={(e) => {
                setSeed(e.target.value);
                setPrefilled(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="e.g. solar panel installation"
              style={{
                width: "100%",
                padding: 9,
                border: "1px solid #D1D5DB",
                borderRadius: 6,
                boxSizing: "border-box",
                background: prefilled ? "#F0FDF4" : "#fff",
              }}
            />
          </div>
          <button
            onClick={run}
            disabled={status === "loading"}
            style={{
              background: "linear-gradient(135deg,#0066FF,#7C3AED)",
              color: "#fff",
              border: 0,
              padding: "10px 22px",
              borderRadius: 7,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            🔎 Mine Questions
          </button>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ color: "#9CA3AF" }}>
              ⏳ Asking Google what people ask…
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEF3C7",
                color: "#92400E",
                padding: "10px 14px",
                borderRadius: 8,
              }}
            >
              {error}
            </div>
          )}
          {status === "idle" && result && (
            <>
              <div
                style={{
                  marginBottom: 12,
                  fontSize: "0.85rem",
                  color: "#6B7280",
                }}
              >
                {result.total} question(s) for{" "}
                <strong>{result.seed}</strong> · source: {result.source}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
                  gap: 14,
                }}
              >
                {buckets.map((b) => (
                  <div
                    key={b}
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 10,
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 800,
                        color: "#0A1628",
                        textTransform: "uppercase",
                        fontSize: "0.78rem",
                        marginBottom: 8,
                      }}
                    >
                      {b} ({result.grouped?.[b].length || 0})
                    </div>
                    {(result.grouped?.[b] || []).map((q, i) => {
                      const state = added[q.question];
                      return (
                        <div
                          key={i}
                          style={{
                            padding: "8px 0",
                            borderTop: "1px solid #F3F4F6",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 8,
                            alignItems: "flex-start",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.84rem",
                              color: "#374151",
                              lineHeight: 1.4,
                            }}
                          >
                            {q.question}
                          </div>
                          <button
                            onClick={() => addToCalendar(q.question)}
                            disabled={state === "done"}
                            style={{
                              background:
                                state === "done" ? "#D1FAE5" : "#F0FDF4",
                              border: "1px solid #86EFAC",
                              color: "#065F46",
                              padding: "4px 8px",
                              borderRadius: 5,
                              fontSize: "0.7rem",
                              fontWeight: 700,
                              cursor: "pointer",
                              flexShrink: 0,
                            }}
                          >
                            {state === "done"
                              ? "✅ Added"
                              : state === "fail"
                                ? "⚠"
                                : "+ Calendar"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

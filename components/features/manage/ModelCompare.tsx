"use client";

// Native React port of the legacy `model-compare` panel (was
// `window.buildModelCompare` in public/js/ig_intelligence_tools.js +
// `#view-model-compare`). Loads available models, runs a prompt across the
// selected ones, and shows side-by-side outputs plus the AI-judge verdict —
// against the existing Express API (`GET /api/model-compare/models`,
// `POST /api/model-compare/run`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Model {
  id: string;
  label: string;
  provider: string;
  available: boolean;
}
interface RunResult {
  label: string;
  provider: string;
  output?: string;
  error?: string;
  latency_ms?: number;
  tokens?: number;
}
interface JudgeScore {
  model: string;
  quality: number;
  creativity: number;
  accuracy: number;
  conciseness: number;
  overall: number;
}
interface Judgment {
  winner?: string;
  rationale?: string;
  scores?: JudgeScore[];
}

const TASK_TYPES = [
  "general",
  "marketing copy",
  "technical explanation",
  "creative writing",
  "analysis",
  "customer email",
];

function Badge({ text, tone }: { text: string; tone: "green" | "gray" | "red" }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    green: { bg: "#DCFCE7", fg: "#166534" },
    gray: { bg: "#F3F4F6", fg: "#6B7280" },
    red: { bg: "#FEE2E2", fg: "#991B1B" },
  };
  const c = colors[tone];
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div style={{ padding: 24, textAlign: "center", color: "#6B7280", fontSize: 13 }}>
      ⏳ {label}
    </div>
  );
}

export default function ModelCompare() {
  const [models, setModels] = useState<Model[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [taskType, setTaskType] = useState(TASK_TYPES[0]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [judgment, setJudgment] = useState<Judgment | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await apiGet<{ ok: boolean; models?: Model[] }>("/api/model-compare/models");
      if (cancelled) return;
      if (!d.ok || !d.models) {
        setLoadFailed(true);
        return;
      }
      const available = d.models.filter((m) => m.available);
      const defaults = new Set(available.slice(0, 3).map((m) => m.id));
      setModels(d.models);
      setSelected(defaults);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run() {
    const sel = [...selected];
    if (!sel.length) {
      alert("Please select at least one model");
      return;
    }
    const p = prompt.trim();
    if (!p) {
      alert("Please enter a prompt");
      return;
    }
    setRunning(true);
    setResults(null);
    setJudgment(null);
    setRunError(null);
    const d = await apiPost<{
      ok: boolean;
      error?: string;
      results?: RunResult[];
      judgment?: Judgment;
    }>("/api/model-compare/run", {
      prompt: p,
      system_prompt: systemPrompt.trim(),
      task_type: taskType,
      models: sel,
      max_tokens: 600,
    });
    setRunning(false);
    if (!d.ok) {
      setRunError(d.error || "Failed");
      return;
    }
    setResults(d.results || []);
    setJudgment(d.judgment || null);
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Model Comparison
              </div>
              <h2 className="view-title">⚖️ AI Model Comparison</h2>
              <p className="view-sub">
                Run any prompt on GPT-4o, Claude 3.5 Sonnet, and Gemini 1.5 Flash
                simultaneously. Compare outputs side-by-side with latency, token count,
                and an AI quality judge that picks the winner.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {!models ? (
          loadFailed ? (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 10,
                padding: 16,
              }}
            >
              <p style={{ color: "#DC2626" }}>Failed to load models</p>
            </div>
          ) : (
            <Spinner label="Loading available models…" />
          )
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 20,
                marginBottom: 20,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 8,
                  }}
                >
                  Select Models to Compare
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {models.map((m) => (
                    <label
                      key={m.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        border: `1px solid ${m.available ? "#E5E7EB" : "#F3F4F6"}`,
                        borderRadius: 8,
                        cursor: m.available ? "pointer" : "default",
                        background: m.available ? "#fff" : "#F9FAFB",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        disabled={!m.available}
                        onChange={() => toggle(m.id)}
                        style={{ width: 15, height: 15 }}
                      />
                      <span style={{ flex: 1 }}>
                        <span
                          style={{
                            display: "block",
                            fontSize: 13,
                            fontWeight: 600,
                            color: m.available ? "#111827" : "#9CA3AF",
                          }}
                        >
                          {m.label}
                        </span>
                        <span style={{ fontSize: 11, color: "#9CA3AF" }}>{m.provider}</span>
                      </span>
                      <Badge
                        text={m.available ? "Available" : "Not configured"}
                        tone={m.available ? "green" : "gray"}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ marginBottom: 12 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#374151",
                      marginBottom: 6,
                    }}
                  >
                    Task Type
                  </label>
                  <select
                    value={taskType}
                    onChange={(e) => setTaskType(e.target.value)}
                    style={{
                      width: "100%",
                      padding: 9,
                      border: "1px solid #D1D5DB",
                      borderRadius: 7,
                      fontSize: 13,
                    }}
                  >
                    {TASK_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#374151",
                      marginBottom: 6,
                    }}
                  >
                    System Prompt (optional)
                  </label>
                  <textarea
                    rows={2}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="You are a helpful marketing expert."
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      border: "1px solid #D1D5DB",
                      borderRadius: 7,
                      fontSize: 13,
                      boxSizing: "border-box",
                      resize: "vertical",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#374151",
                      marginBottom: 6,
                    }}
                  >
                    Prompt
                  </label>
                  <textarea
                    rows={5}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Write a cold email subject line for a B2B SaaS product targeting CMOs…"
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      border: "1px solid #D1D5DB",
                      borderRadius: 7,
                      fontSize: 13,
                      boxSizing: "border-box",
                      resize: "vertical",
                    }}
                  />
                </div>
                <button
                  onClick={run}
                  style={{
                    marginTop: 12,
                    width: "100%",
                    padding: 11,
                    background: "#6366F1",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  ⚖️ Compare Models
                </button>
              </div>
            </div>
            <div id="mcResult">
              {running && (
                <Spinner
                  label={`Running prompt on ${selected.size} model${selected.size > 1 ? "s" : ""}…`}
                />
              )}
              {runError && (
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 10,
                    padding: 16,
                  }}
                >
                  <p style={{ color: "#DC2626", margin: 0 }}>{runError}</p>
                </div>
              )}
              {results && (
                <>
                  {judgment && (
                    <div
                      style={{
                        background: "#EDE9FE",
                        borderRadius: 10,
                        padding: 16,
                        marginBottom: 20,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "#5B21B6",
                          marginBottom: 8,
                        }}
                      >
                        🏆 AI Judge: {judgment.winner || ""} wins
                      </div>
                      <div style={{ fontSize: 13, color: "#374151", marginBottom: 12 }}>
                        {judgment.rationale || ""}
                      </div>
                      {judgment.scores && (
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {judgment.scores.map((s, i) => (
                            <div
                              key={i}
                              style={{
                                background: "#fff",
                                borderRadius: 8,
                                padding: "8px 14px",
                                minWidth: 120,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: "#111827",
                                  marginBottom: 4,
                                }}
                              >
                                {s.model}
                              </div>
                              {(["quality", "creativity", "accuracy", "conciseness"] as const).map(
                                (k) => (
                                  <div
                                    key={k}
                                    style={{
                                      fontSize: 11,
                                      color: "#6B7280",
                                      display: "flex",
                                      justifyContent: "space-between",
                                    }}
                                  >
                                    <span>{k}</span>
                                    <strong>{s[k]}/10</strong>
                                  </div>
                                ),
                              )}
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: "#5B21B6",
                                  marginTop: 4,
                                  borderTop: "1px solid #E5E7EB",
                                  paddingTop: 4,
                                }}
                              >
                                Overall: {s.overall}/10
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {results.map((r, i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          minWidth: 260,
                          border: "1px solid #E5E7EB",
                          borderRadius: 10,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            padding: "12px 14px",
                            background: "#F9FAFB",
                            borderBottom: "1px solid #E5E7EB",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
                              {r.label}
                            </div>
                            <div style={{ fontSize: 11, color: "#9CA3AF" }}>{r.provider}</div>
                          </div>
                          {r.error ? (
                            <Badge
                              text={
                                r.error === "unavailable_or_not_configured"
                                  ? "Not configured"
                                  : "Error"
                              }
                              tone="red"
                            />
                          ) : (
                            <Badge text={`${r.latency_ms}ms · ${r.tokens} tok`} tone="green" />
                          )}
                        </div>
                        <div
                          style={{
                            padding: 14,
                            fontSize: 13,
                            color: "#374151",
                            lineHeight: 1.6,
                            minHeight: 120,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {r.output ? (
                            r.output
                          ) : (
                            <span style={{ color: "#9CA3AF", fontStyle: "italic" }}>
                              No output — check API key configuration.
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

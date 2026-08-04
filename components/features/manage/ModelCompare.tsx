"use client";

// Model Comparison — run a prompt across platform + BYO AI Providers models.
// API: GET /api/model-compare/models, POST /api/model-compare/run

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Model {
  id: string;
  label: string;
  provider: string;
  available: boolean;
  color?: string;
  source?: string;
  hint?: string;
  model?: string;
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

const IG = {
  ink: "#0b1220",
  muted: "#5b6577",
  border: "rgba(11, 18, 32, 0.1)",
  surface: "#ffffff",
  panel2: "#f8fafc",
  teal: "#0f766e",
  soft: "rgba(15, 118, 110, 0.12)",
  grad: "linear-gradient(135deg, #0f766e 0%, #0284c7 100%)",
  radius: 12,
  radiusSm: 8,
  shadow: "0 1px 0 rgba(11, 18, 32, 0.04), 0 12px 32px rgba(11, 18, 32, 0.06)",
};

const suggestBtnStyle: CSSProperties = {
  border: "1px solid rgba(15, 118, 110, 0.25)",
  background: IG.soft,
  color: IG.teal,
  borderRadius: 8,
  padding: "3px 9px",
  fontSize: "0.68rem",
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  lineHeight: 1.3,
  whiteSpace: "nowrap",
};

interface AnalysisData {
  brandName?: string;
  brand?: string;
  companyName?: string;
  url?: string;
  domain?: string;
  industry?: string | { name?: string };
  competitors?: (string | { name?: string; brand?: string; domain?: string })[];
}

function readAnalysis(): AnalysisData {
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

function analysisBrand(): string {
  const a = readAnalysis();
  const direct = a.brandName || a.brand || a.companyName;
  if (direct) return String(direct).trim();
  const dom = String(a.url || a.domain || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split(".")[0]
    .trim();
  if (!dom) return "";
  return dom.charAt(0).toUpperCase() + dom.slice(1);
}

function analysisIndustry(): string {
  const a = readAnalysis();
  if (!a.industry) return "";
  return typeof a.industry === "string" ? a.industry : a.industry.name || "";
}

function analysisCompetitors(): string[] {
  const a = readAnalysis();
  return (a.competitors || [])
    .map((c) =>
      typeof c === "string"
        ? c
        : String(c?.name || c?.brand || c?.domain || "").trim(),
    )
    .filter(Boolean)
    .slice(0, 6);
}

type SuggestField = "system" | "prompt";

function FieldLabel({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 6,
        minHeight: 22,
      }}
    >
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 700,
          color: IG.muted,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          margin: 0,
        }}
      >
        {children}
      </label>
      {action}
    </div>
  );
}

function Badge({
  text,
  tone,
}: {
  text: string;
  tone: "green" | "gray" | "red" | "teal";
}) {
  const colors: Record<string, { bg: string; fg: string }> = {
    green: { bg: "#DCFCE7", fg: "#166534" },
    gray: { bg: "#F3F4F6", fg: "#6B7280" },
    red: { bg: "#FEE2E2", fg: "#991B1B" },
    teal: { bg: IG.soft, fg: IG.teal },
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
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

export default function ModelCompare() {
  const router = useRouter();
  const [models, setModels] = useState<Model[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [taskType, setTaskType] = useState("marketing copy");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful marketing expert.",
  );
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [judgment, setJudgment] = useState<Judgment | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState<SuggestField | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Pause legacy field enhancer for the whole lifetime of this panel —
    // resuming mid-mount was still triggering MAIN-THREAD STALL reports once
    // the breadcrumb flipped back to idle.
    try {
      const w = window as unknown as {
        IGFields?: { pause?: () => void };
        IGDiag?: { setBreadcrumb?: (s: string) => void };
      };
      w.IGFields?.pause?.();
      document.documentElement.setAttribute("data-ig-nav", "1");
      w.IGDiag?.setBreadcrumb?.("panel:model-compare");
    } catch {
      /* optional */
    }

    (async () => {
      const d = await apiGet<{
        ok: boolean;
        models?: Model[];
        available_count?: number;
      }>("/api/model-compare/models");
      if (cancelled) return;
      if (!d.ok || !d.models) {
        setLoadFailed(true);
        return;
      }
      const available = d.models.filter((m) => m.available);
      // Prefer BYO providers first (usually what the user just configured),
      // then fill with platform models up to 3 defaults.
      const byo = available.filter((m) => m.source === "ai-providers" || m.provider === "byo");
      const platform = available.filter((m) => m.provider !== "byo");
      const defaults = [...byo, ...platform].slice(0, 3).map((m) => m.id);
      setModels(d.models);
      setSelected(new Set(defaults));
      try {
        document.documentElement.removeAttribute("data-ig-nav");
        const w = window as unknown as { IGDiag?: { setBreadcrumb?: (s: string) => void } };
        // Keep panel: breadcrumb so IGDiag watchdog ignores expected paint cost.
        w.IGDiag?.setBreadcrumb?.("panel:model-compare");
      } catch {
        /* optional */
      }
    })();

    return () => {
      cancelled = true;
      try {
        const w = window as unknown as {
          IGFields?: { resume?: (o?: { scan?: boolean }) => void };
          IGDiag?: { setBreadcrumb?: (s: string) => void };
        };
        document.documentElement.removeAttribute("data-ig-nav");
        w.IGDiag?.setBreadcrumb?.("idle");
        w.IGFields?.resume?.({ scan: false });
      } catch {
        /* optional */
      }
    };
  }, []);

  const availableCount = useMemo(
    () => (models || []).filter((m) => m.available).length,
    [models],
  );

  function toggle(id: string, available: boolean) {
    if (!available) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= 5) {
          alert("Compare up to 5 models at a time.");
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  }

  async function suggestField(field: SuggestField) {
    setSuggesting(field);
    setSuggestError(null);
    const brand = analysisBrand();
    const industry = analysisIndustry();
    const competitors = analysisCompetitors();
    const prompts: Record<
      SuggestField,
      { label: string; field: string }
    > = {
      system: {
        label: "System prompt",
        field: `Write a concise system prompt (1–3 sentences) for an AI doing "${taskType}" work for this brand. Set tone, expertise, and constraints. Reply with the system prompt only — no quotes or preamble.`,
      },
      prompt: {
        label: "User prompt",
        field: `Write one high-quality user prompt for a "${taskType}" model comparison. Make it specific to the brand/industry and useful for A/B comparing models. Reply with the prompt only — no quotes or preamble.`,
      },
    };
    const meta = prompts[field];
    try {
      const r = await apiPost<{ ok?: boolean; value?: string; error?: string }>(
        "/api/studio/ai-suggest",
        {
          field: meta.field,
          fieldLabel: meta.label,
          brand,
          industry,
          competitors,
          currentValue: field === "system" ? systemPrompt : prompt,
          context: [
            `Task type: ${taskType}`,
            systemPrompt ? `Current system prompt: ${systemPrompt}` : "",
            prompt ? `Current user prompt: ${prompt}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        },
      );
      const v = String(r?.value || "").trim();
      if (!v) throw new Error(r?.error || "Empty suggestion");
      if (field === "system") setSystemPrompt(v);
      else setPrompt(v);
    } catch (e) {
      setSuggestError(
        "AI Suggest failed: " +
          (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setSuggesting(null);
    }
  }

  async function run() {
    const sel = [...selected];
    if (!sel.length) {
      alert("Select at least one available model");
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

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: `1.5px solid ${IG.border}`,
    borderRadius: IG.radiusSm,
    fontSize: 13,
    boxSizing: "border-box",
    fontFamily: "inherit",
    color: IG.ink,
    background: IG.surface,
  };

  return (
    <div className="view-header-wrap" data-ig-no-enhance data-ig-skip>
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Model Comparison
              </div>
              <h2 className="view-title">Model Comparison</h2>
              <p className="view-sub">
                Run the same prompt across your configured providers and
                platform models — side-by-side latency, tokens, and an AI judge.
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
                background: IG.surface,
                border: `1px solid ${IG.border}`,
                borderRadius: IG.radius,
                padding: 16,
                color: "#DC2626",
              }}
            >
              Failed to load models
            </div>
          ) : (
            <div style={{ padding: 24, textAlign: "center", color: IG.muted }}>
              Loading available models…
            </div>
          )
        ) : (
          <>
            {availableCount === 0 ? (
              <div
                style={{
                  background: `linear-gradient(160deg, ${IG.surface} 0%, #f3f6fb 100%)`,
                  border: `1px solid ${IG.border}`,
                  borderRadius: IG.radius,
                  padding: "28px 24px",
                  marginBottom: 18,
                  boxShadow: IG.shadow,
                }}
              >
                <h3
                  style={{
                    margin: "0 0 8px",
                    fontSize: "1.05rem",
                    fontWeight: 800,
                    color: IG.ink,
                  }}
                >
                  No models are ready yet
                </h3>
                <p
                  style={{
                    margin: "0 0 14px",
                    color: IG.muted,
                    fontSize: "0.9rem",
                    maxWidth: 520,
                    lineHeight: 1.45,
                  }}
                >
                  Add an API key in AI Providers (Kimi, Ollama, Groq, …) or
                  Settings so models become selectable here.
                </p>
                <button
                  type="button"
                  onClick={() => goToView(router, "ai-providers")}
                  style={{
                    border: "none",
                    borderRadius: IG.radiusSm,
                    padding: "10px 16px",
                    background: IG.grad,
                    color: "#fff",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Open AI Providers
                </button>
              </div>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 0.85fr)",
                gap: 20,
                marginBottom: 20,
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: IG.ink,
                    }}
                  >
                    Select models to compare
                  </div>
                  <div style={{ fontSize: 12, color: IG.muted }}>
                    {availableCount} ready · {selected.size} selected (max 5)
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                  }}
                >
                  {models.map((m) => {
                    const on = selected.has(m.id);
                    const can = m.available;
                    return (
                      <label
                        key={m.id}
                        onClick={(e) => {
                          e.preventDefault();
                          toggle(m.id, can);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 12px",
                          border: `1.5px solid ${
                            on
                              ? "rgba(15,118,110,0.45)"
                              : can
                                ? IG.border
                                : "rgba(11,18,32,0.06)"
                          }`,
                          borderRadius: IG.radiusSm,
                          cursor: can ? "pointer" : "not-allowed",
                          background: on
                            ? IG.soft
                            : can
                              ? IG.surface
                              : IG.panel2,
                          boxShadow: on ? IG.shadow : "none",
                          opacity: can ? 1 : 0.72,
                          userSelect: "none",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!can}
                          readOnly
                          tabIndex={-1}
                          style={{
                            width: 15,
                            height: 15,
                            accentColor: IG.teal,
                            pointerEvents: "none",
                          }}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span
                            style={{
                              display: "block",
                              fontSize: 13,
                              fontWeight: 700,
                              color: can ? IG.ink : "#9CA3AF",
                            }}
                          >
                            {m.label}
                          </span>
                          <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                            {m.provider === "byo"
                              ? m.hint || "AI Provider"
                              : m.provider}
                          </span>
                        </span>
                        <Badge
                          text={
                            can
                              ? m.provider === "byo"
                                ? "Your provider"
                                : "Ready"
                              : "Not configured"
                          }
                          tone={can ? (m.provider === "byo" ? "teal" : "green") : "gray"}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <div data-ig-no-enhance data-ig-skip>
                <div style={{ marginBottom: 12 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 700,
                      color: IG.muted,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    Task type
                  </label>
                  <select
                    value={taskType}
                    onChange={(e) => setTaskType(e.target.value)}
                    style={inputStyle}
                  >
                    {TASK_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <FieldLabel
                    action={
                      <button
                        type="button"
                        style={{
                          ...suggestBtnStyle,
                          opacity: suggesting === "system" ? 0.65 : 1,
                          cursor:
                            suggesting === "system" ? "wait" : "pointer",
                        }}
                        disabled={suggesting === "system"}
                        onClick={() => suggestField("system")}
                      >
                        {suggesting === "system" ? "…" : "✨ AI Suggest"}
                      </button>
                    }
                  >
                    System prompt
                  </FieldLabel>
                  <textarea
                    rows={2}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="You are a helpful marketing expert."
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>
                <div>
                  <FieldLabel
                    action={
                      <button
                        type="button"
                        style={{
                          ...suggestBtnStyle,
                          opacity: suggesting === "prompt" ? 0.65 : 1,
                          cursor:
                            suggesting === "prompt" ? "wait" : "pointer",
                        }}
                        disabled={suggesting === "prompt"}
                        onClick={() => suggestField("prompt")}
                      >
                        {suggesting === "prompt" ? "…" : "✨ AI Suggest"}
                      </button>
                    }
                  >
                    Prompt
                  </FieldLabel>
                  <textarea
                    rows={5}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Write a cold email subject line for a B2B SaaS product targeting CMOs…"
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>
                {suggestError && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "8px 10px",
                      borderRadius: IG.radiusSm,
                      fontSize: 12,
                      color: "#991b1b",
                      background: "rgba(220,38,38,0.08)",
                      border: "1px solid rgba(220,38,38,0.25)",
                    }}
                  >
                    {suggestError}
                  </div>
                )}
                <button
                  type="button"
                  onClick={run}
                  disabled={running || selected.size === 0}
                  style={{
                    marginTop: 12,
                    width: "100%",
                    padding: 12,
                    background: IG.grad,
                    color: "#fff",
                    border: "none",
                    borderRadius: IG.radiusSm,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor:
                      running || selected.size === 0 ? "not-allowed" : "pointer",
                    opacity: running || selected.size === 0 ? 0.65 : 1,
                    fontFamily: "inherit",
                    boxShadow: "0 8px 20px rgba(15, 118, 110, 0.22)",
                  }}
                >
                  {running
                    ? `Running on ${selected.size} model${selected.size === 1 ? "" : "s"}…`
                    : "Compare models"}
                </button>
              </div>
            </div>

            <div id="mcResult">
              {runError && (
                <div
                  style={{
                    background: IG.surface,
                    border: "1px solid rgba(220,38,38,0.25)",
                    borderRadius: IG.radius,
                    padding: 16,
                    color: "#991b1b",
                  }}
                >
                  {runError}
                </div>
              )}
              {results && (
                <>
                  {judgment && (
                    <div
                      style={{
                        background: IG.soft,
                        border: "1px solid rgba(15,118,110,0.25)",
                        borderRadius: IG.radius,
                        padding: 16,
                        marginBottom: 20,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 800,
                          color: IG.teal,
                          marginBottom: 8,
                        }}
                      >
                        AI Judge: {judgment.winner || ""} wins
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: IG.ink,
                          marginBottom: 12,
                          lineHeight: 1.45,
                        }}
                      >
                        {judgment.rationale || ""}
                      </div>
                      {judgment.scores && (
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {judgment.scores.map((s, i) => (
                            <div
                              key={i}
                              style={{
                                background: IG.surface,
                                borderRadius: IG.radiusSm,
                                padding: "8px 14px",
                                minWidth: 120,
                                border: `1px solid ${IG.border}`,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: IG.ink,
                                  marginBottom: 4,
                                }}
                              >
                                {s.model}
                              </div>
                              {(
                                [
                                  "quality",
                                  "creativity",
                                  "accuracy",
                                  "conciseness",
                                ] as const
                              ).map((k) => (
                                <div
                                  key={k}
                                  style={{
                                    fontSize: 11,
                                    color: IG.muted,
                                    display: "flex",
                                    justifyContent: "space-between",
                                  }}
                                >
                                  <span>{k}</span>
                                  <strong>{s[k]}/10</strong>
                                </div>
                              ))}
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 800,
                                  color: IG.teal,
                                  marginTop: 4,
                                  borderTop: `1px solid ${IG.border}`,
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
                          border: `1px solid ${IG.border}`,
                          borderRadius: IG.radius,
                          overflow: "hidden",
                          background: IG.surface,
                          boxShadow: IG.shadow,
                        }}
                      >
                        <div
                          style={{
                            padding: "12px 14px",
                            background: IG.panel2,
                            borderBottom: `1px solid ${IG.border}`,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: 700,
                                color: IG.ink,
                              }}
                            >
                              {r.label}
                            </div>
                            <div style={{ fontSize: 11, color: "#9CA3AF" }}>
                              {r.provider}
                            </div>
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
                            <Badge
                              text={`${r.latency_ms}ms · ${r.tokens} tok`}
                              tone="green"
                            />
                          )}
                        </div>
                        <div
                          style={{
                            padding: 14,
                            fontSize: 13,
                            color: IG.ink,
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

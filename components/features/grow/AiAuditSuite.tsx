"use client";

// Native React port of the legacy `ai-audit-suite` panel (was
// `buildAiAuditSuite()` + `#view-ai-audit-suite` in index.html, with the
// run-handlers `generateAiVisibilityAudit()` / `runSingleAiVis()` in app.js).
// Runs each deep-dive AI-visibility audit module against the SAME Express
// endpoints and renders the real per-module results. Pre-fills domain /
// industry / competitors from the legacy `window.analysisData` global.
//
// Endpoints (all same-origin, `{ ok, ... }` contract):
//   POST /api/ai-visibility-audit        { domain, industry }  → audit (string)
//   POST /api/ai-visibility-coverage     { domain, industry }
//   GET  /api/ai-visibility-trend?domain=
//   POST /api/ai-visibility-accuracy     { domain, industry }
//   POST /api/ai-visibility-competitors  { domain, industry, competitors }
//   POST /api/ai-visibility-entity       { domain, industry }
//   POST /api/ai-visibility-sentiment    { domain, industry }
//   POST /api/ai-visibility-sge          { domain, industry }
//   POST /api/ai-visibility-attribution  { domain }
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

// ── API response shapes ────────────────────────────────────────────────────
interface CoverageCell {
  cited?: boolean;
  error?: string;
  modelName?: string;
  snippet?: string;
}
interface CoverageRow {
  cat?: string;
  prompt: string;
  results: CoverageCell[];
}
interface CoverageResult {
  ok: boolean;
  error?: string;
  matrix?: CoverageRow[];
  overallCoverage?: number;
  modelKeys?: string[];
  coverageByModel?: Record<string, number>;
  summary?: {
    promptsRun?: number;
    modelsRun?: number;
    totalCitations?: number;
    totalCells?: number;
  };
}

interface TrendPoint {
  value: number;
}
interface TrendDelta {
  current?: number;
  change?: number | null;
}
interface TrendResult {
  ok: boolean;
  error?: string;
  runs?: number;
  domain?: string;
  deltas?: Record<string, TrendDelta>;
  series?: Record<string, TrendPoint[]>;
}

interface AccuracyModel {
  name: string;
  accuracy: number;
  summary?: string;
  error?: string;
  confirmedFacts?: string[];
  hallucinations?: string[];
  unverifiable?: string[];
}
interface AccuracyResult {
  ok: boolean;
  error?: string;
  models?: AccuracyModel[];
  overallAccuracy?: number;
  sourceFetched?: boolean;
  sourceLength?: number;
  totalHallucinations?: number;
}

interface RivalWinner {
  domain: string;
  hits: number;
}
interface RivalAlert {
  cat: string;
  prompt: string;
  winners: RivalWinner[];
}
interface CompetitorsResult {
  ok: boolean;
  error?: string;
  note?: string;
  matrix?: unknown[];
  brand?: string;
  shareOfVoicePct?: Record<string, number>;
  rivalAlerts?: RivalAlert[];
  summary?: {
    promptsRun?: number;
    modelsRun?: number;
    domainsRun?: number;
    rivalAlertCount?: number;
  };
}

interface EntityConsolidated {
  category?: string;
  positioning?: string;
  attributes?: string[];
  competitors?: string[];
  customers?: string[];
  founded?: string;
  headquarters?: string;
}
interface EntityInconsistency {
  field?: string;
  issue?: string;
}
interface EntityResult {
  ok: boolean;
  error?: string;
  consolidated?: EntityConsolidated;
  agreementScore?: number;
  domain?: string;
  inconsistencies?: EntityInconsistency[];
  summary?: {
    modelsValid?: number;
    modelsRun?: number;
    inconsistencyCount?: number;
  };
}

interface SentimentModel {
  modelName: string;
  sentiment: string;
  score: number;
  text?: string;
  error?: string;
  narrativeGap?: string;
}
interface SentimentResult {
  ok: boolean;
  error?: string;
  perModel?: SentimentModel[];
  distribution?: {
    positive?: number;
    neutral?: number;
    negative?: number;
    mixed?: number;
  };
  avgScore?: number;
  summary?: { narrativeGapCount?: number };
}

interface SgeQuery {
  query: string;
  error?: string;
  aiOverviewPresent?: boolean;
  aiOverviewCitesYou?: boolean;
  aiOverviewSourceCount?: number;
  organicPosition?: number;
}
interface SgeResult {
  ok: boolean;
  error?: string;
  configured?: boolean;
  note?: string;
  queries?: SgeQuery[];
  summary?: {
    sgePresenceRate?: number;
    sgeCitationRate?: number;
    queriesRun?: number;
  };
}

interface AttributionSource {
  label: string;
}
interface AttributionSession {
  label: string;
  sessions?: number;
}
interface AttributionResult {
  ok: boolean;
  error?: string;
  connected?: boolean;
  note?: string;
  missing?: string;
  windowDays?: number;
  aiSources?: AttributionSource[];
  sessions?: AttributionSession[];
  totalAiSessions?: number;
  totalSessions?: number;
  aiShare?: number;
}

interface AuditResult {
  ok: boolean;
  error?: string;
  audit?: string;
}

// ── window.analysisData (legacy SPA global) ─────────────────────────────────
interface AnalysisCompetitor {
  domain?: string;
  url?: string;
  name?: string;
  title?: string;
  aliases?: string[];
}
interface AnalysisData {
  url?: string;
  industry?: { name?: string };
  competitors?: AnalysisCompetitor[];
}
function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

type ModuleKind =
  | "coverage"
  | "accuracy"
  | "competitors"
  | "entity"
  | "sentiment"
  | "sge"
  | "attribution";

const MODEL_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
  deepseek: "DeepSeek",
};

// ── helpers ─────────────────────────────────────────────────────────────────
function pctColor(p: number): string {
  return p >= 60 ? "#10B981" : p >= 30 ? "#F59E0B" : "#DC2626";
}

function Arrow({ n }: { n: number | null | undefined }) {
  if (n == null) return <span style={{ color: "#9CA3AF" }}>—</span>;
  if (n > 0)
    return <span style={{ color: "#10B981", fontWeight: 800 }}>▲ +{n}</span>;
  if (n < 0)
    return <span style={{ color: "#DC2626", fontWeight: 800 }}>▼ {n}</span>;
  return <span style={{ color: "#9CA3AF" }}>±0</span>;
}

function Sparkline({
  pts,
  w = 200,
  h = 28,
  color = "#2563EB",
}: {
  pts?: TrendPoint[];
  w?: number;
  h?: number;
  color?: string;
}) {
  if (!pts || pts.length < 2) return null;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 100);
  const range = max - min || 1;
  const stepX = w / (pts.length - 1);
  const d = pts
    .map(
      (p, i) =>
        `${i ? "L" : "M"} ${(i * stepX).toFixed(1)} ${(
          h -
          ((p.value - min) / range) * h
        ).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const card: React.CSSProperties = {
  background: "white",
  border: "1px solid #E5E7EB",
  borderRadius: 16,
  padding: "22px 24px",
  marginBottom: 20,
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
};
const emptyCard: React.CSSProperties = {
  background: "#F8FAFC",
  border: "1.5px dashed #CBD5E1",
  borderRadius: 14,
  padding: 18,
  marginBottom: 20,
  display: "flex",
  gap: 14,
  alignItems: "center",
};
const moduleBtn: React.CSSProperties = {
  padding: "9px 18px",
  background: "linear-gradient(135deg,#7C3AED,#4338CA)",
  border: "none",
  borderRadius: 9,
  fontSize: "0.76rem",
  fontWeight: 700,
  color: "white",
  cursor: "pointer",
};

function EmptyModule({
  emoji,
  title,
  desc,
  btnLabel,
  onRun,
  running,
}: {
  emoji: string;
  title: string;
  desc: string;
  btnLabel: string;
  onRun: () => void;
  running: boolean;
}) {
  return (
    <div style={emptyCard}>
      <div style={{ fontSize: "1.6rem", opacity: 0.6 }}>{emoji}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0A1628" }}>
          {title}
        </div>
        <div style={{ fontSize: "0.7rem", color: "#64748B", marginTop: 2 }}>
          {desc}
        </div>
      </div>
      <button
        onClick={onRun}
        disabled={running}
        style={{ ...moduleBtn, opacity: running ? 0.7 : 1 }}
      >
        {running ? "⏳ Running…" : btnLabel}
      </button>
    </div>
  );
}

export default function AiAuditSuite() {
  const [audit, setAudit] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [trend, setTrend] = useState<TrendResult | null>(null);
  const [accuracy, setAccuracy] = useState<AccuracyResult | null>(null);
  const [competitors, setCompetitors] = useState<CompetitorsResult | null>(null);
  const [entity, setEntity] = useState<EntityResult | null>(null);
  const [sentiment, setSentiment] = useState<SentimentResult | null>(null);
  const [sge, setSge] = useState<SgeResult | null>(null);
  const [attribution, setAttribution] = useState<AttributionResult | null>(null);

  const [fullRunning, setFullRunning] = useState(false);
  const [running, setRunning] = useState<Record<ModuleKind, boolean>>({
    coverage: false,
    accuracy: false,
    competitors: false,
    entity: false,
    sentiment: false,
    sge: false,
    attribution: false,
  });
  const [toast, setToast] = useState<{ color: string; text: string } | null>(
    null,
  );

  const { domain, industry, competitorList } = useMemo(() => {
    const ad = getAnalysisData();
    const dom =
      ad.url?.replace(/https?:\/\//, "").split("/")[0] || "yourdomain.com";
    const ind = ad.industry?.name || "digital marketing";
    const list = (ad.competitors || [])
      .map((c) => ({
        domain: c.url || c.domain || c.name,
        name: c.name || c.title,
        aliases: c.aliases || [],
      }))
      .filter((c) => c.domain);
    return { domain: dom, industry: ind, competitorList: list };
  }, []);

  function setRun(kind: ModuleKind, v: boolean) {
    setRunning((prev) => ({ ...prev, [kind]: v }));
  }

  async function runSingle(kind: ModuleKind) {
    const map: Record<
      ModuleKind,
      { url: string; body: unknown; label: string }
    > = {
      coverage: {
        url: "/api/ai-visibility-coverage",
        body: { domain, industry },
        label: "Prompt Coverage",
      },
      accuracy: {
        url: "/api/ai-visibility-accuracy",
        body: { domain, industry },
        label: "Answer Accuracy",
      },
      competitors: {
        url: "/api/ai-visibility-competitors",
        body: { domain, industry, competitors: competitorList },
        label: "Competitive Citation",
      },
      entity: {
        url: "/api/ai-visibility-entity",
        body: { domain, industry },
        label: "Entity Mapping",
      },
      sentiment: {
        url: "/api/ai-visibility-sentiment",
        body: { domain, industry },
        label: "Sentiment",
      },
      sge: {
        url: "/api/ai-visibility-sge",
        body: { domain, industry },
        label: "Google AI Overview",
      },
      attribution: {
        url: "/api/ai-visibility-attribution",
        body: { domain },
        label: "AI Attribution",
      },
    };
    const m = map[kind];
    setRun(kind, true);
    setToast(null);
    const d = await apiPost(m.url, m.body);
    if (d.ok) {
      applyModule(kind, d);
      if (kind === "coverage") {
        const t = await apiGet<TrendResult>(
          `/api/ai-visibility-trend?domain=${encodeURIComponent(domain)}`,
        );
        if (t.ok) setTrend(t);
      }
      setToast({ color: "#15803D", text: `✅ ${m.label} ready` });
    } else {
      setToast({
        color: "#B91C1C",
        text: `⚠️ ${m.label} failed${d.error ? ": " + d.error : ""}`,
      });
    }
    setRun(kind, false);
  }

  function applyModule(kind: ModuleKind, d: object) {
    switch (kind) {
      case "coverage":
        setCoverage(d as CoverageResult);
        break;
      case "accuracy":
        setAccuracy(d as AccuracyResult);
        break;
      case "competitors":
        setCompetitors(d as CompetitorsResult);
        break;
      case "entity":
        setEntity(d as EntityResult);
        break;
      case "sentiment":
        setSentiment(d as SentimentResult);
        break;
      case "sge":
        setSge(d as SgeResult);
        break;
      case "attribution":
        setAttribution(d as AttributionResult);
        break;
    }
  }

  async function runFull() {
    if (fullRunning) return;
    setFullRunning(true);
    setToast(null);
    const [
      coverageRes,
      accuracyRes,
      competitorsRes,
      entityRes,
      sentimentRes,
      sgeRes,
      attributionRes,
      auditRes,
    ] = await Promise.all([
      apiPost<CoverageResult>("/api/ai-visibility-coverage", {
        domain,
        industry,
      }),
      apiPost<AccuracyResult>("/api/ai-visibility-accuracy", {
        domain,
        industry,
      }),
      apiPost<CompetitorsResult>("/api/ai-visibility-competitors", {
        domain,
        industry,
        competitors: competitorList,
      }),
      apiPost<EntityResult>("/api/ai-visibility-entity", { domain, industry }),
      apiPost<SentimentResult>("/api/ai-visibility-sentiment", {
        domain,
        industry,
      }),
      apiPost<SgeResult>("/api/ai-visibility-sge", { domain, industry }),
      apiPost<AttributionResult>("/api/ai-visibility-attribution", { domain }),
      apiPost<AuditResult>("/api/ai-visibility-audit", { domain, industry }),
    ]);
    const trendRes = await apiGet<TrendResult>(
      `/api/ai-visibility-trend?domain=${encodeURIComponent(domain)}`,
    );

    if (coverageRes.ok) setCoverage(coverageRes);
    if (accuracyRes.ok) setAccuracy(accuracyRes);
    if (competitorsRes.ok) setCompetitors(competitorsRes);
    if (entityRes.ok) setEntity(entityRes);
    if (sentimentRes.ok) setSentiment(sentimentRes);
    if (sgeRes.ok) setSge(sgeRes);
    if (attributionRes.ok) setAttribution(attributionRes);
    if (trendRes.ok) setTrend(trendRes);

    if (auditRes.ok && auditRes.audit) {
      setAudit(auditRes.audit);
      const cov =
        coverageRes.ok && coverageRes.overallCoverage != null
          ? Math.round(coverageRes.overallCoverage * 100)
          : null;
      const acc =
        accuracyRes.ok && accuracyRes.overallAccuracy != null
          ? accuracyRes.overallAccuracy
          : null;
      const extra = [
        cov != null ? `coverage ${cov}%` : "",
        acc != null ? `accuracy ${acc}%` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      setToast({
        color: "#15803D",
        text: `✅ AI Visibility Audit complete${extra ? " — " + extra : ""}`,
      });
    } else {
      setToast({
        color: "#B91C1C",
        text: `⚠️ AI Visibility audit failed${
          auditRes.error ? ": " + auditRes.error : ""
        }`,
      });
    }
    setFullRunning(false);
  }

  return (
    <div>
      <div
        className="view-header"
        style={{
          background:
            "linear-gradient(135deg,#312E81 0%,#4338CA 50%,#7C3AED 100%)",
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#C4B5FD" }}>
                <span
                  className="bc-group"
                  style={{ color: "rgba(196,181,253,.8)" }}
                >
                  Grow
                </span>{" "}
                <span
                  className="bc-sep"
                  style={{ color: "rgba(255,255,255,.3)" }}
                >
                  ›
                </span>{" "}
                AI Audit Suite
              </div>
              <h2 className="view-title">🧪 AI Audit Suite</h2>
              <p className="view-sub">
                Run each deep-dive AI audit independently — Prompt Coverage,
                Trend Tracking, Answer Accuracy, Competitive Citation, Entity
                Mapping, Sentiment, Google AI Overview &amp; Citation-to-Traffic
                Attribution.
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                style={{ background: "white", color: "#4338CA" }}
                onClick={runFull}
                disabled={fullRunning}
              >
                {fullRunning ? "⏳ Running…" : "✨ Run Full Audit"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 40 }}
      >
        {toast && (
          <div
            style={{
              background: "#fff",
              border: `1px solid ${toast.color}`,
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: toast.color,
              marginBottom: 16,
            }}
          >
            {toast.text}
          </div>
        )}

        {/* ── GPT-4 AI Visibility Audit ─────────────────────────────── */}
        <div style={card}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "Sora,sans-serif",
                  fontSize: "0.95rem",
                  fontWeight: 800,
                  color: "#0A1628",
                }}
              >
                ✨ GPT-4 AI Visibility Audit
              </div>
              <div
                style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}
              >
                Personalised analysis &amp; action plan to dominate AI search
              </div>
            </div>
            {audit && (
              <button
                onClick={() => setAudit(null)}
                style={{
                  padding: "7px 15px",
                  background: "#F3F4F6",
                  border: "none",
                  borderRadius: 8,
                  fontSize: "0.73rem",
                  fontWeight: 600,
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                ↺ Re-run
              </button>
            )}
          </div>
          {audit ? (
            <div
              style={{
                background: "#F0FDF4",
                border: "1.5px solid #86EFAC",
                borderRadius: 14,
                padding: "22px 26px",
              }}
            >
              <div
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#15803D",
                  textTransform: "uppercase",
                  letterSpacing: ".07em",
                  marginBottom: 12,
                }}
              >
                ✅ Audit Complete — AI Visibility Report
              </div>
              <div
                style={{
                  fontSize: "0.83rem",
                  color: "#1A2F4A",
                  lineHeight: 1.75,
                  whiteSpace: "pre-wrap",
                }}
              >
                {audit}
              </div>
            </div>
          ) : (
            <div
              style={{
                background: "#F8FAFC",
                border: "1.5px dashed #CBD5E1",
                borderRadius: 14,
                padding: "22px 26px",
                display: "flex",
                alignItems: "center",
                gap: 18,
              }}
            >
              <div style={{ fontSize: "2rem", flexShrink: 0 }}>🤖</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "0.92rem",
                    fontWeight: 700,
                    color: "#0A1628",
                    marginBottom: 3,
                  }}
                >
                  Run Your AI Visibility Audit
                </div>
                <div
                  style={{
                    fontSize: "0.76rem",
                    color: "#64748B",
                    lineHeight: 1.5,
                  }}
                >
                  GPT-4 analyses your brand&apos;s presence across all major LLMs
                  and produces a prioritised action plan
                </div>
              </div>
              <button
                onClick={runFull}
                disabled={fullRunning}
                style={{
                  padding: "11px 26px",
                  background: "linear-gradient(135deg,#7C3AED,#4338CA)",
                  border: "none",
                  borderRadius: 10,
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: "white",
                  cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(99,102,241,0.35)",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {fullRunning ? "⏳ Running…" : "✨ Run AI Visibility Audit"}
              </button>
            </div>
          )}
          {fullRunning && (
            <div
              style={{
                textAlign: "center",
                padding: 18,
                fontSize: "0.82rem",
                color: "#6366F1",
                fontWeight: 600,
              }}
            >
              ⏳ GPT-4 is analysing your AI visibility across all platforms…
            </div>
          )}
        </div>

        <CoverageModule
          cov={coverage}
          running={running.coverage}
          onRun={() => runSingle("coverage")}
        />
        <TrendModule trend={trend} onRun={runFull} running={fullRunning} />
        <AccuracyModule
          acc={accuracy}
          running={running.accuracy}
          onRun={() => runSingle("accuracy")}
        />
        <CompetitorsModule
          cc={competitors}
          running={running.competitors}
          onRun={() => runSingle("competitors")}
        />
        <EntityModule
          en={entity}
          running={running.entity}
          onRun={() => runSingle("entity")}
        />
        <SentimentModule
          s={sentiment}
          running={running.sentiment}
          onRun={() => runSingle("sentiment")}
        />
        <SgeModule
          g={sge}
          running={running.sge}
          onRun={() => runSingle("sge")}
        />
        <AttributionModule
          at={attribution}
          running={running.attribution}
          onRun={() => runSingle("attribution")}
        />
      </div>
    </div>
  );
}

// ── PROMPT COVERAGE MATRIX ──────────────────────────────────────────────────
function CoverageModule({
  cov,
  running,
  onRun,
}: {
  cov: CoverageResult | null;
  running: boolean;
  onRun: () => void;
}) {
  if (!cov || !cov.matrix?.length) {
    return (
      <EmptyModule
        emoji="📡"
        title="Prompt Coverage Matrix"
        desc="Run the AI Audit to fire 8 industry prompts × every connected model and see real per-cell citation results."
        btnLabel="✨ Run This Module"
        onRun={onRun}
        running={running}
      />
    );
  }
  const overallPct = Math.round((cov.overallCoverage || 0) * 100);
  const modelKeys = cov.modelKeys || [];
  const summary = cov.summary || {};
  const byModel = cov.coverageByModel || {};
  const th: React.CSSProperties = {
    padding: "8px 8px",
    textAlign: "center",
    background: "#F9FAFB",
    fontSize: "0.62rem",
    fontWeight: 700,
    color: "#6B7280",
    textTransform: "uppercase",
  };
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
              fontWeight: 800,
              color: "#0A1628",
            }}
          >
            📡 Prompt Coverage Matrix
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            Real cell-by-cell citation across {summary.promptsRun} prompts ×{" "}
            {summary.modelsRun} models — {summary.totalCitations}/
            {summary.totalCells} cells cited
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: "1.4rem",
              fontWeight: 800,
              color: pctColor(overallPct),
            }}
          >
            {overallPct}%
          </div>
          <div
            style={{
              fontSize: "0.62rem",
              color: "#9CA3AF",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            Overall coverage
          </div>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: 0,
            fontSize: "0.72rem",
          }}
        >
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Prompt</th>
              {modelKeys.map((k) => (
                <th key={k} style={th}>
                  {k}
                </th>
              ))}
              <th style={th}>%</th>
            </tr>
          </thead>
          <tbody>
            {cov.matrix.map((row, ri) => {
              const hits = row.results.filter((r) => r.cited).length;
              const pct = Math.round((hits / row.results.length) * 100);
              return (
                <tr key={ri} style={{ borderTop: "1px solid #F3F4F6" }}>
                  <td
                    style={{ padding: "9px 10px", borderTop: "1px solid #F3F4F6" }}
                  >
                    <div style={{ fontWeight: 700, color: "#0A1628" }}>
                      {row.cat || ""}
                    </div>
                    <div
                      title={row.prompt}
                      style={{
                        fontSize: "0.64rem",
                        color: "#9CA3AF",
                        fontStyle: "italic",
                        maxWidth: 340,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      &quot;{row.prompt}&quot;
                    </div>
                  </td>
                  {row.results.map((r, ci) => (
                    <td
                      key={ci}
                      title={`${r.modelName}: ${(r.snippet || r.error || "").slice(
                        0,
                        200,
                      )}`}
                      style={{
                        padding: "9px 6px",
                        textAlign: "center",
                        borderTop: "1px solid #F3F4F6",
                      }}
                    >
                      {r.error ? (
                        <span
                          title={r.error}
                          style={{ color: "#9CA3AF", fontSize: "0.85rem" }}
                        >
                          —
                        </span>
                      ) : r.cited ? (
                        <span
                          style={{
                            display: "inline-block",
                            width: 18,
                            height: 18,
                            background: "#DCFCE7",
                            color: "#15803D",
                            borderRadius: "50%",
                            lineHeight: "18px",
                            fontWeight: 800,
                          }}
                        >
                          ✓
                        </span>
                      ) : (
                        <span
                          style={{
                            display: "inline-block",
                            width: 18,
                            height: 18,
                            background: "#FEE2E2",
                            color: "#DC2626",
                            borderRadius: "50%",
                            lineHeight: "18px",
                            fontWeight: 800,
                          }}
                        >
                          ×
                        </span>
                      )}
                    </td>
                  ))}
                  <td
                    style={{
                      padding: "9px 8px",
                      textAlign: "center",
                      borderTop: "1px solid #F3F4F6",
                      fontWeight: 800,
                      color: pctColor(pct),
                    }}
                  >
                    {pct}%
                  </td>
                </tr>
              );
            })}
            <tr style={{ background: "#FAFBFD" }}>
              <td
                style={{
                  padding: "9px 10px",
                  fontWeight: 800,
                  color: "#0A1628",
                  fontSize: "0.72rem",
                }}
              >
                Coverage by model
              </td>
              {modelKeys.map((k) => {
                const p = Math.round((byModel[k] || 0) * 100);
                return (
                  <td
                    key={k}
                    style={{
                      padding: "9px 6px",
                      textAlign: "center",
                      fontWeight: 800,
                      color: pctColor(p),
                    }}
                  >
                    {p}%
                  </td>
                );
              })}
              <td
                style={{
                  padding: "9px 8px",
                  textAlign: "center",
                  fontWeight: 800,
                  color: pctColor(overallPct),
                }}
              >
                {overallPct}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── AI VISIBILITY TREND TRACKING ────────────────────────────────────────────
function TrendModule({
  trend,
  running,
  onRun,
}: {
  trend: TrendResult | null;
  running: boolean;
  onRun: () => void;
}) {
  if (!trend || !trend.runs || trend.runs < 2) {
    return (
      <EmptyModule
        emoji="📈"
        title="AI Visibility Trend Tracking"
        desc={
          trend
            ? `Run ${trend.runs}/2 captured. Run the AI Audit again tomorrow to start seeing daily citation deltas per model.`
            : "Run the AI Audit at least twice to see how your AI citation rate trends over time."
        }
        btnLabel="✨ Run Full Audit"
        onRun={onRun}
        running={running}
      />
    );
  }
  const deltas = trend.deltas || {};
  const series = trend.series || {};
  const overall = deltas.overall || {};
  const modelEntries = Object.entries(deltas).filter(([k]) => k !== "overall");
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
              fontWeight: 800,
              color: "#0A1628",
            }}
          >
            📈 AI Visibility Trend Tracking
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            {trend.runs} historical run{trend.runs === 1 ? "" : "s"} for{" "}
            {trend.domain} — change vs previous audit (run daily for true trend)
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0A1628" }}>
            {overall.current || 0}%
          </div>
          <div style={{ fontSize: "0.7rem", fontWeight: 700 }}>
            <Arrow n={overall.change} />
          </div>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: 12,
        }}
      >
        <div
          style={{
            border: "1.5px solid #2563EB",
            borderRadius: 12,
            padding: 12,
            background: "#EFF6FF",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <div style={{ fontSize: "0.74rem", fontWeight: 800, color: "#1E40AF" }}>
              Overall Coverage
            </div>
            <div style={{ fontSize: "0.66rem", fontWeight: 700 }}>
              <Arrow n={overall.change} />
            </div>
          </div>
          <div
            style={{
              fontSize: "1.3rem",
              fontWeight: 800,
              color: "#0A1628",
              marginBottom: 4,
            }}
          >
            {overall.current || 0}%
          </div>
          <Sparkline pts={series.overall} w={200} h={32} color="#2563EB" />
        </div>
        {modelEntries.map(([mk, d]) => (
          <div
            key={mk}
            style={{
              border: "1.5px solid #E5E7EB",
              borderRadius: 12,
              padding: 12,
              background: "#FAFBFD",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <div
                style={{ fontSize: "0.74rem", fontWeight: 800, color: "#0A1628" }}
              >
                {MODEL_LABELS[mk] || mk}
              </div>
              <div style={{ fontSize: "0.66rem", fontWeight: 700 }}>
                <Arrow n={d.change} />
              </div>
            </div>
            <div
              style={{
                fontSize: "1.15rem",
                fontWeight: 800,
                color: "#0A1628",
                marginBottom: 4,
              }}
            >
              {d.current || 0}%
            </div>
            <Sparkline
              pts={series[mk]}
              w={200}
              h={28}
              color={
                (d.change || 0) > 0
                  ? "#10B981"
                  : (d.change || 0) < 0
                  ? "#DC2626"
                  : "#94A3B8"
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ANSWER ACCURACY ─────────────────────────────────────────────────────────
function FactList({
  label,
  color,
  bg,
  items,
}: {
  label: string;
  color: string;
  bg: string;
  items: string[];
}) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          fontSize: "0.6rem",
          fontWeight: 800,
          color,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginBottom: 4,
        }}
      >
        {label} ({items.length})
      </div>
      {items.map((f, i) => (
        <div
          key={i}
          style={{
            fontSize: "0.66rem",
            color: "#374151",
            padding: "3px 7px",
            background: bg,
            borderRadius: 5,
            marginBottom: 3,
          }}
        >
          {f}
        </div>
      ))}
    </div>
  );
}

function AccuracyModule({
  acc,
  running,
  onRun,
}: {
  acc: AccuracyResult | null;
  running: boolean;
  onRun: () => void;
}) {
  if (!acc || !acc.models?.length) {
    return (
      <EmptyModule
        emoji="🎯"
        title="Answer Accuracy Check"
        desc="Run the AI Audit to scrape your live site, ask each model to describe your brand, and grade every claim for factual accuracy against your real content."
        btnLabel="✨ Run This Module"
        onRun={onRun}
        running={running}
      />
    );
  }
  const overall = acc.overallAccuracy || 0;
  const ovColor = overall >= 75 ? "#10B981" : overall >= 50 ? "#F59E0B" : "#DC2626";
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
              fontWeight: 800,
              color: "#0A1628",
            }}
          >
            🎯 Answer Accuracy Check
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            {acc.sourceFetched
              ? `Graded against ${(acc.sourceLength || 0).toLocaleString()} chars scraped from your live site`
              : "⚠️ Could not scrape source site — accuracy is estimated only"}{" "}
            · {acc.totalHallucinations} hallucination
            {acc.totalHallucinations === 1 ? "" : "s"} detected across{" "}
            {acc.models.length} models
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: ovColor }}>
            {overall}%
          </div>
          <div
            style={{
              fontSize: "0.62rem",
              color: "#9CA3AF",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            Overall accuracy
          </div>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 12,
        }}
      >
        {acc.models.map((m, i) => {
          const c =
            m.accuracy >= 75 ? "#10B981" : m.accuracy >= 50 ? "#F59E0B" : "#DC2626";
          return (
            <div
              key={i}
              style={{
                border: "1.5px solid #E5E7EB",
                borderRadius: 12,
                padding: 14,
                background: "#FAFBFD",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <div
                  style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.86rem" }}
                >
                  {m.name}
                </div>
                <div style={{ fontWeight: 800, color: c, fontSize: "1rem" }}>
                  {m.accuracy}%
                </div>
              </div>
              <div
                style={{
                  fontSize: "0.7rem",
                  color: "#475569",
                  lineHeight: 1.5,
                  marginBottom: 10,
                }}
              >
                {m.summary || (m.error ? "⚠️ " + m.error : "")}
              </div>
              <FactList
                label="✓ Confirmed"
                color="#15803D"
                bg="#F0FDF4"
                items={m.confirmedFacts || []}
              />
              <FactList
                label="✗ Hallucinations"
                color="#DC2626"
                bg="#FEF2F2"
                items={m.hallucinations || []}
              />
              <FactList
                label="? Unverifiable"
                color="#92400E"
                bg="#FFFBEB"
                items={m.unverifiable || []}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── COMPETITIVE CITATION INTELLIGENCE ───────────────────────────────────────
function CompetitorsModule({
  cc,
  running,
  onRun,
}: {
  cc: CompetitorsResult | null;
  running: boolean;
  onRun: () => void;
}) {
  if (!cc || !cc.matrix?.length) {
    return (
      <EmptyModule
        emoji="⚔️"
        title="Competitive Citation Intelligence"
        desc={
          cc?.note ||
          "Run the AI Audit to fire industry prompts across every model for you AND your competitors and see who wins each query."
        }
        btnLabel="✨ Run This Module"
        onRun={onRun}
        running={running}
      />
    );
  }
  const summary = cc.summary || {};
  const sortedSov = Object.entries(cc.shareOfVoicePct || {}).sort(
    (a, b) => b[1] - a[1],
  );
  const maxSov = Math.max(1, ...sortedSov.map((s) => s[1]));
  const rivalAlerts = cc.rivalAlerts || [];
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
              fontWeight: 800,
              color: "#0A1628",
            }}
          >
            ⚔️ Competitive Citation Intelligence
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            {summary.promptsRun} prompts × {summary.modelsRun} models ×{" "}
            {summary.domainsRun} domains · {summary.rivalAlertCount} rival alert
            {summary.rivalAlertCount === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 18 }}>
        <div>
          <div
            style={{
              fontSize: "0.72rem",
              fontWeight: 800,
              color: "#0A1628",
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: ".05em",
            }}
          >
            Share of AI voice
          </div>
          {sortedSov.map(([d, p]) => (
            <div key={d} style={{ marginBottom: 8 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "0.72rem",
                  marginBottom: 3,
                }}
              >
                <span
                  style={{
                    fontWeight: d === cc.brand ? 800 : 600,
                    color: d === cc.brand ? "#2563EB" : "#374151",
                  }}
                >
                  {d === cc.brand ? "★ " : ""}
                  {d}
                </span>
                <span style={{ fontWeight: 800, color: "#0A1628" }}>{p}%</span>
              </div>
              <div
                style={{
                  height: 8,
                  background: "#F3F4F6",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(p / maxSov) * 100}%`,
                    background:
                      d === cc.brand
                        ? "linear-gradient(90deg,#2563EB,#3B82F6)"
                        : "#94A3B8",
                    borderRadius: 4,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div>
          <div
            style={{
              fontSize: "0.72rem",
              fontWeight: 800,
              color: "#0A1628",
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: ".05em",
            }}
          >
            Rival alerts{" "}
            <span style={{ color: "#DC2626" }}>({rivalAlerts.length})</span>
          </div>
          {rivalAlerts.length ? (
            rivalAlerts.slice(0, 5).map((a, i) => (
              <div
                key={i}
                style={{
                  borderLeft: "3px solid #DC2626",
                  background: "#FEF2F2",
                  padding: "8px 10px",
                  borderRadius: "0 8px 8px 0",
                  marginBottom: 8,
                }}
              >
                <div
                  style={{ fontSize: "0.7rem", fontWeight: 700, color: "#0A1628" }}
                >
                  {a.cat}
                </div>
                <div
                  style={{
                    fontSize: "0.66rem",
                    color: "#475569",
                    margin: "3px 0",
                    fontStyle: "italic",
                  }}
                >
                  &quot;{a.prompt.slice(0, 90)}
                  {a.prompt.length > 90 ? "…" : ""}&quot;
                </div>
                <div
                  style={{ fontSize: "0.66rem", color: "#DC2626", fontWeight: 700 }}
                >
                  Cited:{" "}
                  {a.winners.map((w) => `${w.domain} (${w.hits})`).join(", ")}
                </div>
              </div>
            ))
          ) : (
            <div
              style={{
                fontSize: "0.72rem",
                color: "#10B981",
                background: "#F0FDF4",
                padding: 10,
                borderRadius: 8,
              }}
            >
              ✓ No prompts where competitors are winning and you aren&apos;t
              cited.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ENTITY IDENTIFICATION & MAPPING ─────────────────────────────────────────
function Chip({
  txt,
  bg = "#EEF2FF",
  col = "#3730A3",
}: {
  txt: string;
  bg?: string;
  col?: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        background: bg,
        color: col,
        padding: "3px 9px",
        borderRadius: 99,
        fontSize: "0.66rem",
        fontWeight: 700,
        margin: "2px 4px 2px 0",
      }}
    >
      {txt}
    </span>
  );
}

function EntityModule({
  en,
  running,
  onRun,
}: {
  en: EntityResult | null;
  running: boolean;
  onRun: () => void;
}) {
  if (!en || !en.consolidated) {
    return (
      <EmptyModule
        emoji="🧠"
        title="Entity Identification & Mapping"
        desc="Run the AI Audit to see how each model maps your brand as a knowledge-graph entity — category, attributes, relationships, positioning."
        btnLabel="✨ Run This Module"
        onRun={onRun}
        running={running}
      />
    );
  }
  const c = en.consolidated;
  const ag = en.agreementScore || 0;
  const agColor = ag >= 75 ? "#10B981" : ag >= 50 ? "#F59E0B" : "#DC2626";
  const summary = en.summary || {};
  const inconsistencies = en.inconsistencies || [];
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
              fontWeight: 800,
              color: "#0A1628",
            }}
          >
            🧠 Entity Identification &amp; Mapping
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            How {summary.modelsValid}/{summary.modelsRun} AI models describe{" "}
            {en.domain} as a knowledge entity · {summary.inconsistencyCount}{" "}
            inconsistencies detected
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: agColor }}>
            {ag}%
          </div>
          <div
            style={{
              fontSize: "0.62rem",
              color: "#9CA3AF",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            Model agreement
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 18 }}>
        <div
          style={{
            background: "#FAFBFD",
            border: "1px solid #EEF2F7",
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: "0.62rem",
              fontWeight: 800,
              color: "#6B7280",
              textTransform: "uppercase",
              letterSpacing: ".06em",
              marginBottom: 8,
            }}
          >
            Consolidated entity profile
          </div>
          <div
            style={{
              fontSize: "0.78rem",
              color: "#0A1628",
              fontWeight: 700,
              marginBottom: 4,
            }}
          >
            {c.category || "—"}
          </div>
          <div
            style={{
              fontSize: "0.7rem",
              color: "#475569",
              marginBottom: 10,
              fontStyle: "italic",
            }}
          >
            &quot;{c.positioning || "—"}&quot;
          </div>
          {c.attributes?.length ? (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: "0.62rem",
                  color: "#9CA3AF",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  marginBottom: 4,
                }}
              >
                Attributes
              </div>
              {c.attributes.map((a, i) => (
                <Chip key={i} txt={a} />
              ))}
            </div>
          ) : null}
          {c.competitors?.length ? (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: "0.62rem",
                  color: "#9CA3AF",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  marginBottom: 4,
                }}
              >
                Competitors
              </div>
              {c.competitors.map((a, i) => (
                <Chip key={i} txt={a} bg="#FEF3C7" col="#92400E" />
              ))}
            </div>
          ) : null}
          {c.customers?.length ? (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: "0.62rem",
                  color: "#9CA3AF",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  marginBottom: 4,
                }}
              >
                Customers
              </div>
              {c.customers.map((a, i) => (
                <Chip key={i} txt={a} bg="#DCFCE7" col="#15803D" />
              ))}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              gap: 18,
              marginTop: 8,
              fontSize: "0.7rem",
              color: "#475569",
            }}
          >
            <div>
              <b>Founded:</b> {c.founded || "—"}
            </div>
            <div>
              <b>HQ:</b> {c.headquarters || "—"}
            </div>
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: "0.62rem",
              fontWeight: 800,
              color: "#6B7280",
              textTransform: "uppercase",
              letterSpacing: ".06em",
              marginBottom: 8,
            }}
          >
            Inconsistencies ({inconsistencies.length})
          </div>
          {inconsistencies.length ? (
            inconsistencies.slice(0, 6).map((i, idx) => (
              <div
                key={idx}
                style={{
                  borderLeft: "3px solid #F59E0B",
                  background: "#FFFBEB",
                  padding: "8px 10px",
                  borderRadius: "0 8px 8px 0",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{ fontSize: "0.7rem", fontWeight: 700, color: "#92400E" }}
                >
                  {i.field || "mismatch"}
                </div>
                <div
                  style={{ fontSize: "0.66rem", color: "#475569", marginTop: 2 }}
                >
                  {i.issue || ""}
                </div>
              </div>
            ))
          ) : (
            <div
              style={{
                fontSize: "0.72rem",
                color: "#10B981",
                background: "#F0FDF4",
                padding: 10,
                borderRadius: 8,
              }}
            >
              ✓ Models agree on your brand identity.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SENTIMENT & CONTEXT ANALYSIS ────────────────────────────────────────────
const SENT_CHIP: Record<string, [string, string, string]> = {
  positive: ["#DCFCE7", "#15803D", "😊"],
  neutral: ["#F1F5F9", "#475569", "😐"],
  negative: ["#FEE2E2", "#DC2626", "☹️"],
  mixed: ["#FEF3C7", "#92400E", "🤔"],
};

function SentimentModule({
  s,
  running,
  onRun,
}: {
  s: SentimentResult | null;
  running: boolean;
  onRun: () => void;
}) {
  if (!s || !s.perModel?.length) {
    return (
      <EmptyModule
        emoji="💬"
        title="Sentiment & Context Analysis"
        desc="Run the AI Audit to grade how every model talks about your brand — sentiment, positives, negatives, and narrative gaps."
        btnLabel="✨ Run This Module"
        onRun={onRun}
        running={running}
      />
    );
  }
  const dist = s.distribution || {};
  const total =
    (dist.positive || 0) +
      (dist.neutral || 0) +
      (dist.negative || 0) +
      (dist.mixed || 0) || 1;
  const avg = s.avgScore || 0;
  const sCol = avg > 30 ? "#10B981" : avg < -10 ? "#DC2626" : "#F59E0B";
  const summary = s.summary || {};
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
              fontWeight: 800,
              color: "#0A1628",
            }}
          >
            💬 Sentiment &amp; Context Analysis
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            Each model&apos;s brand description graded for tone ·{" "}
            {summary.narrativeGapCount} narrative gap
            {summary.narrativeGapCount === 1 ? "" : "s"} flagged
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: sCol }}>
            {avg > 0 ? "+" : ""}
            {avg}
          </div>
          <div
            style={{
              fontSize: "0.62rem",
              color: "#9CA3AF",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            Avg sentiment
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 6,
          height: 10,
          borderRadius: 5,
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        <div
          title={`Positive: ${dist.positive || 0}`}
          style={{ flex: (dist.positive || 0) / total, background: "#10B981" }}
        />
        <div
          title={`Neutral: ${dist.neutral || 0}`}
          style={{ flex: (dist.neutral || 0) / total, background: "#94A3B8" }}
        />
        <div
          title={`Mixed: ${dist.mixed || 0}`}
          style={{ flex: (dist.mixed || 0) / total, background: "#F59E0B" }}
        />
        <div
          title={`Negative: ${dist.negative || 0}`}
          style={{ flex: (dist.negative || 0) / total, background: "#DC2626" }}
        />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          gap: 10,
        }}
      >
        {s.perModel.map((m, i) => {
          const [bg, col, emo] = SENT_CHIP[m.sentiment] || [
            "#F1F5F9",
            "#475569",
            "—",
          ];
          return (
            <div
              key={i}
              style={{
                border: "1.5px solid #E5E7EB",
                borderRadius: 11,
                padding: 12,
                background: "#FAFBFD",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.82rem" }}
                >
                  {m.modelName}
                </div>
                <span
                  style={{
                    background: bg,
                    color: col,
                    padding: "3px 10px",
                    borderRadius: 99,
                    fontSize: "0.65rem",
                    fontWeight: 800,
                  }}
                >
                  {emo} {m.sentiment} {m.score > 0 ? "+" : ""}
                  {m.score}
                </span>
              </div>
              <div
                style={{
                  fontSize: "0.68rem",
                  color: "#475569",
                  lineHeight: 1.45,
                  marginBottom: 6,
                  maxHeight: 62,
                  overflow: "hidden",
                }}
              >
                {m.text
                  ? m.text.slice(0, 200) + (m.text.length > 200 ? "…" : "")
                  : m.error || "—"}
              </div>
              {m.narrativeGap &&
              m.narrativeGap.toLowerCase() !== "none" ? (
                <div
                  style={{
                    fontSize: "0.64rem",
                    background: "#FFFBEB",
                    color: "#92400E",
                    padding: "5px 8px",
                    borderRadius: 6,
                    border: "1px solid #FDE68A",
                  }}
                >
                  <b>⚠ Gap:</b> {m.narrativeGap}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── GOOGLE AI OVERVIEW / SGE TRACKING ───────────────────────────────────────
function SgeModule({
  g,
  running,
  onRun,
}: {
  g: SgeResult | null;
  running: boolean;
  onRun: () => void;
}) {
  if (!g) {
    return (
      <EmptyModule
        emoji="🔎"
        title="Google AI Overview Tracking"
        desc="Run the AI Audit to detect Google AI Overview presence, citations, and your organic position across 5 industry queries."
        btnLabel="✨ Run This Module"
        onRun={onRun}
        running={running}
      />
    );
  }
  if (g.configured === false) {
    return (
      <div
        style={{
          background: "#FFFBEB",
          border: "1px solid #FDE68A",
          borderRadius: 14,
          padding: 18,
          marginBottom: 20,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: "0.85rem",
            fontWeight: 700,
            color: "#92400E",
            marginBottom: 4,
          }}
        >
          🔎 Google AI Overview Tracking — needs DataForSEO
        </div>
        <div style={{ fontSize: "0.72rem", color: "#92400E" }}>{g.note}</div>
      </div>
    );
  }
  const sm = g.summary || {};
  const presColor = (sm.sgePresenceRate || 0) >= 60
    ? "#10B981"
    : (sm.sgePresenceRate || 0) >= 30
    ? "#F59E0B"
    : "#DC2626";
  const citColor = (sm.sgeCitationRate || 0) >= 60
    ? "#10B981"
    : (sm.sgeCitationRate || 0) >= 30
    ? "#F59E0B"
    : "#DC2626";
  const th: React.CSSProperties = {
    padding: "8px 10px",
    textAlign: "center",
    fontSize: "0.62rem",
    color: "#6B7280",
    textTransform: "uppercase",
    fontWeight: 700,
  };
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
              fontWeight: 800,
              color: "#0A1628",
            }}
          >
            🔎 Google AI Overview Tracking
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            Live SGE / AI Mode parsing across {sm.queriesRun || 0} industry
            queries
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, textAlign: "right" }}>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 800, color: presColor }}>
              {sm.sgePresenceRate || 0}%
            </div>
            <div
              style={{
                fontSize: "0.6rem",
                color: "#9CA3AF",
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              SGE shown
            </div>
          </div>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 800, color: citColor }}>
              {sm.sgeCitationRate || 0}%
            </div>
            <div
              style={{
                fontSize: "0.6rem",
                color: "#9CA3AF",
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              You cited
            </div>
          </div>
        </div>
      </div>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}
      >
        <thead>
          <tr style={{ background: "#F9FAFB" }}>
            <th style={{ ...th, textAlign: "left" }}>Query</th>
            <th style={th}>AI Overview</th>
            <th style={th}>Cites You</th>
            <th style={th}>Sources</th>
            <th style={th}>Organic Pos</th>
          </tr>
        </thead>
        <tbody>
          {(g.queries || []).map((q, i) => (
            <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
              <td style={{ padding: "9px 10px", color: "#0A1628", fontWeight: 600 }}>
                {q.query}
              </td>
              <td style={{ padding: "9px 10px", textAlign: "center" }}>
                {q.error ? (
                  <span style={{ color: "#9CA3AF" }}>—</span>
                ) : q.aiOverviewPresent ? (
                  <span style={{ color: "#10B981", fontWeight: 800 }}>●</span>
                ) : (
                  <span style={{ color: "#CBD5E1" }}>○</span>
                )}
              </td>
              <td style={{ padding: "9px 10px", textAlign: "center" }}>
                {q.error ? (
                  "—"
                ) : q.aiOverviewCitesYou ? (
                  <span
                    style={{
                      background: "#DCFCE7",
                      color: "#15803D",
                      padding: "2px 8px",
                      borderRadius: 99,
                      fontWeight: 800,
                    }}
                  >
                    ✓
                  </span>
                ) : (
                  <span
                    style={{
                      background: "#FEE2E2",
                      color: "#DC2626",
                      padding: "2px 8px",
                      borderRadius: 99,
                      fontWeight: 800,
                    }}
                  >
                    ×
                  </span>
                )}
              </td>
              <td
                style={{ padding: "9px 10px", textAlign: "center", color: "#475569" }}
              >
                {q.aiOverviewSourceCount || 0}
              </td>
              <td
                style={{
                  padding: "9px 10px",
                  textAlign: "center",
                  fontWeight: 700,
                  color: q.organicPosition
                    ? q.organicPosition <= 3
                      ? "#10B981"
                      : q.organicPosition <= 10
                      ? "#F59E0B"
                      : "#9CA3AF"
                    : "#9CA3AF",
                }}
              >
                {q.organicPosition || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── CITATION-TO-TRAFFIC ATTRIBUTION ─────────────────────────────────────────
function AttributionModule({
  at,
  running,
  onRun,
}: {
  at: AttributionResult | null;
  running: boolean;
  onRun: () => void;
}) {
  if (!at) {
    return (
      <EmptyModule
        emoji="📈"
        title="Citation-to-Traffic Attribution"
        desc="Run the AI Audit to connect AI citations to real traffic via Amplitude."
        btnLabel="✨ Run This Module"
        onRun={onRun}
        running={running}
      />
    );
  }
  if (!at.connected) {
    return (
      <div style={card}>
        <div
          style={{
            fontFamily: "Sora,sans-serif",
            fontSize: "1rem",
            fontWeight: 800,
            color: "#0A1628",
            marginBottom: 4,
          }}
        >
          📈 Citation-to-Traffic Attribution
        </div>
        <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 12 }}>
          {at.note}
        </div>
        <div
          style={{
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
            borderRadius: 10,
            padding: 12,
            fontSize: "0.72rem",
            color: "#92400E",
            marginBottom: 14,
          }}
        >
          <b>Missing:</b> {at.missing}. Add it to your environment to start
          tracking AI referral sessions in real time.
        </div>
        <div
          style={{
            fontSize: "0.62rem",
            fontWeight: 800,
            color: "#6B7280",
            textTransform: "uppercase",
            letterSpacing: ".05em",
            marginBottom: 8,
          }}
        >
          Will track these AI sources
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(at.aiSources || []).map((s, i) => (
            <span
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "#F1F5F9",
                color: "#475569",
                padding: "5px 11px",
                borderRadius: 99,
                fontSize: "0.7rem",
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  background: "#CBD5E1",
                  borderRadius: "50%",
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>
    );
  }
  const sessions = at.sessions || [];
  const totalAi = at.totalAiSessions || 0;
  const maxAi = Math.max(1, ...sessions.map((s) => s.sessions || 0));
  const aiShare = at.aiShare || 0;
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
              fontWeight: 800,
              color: "#0A1628",
            }}
          >
            📈 Citation-to-Traffic Attribution
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            Live Amplitude data · last {at.windowDays} days ·{" "}
            {totalAi.toLocaleString()} AI-referred sessions of{" "}
            {(at.totalSessions || 0).toLocaleString()} total
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: "1.4rem",
              fontWeight: 800,
              color: aiShare >= 5 ? "#10B981" : aiShare >= 1 ? "#F59E0B" : "#DC2626",
            }}
          >
            {aiShare}%
          </div>
          <div
            style={{
              fontSize: "0.62rem",
              color: "#9CA3AF",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            AI traffic share
          </div>
        </div>
      </div>
      {sessions.map((s, i) => (
        <div key={i} style={{ marginBottom: 9 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.74rem",
              marginBottom: 4,
            }}
          >
            <span style={{ fontWeight: 700, color: "#0A1628" }}>{s.label}</span>
            <span style={{ fontWeight: 800, color: "#0A1628" }}>
              {(s.sessions || 0).toLocaleString()}
            </span>
          </div>
          <div
            style={{
              height: 8,
              background: "#F3F4F6",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${((s.sessions || 0) / maxAi) * 100}%`,
                background: "linear-gradient(90deg,#7C3AED,#4338CA)",
                borderRadius: 4,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

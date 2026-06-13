"use client";

// Native React port of the legacy `ask-infogenie` panel (was
// `window.buildAskInfogenie` in public/js/ig_manage_pack.js + `#view-ask-infogenie`).
// Onyx-style platform Q&A: shows index status, re-indexes, and asks questions
// against the existing Express API (`GET /api/platform-search/index-status`,
// `POST /api/platform-search/reindex`, `POST /api/platform-search/ask`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface IndexStatus {
  ok?: boolean;
  indexed?: number;
  lastUpdated?: string | null;
}
interface TopScore {
  type: string;
  score: number;
}
interface AskResult {
  ok: boolean;
  error?: string;
  answer?: string;
  source?: string;
  dataTypes?: string[];
  autoIndexed?: boolean;
  indexCount?: number;
  chunksUsed?: number;
  topScores?: TopScore[];
  context?: { totals?: Record<string, number> };
}

const TYPE_LABELS: Record<string, string> = {
  campaign: "Campaigns",
  insight: "Ad Insights",
  lead: "Leads",
  mention: "Mentions",
  landing_page: "Landing Pages",
  content_calendar: "Content",
  brand_calendar: "Brand Calendar",
  budget: "Budget",
  booking: "Bookings",
  linksell: "Link-in-Bio",
  audience: "Audiences",
  task: "Tasks",
};
const TYPE_ICONS: Record<string, string> = {
  campaign: "📣",
  insight: "📊",
  lead: "👤",
  mention: "💬",
  landing_page: "🔗",
  content_calendar: "📅",
  brand_calendar: "🗓",
  budget: "💰",
  booking: "📆",
  linksell: "🔗",
  audience: "👥",
  task: "✅",
};

const SUGGESTIONS = [
  "What changed in the last 7 days?",
  "Which landing page is converting best?",
  "Are any campaigns over budget?",
  "Which leads should I call first?",
  "What's scheduled this week?",
];

function renderAnswer(answer: string): React.ReactNode {
  const lines = answer.split("\n");
  return lines.map((line, i) => {
    const l = line.replace(/^[-•]\s/, "• ");
    const parts: React.ReactNode[] = [];
    const regex = /\*\*(.+?)\*\*/g;
    let last = 0;
    let key = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(l)) !== null) {
      if (m.index > last) parts.push(l.slice(last, m.index));
      parts.push(<strong key={key++}>{m[1]}</strong>);
      last = m.index + m[0].length;
    }
    if (last < l.length) parts.push(l.slice(last));
    return (
      <span key={i}>
        {parts}
        {i < lines.length - 1 ? <br /> : null}
      </span>
    );
  });
}

export default function AskInfoGenie() {
  const toast = useToast();
  const [indexStatus, setIndexStatus] = useState<IndexStatus>({ indexed: 0, lastUpdated: null });
  const [query, setQuery] = useState("");
  const [reindexing, setReindexing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  async function loadStatus() {
    const s = await apiGet<IndexStatus>("/api/platform-search/index-status");
    if (s.ok) setIndexStatus(s);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await apiGet<IndexStatus>("/api/platform-search/index-status");
      if (cancelled) return;
      if (s.ok) setIndexStatus(s);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reindex() {
    setReindexing(true);
    const r = await apiPost<{ ok: boolean; chunks?: number; embedded?: number; error?: string }>(
      "/api/platform-search/reindex",
    );
    if (r.ok) {
      toast(`✅ Indexed ${r.chunks} chunks (${r.embedded} embedded)`);
      await loadStatus();
    } else {
      toast("⚠️ " + (r.error || "Reindex failed"));
    }
    setReindexing(false);
  }

  async function ask(q?: string) {
    const question = (q ?? query).trim();
    if (!question) return;
    if (q !== undefined) setQuery(q);
    setAsking(true);
    setResult(null);
    setAskError(null);
    const j = await apiPost<AskResult>("/api/platform-search/ask", { question });
    setAsking(false);
    if (!j.ok) {
      setAskError(j.error || "failed");
      return;
    }
    setResult(j);
  }

  const lastUpdStr = indexStatus.lastUpdated
    ? new Date(indexStatus.lastUpdated).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const isVector = result?.source === "vector-retrieval";
  const totals = result?.context?.totals || {};

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span> <span className="bc-sep">›</span> Ask
                InfoGenie
              </div>
              <h2 className="view-title">💬 Ask InfoGenie</h2>
              <p className="view-sub">
                One chat box that knows about your campaigns, leads, audiences, mentions, ad
                insights, content calendar, budget, landing pages, bookings and link-in-bio. Ask in
                plain English.
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
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  background: "linear-gradient(135deg,#0066FF,#7C3AED)",
                  borderRadius: 8,
                  padding: "5px 10px",
                  fontSize: "0.7rem",
                  fontWeight: 800,
                  color: "#fff",
                  letterSpacing: ".04em",
                }}
              >
                ⚡ SMART SEARCH
              </div>
              <div style={{ fontSize: "0.75rem", color: "#6B7280" }}>
                {(indexStatus.indexed || 0) > 0
                  ? `${indexStatus.indexed} indexed chunks${
                      lastUpdStr ? " · updated " + lastUpdStr : ""
                    }`
                  : "Not yet indexed — will auto-index on first question"}
              </div>
            </div>
            <button
              onClick={reindex}
              disabled={reindexing}
              style={{
                background: "#F3F4F6",
                border: "1px solid #E5E7EB",
                color: "#374151",
                padding: "5px 11px",
                borderRadius: 7,
                fontSize: "0.72rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {reindexing ? "⏳ Indexing…" : "🔄 Re-index data"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") ask();
              }}
              placeholder="e.g. Which campaign has the worst CPC? · Which leads should I call first? · Any negative mentions?"
              style={{
                flex: 1,
                padding: "11px 14px",
                border: "1px solid #D1D5DB",
                borderRadius: 7,
                fontSize: "0.92rem",
              }}
            />
            <button
              onClick={() => ask()}
              style={{
                background: "linear-gradient(135deg,#0066FF,#7C3AED)",
                color: "#fff",
                border: 0,
                padding: "11px 22px",
                borderRadius: 7,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Ask →
            </button>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                style={{
                  background: "#F3F4F6",
                  border: "1px solid #E5E7EB",
                  color: "#374151",
                  padding: "5px 10px",
                  borderRadius: 14,
                  fontSize: "0.74rem",
                  cursor: "pointer",
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        <div>
          {asking && (
            <div style={{ color: "#9CA3AF", display: "flex", alignItems: "center", gap: 8 }}>
              <span>⚙️</span> Searching your data semantically…
            </div>
          )}
          {askError && <div style={{ color: "#DC2626" }}>{askError}</div>}
          {result && result.answer != null && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 18,
              }}
            >
              {result.autoIndexed && (
                <div
                  style={{
                    background: "#EFF6FF",
                    border: "1px solid #BFDBFE",
                    color: "#1D4ED8",
                    padding: "8px 12px",
                    borderRadius: 7,
                    fontSize: "0.75rem",
                    marginBottom: 10,
                  }}
                >
                  ⚡ Your data was indexed automatically ({result.indexCount} chunks). Future
                  questions will be faster.
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                  flexWrap: "wrap",
                }}
              >
                {isVector ? (
                  <span
                    style={{
                      background: "#EFF6FF",
                      color: "#1D4ED8",
                      border: "1px solid #BFDBFE",
                      padding: "3px 8px",
                      borderRadius: 12,
                      fontSize: "0.68rem",
                      fontWeight: 700,
                    }}
                  >
                    ⚡ Vector Search
                  </span>
                ) : (
                  <span
                    style={{
                      background: "#F3F4F6",
                      color: "#6B7280",
                      border: "1px solid #E5E7EB",
                      padding: "3px 8px",
                      borderRadius: 12,
                      fontSize: "0.68rem",
                      fontWeight: 700,
                    }}
                  >
                    💬 GPT snapshot
                  </span>
                )}
                {result.chunksUsed ? (
                  <span style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>
                    Searched {result.indexCount || 0} chunks · used {result.chunksUsed} most relevant
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: "0.95rem", lineHeight: 1.6, color: "#0A1628" }}>
                {renderAnswer(result.answer)}
              </div>
              {(result.dataTypes || []).length > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                  {(result.dataTypes || []).map((t) => (
                    <span
                      key={t}
                      style={{
                        background: "#F0FDF4",
                        color: "#166534",
                        border: "1px solid #BBF7D0",
                        padding: "3px 8px",
                        borderRadius: 10,
                        fontSize: "0.68rem",
                        fontWeight: 600,
                      }}
                    >
                      {(TYPE_ICONS[t] || "") + (TYPE_LABELS[t] || t)}
                    </span>
                  ))}
                </div>
              )}
              {(result.topScores || []).length > 0 && isVector && (
                <div style={{ marginTop: 8, fontSize: "0.68rem", color: "#9CA3AF" }}>
                  Top matches:{" "}
                  {(result.topScores || [])
                    .map(
                      (s) =>
                        `${TYPE_ICONS[s.type] || ""}${TYPE_LABELS[s.type] || s.type} (${s.score}%)`,
                    )
                    .join(" · ")}
                </div>
              )}
              {result.source === "fallback" && result.context && (
                <>
                  <div
                    style={{
                      background: "#FEF3C7",
                      border: "1px solid #FBBF24",
                      color: "#92400E",
                      padding: "10px 14px",
                      borderRadius: 8,
                      fontSize: "0.8rem",
                      margin: "14px 0",
                    }}
                  >
                    💡 Add a real OpenAI key in Manage → AI Providers to unlock semantic search.
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
                      gap: 10,
                    }}
                  >
                    {(
                      [
                        ["Campaigns", totals.campaigns],
                        ["Leads", totals.leads],
                        ["Mentions", totals.mentions],
                        ["Landing Pages", totals.landingPages],
                        ["Bookings", totals.bookings],
                      ] as Array<[string, number | undefined]>
                    ).map(([k, v]) => (
                      <div
                        key={k}
                        style={{
                          background: "#F8FAFC",
                          border: "1px solid #E5E7EB",
                          borderRadius: 8,
                          padding: "10px 12px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.7rem",
                            color: "#6B7280",
                            textTransform: "uppercase",
                            fontWeight: 700,
                          }}
                        >
                          {k}
                        </div>
                        <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#0A1628" }}>
                          {v || 0}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

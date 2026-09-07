"use client";

// Native React port of the legacy `meeting-notes` panel (was
// `window.buildMeetingNotes` in public/js/ig_intel_pack_a.js +
// `#view-meeting-notes`). Summarizes & scores a sales-call transcript (summary,
// BANT, action items, deal stage, risks, next step) against the existing Express
// API (`POST /api/meeting-notes/summarize`) via lib/api.

import { useState, useCallback, useEffect } from "react";
import { apiPost, apiGet } from "@/lib/api";

interface BantItem {
  score?: number;
  evidence?: string;
}
interface ActionItem {
  owner?: string;
  task?: string;
  due?: string;
}
interface Summary {
  overall_score?: number;
  deal_stage?: string;
  sentiment?: string;
  next_step?: string;
  summary?: string;
  key_points?: string[];
  bant?: Record<string, BantItem>;
  action_items?: ActionItem[];
  objections_raised?: string[];
  risks?: string[];
}
interface SummarizeResult {
  ok: boolean;
  error?: string;
  summary?: Summary;
  id?: number | null;
}

interface ContactInfo {
  name?: string;
  company?: string;
  role?: string;
}

interface HistoryItem {
  id: number;
  contact: ContactInfo | string | null;
  summary: Summary | string | null;
  source: string;
  created_at: string;
}

interface HistoryResponse {
  ok: boolean;
  error?: string;
  notes?: HistoryItem[];
}

interface NoteDetailResponse {
  ok: boolean;
  error?: string;
  note?: {
    id: number;
    contact: ContactInfo | string | null;
    summary: Summary | string | null;
    source: string;
    created_at: string;
  };
}

type OutState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; text: string }
  | { kind: "result"; summary: Summary };

const SYNTHETIC_SOURCES = new Set([
  "template",
  "fallback",
  "demo",
  "placeholder",
  "mock",
  "sample",
  "serp-fallback",
]);

function isSyntheticSource(source?: string | null): boolean {
  if (!source) return false;
  return SYNTHETIC_SOURCES.has(source.toLowerCase());
}

function parseJsonField<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "object") return raw as T;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function parseSummary(raw: unknown): Summary | null {
  const s = parseJsonField<Summary>(raw);
  if (!s || typeof s !== "object") return null;
  return s;
}

function contactLabel(contact: unknown): string {
  const c = parseJsonField<ContactInfo>(contact);
  if (!c) return "Untitled";
  const n = String(c.name || "").trim();
  const co = String(c.company || "").trim();
  if (n && co) return `${n} · ${co}`;
  if (n) return n;
  if (co) return co;
  return "Untitled";
}

function historyMeta(summary: unknown): string {
  const s = parseSummary(summary);
  if (!s) return "";
  if (s.deal_stage) return s.deal_stage.replace(/_/g, " ");
  if (s.overall_score != null) return `Score ${s.overall_score}`;
  return "";
}

const stageColor: Record<string, string> = {
  discovery: "#6B7280",
  qualification: "#3B82F6",
  proposal: "#0284c7",
  negotiation: "#F59E0B",
  closed_won: "#10B981",
  closed_lost: "#EF4444",
};
const sentColor: Record<string, string> = {
  positive: "#10B981",
  neutral: "#6B7280",
  negative: "#EF4444",
};

const contactInputStyle: React.CSSProperties = {
  padding: 7,
  border: "1px solid #D1D5DB",
  borderRadius: 5,
  fontSize: "0.82rem",
  boxSizing: "border-box",
};

export default function MeetingNotes() {
  const [transcript, setTranscript] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [out, setOut] = useState<OutState>({ kind: "idle" });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingNoteId, setLoadingNoteId] = useState<number | null>(null);
  const [resultSource, setResultSource] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const r = await apiGet<HistoryResponse>("/api/meeting-notes/history");
      if (!r.ok) {
        setHistory([]);
        setHistoryError(r.error || "Could not load history");
        setHistoryLoaded(true);
        return;
      }
      setHistory(Array.isArray(r.notes) ? r.notes : []);
      setHistoryError(null);
      setHistoryLoaded(true);
    } catch {
      setHistory([]);
      setHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const loadNote = useCallback(async (item: HistoryItem) => {
    setLoadingNoteId(item.id);
    setOut({ kind: "idle" });
    try {
      let summary = parseSummary(item.summary);
      let source = item.source;
      if (!summary || !Object.keys(summary).length) {
        const r = await apiGet<NoteDetailResponse>(`/api/meeting-notes/${item.id}`);
        if (!r.ok || !r.note) {
          setOut({ kind: "error", text: r.error || "Note not found" });
          return;
        }
        summary = parseSummary(r.note.summary);
        source = r.note.source;
      }
      if (!summary) {
        setOut({ kind: "error", text: "Could not load summary" });
        return;
      }
      setResultSource(source);
      setOut({ kind: "result", summary });
    } finally {
      setLoadingNoteId(null);
    }
  }, []);

  async function run() {
    const t = transcript.trim();
    if (!t) {
      setOut({ kind: "error", text: "Transcript required" });
      return;
    }
    const contact = { name: name.trim(), company: company.trim(), role: role.trim() };
    setOut({ kind: "loading" });
    const r = await apiPost<SummarizeResult>("/api/meeting-notes/summarize", {
      transcript: t,
      contact: contact.name || contact.company ? contact : null,
    });
    if (!r.ok || !r.summary) {
      setOut({ kind: "error", text: r.error || "unknown" });
      return;
    }
    setResultSource("ai");
    setOut({ kind: "result", summary: r.summary });
    await loadHistory();
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Meeting Notes
              </div>
              <h2 className="view-title">📝 Meeting Notes</h2>
              <p className="view-sub">
                AI-powered meeting notes — record or paste a transcript and the
                AI extracts action items, decisions, and follow-ups so every
                meeting produces clear, executable outputs.
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
        <h3
          style={{
            margin: "0 0 10px",
            color: "#0A1628",
            fontFamily: "Sora,sans-serif",
            fontSize: "1rem",
          }}
        >
          🎙️ Sales-Call Transcript
        </h3>
        <textarea
          rows={14}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder={
            "Paste your sales-call transcript here (50+ chars)…\n\nSales: Hi Jane, thanks for taking the call.\nJane: Sure, happy to chat. We're evaluating tools right now…"
          }
          style={{
            width: "100%",
            padding: 10,
            border: "1px solid #D1D5DB",
            borderRadius: 6,
            fontSize: "0.82rem",
            fontFamily: "inherit",
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8,
            marginTop: 10,
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contact name (optional)"
            style={contactInputStyle}
          />
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company (optional)"
            style={contactInputStyle}
          />
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Role (optional)"
            style={contactInputStyle}
          />
        </div>
        <button
          onClick={run}
          style={{
            marginTop: 12,
            background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
            color: '#0f172a',
            border: "none",
            padding: "12px 24px",
            borderRadius: 8,
            fontSize: "0.86rem",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          🤖 Summarize + Score
        </button>
      </div>

      {historyLoaded && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
            marginBottom: 18,
          }}
        >
          <h3
            style={{
              margin: "0 0 10px",
              color: "#0A1628",
              fontFamily: "Sora,sans-serif",
              fontSize: "0.96rem",
            }}
          >
            🕐 Recent notes
          </h3>
          {historyError ? (
            <div style={{ color: "#9CA3AF", fontSize: "0.78rem" }}>{historyError}</div>
          ) : history.length === 0 ? (
            <div style={{ color: "#9CA3AF", fontSize: "0.82rem" }}>
              No saved notes yet — summarize a transcript above.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {history.map((h) => {
                const meta = historyMeta(h.summary);
                const busy = loadingNoteId === h.id;
                return (
                  <div
                    key={h.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      background: "#F9FAFB",
                      borderRadius: 8,
                      border: "1px solid #E5E7EB",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => !busy && loadNote(h)}
                        onKeyDown={(e) => {
                          if (!busy && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            loadNote(h);
                          }
                        }}
                        style={{
                          fontWeight: 600,
                          fontSize: "0.85rem",
                          color: busy ? "#9CA3AF" : "#0A1628",
                          cursor: busy ? "default" : "pointer",
                          textDecoration: busy ? "none" : "underline",
                        }}
                      >
                        {contactLabel(h.contact)}
                      </span>
                      {meta ? (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: "0.74rem",
                            color: "#6B7280",
                            textTransform: "capitalize",
                          }}
                        >
                          {meta}
                        </span>
                      ) : null}
                      <span style={{ marginLeft: 8, fontSize: "0.74rem", color: "#9CA3AF" }}>
                        {h.created_at ? new Date(h.created_at).toLocaleDateString() : ""}
                      </span>
                      {isSyntheticSource(h.source) ? (
                        <span
                          style={{
                            marginLeft: 8,
                            padding: "1px 6px",
                            background: "#FEF3C7",
                            color: "#92400E",
                            borderRadius: 99,
                            fontSize: "0.68rem",
                          }}
                        >
                          illustrative
                        </span>
                      ) : null}
                    </div>
                    {busy ? (
                      <span style={{ fontSize: "0.72rem", color: "#9CA3AF" }}>Loading…</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div>
        {out.kind === "loading" && (
          <div style={{ color: "#9CA3AF" }}>⏳ Analyzing transcript…</div>
        )}
        {out.kind === "error" && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#B91C1C",
              padding: 14,
              borderRadius: 10,
            }}
          >
            {out.text}
          </div>
        )}
        {out.kind === "result" && (
          <Result summary={out.summary} source={resultSource} />
        )}
      </div>
    </div>
    </div>
  );
}

function Result({ summary: s, source }: { summary: Summary; source?: string | null }) {
  const bant = s.bant || {};
  const synthetic = isSyntheticSource(source);
  return (
    <>
      {synthetic ? (
        <div
          style={{
            background: "#FEF3C7",
            border: "1px solid #FCD34D",
            color: "#92400E",
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: "0.8rem",
            marginBottom: 14,
          }}
        >
          Scores below are illustrative — not from live AI analysis.
        </div>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 10,
            padding: 14,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "1.8rem", fontWeight: 800, color: synthetic ? "#9CA3AF" : "#1E1B4B" }}>
            {synthetic ? "—" : s.overall_score || 0}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#6B7280", fontWeight: 700 }}>
            DEAL SCORE / 100
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 10,
            padding: 14,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 800,
              color: stageColor[s.deal_stage || ""] || "#6B7280",
              textTransform: "uppercase",
            }}
          >
            {s.deal_stage || "?"}
          </div>
          <div
            style={{
              fontSize: "0.7rem",
              color: "#6B7280",
              fontWeight: 700,
              marginTop: 4,
            }}
          >
            DEAL STAGE
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 10,
            padding: 14,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 800,
              color: sentColor[s.sentiment || ""] || "#6B7280",
              textTransform: "uppercase",
            }}
          >
            {s.sentiment || "?"}
          </div>
          <div
            style={{
              fontSize: "0.7rem",
              color: "#6B7280",
              fontWeight: 700,
              marginTop: 4,
            }}
          >
            SENTIMENT
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 10,
            padding: 14,
          }}
        >
          <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#6B7280" }}>
            NEXT STEP
          </div>
          <div
            style={{
              fontSize: "0.82rem",
              color: "#0A1628",
              marginTop: 2,
              lineHeight: 1.4,
            }}
          >
            {s.next_step || ""}
          </div>
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: 18,
          marginBottom: 14,
        }}
      >
        <h3 style={{ margin: "0 0 8px", color: "#0A1628", fontSize: "0.96rem" }}>
          📝 Summary
        </h3>
        <div style={{ color: "#374151", fontSize: "0.86rem", lineHeight: 1.55 }}>
          {s.summary || ""}
        </div>
        {s.key_points?.length ? (
          <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: "0.82rem", color: "#0A1628" }}>Key points:</strong>
            <ul
              style={{
                margin: "6px 0 0",
                paddingLeft: 22,
                color: "#374151",
                fontSize: "0.82rem",
                lineHeight: 1.6,
              }}
            >
              {s.key_points.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: 18,
          marginBottom: 14,
        }}
      >
        <h3 style={{ margin: "0 0 10px", color: "#0A1628", fontSize: "0.96rem" }}>
          🎯 BANT Score
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
          {(["budget", "authority", "need", "timeline"] as const).map((k) => {
            const b = bant[k] || {};
            return (
              <div key={k} style={{ background: "#F9FAFB", borderRadius: 8, padding: 10 }}>
                <div
                  style={{
                    fontWeight: 800,
                    color: "#0A1628",
                    fontSize: "0.78rem",
                    textTransform: "uppercase",
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontSize: "1.4rem",
                    fontWeight: 800,
                    color: synthetic ? "#9CA3AF" : "#1E1B4B",
                    margin: "4px 0",
                  }}
                >
                  {synthetic ? "—" : b.score || 0}
                  {!synthetic ? (
                    <span style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>/10</span>
                  ) : null}
                </div>
                <div style={{ fontSize: "0.72rem", color: "#6B7280", lineHeight: 1.4 }}>
                  {b.evidence || ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {s.action_items?.length ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
            marginBottom: 14,
          }}
        >
          <h3 style={{ margin: "0 0 10px", color: "#0A1628", fontSize: "0.96rem" }}>
            ✅ Action Items
          </h3>
          <div style={{ display: "grid", gap: 6 }}>
            {s.action_items.map((a, i) => (
              <div
                key={i}
                style={{
                  background: "#F0FDF4",
                  borderLeft: "3px solid #10B981",
                  padding: "8px 12px",
                  borderRadius: 6,
                  fontSize: "0.82rem",
                }}
              >
                <strong style={{ color: "#065F46" }}>{a.owner || "?"}:</strong>{" "}
                {a.task || ""}{" "}
                <span style={{ color: "#6B7280", fontSize: "0.74rem" }}>· {a.due || ""}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {s.objections_raised?.length || s.risks?.length ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
          }}
        >
          {s.objections_raised?.length ? (
            <div style={{ marginBottom: 10 }}>
              <h4 style={{ margin: "0 0 6px", color: "#92400E", fontSize: "0.86rem" }}>
                ⚠ Objections raised
              </h4>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 22,
                  color: "#374151",
                  fontSize: "0.82rem",
                  lineHeight: 1.6,
                }}
              >
                {s.objections_raised.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {s.risks?.length ? (
            <div>
              <h4 style={{ margin: "0 0 6px", color: "#991B1B", fontSize: "0.86rem" }}>
                🚨 Risks
              </h4>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 22,
                  color: "#374151",
                  fontSize: "0.82rem",
                  lineHeight: 1.6,
                }}
              >
                {s.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

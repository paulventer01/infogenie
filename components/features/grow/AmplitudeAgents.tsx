"use client";

// Native React port of the legacy `amplitude-agents` panel (was
// `buildAmplitudeAgents` + `_AMP_AGENTS` + `_amp*` helpers in
// public/js/ig_research_tools.js + `#view-amplitude-agents` in index.html).
// Three on-demand agents that pull live Amplitude product-analytics data and
// run it through GPT-4o. Calls the existing Express API:
//   GET  /api/amplitude/status         (connection probe for the badge)
//   POST /api/amplitude/dashboard-agent
//   POST /api/amplitude/replay-agent   (optionally { events: [...] })
//   POST /api/amplitude/feedback-agent
//
// See docs/react-panel-migration.md for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

type AgentId = "dashboard" | "replay" | "feedback";

interface AgentDef {
  id: AgentId;
  icon: string;
  iconBg: string;
  iconColor: string;
  title: string;
  desc: string;
  bullets: string[];
  btn: string;
  endpoint: string;
}

const AGENTS: AgentDef[] = [
  {
    id: "dashboard",
    icon: "📊",
    iconBg: "#DBEAFE",
    iconColor: "#1D4ED8",
    title: "Dashboard Agent",
    desc: "Analyse dashboards to surface trends, identify root causes and generate hypotheses behind important metric changes.",
    bullets: [
      "Auto-generate insights from your tracked events",
      "Deep-dive interesting trends and anomalies",
      "Schedule proactive and automated monitoring",
    ],
    btn: "Run Dashboard Agent",
    endpoint: "/api/amplitude/dashboard-agent",
  },
  {
    id: "replay",
    icon: "▶️",
    iconBg: "#E5E7EB",
    iconColor: "#374151",
    title: "Session Replay Agent",
    desc: "Specify an event or funnel then analyse large samples of session replays to identify user frictions, drop-offs, and navigational patterns.",
    bullets: [
      "Continuously scan and explore new sessions / replays",
      "Identify exactly where and why users struggle or abandon",
      "Create playlists that back insight with evidence",
    ],
    btn: "Run Session Replay Agent",
    endpoint: "/api/amplitude/replay-agent",
  },
  {
    id: "feedback",
    icon: "💬",
    iconBg: "#FCE7F3",
    iconColor: "#BE185D",
    title: "Customer Feedback Agent",
    desc: "Automatically surface top customer requests, bugs, complaints, and praises from feedback, surveys, support tickets, and sales calls.",
    bullets: [
      "Continuously analyse incoming customer feedback",
      "Surface top requests, bugs, complaints, and praises",
      "Generate recommendations on improvements to ship",
    ],
    btn: "Run Customer Feedback Agent",
    endpoint: "/api/amplitude/feedback-agent",
  },
];

interface StatusResult {
  ok?: boolean;
  connected?: boolean | "unknown";
  missing?: string;
  message?: string;
  error?: string;
  dashboardApiAccess?: boolean;
  status?: number;
}

interface DashboardEvent {
  event: string;
  total?: number;
  last7?: number;
  prev7?: number;
  wowPct?: number;
}
interface DashboardTrend {
  event: string;
  wowPct?: number;
  note?: string;
}
interface DashboardAnomaly {
  event: string;
  severity?: string;
  note?: string;
}
interface DashboardHypothesis {
  title: string;
  reasoning?: string;
  test?: string;
}
interface DashboardInsights {
  summary?: string;
  trends?: DashboardTrend[];
  anomalies?: DashboardAnomaly[];
  hypotheses?: DashboardHypothesis[];
}

interface ReplayStep {
  event: string;
  users?: number;
  dropPct?: number;
  stepIndex?: number;
}
interface FrictionHypothesis {
  hypothesis: string;
  evidence?: string;
  replayQuery?: string;
}
interface PlaylistIdea {
  name: string;
  filter?: string;
  whyItMatters?: string;
}
interface ReplayInsights {
  summary?: string;
  frictionHypotheses?: FrictionHypothesis[];
  playlistIdeas?: PlaylistIdea[];
  biggestDropOff?: { interpretation?: string };
}

interface FeedbackEvent {
  event: string;
  volume30d?: number;
}
interface FeedbackItem {
  title: string;
  severity?: string;
  volume?: string;
  rationale?: string;
}
interface FeedbackRec {
  title: string;
  impact?: string;
  effort?: string;
  next_step?: string;
}
interface FeedbackInsights {
  summary?: string;
  requests?: FeedbackItem[];
  bugs?: FeedbackItem[];
  praises?: FeedbackItem[];
  recommendations?: FeedbackRec[];
}

interface AgentResult {
  ok?: boolean;
  error?: string;
  message?: string;
  note?: string;
  connected?: boolean;
  missing?: string;
  planLimited?: boolean;
  planNote?: string;
  // dashboard
  totals?: { events?: number; wowPct?: number };
  events?: DashboardEvent[];
  insights?: DashboardInsights & ReplayInsights & FeedbackInsights;
  // replay
  steps?: ReplayStep[];
  worst?: { event: string; dropPct?: number; stepIndex?: number };
  windowDays?: number;
  overallConversion?: number;
  // feedback
  matchedEvents?: FeedbackEvent[];
  totalVolume?: number;
}

function arrow(n: number) {
  if (n > 0) return <span style={{ color: "#16A34A" }}>▲ {n}%</span>;
  if (n < 0) return <span style={{ color: "#DC2626" }}>▼ {Math.abs(n)}%</span>;
  return <span style={{ color: "#64748B" }}>─ 0%</span>;
}

const CARD: React.CSSProperties = {
  background: "white",
  border: "1px solid #E5E7EB",
  borderRadius: 14,
  padding: 24,
};

export default function AmplitudeAgents() {
  const [badge, setBadge] = useState<{
    text: string;
    bg: string;
    border: string;
    hint?: string;
  }>({
    text: "⏳ Checking connection…",
    bg: "rgba(255,255,255,0.12)",
    border: "rgba(255,255,255,0.25)",
  });

  const [running, setRunning] = useState<AgentId | null>(null);
  const [resultAgent, setResultAgent] = useState<AgentId | null>(null);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [replayPicker, setReplayPicker] = useState<AgentResult | null>(null);
  const [replayEvents, setReplayEvents] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const j = await apiGet<StatusResult>("/api/amplitude/status");
      if (cancelled) return;
      if (j.error && j.connected === undefined && !("ok" in j && j.ok)) {
        // transport error normalised by lib/api
        setBadge({
          text: "🔴 Connection check failed",
          bg: "rgba(239,68,68,0.18)",
          border: "rgba(239,68,68,0.4)",
        });
        return;
      }
      if (j.connected === false) {
        setBadge({
          text: "🟡 Amplitude not connected — " + (j.missing || j.message || "check secrets"),
          bg: "rgba(234,179,8,0.18)",
          border: "rgba(234,179,8,0.4)",
        });
      } else if (j.connected === "unknown") {
        setBadge({
          text: "🔴 Network error reaching Amplitude",
          bg: "rgba(239,68,68,0.18)",
          border: "rgba(239,68,68,0.4)",
          hint: j.error,
        });
      } else if (j.dashboardApiAccess === false && j.status === 403) {
        setBadge({
          text: "🟡 Credentials accepted · Dashboard REST API blocked (403)",
          bg: "rgba(234,179,8,0.18)",
          border: "rgba(234,179,8,0.4)",
          hint: "Amplitude returned 403 on the Dashboard API. Requires org-level API Key + Secret (Settings → Projects → Show API Key) on Growth/Enterprise. Project tracking keys cannot read data.",
        });
      } else if (j.dashboardApiAccess === false) {
        setBadge({
          text: "🟡 Amplitude returned " + (j.status || "?"),
          bg: "rgba(234,179,8,0.18)",
          border: "rgba(234,179,8,0.4)",
          hint: j.message,
        });
      } else {
        setBadge({
          text: "🟢 Amplitude Dashboard API connected",
          bg: "rgba(34,197,94,0.18)",
          border: "rgba(34,197,94,0.4)",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function clearOutput() {
    setResult(null);
    setResultAgent(null);
    setReplayPicker(null);
    setErrorMsg(null);
    setLoadingMsg(null);
  }

  async function runAgent(agent: AgentDef) {
    setRunning(agent.id);
    clearOutput();
    setLoadingMsg(
      `${agent.title} is pulling data from Amplitude and asking GPT-4o to analyse it…`,
    );
    const j = await apiPost<AgentResult>(agent.endpoint, {});
    setLoadingMsg(null);
    setRunning(null);
    if (!j.ok) {
      setErrorMsg(j.error || "Request failed");
      return;
    }
    if (j.connected === false) {
      setResult(j);
      setResultAgent(agent.id);
      return;
    }
    if (j.planLimited && agent.id === "replay") {
      setReplayPicker(j);
      return;
    }
    setResult(j);
    setResultAgent(agent.id);
  }

  async function runReplayWithEvents() {
    const events = replayEvents
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (events.length < 2) {
      setErrorMsg("⚠️ Enter at least 2 event names");
      return;
    }
    setReplayPicker(null);
    setErrorMsg(null);
    setLoadingMsg(
      `Building funnel from ${events.length} events and analysing with GPT-4o…`,
    );
    const j = await apiPost<AgentResult>("/api/amplitude/replay-agent", { events });
    setLoadingMsg(null);
    if (!j.ok) {
      setErrorMsg(j.error || "Request failed");
      return;
    }
    setResult(j);
    setResultAgent("replay");
  }

  return (
    <div className="view-header-wrap">
      <div
        className="view-header"
        style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)" }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#BAE6FD" }}>
                <span className="bc-group" style={{ color: "rgba(186,230,253,.8)" }}>
                  Grow
                </span>{" "}
                <span className="bc-sep" style={{ color: "rgba(255,255,255,.3)" }}>
                  ›
                </span>{" "}
                Amplitude AI Agents
              </div>
              <h2 className="view-title">Amplitude AI Agents</h2>
              <p className="view-sub">
                Three on-demand agents that pull live product-analytics data from your
                Amplitude project and turn it into trends, friction hypotheses, and
                customer-feedback themes — all powered by GPT-4o.
              </p>
            </div>
            <div className="vh-actions">
              <span
                title={badge.hint}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 14px",
                  background: badge.bg,
                  border: `1px solid ${badge.border}`,
                  borderRadius: 999,
                  color: "white",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  cursor: badge.hint ? "help" : "default",
                }}
              >
                {badge.text}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
            gap: 20,
          }}
        >
          {AGENTS.map((a) => (
            <div
              key={a.id}
              style={{
                background: "white",
                border: "1px solid #E5E7EB",
                borderRadius: 14,
                padding: 22,
                display: "flex",
                flexDirection: "column",
                gap: 14,
                boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: a.iconBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.15rem",
                    color: a.iconColor,
                  }}
                >
                  {a.icon}
                </div>
                <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#0F172A" }}>
                  {a.title}
                </div>
              </div>
              <div style={{ fontSize: "0.86rem", color: "#475569", lineHeight: 1.5 }}>
                {a.desc}
              </div>
              <div>
                <div
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    color: "#0F172A",
                    marginBottom: 8,
                  }}
                >
                  This agent will
                </div>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {a.bullets.map((b, i) => (
                    <li
                      key={i}
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "flex-start",
                        fontSize: "0.82rem",
                        color: "#475569",
                        lineHeight: 1.45,
                      }}
                    >
                      <span style={{ color: "#0EA5E9", flexShrink: 0 }}>✓</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div style={{ marginTop: "auto", paddingTop: 8 }}>
                <button
                  onClick={() => runAgent(a)}
                  disabled={running === a.id}
                  style={{
                    width: "100%",
                    padding: "11px 14px",
                    background: "white",
                    border: "1px solid #CBD5E1",
                    borderRadius: 9,
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    color: "#0F172A",
                    cursor: running === a.id ? "default" : "pointer",
                    opacity: running === a.id ? 0.7 : 1,
                  }}
                >
                  {running === a.id ? "⏳ Running…" : a.btn}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 28 }}>
          {loadingMsg && (
            <div style={{ ...CARD, textAlign: "center", color: "#475569" }}>
              ⏳ {loadingMsg}
            </div>
          )}

          {errorMsg && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 14,
                padding: 20,
                color: "#991B1B",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠️ Request failed</div>
              <div style={{ fontSize: "0.85rem" }}>{errorMsg}</div>
            </div>
          )}

          {replayPicker && (
            <ReplayPicker
              data={replayPicker}
              events={replayEvents}
              onChange={setReplayEvents}
              onRun={runReplayWithEvents}
            />
          )}

          {result && resultAgent && <ResultView agentId={resultAgent} j={result} />}
        </div>
      </div>
    </div>
  );
}

function ReplayPicker({
  data,
  events,
  onChange,
  onRun,
}: {
  data: AgentResult;
  events: string;
  onChange: (v: string) => void;
  onRun: () => void;
}) {
  return (
    <div style={CARD}>
      <div
        style={{
          background: "#FFFBEB",
          border: "1px solid #FDE68A",
          borderRadius: 8,
          padding: 14,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            fontSize: "0.9rem",
            fontWeight: 700,
            color: "#92400E",
            marginBottom: 6,
          }}
        >
          🔒 Auto-discovery unavailable on this Amplitude plan
        </div>
        <div style={{ fontSize: "0.82rem", color: "#78350F", lineHeight: 1.55 }}>
          {data.message}
        </div>
      </div>
      <div
        style={{ fontSize: "0.92rem", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}
      >
        Specify your funnel manually
      </div>
      <div style={{ fontSize: "0.82rem", color: "#64748B", marginBottom: 12 }}>
        Enter 2–6 event names from your Amplitude project, in funnel order, separated by
        commas.
      </div>
      <input
        type="text"
        value={events}
        onChange={(e) => onChange(e.target.value)}
        placeholder="sign_up, onboarding_complete, first_value, upgrade"
        style={{
          width: "100%",
          padding: "11px 14px",
          border: "1px solid #CBD5E1",
          borderRadius: 8,
          fontSize: "0.88rem",
          fontFamily: "inherit",
          marginBottom: 12,
        }}
      />
      <button
        onClick={onRun}
        style={{
          padding: "11px 20px",
          background: "#0EA5E9",
          color: "white",
          border: "none",
          borderRadius: 8,
          fontSize: "0.85rem",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Build funnel &amp; run agent
      </button>
    </div>
  );
}

function ResultView({ agentId, j }: { agentId: AgentId; j: AgentResult }) {
  if (j.connected === false) return <NotConnected j={j} />;
  if (j.planLimited && j.error) {
    return (
      <div
        style={{
          background: "#FFFBEB",
          border: "1px solid #FDE68A",
          borderRadius: 14,
          padding: 20,
        }}
      >
        <div style={{ fontWeight: 700, color: "#92400E", marginBottom: 6 }}>
          🔒 Amplitude plan limit reached
        </div>
        <div style={{ fontSize: "0.85rem", color: "#78350F", lineHeight: 1.55 }}>
          {j.message}
        </div>
      </div>
    );
  }
  if (j.error) {
    return (
      <div
        style={{
          background: "#FEF2F2",
          border: "1px solid #FECACA",
          borderRadius: 14,
          padding: 20,
          color: "#991B1B",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠️ Agent could not run</div>
        <div style={{ fontSize: "0.85rem" }}>{j.message || j.error}</div>
      </div>
    );
  }
  if (agentId === "dashboard") return <DashboardResult j={j} />;
  if (agentId === "replay") return <ReplayResult j={j} />;
  return <FeedbackResult j={j} />;
}

function NotConnected({ j }: { j: AgentResult }) {
  return (
    <div
      style={{
        background: "#FFFBEB",
        border: "1px solid #FDE68A",
        borderRadius: 14,
        padding: 22,
      }}
    >
      <div
        style={{ fontSize: "1rem", fontWeight: 700, color: "#92400E", marginBottom: 8 }}
      >
        🔌 Amplitude not fully connected
      </div>
      <div
        style={{
          fontSize: "0.88rem",
          color: "#78350F",
          lineHeight: 1.55,
          marginBottom: 14,
        }}
      >
        {j.note || ""}
      </div>
      <div style={{ fontSize: "0.8rem", color: "#78350F" }}>
        <strong>Missing secret:</strong>{" "}
        <code style={{ background: "#FEF3C7", padding: "2px 6px", borderRadius: 4 }}>
          {j.missing || "unknown"}
        </code>
      </div>
      <div style={{ marginTop: 12, fontSize: "0.78rem", color: "#92400E" }}>
        Add it in Replit Secrets, then refresh this page.
      </div>
    </div>
  );
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode;
  subtitle: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={CARD}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div>
          <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#0F172A" }}>
            {title}
          </div>
          <div style={{ fontSize: "0.82rem", color: "#64748B", marginTop: 4 }}>
            {subtitle}
          </div>
        </div>
        <div style={{ fontSize: "0.72rem", color: "#94A3B8" }}>
          Generated {new Date().toLocaleString()}
        </div>
      </div>
      {children}
    </div>
  );
}

function Summary({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div
      style={{
        background: "#F0F9FF",
        borderLeft: "3px solid #0EA5E9",
        padding: "12px 14px",
        borderRadius: 8,
        fontSize: "0.88rem",
        color: "#0C4A6E",
        lineHeight: 1.55,
        marginBottom: 18,
      }}
    >
      {text}
    </div>
  );
}

const TH: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "right",
  fontSize: "0.74rem",
  fontWeight: 700,
  color: "#475569",
  textTransform: "uppercase",
};
const TH_LEFT: React.CSSProperties = { ...TH, textAlign: "left" };
const TD: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: "0.82rem",
  color: "#475569",
  textAlign: "right",
};
const TD_NAME: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: "0.82rem",
  color: "#0F172A",
  fontWeight: 600,
};

function DashboardResult({ j }: { j: AgentResult }) {
  const t = j.totals || {};
  const trends = j.insights?.trends || [];
  const anomalies = j.insights?.anomalies || [];
  const hyp = j.insights?.hypotheses || [];
  return (
    <Shell
      title="📊 Dashboard Agent — Results"
      subtitle={
        <>
          Top {t.events || 0} events · last 14 days · last 7d vs prior 7d (
          {arrow(t.wowPct || 0)})
        </>
      }
    >
      {j.planLimited && (
        <div
          style={{
            background: "#FEFCE8",
            border: "1px solid #FDE68A",
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 14,
            fontSize: "0.78rem",
            color: "#92400E",
          }}
        >
          🔒 <strong>Plan-limited mode:</strong>{" "}
          {j.planNote || "Falling back to sessions API."}
        </div>
      )}
      <Summary text={j.insights?.summary} />
      <div style={{ overflowX: "auto", marginBottom: 22 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F8FAFC" }}>
              <th style={TH_LEFT}>Event</th>
              <th style={TH}>Total 14d</th>
              <th style={TH}>Last 7d</th>
              <th style={TH}>Prev 7d</th>
              <th style={TH}>WoW Δ</th>
            </tr>
          </thead>
          <tbody>
            {(j.events || []).map((e, i) => (
              <tr key={i}>
                <td style={TD_NAME}>{e.event}</td>
                <td style={TD}>{(e.total || 0).toLocaleString()}</td>
                <td style={TD}>{(e.last7 || 0).toLocaleString()}</td>
                <td style={TD}>{(e.prev7 || 0).toLocaleString()}</td>
                <td style={{ ...TD }}>{arrow(e.wowPct || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 18,
        }}
      >
        <div>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#0F172A",
              marginBottom: 10,
            }}
          >
            📈 Trends
          </div>
          {trends.length ? (
            trends.map((tr, i) => (
              <div
                key={i}
                style={{
                  background: "#F8FAFC",
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 4,
                  }}
                >
                  <div style={{ fontSize: "0.84rem", fontWeight: 700, color: "#0F172A" }}>
                    {tr.event}
                  </div>
                  <div style={{ fontSize: "0.78rem" }}>{arrow(tr.wowPct || 0)}</div>
                </div>
                <div style={{ fontSize: "0.8rem", color: "#475569", lineHeight: 1.5 }}>
                  {tr.note || ""}
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: "#94A3B8", fontSize: "0.84rem" }}>No notable trends.</div>
          )}
        </div>
        <div>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#0F172A",
              marginBottom: 10,
            }}
          >
            ⚠️ Anomalies
          </div>
          {anomalies.length ? (
            anomalies.map((a, i) => {
              const sev =
                a.severity === "high"
                  ? "#DC2626"
                  : a.severity === "medium"
                    ? "#D97706"
                    : "#0EA5E9";
              return (
                <div
                  key={i}
                  style={{
                    background: "white",
                    borderLeft: `3px solid ${sev}`,
                    border: "1px solid #E2E8F0",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{ fontSize: "0.84rem", fontWeight: 700, color: "#0F172A" }}
                    >
                      {a.event}
                    </div>
                    <div
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: sev,
                        textTransform: "uppercase",
                      }}
                    >
                      {a.severity || "low"}
                    </div>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#475569", lineHeight: 1.5 }}>
                    {a.note || ""}
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ color: "#94A3B8", fontSize: "0.84rem" }}>
              No anomalies detected.
            </div>
          )}
        </div>
      </div>
      {hyp.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#0F172A",
              marginBottom: 10,
            }}
          >
            💡 Root-Cause Hypotheses
          </div>
          {hyp.map((h, i) => (
            <div
              key={i}
              style={{
                background: "#FEFCE8",
                border: "1px solid #FDE68A",
                borderRadius: 8,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: "0.86rem",
                  fontWeight: 700,
                  color: "#713F12",
                  marginBottom: 4,
                }}
              >
                💡 {h.title}
              </div>
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "#78350F",
                  lineHeight: 1.5,
                  marginBottom: 6,
                }}
              >
                {h.reasoning || ""}
              </div>
              <div style={{ fontSize: "0.78rem", color: "#92400E" }}>
                <strong>Test:</strong> {h.test || ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

function ReplayResult({ j }: { j: AgentResult }) {
  const worstIdx =
    j.worst && typeof j.worst.stepIndex === "number" ? j.worst.stepIndex : -1;
  const steps = j.steps || [];
  const hyps = j.insights?.frictionHypotheses || [];
  const playlists = j.insights?.playlistIdeas || [];
  return (
    <Shell
      title="▶️ Session Replay Agent — Results"
      subtitle={
        <>
          Funnel of {steps.length} steps · last {j.windowDays}d · {j.overallConversion}%
          end-to-end conversion
        </>
      }
    >
      <Summary text={j.insights?.summary} />
      {j.worst && (
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 8,
            padding: 14,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#991B1B",
              marginBottom: 4,
            }}
          >
            🚨 Biggest drop-off: <code>{j.worst.event}</code> ({j.worst.dropPct}% loss)
          </div>
          <div style={{ fontSize: "0.82rem", color: "#7F1D1D" }}>
            {j.insights?.biggestDropOff?.interpretation || ""}
          </div>
        </div>
      )}
      <div style={{ marginBottom: 22 }}>
        <div
          style={{
            fontSize: "0.85rem",
            fontWeight: 700,
            color: "#0F172A",
            marginBottom: 10,
          }}
        >
          🔻 Funnel
        </div>
        {steps.map((s, i) => {
          const isWorst = s.stepIndex === worstIdx;
          const drop = s.dropPct || 0;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                background: isWorst ? "#FEF2F2" : "#F8FAFC",
                border: `1px solid ${isWorst ? "#FECACA" : "#E2E8F0"}`,
                borderRadius: 8,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: isWorst ? "#DC2626" : "#0EA5E9",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.86rem", fontWeight: 700, color: "#0F172A" }}>
                  {s.event}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
                  {(s.users || 0).toLocaleString()} users
                </div>
              </div>
              {i > 0 && (
                <div
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    color: drop >= 30 ? "#DC2626" : drop >= 10 ? "#D97706" : "#16A34A",
                  }}
                >
                  {drop}% drop
                </div>
              )}
            </div>
          );
        })}
      </div>
      {hyps.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#0F172A",
              marginBottom: 10,
            }}
          >
            💡 Friction Hypotheses
          </div>
          {hyps.map((h, i) => (
            <div
              key={i}
              style={{
                background: "#FFFBEB",
                border: "1px solid #FDE68A",
                borderRadius: 8,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: "0.86rem",
                  fontWeight: 700,
                  color: "#713F12",
                  marginBottom: 4,
                }}
              >
                💡 {h.hypothesis}
              </div>
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "#78350F",
                  lineHeight: 1.5,
                  marginBottom: 6,
                }}
              >
                {h.evidence || ""}
              </div>
              <div style={{ fontSize: "0.78rem", color: "#92400E" }}>
                <strong>Replay query:</strong> <em>{h.replayQuery || ""}</em>
              </div>
            </div>
          ))}
        </div>
      )}
      {playlists.length > 0 && (
        <div>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#0F172A",
              marginBottom: 10,
            }}
          >
            📼 Suggested Replay Playlists
          </div>
          {playlists.map((p, i) => (
            <div
              key={i}
              style={{
                background: "white",
                border: "1px solid #E2E8F0",
                borderRadius: 8,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: "0.86rem",
                  fontWeight: 700,
                  color: "#0F172A",
                  marginBottom: 4,
                }}
              >
                ▶ {p.name}
              </div>
              <div style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: 6 }}>
                <strong>Filter:</strong> {p.filter || ""}
              </div>
              <div style={{ fontSize: "0.8rem", color: "#475569", lineHeight: 1.5 }}>
                {p.whyItMatters || ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

function FeedbackResult({ j }: { j: AgentResult }) {
  const sevColor = (s?: string) =>
    s === "high" ? "#DC2626" : s === "medium" ? "#D97706" : "#0EA5E9";
  const matched = j.matchedEvents || [];
  const requests = j.insights?.requests || [];
  const bugs = j.insights?.bugs || [];
  const praises = j.insights?.praises || [];
  const recs = j.insights?.recommendations || [];

  const renderCards = (items: FeedbackItem[], color: string) =>
    items.length ? (
      items.map((item, i) => (
        <div
          key={i}
          style={{
            background: "white",
            borderLeft: `3px solid ${color}`,
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            padding: 12,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 4,
            }}
          >
            <div style={{ fontSize: "0.86rem", fontWeight: 700, color: "#0F172A" }}>
              {item.title}
            </div>
            {item.severity ? (
              <div
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: sevColor(item.severity),
                  textTransform: "uppercase",
                }}
              >
                {item.severity}
              </div>
            ) : item.volume ? (
              <div
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: sevColor(item.volume),
                  textTransform: "uppercase",
                }}
              >
                {item.volume}
              </div>
            ) : null}
          </div>
          <div style={{ fontSize: "0.8rem", color: "#475569", lineHeight: 1.5 }}>
            {item.rationale || ""}
          </div>
        </div>
      ))
    ) : (
      <div style={{ color: "#94A3B8", fontSize: "0.84rem" }}>None.</div>
    );

  return (
    <Shell
      title="💬 Customer Feedback Agent — Results"
      subtitle={
        <>
          {matched.length} feedback-shaped events ·{" "}
          {(j.totalVolume || 0).toLocaleString()} total events in last {j.windowDays}d
        </>
      }
    >
      <Summary text={j.insights?.summary} />
      {matched.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 22 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                <th style={TH_LEFT}>Matched Event</th>
                <th style={TH}>30d Volume</th>
              </tr>
            </thead>
            <tbody>
              {matched.map((e, i) => (
                <tr key={i}>
                  <td style={TD_NAME}>{e.event}</td>
                  <td style={TD}>{(e.volume30d || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          gap: 18,
          marginBottom: 22,
        }}
      >
        <div>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#0F172A",
              marginBottom: 10,
            }}
          >
            📥 Top Requests
          </div>
          {renderCards(requests, "#0EA5E9")}
        </div>
        <div>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#0F172A",
              marginBottom: 10,
            }}
          >
            🐛 Bugs / Complaints
          </div>
          {renderCards(bugs, "#DC2626")}
        </div>
        <div>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#0F172A",
              marginBottom: 10,
            }}
          >
            🌟 Praises
          </div>
          {renderCards(praises, "#16A34A")}
        </div>
      </div>
      {recs.length > 0 && (
        <div>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#0F172A",
              marginBottom: 10,
            }}
          >
            🚀 Recommendations
          </div>
          {recs.map((r, i) => (
            <div
              key={i}
              style={{
                background: "#FEFCE8",
                border: "1px solid #FDE68A",
                borderRadius: 8,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 4,
                }}
              >
                <div style={{ fontSize: "0.86rem", fontWeight: 700, color: "#713F12" }}>
                  🚀 {r.title}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#92400E" }}>
                  Impact: {r.impact} · Effort: {r.effort}
                </div>
              </div>
              <div style={{ fontSize: "0.8rem", color: "#78350F" }}>
                <strong>Next step:</strong> {r.next_step || ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

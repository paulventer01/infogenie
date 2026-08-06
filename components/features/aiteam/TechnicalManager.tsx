"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

type Severity = "critical" | "high" | "medium" | "low" | "info";

type TechEvent = {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  surface: string;
  recommendation: string;
  at: string;
};

type PlanStep = {
  id: string;
  order: number;
  action: string;
  owner: string;
  risk: string;
  requiresApproval: boolean;
};

type TechPlan = {
  id: string;
  title: string;
  severity: Severity;
  summary: string;
  steps: PlanStep[];
  status: string;
  createdAt: string;
};

type TechScan = {
  ok: boolean;
  overallStatus: Severity;
  scannedAt: string;
  nextAutoRefreshSec: number;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    events: number;
    integrations: number;
    toolingGaps: number;
    awaitingApproval: number;
  };
  systems: {
    postgres: { ok: boolean; detail: string };
    auth: { ok: boolean; detail: string; activeSessions: number };
    llm: { ok: boolean; detail: string; providers: string[] };
    vault: { ok: boolean; detail: string };
    tokens: { ok: boolean; detail: string; recentFailures: number };
  };
  events: TechEvent[];
  plan: TechPlan | null;
  meetingNote: string;
  roster: { id: string; name: string; role: string; status: string } | null;
};

const SEV_COLOR: Record<Severity, string> = {
  critical: "#DC2626",
  high: "#EA580C",
  medium: "#CA8A04",
  low: "#2563EB",
  info: "#64748B",
};

const SEV_BG: Record<Severity, string> = {
  critical: "#FEF2F2",
  high: "#FFF7ED",
  medium: "#FEFCE8",
  low: "#EFF6FF",
  info: "#F8FAFC",
};

function formatTime(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

export default function TechnicalManager() {
  const [scan, setScan] = useState<TechScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<Severity | "all">("all");
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);

  const load = useCallback(async (force = false) => {
    setError("");
    try {
      const path = force ? "/api/technical-manager/scan?force=1" : "/api/technical-manager/scan";
      const data = await api<TechScan>(path);
      setScan(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load Technical Manager status");
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const t = window.setInterval(() => load(false), 30000);
    return () => window.clearInterval(t);
  }, [load]);

  const criticalEvents = useMemo(
    () => (scan?.events || []).filter((e) => e.severity === "critical"),
    [scan]
  );
  const highEvents = useMemo(
    () => (scan?.events || []).filter((e) => e.severity === "high"),
    [scan]
  );

  const visibleEvents = useMemo(() => {
    const events = scan?.events || [];
    if (filterSeverity === "all") return events;
    return events.filter((e) => e.severity === filterSeverity);
  }, [scan, filterSeverity]);

  function openStatusIssues(severity: Severity | "all" = "all") {
    setFilterSeverity(severity);
    setStatusPanelOpen(true);
    window.requestAnimationFrame(() => {
      document.getElementById("tm-status-issues")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (loading && !scan) {
    return <div style={{ padding: 24, color: "var(--fg-muted)" }}>Technical Manager is scanning the platform…</div>;
  }

  const overall = (scan?.overallStatus || "info") as Severity;
  const s = scan?.summary;
  const statusLabel = overall.toUpperCase();

  return (
    <div style={{ padding: "20px 24px 48px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Hero uses .tm-tech-hero — theme-v2 forces dark ink on #ig-react-panel h1/p */}
      <div className="tm-tech-hero">
        <div className="tm-tech-hero__copy">
          <div className="tm-tech-hero__eyebrow">Technical Manager · Senior role</div>
          <h1 className="tm-tech-hero__title">Entire-system monitor</h1>
          <p className="tm-tech-hero__body">
            Watches every API, LLM, AI connection, auth session, token, security surface, menu and code path.
            Reports every event — however small — and prepares approval-gated plans when anything breaks.
            Attends daily management meetings with live status.
          </p>
        </div>

        <div className="tm-tech-hero__status">
          <div className="tm-tech-hero__status-label">Live status</div>
          <button
            type="button"
            className="tm-tech-hero__status-btn"
            onClick={() => openStatusIssues(overall === "info" || overall === "low" ? "all" : overall)}
            title="Click to view issues for this status"
            style={{ borderColor: SEV_COLOR[overall], color: SEV_COLOR[overall] }}
          >
            {statusLabel}
            <span className="tm-tech-hero__status-caret">▾</span>
          </button>
          <div className="tm-tech-hero__meta">
            Updated {formatTime(scan?.scannedAt)} · auto {scan?.nextAutoRefreshSec || 30}s
          </div>
          <div className="tm-tech-hero__hint">Click status to view issues</div>
        </div>
      </div>

      {error ? (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 12px",
            borderRadius: 10,
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            color: "#991B1B",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Clickable severity summary */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 10,
          marginBottom: 14,
        }}
      >
        {[
          { label: "Overall", value: statusLabel, color: SEV_COLOR[overall], onClick: () => openStatusIssues(overall === "info" || overall === "low" ? "all" : overall) },
          { label: "Critical", value: s?.critical ?? 0, color: SEV_COLOR.critical, onClick: () => openStatusIssues("critical") },
          { label: "High", value: s?.high ?? 0, color: SEV_COLOR.high, onClick: () => openStatusIssues("high") },
          { label: "Events", value: s?.events ?? 0, color: "var(--fg)", onClick: () => openStatusIssues("all") },
          { label: "Integrations", value: s?.integrations ?? 0, color: "var(--fg)", onClick: undefined },
          { label: "Tooling gaps", value: s?.toolingGaps ?? 0, color: SEV_COLOR.high, onClick: () => openStatusIssues("high") },
        ].map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            disabled={!card.onClick}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "12px 14px",
              background: "var(--bg-elevated)",
              textAlign: "left",
              cursor: card.onClick ? "pointer" : "default",
              opacity: card.onClick ? 1 : 0.85,
            }}
          >
            <div style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {card.label}
            </div>
            <div style={{ marginTop: 4, fontSize: 22, fontWeight: 800, color: card.color }}>{card.value}</div>
          </button>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {[
          { label: "Awaiting approval", value: s?.awaitingApproval ?? 0, ok: (s?.awaitingApproval || 0) === 0 },
          { label: "Postgres", value: scan?.systems.postgres.ok ? "OK" : "DOWN", ok: !!scan?.systems.postgres.ok },
          { label: "LLM", value: scan?.systems.llm.ok ? "OK" : "RISK", ok: !!scan?.systems.llm.ok },
          { label: "Vault", value: scan?.systems.vault.ok ? "OK" : "OFF", ok: !!scan?.systems.vault.ok },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "12px 14px",
              background: card.ok ? "var(--bg-elevated)" : "#FEF2F2",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 700, textTransform: "uppercase" }}>{card.label}</div>
            <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: card.ok ? "var(--fg)" : "#DC2626" }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            load(true);
          }}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 700,
            cursor: busy ? "wait" : "pointer",
            fontSize: 13,
          }}
        >
          {busy ? "Scanning…" : "Refresh scan now"}
        </button>
        <a href="#/manage/capacity" style={linkBtn}>Open Team Capacity roster ✓</a>
        <a href="#/ai-team/meetings" style={linkBtn}>AI Team meetings</a>
        <a href="#/ai-team/providers" style={linkBtn}>AI Providers</a>
        <a href="#/ai-team/governance" style={linkBtn}>AI Governance</a>
      </div>

      {scan?.meetingNote ? (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #A7F3D0",
            background: "#ECFDF5",
            color: "#065F46",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>Daily management meetings:</strong> {scan.meetingNote}
        </div>
      ) : null}

      {/* Status issues panel — opened by CRITICAL / severity clicks */}
      {statusPanelOpen ? (
        <div
          id="tm-status-issues"
          style={{
            marginBottom: 16,
            borderRadius: 14,
            border: `2px solid ${SEV_COLOR[overall]}`,
            background: SEV_BG[overall],
            padding: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: SEV_COLOR[overall] }}>
                Status detail · {statusLabel}
              </div>
              <h2 style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 800, color: "var(--fg)" }}>
                {criticalEvents.length + highEvents.length > 0
                  ? `${criticalEvents.length} critical · ${highEvents.length} high`
                  : "No critical or high issues right now"}
              </h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.45 }}>
                Click a severity chip to filter the live event stream below. Plans that need approval stay gated until a human confirms.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStatusPanelOpen(false)}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-elevated)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--fg)",
              }}
            >
              Close
            </button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {(["all", "critical", "high", "medium", "low", "info"] as const).map((sev) => {
              const active = filterSeverity === sev;
              const count =
                sev === "all"
                  ? scan?.events?.length || 0
                  : (scan?.events || []).filter((e) => e.severity === sev).length;
              const color = sev === "all" ? "var(--fg)" : SEV_COLOR[sev];
              return (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setFilterSeverity(sev)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: active ? `2px solid ${color}` : "1px solid var(--border)",
                    background: active ? "#fff" : "var(--bg-elevated)",
                    color,
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {sev} · {count}
                </button>
              );
            })}
          </div>

          {criticalEvents.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: SEV_COLOR.critical, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Critical issues
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {criticalEvents.map((ev) => (
                  <div
                    key={ev.id}
                    style={{
                      border: "1px solid #FECACA",
                      borderRadius: 10,
                      padding: "12px 14px",
                      background: "#fff",
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 14, color: "#991B1B" }}>{ev.title}</div>
                    <div style={{ marginTop: 4, fontSize: 13, color: "var(--fg)", lineHeight: 1.45 }}>{ev.detail}</div>
                    <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-muted)" }}>
                      {ev.surface} · {ev.category}
                    </div>
                    {ev.recommendation ? (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#065F46", fontWeight: 600 }}>
                        Fix: {ev.recommendation}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {highEvents.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: SEV_COLOR.high, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                High issues
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {highEvents.map((ev) => (
                  <div
                    key={ev.id}
                    style={{
                      border: "1px solid #FED7AA",
                      borderRadius: 10,
                      padding: "12px 14px",
                      background: "#fff",
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 14, color: "#9A3412" }}>{ev.title}</div>
                    <div style={{ marginTop: 4, fontSize: 13, color: "var(--fg)", lineHeight: 1.45 }}>{ev.detail}</div>
                    {ev.recommendation ? (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#065F46", fontWeight: 600 }}>
                        Fix: {ev.recommendation}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)", gap: 14 }}>
        <section style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <h2 style={h2}>
              Live event stream
              {filterSeverity !== "all" ? (
                <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: SEV_COLOR[filterSeverity] }}>
                  · {filterSeverity}
                </span>
              ) : null}
            </h2>
            {filterSeverity !== "all" ? (
              <button
                type="button"
                onClick={() => setFilterSeverity("all")}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--accent)",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Clear filter
              </button>
            ) : null}
          </div>
          <p style={muted}>Every detected event, including small ones. Newest first.</p>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {visibleEvents.length ? (
              visibleEvents.map((ev) => (
                <article
                  key={ev.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: SEV_BG[ev.severity] || "var(--bg-elevated)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: SEV_COLOR[ev.severity] }}>
                      {ev.severity} · {ev.category}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--fg-muted)" }}>{formatTime(ev.at)}</div>
                  </div>
                  <div style={{ marginTop: 4, fontWeight: 700, fontSize: 14, color: "var(--fg)" }}>{ev.title}</div>
                  <div style={{ marginTop: 4, fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.45 }}>{ev.detail}</div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-muted)" }}>
                    Surface: <strong style={{ color: "var(--fg)" }}>{ev.surface}</strong>
                  </div>
                  {ev.recommendation ? (
                    <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg)" }}>
                      Recommended: {ev.recommendation}
                    </div>
                  ) : null}
                </article>
              ))
            ) : (
              <div style={{ padding: 16, color: "var(--fg-muted)", fontSize: 13 }}>
                {filterSeverity === "all" ? "No events in this scan window." : `No ${filterSeverity} events in this scan.`}
              </div>
            )}
          </div>
        </section>

        <section style={panel}>
          <h2 style={h2}>Plan of action (approval-gated)</h2>
          {scan?.plan ? (
            <>
              <div style={{ marginTop: 8, fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: SEV_COLOR[scan.plan.severity] }}>
                {scan.plan.status} · {scan.plan.severity}
              </div>
              <div style={{ marginTop: 4, fontWeight: 800, fontSize: 16, color: "var(--fg)" }}>{scan.plan.title}</div>
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.5 }}>{scan.plan.summary}</p>
              <ol style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 10 }}>
                {scan.plan.steps.map((step) => (
                  <li key={step.id} style={{ fontSize: 13, color: "var(--fg)", lineHeight: 1.45 }}>
                    <div style={{ fontWeight: 700 }}>{step.action}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2 }}>
                      Owner: {step.owner} · Risk: {step.risk}
                      {step.requiresApproval ? " · requires human approval" : ""}
                    </div>
                  </li>
                ))}
              </ol>
              <div
                style={{
                  marginTop: 14,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "#FFFBEB",
                  border: "1px solid #FDE68A",
                  fontSize: 12,
                  color: "#92400E",
                  lineHeight: 1.45,
                }}
              >
                No remediation step executes automatically. Approve in AI Governance / Operations after reviewing blast radius.
              </div>
            </>
          ) : (
            <p style={{ marginTop: 10, fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.5 }}>
              No approval-gated plan required. Platform is within normal operating bounds for this scan.
            </p>
          )}

          <h3 style={{ ...h2, marginTop: 22, fontSize: 14 }}>Subsystem detail</h3>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {[
              ["Postgres", scan?.systems.postgres.detail],
              ["Auth / sessions", scan?.systems.auth.detail],
              ["LLM providers", scan?.systems.llm.detail],
              ["Credential vault", scan?.systems.vault.detail],
              ["Tokens / keys", scan?.systems.tokens.detail],
            ].map(([label, detail]) => (
              <div key={String(label)} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--fg)" }}>{label}</div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2, lineHeight: 1.4 }}>{detail || "—"}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const panel: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 16,
  background: "var(--bg-elevated)",
};

const h2: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 800,
  color: "var(--fg)",
};

const muted: React.CSSProperties = {
  margin: "6px 0 0",
  fontSize: 13,
  color: "var(--fg-muted)",
  lineHeight: 1.45,
};

const linkBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  color: "var(--fg)",
  fontWeight: 600,
  fontSize: 13,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

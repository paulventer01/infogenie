"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

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
    surfacesMonitored: number;
    surfacesOk: boolean;
  };
  systems: {
    postgres: { ok: boolean; detail: string };
    auth: { ok: boolean; detail: string; activeSessions: number };
    llm: { ok: boolean; detail: string; providers: string[] };
    vault: { ok: boolean; detail: string };
    tokens: { ok: boolean; detail: string; recentFailures: number };
    surfaces: { ok: boolean; detail: string };
  };
  surfaces: Snapshot["surfaces"] | null;
  opsTooling: Snapshot["ops_tooling"] | null;
  events: TechEvent[];
  plan: TechPlan | null;
  meetingNote: string;
  roster: { id: string; name: string; role: string; status: string } | null;
};

type SnapshotEvent = {
  id: string;
  severity: Severity;
  area: string;
  message: string;
  action?: string | null;
  at: string;
};

type SnapshotPlan = {
  step: number;
  severity: Severity;
  area: string;
  problem: string;
  action: string;
  approval_required: boolean;
  status: string;
};

type Snapshot = {
  ok?: boolean;
  overall: "healthy" | "watch" | "degraded" | "critical" | string;
  generated_at: string;
  postgres?: { ok?: boolean; configured?: boolean; error?: string; ts?: string };
  auth?: { session_secret?: boolean; credential_encryption?: boolean; preview_auth?: boolean };
  llm?: {
    openai_configured?: boolean;
    openai_dummy?: boolean;
    provider_count?: number;
    perplexity?: boolean;
    anthropic?: boolean;
  };
  security?: { vault_enabled?: boolean; permission_enforcement?: boolean };
  integrations?: { configured?: string[]; missing_recommended?: string[] };
  tooling_gaps?: Array<{ need: string; suggestion: string; urgency: string }>;
  events?: SnapshotEvent[];
  plan_of_action?: SnapshotPlan[];
  meeting_note?: string;
  counts?: {
    events?: number;
    critical?: number;
    high?: number;
    integrations_configured?: number;
    tooling_gaps?: number;
    actions_pending_approval?: number;
    surfaces_monitored?: number;
    surfaces_ok?: boolean;
    pages_missing_registry?: number;
    api_probes_failed?: number;
    ops_stack_configured?: number;
    ops_stack_total?: number;
    synthetics_failed?: number;
    llm_cost_usd_24h?: number | null;
  };
  surfaces?: {
    ok?: boolean;
    note?: string;
    counts?: {
      nav_views?: number;
      migrated_views?: number;
      registry_loaders?: number;
      surfaces_monitored?: number;
      missing_registry?: number;
      missing_components?: number;
      api_probes_failed?: number;
    };
    missing_registry?: string[];
    missing_components?: string[];
    probes?: Array<{ path: string; ok: boolean; status: number; ms?: number; error?: string }>;
  };
  ops_tooling?: {
    ok?: boolean;
    overall?: string;
    ship_order?: string[];
    deferred?: string[];
    stack?: Array<{
      id: string;
      name: string;
      order: number;
      configured: boolean;
      ok: boolean;
      summary: string;
      detail?: Record<string, unknown>;
    }>;
    synthetics?: {
      provider?: string;
      ok?: boolean;
      checks?: Array<{ id: string; name: string; path?: string; ok: boolean; status?: number; ms?: number; error?: string | null }>;
      counts?: { total?: number; failed?: number; critical_failed?: number };
      note?: string;
    };
    finops?: {
      metrics?: { cost_usd?: number; calls?: number; error_rate?: number; latency_p95_ms?: number | null };
      alerts?: Array<{ severity: string; message: string }>;
    };
  };
};

type ScanResponse = {
  ok: boolean;
  error?: string;
  snapshot?: Snapshot;
  generatedAt?: string;
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

const ACTION_LINKS: Array<{
  id: string;
  label: string;
  view: string;
  blurb: string;
}> = [
  {
    id: "capacity",
    label: "Open Team Capacity roster ✓",
    view: "capacity",
    blurb: "Team Capacity & Workload — roster hours, skills, and Technical Manager assignment.",
  },
  {
    id: "meetings",
    label: "AI Team meetings",
    view: "team-meetings",
    blurb: "Minutes of Meeting — schedule officer meetings and download AI-drafted minutes.",
  },
  {
    id: "providers",
    label: "AI Providers",
    view: "ai-providers",
    blurb: "AI Providers — bring-your-own LLM keys, active models, and connection tests.",
  },
  {
    id: "governance",
    label: "AI Governance",
    view: "ai-governance",
    blurb: "AI Governance Hub — shadow-first audit trail, policy controls, and approval gates.",
  },
];

function mapOverall(overall?: string): Severity {
  switch (overall) {
    case "critical":
      return "critical";
    case "degraded":
      return "high";
    case "watch":
      return "medium";
    case "healthy":
      return "info";
    default:
      return "info";
  }
}

function snapshotToScan(snap: Snapshot): TechScan {
  const events: TechEvent[] = (snap.events || []).map((e) => {
    const [title, ...rest] = String(e.message || "").split(" — ");
    return {
      id: e.id,
      severity: e.severity,
      category: e.area,
      title: title || e.area,
      detail: rest.join(" — ") || e.message,
      surface: e.area,
      recommendation: e.action || "",
      at: e.at,
    };
  });

  const medium = events.filter((e) => e.severity === "medium").length;
  const low = events.filter((e) => e.severity === "low").length;
  const info = events.filter((e) => e.severity === "info").length;
  const counts = snap.counts || {};
  const planSteps = snap.plan_of_action || [];
  const topSev = (planSteps[0]?.severity || mapOverall(snap.overall)) as Severity;

  const plan: TechPlan | null = planSteps.length
    ? {
        id: "tm-plan",
        title: "Remediation plan awaiting approval",
        severity: topSev === "critical" || topSev === "high" ? topSev : "high",
        summary: `${planSteps.length} step(s) prepared from live scan events. No remediation runs until a human approves.`,
        steps: planSteps.map((p) => ({
          id: `step-${p.step}`,
          order: p.step,
          action: `${p.action}${p.problem ? ` — ${p.problem}` : ""}`,
          owner: "Technical Manager + human approver",
          risk: p.severity,
          requiresApproval: !!p.approval_required,
        })),
        status: planSteps[0]?.status || "pending_approval",
        createdAt: snap.generated_at,
      }
    : null;

  const pgOk = !!snap.postgres?.ok;
  const llmOk = !!(snap.llm?.openai_configured && !snap.llm?.openai_dummy);
  const vaultOk = !!(snap.auth?.credential_encryption || snap.security?.vault_enabled);
  const authOk = !!snap.auth?.session_secret;

  return {
    ok: true,
    overallStatus: mapOverall(snap.overall),
    scannedAt: snap.generated_at,
    nextAutoRefreshSec: 30,
    summary: {
      critical: counts.critical ?? events.filter((e) => e.severity === "critical").length,
      high: counts.high ?? events.filter((e) => e.severity === "high").length,
      medium,
      low,
      info,
      events: counts.events ?? events.length,
      integrations: counts.integrations_configured ?? snap.integrations?.configured?.length ?? 0,
      toolingGaps: counts.tooling_gaps ?? snap.tooling_gaps?.length ?? 0,
      awaitingApproval: counts.actions_pending_approval ?? planSteps.filter((p) => p.approval_required).length,
      surfacesMonitored: counts.surfaces_monitored ?? snap.surfaces?.counts?.surfaces_monitored ?? 0,
      surfacesOk: counts.surfaces_ok ?? !!snap.surfaces?.ok,
    },
    systems: {
      postgres: {
        ok: pgOk,
        detail: pgOk
          ? "Postgres health probe succeeded."
          : snap.postgres?.error || (snap.postgres?.configured ? "Postgres unreachable." : "DATABASE_URL is not configured."),
      },
      auth: {
        ok: authOk,
        detail: authOk ? "SESSION_SECRET is set." : "SESSION_SECRET missing — sessions are insecure.",
        activeSessions: 0,
      },
      llm: {
        ok: llmOk,
        detail: llmOk
          ? `Primary LLM ready · ${snap.llm?.provider_count || 0} BYO provider(s).`
          : "Primary OpenAI key missing/dummy — AI features degrade.",
        providers: [],
      },
      vault: {
        ok: vaultOk,
        detail: vaultOk ? "Credential vault encryption enabled." : "CREDENTIAL_ENCRYPTION_KEY not set — vault disabled.",
      },
      tokens: {
        ok: (snap.integrations?.configured?.length || 0) > 0,
        detail: `${snap.integrations?.configured?.length || 0} integration(s) configured` +
          (snap.integrations?.missing_recommended?.length
            ? ` · missing recommended: ${snap.integrations.missing_recommended.join(", ")}`
            : ""),
        recentFailures: 0,
      },
      surfaces: {
        ok: !!snap.surfaces?.ok,
        detail: snap.surfaces?.ok
          ? `${snap.surfaces?.counts?.surfaces_monitored || 0} page/feature surfaces green · ${snap.surfaces?.counts?.nav_views || 0} nav views · ${snap.surfaces?.counts?.registry_loaders || 0} feature panels`
          : `${snap.surfaces?.counts?.missing_registry || 0} missing registry · ${snap.surfaces?.counts?.missing_components || 0} missing components · ${snap.surfaces?.counts?.api_probes_failed || 0} API probe failures`,
      },
    },
    surfaces: snap.surfaces || null,
    opsTooling: snap.ops_tooling || null,
    events,
    plan,
    meetingNote: snap.meeting_note || "",
    roster: null,
  };
}

function formatTime(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

export default function TechnicalManager() {
  const router = useRouter();
  const [scan, setScan] = useState<TechScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<Severity | "all">("all");
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const [actionInfo, setActionInfo] = useState<{ label: string; blurb: string } | null>(null);

  const load = useCallback(async (force = false) => {
    setError("");
    try {
      const data = force
        ? await apiPost<ScanResponse>("/api/technical-manager/scan", {})
        : await apiGet<ScanResponse>("/api/technical-manager/scan");
      if (!data?.ok || !data.snapshot) {
        setError(data?.error || "Failed to load Technical Manager status");
        return;
      }
      setScan(snapshotToScan(data.snapshot));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load Technical Manager status");
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

  function openLinkedView(view: string, label: string, blurb: string) {
    setActionInfo({ label, blurb });
    goToView(router, view);
  }

  if (loading && !scan) {
    return <div style={{ padding: 24, color: "var(--fg-muted)" }}>Technical Manager is scanning the platform…</div>;
  }

  const overall = (scan?.overallStatus || "info") as Severity;
  const s = scan?.summary;
  const statusLabel = overall.toUpperCase();

  return (
    <div style={{ padding: "20px 24px 48px", maxWidth: 1280, margin: "0 auto" }}>
      <div className="tm-tech-hero">
        <div className="tm-tech-hero__copy">
          <div className="tm-tech-hero__eyebrow">Technical Manager · Senior role</div>
          <h1 className="tm-tech-hero__title">Entire-system monitor</h1>
          <p className="tm-tech-hero__body">
            Watches every page, subpage and feature in real time — plus every API, LLM, auth session, token,
            security surface and code path. Reports every event and prepares approval-gated plans when
            anything breaks. Attends daily management meetings with live status.
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
          { label: "Surfaces", value: s?.surfacesMonitored ?? 0, color: s?.surfacesOk ? "var(--fg)" : SEV_COLOR.critical, onClick: () => openStatusIssues(s?.surfacesOk ? "all" : "critical") },
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
          { label: "Pages & features", value: scan?.systems.surfaces.ok ? "OK" : "GAPS", ok: !!scan?.systems.surfaces.ok },
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

      <div className="tm-action-bar" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          className="btn-primary tm-refresh-btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setActionInfo({
              label: "Refresh scan now",
              blurb: "Re-running the full platform scan (every page/subpage/feature surface, APIs, database, auth, LLM, vault, integrations, tooling gaps) and updating live status.",
            });
            load(true);
          }}
        >
          {busy ? "Scanning…" : "Refresh scan now"}
        </button>
        {ACTION_LINKS.map((link) => (
          <button
            key={link.id}
            type="button"
            className="tm-action-link"
            onClick={() => openLinkedView(link.view, link.label, link.blurb)}
            title={link.blurb}
          >
            {link.label}
          </button>
        ))}
      </div>

      {actionInfo ? (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #99F6E4",
            background: "#F0FDFA",
            color: "#115E59",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>{actionInfo.label}:</strong> {actionInfo.blurb}
        </div>
      ) : null}

      {scan?.surfaces ? (
        <div
          style={{
            marginBottom: 16,
            padding: "14px 16px",
            borderRadius: 14,
            border: `1px solid ${scan.systems.surfaces.ok ? "#A7F3D0" : "#FECACA"}`,
            background: scan.systems.surfaces.ok ? "#ECFDF5" : "#FEF2F2",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: scan.systems.surfaces.ok ? "#065F46" : "#991B1B" }}>
            Real-time page & feature monitor
          </div>
          <div style={{ marginTop: 4, fontSize: 15, fontWeight: 800, color: "var(--fg)" }}>
            {scan.systems.surfaces.detail}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.45 }}>
            {scan.surfaces.note ||
              "Every nav page/subpage, React feature panel, permission mapping, and core API journey is checked on each scan."}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {[
              ["Nav views", scan.surfaces.counts?.nav_views ?? 0],
              ["Migrated panels", scan.surfaces.counts?.migrated_views ?? 0],
              ["Feature loaders", scan.surfaces.counts?.registry_loaders ?? 0],
              ["Missing registry", scan.surfaces.counts?.missing_registry ?? 0],
              ["Missing files", scan.surfaces.counts?.missing_components ?? 0],
              ["API probe fails", scan.surfaces.counts?.api_probes_failed ?? 0],
            ].map(([label, value]) => (
              <span
                key={String(label)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "#fff",
                  border: "1px solid var(--border)",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--fg)",
                }}
              >
                {label}: {value}
              </span>
            ))}
          </div>
          {scan.surfaces.probes?.length ? (
            <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
              {scan.surfaces.probes.map((p) => (
                <div key={p.path} style={{ fontSize: 12, color: p.ok ? "#065F46" : "#991B1B", fontWeight: 600 }}>
                  {p.ok ? "●" : "○"} {p.path} · HTTP {p.status || "—"}
                  {typeof p.ms === "number" ? ` · ${p.ms}ms` : ""}
                  {p.error ? ` · ${p.error}` : ""}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {scan?.opsTooling ? (
        <div
          style={{
            marginBottom: 16,
            padding: "14px 16px",
            borderRadius: 14,
            border: `1px solid ${scan.opsTooling.ok === false ? "#FECACA" : "#99F6E4"}`,
            background: scan.opsTooling.ok === false ? "#FEF2F2" : "#F0FDFA",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#0F766E" }}>
            Ops tooling stack · ship order
          </div>
          <div style={{ marginTop: 4, fontSize: 15, fontWeight: 800, color: "var(--fg)" }}>
            {(scan.opsTooling.stack || []).filter((x) => x.configured).length}/
            {(scan.opsTooling.stack || []).length} configured · synthetics{" "}
            {scan.opsTooling.synthetics?.ok === false ? "FAILING" : "OK"}
            {typeof scan.opsTooling.finops?.metrics?.cost_usd === "number"
              ? ` · LLM $${scan.opsTooling.finops.metrics.cost_usd.toFixed(2)}/24h`
              : ""}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.45 }}>
            Checkly → OpenTelemetry/SigNoz → Nango → GitGuardian → Promptfoo → LLM FinOps.
            Deferred: Infisical, incident.io/PagerDuty, Uptrace.
          </p>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {(scan.opsTooling.stack || []).map((item) => (
              <div
                key={item.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px 1fr auto",
                  gap: 10,
                  alignItems: "start",
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "#fff",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ fontWeight: 800, color: "#0F766E", fontSize: 13 }}>{item.order}</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "var(--fg)" }}>{item.name}</div>
                  <div style={{ marginTop: 2, fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.4 }}>{item.summary}</div>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: !item.ok ? "#DC2626" : item.configured ? "#065F46" : "#CA8A04",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {!item.ok ? "Issue" : item.configured ? "Live" : "Setup"}
                </div>
              </div>
            ))}
          </div>
          {scan.opsTooling.synthetics?.checks?.length ? (
            <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--fg-muted)" }}>
                Synthetic journeys ({scan.opsTooling.synthetics.provider || "local"})
              </div>
              {scan.opsTooling.synthetics.checks.slice(0, 8).map((c) => (
                <div key={c.id} style={{ fontSize: 12, color: c.ok ? "#065F46" : "#991B1B", fontWeight: 600 }}>
                  {c.ok ? "●" : "○"} {c.name}
                  {c.path ? ` · ${c.path}` : ""}
                  {typeof c.status === "number" ? ` · HTTP ${c.status}` : ""}
                  {typeof c.ms === "number" ? ` · ${c.ms}ms` : ""}
                  {c.error ? ` · ${c.error}` : ""}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

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
                  color: "#0f766e",
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

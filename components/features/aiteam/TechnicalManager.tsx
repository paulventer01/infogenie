"use client";

/**
 * Technical Manager — senior AI Team officer.
 * Continuously monitors APIs, LLMs, auth, tokens, security, tooling gaps;
 * produces live status + plan-of-action for management approval.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";
import { BriefList, ActionsCard } from "./FinanceOfficer";

interface EventRow {
  severity: string;
  area: string;
  message: string;
  action?: string | null;
  at?: string;
}
interface PlanStep {
  step: number;
  severity: string;
  area: string;
  problem: string;
  action: string;
  approval_required?: boolean;
  status?: string;
}
interface Snapshot {
  overall?: string;
  runtime?: { uptime_sec?: number; memory_mb?: number; node?: string };
  postgres?: { ok?: boolean; configured?: boolean; error?: string };
  auth?: { session_secret?: boolean; credential_encryption?: boolean };
  llm?: { openai_configured?: boolean; openai_dummy?: boolean; provider_count?: number };
  integrations?: { configured?: string[]; dummy?: string[]; missing_recommended?: string[] };
  security?: { permission_enforcement?: boolean; vault_enabled?: boolean };
  events?: EventRow[];
  plan_of_action?: PlanStep[];
  tooling_gaps?: { need: string; suggestion: string; urgency: string }[];
  counts?: {
    events?: number;
    critical?: number;
    high?: number;
    integrations_configured?: number;
    tooling_gaps?: number;
    actions_pending_approval?: number;
  };
  meeting_note?: string;
  generated_at?: string;
}
interface Brief {
  summary?: string;
  highlights?: (string | { title?: string })[];
  risks?: (string | { title?: string })[];
  actions?: { title?: string; detail?: string; priority?: string }[];
}

const CARD =
  "background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04)";

function styleObj(css: string): React.CSSProperties {
  const out: Record<string, string> = {};
  css.split(";").forEach((rule) => {
    const i = rule.indexOf(":");
    if (i === -1) return;
    const key = rule.slice(0, i).trim();
    const val = rule.slice(i + 1).trim();
    if (!key) return;
    const jsKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[jsKey] = val;
  });
  return out as React.CSSProperties;
}

function overallColor(o?: string) {
  if (o === "healthy") return "#15803D";
  if (o === "watch") return "#CA8A04";
  if (o === "degraded") return "#EA580C";
  if (o === "critical") return "#B91C1C";
  return "#64748B";
}

function sevColor(s: string) {
  if (s === "critical") return "#B91C1C";
  if (s === "high") return "#EA580C";
  if (s === "medium") return "#CA8A04";
  return "#64748B";
}

export default function TechnicalManager() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [snap, setSnap] = useState<Snapshot>({});
  const [brief, setBrief] = useState<Brief | null>(null);
  const [liveAt, setLiveAt] = useState<string>("");
  const [rosterOk, setRosterOk] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const scan = await apiPost<{ ok: boolean; snapshot?: Snapshot }>("/api/technical-manager/scan", {});
    const snapshot = scan.ok ? scan.snapshot || {} : {};
    setSnap(snapshot);
    setLiveAt(new Date().toLocaleTimeString());

    const br = await apiPost<{ ok: boolean; brief?: Brief }>("/api/officer/brief", {
      role: "technical",
      facts: snapshot,
    });
    if (br.ok) setBrief(br.brief ?? null);

    const roster = await apiPost<{ ok: boolean }>("/api/technical-manager/ensure-roster", {});
    setRosterOk(!!roster.ok);
    setLoading(false);
  }, []);

  useEffect(() => {
    load(false);
    const t = setInterval(() => load(true), 30000); // live status every 30s
    return () => clearInterval(t);
  }, [load]);

  const c = snap.counts || {};

  return (
    <div>
      <div
        style={styleObj(
          "max-width:1200px;margin:0 auto 22px;padding:24px 28px;color:white;border-radius:18px;background:linear-gradient(135deg,#0F172A 0%,#1E3A5F 55%,#0F766E 100%)",
        )}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: ".72rem", letterSpacing: ".18em", textTransform: "uppercase", color: "#99F6E4", fontWeight: 700 }}>
              Technical Manager · Senior role
            </div>
            <h1 style={{ margin: "8px 0 6px", fontSize: "1.85rem", fontWeight: 800 }}>
              Entire-system monitor
            </h1>
            <p style={{ margin: 0, fontSize: ".92rem", color: "#E2E8F0", maxWidth: 720 }}>
              Watches every API, LLM, AI connection, auth session, token, security surface, menu and code path.
              Reports every event — however small — and prepares approval-gated plans when anything breaks.
              Attends daily management meetings with live status.
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.7rem", color: "#99F6E4", fontWeight: 700 }}>LIVE STATUS</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: overallColor(snap.overall), background: "#fff", padding: "6px 14px", borderRadius: 10, marginTop: 6 }}>
              {(snap.overall || "…").toUpperCase()}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#CBD5E1", marginTop: 6 }}>Updated {liveAt || "—"} · auto 30s</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px 40px" }}>
        {loading && !snap.overall ? (
          <div style={styleObj(CARD + ";text-align:center;color:#64748B")}>Scanning InfoGenie platform…</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12, marginBottom: 16 }}>
              {[
                ["Overall", (snap.overall || "—").toUpperCase()],
                ["Critical", c.critical ?? 0],
                ["High", c.high ?? 0],
                ["Events", c.events ?? 0],
                ["Integrations", c.integrations_configured ?? 0],
                ["Tooling gaps", c.tooling_gaps ?? 0],
                ["Awaiting approval", c.actions_pending_approval ?? 0],
                ["Postgres", snap.postgres?.ok ? "OK" : "DOWN"],
                ["LLM", snap.llm?.openai_configured && !snap.llm?.openai_dummy ? "OK" : "RISK"],
                ["Vault", snap.auth?.credential_encryption ? "ON" : "OFF"],
              ].map(([label, val]) => (
                <div key={String(label)} style={styleObj(CARD + ";padding:14px")}>
                  <div style={{ fontSize: ".68rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
                  <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#0F172A", marginTop: 4 }}>{val}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              <button type="button" onClick={() => load(false)} style={btnPrimary}>Refresh scan now</button>
              <button type="button" onClick={() => goToView(router, "capacity")} style={btnGhost}>
                Open Team Capacity roster {rosterOk ? "✓" : ""}
              </button>
              <button type="button" onClick={() => goToView(router, "ai-team")} style={btnGhost}>AI Team meetings</button>
              <button type="button" onClick={() => goToView(router, "ai-providers")} style={btnGhost}>AI Providers</button>
              <button type="button" onClick={() => goToView(router, "ai-governance")} style={btnGhost}>AI Governance</button>
            </div>

            {snap.meeting_note && (
              <div style={styleObj(CARD + ";margin-bottom:16px;background:#ECFDF5;border-color:#A7F3D0")}>
                <strong style={{ color: "#065F46" }}>Daily management meetings:</strong>{" "}
                <span style={{ color: "#047857" }}>{snap.meeting_note}</span>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16, marginBottom: 16 }}>
              <div style={styleObj(CARD)}>
                <h3 style={{ margin: "0 0 10px", fontSize: "1rem" }}>Live event stream</h3>
                {(snap.events || []).length === 0 ? (
                  <div style={{ color: "#16A34A", fontWeight: 600 }}>No events — all monitored surfaces quiet.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8, maxHeight: 360, overflow: "auto" }}>
                    {(snap.events || []).map((e, i) => (
                      <div key={i} style={{ borderLeft: `3px solid ${sevColor(e.severity)}`, padding: "8px 10px", background: "#F8FAFC", borderRadius: 6 }}>
                        <div style={{ fontSize: "0.72rem", fontWeight: 800, color: sevColor(e.severity), textTransform: "uppercase" }}>
                          {e.severity} · {e.area}
                        </div>
                        <div style={{ fontSize: "0.88rem", color: "#0F172A", marginTop: 2 }}>{e.message}</div>
                        {e.action && <div style={{ fontSize: "0.8rem", color: "#64748B", marginTop: 2 }}>→ {e.action}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={styleObj(CARD)}>
                <h3 style={{ margin: "0 0 10px", fontSize: "1rem" }}>Plan of action (approval-gated)</h3>
                {(snap.plan_of_action || []).length === 0 ? (
                  <div style={{ color: "#64748B" }}>No remediation plan required right now.</div>
                ) : (
                  <ol style={{ margin: 0, paddingLeft: 18, color: "#334155", fontSize: "0.88rem", lineHeight: 1.5 }}>
                    {(snap.plan_of_action || []).map((p) => (
                      <li key={p.step} style={{ marginBottom: 8 }}>
                        <strong>{p.action}</strong>
                        <div style={{ color: "#64748B" }}>{p.problem}</div>
                        {p.approval_required && (
                          <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#B45309", background: "#FEF3C7", padding: "2px 6px", borderRadius: 4 }}>
                            Pending management approval
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>

            <div style={styleObj(CARD + ";margin-bottom:16px")}>
              <h3 style={{ margin: "0 0 10px", fontSize: "1rem" }}>Tooling gaps & improvement research</h3>
              <p style={{ margin: "0 0 10px", color: "#64748B", fontSize: "0.88rem" }}>
                If a monitor or control is missing from InfoGenie, the Technical Manager flags it urgently for procurement / build.
              </p>
              <div style={{ display: "grid", gap: 8 }}>
                {(snap.tooling_gaps || []).map((g, i) => (
                  <div key={i} style={{ padding: "10px 12px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
                    <div style={{ fontWeight: 700, color: "#0F172A" }}>{g.need}</div>
                    <div style={{ fontSize: "0.86rem", color: "#475569" }}>{g.suggestion}</div>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: sevColor(g.urgency), marginTop: 4 }}>{g.urgency} urgency</div>
                  </div>
                ))}
              </div>
            </div>

            {brief ? (
              <>
                <div style={styleObj(CARD + ";margin-bottom:16px")}>
                  <div style={{ fontSize: ".7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>
                    Technical Manager briefing
                  </div>
                  <p style={{ margin: 0, fontSize: ".95rem", color: "#0F172A", lineHeight: 1.55 }}>{brief.summary || ""}</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16, marginBottom: 16 }}>
                  <BriefList title="Healthy signals" items={brief.highlights} color="#15803D" />
                  <BriefList title="Threats & risks" items={brief.risks} color="#B91C1C" />
                </div>
                <ActionsCard actions={brief.actions} />
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "9px 14px", border: "none", borderRadius: 8, background: "#0F766E", color: "#fff", fontWeight: 700, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "9px 14px", border: "1px solid #CBD5E1", borderRadius: 8, background: "#fff", color: "#0F172A", fontWeight: 600, cursor: "pointer",
};

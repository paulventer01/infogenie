"use client";

/**
 * AI Governance Hub — Phase A foundation.
 * Non-restrictive defaults are hard requirements: shadow mode, generate/apply auto,
 * launch/budget suggest (soft cue only), fail-open.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiFetch } from "@/lib/api";
import { goToView } from "@/lib/nav";

type Tab = "overview" | "policy" | "audit";

interface ActionTiers {
  [key: string]: string;
}

interface Policy {
  default_mode?: string;
  risk_appetite?: string;
  action_tiers?: ActionTiers;
  block_on_caution?: boolean;
  require_context?: boolean;
  policy_document?: string;
  ethics_contact?: string | null;
  policy_version?: number;
  updated_at?: string | null;
}

interface StatusPayload {
  ok?: boolean;
  mode?: string;
  risk_appetite?: string;
  banner?: string;
  last24h?: {
    total?: number;
    allowed?: number;
    cautionish?: number;
    would_block?: number;
    degraded?: number;
    pending_review?: number;
  };
  layers?: Record<string, { ready?: boolean; note?: string; mode?: string; appetite?: string }>;
  nonRestrictive?: Record<string, boolean>;
}

interface AuditEvent {
  id: string;
  surface: string;
  action: string;
  execution_tier?: string;
  status: string;
  output_preview?: string;
  warnings?: string[] | string;
  created_at?: string;
  block_reason?: string | null;
}

const TIER_LABELS: Record<string, string> = {
  generate_content: "Generate content",
  generate_brief: "Generate brief",
  generate_decision: "Generate decision",
  generate_analysis: "Generate analysis",
  spine_suggest: "Spine suggest",
  apply_calendar: "Apply calendar",
  send_email: "Send email",
  publish_social: "Publish social",
  crm_push: "CRM push",
  launch_campaign: "Launch campaign",
  scale_budget: "Scale budget",
};

export default function AiGovernanceHub() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [draftDoc, setDraftDoc] = useState("");
  const [ethics, setEthics] = useState("");

  const load = useCallback(async () => {
    const [st, pol, aud] = await Promise.all([
      apiGet<StatusPayload>("/api/ai-governance/status"),
      apiGet<{ policy?: Policy }>("/api/ai-governance/policy"),
      apiGet<{ events?: AuditEvent[] }>("/api/ai-governance/audit?limit=40"),
    ]);
    if (st.ok !== false) setStatus(st);
    if (pol.ok !== false && pol.policy) {
      setPolicy(pol.policy);
      setDraftDoc(pol.policy.policy_document || "");
      setEthics(pol.policy.ethics_contact || "");
    }
    if (aud.ok !== false) setEvents(aud.events || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function savePolicy(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMsg("");
    const r = await apiFetch<{ ok?: boolean; error?: string; policy?: Policy }>(
      "/api/ai-governance/policy",
      { method: "PUT", body: JSON.stringify(body) },
    );
    setBusy("");
    if (r.ok === false) {
      setMsg(r.error || "Save failed");
      return;
    }
    setMsg("Policy saved — defaults stay non-restrictive unless you opted into Enforce.");
    await load();
  }

  async function applyPreset(preset: string) {
    await savePolicy({ preset }, "preset");
  }

  async function toggleEnforce(enable: boolean) {
    if (enable) {
      const ok = window.confirm(
        "Enable Enforce mode?\n\nThis can delay launch/budget (and any suggest tiers). Shadow mode is recommended for most teams.",
      );
      if (!ok) return;
    }
    await savePolicy({ default_mode: enable ? "enforce" : "shadow" }, "mode");
  }

  async function demoEvent(forceBlock = false) {
    setBusy("demo");
    const r = await apiPost<{ result?: { proceeded?: boolean; status?: string; warnings?: string[] } }>(
      "/api/ai-governance/demo-event",
      { forceBlock, surface: "marketing_spine", action: "apply_calendar" },
    );
    setBusy("");
    if (r.ok === false) {
      setMsg("Demo event failed");
      return;
    }
    setMsg(
      `Demo logged — proceeded=${r.result?.proceeded !== false} status=${r.result?.status || "allowed"} (shadow never blocks).`,
    );
    await load();
  }

  const tiers = policy?.action_tiers || {};
  const mode = policy?.default_mode || status?.mode || "shadow";
  const counts = status?.last24h || {};

  return (
    <div>
      <div
        className="intel-header ig-panel-hero"
        style={{ background: "linear-gradient(135deg,#ecfdf5 0%,#f0f9ff 50%,#fff7ed 100%)" }}
      >
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>
            Manage
          </span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>
            ›
          </span>{" "}
          AI Governance Hub
        </div>
        <h1 className="ih-title">AI Governance Hub</h1>
        <p className="ih-sub">
          Prove what AI did — without slowing Brief → action → calendar. Shadow-first by default;
          Enforce is tenant opt-in only.
        </p>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 1040, margin: "0 auto" }}>
        <div
          style={{
            background: mode === "shadow" ? "#ECFDF5" : "#FEF3C7",
            border: `1px solid ${mode === "shadow" ? "#A7F3D0" : "#FCD34D"}`,
            borderRadius: 12,
            padding: "12px 16px",
            marginBottom: 18,
            fontSize: "0.88rem",
            color: "#134E4A",
          }}
        >
          <strong>{mode === "shadow" ? "Shadow mode" : "Enforce mode (opt-in)"}</strong>
          {" — "}
          {status?.banner
            || "Shadow mode — nothing is blocked. Actions proceed; we log warnings for audit."}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          {(
            [
              ["overview", "Overview"],
              ["policy", "Policy"],
              ["audit", "Audit log"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: tab === id ? "1px solid #0F766E" : "1px solid #E5E7EB",
                background: tab === id ? "#0F766E" : "white",
                color: tab === id ? "white" : "#334155",
                fontWeight: 700,
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => goToView(router, "brand-safety")}
            style={{
              marginLeft: "auto",
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #E5E7EB",
              background: "white",
              fontWeight: 600,
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            Brand Safety →
          </button>
        </div>

        {msg && (
          <p style={{ fontSize: "0.85rem", color: "#0F766E", marginBottom: 14 }}>{msg}</p>
        )}

        {tab === "overview" && (
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
                gap: 12,
                marginBottom: 20,
              }}
            >
              {[
                ["Events (24h)", counts.total ?? 0],
                ["Allowed", counts.allowed ?? 0],
                ["Warnings", counts.cautionish ?? 0],
                ["Would-block (shadow)", counts.would_block ?? 0],
                ["Degraded (fail-open)", counts.degraded ?? 0],
              ].map(([label, val]) => (
                <div
                  key={String(label)}
                  style={{
                    background: "white",
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0F172A", marginTop: 4 }}>
                    {val}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 20 }}>
              {(["policy", "data", "context", "output"] as const).map((layer) => {
                const L = status?.layers?.[layer];
                return (
                  <div
                    key={layer}
                    style={{
                      background: "white",
                      border: "1px solid #E5E7EB",
                      borderRadius: 12,
                      padding: 14,
                    }}
                  >
                    <div style={{ fontWeight: 800, textTransform: "capitalize" }}>Layer · {layer}</div>
                    <div style={{ fontSize: "0.78rem", color: L?.ready ? "#047857" : "#94A3B8", marginTop: 6 }}>
                      {L?.ready ? "Ready" : L?.note || "Later phase"}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => demoEvent(false)}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: "#0F766E",
                  color: "white",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: "0.82rem",
                }}
              >
                {busy === "demo" ? "Logging…" : "Log demo Spine apply"}
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => demoEvent(true)}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "1px solid #E5E7EB",
                  background: "white",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.82rem",
                }}
              >
                Simulate brand-safety block (still proceeds)
              </button>
              <button
                type="button"
                onClick={() => goToView(router, "ecosystem-spine")}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "1px solid #E5E7EB",
                  background: "white",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.82rem",
                }}
              >
                Open Ecosystem Spine →
              </button>
            </div>
          </div>
        )}

        {tab === "policy" && (
          <div>
            <p style={{ fontSize: "0.88rem", color: "#475569", marginBottom: 14, maxWidth: 720 }}>
              Defaults keep InfoGenie fast. Launch &amp; budget changes are flagged for an optional
              glance — nothing waits unless you turn on Enforce.
            </p>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {(
                [
                  ["aggressive", "Aggressive (default)"],
                  ["balanced", "Balanced"],
                  ["conservative", "Conservative"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  disabled={!!busy}
                  onClick={() => applyPreset(id)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border:
                      (policy?.risk_appetite || "aggressive") === id
                        ? "1px solid #0F766E"
                        : "1px solid #E5E7EB",
                    background: (policy?.risk_appetite || "aggressive") === id ? "#CCFBF1" : "white",
                    fontWeight: 700,
                    fontSize: "0.78rem",
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div
              style={{
                background: "white",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 800 }}>Enforcement mode</div>
                  <div style={{ fontSize: "0.78rem", color: "#64748B" }}>
                    Platform default is always Shadow. Enforce is per-tenant only.
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => toggleEnforce(mode !== "enforce")}
                  style={{
                    marginLeft: "auto",
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #E5E7EB",
                    background: mode === "enforce" ? "#FEF3C7" : "#ECFDF5",
                    fontWeight: 700,
                    fontSize: "0.8rem",
                    cursor: "pointer",
                  }}
                >
                  {mode === "enforce" ? "Switch back to Shadow" : "Enable Enforce…"}
                </button>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap", fontSize: "0.8rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!policy?.block_on_caution}
                    onChange={(e) => savePolicy({ block_on_caution: e.target.checked }, "boc")}
                  />
                  Block on caution (off by default)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!policy?.require_context}
                    onChange={(e) => savePolicy({ require_context: e.target.checked }, "ctx")}
                  />
                  Require context (off — enrich, don&apos;t refuse)
                </label>
              </div>
            </div>

            <div
              style={{
                background: "white",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                overflow: "hidden",
                marginBottom: 16,
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead style={{ background: "#F8FAFC" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 14px" }}>Action</th>
                    <th style={{ textAlign: "left", padding: "10px 14px" }}>Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(TIER_LABELS).map((key) => (
                    <tr key={key} style={{ borderTop: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "10px 14px" }}>{TIER_LABELS[key]}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <select
                          value={tiers[key] || "auto"}
                          onChange={(e) =>
                            savePolicy(
                              { action_tiers: { ...tiers, [key]: e.target.value } },
                              "tier",
                            )
                          }
                          style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0" }}
                        >
                          <option value="auto">auto — run immediately</option>
                          <option value="suggest">suggest — soft cue (queue only in Enforce)</option>
                          <option value="block">block — rare; only stops in Enforce</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569" }}>
                Ethics / accountability contact
              </label>
              <input
                value={ethics}
                onChange={(e) => setEthics(e.target.value)}
                onBlur={() => savePolicy({ ethics_contact: ethics }, "ethics")}
                placeholder="owner@company.com"
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 6,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #E2E8F0",
                  fontSize: "0.85rem",
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569" }}>
                Policy document (markdown)
              </label>
              <textarea
                value={draftDoc}
                onChange={(e) => setDraftDoc(e.target.value)}
                rows={6}
                placeholder="Optional formal policy notes…"
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 6,
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #E2E8F0",
                  fontSize: "0.85rem",
                  fontFamily: "inherit",
                }}
              />
              <button
                type="button"
                disabled={!!busy}
                onClick={() => savePolicy({ policy_document: draftDoc }, "doc")}
                style={{
                  marginTop: 8,
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "#0F766E",
                  color: "white",
                  fontWeight: 700,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                Save document
              </button>
              {policy?.policy_version != null && (
                <span style={{ marginLeft: 10, fontSize: "0.75rem", color: "#94A3B8" }}>
                  v{policy.policy_version}
                </span>
              )}
            </div>
          </div>
        )}

        {tab === "audit" && (
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
            {events.length === 0 ? (
              <div style={{ padding: 28, textAlign: "center", color: "#94A3B8", fontSize: "0.9rem" }}>
                No governance events yet. Log a demo event or apply a Spine action.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead style={{ background: "#F8FAFC" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>When</th>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>Surface</th>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>Action</th>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>Tier</th>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>Status</th>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id} style={{ borderTop: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "#64748B" }}>
                        {ev.created_at ? new Date(ev.created_at).toLocaleString() : "—"}
                      </td>
                      <td style={{ padding: "10px 12px" }}>{ev.surface}</td>
                      <td style={{ padding: "10px 12px" }}>{ev.action}</td>
                      <td style={{ padding: "10px 12px" }}>{ev.execution_tier || "—"}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 6,
                            background:
                              ev.status === "allowed" || ev.status === "applied"
                                ? "#D1FAE5"
                                : ev.status === "governance_degraded"
                                  ? "#E0E7FF"
                                  : "#FEF3C7",
                            color: "#134E4A",
                          }}
                        >
                          {ev.status}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ev.output_preview || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

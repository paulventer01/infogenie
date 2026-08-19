"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Mod {
  id: string;
  label: string;
  desc: string;
  view: string;
  capabilities?: { context: boolean; suggest: boolean; resolve: boolean; apply: boolean };
}

interface Proposal {
  module: string;
  actionId: string | null;
  title: string;
  action_type: string;
  priority: string;
  canApply: boolean;
  applyPath?: string | null;
  view?: string;
  hint?: string;
}

type LoadStatus = "loading" | "error" | "ready";

export default function AgentOrchestrator() {
  const router = useRouter();
  const [modules, setModules] = useState<Mod[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [msgIsError, setMsgIsError] = useState(false);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    setLoadError("");
    const r = await apiGet<{ ok: boolean; modules?: Mod[]; error?: string }>(
      "/api/agent-orchestrator/status",
    );
    if (r.ok === false) {
      setModules([]);
      setLoadError(r.error || "Failed to load orchestrator status.");
      setStatus("error");
      return;
    }
    setModules(r.modules || []);
    setLoadError("");
    setStatus("ready");
  }, []);

  useEffect(() => { load(); }, [load]);

  const actionsLocked = status === "loading" || !!busy;

  async function suggestAll() {
    setBusy("suggest");
    setMsg("");
    setMsgIsError(false);
    const r = await apiPost<{ ok: boolean; proposals?: Proposal[]; count?: number; error?: string }>(
      "/api/agent-orchestrator/suggest",
      { modules: ["spine", "calendar"] },
    );
    setBusy("");
    if (r.ok === false) {
      setMsgIsError(true);
      setMsg(r.error || "Suggest failed");
      return;
    }
    setProposals(r.proposals || []);
    setMsgIsError(false);
    setMsg(`Cross-module suggest returned ${r.count ?? 0} proposal(s).`);
  }

  async function applySpine(actionId: string) {
    setBusy(actionId);
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/agent-orchestrator/apply", {
      module: "spine",
      action_id: actionId,
    });
    setBusy("");
    if (r.ok === false) {
      setMsgIsError(true);
      setMsg(r.error || "Apply failed");
      return;
    }
    setMsgIsError(false);
    setMsg("Applied via orchestrator");
    setProposals((p) => p.filter((x) => x.actionId !== actionId));
  }

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#f0f9ff 0%,#fdf4ff 55%,#ecfdf5 100%)" }}>
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Manage</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Agent Orchestrator
        </div>
        <h1 className="ih-title">🤖 Agent Orchestrator</h1>
        <p className="ih-sub">
          Calendar Assistant pattern generalized — suggest → resolve → apply across spine, calendar, decisions, and optimizer.
        </p>
      </div>

      <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={actionsLocked}
            onClick={suggestAll}
            style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: "#4F46E5", color: "white", fontWeight: 700, cursor: actionsLocked ? "not-allowed" : "pointer", fontSize: "0.82rem", opacity: actionsLocked ? 0.6 : 1 }}
          >
            {busy === "suggest" ? "Running…" : "Suggest across Spine + Calendar"}
          </button>
          <button
            type="button"
            onClick={() => goToView(router, "ecosystem-spine")}
            style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #E5E7EB", background: "white", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem" }}
          >
            Open Ecosystem Spine →
          </button>
        </div>
        {status === "loading" && (
          <p style={{ fontSize: "0.85rem", color: "#6B7280", marginBottom: 14 }}>Loading orchestrator status…</p>
        )}
        {status === "error" && (
          <div
            className="ig-alert ig-alert-error"
            style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
          >
            <span>{loadError || "Failed to load orchestrator status."}</span>
            <button
              type="button"
              onClick={() => load()}
              style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#4F46E5", color: "white", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem" }}
            >
              Retry
            </button>
          </div>
        )}
        {msg && (
          <p style={{ fontSize: "0.85rem", color: msgIsError ? "#B91C1C" : "#3730A3", marginBottom: 14 }}>{msg}</p>
        )}

        {status === "ready" && modules.length === 0 && (
          <p style={{ color: "#6B7280", fontSize: "0.85rem", marginBottom: 22 }}>
            No orchestrator modules are available right now.
          </p>
        )}

        {modules.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 22 }}>
            {modules.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => goToView(router, m.view)}
                style={{ textAlign: "left", background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16, cursor: "pointer" }}
              >
                <strong style={{ fontSize: "0.92rem" }}>{m.label}</strong>
                <p style={{ margin: "6px 0 10px", fontSize: "0.78rem", color: "#64748B" }}>{m.desc}</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["context", "suggest", "resolve", "apply"] as const).map((cap) => (
                    <span
                      key={cap}
                      style={{
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: m.capabilities?.[cap] ? "#D1FAE5" : "#F3F4F6",
                        color: m.capabilities?.[cap] ? "#065F46" : "#9CA3AF",
                      }}
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}

        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
          <h3 style={{ margin: "0 0 12px" }}>Unified proposals</h3>
          {proposals.length === 0 && (
            <p style={{ color: "#6B7280", fontSize: "0.85rem" }}>Run a cross-module suggest to populate proposals.</p>
          )}
          {proposals.map((p, i) => (
            <div
              key={`${p.module}-${p.actionId || i}`}
              style={{ padding: "12px 0", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
            >
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.9rem" }}>
                  <span style={{ fontSize: "0.65rem", textTransform: "uppercase", color: "#6366F1", marginRight: 8 }}>{p.module}</span>
                  {p.title}
                </div>
                <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  {p.action_type}{p.hint ? ` — ${p.hint}` : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {p.canApply && p.actionId && (
                  <button
                    type="button"
                    disabled={actionsLocked}
                    onClick={() => applySpine(p.actionId!)}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#4F46E5", color: "white", fontWeight: 700, cursor: actionsLocked ? "not-allowed" : "pointer", fontSize: "0.75rem", opacity: actionsLocked ? 0.6 : 1 }}
                  >
                    Apply
                  </button>
                )}
                {p.view && (
                  <button
                    type="button"
                    onClick={() => goToView(router, p.view!)}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB", background: "white", fontWeight: 600, cursor: "pointer", fontSize: "0.75rem" }}
                  >
                    Open →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

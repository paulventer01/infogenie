"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface SpineContext {
  ok?: boolean;
  healthScore?: number;
  audiences?: { segments: number; enabled: number; members: number; score: number };
  pixels?: { configured: number; total: number; score: number; capiEvents30d?: number };
  attribution?: { runs30d: number; score: number };
  leads?: { total: number; scored: number; score: number };
  brief?: { hasToday: boolean; actionCount: number };
  optimizer?: { openActions: number; campaigns: number };
  decisions?: { open: number };
  actions?: { suggested: number; applied: number; failed: number };
  gaps?: string[];
}

interface ActionRow {
  id: string;
  source: string;
  action_type: string;
  title: string;
  rationale?: string;
  priority: string;
  status: string;
  target_system?: string;
  result?: { kind?: string; view?: string; id?: string };
}

const priColor: Record<string, string> = { high: "#DC2626", medium: "#D97706", low: "#2563EB" };

export default function EcosystemSpine() {
  const router = useRouter();
  const [ctx, setCtx] = useState<SpineContext | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [plan, setPlan] = useState<{ actionId: string; title: string; canApply: boolean; order: number }[]>([]);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [c, a] = await Promise.all([
      apiGet<SpineContext>("/api/marketing-spine/context"),
      apiGet<{ actions?: ActionRow[] }>("/api/marketing-spine/actions?status=suggested&limit=40"),
    ]);
    if (c.ok !== false) setCtx(c);
    setActions(a.actions || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function suggest() {
    setBusy("suggest");
    setMsg("");
    const r = await apiPost<{ insertedCount?: number; error?: string }>("/api/marketing-spine/suggest", {});
    setBusy("");
    if (r.ok === false) { setMsg(r.error || "Suggest failed"); return; }
    setMsg(`Suggested ${r.insertedCount ?? 0} new action(s) from Brief, Decisions, Optimizer, and health gaps.`);
    await load();
  }

  async function resolve() {
    setBusy("resolve");
    setMsg("");
    const r = await apiPost<{ plan?: typeof plan; summary?: string; error?: string }>("/api/marketing-spine/resolve", {});
    setBusy("");
    if (r.ok === false) { setMsg(r.error || "Resolve failed"); return; }
    setPlan(r.plan || []);
    setSummary(r.summary || "");
  }

  async function apply(id: string) {
    setBusy(id);
    setMsg("");
    const r = await apiPost<{ result?: ActionRow["result"]; error?: string }>(`/api/marketing-spine/apply/${id}`, {});
    setBusy("");
    if (r.ok === false) { setMsg(r.error || "Apply failed"); return; }
    setMsg(`Applied — ${r.result?.kind || "done"}${r.result?.id ? ` (${r.result.id})` : ""}`);
    if (r.result?.kind === "navigate" && r.result.view) {
      goToView(router, r.result.view);
      return;
    }
    await load();
    setPlan((p) => p.filter((x) => x.actionId !== id));
  }

  async function dismiss(id: string) {
    setBusy("d-" + id);
    await apiPost(`/api/marketing-spine/dismiss/${id}`, {});
    setBusy("");
    await load();
  }

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#ecfdf5 0%,#eff6ff 50%,#fef3c7 100%)" }}>
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Grow</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Ecosystem Spine
        </div>
        <h1 className="ih-title">🕸️ Centralized Marketing Ecosystem</h1>
        <p className="ih-sub">
          Unified audience + attribution health, with close-loop actions from Brief, Decision Engine, and Optimizer — suggest → resolve → apply.
        </p>
      </div>

      <div style={{ padding: 24, maxWidth: 1040, margin: "0 auto" }}>
        {!ctx && <p style={{ color: "#6B7280" }}>Loading spine…</p>}
        {ctx && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 18 }}>
              {[
                ["Health", `${ctx.healthScore ?? 0}/100`],
                ["Audiences", `${ctx.audiences?.enabled ?? 0} live`],
                ["Members", String(ctx.audiences?.members ?? 0)],
                ["Pixels", `${ctx.pixels?.configured ?? 0}/${ctx.pixels?.total ?? 3}`],
                ["Attr runs", String(ctx.attribution?.runs30d ?? 0)],
                ["Open actions", String(ctx.actions?.suggested ?? 0)],
              ].map(([label, val]) => (
                <div key={String(label)} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: "0.68rem", color: "#6B7280", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
                  <div style={{ fontSize: "1.35rem", fontWeight: 800, marginTop: 4 }}>{val}</div>
                </div>
              ))}
            </div>

            {(ctx.gaps || []).length > 0 && (
              <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 12, padding: 14, marginBottom: 18 }}>
                <strong style={{ fontSize: "0.85rem" }}>Ecosystem gaps</strong>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.82rem", color: "#78350F" }}>
                  {(ctx.gaps || []).map((g) => <li key={g}>{g}</li>)}
                </ul>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
              <button type="button" disabled={!!busy} onClick={suggest} style={btnPrimary}>
                {busy === "suggest" ? "Suggesting…" : "① Suggest from Brief / Decisions / Optimizer"}
              </button>
              <button type="button" disabled={!!busy} onClick={resolve} style={btnSecondary}>
                {busy === "resolve" ? "Resolving…" : "② Resolve apply plan"}
              </button>
              <button type="button" onClick={() => goToView(router, "agent-orchestrator")} style={btnGhost}>
                Agent Orchestrator →
              </button>
              <button type="button" onClick={() => goToView(router, "execution-hub")} style={btnGhost}>
                Execution Hub →
              </button>
            </div>
            {msg && <p style={{ fontSize: "0.85rem", color: "#065F46", marginBottom: 14 }}>{msg}</p>}
            {summary && <p style={{ fontSize: "0.85rem", color: "#374151", marginBottom: 14 }}>{summary}</p>}

            {plan.length > 0 && (
              <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
                <h3 style={{ margin: "0 0 12px" }}>Apply plan</h3>
                {plan.map((p) => (
                  <div key={p.actionId} style={rowStyle}>
                    <div>
                      <span style={{ fontWeight: 700, marginRight: 8 }}>#{p.order}</span>
                      {p.title}
                    </div>
                    {p.canApply && (
                      <button type="button" disabled={!!busy} onClick={() => apply(p.actionId)} style={btnSmall}>
                        Apply
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
              <h3 style={{ margin: "0 0 12px" }}>Suggested actions ({actions.length})</h3>
              {actions.length === 0 && (
                <p style={{ color: "#6B7280", fontSize: "0.85rem" }}>
                  No suggested actions yet — run Suggest to pull from today&apos;s Brief, Decision Engine, Optimizer, and spine gaps.
                </p>
              )}
              {actions.map((a) => (
                <div key={a.id} style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 800, fontSize: "0.9rem" }}>
                      <span style={{ color: priColor[a.priority] || "#374151", textTransform: "uppercase", fontSize: "0.65rem", marginRight: 8 }}>
                        {a.priority}
                      </span>
                      {a.title}
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "#64748B" }}>
                      {a.source} · {a.action_type}
                      {a.rationale ? ` — ${a.rationale}` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" disabled={!!busy} onClick={() => apply(a.id)} style={btnSmall}>
                      {busy === a.id ? "…" : "Apply"}
                    </button>
                    <button type="button" disabled={!!busy} onClick={() => dismiss(a.id)} style={btnGhostSmall}>
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 18 }}>
              {[
                ["audiences-dynamic", "👥 Audiences"],
                ["attribution", "🥉 Attribution"],
                ["pixel-manager", "🎞️ Pixels"],
                ["marketing-brief", "📋 Brief"],
                ["newsletter-studio", "📰 Newsletter"],
                ["podcast-studio", "🎙️ Podcast"],
                ["interactive-leads", "🧩 Interactive"],
                ["push-marketing", "🔔 Push"],
                ["social-commerce", "🛒 Social Commerce"],
              ].map(([view, label]) => (
                <button key={view} type="button" onClick={() => goToView(router, view)} style={tileBtn}>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const btnPrimary: CSSProperties = {
  padding: "10px 16px", borderRadius: 10, border: "none", background: "#0F766E", color: "white",
  fontWeight: 700, cursor: "pointer", fontSize: "0.8rem",
};
const btnSecondary: CSSProperties = {
  padding: "10px 16px", borderRadius: 10, border: "1px solid #0F766E", background: "white", color: "#0F766E",
  fontWeight: 700, cursor: "pointer", fontSize: "0.8rem",
};
const btnGhost: CSSProperties = {
  padding: "10px 16px", borderRadius: 10, border: "1px solid #E5E7EB", background: "#F9FAFB", color: "#374151",
  fontWeight: 600, cursor: "pointer", fontSize: "0.8rem",
};
const btnSmall: CSSProperties = {
  padding: "8px 12px", borderRadius: 8, border: "none", background: "#0066FF", color: "white",
  fontWeight: 700, cursor: "pointer", fontSize: "0.75rem",
};
const btnGhostSmall: CSSProperties = {
  padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB", background: "white", color: "#6B7280",
  fontWeight: 600, cursor: "pointer", fontSize: "0.75rem",
};
const rowStyle: CSSProperties = {
  padding: "12px 0", borderBottom: "1px solid #F3F4F6", display: "flex",
  justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap",
};
const tileBtn: CSSProperties = {
  textAlign: "left", background: "white", border: "1px solid #E5E7EB", borderRadius: 10,
  padding: "12px 14px", cursor: "pointer", fontWeight: 700, fontSize: "0.82rem",
};

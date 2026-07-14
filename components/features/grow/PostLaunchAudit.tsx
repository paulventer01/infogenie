"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface AuditCheck {
  id: number;
  audit_id: number;
  check_type: string;
  status: "pending" | "pass" | "fail" | "na";
  details: Record<string, unknown> | null;
  run_at: string | null;
}

interface Audit {
  id: number;
  campaign_name: string;
  platform: string;
  campaign_id: number | null;
  audit_window: string;
  status: string;
  overall_result: string | null;
  scheduled_for: string | null;
  completed_at: string | null;
  created_at: string;
  checks?: AuditCheck[];
}

const CHECK_META: Record<string, { label: string; icon: string; description: string }> = {
  live_data:   { label: "Live Data Check",       icon: "📡", description: "Verifies campaigns are actively spending and registering impressions without warning flags." },
  spend:       { label: "Spend Verification",     icon: "💰", description: "Confirms budget is being consumed at the expected rate — no zero-spend after 4+ hours." },
  impressions: { label: "Impressions Check",      icon: "👁",  description: "Validates that ads are serving and generating impressions — flags if 0 after 6+ hours." },
  lead_flow:   { label: "Lead Flow Verification", icon: "🧪", description: "Sends a test submission through the full funnel and verifies it appears in your CRM." },
};

const PLATFORMS = ["meta","google","linkedin","tiktok","microsoft"];

function statusBadge(status: string) {
  if (status === "pass" || status === "passed")   return { bg: "#ECFDF5", color: "#065F46", label: "✅ Pass" };
  if (status === "fail" || status === "failed")   return { bg: "#FEF2F2", color: "#DC2626", label: "❌ Fail" };
  if (status === "na")                            return { bg: "#F1F5F9", color: "#475569", label: "N/A" };
  if (status === "in_progress")                  return { bg: "#FFF7ED", color: "#92400E", label: "⏳ Running" };
  return { bg: "#F8FAFC", color: "#94A3B8", label: "⏳ Pending" };
}

export default function PostLaunchAudit() {
  const [audits, setAudits]           = useState<Audit[]>([]);
  const [active, setActive]           = useState<Audit | null>(null);
  const [loading, setLoading]         = useState(true);
  const [running, setRunning]         = useState<string | null>(null);
  const [toast, setToast]             = useState("");
  const [tab, setTab]                 = useState<"list" | "detail">("list");
  const [form, setForm]               = useState({ campaign_name: "", platform: "meta", audit_window: "48h" });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiGet("/api/post-launch-audit/audits");
    if (r?.audits) setAudits(r.audits);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadDetail(id: number) {
    const r = await apiGet(`/api/post-launch-audit/audits/${id}`);
    if (r?.audit) { setActive(r.audit); setTab("detail"); }
  }

  async function handleCreate() {
    if (!form.campaign_name) { showToast("Campaign name is required."); return; }
    setRunning("create");
    const r = await apiPost("/api/post-launch-audit/audits", form);
    if (r?.ok) {
      showToast("✅ Audit scheduled!");
      setForm({ campaign_name: "", platform: "meta", audit_window: "48h" });
      load();
      setActive(r.audit);
      setTab("detail");
    } else { showToast("Error creating audit."); }
    setRunning(null);
  }

  async function handleRunLiveCheck() {
    if (!active) return;
    setRunning("live");
    const r = await apiPost(`/api/post-launch-audit/audits/${active.id}/run-live-check`, {});
    if (r?.ok) {
      showToast(r.status === "pass" ? "✅ Live data check passed!" : `⚠️ Live data check: ${r.status}`);
      const detail = await apiGet(`/api/post-launch-audit/audits/${active.id}`);
      if (detail?.audit) setActive(detail.audit);
      load();
    } else { showToast("Live check failed."); }
    setRunning(null);
  }

  async function handleRunLeadFlow() {
    if (!active) return;
    setRunning("lead");
    const r = await apiPost(`/api/post-launch-audit/audits/${active.id}/run-lead-flow`, {});
    if (r?.ok) {
      showToast(r.status === "pass" ? "✅ Lead flow verified!" : r.status === "na" ? "⚠️ HubSpot not connected — configure it in Integrations." : `⚠️ Lead flow: ${r.status}`);
      const detail = await apiGet(`/api/post-launch-audit/audits/${active.id}`);
      if (detail?.audit) setActive(detail.audit);
      load();
    } else { showToast("Lead flow check failed."); }
    setRunning(null);
  }

  async function handleDelete(id: number) {
    await apiDelete(`/api/post-launch-audit/audits/${id}`);
    setAudits(prev => prev.filter(a => a.id !== id));
    if (active?.id === id) { setActive(null); setTab("list"); }
    showToast("Deleted.");
  }

  const card:   React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 2px 8px rgba(10,20,50,.06)" };
  const input:  React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", boxSizing: "border-box" };
  const lbl:    React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 5 };
  const btnPri: React.CSSProperties = { padding: "10px 22px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" };

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "#0A1628", color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Grow › Post-Launch Audit</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>🔬 Post-Launch Audit (24–48h)</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>24-48 hours after launch: verify platforms are spending, impressions are live, and a test lead flows all the way through to your CRM.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {([["list","📋 Audits"], ["detail","🔬 Detail"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} disabled={t === "detail" && !active} style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#0066FF" : "transparent"}`, color: tab === t ? "#0066FF" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: t === "detail" && !active ? "default" : "pointer", opacity: t === "detail" && !active ? 0.4 : 1, marginBottom: -2 }}>
            {label}{t === "detail" && active ? ` — ${active.campaign_name}` : ""}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 }}>
          {/* Create */}
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 14 }}>🚀 Schedule Audit</div>
            <div style={{ display: "grid", gap: 11 }}>
              <div><label style={lbl}>Campaign Name *</label><input style={input} placeholder="Q3 Meta Launch" value={form.campaign_name} onChange={e => setForm(f => ({ ...f, campaign_name: e.target.value }))} /></div>
              <div>
                <label style={lbl}>Platform</label>
                <select style={input} value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}>
                  {PLATFORMS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Audit Window</label>
                <select style={input} value={form.audit_window} onChange={e => setForm(f => ({ ...f, audit_window: e.target.value }))}>
                  <option value="24h">24 hours post-launch</option>
                  <option value="48h">48 hours post-launch</option>
                </select>
              </div>
            </div>
            <button onClick={handleCreate} disabled={running === "create"} style={{ ...btnPri, marginTop: 14, width: "100%", opacity: running === "create" ? 0.7 : 1 }}>
              {running === "create" ? "Scheduling…" : "🔬 Schedule Post-Launch Audit"}
            </button>

            <div style={{ marginTop: 20, background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontWeight: 800, color: "#1D4ED8", fontSize: "0.82rem", marginBottom: 8 }}>What gets checked?</div>
              {Object.entries(CHECK_META).map(([key, m]) => (
                <div key={key} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: "1rem" }}>{m.icon}</span>
                  <div>
                    <div style={{ fontWeight: 700, color: "#1E40AF", fontSize: "0.78rem" }}>{m.label}</div>
                    <div style={{ color: "#3B82F6", fontSize: "0.72rem" }}>{m.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* List */}
          <div>
            {loading ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 60 }}>Loading…</div> :
              audits.length === 0 ? (
                <div style={{ ...card, textAlign: "center", padding: "50px 20px" }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>🔬</div>
                  <div style={{ fontWeight: 700, color: "#0A1628", marginBottom: 4 }}>No audits yet</div>
                  <div style={{ color: "#64748B", fontSize: "0.82rem" }}>Schedule your first post-launch audit after a campaign goes live.</div>
                </div>
              ) : audits.map(a => {
                const checks: AuditCheck[] = (Array.isArray(a.checks) ? a.checks : []).filter(Boolean);
                const passed = checks.filter(c => c.status === "pass").length;
                const failed = checks.filter(c => c.status === "fail").length;
                const overall = statusBadge(a.overall_result || a.status);
                return (
                  <div key={a.id} style={{ ...card, cursor: "pointer", borderLeft: `4px solid ${a.overall_result === "passed" ? "#10B981" : a.overall_result === "failed" ? "#EF4444" : "#F59E0B"}` }} onClick={() => loadDetail(a.id)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem" }}>{a.campaign_name}</div>
                        <div style={{ color: "#64748B", fontSize: "0.78rem", marginTop: 3 }}>
                          {a.platform} · {a.audit_window} audit · Launched {new Date(a.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ background: overall.bg, color: overall.color, padding: "3px 10px", borderRadius: 99, fontSize: "0.72rem", fontWeight: 700 }}>{overall.label}</span>
                        <button onClick={e => { e.stopPropagation(); handleDelete(a.id); }} style={{ background: "#FEF2F2", border: "none", borderRadius: 6, color: "#DC2626", padding: "4px 8px", fontSize: "0.72rem", cursor: "pointer" }}>🗑</button>
                      </div>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 12, fontSize: "0.72rem", color: "#64748B" }}>
                      {checks.map(c => {
                        const b = statusBadge(c.status);
                        const m = CHECK_META[c.check_type];
                        return <span key={c.id} style={{ background: b.bg, color: b.color, padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>{m?.icon} {m?.label.split(" ")[0]}</span>;
                      })}
                    </div>
                    {a.scheduled_for && (
                      <div style={{ marginTop: 6, fontSize: "0.72rem", color: "#94A3B8" }}>
                        Scheduled: {new Date(a.scheduled_for).toLocaleString()}
                        {passed > 0 && <span style={{ marginLeft: 8, color: "#059669" }}>· {passed} passed</span>}
                        {failed > 0 && <span style={{ marginLeft: 8, color: "#DC2626" }}>· {failed} failed</span>}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {tab === "detail" && active && (
        <div>
          {/* Header */}
          <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 900, color: "#0A1628", fontSize: "1.1rem" }}>{active.campaign_name}</div>
              <div style={{ color: "#64748B", fontSize: "0.78rem" }}>
                {active.platform} · {active.audit_window} audit · Started {new Date(active.created_at).toLocaleDateString()}
                {active.scheduled_for && ` · Due ${new Date(active.scheduled_for).toLocaleString()}`}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(() => { const b = statusBadge(active.overall_result || active.status); return <span style={{ background: b.bg, color: b.color, padding: "6px 14px", borderRadius: 99, fontSize: "0.82rem", fontWeight: 700 }}>{b.label}</span>; })()}
              <button onClick={handleRunLiveCheck} disabled={running === "live"} style={{ padding: "6px 14px", background: "#EFF6FF", border: "none", borderRadius: 9, color: "#1D4ED8", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", opacity: running === "live" ? 0.7 : 1 }}>
                {running === "live" ? "Running…" : "📡 Run Live Check"}
              </button>
              <button onClick={handleRunLeadFlow} disabled={running === "lead"} style={{ padding: "6px 14px", background: "#F0FDF4", border: "none", borderRadius: 9, color: "#065F46", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", opacity: running === "lead" ? 0.7 : 1 }}>
                {running === "lead" ? "Testing…" : "🧪 Test Lead Flow"}
              </button>
            </div>
          </div>

          {/* Check cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {(active.checks || []).map(check => {
              const meta = CHECK_META[check.check_type] || { label: check.check_type, icon: "🔍", description: "" };
              const badge = statusBadge(check.status);
              const details = check.details || {};
              return (
                <div key={check.id} style={{ ...card, borderLeft: `4px solid ${check.status === "pass" ? "#10B981" : check.status === "fail" ? "#EF4444" : "#CBD5E1"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: "1.3rem" }}>{meta.icon}</span>
                      <div>
                        <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.88rem" }}>{meta.label}</div>
                        <div style={{ fontSize: "0.72rem", color: "#64748B" }}>{meta.description}</div>
                      </div>
                    </div>
                    <span style={{ background: badge.bg, color: badge.color, padding: "3px 10px", borderRadius: 99, fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap" }}>{badge.label}</span>
                  </div>

                  {check.run_at && <div style={{ fontSize: "0.7rem", color: "#94A3B8", marginBottom: 8 }}>Checked: {new Date(check.run_at).toLocaleString()}</div>}

                  {check.check_type === "lead_flow" && Array.isArray(details.steps) && (
                    <div>
                      {(details.steps as { step: string; result: string; note?: string; contact_id?: string; total?: number; error?: string }[]).map((step, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderBottom: "1px solid #F1F5F9" }}>
                          <span style={{ fontSize: "0.8rem" }}>{step.result === "pass" ? "✅" : step.result === "fail" ? "❌" : "⏭"}</span>
                          <div>
                            <div style={{ fontWeight: 600, color: "#0A1628", fontSize: "0.78rem" }}>{step.step}</div>
                            {step.note    && <div style={{ fontSize: "0.72rem", color: "#64748B" }}>{step.note}</div>}
                            {step.error   && <div style={{ fontSize: "0.72rem", color: "#DC2626" }}>Error: {step.error}</div>}
                          </div>
                        </div>
                      ))}
                      {details.test_email && <div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 6 }}>Test email: {String(details.test_email)}</div>}
                    </div>
                  )}

                  {(check.check_type === "live_data" || check.check_type === "spend" || check.check_type === "impressions") && (
                    <div>
                      {details.hours_since_launch != null && <div style={{ fontSize: "0.72rem", color: "#64748B", marginBottom: 6 }}>Hours since launch: {Number(details.hours_since_launch)}h · {details.campaigns_found as number || 0} campaign(s) found</div>}
                      {Array.isArray(details.issues) && (details.issues as string[]).map((issue, i) => (
                        <div key={i} style={{ fontSize: "0.75rem", color: "#DC2626", marginBottom: 4 }}>⚠️ {issue}</div>
                      ))}
                      {check.status === "pass" && <div style={{ fontSize: "0.75rem", color: "#059669" }}>✅ All campaigns are spending and serving impressions normally.</div>}
                      {Array.isArray(details.campaigns) && (details.campaigns as { id: number; name?: string; platform: string; status?: string; spend?: number; impressions?: number; daily_budget?: number }[]).slice(0, 3).map((c, i) => (
                        <div key={i} style={{ background: "#F8FAFF", borderRadius: 8, padding: "8px 12px", marginTop: 6, fontSize: "0.72rem", color: "#374151" }}>
                          <div style={{ fontWeight: 700 }}>{c.name || `Campaign #${c.id}`}</div>
                          <div>Status: {c.status || "—"} · Spend: ${c.spend ?? 0} · Impressions: {c.impressions ?? 0}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {check.status === "pending" && (
                    <div style={{ fontSize: "0.75rem", color: "#94A3B8", fontStyle: "italic" }}>Not run yet — click the button above to run this check.</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

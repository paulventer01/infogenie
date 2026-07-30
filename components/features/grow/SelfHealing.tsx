"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Rejection {
  id: number;
  platform: string;
  ad_id: string | null;
  ad_name: string | null;
  rejection_reason: string;
  rejection_code: string | null;
  policy_violated: string | null;
  original_copy: string | null;
  original_headline: string | null;
  status: "detected" | "healing" | "resubmitted" | "resolved";
  heal_attempts: number;
  detected_at: string;
  resolved_at: string | null;
  latest_healed_copy?: string;
  latest_confidence?: number;
}

interface HealResult {
  healed_headline: string;
  healed_copy: string;
  heal_strategy: string;
  policy_fixes: string[];
  confidence_pct: number;
}

const PLATFORMS = ["meta","google","tiktok","linkedin","microsoft","snapchat"];

const STATUS_CONFIG = {
  detected:    { label: "🔴 Detected",    bg: "#FEF2F2", color: "#DC2626" },
  healing:     { label: "🔄 Healing",     bg: "#FFF7ED", color: "#D97706" },
  resubmitted: { label: "🟡 Resubmitted", bg: "#FFFBEB", color: "#92400E" },
  resolved:    { label: "✅ Resolved",    bg: "#ECFDF5", color: "#065F46" },
};

export default function SelfHealing() {
  const [rejections, setRejections]     = useState<Rejection[]>([]);
  const [loading, setLoading]           = useState(true);
  const [active, setActive]             = useState<Rejection | null>(null);
  const [healResult, setHealResult]     = useState<HealResult | null>(null);
  const [healing, setHealing]           = useState(false);
  const [toast, setToast]               = useState("");
  const [tab, setTab]                   = useState<"history" | "new">("history");
  const [form, setForm]                 = useState({ platform: "meta", ad_name: "", rejection_reason: "", policy_violated: "", original_copy: "", original_headline: "" });

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiGet<{ ok: boolean; error?: string; rejections?: Rejection[] }>("/api/self-healing/history");
    if (r?.rejections) setRejections(r.rejections);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleReport() {
    if (!form.platform || !form.rejection_reason) { showToast("Platform and rejection reason are required."); return; }
    setHealing(true);
    const r = await apiPost<{ ok: boolean; error?: string; rejection?: Rejection }>("/api/self-healing/check", form);
    if (r?.ok && r.rejection) {
      const rej = r.rejection;
      showToast("✅ Rejection logged — click Heal to fix it.");
      setRejections(prev => [rej, ...prev]);
      setActive(rej);
      setHealResult(null);
      setTab("history");
    } else { showToast("Error logging rejection."); }
    setHealing(false);
  }

  async function handleHeal(id: number) {
    setHealing(true);
    setHealResult(null);
    const r = await apiPost<{ ok: boolean; error?: string; result?: HealResult } & Partial<HealResult>>(`/api/self-healing/heal/${id}`, {});
    if (r?.ok) {
      showToast("✅ AI healed the ad copy!");
      setHealResult(r.result || (r as unknown as HealResult));
      load();
    } else {
      showToast(r?.error?.includes("key") ? "⚠️ OpenAI key required — configure it in AI Providers." : "Heal failed — check OpenAI credentials.");
    }
    setHealing(false);
  }

  async function handleResolve(id: number) {
    const r = await apiPost(`/api/self-healing/resolve/${id}`, {});
    if (r?.ok) { showToast("Marked as resolved."); load(); setActive(null); }
  }

  const card:   React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 2px 8px rgba(10,20,50,.06)" };
  const input:  React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", boxSizing: "border-box" };
  const lbl:    React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 5 };
  const btnPri: React.CSSProperties = { padding: "10px 22px", background: "linear-gradient(135deg,#DC2626,#F97316)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" };

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: '#eef4ff', color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Grow › Autonomous Execution</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>🩹 Self-Healing Ad Accounts</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>When a platform rejects your ad, InfoGenie analyses the rejection reason, rewrites the copy to comply with platform policies, and prepares it for resubmission — with a confidence score.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {([["history","🔴 Rejection History"], ["new","➕ Log New Rejection"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#DC2626" : "transparent"}`, color: tab === t ? "#DC2626" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: "pointer", marginBottom: -2 }}>
            {label}{t === "history" ? ` (${rejections.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "new" && (
        <div style={{ maxWidth: 600 }}>
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>Log an Ad Rejection</div>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={lbl}>Platform *</label>
                <select style={input} value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}>
                  {PLATFORMS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Ad Name</label><input style={input} placeholder="Summer Sale Retargeting v3" value={form.ad_name} onChange={e => setForm(f => ({ ...f, ad_name: e.target.value }))} /></div>
              <div>
                <label style={lbl}>Rejection Reason * (paste platform message)</label>
                <textarea style={{ ...input, minHeight: 80, resize: "vertical" }} placeholder="e.g. 'Your ad was rejected because it makes claims about personal attributes...'" value={form.rejection_reason} onChange={e => setForm(f => ({ ...f, rejection_reason: e.target.value }))} />
              </div>
              <div><label style={lbl}>Policy Violated (if shown)</label><input style={input} placeholder="e.g. Personal Attributes Policy" value={form.policy_violated} onChange={e => setForm(f => ({ ...f, policy_violated: e.target.value }))} /></div>
              <div><label style={lbl}>Original Headline</label><input style={input} placeholder="The headline that was rejected" value={form.original_headline} onChange={e => setForm(f => ({ ...f, original_headline: e.target.value }))} /></div>
              <div>
                <label style={lbl}>Original Ad Copy</label>
                <textarea style={{ ...input, minHeight: 80, resize: "vertical" }} placeholder="The full ad body copy that was rejected" value={form.original_copy} onChange={e => setForm(f => ({ ...f, original_copy: e.target.value }))} />
              </div>
            </div>
            <button onClick={handleReport} disabled={healing} style={{ ...btnPri, marginTop: 14, width: "100%", opacity: healing ? 0.7 : 1 }}>
              {healing ? "Logging…" : "🩹 Log Rejection & Auto-Heal"}
            </button>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div style={{ display: "grid", gridTemplateColumns: active ? "380px 1fr" : "1fr", gap: 20 }}>
          {/* List */}
          <div>
            {loading ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 60 }}>Loading…</div> :
              rejections.length === 0 ? (
                <div style={{ ...card, textAlign: "center", padding: "50px 20px" }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>🩹</div>
                  <div style={{ fontWeight: 700, color: "#0A1628" }}>No rejections logged</div>
                  <div style={{ color: "#64748B", fontSize: "0.82rem", marginTop: 4 }}>Switch to &ldquo;Log New Rejection&rdquo; to add your first one.</div>
                </div>
              ) : rejections.map(r => {
                const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.detected;
                return (
                  <div key={r.id} onClick={() => { setActive(r); setHealResult(null); }} style={{ ...card, cursor: "pointer", borderLeft: `4px solid ${sc.color}`, background: active?.id === r.id ? "#F8FAFF" : "#fff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.88rem", marginBottom: 2 }}>{r.ad_name || `Ad #${r.id}`}</div>
                        <div style={{ color: "#64748B", fontSize: "0.72rem" }}>{r.platform} · {new Date(r.detected_at).toLocaleDateString()}</div>
                        <div style={{ color: "#374151", fontSize: "0.76rem", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.rejection_reason}</div>
                      </div>
                      <span style={{ background: sc.bg, color: sc.color, padding: "3px 9px", borderRadius: 99, fontSize: "0.68rem", fontWeight: 700, whiteSpace: "nowrap", marginLeft: 10 }}>{sc.label}</span>
                    </div>
                    {r.latest_confidence != null && Number(r.latest_confidence) > 0 && (
                      <div style={{ marginTop: 8, fontSize: "0.72rem", color: "#059669" }}>✅ Healed · {r.latest_confidence}% confidence</div>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Detail panel */}
          {active && (
            <div>
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 900, fontSize: "1rem", color: "#0A1628" }}>{active.ad_name || `Ad #${active.id}`}</div>
                    <div style={{ color: "#64748B", fontSize: "0.75rem" }}>{active.platform} · Rejected {new Date(active.detected_at).toLocaleString()}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => handleHeal(active.id)} disabled={healing} style={{ padding: "7px 16px", background: "#DC2626", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", opacity: healing ? 0.7 : 1 }}>
                      {healing ? "Healing…" : "🩹 AI Heal Now"}
                    </button>
                    {active.status !== "resolved" && <button onClick={() => handleResolve(active.id)} style={{ padding: "7px 14px", background: "#ECFDF5", border: "none", borderRadius: 8, color: "#065F46", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>✅ Mark Resolved</button>}
                  </div>
                </div>

                {/* Original copy */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>🔴 Rejection Reason</div>
                  <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 9, padding: "10px 14px", fontSize: "0.82rem", color: "#7F1D1D" }}>{active.rejection_reason}</div>
                  {active.policy_violated && <div style={{ marginTop: 6, fontSize: "0.72rem", color: "#DC2626" }}>Policy: {active.policy_violated}</div>}
                </div>

                {(active.original_headline || active.original_copy) && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Original Ad Copy</div>
                    {active.original_headline && <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.88rem", marginBottom: 4 }}>{active.original_headline}</div>}
                    {active.original_copy && <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9, padding: "10px 14px", fontSize: "0.82rem", color: "#374151", whiteSpace: "pre-wrap" }}>{active.original_copy}</div>}
                  </div>
                )}

                {/* Healed copy */}
                {healResult && (
                  <div style={{ background: "#ECFDF5", border: "1px solid #6EE7B7", borderRadius: 12, padding: "16px 18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#065F46", fontSize: "0.9rem" }}>✅ Healed Ad Copy</div>
                      <span style={{ background: "#065F46", color: "#fff", padding: "3px 10px", borderRadius: 99, fontSize: "0.72rem", fontWeight: 700 }}>{healResult.confidence_pct}% confidence</span>
                    </div>
                    {healResult.healed_headline && <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 8 }}>{healResult.healed_headline}</div>}
                    <div style={{ fontSize: "0.82rem", color: "#374151", lineHeight: 1.6, marginBottom: 12, whiteSpace: "pre-wrap" }}>{healResult.healed_copy}</div>
                    <div style={{ fontSize: "0.75rem", color: "#065F46", marginBottom: 8, fontStyle: "italic" }}>Strategy: {healResult.heal_strategy}</div>
                    {healResult.policy_fixes?.length > 0 && (
                      <div>
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", marginBottom: 4 }}>Policy fixes applied:</div>
                        {healResult.policy_fixes.map((fix, i) => <div key={i} style={{ fontSize: "0.75rem", color: "#374151", marginBottom: 3 }}>• {fix}</div>)}
                      </div>
                    )}
                    <button onClick={() => navigator.clipboard.writeText(`${healResult.healed_headline}\n\n${healResult.healed_copy}`)} style={{ marginTop: 10, padding: "6px 14px", background: "#065F46", border: "none", borderRadius: 7, color: "#fff", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer" }}>📋 Copy Healed Copy</button>
                  </div>
                )}

                {!healResult && active.latest_healed_copy && (
                  <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 9, padding: "12px 14px", fontSize: "0.82rem", color: "#374151" }}>
                    <div style={{ fontWeight: 700, color: "#065F46", marginBottom: 6 }}>Last Healed Copy ({active.latest_confidence}% confidence)</div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{active.latest_healed_copy}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

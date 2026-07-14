"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface ChecklistItem {
  id: number;
  checklist_id: number;
  category: string;
  item: string;
  status: "pending" | "pass" | "fail" | "na";
  notes: string | null;
  order_idx: number;
}

interface Checklist {
  id: number;
  campaign_name: string;
  platform: string;
  landing_page_url: string | null;
  ad_copy: string | null;
  status: string;
  brand_score: number | null;
  ai_feedback: {
    overall_score?: number;
    issues?: { severity: string; text: string }[];
    improved_copy?: string;
    summary?: string;
    _estimated?: boolean;
  } | null;
  overall_result: string | null;
  created_at: string;
  items?: ChecklistItem[];
  pass_count?: number;
  fail_count?: number;
  pending_count?: number;
  total_count?: number;
}

const CATEGORIES = [
  { id: "brand",  icon: "🎨", label: "Brand Alignment",     color: "#7C3AED" },
  { id: "copy",   icon: "✏️",  label: "Copy & Proofreading", color: "#0066FF" },
  { id: "legal",  icon: "⚖️",  label: "Legal & Compliance",  color: "#DC2626" },
  { id: "mobile", icon: "📱",  label: "Mobile Responsive",   color: "#059669" },
];

const PLATFORMS = ["meta","google","linkedin","tiktok","microsoft","email","general"];

const STATUS_CONFIG = {
  pending: { label: "Pending",  bg: "#F8FAFC", border: "#CBD5E1", dot: "#94A3B8" },
  pass:    { label: "✅ Pass",   bg: "#ECFDF5", border: "#6EE7B7", dot: "#059669" },
  fail:    { label: "❌ Fail",   bg: "#FEF2F2", border: "#FECACA", dot: "#DC2626" },
  na:      { label: "N/A",      bg: "#F8FAFC", border: "#E2E8F0", dot: "#94A3B8" },
};

function overallBadge(result: string | null) {
  if (result === "passed")     return { bg: "#ECFDF5", color: "#065F46", label: "✅ Passed" };
  if (result === "failed")     return { bg: "#FEF2F2", color: "#DC2626", label: "❌ Failed" };
  if (result === "in_progress") return { bg: "#FFF7ED", color: "#92400E", label: "⏳ In Progress" };
  return { bg: "#F1F5F9", color: "#475569", label: "🕐 Not Started" };
}

export default function LaunchCompliance() {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [active, setActive]         = useState<Checklist | null>(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [tab, setTab]               = useState<"list" | "detail">("list");
  const [catTab, setCatTab]         = useState("brand");
  const [copyPreview, setCopyPreview] = useState(false);
  const [toast, setToast]           = useState("");
  const [form, setForm]             = useState({ campaign_name: "", platform: "general", landing_page_url: "", ad_copy: "" });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiGet<{ ok: boolean; error?: string; checklists?: Checklist[] }>("/api/launch-compliance/checklists");
    if (r?.checklists) setChecklists(r.checklists);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadDetail(id: number) {
    const r = await apiGet<{ ok: boolean; error?: string; checklist?: Checklist }>(`/api/launch-compliance/checklists/${id}`);
    if (r?.checklist) { setActive(r.checklist); setTab("detail"); setCatTab("brand"); }
  }

  async function handleCreate() {
    if (!form.campaign_name) { showToast("Campaign name is required."); return; }
    setSaving(true);
    const r = await apiPost<{ ok: boolean; error?: string; checklist?: Checklist }>("/api/launch-compliance/checklists", form);
    if (r?.ok) {
      showToast("✅ Checklist created!");
      setForm({ campaign_name: "", platform: "general", landing_page_url: "", ad_copy: "" });
      load();
      setActive(r.checklist ?? null);
      setTab("detail");
    } else { showToast("Error creating checklist."); }
    setSaving(false);
  }

  async function handleItemUpdate(itemId: number, status: string, notes?: string) {
    if (!active) return;
    const r = await apiPost<{ ok: boolean; error?: string; overall_result?: string | null }>(`/api/launch-compliance/items/${itemId}`, { status, notes: notes ?? undefined });
    if (r?.ok) {
      setActive(prev => prev ? {
        ...prev,
        overall_result: r.overall_result ?? prev.overall_result,
        items: prev.items?.map(i => i.id === itemId ? { ...i, status: status as ChecklistItem["status"], notes: notes || i.notes } : i),
      } : null);
      setChecklists(prev => prev.map(c => c.id === active.id ? { ...c, overall_result: r.overall_result ?? c.overall_result } : c));
    }
  }

  async function handleProofread() {
    if (!active) return;
    setSaving(true);
    const r = await apiPost<{ ok: boolean; error?: string; feedback?: Checklist["ai_feedback"] }>(`/api/launch-compliance/checklists/${active.id}/proofread`, { ad_copy: active.ad_copy });
    if (r?.ok) {
      setActive(prev => prev ? { ...prev, ai_feedback: r.feedback ?? null } : null);
      showToast("✅ AI proofreading complete!");
      setCopyPreview(true);
    } else { showToast(r?.error || "Proofread failed."); }
    setSaving(false);
  }

  async function handleBrandCheck() {
    if (!active) return;
    setSaving(true);
    const r = await apiPost<{ ok: boolean; error?: string; brand_score?: number | null; brand_found?: boolean }>(`/api/launch-compliance/checklists/${active.id}/brand-check`, {});
    if (r?.ok) {
      setActive(prev => prev ? { ...prev, brand_score: r.brand_score ?? null } : null);
      showToast(r.brand_found ? `✅ Brand score: ${r.brand_score}/10` : "⚠️ No Brand Foundation found — add one in Brand Foundation.");
    } else { showToast("Brand check failed."); }
    setSaving(false);
  }

  async function handleDelete(id: number) {
    await apiDelete(`/api/launch-compliance/checklists/${id}`);
    setChecklists(prev => prev.filter(c => c.id !== id));
    if (active?.id === id) { setActive(null); setTab("list"); }
    showToast("Deleted.");
  }

  const card:   React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 2px 8px rgba(10,20,50,.06)" };
  const input:  React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", boxSizing: "border-box" };
  const lbl:    React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 5 };
  const btnPri: React.CSSProperties = { padding: "10px 22px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" };

  const activeItems = active?.items?.filter(i => i.category === catTab) || [];
  const catBadge = CATEGORIES.find(c => c.id === catTab);

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "#0A1628", color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Grow › Launch Compliance</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>✅ Launch Compliance Checklist</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>Pre-launch review across brand alignment, AI proofreading, legal sign-off, and mobile responsiveness. Every campaign must pass before it goes live.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {([["list","📋 All Checklists"], ["detail","🔍 Detail"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} disabled={t === "detail" && !active} style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#0066FF" : "transparent"}`, color: tab === t ? "#0066FF" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: t === "detail" && !active ? "default" : "pointer", opacity: t === "detail" && !active ? 0.4 : 1, marginBottom: -2 }}>
            {label}{t === "detail" && active ? ` — ${active.campaign_name}` : ""}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 20 }}>
          {/* Create form */}
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 14 }}>➕ New Checklist</div>
            <div style={{ display: "grid", gap: 11 }}>
              <div><label style={lbl}>Campaign Name *</label><input style={input} placeholder="Q3 Meta Brand Campaign" value={form.campaign_name} onChange={e => setForm(f => ({ ...f, campaign_name: e.target.value }))} /></div>
              <div>
                <label style={lbl}>Platform</label>
                <select style={input} value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}>
                  {PLATFORMS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Landing Page URL</label><input style={input} placeholder="https://yourdomain.com/landing" value={form.landing_page_url} onChange={e => setForm(f => ({ ...f, landing_page_url: e.target.value }))} /></div>
              <div>
                <label style={lbl}>Ad Copy</label>
                <textarea style={{ ...input, minHeight: 90, resize: "vertical" }} placeholder="Paste your ad headline and body copy here for AI proofreading…" value={form.ad_copy} onChange={e => setForm(f => ({ ...f, ad_copy: e.target.value }))} />
              </div>
            </div>
            <button onClick={handleCreate} disabled={saving} style={{ ...btnPri, marginTop: 14, width: "100%", opacity: saving ? 0.7 : 1 }}>{saving ? "Creating…" : "✅ Start Compliance Review"}</button>
          </div>

          {/* List */}
          <div>
            {loading ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 60 }}>Loading…</div> :
              checklists.length === 0 ? (
                <div style={{ ...card, textAlign: "center", padding: "50px 20px" }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>✅</div>
                  <div style={{ fontWeight: 700, color: "#0A1628", marginBottom: 4 }}>No compliance reviews yet</div>
                  <div style={{ color: "#64748B", fontSize: "0.82rem" }}>Create your first checklist to start pre-launch review.</div>
                </div>
              ) : checklists.map(c => {
                const badge = overallBadge(c.overall_result);
                const passN = Number(c.pass_count || 0);
                const totalN = Number(c.total_count || 18);
                const pct = totalN ? Math.round((passN / totalN) * 100) : 0;
                return (
                  <div key={c.id} style={{ ...card, cursor: "pointer", borderLeft: `4px solid ${c.overall_result === "passed" ? "#10B981" : c.overall_result === "failed" ? "#EF4444" : "#F59E0B"}` }} onClick={() => loadDetail(c.id)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem" }}>{c.campaign_name}</div>
                        <div style={{ color: "#64748B", fontSize: "0.78rem", marginTop: 3 }}>{c.platform} · {new Date(c.created_at).toLocaleDateString()}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ background: badge.bg, color: badge.color, padding: "3px 10px", borderRadius: 99, fontSize: "0.72rem", fontWeight: 700 }}>{badge.label}</span>
                        <button onClick={e => { e.stopPropagation(); handleDelete(c.id); }} style={{ background: "#FEF2F2", border: "none", borderRadius: 6, color: "#DC2626", padding: "4px 8px", fontSize: "0.72rem", cursor: "pointer" }}>🗑</button>
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#64748B", marginBottom: 4 }}>
                        <span>{passN} of {totalN} items passed</span>
                        <span>{pct}%</span>
                      </div>
                      <div style={{ background: "#F1F5F9", borderRadius: 99, height: 6 }}>
                        <div style={{ background: pct === 100 ? "#10B981" : "#0066FF", borderRadius: 99, height: "100%", width: `${pct}%`, transition: "width .3s" }} />
                      </div>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 10, fontSize: "0.72rem", color: "#64748B" }}>
                      {c.brand_score != null && <span>🎨 Brand {c.brand_score}/10</span>}
                      <span>✅ {passN} pass</span>
                      <span>❌ {c.fail_count || 0} fail</span>
                      <span>⏳ {c.pending_count || 0} pending</span>
                    </div>
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
              <div style={{ color: "#64748B", fontSize: "0.78rem" }}>{active.platform} · {active.landing_page_url || "No landing page URL set"}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(() => { const b = overallBadge(active.overall_result); return <span style={{ background: b.bg, color: b.color, padding: "6px 14px", borderRadius: 99, fontSize: "0.82rem", fontWeight: 700 }}>{b.label}</span>; })()}
              {active.brand_score != null && <span style={{ background: "#EDE9FE", color: "#7C3AED", padding: "6px 14px", borderRadius: 99, fontSize: "0.82rem", fontWeight: 700 }}>🎨 Brand {active.brand_score}/10</span>}
              <button onClick={handleBrandCheck} disabled={saving} style={{ padding: "6px 14px", background: "#EDE9FE", border: "none", borderRadius: 9, color: "#7C3AED", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>🎨 Brand Check</button>
              <button onClick={handleProofread} disabled={saving} style={{ padding: "6px 14px", background: "#EFF6FF", border: "none", borderRadius: 9, color: "#1D4ED8", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>🤖 AI Proofread</button>
            </div>
          </div>

          {/* Category tabs + items */}
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
            {/* Category sidebar */}
            <div>
              {CATEGORIES.map(cat => {
                const catItems = active.items?.filter(i => i.category === cat.id) || [];
                const passed = catItems.filter(i => i.status === "pass").length;
                const failed = catItems.filter(i => i.status === "fail").length;
                const total  = catItems.length;
                return (
                  <div key={cat.id} onClick={() => setCatTab(cat.id)} style={{ ...card, cursor: "pointer", padding: "14px 18px", borderLeft: `4px solid ${catTab === cat.id ? cat.color : "transparent"}`, background: catTab === cat.id ? "#F8FAFF" : "#fff" }}>
                    <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.88rem" }}>{cat.icon} {cat.label}</div>
                    <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 4 }}>{passed}/{total} passed{failed > 0 ? ` · ${failed} failed` : ""}</div>
                    <div style={{ background: "#F1F5F9", borderRadius: 99, height: 4, marginTop: 8 }}>
                      <div style={{ background: cat.color, borderRadius: 99, height: "100%", width: total ? `${Math.round((passed/total)*100)}%` : "0%" }} />
                    </div>
                  </div>
                );
              })}

              {/* Mobile preview */}
              {active.landing_page_url && (
                <div style={card}>
                  <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.82rem", marginBottom: 10 }}>📱 Mobile Preview</div>
                  <div style={{ background: "#0F172A", borderRadius: 20, padding: "10px 6px", display: "inline-block", width: "100%", boxSizing: "border-box" }}>
                    <div style={{ background: "#1E293B", borderRadius: 4, height: 8, margin: "0 auto 8px", width: 40 }} />
                    <iframe src={active.landing_page_url} style={{ width: "100%", height: 280, border: "none", borderRadius: 10, display: "block" }} sandbox="allow-scripts allow-same-origin" title="Mobile preview" />
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 8 }}>
                      <div style={{ background: "#1E293B", borderRadius: 4, height: 6, width: 40 }} />
                    </div>
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "#64748B", textAlign: "center", marginTop: 6 }}>~390px (iPhone 14 width)</div>
                </div>
              )}
            </div>

            {/* Items for active category */}
            <div>
              <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 14 }}>
                {catBadge?.icon} {catBadge?.label} — {activeItems.filter(i => i.status === "pass").length} of {activeItems.length} passed
              </div>

              {activeItems.map(item => {
                const sc = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
                return (
                  <div key={item.id} style={{ background: sc.bg, border: `1px solid ${sc.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10, display: "flex", alignItems: "flex-start", gap: 14 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: sc.dot, marginTop: 4, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: "#0A1628", fontSize: "0.85rem" }}>{item.item}</div>
                      {item.notes && <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 4, fontStyle: "italic" }}>{item.notes}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {(["pass","fail","na"] as const).map(s => (
                        <button key={s} onClick={() => handleItemUpdate(item.id, s)} style={{ padding: "5px 10px", background: item.status === s ? (s === "pass" ? "#059669" : s === "fail" ? "#DC2626" : "#64748B") : "#F1F5F9", border: "none", borderRadius: 6, color: item.status === s ? "#fff" : "#374151", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer" }}>
                          {s === "pass" ? "✅" : s === "fail" ? "❌" : "N/A"}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* AI Feedback panel for copy tab */}
              {catTab === "copy" && active.ai_feedback && (
                <div style={{ ...card, background: "#FFFBEB", border: "1px solid #FDE68A", marginTop: 16 }}>
                  <div style={{ fontWeight: 800, color: "#92400E", fontSize: "0.88rem", marginBottom: 10 }}>
                    🤖 AI Proofreading Result{active.ai_feedback._estimated ? " (no AI key — template)" : active.ai_feedback.overall_score != null ? ` · Score ${active.ai_feedback.overall_score}/10` : ""}
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "#78350F", marginBottom: 12, fontStyle: "italic" }}>{active.ai_feedback.summary}</div>
                  {active.ai_feedback.issues?.map((issue, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                      <span style={{ fontSize: "0.72rem", fontWeight: 700, color: issue.severity === "error" ? "#DC2626" : issue.severity === "warning" ? "#D97706" : "#059669", whiteSpace: "nowrap" }}>{issue.severity === "error" ? "🔴 ERROR" : issue.severity === "warning" ? "🟡 WARN" : "🟢 TIP"}</span>
                      <span style={{ fontSize: "0.78rem", color: "#374151" }}>{issue.text}</span>
                    </div>
                  ))}
                  {active.ai_feedback.improved_copy && (
                    <div style={{ marginTop: 12 }}>
                      <button onClick={() => setCopyPreview(v => !v)} style={{ fontSize: "0.75rem", color: "#92400E", background: "transparent", border: "none", fontWeight: 700, cursor: "pointer" }}>{copyPreview ? "▲ Hide" : "▼ Show"} Improved Copy</button>
                      {copyPreview && <div style={{ background: "#fff", border: "1px solid #FDE68A", borderRadius: 8, padding: "10px 14px", fontSize: "0.8rem", color: "#374151", lineHeight: 1.6, marginTop: 8, whiteSpace: "pre-wrap" }}>{active.ai_feedback.improved_copy}</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

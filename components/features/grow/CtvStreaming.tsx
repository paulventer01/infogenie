"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Platform {
  id: string;
  name: string;
  type: "ctv" | "streaming_audio";
  min_budget: number;
}

interface Campaign {
  id: number;
  name: string;
  platform: string;
  campaign_type: string;
  objective: string;
  budget: number;
  daily_budget: number;
  status: string;
  projected_reach: number;
  projected_cpm: number;
  start_date: string | null;
  creative_brief: string | null;
  created_at: string;
}

const OBJECTIVE_LABELS: Record<string, string> = {
  brand_awareness: "Brand Awareness", reach_frequency: "Reach & Frequency",
  video_completion: "Video Completion Rate", website_traffic: "Website Traffic",
  app_install: "App Install", purchase: "Purchase / Conversion",
};

const STATUS_CONFIG: Record<string, { bg: string; color: string; label: string }> = {
  draft:   { bg: "#F1F5F9", color: "#64748B", label: "📝 Draft" },
  active:  { bg: "#ECFDF5", color: "#065F46", label: "▶️ Active" },
  paused:  { bg: "#FFF7ED", color: "#D97706", label: "⏸ Paused" },
  completed: { bg: "#F0F9FF", color: "#0369A1", label: "✅ Complete" },
};

export default function CtvStreaming() {
  const [campaigns, setCampaigns]       = useState<Campaign[]>([]);
  const [platforms, setPlatforms]       = useState<Platform[]>([]);
  const [objectives, setObjectives]     = useState<string[]>([]);
  const [loading, setLoading]           = useState(true);
  const [active, setActive]             = useState<Campaign | null>(null);
  const [brief, setBrief]               = useState<string | null>(null);
  const [genBrief, setGenBrief]         = useState(false);
  const [saving, setSaving]             = useState(false);
  const [toast, setToast]               = useState("");
  const [tab, setTab]                   = useState<"campaigns" | "new">("campaigns");
  const [typeFilter, setTypeFilter]     = useState<"all" | "ctv" | "streaming_audio">("all");
  const [briefForm, setBriefForm]       = useState({ brand_name: "", industry: "", target_audience: "", key_message: "" });
  const [form, setForm] = useState({ name: "", platform: "roku", objective: "brand_awareness", budget: "", daily_budget: "", start_date: "", end_date: "" });

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    const [cfg, cmp] = await Promise.all([
      apiGet<{ ok: boolean; error?: string; platforms?: Platform[]; objectives?: string[] }>("/api/ctv/config"),
      apiGet<{ ok: boolean; error?: string; campaigns?: Campaign[] }>("/api/ctv/campaigns"),
    ]);
    if (cfg?.platforms) { setPlatforms(cfg.platforms); setObjectives(cfg.objectives || []); setForm(f => ({ ...f, platform: cfg.platforms![0]?.id || "roku" })); }
    if (cmp?.campaigns) setCampaigns(cmp.campaigns);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!form.name || !form.platform) { showToast("Name and platform required."); return; }
    setSaving(true);
    const r = await apiPost<{ ok: boolean; error?: string; campaign?: Campaign }>("/api/ctv/campaigns/create", { ...form, budget: form.budget ? +form.budget : undefined, daily_budget: form.daily_budget ? +form.daily_budget : undefined });
    if (r?.ok && r.campaign) {
      const created = r.campaign;
      showToast("✅ Campaign created!");
      setCampaigns(prev => [created, ...prev]);
      setActive(created);
      setBrief(null);
      setTab("campaigns");
    } else { showToast("Error creating campaign."); }
    setSaving(false);
  }

  async function handleGenerateBrief(id: number) {
    if (!briefForm.brand_name && !briefForm.key_message) { showToast("Enter brand name or key message first."); return; }
    setGenBrief(true);
    const r = await apiPost<{ ok: boolean; error?: string; brief?: string; ad_copy?: string }>(`/api/ctv/campaigns/${id}/ai-brief`, briefForm);
    if (r?.ok) {
      setBrief(r.brief || r.ad_copy || JSON.stringify(r, null, 2));
      showToast("✅ AI creative brief generated!");
    } else {
      showToast(r?.error?.includes("key") ? "⚠️ OpenAI key required — configure it in AI Providers." : "Brief generation failed.");
    }
    setGenBrief(false);
  }

  async function handleToggleStatus(id: number, current: string) {
    const next = current === "active" ? "paused" : "active";
    const r = await apiPost(`/api/ctv/campaigns/${id}/status`, { status: next });
    if (r?.ok) {
      setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: next } : c));
      if (active?.id === id) setActive(a => a ? { ...a, status: next } : a);
    }
  }

  const card:   React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 2px 8px rgba(10,20,50,.06)" };
  const input:  React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", boxSizing: "border-box" };
  const lbl:    React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 5 };
  const btnPri: React.CSSProperties = { padding: "10px 22px", background: "linear-gradient(135deg,#7C3AED,#0066FF)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" };

  const filtered = campaigns.filter(c => typeFilter === "all" ? true : c.campaign_type === typeFilter);

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: '#eef4ff', color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Grow › Next-Gen Ad Channels</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>📺 CTV & Streaming Audio</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>Launch campaigns on Connected TV (Roku, Hulu, Amazon Fire TV, YouTube TV) and streaming audio (Spotify, Pandora, iHeartRadio). AI generates TV scripts and audio creative briefs.</p>
      </div>

      {/* Platform pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {[["all","All Channels"],["ctv","📺 Connected TV"],["streaming_audio","🎵 Streaming Audio"]].map(([t, label]) => (
          <button key={t} onClick={() => setTypeFilter(t as "all"|"ctv"|"streaming_audio")} style={{ padding: "6px 14px", background: typeFilter === t ? "#7C3AED" : "#F1F5F9", color: typeFilter === t ? "#fff" : "#374151", border: "none", borderRadius: 99, fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>{label}</button>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {([["campaigns","📋 Campaigns"], ["new","➕ New Campaign"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#7C3AED" : "transparent"}`, color: tab === t ? "#7C3AED" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: "pointer", marginBottom: -2 }}>
            {label}{t === "campaigns" ? ` (${filtered.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "new" && (
        <div style={{ maxWidth: 620 }}>
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>Create CTV / Streaming Audio Campaign</div>
            <div style={{ display: "grid", gap: 12 }}>
              <div><label style={lbl}>Campaign Name *</label><input style={input} placeholder="Summer Brand Awareness — Roku" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div>
                <label style={lbl}>Platform *</label>
                <select style={input} value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}>
                  {platforms.map(p => <option key={p.id} value={p.id}>{p.name} {p.type === "streaming_audio" ? "🎵" : "📺"} · Min ${p.min_budget.toLocaleString()}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Objective</label>
                <select style={input} value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))}>
                  {(objectives.length ? objectives : Object.keys(OBJECTIVE_LABELS)).map(o => <option key={o} value={o}>{OBJECTIVE_LABELS[o] || o}</option>)}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={lbl}>Total Budget ($)</label><input style={input} type="number" placeholder="5000" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} /></div>
                <div><label style={lbl}>Daily Budget ($)</label><input style={input} type="number" placeholder="167" value={form.daily_budget} onChange={e => setForm(f => ({ ...f, daily_budget: e.target.value }))} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={lbl}>Start Date</label><input style={input} type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
                <div><label style={lbl}>End Date</label><input style={input} type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
              </div>
            </div>
            <button onClick={handleCreate} disabled={saving} style={{ ...btnPri, marginTop: 14, width: "100%", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Creating…" : "📺 Create Campaign"}
            </button>
          </div>
        </div>
      )}

      {tab === "campaigns" && (
        <div style={{ display: "grid", gridTemplateColumns: active ? "1fr 440px" : "1fr", gap: 20 }}>
          <div>
            {loading ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 60 }}>Loading…</div> :
              filtered.length === 0 ? (
                <div style={{ ...card, textAlign: "center", padding: "50px 20px" }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>📺</div>
                  <div style={{ fontWeight: 700, color: "#0A1628" }}>No CTV campaigns yet</div>
                  <div style={{ color: "#64748B", fontSize: "0.82rem", marginTop: 4 }}>Create your first campaign to reach cord-cutters and streaming listeners.</div>
                </div>
              ) : filtered.map(c => {
                const sc = STATUS_CONFIG[c.status] || STATUS_CONFIG.draft;
                const plat = platforms.find(p => p.id === c.platform);
                return (
                  <div key={c.id} onClick={() => { setActive(c); setBrief(c.creative_brief || null); setBriefForm({ brand_name: "", industry: "", target_audience: "", key_message: "" }); }} style={{ ...card, cursor: "pointer", borderLeft: `4px solid ${c.campaign_type === "streaming_audio" ? "#7C3AED" : "#0066FF"}`, background: active?.id === c.id ? "#F8FAFF" : "#fff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.9rem" }}>{c.name}</div>
                        <div style={{ color: "#64748B", fontSize: "0.72rem", marginTop: 2 }}>{plat?.name || c.platform} · {OBJECTIVE_LABELS[c.objective] || c.objective} · Created {new Date(c.created_at).toLocaleDateString()}</div>
                      </div>
                      <span style={{ background: sc.bg, color: sc.color, padding: "3px 9px", borderRadius: 99, fontSize: "0.68rem", fontWeight: 700 }}>{sc.label}</span>
                    </div>
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, textAlign: "center" }}>
                      {[["💰 Budget", `$${Number(c.budget).toLocaleString()}`], ["📅 Daily", `$${Number(c.daily_budget).toFixed(0)}/d`], ["👁 Reach", c.projected_reach ? (c.projected_reach > 1000000 ? `${(c.projected_reach/1e6).toFixed(1)}M` : `${(c.projected_reach/1000).toFixed(0)}K`) : "—"], ["💲 CPM", `$${Number(c.projected_cpm).toFixed(2)}`]].map(([label, val]) => (
                        <div key={label as string} style={{ background: "#F8FAFC", borderRadius: 8, padding: "6px 4px" }}>
                          <div style={{ fontSize: "0.68rem", color: "#64748B" }}>{label}</div>
                          <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.82rem" }}>{val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Detail panel */}
          {active && (
            <div>
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 900, color: "#0A1628", fontSize: "0.95rem" }}>{active.name}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => handleToggleStatus(active.id, active.status)} style={{ padding: "5px 12px", background: active.status === "active" ? "#FFF7ED" : "#ECFDF5", border: "none", borderRadius: 7, color: active.status === "active" ? "#D97706" : "#065F46", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer" }}>
                      {active.status === "active" ? "⏸ Pause" : "▶️ Activate"}
                    </button>
                    <button onClick={() => setActive(null)} style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer" }}>✕</button>
                  </div>
                </div>

                {/* AI Brief Generator */}
                <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
                  <div style={{ fontWeight: 800, color: "#7C3AED", fontSize: "0.82rem", marginBottom: 10 }}>🤖 AI Creative Brief Generator</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <input style={{ ...input, fontSize: "0.78rem" }} placeholder="Brand name" value={briefForm.brand_name} onChange={e => setBriefForm(f => ({ ...f, brand_name: e.target.value }))} />
                    <input style={{ ...input, fontSize: "0.78rem" }} placeholder="Industry (e.g. Fintech, Fashion)" value={briefForm.industry} onChange={e => setBriefForm(f => ({ ...f, industry: e.target.value }))} />
                    <input style={{ ...input, fontSize: "0.78rem" }} placeholder="Target audience" value={briefForm.target_audience} onChange={e => setBriefForm(f => ({ ...f, target_audience: e.target.value }))} />
                    <input style={{ ...input, fontSize: "0.78rem" }} placeholder="Key message / offer" value={briefForm.key_message} onChange={e => setBriefForm(f => ({ ...f, key_message: e.target.value }))} />
                  </div>
                  <button onClick={() => handleGenerateBrief(active.id)} disabled={genBrief} style={{ marginTop: 10, width: "100%", padding: "8px", background: "#7C3AED", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", opacity: genBrief ? 0.7 : 1 }}>
                    {genBrief ? "Generating…" : active.campaign_type === "streaming_audio" ? "🎵 Generate Audio Script" : "📺 Generate 30s TV Script"}
                  </button>
                </div>

                {brief && (
                  <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontWeight: 800, color: "#92400E", fontSize: "0.82rem", marginBottom: 8 }}>
                      {active.campaign_type === "streaming_audio" ? "🎵 Audio Script" : "📺 30-Second TV Script"}
                    </div>
                    <div style={{ fontSize: "0.79rem", color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{brief}</div>
                    <button onClick={() => navigator.clipboard.writeText(brief)} style={{ marginTop: 10, padding: "5px 12px", background: "#92400E", border: "none", borderRadius: 7, color: "#fff", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer" }}>📋 Copy Script</button>
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

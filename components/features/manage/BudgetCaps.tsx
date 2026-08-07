"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPut } from "@/lib/api";

interface Cap {
  id: number;
  platform: string;
  daily_cap: number | null;
  lifetime_cap: number | null;
  alert_threshold_pct: number;
  paused_at_limit: boolean;
  updated_at: string;
}

interface SpendInfo {
  daily_budget: number;
  lifetime_budget: number;
  total_spend: number;
  campaign_count: number;
}

interface Campaign {
  id: number;
  name: string;
  platform: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  total_spend: number;
  optimizer_enabled: boolean;
  status: string | null;
}

const PLATFORMS = ["google", "meta", "tiktok", "microsoft", "linkedin"];
const PLATFORM_META: Record<string, { label: string; icon: string; color: string }> = {
  google:    { label: "Google Ads",    icon: "🔵", color: "#4285F4" },
  meta:      { label: "Meta Ads",      icon: "🟦", color: "#1877F2" },
  tiktok:    { label: "TikTok Ads",    icon: "⬛", color: "#010101" },
  microsoft: { label: "Microsoft Ads", icon: "🟩", color: "#00A4EF" },
  linkedin:  { label: "LinkedIn Ads",  icon: "🔷", color: "#0A66C2" },
};

function pct(spend: number, cap: number | null) {
  if (!cap || cap <= 0) return 0;
  return Math.min(100, Math.round((spend / cap) * 100));
}

function fmtMoney(v: number | null | undefined) {
  if (v == null) return "—";
  return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function BudgetCaps({ embedded = false }: { embedded?: boolean } = {}) {
  const [caps, setCaps] = useState<Cap[]>([]);
  const [spend, setSpend] = useState<Record<string, SpendInfo>>({});
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<"platform" | "campaigns">("platform");
  const [editing, setEditing] = useState<Record<string, { daily: string; lifetime: string; threshold: string; pause: boolean }>>({});

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    const [capsR, campsR] = await Promise.all([
      apiGet<{ ok: boolean; error?: string; caps?: Cap[]; spend_by_platform?: Record<string, SpendInfo> }>("/api/budget/caps"),
      apiGet<{ ok: boolean; error?: string; campaigns?: Campaign[] }>("/api/budget/caps/campaigns"),
    ]);
    if (capsR?.caps) setCaps(capsR.caps);
    if (capsR?.spend_by_platform) setSpend(capsR.spend_by_platform);
    if (campsR?.campaigns) setCampaigns(campsR.campaigns);
    const initEdit: typeof editing = {};
    for (const plat of PLATFORMS) {
      const c = (capsR?.caps as Cap[])?.find((x: Cap) => x.platform === plat);
      initEdit[plat] = { daily: c?.daily_cap ? String(c.daily_cap) : "", lifetime: c?.lifetime_cap ? String(c.lifetime_cap) : "", threshold: String(c?.alert_threshold_pct || 80), pause: c?.paused_at_limit || false };
    }
    setEditing(initEdit);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveCap(platform: string) {
    setSaving(platform);
    const e = editing[platform] || {};
    const r = await apiPut<{ ok: boolean; error?: string; cap?: Cap }>(`/api/budget/caps/${platform}`, {
      daily_cap: e.daily ? parseFloat(e.daily) : null,
      lifetime_cap: e.lifetime ? parseFloat(e.lifetime) : null,
      alert_threshold_pct: parseInt(e.threshold) || 80,
      paused_at_limit: e.pause,
    });
    if (r?.ok && r.cap) {
      const cap = r.cap;
      setCaps(prev => { const idx = prev.findIndex(c => c.platform === platform); return idx >= 0 ? prev.map(c => c.platform === platform ? cap : c) : [cap, ...prev]; });
      showToast(`✅ ${PLATFORM_META[platform]?.label} caps saved`);
    } else {
      showToast("Error saving caps.");
    }
    setSaving(null);
  }

  const cardStyle: React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", boxShadow: "0 2px 8px rgba(10,20,50,.06)", marginBottom: 16 };
  const inputStyle: React.CSSProperties = { padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", background: "#fff", width: "100%", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { fontSize: "0.7rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".05em", display: "block", marginBottom: 4 };

  return (
    <div
      style={{
        fontFamily: "'Inter',sans-serif",
        background: embedded ? "transparent" : "var(--ig-page)",
        minHeight: embedded ? "auto" : "100vh",
        padding: embedded ? "8px 24px 32px" : "24px 28px",
      }}
    >
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: '#eef4ff', color: "#0f172a", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      {!embedded ? (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Manage › Budget Caps</div>
          <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>💰 Budget Caps</h1>
          <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>Set platform-level daily and lifetime spend limits to prevent overspending, with automatic alerts when you approach your caps.</p>
        </div>
      ) : (
        <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: "#0F766E" }}>
          Platform limits & campaign budgets
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {([["platform", "🏢 Platform Caps"], ["campaigns", `📋 Campaign Budgets (${campaigns.length})`]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#0066FF" : "transparent"}`, color: tab === t ? "#0066FF" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: "pointer", marginBottom: -2 }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 60 }}>Loading…</div> : tab === "platform" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16 }}>
          {PLATFORMS.map(platform => {
            const meta = PLATFORM_META[platform];
            const cap = caps.find(c => c.platform === platform);
            const s = spend[platform] || { daily_budget: 0, lifetime_budget: 0, total_spend: 0, campaign_count: 0 };
            const e = editing[platform] || { daily: "", lifetime: "", threshold: "80", pause: false };
            const dailyPct = pct(s.daily_budget, cap?.daily_cap || null);
            const lifetimePct = pct(s.total_spend, cap?.lifetime_cap || null);
            const isAlert = (cap?.alert_threshold_pct || 80);

            return (
              <div key={platform} style={{ ...cardStyle, borderTop: `4px solid ${meta.color}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <span style={{ fontSize: "1.4rem" }}>{meta.icon}</span>
                  <div>
                    <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem" }}>{meta.label}</div>
                    <div style={{ fontSize: "0.7rem", color: "#64748B" }}>{s.campaign_count} active campaign{s.campaign_count !== 1 ? "s" : ""} · {fmtMoney(s.daily_budget)}/day budgeted</div>
                  </div>
                </div>

                {/* Spend bars */}
                {cap?.daily_cap && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#475569", marginBottom: 4 }}>
                      <span>Daily budgeted vs cap</span>
                      <span style={{ fontWeight: 700, color: dailyPct >= isAlert ? "#DC2626" : "#0A1628" }}>{fmtMoney(s.daily_budget)} / {fmtMoney(cap.daily_cap)} ({dailyPct}%)</span>
                    </div>
                    <div style={{ background: "#F1F5F9", borderRadius: 6, height: 8 }}>
                      <div style={{ width: `${dailyPct}%`, background: dailyPct >= isAlert ? "#EF4444" : dailyPct >= 60 ? "#F59E0B" : "#10B981", borderRadius: 6, height: "100%", transition: "width .4s" }} />
                    </div>
                  </div>
                )}
                {cap?.lifetime_cap && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#475569", marginBottom: 4 }}>
                      <span>Lifetime spend vs cap</span>
                      <span style={{ fontWeight: 700, color: lifetimePct >= isAlert ? "#DC2626" : "#0A1628" }}>{fmtMoney(s.total_spend)} / {fmtMoney(cap.lifetime_cap)} ({lifetimePct}%)</span>
                    </div>
                    <div style={{ background: "#F1F5F9", borderRadius: 6, height: 8 }}>
                      <div style={{ width: `${lifetimePct}%`, background: lifetimePct >= isAlert ? "#EF4444" : lifetimePct >= 60 ? "#F59E0B" : "#10B981", borderRadius: 6, height: "100%", transition: "width .4s" }} />
                    </div>
                  </div>
                )}

                {/* Edit form */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={labelStyle}>Daily Cap ($)</label>
                    <input type="number" style={inputStyle} placeholder="e.g. 500" value={e.daily} onChange={ev => setEditing(ed => ({ ...ed, [platform]: { ...ed[platform], daily: ev.target.value } }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Lifetime Cap ($)</label>
                    <input type="number" style={inputStyle} placeholder="e.g. 10000" value={e.lifetime} onChange={ev => setEditing(ed => ({ ...ed, [platform]: { ...ed[platform], lifetime: ev.target.value } }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Alert at (%)</label>
                    <input type="number" style={inputStyle} min={50} max={100} value={e.threshold} onChange={ev => setEditing(ed => ({ ...ed, [platform]: { ...ed[platform], threshold: ev.target.value } }))} />
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.78rem", color: "#374151", fontWeight: 600 }}>
                      <input type="checkbox" checked={e.pause} onChange={ev => setEditing(ed => ({ ...ed, [platform]: { ...ed[platform], pause: ev.target.checked } }))} style={{ width: 16, height: 16 }} />
                      Pause campaigns at limit
                    </label>
                  </div>
                </div>

                <button onClick={() => saveCap(platform)} disabled={saving === platform} style={{ padding: "9px 18px", background: `linear-gradient(135deg,${meta.color},${meta.color}cc)`, border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", width: "100%", opacity: saving === platform ? 0.7 : 1 }}>
                  {saving === platform ? "Saving…" : "💾 Save Caps"}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 16 }}>Campaign Budget Overview</div>
          {campaigns.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#94A3B8" }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>📋</div>
              <div style={{ fontWeight: 600 }}>No campaigns yet — launch campaigns from the Campaigns tab.</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #E8EEF8", color: "#475569", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: ".05em" }}>
                    {["Campaign", "Platform", "Daily Budget", "Lifetime Budget", "Total Spend", "Status"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map(c => (
                    <tr key={c.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: "#0A1628", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ background: "#EFF6FF", color: "#1D4ED8", padding: "2px 8px", borderRadius: 99, fontSize: "0.7rem", fontWeight: 700, textTransform: "capitalize" }}>{c.platform}</span>
                      </td>
                      <td style={{ padding: "10px 12px", color: "#0A1628", fontWeight: 600 }}>{fmtMoney(c.daily_budget)}</td>
                      <td style={{ padding: "10px 12px", color: "#0A1628", fontWeight: 600 }}>{fmtMoney(c.lifetime_budget)}</td>
                      <td style={{ padding: "10px 12px", color: c.total_spend > 0 ? "#059669" : "#94A3B8", fontWeight: 600 }}>{fmtMoney(c.total_spend)}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ background: c.status === "active" ? "#D1FAE5" : "#F1F5F9", color: c.status === "active" ? "#065F46" : "#64748B", padding: "2px 8px", borderRadius: 99, fontSize: "0.7rem", fontWeight: 700 }}>{c.status || "local"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

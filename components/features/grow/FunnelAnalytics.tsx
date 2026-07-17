"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiPut, apiDelete, type ApiResult } from "@/lib/api";

interface Funnel {
  id: number;
  name: string;
  description: string | null;
  status: string;
  pixel_id: string;
  currency: string;
  step_count: number;
  views_30d: number;
  optins_30d: number;
  sales_30d: number;
  revenue_30d: number;
  created_at: string;
  steps?: FunnelStep[];
}

interface FunnelStep {
  id: number;
  name: string;
  step_type: string;
  url_pattern: string | null;
  position: number;
  views_all?: number;
  views_unique?: number;
  optins_all?: number;
  optins_unique?: number;
  sales_orders?: number;
  revenue_gross?: number;
}

interface Summary {
  total_views: number;
  total_unique_views: number;
  total_optins: number;
  total_sales: number;
  total_revenue: number;
  optin_rate: number;
  sale_rate: number;
  overall_conversion: number;
  earnings_per_click: number;
  earnings_per_page_view: number;
  average_cart_value: number;
}

interface UTMRow {
  utm_source: string;
  utm_medium: string | null;
  utm_campaign: string | null;
  views: number;
  optins: number;
  sales: number;
  revenue: number;
}

interface TrendRow {
  day: string;
  views: number;
  optins: number;
  sales: number;
  revenue: number;
}

interface Stats {
  summary: Summary;
  steps: FunnelStep[];
  utms: UTMRow[];
  trend: TrendRow[];
  days: number;
}

interface StepType { id: string; label: string; }

interface ConfigResponse extends ApiResult { step_types?: StepType[]; }
interface FunnelsResponse extends ApiResult { funnels?: Funnel[]; }
interface StatsResponse extends ApiResult, Stats {}
interface FunnelResponse extends ApiResult { funnel: Funnel; }
interface SnippetResponse extends ApiResult { snippet: string; }

const STEP_TYPE_ICONS: Record<string, string> = {
  page: "📄", optin: "📋", checkout: "💳", sale: "🎯", upsell: "⬆️", thankyou: "🎉",
};

const RANGE_OPTS = [
  { value: "7",   label: "7 days" },
  { value: "30",  label: "30 days" },
  { value: "90",  label: "90 days" },
  { value: "365", label: "12 months" },
];

function pct(a: number, b: number) {
  if (!b) return "0.00%";
  return ((a / b) * 100).toFixed(2) + "%";
}

function fmt(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(n);
}

export default function FunnelAnalytics() {
  const [funnels, setFunnels]         = useState<Funnel[]>([]);
  const [stepTypes, setStepTypes]     = useState<StepType[]>([]);
  const [loading, setLoading]         = useState(true);
  const [active, setActive]           = useState<Funnel | null>(null);
  const [stats, setStats]             = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [range, setRange]             = useState("30");
  const [tab, setTab]                 = useState<"funnels" | "new" | "analytics" | "embed">("funnels");
  const [statsTab, setStatsTab]       = useState<"funnel" | "steps" | "utm" | "trend">("funnel");
  const [toast, setToast]             = useState("");
  const [saving, setSaving]           = useState(false);
  const [snippet, setSnippet]         = useState("");
  const [copied, setCopied]           = useState(false);

  const [form, setForm] = useState({ name: "", description: "", currency: "USD" });
  const [newSteps, setNewSteps] = useState<{ name: string; step_type: string; url_pattern: string }[]>([
    { name: "Landing Page",  step_type: "page",  url_pattern: "" },
    { name: "Opt-In Page",   step_type: "optin", url_pattern: "" },
    { name: "Thank You",     step_type: "thankyou", url_pattern: "" },
  ]);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    const [cfg, r] = await Promise.all([
      apiGet<ConfigResponse>("/api/funnel-analytics/config"),
      apiGet<FunnelsResponse>("/api/funnel-analytics/funnels"),
    ]);
    if (cfg?.step_types) setStepTypes(cfg.step_types);
    if (r?.funnels) setFunnels(r.funnels);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadStats(funnelId: number, r: string) {
    setLoadingStats(true);
    const res = await apiGet<StatsResponse>(`/api/funnel-analytics/funnels/${funnelId}/stats?range=${r}`);
    if (res.ok) setStats(res);
    setLoadingStats(false);
  }

  async function openFunnel(f: Funnel) {
    setActive(f);
    setStats(null);
    setSnippet("");
    setTab("analytics");
    setStatsTab("funnel");
    loadStats(f.id, range);
  }

  async function handleCreate() {
    if (!form.name) { showToast("Funnel name required."); return; }
    if (newSteps.some(s => !s.name)) { showToast("All steps need a name."); return; }
    setSaving(true);
    const r = await apiPost<FunnelResponse>("/api/funnel-analytics/funnels", { ...form, steps: newSteps });
    if (r?.ok) {
      showToast("✅ Funnel created!");
      setFunnels(prev => [r.funnel, ...prev]);
      setActive(r.funnel);
      setTab("analytics");
      loadStats(r.funnel.id, range);
      setForm({ name: "", description: "", currency: "USD" });
      setNewSteps([
        { name: "Landing Page", step_type: "page", url_pattern: "" },
        { name: "Opt-In Page",  step_type: "optin", url_pattern: "" },
        { name: "Thank You",    step_type: "thankyou", url_pattern: "" },
      ]);
    } else { showToast("Error creating funnel."); }
    setSaving(false);
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this funnel and all its data?")) return;
    await apiDelete(`/api/funnel-analytics/funnels/${id}`);
    setFunnels(prev => prev.filter(f => f.id !== id));
    if (active?.id === id) { setActive(null); setTab("funnels"); }
    showToast("Funnel deleted.");
  }

  async function loadSnippet(funnelId: number) {
    const r = await apiGet<SnippetResponse>(`/api/funnel-analytics/funnels/${funnelId}/snippet`);
    if (r?.ok) setSnippet(r.snippet);
  }

  function handleCopy() {
    navigator.clipboard.writeText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  function addStep() {
    setNewSteps(prev => [...prev, { name: "", step_type: "page", url_pattern: "" }]);
  }
  function removeStep(i: number) {
    setNewSteps(prev => prev.filter((_, idx) => idx !== i));
  }
  function updateStep(i: number, key: string, val: string) {
    setNewSteps(prev => prev.map((s, idx) => idx === i ? { ...s, [key]: val } : s));
  }

  const card:   React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 2px 8px rgba(10,20,50,.06)" };
  const input:  React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", boxSizing: "border-box" };
  const lbl:    React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 5 };
  const btnPri: React.CSSProperties = { padding: "10px 22px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" };

  const s = stats?.summary;

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "#0A1628", color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Grow › Track ROI</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>📊 Funnel Analytics</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>Track every step of your conversion funnels — page views, opt-ins, sales, revenue, and earnings per click — with a lightweight JS pixel you drop on any page.</p>
      </div>

      {/* Top tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {([
          ["funnels",   `📋 Funnels (${funnels.length})`],
          ["new",       "➕ New Funnel"],
          ...(active ? [
            ["analytics", `📊 Analytics — ${active.name}`],
            ["embed",     "🔌 Embed Pixel"],
          ] : [])
        ] as [string,string][]).map(([t, label]) => (
          <button key={t} onClick={() => {
            setTab(t as "funnels"|"new"|"analytics"|"embed");
            if (t === "embed" && active && !snippet) loadSnippet(active.id);
          }}
          style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#0066FF" : "transparent"}`, color: tab === t ? "#0066FF" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: "pointer", marginBottom: -2 }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Funnels list ── */}
      {tab === "funnels" && (
        <div>
          {loading ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 60 }}>Loading…</div> :
            funnels.length === 0 ? (
              <div style={{ ...card, textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: "3rem", marginBottom: 8 }}>📊</div>
                <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "1rem" }}>No funnels yet</div>
                <div style={{ color: "#64748B", fontSize: "0.84rem", marginTop: 4 }}>Create your first funnel to start tracking page views, opt-ins, and revenue across every step.</div>
                <button onClick={() => setTab("new")} style={{ ...btnPri, marginTop: 16 }}>➕ Create Funnel</button>
              </div>
            ) : funnels.map(f => {
              const views   = +f.views_30d   || 0;
              const optins  = +f.optins_30d  || 0;
              const sales   = +f.sales_30d   || 0;
              const revenue = +f.revenue_30d || 0;
              return (
                <div key={f.id} style={{ ...card, cursor: "pointer" }} onClick={() => openFunnel(f)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem" }}>{f.name}</div>
                      <div style={{ color: "#64748B", fontSize: "0.75rem", marginTop: 2 }}>
                        {f.step_count} step{f.step_count !== 1 ? "s" : ""} · {f.currency} · Created {new Date(f.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ background: f.status === "active" ? "#ECFDF5" : "#F1F5F9", color: f.status === "active" ? "#065F46" : "#64748B", padding: "3px 10px", borderRadius: 99, fontSize: "0.68rem", fontWeight: 700 }}>
                        {f.status === "active" ? "▶️ Active" : "⏸ Paused"}
                      </span>
                      <button onClick={e => { e.stopPropagation(); handleDelete(f.id); }} style={{ background: "transparent", border: "none", color: "#DC2626", cursor: "pointer", fontSize: "0.85rem" }}>🗑</button>
                    </div>
                  </div>
                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8, textAlign: "center" }}>
                    {[
                      ["👁 Views",       views],
                      ["📋 Opt-Ins",     optins],
                      ["🎯 Sales",       sales],
                      ["💰 Revenue",     fmt(revenue, f.currency)],
                      ["Opt-In %",      pct(optins, views)],
                      ["Close %",       pct(sales, optins)],
                      ["EPC",           fmt(views > 0 ? revenue / views : 0, f.currency)],
                    ].map(([l, v]) => (
                      <div key={l as string} style={{ background: "#F8FAFC", borderRadius: 8, padding: "6px 4px" }}>
                        <div style={{ fontSize: "0.62rem", color: "#64748B" }}>{l}</div>
                        <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.8rem" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* ── New funnel ── */}
      {tab === "new" && (
        <div style={{ maxWidth: 660 }}>
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>Create Funnel</div>
            <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
              <div><label style={lbl}>Funnel Name *</label><input style={input} placeholder="Summer Webinar Funnel" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><label style={lbl}>Description</label><input style={input} placeholder="Opt-in → webinar → offer page" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div style={{ maxWidth: 160 }}>
                <label style={lbl}>Currency</label>
                <select style={input} value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                  {["USD","EUR","GBP","AUD","CAD"].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.85rem", marginBottom: 10 }}>Funnel Steps</div>
            {newSteps.map((s, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 160px 1fr 32px", gap: 8, marginBottom: 8, alignItems: "flex-end" }}>
                <div>
                  {i === 0 && <label style={lbl}>Step Name</label>}
                  <input style={input} placeholder={`Step ${i + 1}`} value={s.name} onChange={e => updateStep(i, "name", e.target.value)} />
                </div>
                <div>
                  {i === 0 && <label style={lbl}>Type</label>}
                  <select style={input} value={s.step_type} onChange={e => updateStep(i, "step_type", e.target.value)}>
                    {stepTypes.map(t => <option key={t.id} value={t.id}>{STEP_TYPE_ICONS[t.id]} {t.label}</option>)}
                  </select>
                </div>
                <div>
                  {i === 0 && <label style={lbl}>URL Pattern (optional)</label>}
                  <input style={input} placeholder="/landing-page" value={s.url_pattern} onChange={e => updateStep(i, "url_pattern", e.target.value)} />
                </div>
                <button onClick={() => removeStep(i)} style={{ padding: "9px 8px", background: "#FEF2F2", border: "none", borderRadius: 7, color: "#DC2626", cursor: "pointer", alignSelf: i === 0 ? "flex-end" : "flex-start" }}>✕</button>
              </div>
            ))}
            <button onClick={addStep} style={{ padding: "7px 14px", background: "#F0FDF4", border: "1px dashed #6EE7B7", borderRadius: 8, color: "#065F46", fontWeight: 600, fontSize: "0.78rem", cursor: "pointer", marginBottom: 16 }}>
              ＋ Add Step
            </button>

            <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 9, padding: "10px 14px", fontSize: "0.75rem", color: "#1D4ED8", marginBottom: 16 }}>
              After creating, go to <strong>Embed Pixel</strong> to get the JavaScript snippet to paste on each page. The pixel auto-tracks pageviews; call <code>igTrack(&apos;optin&apos;)</code> on form submit and <code>igTrack(&apos;sale&apos;, &#123; revenue: 97 &#125;)</code> on checkout.
            </div>

            <button onClick={handleCreate} disabled={saving} style={{ ...btnPri, width: "100%", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Creating…" : "📊 Create Funnel"}
            </button>
          </div>
        </div>
      )}

      {/* ── Analytics ── */}
      {tab === "analytics" && active && (
        <div>
          {/* Controls row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {(["funnel","steps","utm","trend"] as const).map(t => (
                <button key={t} onClick={() => setStatsTab(t)} style={{ padding: "7px 14px", background: statsTab === t ? "#0066FF" : "#F1F5F9", border: "none", borderRadius: 8, color: statsTab === t ? "#fff" : "#374151", fontWeight: 600, fontSize: "0.78rem", cursor: "pointer" }}>
                  {{ funnel:"📊 Overview", steps:"🪜 By Step", utm:"🔗 UTM Sources", trend:"📈 Trend" }[t]}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Range:</span>
              {RANGE_OPTS.map(o => (
                <button key={o.value} onClick={() => { setRange(o.value); loadStats(active.id, o.value); }}
                  style={{ padding: "5px 10px", background: range === o.value ? "#0A1628" : "#F1F5F9", border: "none", borderRadius: 7, color: range === o.value ? "#fff" : "#374151", fontWeight: 600, fontSize: "0.75rem", cursor: "pointer" }}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {loadingStats ? (
            <div style={{ color: "#94A3B8", textAlign: "center", padding: 80 }}>Loading analytics…</div>
          ) : !stats ? (
            <div style={{ color: "#94A3B8", textAlign: "center", padding: 80 }}>No data yet — add the pixel to your pages and send some traffic.</div>
          ) : (
            <>
              {/* ── Overview ── */}
              {statsTab === "funnel" && s && (
                <div>
                  {/* KPI row — matches DashClicks layout */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
                    {[
                      { label: "Earnings Per Click",     value: fmt(s.earnings_per_click, active.currency),       sub: "revenue ÷ unique sessions",  color: "#7C3AED" },
                      { label: "Gross Sales",            value: fmt(s.total_revenue, active.currency),            sub: `${s.total_sales} orders`,     color: "#059669" },
                      { label: "Average Cart Value",     value: fmt(s.average_cart_value, active.currency),       sub: "per sale",                    color: "#D97706" },
                      { label: "Earnings / Page View",   value: fmt(s.earnings_per_page_view, active.currency),   sub: "revenue ÷ all pageviews",     color: "#2563EB" },
                    ].map(m => (
                      <div key={m.label} style={{ ...card, marginBottom: 0, borderLeft: `4px solid ${m.color}` }}>
                        <div style={{ fontSize: "0.7rem", color: "#64748B", marginBottom: 4 }}>{m.label}</div>
                        <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 900, fontSize: "1.5rem", color: m.color }}>{m.value}</div>
                        <div style={{ fontSize: "0.68rem", color: "#94A3B8" }}>{m.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Main analytics table — DashClicks-style */}
                  <div style={card}>
                    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 1fr 1fr 1fr", gap: 0 }}>
                      {/* Header */}
                      <div style={{ background: "#F8FAFC", padding: "10px 14px", borderRadius: "10px 0 0 0", fontSize: "0.72rem", fontWeight: 700, color: "#374151" }} />
                      {[
                        { label: "Page Views", bg: "#4F46E5", cols: ["All","Unique"] },
                        { label: "Opt-Ins",    bg: "#059669", cols: ["All","Conversions"] },
                        { label: "Sales",      bg: "#D97706", cols: ["Orders","Conversions","Gross"] },
                        { label: "Earning per Page View", bg: "#7C3AED", cols: ["All","Unique"] },
                      ].map(col => (
                        <div key={col.label} style={{ background: col.bg, color: "#fff", padding: "10px 14px", textAlign: "center", fontWeight: 700, fontSize: "0.78rem" }}>
                          {col.label}
                        </div>
                      ))}
                    </div>

                    {/* Sub-headers */}
                    <div style={{ display: "grid", gridTemplateColumns: "180px repeat(2,1fr) repeat(2,1fr) repeat(3,1fr) repeat(2,1fr)", borderBottom: "1px solid #E2E8F0" }}>
                      <div style={{ padding: "8px 14px", background: "#F8FAFC", fontSize: "0.7rem", fontWeight: 700, color: "#94A3B8" }}>Funnel / Step</div>
                      {["All","Unique","All","Conversions","Orders","Conversions","Gross","All","Unique"].map((h, i) => (
                        <div key={i} style={{ padding: "8px 10px", background: "#F8FAFC", fontSize: "0.7rem", fontWeight: 700, color: "#94A3B8", textAlign: "center" }}>{h}</div>
                      ))}
                    </div>

                    {/* Totals row */}
                    <div style={{ display: "grid", gridTemplateColumns: "180px repeat(2,1fr) repeat(2,1fr) repeat(3,1fr) repeat(2,1fr)", borderBottom: "2px solid #E2E8F0", background: "#FAFBFF" }}>
                      <div style={{ padding: "10px 14px", fontWeight: 800, color: "#0A1628", fontSize: "0.82rem" }}>⚡ All Steps</div>
                      <div style={{ padding: "10px 10px", textAlign: "center", fontWeight: 700 }}>{s.total_views.toLocaleString()}</div>
                      <div style={{ padding: "10px 10px", textAlign: "center", color: "#64748B" }}>{s.total_unique_views.toLocaleString()}</div>
                      <div style={{ padding: "10px 10px", textAlign: "center", fontWeight: 700 }}>{s.total_optins.toLocaleString()}</div>
                      <div style={{ padding: "10px 10px", textAlign: "center", color: "#059669", fontWeight: 700 }}>{s.optin_rate}%</div>
                      <div style={{ padding: "10px 10px", textAlign: "center", fontWeight: 700 }}>{s.total_sales.toLocaleString()}</div>
                      <div style={{ padding: "10px 10px", textAlign: "center", color: "#D97706", fontWeight: 700 }}>{s.sale_rate}%</div>
                      <div style={{ padding: "10px 10px", textAlign: "center", color: "#059669", fontWeight: 700 }}>{fmt(s.total_revenue, active.currency)}</div>
                      <div style={{ padding: "10px 10px", textAlign: "center", fontWeight: 700 }}>{fmt(s.earnings_per_page_view, active.currency)}</div>
                      <div style={{ padding: "10px 10px", textAlign: "center", color: "#64748B" }}>{fmt(s.earnings_per_click, active.currency)}</div>
                    </div>

                    {/* Per-step rows */}
                    {stats.steps.map((step, i) => {
                      const sv = step.views_all ?? 0;
                      const su = step.views_unique ?? 0;
                      const so = step.optins_all ?? 0;
                      const ss = step.sales_orders ?? 0;
                      const sr = step.revenue_gross ?? 0;
                      return (
                        <div key={step.id} style={{ display: "grid", gridTemplateColumns: "180px repeat(2,1fr) repeat(2,1fr) repeat(3,1fr) repeat(2,1fr)", borderBottom: "1px solid #F1F5F9", background: i % 2 === 0 ? "#fff" : "#FAFBFF" }}>
                          <div style={{ padding: "9px 14px", fontSize: "0.8rem", color: "#374151", fontWeight: 600 }}>
                            {STEP_TYPE_ICONS[step.step_type] || "📄"} {step.name}
                          </div>
                          <div style={{ padding: "9px 10px", textAlign: "center", fontSize: "0.8rem" }}>{sv.toLocaleString()}</div>
                          <div style={{ padding: "9px 10px", textAlign: "center", fontSize: "0.8rem", color: "#64748B" }}>{su.toLocaleString()}</div>
                          <div style={{ padding: "9px 10px", textAlign: "center", fontSize: "0.8rem" }}>{so.toLocaleString()}</div>
                          <div style={{ padding: "9px 10px", textAlign: "center", fontSize: "0.8rem", color: "#059669" }}>{sv > 0 ? ((so / sv) * 100).toFixed(2) : "0.00"}%</div>
                          <div style={{ padding: "9px 10px", textAlign: "center", fontSize: "0.8rem" }}>{ss.toLocaleString()}</div>
                          <div style={{ padding: "9px 10px", textAlign: "center", fontSize: "0.8rem", color: "#D97706" }}>{so > 0 ? ((ss / so) * 100).toFixed(2) : "0.00"}%</div>
                          <div style={{ padding: "9px 10px", textAlign: "center", fontSize: "0.8rem", color: "#059669" }}>{fmt(sr, active.currency)}</div>
                          <div style={{ padding: "9px 10px", textAlign: "center", fontSize: "0.8rem" }}>{sv > 0 ? fmt(sr / sv, active.currency) : "$0.00"}</div>
                          <div style={{ padding: "9px 10px", textAlign: "center", fontSize: "0.8rem", color: "#64748B" }}>{su > 0 ? fmt(sr / su, active.currency) : "$0.00"}</div>
                        </div>
                      );
                    })}

                    {stats.steps.length === 0 && (
                      <div style={{ padding: "24px", textAlign: "center", color: "#94A3B8", fontSize: "0.82rem" }}>
                        No step data yet — add the pixel to your pages to start tracking.
                      </div>
                    )}
                  </div>

                  {/* Visual funnel */}
                  {stats.steps.length > 0 && (
                    <div style={card}>
                      <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 16 }}>🪜 Funnel Drop-off Visualisation</div>
                      <div style={{ display: "flex", gap: 0, alignItems: "flex-end" }}>
                        {stats.steps.map((step, i) => {
                          const maxViews = Math.max(...stats.steps.map(s => s.views_all ?? 0), 1);
                          const views    = step.views_all ?? 0;
                          const barH     = Math.max(20, Math.round((views / maxViews) * 180));
                          const previousViews = stats.steps[i - 1]?.views_all ?? 1;
                          const dropoff  = i > 0 ? (1 - views / Math.max(previousViews, 1)) * 100 : 0;
                          return (
                            <div key={step.id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 4px" }}>
                              {i > 0 && (
                                <div style={{ fontSize: "0.65rem", color: dropoff > 50 ? "#DC2626" : "#D97706", fontWeight: 700, marginBottom: 4 }}>
                                  ▼ {dropoff.toFixed(0)}%
                                </div>
                              )}
                              {i === 0 && <div style={{ height: 18, marginBottom: 4 }} />}
                              <div style={{ width: "100%", height: barH, background: `linear-gradient(180deg, ${STEP_TYPE_ICONS[step.step_type] === "🎯" ? "#059669" : "#4F46E5"} 0%, ${STEP_TYPE_ICONS[step.step_type] === "🎯" ? "#6EE7B7" : "#A5B4FC"} 100%)`, borderRadius: "6px 6px 0 0", position: "relative" }} />
                              <div style={{ width: "100%", background: "#F1F5F9", padding: "8px 4px", textAlign: "center", borderRadius: "0 0 6px 6px", borderTop: "2px solid #fff" }}>
                                <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#0A1628", marginBottom: 2 }}>{step.name}</div>
                                <div style={{ fontSize: "0.7rem", color: "#4F46E5", fontWeight: 700 }}>{views.toLocaleString()}</div>
                                <div style={{ fontSize: "0.62rem", color: "#94A3B8" }}>views</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── By Step ── */}
              {statsTab === "steps" && (
                <div style={card}>
                  <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>Step-by-step breakdown</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                    <thead>
                      <tr style={{ background: "#F8FAFC" }}>
                        {["Step","Type","Views","Unique","Opt-Ins","Opt-In %","Sales","Close %","Revenue","EPC"].map(h => (
                          <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#374151", fontWeight: 700, borderBottom: "2px solid #E2E8F0" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.steps.map((s, i) => {
                        const sv = s.views_all ?? 0;
                        const su = s.views_unique ?? 0;
                        const so = s.optins_all ?? 0;
                        const ss = s.sales_orders ?? 0;
                        const sr = s.revenue_gross ?? 0;
                        return (
                          <tr key={s.id} style={{ borderBottom: "1px solid #F1F5F9", background: i % 2 === 0 ? "#fff" : "#FAFBFF" }}>
                            <td style={{ padding: "8px 10px", fontWeight: 600 }}>{s.name}</td>
                            <td style={{ padding: "8px 10px", color: "#64748B" }}>{STEP_TYPE_ICONS[s.step_type]} {s.step_type}</td>
                            <td style={{ padding: "8px 10px" }}>{sv.toLocaleString()}</td>
                            <td style={{ padding: "8px 10px", color: "#64748B" }}>{su.toLocaleString()}</td>
                            <td style={{ padding: "8px 10px" }}>{so.toLocaleString()}</td>
                            <td style={{ padding: "8px 10px", color: "#059669", fontWeight: 700 }}>{sv ? ((so/sv)*100).toFixed(2) : "0.00"}%</td>
                            <td style={{ padding: "8px 10px" }}>{ss.toLocaleString()}</td>
                            <td style={{ padding: "8px 10px", color: "#D97706", fontWeight: 700 }}>{so ? ((ss/so)*100).toFixed(2) : "0.00"}%</td>
                            <td style={{ padding: "8px 10px", color: "#059669", fontWeight: 700 }}>{fmt(sr, active.currency)}</td>
                            <td style={{ padding: "8px 10px" }}>{su ? fmt(sr/su, active.currency) : "$0.00"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── UTM ── */}
              {statsTab === "utm" && (
                <div style={card}>
                  <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>🔗 UTM Source Breakdown</div>
                  {stats.utms.length === 0 ? (
                    <div style={{ color: "#94A3B8", textAlign: "center", padding: 40 }}>No UTM-tagged traffic yet. Add ?utm_source= to your ad links.</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                      <thead>
                        <tr style={{ background: "#F8FAFC" }}>
                          {["Source","Medium","Campaign","Views","Opt-Ins","Opt-In %","Sales","Revenue","EPC"].map(h => (
                            <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#374151", fontWeight: 700, borderBottom: "2px solid #E2E8F0" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stats.utms.map((u, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #F1F5F9", background: i % 2 === 0 ? "#fff" : "#FAFBFF" }}>
                            <td style={{ padding: "8px 10px", fontWeight: 700 }}>{u.utm_source}</td>
                            <td style={{ padding: "8px 10px", color: "#64748B" }}>{u.utm_medium || "—"}</td>
                            <td style={{ padding: "8px 10px", color: "#64748B" }}>{u.utm_campaign || "—"}</td>
                            <td style={{ padding: "8px 10px" }}>{(+u.views).toLocaleString()}</td>
                            <td style={{ padding: "8px 10px" }}>{(+u.optins).toLocaleString()}</td>
                            <td style={{ padding: "8px 10px", color: "#059669", fontWeight: 700 }}>{u.views ? (((+u.optins) / (+u.views)) * 100).toFixed(2) : "0.00"}%</td>
                            <td style={{ padding: "8px 10px" }}>{(+u.sales).toLocaleString()}</td>
                            <td style={{ padding: "8px 10px", color: "#059669", fontWeight: 700 }}>{fmt(+u.revenue, active.currency)}</td>
                            <td style={{ padding: "8px 10px" }}>{u.views ? fmt((+u.revenue) / (+u.views), active.currency) : "$0.00"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* ── Trend ── */}
              {statsTab === "trend" && (
                <div style={card}>
                  <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>📈 Daily Trend</div>
                  {stats.trend.length === 0 ? (
                    <div style={{ color: "#94A3B8", textAlign: "center", padding: 40 }}>No data for selected range.</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                      <thead>
                        <tr style={{ background: "#F8FAFC" }}>
                          {["Date","Views","Opt-Ins","Opt-In %","Sales","Revenue"].map(h => (
                            <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#374151", fontWeight: 700, borderBottom: "2px solid #E2E8F0" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...stats.trend].reverse().map((row, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #F1F5F9", background: i % 2 === 0 ? "#fff" : "#FAFBFF" }}>
                            <td style={{ padding: "8px 12px", fontWeight: 600 }}>{new Date(row.day).toLocaleDateString()}</td>
                            <td style={{ padding: "8px 12px" }}>{(+row.views).toLocaleString()}</td>
                            <td style={{ padding: "8px 12px" }}>{(+row.optins).toLocaleString()}</td>
                            <td style={{ padding: "8px 12px", color: "#059669", fontWeight: 700 }}>{row.views ? (((+row.optins) / (+row.views)) * 100).toFixed(2) : "0.00"}%</td>
                            <td style={{ padding: "8px 12px" }}>{(+row.sales).toLocaleString()}</td>
                            <td style={{ padding: "8px 12px", color: "#059669", fontWeight: 700 }}>{fmt(+row.revenue, active.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Embed Pixel ── */}
      {tab === "embed" && active && (
        <div style={{ maxWidth: 720 }}>
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 6 }}>🔌 Embed Pixel for &quot;{active.name}&quot;</div>
            <p style={{ color: "#475569", fontSize: "0.85rem", margin: "0 0 16px" }}>
              Paste this snippet in the <code style={{ background: "#F1F5F9", padding: "1px 5px", borderRadius: 4 }}>&lt;head&gt;</code> of every page in your funnel. It auto-fires a <code style={{ background: "#F1F5F9", padding: "1px 5px", borderRadius: 4 }}>pageview</code> event — call the helper functions for opt-ins and sales.
            </p>

            {!snippet ? (
              <div style={{ color: "#94A3B8", textAlign: "center", padding: 40 }}>Loading snippet…</div>
            ) : (
              <>
                <div style={{ position: "relative" }}>
                  <pre style={{ background: "#0A1628", color: "#A5F3FC", borderRadius: 10, padding: "16px 20px", fontSize: "0.72rem", lineHeight: 1.7, overflowX: "auto", maxHeight: 400, margin: 0 }}>
                    {snippet}
                  </pre>
                  <button onClick={handleCopy} style={{ position: "absolute", top: 12, right: 12, padding: "5px 12px", background: copied ? "#059669" : "#1E3A5F", border: "none", borderRadius: 7, color: "#fff", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer" }}>
                    {copied ? "✅ Copied!" : "📋 Copy"}
                  </button>
                </div>

                <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {[
                    { label: "Track Page View", code: "igTrack('pageview');" },
                    { label: "Track Opt-In", code: "igTrack('optin');" },
                    { label: "Track Sale ($97)", code: "igTrack('sale', { revenue: 97.00 });" },
                  ].map(ex => (
                    <div key={ex.label} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9, padding: "10px 12px" }}>
                      <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#374151", marginBottom: 5 }}>{ex.label}</div>
                      <code style={{ fontSize: "0.72rem", color: "#7C3AED" }}>{ex.code}</code>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

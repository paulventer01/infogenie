"use client";

// Native React port of the legacy `analytics-hub` panel (was `buildAnalyticsHub`
// + `_ahSeed` / `_analyticsSources` in app.js and `#view-analytics-hub` /
// `#analyticsHubWrap` in index.html). This panel is a faithful port of the legacy
// GSC / GA4 Hub: it uses simulated read-only OAuth connections and per-domain
// seeded sample analytics exactly as the original did (there is no `/api/*`
// endpoint behind it). The dashboard is gated behind running a site analysis
// first — analytics are keyed to the analysed domain (window.analysisData /
// localStorage 'ig-last-analysed-url'). Cross-tool links use lib/nav.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

interface AnalyticsSource {
  key: string;
  name: string;
  icon: string;
  color: string;
  tag: "CORE" | "OPTIONAL" | "PIPELINE";
  desc: string;
  bullets: string[];
}
interface AHPage {
  path: string;
  label: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avgPos: number;
  sessions: number;
  conversions: number;
  convRate: number;
  revenue: number;
  delta30d: number;
}
interface AHTotals {
  impressions: number;
  clicks: number;
  sessions: number;
  conversions: number;
  revenue: number;
  ctr: number;
  convRate: number;
}
interface AHData {
  domain: string;
  pages: AHPage[];
  top: AHPage[];
  weak: AHPage[];
  totals: AHTotals;
  period: string;
  generatedAt: string;
}

const ANALYTICS_SOURCES: AnalyticsSource[] = [
  { key: "gsc", name: "Google Search Console", icon: "G", color: "#4285F4", tag: "CORE", desc: "Impressions · Clicks · CTR · Avg position", bullets: ["Top & weak performing pages", "Query-level rank tracking", "Hidden-gem keyword opportunities"] },
  { key: "ga4", name: "Google Analytics 4", icon: "📊", color: "#F9AB00", tag: "CORE", desc: "Sessions · Conversions · Revenue", bullets: ["Revenue per page & landing page ROI", "Conversion funnel drop-off", "Channel attribution"] },
  { key: "adobe", name: "Adobe Analytics", icon: "🅰", color: "#FA0F00", tag: "OPTIONAL", desc: "Enterprise web & app analytics", bullets: ["Workspace segments & cohorts", "Marketing Channel reports", "Cross-device journey"] },
  { key: "mixpanel", name: "Mixpanel", icon: "⚡", color: "#7856FF", tag: "OPTIONAL", desc: "Product analytics & funnels", bullets: ["Event-based funnel analysis", "User retention cohorts", "A/B experiment tracking"] },
  { key: "amplitude", name: "Amplitude", icon: "△", color: "#1E61F0", tag: "OPTIONAL", desc: "Behavioural product analytics", bullets: ["User journey maps", "Predictive lifecycle segments", "North-star metric tracking"] },
  { key: "posthog", name: "PostHog", icon: "🦔", color: "#F54E00", tag: "OPTIONAL", desc: "Open-source product analytics", bullets: ["Session replay & heatmaps", "Feature flag experiments", "SQL-style insights"] },
  { key: "clarity", name: "Microsoft Clarity", icon: "🔍", color: "#00A4EF", tag: "OPTIONAL", desc: "Free heatmaps & session replay", bullets: ["Click, scroll & rage maps", "Recordings of every session", "Dead-click & quick-back signals"] },
  { key: "hotjar", name: "Hotjar", icon: "🔥", color: "#FD3A5C", tag: "OPTIONAL", desc: "Heatmaps · Recordings · Surveys", bullets: ["Visual heat & scroll maps", "On-page polls & NPS", "Funnel drop-off recordings"] },
  { key: "plausible", name: "Plausible Analytics", icon: "📈", color: "#5850EC", tag: "OPTIONAL", desc: "Lightweight, cookie-free analytics", bullets: ["GDPR-compliant pageview tracking", "Custom goal events", "Outbound link & file downloads"] },
  { key: "matomo", name: "Matomo", icon: "M", color: "#3450A3", tag: "OPTIONAL", desc: "Self-hosted analytics suite", bullets: ["Full data ownership", "Multi-site dashboards", "Form & media analytics"] },
  { key: "segment", name: "Segment", icon: "§", color: "#52BD94", tag: "PIPELINE", desc: "Customer data pipeline", bullets: ["Forward events to 300+ tools", "Identity unification", "Real-time profiles"] },
  { key: "looker", name: "Looker Studio", icon: "📑", color: "#4285F4", tag: "OPTIONAL", desc: "Free Google reporting & BI", bullets: ["Blend GSC + GA4 + Ads", "Schedule branded PDF reports", "Shareable client dashboards"] },
];

function lsAD(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { analysisData?: Record<string, unknown> };
  if (w.analysisData) return w.analysisData;
  try {
    const url = localStorage.getItem("ig-last-analysed-url");
    if (url) return { url };
  } catch {
    /* ignore */
  }
  return null;
}
function lsDomain(): string {
  const ad = lsAD();
  const d = (ad && (ad.url || ad.domain)) || "";
  return String(d).replace(/^https?:\/\//, "").split("/")[0] || "";
}
function lsSector(): string {
  const ad = lsAD();
  if (ad) {
    if (typeof ad.sector === "string") return ad.sector;
    if (typeof ad.industry === "string") return ad.industry;
    if (ad.industry && typeof ad.industry === "object") {
      const n = (ad.industry as { name?: string }).name;
      if (n) return n;
    }
  }
  return "your industry";
}
function toast(msg: string) {
  (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
}

function ahSeed(): AHData {
  const dom = lsDomain() || "your-site.com";
  const sector = lsSector();
  const slug = sector.toLowerCase().replace(/\s+/g, "-");
  const seedPaths = [
    { path: "/", label: "Home" },
    { path: "/products", label: "Products" },
    { path: "/pricing", label: "Pricing" },
    { path: "/about", label: "About Us" },
    { path: `/blog/${slug}-guide`, label: `${sector} Guide` },
    { path: `/blog/best-${slug}-tools`, label: `Best ${sector} Tools` },
    { path: `/blog/${slug}-vs-alternatives`, label: `${sector} vs Alternatives` },
    { path: "/blog/case-studies", label: "Case Studies" },
    { path: "/contact", label: "Contact" },
    { path: "/checkout", label: "Checkout" },
    { path: `/products/premium-${slug}`, label: `Premium ${sector}` },
    { path: `/blog/how-to-choose-${slug}`, label: `How to Choose ${sector}` },
  ];
  const serpHash = dom.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const pages: AHPage[] = seedPaths.map((p, i) => {
    const seed = (serpHash * (i + 1) * 6271) % 10000;
    const impressions = 800 + (seed % 24000);
    const ctr = +(1.5 + (seed % 900) / 100).toFixed(2);
    const clicks = Math.round((impressions * ctr) / 100);
    const avgPos = +(1 + (seed % 3500) / 100).toFixed(1);
    const sessions = Math.round(clicks * 0.9);
    const convRate = +(0.4 + (seed % 450) / 100).toFixed(2);
    const conversions = Math.round((sessions * convRate) / 100);
    const aov = 35 + (seed % 250);
    const revenue = Math.round(conversions * aov);
    return { path: p.path, label: p.label, impressions, clicks, ctr, avgPos, sessions, conversions, convRate, revenue, delta30d: -25 + (seed % 70) };
  });
  const sorted = [...pages].sort((a, b) => b.revenue - a.revenue);
  const totalsBase = pages.reduce(
    (acc, p) => ({
      impressions: acc.impressions + p.impressions,
      clicks: acc.clicks + p.clicks,
      sessions: acc.sessions + p.sessions,
      conversions: acc.conversions + p.conversions,
      revenue: acc.revenue + p.revenue,
    }),
    { impressions: 0, clicks: 0, sessions: 0, conversions: 0, revenue: 0 },
  );
  const totals: AHTotals = {
    ...totalsBase,
    ctr: +((totalsBase.clicks / totalsBase.impressions) * 100).toFixed(2),
    convRate: +((totalsBase.conversions / totalsBase.sessions) * 100).toFixed(2),
  };
  return {
    domain: dom,
    pages: sorted,
    top: sorted.slice(0, 5),
    weak: sorted.filter((p) => p.impressions > 5000 && p.ctr < 3).sort((a, b) => b.impressions - a.impressions).slice(0, 5),
    totals,
    period: "Last 28 days",
    generatedAt: new Date().toISOString(),
  };
}

const fmt = (n: number) => (n >= 1000000 ? (n / 1000000).toFixed(1) + "M" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
const dollars = (n: number) => "$" + (n >= 1000 ? (n / 1000).toFixed(1) + "k" : n.toFixed(0));
const deltaCol = (d: number) => (d >= 0 ? "#15803D" : "#DC2626");

export default function AnalyticsHub() {
  const router = useRouter();
  const [connections, setConnections] = useState<Record<string, boolean>>({ gsc: false, ga4: false });
  const [data, setData] = useState<AHData | null>(null);
  const [hasDomain, setHasDomain] = useState(false);
  const [inFlight, setInFlight] = useState(false);

  useEffect(() => {
    const domain = lsDomain();
    setHasDomain(!!domain);
    // When a domain is already analysed, show seeded analytics immediately so
    // the Analytics hero link never lands on a blank/empty shell.
    if (domain) {
      setConnections({ gsc: true, ga4: true });
      setData(ahSeed());
    }
  }, []);

  const connect = useCallback((svc: string) => {
    if (!lsDomain()) {
      toast("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return;
    }
    setInFlight(true);
    window.setTimeout(() => {
      setConnections((prev) => {
        const next = { ...prev, [svc]: true };
        if (next.gsc && next.ga4) setData(ahSeed());
        return next;
      });
      setInFlight(false);
      toast(`✓ Connected ${svc.toUpperCase()}`);
    }, 1100);
  }, [router]);

  const disconnect = useCallback((svc: string) => {
    setConnections((prev) => ({ ...prev, [svc]: false }));
    if (svc === "gsc" || svc === "ga4") setData(null);
    const src = ANALYTICS_SOURCES.find((s) => s.key === svc);
    toast(`Disconnected ${src ? src.name : svc.toUpperCase()}`);
  }, []);

  const connectAll = useCallback(() => {
    if (!lsDomain()) {
      toast("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return;
    }
    if (inFlight) {
      toast("⏳ Already authorising — hang tight…");
      return;
    }
    setInFlight(true);
    window.setTimeout(() => {
      setConnections((prev) => ({ ...prev, gsc: true, ga4: true }));
      setData(ahSeed());
      setInFlight(false);
      toast("✓ Connected GSC + GA4");
    }, 1200);
  }, [router, inFlight]);

  const refresh = useCallback(() => {
    if (!lsDomain()) {
      toast("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return;
    }
    if (!connections.gsc || !connections.ga4) {
      if (inFlight) {
        toast("⏳ Already authorising — hang tight…");
        return;
      }
      const missing: string[] = [];
      if (!connections.gsc) missing.push("Google Search Console");
      if (!connections.ga4) missing.push("Google Analytics 4");
      setInFlight(true);
      window.setTimeout(() => {
        setConnections((prev) => ({ ...prev, gsc: true, ga4: true }));
        setData(ahSeed());
        setInFlight(false);
        toast(`✓ Connected ${missing.length === 2 ? "GSC + GA4" : missing[0]} — pulled the latest 28 days`);
      }, 1400);
      return;
    }
    setData(ahSeed());
    toast("📡 Refreshed — pulled the latest 28 days");
  }, [router, connections, inFlight]);

  const manage = () => {
    setConnections((prev) => ({ ...prev, gsc: false, ga4: false }));
    setData(null);
  };

  const coreConnected = connections.gsc && connections.ga4;

  const tagStyle = (tag: string): React.CSSProperties =>
    tag === "CORE"
      ? { background: "#0F766E", color: "white" }
      : tag === "PIPELINE"
        ? { background: "#7C3AED", color: "white" }
        : { background: "#E2E8F0", color: "#475569" };

  const ConnCard = ({ s }: { s: AnalyticsSource }) => {
    const isConn = !!connections[s.key];
    const textOnYellow = s.color === "#F9AB00" || s.color === "#FFFC00";
    const btnTextCol = textOnYellow ? "#0F172A" : "white";
    const btnLabel = s.name.replace("Google ", "").replace(" Analytics", "").replace("Microsoft ", "");
    return (
      <div style={{ border: `2px solid ${isConn ? "#10B981" : "#E5E7EB"}`, borderRadius: 14, padding: 18, background: isConn ? "#F0FDF4" : "white", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: 9, background: s.color, display: "flex", alignItems: "center", justifyContent: "center", color: textOnYellow ? "#0F172A" : "white", fontWeight: 800, fontSize: "1rem", flexShrink: 0 }}>{s.icon}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.88rem", lineHeight: 1.2 }}>{s.name}</div>
              <div style={{ fontSize: "0.7rem", color: "#64748B", marginTop: 2 }}>{s.desc}</div>
            </div>
          </div>
          <span style={{ ...tagStyle(s.tag), fontSize: "0.6rem", fontWeight: 800, letterSpacing: ".4px", padding: "3px 7px", borderRadius: 5, flexShrink: 0 }}>{s.tag}</span>
        </div>
        <ul style={{ margin: "0 0 12px 16px", padding: 0, fontSize: "0.72rem", color: "#475569", lineHeight: 1.6, flex: 1 }}>
          {s.bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
        {isConn ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ color: "#15803D", fontWeight: 700, fontSize: "0.78rem" }}>✓ Connected</span>
            <button onClick={() => disconnect(s.key)} style={{ padding: "5px 10px", background: "white", color: "#64748B", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: "0.7rem", cursor: "pointer" }}>Disconnect</button>
          </div>
        ) : (
          <button onClick={() => connect(s.key)} style={{ width: "100%", padding: 9, background: s.color, color: btnTextCol, border: "none", borderRadius: 8, fontWeight: 700, fontSize: "0.76rem", cursor: "pointer" }}>🔗 Connect {btnLabel}</button>
        )}
      </div>
    );
  };

  const core = ANALYTICS_SOURCES.filter((s) => s.tag === "CORE");
  const extras = ANALYTICS_SOURCES.filter((s) => s.tag !== "CORE");
  const connectedExtras = extras.filter((s) => connections[s.key]).length;

  let body: React.ReactNode;
  if (!hasDomain && !data) {
    body = (
      <div style={{ background: "#FEF3C7", border: "1.5px solid #FCD34D", borderRadius: 14, padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: "2rem" }}>🔍</div>
        <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 700, color: "#92400E", fontSize: "1rem", margin: "10px 0 6px" }}>Run an analysis first</div>
        <div style={{ fontSize: "0.85rem", color: "#78350F", marginBottom: 14 }}>The GSC / GA4 Hub keys analytics to your domain. Click <strong>Analyse Now</strong> on the home page.</div>
        <button onClick={() => goToView(router, "home")} style={{ padding: "10px 22px", background: "#0F766E", color: "white", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer" }}>← Back to Home</button>
      </div>
    );
  } else if (!coreConnected) {
    body = (
      <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: "24px 26px", marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
          <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "1.15rem" }}>📡 Connect your data sources</div>
          <button onClick={connectAll} style={{ padding: "8px 14px", background: "linear-gradient(135deg,#0EA5E9,#0066FF)", color: "white", border: "none", borderRadius: 8, fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>⚡ Connect Recommended (GSC + GA4)</button>
        </div>
        <div style={{ fontSize: "0.84rem", color: "#64748B", marginBottom: 20 }}>InfoGenie pulls live impressions, clicks, ranks, sessions and revenue. <strong>GSC + GA4</strong> are required to unlock the dashboard — the rest are optional enrichment sources.</div>

        <div style={{ fontSize: "0.72rem", fontWeight: 800, letterSpacing: ".6px", color: "#0F766E", marginBottom: 10 }}>★ CORE — REQUIRED</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 22 }}>{core.map((s) => <ConnCard key={s.key} s={s} />)}</div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 800, letterSpacing: ".6px", color: "#475569" }}>＋ OPTIONAL ENRICHMENT ({connectedExtras}/{extras.length} connected)</div>
          <div style={{ fontSize: "0.7rem", color: "#94A3B8" }}>Add any of these for deeper signals</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>{extras.map((s) => <ConnCard key={s.key} s={s} />)}</div>

        <div style={{ marginTop: 18, padding: "14px 16px", background: "#F1F5F9", borderRadius: 10, fontSize: "0.74rem", color: "#475569", lineHeight: 1.6 }}>
          <strong>🔒 Privacy:</strong> InfoGenie uses read-only OAuth scopes. We never modify any of your settings. You can disconnect any source at any time.
        </div>
      </div>
    );
  } else if (!data) {
    body = (
      <div style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: "2rem", marginBottom: 10 }}>⏳</div>
        <div style={{ fontSize: "0.9rem", color: "#64748B" }}>Loading data — click <strong>📡 Refresh Data</strong> above to pull the latest 28 days.</div>
      </div>
    );
  } else {
    const t = data.totals;
    const kpis: [string, string, string, string][] = [
      ["👁️", fmt(t.impressions), "Impressions", "#4285F4"],
      ["🖱️", fmt(t.clicks), "Clicks", "#0F766E"],
      ["📊", t.ctr + "%", "Avg CTR", "#7C3AED"],
      ["🎯", fmt(t.conversions), "Conversions", "#F59E0B"],
      ["💰", dollars(t.revenue), "Revenue", "#059669"],
    ];
    body = (
      <>
        <div style={{ background: "linear-gradient(135deg,#ECFDF5,#F0FDFA)", border: "1px solid #A7F3D0", borderRadius: 12, padding: "14px 18px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: "0.82rem", color: "#065F46" }}><strong>✓ Connected:</strong> Google Search Console + GA4 · <strong>Property:</strong> {data.domain} · <strong>Period:</strong> {data.period}</div>
          <button onClick={manage} style={{ padding: "6px 12px", background: "white", color: "#475569", border: "1px solid #CBD5E1", borderRadius: 7, fontSize: "0.72rem", cursor: "pointer" }}>⚙ Manage</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 22 }}>
          {kpis.map(([ic, val, lbl, col], i) => (
            <div key={i} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "16px 18px" }}>
              <div style={{ fontSize: "1.3rem", marginBottom: 4 }}>{ic}</div>
              <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1.4rem", fontWeight: 800, color: col, lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: "0.7rem", color: "#64748B", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 4 }}>{lbl}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: "20px 22px" }}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "1rem", marginBottom: 4 }}>🏆 Top Performers</div>
            <div style={{ fontSize: "0.74rem", color: "#64748B", marginBottom: 14 }}>Highest revenue pages — double down with more content + paid amplification</div>
            {data.top.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: i < data.top.length - 1 ? "1px solid #F1F5F9" : undefined }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: "#DCFCE7", color: "#15803D", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.8rem" }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.84rem", fontWeight: 600, color: "#0A1628", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</div>
                  <div style={{ fontSize: "0.7rem", color: "#64748B", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.path}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#059669" }}>{dollars(p.revenue)}</div>
                  <div style={{ fontSize: "0.68rem", color: deltaCol(p.delta30d) }}>{p.delta30d >= 0 ? "▲" : "▼"} {Math.abs(p.delta30d)}%</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: "20px 22px" }}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "1rem", marginBottom: 4 }}>🚨 Weak Performers</div>
            <div style={{ fontSize: "0.74rem", color: "#64748B", marginBottom: 14 }}>High impressions, low CTR — fix titles &amp; meta descriptions to unlock traffic</div>
            {data.weak.length ? (
              data.weak.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: i < data.weak.length - 1 ? "1px solid #F1F5F9" : undefined }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: "#FEE2E2", color: "#DC2626", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.8rem" }}>!</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.84rem", fontWeight: 600, color: "#0A1628", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</div>
                    <div style={{ fontSize: "0.7rem", color: "#64748B", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.path}</div>
                    <div style={{ fontSize: "0.68rem", color: "#DC2626", marginTop: 2 }}><strong>{fmt(p.impressions)}</strong> impressions · <strong>{p.ctr}%</strong> CTR · pos <strong>{p.avgPos}</strong></div>
                  </div>
                  <button onClick={() => goToView(router, "autoseo")} style={{ padding: "7px 12px", background: "#EA580C", color: "white", border: "none", borderRadius: 7, fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Fix</button>
                </div>
              ))
            ) : (
              <div style={{ padding: "30px 0", textAlign: "center", fontSize: "0.85rem", color: "#15803D" }}>🎉 No weak performers — every page is converting well</div>
            )}
          </div>
        </div>

        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: "20px 22px", marginTop: 18 }}>
          <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "1rem", marginBottom: 14 }}>📄 All Pages</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #E5E7EB", color: "#475569", textTransform: "uppercase", fontSize: "0.65rem", letterSpacing: ".05em" }}>
                  <th style={{ textAlign: "left", padding: "9px 10px", fontWeight: 700 }}>Page</th>
                  <th style={{ textAlign: "right", padding: "9px 10px", fontWeight: 700 }}>Impressions</th>
                  <th style={{ textAlign: "right", padding: "9px 10px", fontWeight: 700 }}>Clicks</th>
                  <th style={{ textAlign: "right", padding: "9px 10px", fontWeight: 700 }}>CTR</th>
                  <th style={{ textAlign: "right", padding: "9px 10px", fontWeight: 700 }}>Avg Pos</th>
                  <th style={{ textAlign: "right", padding: "9px 10px", fontWeight: 700 }}>Sessions</th>
                  <th style={{ textAlign: "right", padding: "9px 10px", fontWeight: 700 }}>Conv</th>
                  <th style={{ textAlign: "right", padding: "9px 10px", fontWeight: 700 }}>Revenue</th>
                  <th style={{ textAlign: "right", padding: "9px 10px", fontWeight: 700 }}>Δ 30d</th>
                </tr>
              </thead>
              <tbody>
                {data.pages.map((p, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <td style={{ padding: 10, color: "#0A1628", fontWeight: 600 }}>{p.label}<div style={{ fontSize: "0.68rem", color: "#94A3B8", fontFamily: "monospace" }}>{p.path}</div></td>
                    <td style={{ textAlign: "right", padding: 10, color: "#475569" }}>{fmt(p.impressions)}</td>
                    <td style={{ textAlign: "right", padding: 10, color: "#475569" }}>{fmt(p.clicks)}</td>
                    <td style={{ textAlign: "right", padding: 10, color: p.ctr < 3 ? "#DC2626" : "#15803D", fontWeight: 600 }}>{p.ctr}%</td>
                    <td style={{ textAlign: "right", padding: 10, color: p.avgPos > 10 ? "#DC2626" : "#15803D", fontWeight: 600 }}>{p.avgPos}</td>
                    <td style={{ textAlign: "right", padding: 10, color: "#475569" }}>{fmt(p.sessions)}</td>
                    <td style={{ textAlign: "right", padding: 10, color: "#475569" }}>{p.conversions}</td>
                    <td style={{ textAlign: "right", padding: 10, color: "#059669", fontWeight: 700 }}>{dollars(p.revenue)}</td>
                    <td style={{ textAlign: "right", padding: 10, color: deltaCol(p.delta30d), fontWeight: 700 }}>{p.delta30d >= 0 ? "▲" : "▼"} {Math.abs(p.delta30d)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="view active">
      <div className="view-header" style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)" }}>
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#64748b" }}>
                <span className="bc-group" style={{ color: "#0f766e" }}>Grow</span>{" "}
                <span className="bc-sep" style={{ color: "#94a3b8" }}>›</span> GSC / GA4 Hub
              </div>
              <h2 className="view-title">📡 GSC / GA4 Analytics Hub</h2>
              <p className="view-sub" style={{ color: "#0f172a", opacity: 1, textShadow: "none" }}>Connect Google Search Console &amp; GA4 — InfoGenie pulls real impressions, clicks, ranks and revenue per page, then highlights top performers and weak performers ready to fix.</p>
            </div>
            <div className="vh-actions">
              <button className="btn-primary" style={{ background: "linear-gradient(135deg,#0f766e,#0284c7)", color: "#0f172a" }} onClick={refresh}>📡 Refresh Data</button>
            </div>
          </div>
        </div>
      </div>
      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>{body}</div>
    </div>
  );
}

"use client";

// Native React port of the legacy `landing-pages` panel (was
// `window.buildLandingPages()` + the `_lp*` helpers in app.js, and
// `#view-landing-pages` in index.html). Faithfully mirrors the AI Landing Page
// Builder: optional audience research, full-page generation, and the four result
// tabs (Preview / A/B Test / Leads / Ad Package). All data comes from the REAL
// `/api/landing-pages/*` and `/api/ad-creative/from-landing-page` endpoints via
// `lib/api`. Legacy inline styling is preserved.

import { useCallback, useRef, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/api";

interface ResearchSegment {
  name?: string;
  demographics?: string;
  trigger?: string;
}
interface ResearchObjection {
  objection: string;
  rebuttal: string;
}
interface Research {
  segments?: ResearchSegment[];
  pain_points?: string[];
  hooks?: string[];
  power_words?: string[];
  objections?: ResearchObjection[];
}
interface AbStat {
  views?: number;
  conversions?: number;
  cvr?: number | string;
}
interface Lead {
  name?: string;
  email?: string;
  variant?: string;
  created_at?: string;
}
interface AdPackage {
  platform: string;
  formats?: string[];
  headline?: string;
  hook?: string;
  primary_text?: string;
  description?: string;
  script_summary?: string;
  cta_button?: string;
  notes?: string;
  hashtags?: string[];
}

type Tab = "preview" | "ab" | "leads" | "ads";

function toast(msg: string) {
  try {
    (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
  } catch {
    /* legacy toast not available */
  }
}

function download(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontSize: "0.86rem",
  boxSizing: "border-box",
};
const lblStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
  marginBottom: 4,
};
const pIcons: Record<string, string> = {
  "Meta (Facebook + Instagram)": "📘",
  "Google Display": "🔷",
  TikTok: "🎵",
};

export default function LandingPages() {
  // research
  const [resOpen, setResOpen] = useState(false);
  const [resProduct, setResProduct] = useState("");
  const [resMarket, setResMarket] = useState("");
  const [resBusy, setResBusy] = useState(false);
  const [research, setResearch] = useState<Research | null>(null);
  const [resSource, setResSource] = useState("");
  const [resError, setResError] = useState("");
  const [resApplied, setResApplied] = useState(false);

  // page form
  const [brand, setBrand] = useState("");
  const [title, setTitle] = useState("");
  const [accent, setAccent] = useState("#14B8A6");
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [brief, setBrief] = useState("");

  // generated page
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | number | null>(null);
  const [source, setSource] = useState("");
  const [tab, setTab] = useState<Tab>("preview");

  // ab test
  const [abAngle, setAbAngle] = useState("social-proof-heavy");
  const [abBusy, setAbBusy] = useState(false);
  const [abError, setAbError] = useState("");
  const [variantHtml, setVariantHtml] = useState<string | null>(null);
  const [abStats, setAbStats] = useState<{ a: AbStat; b: AbStat } | null>(null);

  // leads
  const [webhookUrl, setWebhookUrl] = useState("");
  const [leadsData, setLeadsData] = useState<{
    total?: number;
    today?: number;
    leads?: Lead[];
  } | null>(null);
  const [leadsError, setLeadsError] = useState("");

  // ads
  const [adBusy, setAdBusy] = useState(false);
  const [adError, setAdError] = useState("");
  const [adPackages, setAdPackages] = useState<AdPackage[] | null>(null);
  const [adSource, setAdSource] = useState("");

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const runResearch = useCallback(async () => {
    if (!resProduct.trim()) {
      toast("⚠️ Enter your product or service first");
      return;
    }
    setResBusy(true);
    setResError("");
    setResearch(null);
    const r = await apiPost("/api/landing-pages/research-audience", {
      product: resProduct,
      market: resMarket,
      goal,
    });
    setResBusy(false);
    if (!r.ok) {
      setResError(r.error || "research failed");
      return;
    }
    setResearch((r.research as Research) || {});
    setResSource((r.source as string) || "");
  }, [resProduct, resMarket, goal]);

  const applyResearch = useCallback(() => {
    if (!research) return;
    const painStr = (research.pain_points || []).slice(0, 3).join("; ");
    const hooksStr = (research.hooks || []).slice(0, 2).join("; ");
    const wordsStr = (research.power_words || []).join(", ");
    const objStr = (research.objections || [])
      .slice(0, 2)
      .map((o) => `"${o.objection}" → "${o.rebuttal}"`)
      .join(". ");
    if (!audience) setAudience((research.segments || []).map((s) => s.name).join(", "));
    setBrief(
      `Pain points: ${painStr}. Hooks: ${hooksStr}. Power words: ${wordsStr}. Handle objections: ${objStr}`,
    );
    setResApplied(true);
    setResOpen(false);
    toast("✅ Research applied to brief");
  }, [research, audience]);

  const generate = useCallback(async () => {
    if (!title.trim()) {
      toast("⚠️ Page title required");
      return;
    }
    setGenBusy(true);
    setGenError("");
    setHtml(null);
    const r = await apiPost("/api/landing-pages/generate", {
      brand,
      title,
      goal,
      audience,
      brief,
      accent,
    });
    setGenBusy(false);
    if (!r.ok) {
      setGenError(r.error || "failed");
      return;
    }
    const newHtml = (r.html as string) || "";
    setHtml(newHtml);
    setPageId((r.id as string | number) || null);
    setSource((r.source as string) || "");
    setTab("preview");
    setVariantHtml(null);
    setAbStats(null);
    setLeadsData(null);
    setAdPackages(null);
    setTimeout(() => {
      if (iframeRef.current) iframeRef.current.srcdoc = newHtml;
    }, 0);
  }, [brand, title, goal, audience, brief, accent]);

  const loadAbResults = useCallback(async () => {
    if (!pageId) return;
    const r = await apiGet("/api/landing-pages/ab-results/" + pageId);
    if (!r.ok) return;
    setAbStats({ a: (r.a as AbStat) || {}, b: (r.b as AbStat) || {} });
  }, [pageId]);

  const genVariant = useCallback(async () => {
    if (!pageId) {
      toast("⚠️ Page must be saved to DB first (re-generate with a title)");
      return;
    }
    setAbBusy(true);
    setAbError("");
    const r = await apiPost("/api/landing-pages/ab-variant", {
      page_id: pageId,
      angle: abAngle,
    });
    setAbBusy(false);
    if (!r.ok) {
      setAbError(r.error || "failed");
      return;
    }
    setVariantHtml((r.html as string) || "");
  }, [pageId, abAngle]);

  const loadLeads = useCallback(async () => {
    if (!pageId) return;
    setLeadsError("");
    const r = await apiGet("/api/landing-pages/leads/" + pageId);
    if (!r.ok) {
      setLeadsError(r.error || "error");
      setLeadsData(null);
      return;
    }
    setLeadsData({
      total: (r.total as number) || 0,
      today: (r.today as number) || 0,
      leads: (r.leads as Lead[]) || [],
    });
  }, [pageId]);

  const saveWebhook = useCallback(async () => {
    if (!pageId) {
      toast("⚠️ Page must be saved first");
      return;
    }
    const r = await apiPut("/api/landing-pages/webhook/" + pageId, {
      webhook_url: webhookUrl,
    });
    if (r.ok) toast("✅ Webhook saved");
    else toast("⚠️ " + (r.error || "failed"));
  }, [pageId, webhookUrl]);

  const genAdPackage = useCallback(async () => {
    if (!pageId) {
      toast("⚠️ Page must be saved first");
      return;
    }
    setAdBusy(true);
    setAdError("");
    const r = await apiPost("/api/ad-creative/from-landing-page", { page_id: pageId });
    setAdBusy(false);
    if (!r.ok) {
      setAdError(r.error || "failed");
      return;
    }
    setAdPackages((r.packages as AdPackage[]) || []);
    setAdSource((r.source as string) || "");
  }, [pageId]);

  const switchTab = useCallback(
    (t: Tab) => {
      setTab(t);
      if (t === "leads" && pageId) loadLeads();
      if (t === "ab" && pageId) loadAbResults();
    },
    [pageId, loadLeads, loadAbResults],
  );

  const publicUrl = pageId
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/lp/${pageId}`
    : null;

  const tabBtn = (t: Tab, label: string, badge?: React.ReactNode): React.ReactNode => {
    const active = tab === t;
    return (
      <button
        onClick={() => switchTab(t)}
        style={{
          padding: "12px 16px",
          border: "none",
          background: "transparent",
          fontSize: "0.8rem",
          fontWeight: active ? 700 : 600,
          color: active ? "#14B8A6" : "#64748B",
          borderBottom: active ? "2px solid #14B8A6" : "2px solid transparent",
          marginBottom: -2,
          cursor: "pointer",
        }}
      >
        {label}
        {badge}
      </button>
    );
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span> <span className="bc-sep">›</span> AI Landing
                Pages
              </div>
              <h2 className="view-title">🚀 AI Landing Page Builder</h2>
              <p className="view-sub">
                Brief in, full HTML landing page out — hero, features, FAQs, final CTA. Includes{" "}
                <strong>🔍 Audience Research</strong>, <strong>🧪 A/B Split Testing</strong>,{" "}
                <strong>📋 Lead Capture &amp; Analytics</strong>, and{" "}
                <strong>📣 Create Once Publish Everywhere</strong>.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {/* Research */}
        <div
          style={{
            background: "linear-gradient(135deg,#EEF2FF,#F0F9FF)",
            border: "1.5px solid #C7D2FE",
            borderRadius: 14,
            padding: "16px 20px",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
            }}
            onClick={() => setResOpen((o) => !o)}
          >
            <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#3730A3" }}>
              🔍 Research Audience First{" "}
              <span style={{ fontSize: "0.72rem", fontWeight: 500, color: "#6366F1", marginLeft: 6 }}>
                optional — AI analyses your market before building
              </span>
            </div>
            <span style={{ color: "#6366F1", fontSize: "0.9rem" }}>{resOpen ? "▲" : "▼"}</span>
          </div>
          {resOpen && (
            <div style={{ paddingTop: 14 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div>
                  <label style={lblStyle}>Product / Service</label>
                  <input
                    value={resProduct}
                    onChange={(e) => setResProduct(e.target.value)}
                    placeholder="e.g. HR software for SMBs"
                    style={{ ...inputStyle, border: "1px solid #C7D2FE", fontSize: "0.83rem", background: "#fff" }}
                  />
                </div>
                <div>
                  <label style={lblStyle}>Target Market</label>
                  <input
                    value={resMarket}
                    onChange={(e) => setResMarket(e.target.value)}
                    placeholder="e.g. HR managers at 50-200 person companies"
                    style={{ ...inputStyle, border: "1px solid #C7D2FE", fontSize: "0.83rem", background: "#fff" }}
                  />
                </div>
              </div>
              <button
                onClick={runResearch}
                disabled={resBusy}
                style={{
                  padding: "9px 20px",
                  background: "#6366F1",
                  border: "none",
                  borderRadius: 8,
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                {resBusy ? "⏳ Researching…" : "🔍 Research Audience"}
              </button>
              <div style={{ marginTop: 12 }}>
                {resBusy && (
                  <div style={{ color: "#6366F1", fontSize: "0.8rem", padding: "8px 0" }}>
                    Analysing your audience, pain points and language patterns…
                  </div>
                )}
                {resError && <div style={{ color: "#EF4444", fontSize: "0.8rem" }}>⚠️ {resError}</div>}
                {research && !resBusy && (
                  <div
                    style={{
                      background: "#fff",
                      borderRadius: 12,
                      border: "1.5px solid #C7D2FE",
                      padding: 16,
                      marginTop: 4,
                    }}
                  >
                    <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1E293B", marginBottom: 12 }}>
                      ✅ Audience Research Complete{" "}
                      <span style={{ fontSize: "0.7rem", fontWeight: 500, color: "#6366F1", marginLeft: 6 }}>
                        {resSource}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
                        gap: 10,
                        marginBottom: 12,
                      }}
                    >
                      {(research.segments || []).map((s, i) => (
                        <div key={i} style={{ background: "#F8FAFC", borderRadius: 8, padding: 10 }}>
                          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#6366F1", marginBottom: 3 }}>
                            {s.name || ""}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "#475569" }}>{s.demographics || ""}</div>
                          <div style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: 3 }}>{s.trigger || ""}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", marginBottom: 6 }}>
                          TOP PAIN POINTS
                        </div>
                        {(research.pain_points || []).slice(0, 4).map((p, i) => (
                          <div key={i} style={{ fontSize: "0.75rem", color: "#475569", padding: "4px 0", borderBottom: "1px solid #F1F5F9" }}>
                            • {p}
                          </div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", marginBottom: 6 }}>
                          HOOK ANGLES
                        </div>
                        {(research.hooks || []).slice(0, 4).map((h, i) => (
                          <div
                            key={i}
                            style={{
                              fontSize: "0.75rem",
                              color: "#475569",
                              padding: "4px 0",
                              borderBottom: "1px solid #F1F5F9",
                              fontStyle: "italic",
                            }}
                          >
                            &quot;{h}&quot;
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", marginBottom: 6 }}>
                        POWER WORDS
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {(research.power_words || []).map((w, i) => (
                          <span
                            key={i}
                            style={{
                              background: "#EEF2FF",
                              color: "#6366F1",
                              padding: "3px 8px",
                              borderRadius: 5,
                              fontSize: "0.72rem",
                              fontWeight: 600,
                            }}
                          >
                            {w}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={applyResearch}
                      style={{
                        padding: "8px 18px",
                        background: "#16A34A",
                        border: "none",
                        borderRadius: 8,
                        fontSize: "0.8rem",
                        fontWeight: 700,
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      ✅ Apply to Brief &amp; Auto-fill
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Page form */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 20,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 110px",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label style={lblStyle}>Brand (optional)</label>
              <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Nike" style={inputStyle} />
            </div>
            <div>
              <label style={lblStyle}>Page title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Air Max 270 launch"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={lblStyle}>Accent</label>
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                style={{ width: "100%", height: 38, padding: 2, border: "1px solid #D1D5DB", borderRadius: 8, cursor: "pointer" }}
              />
            </div>
            <div>
              <label style={lblStyle}>Goal</label>
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. drive 1000 signups in week 1"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={lblStyle}>Audience</label>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. urban runners, 25-40"
                style={inputStyle}
              />
            </div>
          </div>
          <div>
            <label style={lblStyle}>
              Brief (optional){" "}
              {resApplied && (
                <span style={{ color: "#16A34A", fontSize: "0.68rem", fontWeight: 600 }}>✓ Research applied</span>
              )}
            </label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={3}
              placeholder="Anything the page should mention — features, offer, deadline, USP."
              style={{ ...inputStyle, padding: "10px 12px", fontFamily: "inherit", resize: "vertical" }}
            />
          </div>
          <button
            onClick={generate}
            disabled={genBusy}
            style={{
              marginTop: 12,
              padding: "10px 22px",
              background: "#14B8A6",
              border: "2px solid #14B8A6",
              borderRadius: 8,
              fontSize: "0.84rem",
              fontWeight: 800,
              color: "#fff",
              WebkitTextFillColor: "#fff",
              cursor: "pointer",
              textShadow: "0 1px 2px rgba(0,0,0,.4)",
            }}
          >
            🎨 Generate Page
          </button>
        </div>

        {/* Output */}
        <div>
          {genBusy && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 20, color: "#6B7280" }}>
              ⏳ Drafting full landing page…
            </div>
          )}
          {genError && !genBusy && (
            <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10 }}>{genError}</div>
          )}
          {html && !genBusy && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ display: "flex", borderBottom: "2px solid #E2E8F0", background: "#F8FAFC", padding: "0 16px" }}>
                {tabBtn(
                  "preview",
                  "🖼️ Preview",
                  <span
                    style={{
                      background: source === "openai" ? "#14B8A6" : "#9CA3AF",
                      color: "#fff",
                      padding: "3px 9px",
                      borderRadius: 5,
                      fontSize: "0.62rem",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      marginLeft: 8,
                    }}
                  >
                    {source}
                  </span>,
                )}
                {tabBtn("ab", "🧪 A/B Test")}
                {tabBtn("leads", "📋 Leads")}
                {tabBtn("ads", "📣 Ad Package")}
              </div>

              {/* Preview */}
              <div style={{ display: tab === "preview" ? "block" : "none", padding: 16 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 800, color: "#0A1628" }}>🖼️ Live Preview</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={() => {
                        if (html) {
                          download(html, "landing-page.html");
                          toast("✅ Downloaded");
                        }
                      }}
                      style={{
                        padding: "8px 14px",
                        background: "#15803D",
                        border: "2px solid #15803D",
                        borderRadius: 6,
                        fontSize: "0.76rem",
                        fontWeight: 800,
                        color: "#fff",
                        WebkitTextFillColor: "#fff",
                        cursor: "pointer",
                        textShadow: "0 1px 2px rgba(0,0,0,.4)",
                      }}
                    >
                      ⬇️ Download
                    </button>
                    <button
                      onClick={async () => {
                        if (!html) return;
                        try {
                          await navigator.clipboard.writeText(html);
                          toast("✅ HTML copied");
                        } catch (e) {
                          toast("❌ " + (e instanceof Error ? e.message : "copy failed"));
                        }
                      }}
                      style={{ padding: "8px 14px", background: "#fff", border: "2px solid #D1D5DB", borderRadius: 6, fontSize: "0.76rem", fontWeight: 700, color: "#374151", cursor: "pointer" }}
                    >
                      📋 Copy HTML
                    </button>
                    <button
                      onClick={() => {
                        if (!html) return;
                        const w = window.open("", "_blank");
                        if (w) {
                          w.document.open();
                          w.document.write(html);
                          w.document.close();
                        }
                      }}
                      style={{ padding: "8px 14px", background: "#fff", border: "2px solid #D1D5DB", borderRadius: 6, fontSize: "0.76rem", fontWeight: 700, color: "#374151", cursor: "pointer" }}
                    >
                      ↗️ Open
                    </button>
                    {publicUrl && (
                      <a
                        href={publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ padding: "8px 14px", background: "#EFF6FF", border: "2px solid #BFDBFE", borderRadius: 6, fontSize: "0.76rem", fontWeight: 700, color: "#1D4ED8", textDecoration: "none" }}
                      >
                        🌐 Public URL
                      </a>
                    )}
                  </div>
                </div>
                <iframe
                  ref={iframeRef}
                  style={{ width: "100%", height: 720, border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}
                  sandbox="allow-same-origin allow-scripts"
                />
              </div>

              {/* A/B */}
              <div style={{ display: tab === "ab" ? "block" : "none", padding: 20 }}>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, color: "#1E293B", marginBottom: 4 }}>🧪 A/B Split Test</div>
                  <div style={{ fontSize: "0.8rem", color: "#64748B" }}>
                    Generate an alternative variant with a different persuasion angle, then compare conversion rates.
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                  <select
                    value={abAngle}
                    onChange={(e) => setAbAngle(e.target.value)}
                    style={{ padding: "9px 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.82rem", background: "#fff" }}
                  >
                    <option value="social-proof-heavy">Social Proof Heavy</option>
                    <option value="fear-based">Fear / Loss Aversion</option>
                    <option value="curiosity">Curiosity / Intrigue</option>
                    <option value="authority">Authority / Expert</option>
                    <option value="benefit-led">Pure Benefit Led</option>
                    <option value="urgency">Urgency / Scarcity</option>
                    <option value="storytelling">Storytelling / Narrative</option>
                  </select>
                  <button
                    onClick={genVariant}
                    disabled={abBusy}
                    style={{ padding: "9px 18px", background: "#8B5CF6", border: "none", borderRadius: 8, fontSize: "0.82rem", fontWeight: 700, color: "#fff", cursor: "pointer" }}
                  >
                    {abBusy ? "⏳ Generating…" : "🧪 Generate Variant B"}
                  </button>
                  {pageId && (
                    <button
                      onClick={loadAbResults}
                      style={{ padding: "9px 14px", background: "#F8FAFC", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.8rem", fontWeight: 600, color: "#475569", cursor: "pointer" }}
                    >
                      📊 Refresh Stats
                    </button>
                  )}
                </div>
                <div>
                  {abBusy && (
                    <div style={{ color: "#8B5CF6", fontSize: "0.8rem", padding: "8px 0" }}>Generating alternative variant…</div>
                  )}
                  {abError && <div style={{ color: "#EF4444", fontSize: "0.8rem" }}>⚠️ {abError}</div>}
                  {variantHtml && !abBusy && (
                    <>
                      <div style={{ marginBottom: 14 }}>
                        <span style={{ background: "#EDE9FE", color: "#6D28D9", padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700 }}>
                          ✅ Variant B Generated — {abAngle} angle
                        </span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#6B7280", marginBottom: 6 }}>VARIANT A — Original</div>
                          <iframe srcDoc={html || ""} style={{ width: "100%", height: 380, border: "1px solid #D1D5DB", borderRadius: 8 }} sandbox="allow-same-origin allow-scripts" />
                        </div>
                        <div>
                          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#6B7280", marginBottom: 6 }}>VARIANT B — {abAngle}</div>
                          <iframe srcDoc={variantHtml} style={{ width: "100%", height: 380, border: "1px solid #C4B5FD", borderRadius: 8 }} sandbox="allow-same-origin allow-scripts" />
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                        <button
                          onClick={loadAbResults}
                          style={{ padding: "8px 14px", background: "#F8FAFC", border: "1px solid #D1D5DB", borderRadius: 7, fontSize: "0.78rem", fontWeight: 600, color: "#475569", cursor: "pointer" }}
                        >
                          📊 View Stats
                        </button>
                        <button
                          onClick={() => {
                            if (variantHtml) {
                              download(variantHtml, "landing-page-variant-b.html");
                              toast("✅ Downloaded Variant B");
                            }
                          }}
                          style={{ padding: "8px 14px", background: "#F8FAFC", border: "1px solid #D1D5DB", borderRadius: 7, fontSize: "0.78rem", fontWeight: 600, color: "#475569", cursor: "pointer" }}
                        >
                          ⬇️ Download B
                        </button>
                      </div>
                    </>
                  )}
                  {abStats && (
                    <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: 16 }}>
                      {(() => {
                        const a = abStats.a;
                        const b = abStats.b;
                        const winner =
                          (a.views || 0) + (b.views || 0) > 0
                            ? parseFloat(String(b.cvr)) > parseFloat(String(a.cvr))
                              ? "B"
                              : "A"
                            : null;
                        const cards: [string, AbStat, string][] = [
                          ["A (Original)", a, "#14B8A6"],
                          ["B — " + abAngle, b, "#8B5CF6"],
                        ];
                        return (
                          <>
                            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1E293B", marginBottom: 12 }}>
                              📊 A/B Results{" "}
                              {winner && (
                                <span style={{ background: "#D1FAE5", color: "#065F46", padding: "2px 8px", borderRadius: 5, fontSize: "0.7rem", marginLeft: 8 }}>
                                  Variant {winner} winning
                                </span>
                              )}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                              {cards.map(([label, d, clr]) => (
                                <div key={label} style={{ background: "#F8FAFC", borderRadius: 10, padding: 14, borderLeft: `4px solid ${clr}` }}>
                                  <div style={{ fontSize: "0.8rem", fontWeight: 700, color: clr, marginBottom: 10 }}>{label}</div>
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", textAlign: "center", gap: 6 }}>
                                    <div>
                                      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#1E293B" }}>{d.views || 0}</div>
                                      <div style={{ fontSize: "0.62rem", color: "#94A3B8", fontWeight: 600 }}>VIEWS</div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#1E293B" }}>{d.conversions || 0}</div>
                                      <div style={{ fontSize: "0.62rem", color: "#94A3B8", fontWeight: 600 }}>LEADS</div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: clr }}>{d.cvr || 0}%</div>
                                      <div style={{ fontSize: "0.62rem", color: "#94A3B8", fontWeight: 600 }}>CVR</div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>

              {/* Leads */}
              <div style={{ display: tab === "leads" ? "block" : "none", padding: 20 }}>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, color: "#1E293B", marginBottom: 4 }}>📋 Lead Analytics</div>
                  <div style={{ fontSize: "0.8rem", color: "#64748B" }}>
                    Form submissions from your live page appear here. Set a webhook to pipe leads to HubSpot, Zapier, or any URL.
                  </div>
                </div>
                {pageId ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                      <input
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        placeholder="https://hooks.zapier.com/..."
                        style={{ flex: 1, minWidth: 280, padding: "9px 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.82rem" }}
                      />
                      <button
                        onClick={saveWebhook}
                        style={{ padding: "9px 16px", background: "#14B8A6", border: "none", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700, color: "#fff", cursor: "pointer" }}
                      >
                        💾 Save Webhook
                      </button>
                    </div>
                    <button
                      onClick={loadLeads}
                      style={{ padding: "8px 16px", background: "#F8FAFC", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.8rem", fontWeight: 600, color: "#475569", cursor: "pointer", marginBottom: 14 }}
                    >
                      🔄 Load Leads
                    </button>
                    <div>
                      {leadsError && <div style={{ color: "#EF4444", fontSize: "0.8rem" }}>⚠️ {leadsError}</div>}
                      {leadsData && (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
                            <div style={{ background: "#F0FDF4", borderRadius: 10, padding: 14, textAlign: "center" }}>
                              <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#15803D" }}>{leadsData.total || 0}</div>
                              <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 600 }}>TOTAL LEADS</div>
                            </div>
                            <div style={{ background: "#EFF6FF", borderRadius: 10, padding: 14, textAlign: "center" }}>
                              <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#1D4ED8" }}>{leadsData.today || 0}</div>
                              <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 600 }}>TODAY</div>
                            </div>
                            <div style={{ background: "#F5F3FF", borderRadius: 10, padding: 14, textAlign: "center" }}>
                              <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#7C3AED" }}>
                                {(leadsData.leads || []).filter((l) => l.variant === "b").length}
                              </div>
                              <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 600 }}>VARIANT B</div>
                            </div>
                          </div>
                          {leadsData.leads && leadsData.leads.length ? (
                            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #E2E8F0", overflow: "hidden" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                  <tr style={{ background: "#F8FAFC" }}>
                                    {["NAME", "EMAIL", "VARIANT", "DATE"].map((h) => (
                                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.7rem", color: "#64748B", fontWeight: 700 }}>
                                        {h}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {(leadsData.leads || []).slice(0, 50).map((l, i) => (
                                    <tr key={i} style={{ borderTop: "1px solid #F1F5F9" }}>
                                      <td style={{ padding: "9px 12px", fontSize: "0.8rem", color: "#1E293B" }}>{l.name || "—"}</td>
                                      <td style={{ padding: "9px 12px", fontSize: "0.8rem", color: "#6366F1" }}>{l.email || "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>
                                        <span
                                          style={{
                                            background: l.variant === "b" ? "#EDE9FE" : "#ECFDF5",
                                            color: l.variant === "b" ? "#6D28D9" : "#065F46",
                                            padding: "2px 7px",
                                            borderRadius: 4,
                                            fontSize: "0.68rem",
                                            fontWeight: 700,
                                          }}
                                        >
                                          {(l.variant || "a").toUpperCase()}
                                        </span>
                                      </td>
                                      <td style={{ padding: "9px 12px", fontSize: "0.75rem", color: "#94A3B8" }}>
                                        {l.created_at ? new Date(l.created_at).toLocaleDateString() : ""}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div style={{ textAlign: "center", padding: 24, color: "#94A3B8", fontSize: "0.85rem" }}>
                              No leads yet. Share your{" "}
                              <a href={`/lp/${pageId}`} target="_blank" rel="noreferrer" style={{ color: "#6366F1" }}>
                                public page URL
                              </a>{" "}
                              to start capturing leads.
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ color: "#94A3B8", fontSize: "0.84rem" }}>Save this page first to enable lead capture.</div>
                )}
              </div>

              {/* Ads */}
              <div style={{ display: tab === "ads" ? "block" : "none", padding: 20 }}>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, color: "#1E293B", marginBottom: 4 }}>📣 Create Once, Publish Everywhere</div>
                  <div style={{ fontSize: "0.8rem", color: "#64748B" }}>
                    Instantly generate matching ad copy for Meta, Google Display, and TikTok from this landing page.
                  </div>
                </div>
                {pageId ? (
                  <button
                    onClick={genAdPackage}
                    disabled={adBusy}
                    style={{ padding: "10px 20px", background: "linear-gradient(135deg,#6366F1,#8B5CF6)", border: "none", borderRadius: 8, fontSize: "0.84rem", fontWeight: 700, color: "#fff", cursor: "pointer", marginBottom: 16 }}
                  >
                    {adBusy ? "⏳ Generating…" : "📣 Generate Ad Package"}
                  </button>
                ) : (
                  <div style={{ color: "#94A3B8", fontSize: "0.84rem" }}>Save this page first to generate ad assets.</div>
                )}
                <div>
                  {adBusy && (
                    <div style={{ color: "#6366F1", fontSize: "0.8rem", padding: "8px 0" }}>
                      Analysing landing page and generating ad copy for all platforms…
                    </div>
                  )}
                  {adError && <div style={{ color: "#EF4444", fontSize: "0.8rem" }}>⚠️ {adError}</div>}
                  {adPackages && !adBusy && (
                    <>
                      <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1E293B", marginBottom: 12 }}>
                        ✅ Ad Package Ready{" "}
                        <span style={{ fontSize: "0.7rem", fontWeight: 500, color: "#64748B" }}>{adSource} · 3 platforms</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {adPackages.map((pkg, i) => (
                          <div key={i} style={{ background: "#fff", borderRadius: 12, border: "1.5px solid #E2E8F0", padding: 16 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                              <span>{pIcons[pkg.platform] || "📢"}</span>
                              <div style={{ fontWeight: 700, color: "#1E293B", fontSize: "0.88rem" }}>{pkg.platform}</div>
                              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                                {(pkg.formats || []).map((f, j) => (
                                  <span key={j} style={{ background: "#F1F5F9", color: "#475569", padding: "2px 7px", borderRadius: 4, fontSize: "0.67rem", fontWeight: 600 }}>
                                    {f}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                              <div>
                                <div style={{ fontSize: "0.67rem", fontWeight: 700, color: "#94A3B8", marginBottom: 3 }}>HEADLINE</div>
                                <div style={{ fontSize: "0.82rem", color: "#1E293B", fontWeight: 600 }}>{pkg.headline || pkg.hook || ""}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: "0.67rem", fontWeight: 700, color: "#94A3B8", marginBottom: 3 }}>
                                  {pkg.platform === "TikTok" ? "CONCEPT" : "BODY COPY"}
                                </div>
                                <div style={{ fontSize: "0.78rem", color: "#475569" }}>
                                  {pkg.primary_text || pkg.description || pkg.script_summary || ""}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              {pkg.cta_button && (
                                <span style={{ background: "#EFF6FF", color: "#1D4ED8", padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700 }}>
                                  CTA: {pkg.cta_button}
                                </span>
                              )}
                              <span style={{ fontSize: "0.73rem", color: "#94A3B8", fontStyle: "italic" }}>{pkg.notes || ""}</span>
                              <button
                                onClick={() =>
                                  navigator.clipboard.writeText(
                                    JSON.stringify({
                                      headline: pkg.headline || pkg.hook,
                                      body: pkg.primary_text || pkg.description || pkg.script_summary,
                                      cta: pkg.cta_button,
                                    }),
                                  )
                                }
                                style={{ marginLeft: "auto", padding: "5px 10px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: "0.72rem", fontWeight: 600, color: "#475569", cursor: "pointer" }}
                              >
                                📋 Copy
                              </button>
                            </div>
                            {pkg.hashtags && pkg.hashtags.length > 0 && (
                              <div style={{ marginTop: 8 }}>
                                {pkg.hashtags.map((h, j) => (
                                  <span key={j} style={{ color: "#6366F1", fontSize: "0.72rem" }}>
                                    #{h}{" "}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

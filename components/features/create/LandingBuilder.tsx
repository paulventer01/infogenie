"use client";

// Native React port of the legacy `landing-builder` panel (was
// `buildLandingBuilder` / `runLandingBuilder` / `exportLandingHtml` in app.js +
// the `#view-landing-builder` block in index.html).
//
// NOTE: this is a CLIENT-SIDE generator — the legacy builder has NO backing
// `/api/*` endpoint. It deterministically derives a conversion landing page
// (hero, social proof, problem, solution, features, FAQ, CTA) from the user's
// last competitor analysis (`window.analysisData`) using the same seeded RNG
// (`_seedRng`) and the same `_lsAD/_lsDomain/_lsBrand/_lsSector/_lsKeywords`
// lookups as the legacy module, then exports the assembled HTML. Reproduced
// faithfully here; when no analysis exists it shows the legacy empty-state card.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

interface AnalysisCompetitor {
  keywords?: string[];
  topKeyword?: string;
}
interface AnalysisData {
  url?: string;
  domain?: string;
  brand?: string;
  brandName?: string;
  sector?: string;
  industry?: string | { name?: string };
  keywords?: string[];
  competitors?: AnalysisCompetitor[];
}

function lsAD(): AnalysisData | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { analysisData?: AnalysisData };
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
function lsBrand(): string {
  const ad = lsAD();
  return (
    (ad && (ad.brand || ad.brandName)) || lsDomain().split(".")[0] || "your brand"
  );
}
function lsSector(): string {
  const ad = lsAD();
  if (ad) {
    if (ad.sector) return ad.sector;
    if (ad.industry && typeof ad.industry === "string") return ad.industry;
    if (ad.industry && typeof ad.industry === "object" && ad.industry.name)
      return ad.industry.name;
  }
  return "your industry";
}
function lsKeywords(): string[] {
  const ad = lsAD();
  if (!ad) return [];
  if (Array.isArray(ad.keywords)) return ad.keywords.slice(0, 12);
  if (Array.isArray(ad.competitors)) {
    const k: string[] = [];
    ad.competitors.forEach((c) => {
      if (c.keywords) k.push(...c.keywords);
      else if (c.topKeyword) k.push(c.topKeyword);
    });
    return k.slice(0, 12);
  }
  return [];
}
function seedRng(seedStr: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };
}
function esc(s: string): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function toast(msg: string) {
  const fn = (window as unknown as { showToast?: (m: string) => void }).showToast;
  if (fn) fn(msg);
  else alert(msg);
}

interface Section {
  name: string;
  icon: string;
  html: string;
}

function generate(): Section[] {
  const brand = esc(lsBrand());
  const sector = esc(lsSector());
  const kw = esc(lsKeywords()[0] || lsSector());
  const rng = seedRng(lsDomain() + "lp");
  const cl = ["#0EA5E9", "#6366F1", "#A855F7", "#10B981", "#F59E0B"];
  const accent = cl[Math.floor(rng() * cl.length)];
  return [
    {
      name: "Hero",
      icon: "🎯",
      html: `
        <div style="padding:54px 40px;text-align:center;background:linear-gradient(135deg,${accent}15,white)">
          <div style="display:inline-block;padding:5px 12px;background:${accent}20;color:${accent};border-radius:99px;font-size:11px;font-weight:700;margin-bottom:14px">⚡ Trusted by 2,400+ ${sector} teams</div>
          <h1 style="font-size:38px;margin:0 0 14px;color:#0F172A;line-height:1.15;font-weight:800">The fastest way to ${kw} —<br/>without the agency price tag</h1>
          <p style="font-size:17px;color:#64748B;max-width:560px;margin:0 auto 22px">${brand} replaces 5 tools and 3 freelancers with one AI-powered workflow. Get launch-ready ${sector} assets in minutes, not weeks.</p>
          <div style="display:flex;gap:10px;justify-content:center"><button style="padding:13px 26px;background:${accent};color:white;border:none;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer">Start free — no card →</button><button style="padding:13px 26px;background:white;color:${accent};border:2px solid ${accent};border-radius:8px;font-weight:700;font-size:15px;cursor:pointer">▶ Watch 90-sec demo</button></div>
          <div style="margin-top:20px;font-size:12px;color:#94A3B8">★★★★★ &nbsp; 4.9/5 from 1,200+ reviews</div>
        </div>`,
    },
    {
      name: "Social Proof",
      icon: "⭐",
      html: `
        <div style="padding:36px 40px;background:#F8FAFC;border-top:1px solid #E2E8F0;border-bottom:1px solid #E2E8F0">
          <div style="text-align:center;font-size:11px;color:#64748B;font-weight:700;letter-spacing:.1em;margin-bottom:18px">TRUSTED BY TEAMS AT</div>
          <div style="display:flex;justify-content:space-around;align-items:center;flex-wrap:wrap;gap:18px;opacity:.7">
            ${["ACME", "Zenith", "NorthStar", "Volta", "Cipher", "Altair"].map((n) => `<div style="font-size:20px;font-weight:800;color:#475569;letter-spacing:.05em">${n}</div>`).join("")}
          </div>
        </div>`,
    },
    {
      name: "Problem",
      icon: "⚠️",
      html: `
        <div style="padding:48px 40px">
          <h2 style="font-size:28px;text-align:center;margin:0 0 24px;color:#0F172A">The ${sector} growth problem</h2>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
            ${["Tools cost $2,400/mo", "Agencies bill $8K/project", "Results take 90+ days"].map((t, i) => `<div style="padding:18px;background:#FEF2F2;border-left:3px solid #EF4444;border-radius:8px"><div style="font-size:24px;margin-bottom:6px">${["💸", "⏰", "📉"][i]}</div><div style="font-weight:700;color:#1E293B;margin-bottom:4px">${t}</div><div style="font-size:13px;color:#64748B">And you still don't know if it's working.</div></div>`).join("")}
          </div>
        </div>`,
    },
    {
      name: "Solution",
      icon: "✨",
      html: `
        <div style="padding:48px 40px;background:linear-gradient(135deg,#F0FDF4,white)">
          <h2 style="font-size:28px;text-align:center;margin:0 0 8px;color:#0F172A">${brand} fixes all three</h2>
          <p style="text-align:center;color:#64748B;margin:0 0 26px">One platform. AI-driven. Results in days, not quarters.</p>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
            ${["$99/mo flat — replaces $2,400 of tools", "No agency — AI does the work", "Live results from day 3"].map((t, i) => `<div style="padding:18px;background:white;border:1px solid #BBF7D0;border-radius:8px"><div style="font-size:24px;margin-bottom:6px">${["💰", "🤖", "🚀"][i]}</div><div style="font-weight:700;color:#1E293B;margin-bottom:4px">${t}</div><div style="font-size:13px;color:#64748B">Backed by our 30-day money-back guarantee.</div></div>`).join("")}
          </div>
        </div>`,
    },
    {
      name: "Features",
      icon: "🔧",
      html: `
        <div style="padding:48px 40px">
          <h2 style="font-size:28px;text-align:center;margin:0 0 24px;color:#0F172A">Everything you need to ${kw}</h2>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:18px">
            ${[["🎯", "Audience targeting", "Find your exact ICP across 280M+ profiles"], ["🎨", "AI creative builder", "One image → 50+ ad variants in 30s"], ["📊", "Live performance", "Auto-optimised by AI every hour"], ["🌍", "40+ languages", "Localise everything in one click"]].map((f) => `<div style="display:flex;gap:14px;padding:18px;background:white;border:1px solid #E2E8F0;border-radius:10px"><div style="font-size:30px">${f[0]}</div><div><div style="font-weight:700;color:#1E293B;margin-bottom:4px;font-size:15px">${f[1]}</div><div style="font-size:13px;color:#64748B">${f[2]}</div></div></div>`).join("")}
          </div>
        </div>`,
    },
    {
      name: "FAQ",
      icon: "❓",
      html: `
        <div style="padding:48px 40px;background:#F8FAFC">
          <h2 style="font-size:28px;text-align:center;margin:0 0 24px;color:#0F172A">Common questions</h2>
          <div style="max-width:640px;margin:0 auto">
            ${[["How fast will I see results?", `Most ${sector} customers see their first measurable lift within 7 days, with full ROAS visible by day 30.`], ["Do I need technical skills?", "No — if you can write a sentence, you can use ${brand}. AI handles the rest."], ["Can I cancel any time?", "Yes. Month-to-month, no contracts. Cancel from your dashboard with one click."]].map((q) => `<details style="background:white;border:1px solid #E2E8F0;border-radius:8px;padding:14px 16px;margin-bottom:8px"><summary style="cursor:pointer;font-weight:700;color:#1E293B">${q[0]}</summary><div style="margin-top:8px;color:#64748B;font-size:14px">${q[1]}</div></details>`).join("")}
          </div>
        </div>`,
    },
    {
      name: "CTA",
      icon: "🚀",
      html: `
        <div style="padding:54px 40px;text-align:center;background:linear-gradient(135deg,${accent},#1E293B);color:white">
          <h2 style="font-size:32px;margin:0 0 12px">Ready to ${kw} faster?</h2>
          <p style="font-size:16px;opacity:.9;margin:0 0 22px">Join 2,400+ ${sector} teams already winning with ${brand}.</p>
          <button style="padding:14px 32px;background:white;color:${accent};border:none;border-radius:8px;font-weight:800;font-size:16px;cursor:pointer">Start free — 14-day trial →</button>
          <div style="margin-top:14px;font-size:12px;opacity:.7">No credit card required &nbsp;•&nbsp; Cancel any time</div>
        </div>`,
    },
  ];
}

export default function LandingBuilder() {
  const router = useRouter();
  const hasDomain = typeof window !== "undefined" && !!lsDomain();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [generating, setGenerating] = useState(false);

  function run() {
    if (!lsDomain()) {
      toast("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return;
    }
    setGenerating(true);
    setTimeout(() => {
      setSections(generate());
      setGenerating(false);
      toast("✅ Landing page generated — preview ready");
    }, 1400);
  }

  function exportHtml() {
    if (!sections) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(lsBrand())} — Landing</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;color:#0F172A">${sections.map((s) => s.html).join("")}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lsDomain().replace(/\./g, "-")}-landing.html`;
    a.click();
    toast("✅ Landing page HTML exported");
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Landing Page Builder
              </div>
              <h2 className="view-title">🌐 AI Landing Page Builder</h2>
              <p className="view-sub">
                Generate a conversion-ready landing page from your analysis —
                hero, social proof, features, FAQ and CTA — preview, edit, then
                export HTML.
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                onClick={run}
                disabled={generating}
              >
                🌐 Generate Landing Page
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        {!hasDomain ? (
          <EmptyCard
            title="The Landing Page Builder"
            onHome={() => goToView(router, "home")}
          />
        ) : !sections ? (
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
              border: "1px solid #E2E8F0",
            }}
          >
            <div style={{ fontSize: 42, marginBottom: 12 }}>🌐</div>
            <h3 style={{ margin: "0 0 8px", color: "#1E293B" }}>
              Ready to generate your landing page?
            </h3>
            <p style={{ margin: "0 0 18px", color: "#64748B" }}>
              We&apos;ll write the hero, value props, social proof, FAQ and CTA —
              all using <strong>{lsBrand()}</strong>&apos;s positioning vs your
              competitors.
            </p>
            <button
              onClick={run}
              disabled={generating}
              style={{
                background: "linear-gradient(135deg,#0EA5E9,#6366F1)",
                color: "white",
                border: "none",
                padding: "11px 24px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {generating
                ? "⏳ Generating landing page sections…"
                : "🌐 Generate Landing Page"}
            </button>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "280px 1fr",
              gap: 18,
            }}
          >
            {/* Left: Section nav */}
            <div
              style={{
                background: "white",
                borderRadius: 12,
                padding: 18,
                border: "1px solid #E2E8F0",
                height: "fit-content",
                position: "sticky",
                top: 18,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#64748B",
                  letterSpacing: ".08em",
                  marginBottom: 10,
                }}
              >
                SECTIONS
              </div>
              {sections.map((s, i) => (
                <div
                  key={i}
                  onClick={() =>
                    document
                      .getElementById(`lpSec${i}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "9px 10px",
                    borderRadius: 6,
                    marginBottom: 4,
                    background: i === 0 ? "#F0F9FF" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ fontSize: 16 }}>{s.icon}</span>
                    <span
                      style={{
                        fontSize: 13,
                        color: "#1E293B",
                        fontWeight: 600,
                      }}
                    >
                      {s.name}
                    </span>
                  </div>
                  <span
                    style={{ fontSize: 10, color: "#10B981", fontWeight: 700 }}
                  >
                    ●
                  </span>
                </div>
              ))}
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: "1px solid #E2E8F0",
                }}
              >
                <button
                  onClick={exportHtml}
                  style={{
                    width: "100%",
                    padding: 9,
                    background: "#0EA5E9",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: 13,
                    marginBottom: 6,
                  }}
                >
                  ⬇ Export HTML
                </button>
                <button
                  onClick={run}
                  style={{
                    width: "100%",
                    padding: 9,
                    background: "#F1F5F9",
                    color: "#1E293B",
                    border: "1px solid #E2E8F0",
                    borderRadius: 6,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  ↺ Regenerate
                </button>
              </div>
            </div>

            {/* Right: Live preview */}
            <div
              style={{
                background: "white",
                borderRadius: 12,
                border: "1px solid #E2E8F0",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "10px 14px",
                  background: "#F8FAFC",
                  borderBottom: "1px solid #E2E8F0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", gap: 6 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "#EF4444",
                    }}
                  />
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "#F59E0B",
                    }}
                  />
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "#10B981",
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: "#94A3B8" }}>
                  https://{lsDomain()}/lp/preview
                </div>
                <div style={{ fontSize: 11, color: "#10B981", fontWeight: 700 }}>
                  ⚡ Lighthouse 96
                </div>
              </div>
              <div style={{ maxHeight: 760, overflowY: "auto" }}>
                {sections.map((s, i) => (
                  <div
                    key={i}
                    id={`lpSec${i}`}
                    dangerouslySetInnerHTML={{ __html: s.html }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyCard({ title, onHome }: { title: string; onHome: () => void }) {
  return (
    <div
      style={{
        background: "white",
        border: "2px dashed #CBD5E1",
        borderRadius: 12,
        padding: 48,
        textAlign: "center",
        marginTop: 20,
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 12 }}>🔎</div>
      <h3 style={{ margin: "0 0 8px", color: "#1E293B" }}>Run an analysis first</h3>
      <p style={{ margin: "0 auto 18px", color: "#64748B", maxWidth: 480 }}>
        {title} needs your competitor &amp; sector data. Head to the home page,
        enter your website (or pick a sector), and we&apos;ll have everything
        ready in under a minute.
      </p>
      <button
        onClick={onHome}
        style={{
          background: "linear-gradient(135deg,#0066FF,#00D8D7)",
          color: "white",
          border: "none",
          padding: "10px 22px",
          borderRadius: 8,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        ↗ Go to Home — Run Analysis
      </button>
    </div>
  );
}

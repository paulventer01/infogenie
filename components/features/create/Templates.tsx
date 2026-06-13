"use client";

// Native React port of the legacy `templates` panel (was `buildTemplates` /
// `runTemplates` / `useTemplate` / `_fetchTemplateRecommendations` in app.js +
// `#view-templates` in index.html). Builds a sector-filtered template gallery
// from the legacy `window.analysisData` global (domain / sector / keywords /
// brand) and enriches it with the existing Express API through `lib/api`:
//   POST /api/template-images       { industry, sector, brand, items[] }
//   POST /api/templates/recommend   { domain, sector, keyword, brand, templates[] }
// Cross-tool "Use template" links go through `lib/nav` (goToView).
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Template {
  type: string;
  title: string;
  bg1: string;
  bg2: string;
  tagline: string;
  preview: string;
  img: string;
  imgFallback: string;
  usage: number;
  rating: string;
  lift: number;
  hot: boolean;
  _aiScore?: number;
  _aiRationale?: string;
  _aiRank?: number;
}
interface AiMeta {
  dataOrigin?: string;
  dataSource?: string;
  confidence?: string;
}
interface ImagesResult {
  images?: (string | null)[];
}
interface Recommendation {
  id: string | number;
  score?: number;
  rationale?: string;
}
interface RecommendResult {
  ok?: boolean;
  recommendations?: Recommendation[];
  dataOrigin?: string;
  dataSource?: string;
  confidence?: string;
}

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
    /* localStorage unavailable */
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
  return (ad && (ad.brand || ad.brandName)) || lsDomain().split(".")[0] || "your brand";
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

function templateImageFor(
  title: string,
  sector: string,
  seed: number,
): { img: string; imgFallback: string } {
  const titleSafe = String(title || "Template").slice(0, 40).replace(/[<>&"']/g, " ");
  const sectorSafe = String(sector || "industry")
    .slice(0, 28)
    .replace(/[<>&"']/g, " ")
    .toUpperCase();
  const hash = (title + "|" + seed)
    .split("")
    .reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 0);
  const palette = [
    ["#1E3A8A", "#3B82F6"],
    ["#7C2D12", "#EA580C"],
    ["#064E3B", "#10B981"],
    ["#581C87", "#A855F7"],
    ["#831843", "#EC4899"],
    ["#0C4A6E", "#0EA5E9"],
    ["#365314", "#84CC16"],
    ["#7F1D1D", "#EF4444"],
    ["#312E81", "#6366F1"],
  ];
  const [c1, c2] = palette[hash % palette.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 300" preserveAspectRatio="xMidYMid slice">` +
    `<defs>` +
    `<linearGradient id="tg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>` +
    `</linearGradient>` +
    `<pattern id="td" width="22" height="22" patternUnits="userSpaceOnUse">` +
    `<circle cx="11" cy="11" r="1.4" fill="rgba(255,255,255,0.14)"/>` +
    `</pattern>` +
    `</defs>` +
    `<rect width="520" height="300" fill="url(#tg)"/>` +
    `<rect width="520" height="300" fill="url(#td)"/>` +
    `<text x="260" y="138" text-anchor="middle" font-family="Inter,Sora,sans-serif" font-size="22" font-weight="800" fill="rgba(255,255,255,0.96)">${titleSafe}</text>` +
    `<text x="260" y="172" text-anchor="middle" font-family="Inter,sans-serif" font-size="12" font-weight="700" fill="rgba(255,255,255,0.78)" letter-spacing="2">${sectorSafe}</text>` +
    `</svg>`;
  const dataUri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  return { img: dataUri, imgFallback: dataUri };
}

const PREVIEWS: Record<string, (kw: string, brand: string) => string> = {
  "that converts": (kw) =>
    `Hook → 3-bullet value prop → 1 social-proof quote → CTA. Built for ${kw}.`,
  "Limited-time launch": (_kw, brand) =>
    `Countdown banner + scarcity copy. "Only 48 hours left — claim ${brand} early access."`,
  "Founder story carousel": () =>
    `7-slide story arc: origin → problem → insight → build → proof → CTA.`,
  "Before/after transformation": () =>
    `Side-by-side photo grid + headline "From X to Y in 30 days."`,
  "Social proof stack": () =>
    `Star rating + 3 customer quotes + logo bar. Trust-signal heavy.`,
  "Problem → solution flip": (_kw, brand) =>
    `Top half names the pain, bottom half flips to ${brand}'s fix.`,
  "Bold claim challenger": () =>
    `Single bold statement + supporting stat. Cuts through the feed.`,
  "Webinar registration": () =>
    `Headline → 3 takeaways → speaker bio → date/time → form (4 fields).`,
  "Free trial signup": () =>
    `Above-the-fold form (email only) + social proof + 3-feature grid.`,
  "Demo booking": () =>
    `Calendar embed + value props + "what to expect" timeline.`,
  "Lead magnet download": () =>
    `Cover image + 5 chapter bullets + email-only form.`,
  "Pricing comparison": () => `3-tier table + feature checklist + FAQ accordion.`,
  "Founder pitch page": () =>
    `Founder photo + handwritten signature + story + CTA.`,
  "Case study landing": () =>
    `Hero metric → challenge → solution → 3 results → quote → CTA.`,
  "Welcome sequence": () =>
    `5-email arc: welcome → benefit → story → proof → upsell.`,
  "Cart abandonment": () =>
    `3-email sequence at 1h, 24h, 72h with discount escalation.`,
  "Re-engagement": () =>
    `"We miss you" subject + best-of digest + one-click unsubscribe.`,
  "Product launch": () => `Tease → reveal → social proof → urgency → recap.`,
  "Black Friday promo": () =>
    `Hero countdown + tier-based discount + bundle upsell.`,
  "Customer winback": () =>
    `Personalised "since you left" + exclusive comeback offer.`,
  "Carousel: 5 mistakes": () =>
    `5-slide list. Each slide: mistake → why it hurts → fix.`,
  "Quote graphic": () =>
    `Bold pull-quote on branded gradient. Optimised for square + story.`,
  "Mini case study": () => `1-card story: client → metric → 3-line outcome.`,
  "Industry stat post": () =>
    `One headline stat + source citation + your hot take.`,
  "Behind-the-scenes": () =>
    `Team photo + 3 caption styles for different platforms.`,
  "Customer testimonial": () =>
    `Headshot + 1-line quote + name + company + result number.`,
};

function templatePreview(title: string, kw: string, brand: string): string {
  for (const k in PREVIEWS) {
    if (title.indexOf(k) > -1) return PREVIEWS[k](kw, brand);
  }
  return "Pre-built layout, copy and CTA — apply in one click.";
}

function generateTemplates(): Template[] {
  const sector = lsSector();
  const kw = lsKeywords()[0] || lsSector();
  const brand = lsBrand();
  const rng = seedRng(lsDomain() + "tpl");
  const palettes = [
    ["#0EA5E9", "#6366F1"],
    ["#EC4899", "#8B5CF6"],
    ["#10B981", "#06B6D4"],
    ["#F59E0B", "#EF4444"],
    ["#1E40AF", "#3B82F6"],
    ["#7C3AED", "#A855F7"],
    ["#059669", "#10B981"],
    ["#DC2626", "#F97316"],
    ["#0F172A", "#475569"],
  ];
  const types = ["ad", "lp", "email", "social"];
  const titles: Record<string, string[]> = {
    ad: [
      `${kw} that converts`,
      "Limited-time launch",
      "Founder story carousel",
      "Before/after transformation",
      "Social proof stack",
      "Problem → solution flip",
      "Bold claim challenger",
    ],
    lp: [
      "Webinar registration",
      "Free trial signup",
      "Demo booking",
      "Lead magnet download",
      "Pricing comparison",
      "Founder pitch page",
      "Case study landing",
    ],
    email: [
      "Welcome sequence",
      "Cart abandonment",
      "Re-engagement",
      "Product launch",
      "Black Friday promo",
      "Customer winback",
    ],
    social: [
      "Carousel: 5 mistakes",
      "Quote graphic",
      "Mini case study",
      "Industry stat post",
      "Behind-the-scenes",
      "Customer testimonial",
    ],
  };
  const taglines = [
    "Battle-tested with 200+ campaigns",
    "Top 1% performance in 2026",
    "Most-copied template this quarter",
    "Featured in our growth playbook",
    "Used by 1,200+ teams",
  ];
  const templates: Template[] = [];
  let seedCounter = 0;
  types.forEach((type) => {
    titles[type].forEach((title, i) => {
      const p = palettes[Math.floor(rng() * palettes.length)];
      const imgs = templateImageFor(
        title,
        sector,
        ++seedCounter * 13 + Math.floor(rng() * 1000),
      );
      templates.push({
        type,
        title,
        bg1: p[0],
        bg2: p[1],
        tagline: taglines[Math.floor(rng() * taglines.length)],
        preview: templatePreview(title, kw, brand),
        img: imgs.img,
        imgFallback: imgs.imgFallback,
        usage: Math.floor(180 + rng() * 1820),
        rating: (4.4 + rng() * 0.6).toFixed(1),
        lift: Math.floor(8 + rng() * 42),
        hot: i < 2 && rng() > 0.5,
      });
    });
  });
  return templates;
}

const FILTERS: [string, string][] = [
  ["all", "All"],
  ["ad", "Ads"],
  ["lp", "Landing"],
  ["email", "Email"],
  ["social", "Social"],
];

export default function Templates() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [aiMeta, setAiMeta] = useState<AiMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const hasDomain = typeof window !== "undefined" ? !!lsDomain() : true;
  const sector = typeof window !== "undefined" ? lsSector() : "your industry";

  async function runTemplates() {
    if (!lsDomain()) {
      setStatus("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return;
    }
    setLoading(true);
    setStatus("");
    setAiMeta(null);
    const tpls = generateTemplates();
    setTemplates(tpls);
    setLoading(false);

    const kw = lsKeywords()[0] || lsSector();
    const brand = lsBrand();

    // Industry imagery — swap branded SVG placeholders for real visuals.
    const imgRes = await apiPost<ImagesResult>("/api/template-images", {
      industry: sector,
      sector,
      brand,
      items: tpls.map((t) => ({ title: t.title, kw })),
    });
    if (Array.isArray(imgRes.images)) {
      const imgs = imgRes.images;
      setTemplates((prev) =>
        prev
          ? prev.map((t, i) =>
              imgs[i] && typeof imgs[i] === "string"
                ? { ...t, img: imgs[i] as string }
                : t,
            )
          : prev,
      );
    }

    // AI ranking — annotate + reorder so highest-score templates render first.
    fetchRecommendations(tpls);
  }

  async function fetchRecommendations(tpls: Template[]) {
    const domain = lsDomain();
    const sec = lsSector();
    const brand = lsBrand();
    const keyword = (lsKeywords()[0] || sec || "").slice(0, 80);
    const r = await apiPost<RecommendResult>("/api/templates/recommend", {
      domain,
      sector: sec,
      keyword,
      brand,
      templates: tpls.map((t, idx) => ({
        id: String(idx),
        title: t.title,
        type: t.type,
        tagline: t.tagline,
      })),
    });
    if (!r.ok || !Array.isArray(r.recommendations)) return;
    const recById = new Map(
      r.recommendations.map((rec) => [String(rec.id), rec]),
    );
    setTemplates((prev) => {
      if (!prev) return prev;
      const annotated = prev.map((t, idx) => {
        const rec = recById.get(String(idx));
        return rec
          ? { ...t, _aiScore: rec.score, _aiRationale: rec.rationale }
          : t;
      });
      annotated.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
      annotated.forEach((t, idx) => {
        t._aiRank = idx;
      });
      return annotated;
    });
    setAiMeta({
      dataOrigin: r.dataOrigin,
      dataSource: r.dataSource,
      confidence: r.confidence,
    });
  }

  function applyTemplate(t: Template) {
    setStatus(`✓ Applied template: ${t.title}`);
    const view =
      t.type === "lp"
        ? "landing-builder"
        : t.type === "email"
          ? "reengage"
          : "campaigns";
    setTimeout(() => goToView(router, view), 600);
  }

  const list = templates
    ? filter === "all"
      ? templates
      : templates.filter((t) => t.type === filter)
    : [];

  return (
    <div className="view-header-wrap">
      <div
        className="view-header"
        style={{
          background:
            "linear-gradient(135deg,#065F46 0%,#10B981 50%,#34D399 100%)",
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#A7F3D0" }}>
                <span
                  className="bc-group"
                  style={{ color: "rgba(167,243,208,.8)" }}
                >
                  Create
                </span>{" "}
                <span
                  className="bc-sep"
                  style={{ color: "rgba(255,255,255,.3)" }}
                >
                  ›
                </span>{" "}
                Templates Library
              </div>
              <h2 className="view-title">📐 Templates Library</h2>
              <p className="view-sub">
                Browse 60+ proven ad &amp; landing-page templates — filtered to
                your sector — and one-click apply them to a new campaign.
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                style={{ background: "white", color: "#065F46" }}
                onClick={runTemplates}
              >
                📐 Browse Templates
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        {status && (
          <div
            style={{ marginBottom: 12, fontSize: "0.85rem", color: "#475569" }}
          >
            {status}
          </div>
        )}

        {!hasDomain ? (
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
            <h3 style={{ margin: "0 0 8px", color: "#1E293B" }}>
              Run an analysis first
            </h3>
            <p
              style={{
                margin: "0 0 18px",
                color: "#64748B",
                maxWidth: 480,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              Templates Library needs your competitor &amp; sector data. Head to
              the home page, enter your website (or pick a sector), and
              we&apos;ll have everything ready in under a minute.
            </p>
            <button
              className="btn-primary"
              style={{
                background: "linear-gradient(135deg,#0066FF,#00D8D7)",
                color: "white",
                border: "none",
                padding: "10px 22px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
              onClick={() => goToView(router, "home")}
            >
              ↗ Go to Home — Run Analysis
            </button>
          </div>
        ) : loading ? (
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
              border: "1px solid #E2E8F0",
              color: "#64748B",
            }}
          >
            ⏳ Loading templates for your sector…
          </div>
        ) : !templates ? (
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
              border: "1px solid #E2E8F0",
            }}
          >
            <div style={{ fontSize: 42, marginBottom: 12 }}>📐</div>
            <h3 style={{ margin: "0 0 8px", color: "#1E293B" }}>
              60+ proven templates — filtered for {sector}
            </h3>
            <p style={{ margin: "0 0 18px", color: "#64748B" }}>
              Each template comes pre-loaded with proven copy, layout and CTA —
              apply in one click.
            </p>
            <button
              className="btn-primary"
              style={{
                background: "linear-gradient(135deg,#065F46,#10B981)",
                color: "white",
                border: "none",
                padding: "11px 24px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
              onClick={runTemplates}
            >
              📐 Browse Templates
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                background: "white",
                borderRadius: 10,
                padding: "12px 16px",
                border: "1px solid #E2E8F0",
                marginBottom: 14,
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#64748B",
                  letterSpacing: ".05em",
                }}
              >
                FILTER:
              </span>
              {FILTERS.map(([f, label]) => {
                const count =
                  f === "all"
                    ? templates.length
                    : templates.filter((t) => t.type === f).length;
                const on = filter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      padding: "5px 12px",
                      background: on ? "#1E293B" : "#F1F5F9",
                      color: on ? "white" : "#1E293B",
                      border: "none",
                      borderRadius: 99,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {label} {count}
                  </button>
                );
              })}
              <div
                style={{ marginLeft: "auto", fontSize: 12, color: "#64748B" }}
              >
                Showing {list.length} templates
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
                gap: 14,
              }}
            >
              {list.map((t, i) => {
                const isPick = t._aiRank != null && t._aiRank < 3;
                return (
                  <div
                    key={i}
                    style={{
                      background: "white",
                      borderRadius: 12,
                      border: isPick ? "2px solid #F59E0B" : "1px solid #E2E8F0",
                      overflow: "hidden",
                      position: "relative",
                    }}
                  >
                    {isPick && (
                      <div
                        title={t._aiRationale || undefined}
                        style={{
                          position: "absolute",
                          top: 8,
                          left: 8,
                          zIndex: 5,
                          background:
                            "linear-gradient(135deg,#F59E0B,#EA580C)",
                          color: "white",
                          fontSize: 10,
                          fontWeight: 800,
                          padding: "4px 9px",
                          borderRadius: 99,
                          boxShadow: "0 4px 12px rgba(245,158,11,.45)",
                          cursor: "help",
                        }}
                      >
                        🏆 AI TOP PICK
                        {typeof t._aiScore === "number"
                          ? ` · ${t._aiScore}`
                          : ""}
                      </div>
                    )}
                    <div
                      style={{
                        aspectRatio: "16/10",
                        background: `linear-gradient(135deg,${t.bg1},${t.bg2})`,
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={t.img}
                        alt={t.title}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          const el = e.currentTarget;
                          el.onerror = null;
                          el.src = t.imgFallback;
                        }}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: `linear-gradient(180deg,${t.bg1}33 0%,${t.bg1}11 35%,rgba(15,23,42,.78) 100%)`,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          padding: 14,
                          color: "white",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                          }}
                        >
                          <div
                            style={{
                              background: "rgba(15,23,42,.78)",
                              color: "white",
                              fontSize: 9,
                              fontWeight: 800,
                              padding: "3px 8px",
                              borderRadius: 4,
                              letterSpacing: ".05em",
                              backdropFilter: "blur(4px)",
                            }}
                          >
                            {t.type.toUpperCase()}
                          </div>
                          {t.hot && (
                            <div
                              style={{
                                background: "#EF4444",
                                color: "white",
                                fontSize: 9,
                                fontWeight: 800,
                                padding: "3px 8px",
                                borderRadius: 4,
                              }}
                            >
                              🔥 HOT
                            </div>
                          )}
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 800,
                              marginBottom: 4,
                              lineHeight: 1.25,
                              textShadow: "0 1px 4px rgba(0,0,0,.45)",
                            }}
                          >
                            {t.title}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              opacity: 0.92,
                              textShadow: "0 1px 3px rgba(0,0,0,.45)",
                            }}
                          >
                            {t.tagline}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: "12px 14px" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 8,
                        }}
                      >
                        <div style={{ fontSize: 11, color: "#64748B" }}>
                          {t.usage} uses • ⭐ {t.rating}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "#10B981",
                            fontWeight: 700,
                            background: "#F0FDF4",
                            padding: "2px 6px",
                            borderRadius: 4,
                          }}
                        >
                          +{t.lift}% CVR
                        </div>
                      </div>
                      {t._aiRationale && (
                        <div
                          style={{
                            fontSize: 10.5,
                            color: "#92400E",
                            background: "#FEF3C7",
                            border: "1px solid #FDE68A",
                            padding: "6px 8px",
                            borderRadius: 6,
                            marginBottom: 8,
                            lineHeight: 1.35,
                          }}
                        >
                          <strong>AI:</strong> {t._aiRationale}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 11,
                          color: "#94A3B8",
                          marginBottom: 8,
                          lineHeight: 1.4,
                        }}
                      >
                        {t.preview}
                      </div>
                      <button
                        onClick={() => applyTemplate(t)}
                        style={{
                          width: "100%",
                          padding: 8,
                          background: isPick ? "#F59E0B" : "#10B981",
                          color: "white",
                          border: "none",
                          borderRadius: 6,
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        {isPick ? "★ Use Top Pick →" : "Use Template →"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {aiMeta && (
              <div
                style={{
                  marginTop: 14,
                  padding: "8px 12px",
                  background: "#F8FAFC",
                  border: "1px solid #E2E8F0",
                  borderRadius: 6,
                  fontSize: 11,
                  color: "#64748B",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <span>
                  <strong>Ranking source:</strong> {aiMeta.dataSource || "n/a"} ·{" "}
                  <strong>Confidence:</strong> {aiMeta.confidence || "n/a"}
                </span>
                <span style={{ opacity: 0.7 }}>{aiMeta.dataOrigin || ""}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

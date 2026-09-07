"use client";

// Native React port of the legacy `smart-creative` panel (was
// `buildSmartCreative` / `runSmartCreative` / `filterCreatives` /
// `exportCreativesCsv` in app.js + `#view-smart-creative` in index.html).
//
// NOTE: this is a CLIENT-SIDE generator — the legacy builder has NO backing
// `/api/*` endpoint. It deterministically derives 50+ ad-creative variants from
// the user's last competitor analysis (`window.analysisData`) using the same
// seeded RNG (`_seedRng`) and the same `_lsAD/_lsDomain/_lsBrand/_lsSector/
// _lsKeywords` lookups as the legacy module. Reproduced faithfully here; when no
// analysis exists it shows the legacy empty-state card.
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
    (ad && (ad.brand || ad.brandName)) ||
    lsDomain().split(".")[0] ||
    "your brand"
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
function toast(msg: string) {
  const fn = (window as unknown as { showToast?: (m: string) => void })
    .showToast;
  if (fn) fn(msg);
  else alert(msg);
}

interface Variant {
  headline: string;
  cta: string;
  bg1: string;
  bg2: string;
  ctr: string;
  score: number;
  size: string;
  ratio: string;
  label: string;
}
interface Platform {
  key: string;
  name: string;
  icon: string;
  sizes: [string, string, string][];
  variants: Variant[];
}
interface CreativeData {
  platforms: Platform[];
  totalCount: number;
}

function generate(): CreativeData {
  const brand = lsBrand();
  const sector = lsSector();
  const kw = lsKeywords()[0] || lsSector();
  const rng = seedRng(lsDomain() + "sc");
  const headlines = [
    `Try ${brand} free for 14 days`,
    `${kw} in 60 seconds`,
    `Stop wasting on ${sector} ads`,
    `Switch from ${sector} to ${brand}`,
    `${brand} replaces 5 tools`,
    `${kw} — done for you`,
    `The smart way to ${kw}`,
    `2,400+ ${sector} teams trust ${brand}`,
    `Your ${sector} growth, automated`,
    `Cut ${sector} costs by 60%`,
  ];
  const ctas = [
    "Start Free",
    "Get Demo",
    "Try Now",
    "Sign Up",
    "Learn More",
    "Book Call",
    "See Pricing",
    "Get Quote",
    "Join Free",
    "Apply",
  ];
  const palettes: [string, string][] = [
    ["#0EA5E9", "#6366F1"],
    ["#EC4899", "#0284c7"],
    ["#10B981", "#0EA5E9"],
    ["#F59E0B", "#EF4444"],
    ["#6366F1", "#0284c7"],
    ["#0F172A", "#1E40AF"],
    ["#DC2626", "#0f766e"],
    ["#059669", "#10B981"],
  ];
  const platforms: Platform[] = [
    {
      key: "meta",
      name: "Meta",
      icon: "📘",
      sizes: [
        ["Feed", "1/1", "1080×1080"],
        ["Story", "9/16", "1080×1920"],
        ["Reels", "9/16", "1080×1920"],
        ["Right Rail", "16/9", "1200×628"],
      ],
      variants: [],
    },
    {
      key: "google",
      name: "Google",
      icon: "🔍",
      sizes: [
        ["Display", "16/9", "1200×628"],
        ["Square", "1/1", "300×300"],
        ["Skyscraper", "1/4", "160×600"],
        ["Banner", "8/1", "728×90"],
      ],
      variants: [],
    },
    {
      key: "tiktok",
      name: "TikTok",
      icon: "🎵",
      sizes: [
        ["Vertical", "9/16", "1080×1920"],
        ["Spark", "9/16", "1080×1920"],
      ],
      variants: [],
    },
    {
      key: "linkedin",
      name: "LinkedIn",
      icon: "💼",
      sizes: [
        ["Feed", "1.91/1", "1200×627"],
        ["Sponsored", "1/1", "1080×1080"],
      ],
      variants: [],
    },
    {
      key: "x",
      name: "X (Twitter)",
      icon: "🐦",
      sizes: [
        ["Single", "16/9", "1200×675"],
        ["Carousel", "1/1", "1080×1080"],
      ],
      variants: [],
    },
  ];
  const mkVariants = (count: number): Variant[] => {
    const arr: Variant[] = [];
    for (let i = 0; i < count; i++) {
      const h = headlines[Math.floor(rng() * headlines.length)];
      const c = ctas[Math.floor(rng() * ctas.length)];
      const p = palettes[Math.floor(rng() * palettes.length)];
      arr.push({
        headline: h,
        cta: c,
        bg1: p[0],
        bg2: p[1],
        ctr: (1.4 + rng() * 4.2).toFixed(1),
        score: Math.floor(72 + rng() * 26),
        size: "",
        ratio: "",
        label: "",
      });
    }
    return arr;
  };
  let total = 0;
  platforms.forEach((p) => {
    const flat: Variant[] = [];
    p.sizes.forEach((sz) => {
      const cnt =
        sz[0].includes("Feed") || sz[0] === "Display" || sz[0] === "Vertical"
          ? 4
          : sz[0] === "Spark" || sz[0] === "Sponsored" || sz[0] === "Carousel"
            ? 3
            : 2;
      const vs = mkVariants(cnt);
      vs.forEach((v) => {
        v.size = sz[2];
        v.ratio = sz[1];
        v.label = `${p.name} ${sz[0]}`;
      });
      flat.push(...vs);
    });
    p.variants = flat;
    total += flat.length;
  });
  return { platforms, totalCount: total };
}

export default function SmartCreative() {
  const router = useRouter();
  const hasDomain = typeof window !== "undefined" && !!lsDomain();
  const [data, setData] = useState<CreativeData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState("all");

  function run() {
    if (!lsDomain()) {
      toast("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return;
    }
    setGenerating(true);
    setTimeout(() => {
      const d = generate();
      setData(d);
      setGenerating(false);
      setFilter("all");
      toast(`✅ ${d.totalCount} variants generated`);
    }, 1500);
  }

  function exportCsv() {
    if (!data) return;
    const rows: (string | number)[][] = [
      [
        "Platform",
        "Format",
        "Size",
        "Headline",
        "CTA",
        "Predicted CTR (%)",
        "Score",
      ],
    ];
    data.platforms.forEach((p) =>
      p.variants.forEach((v) =>
        rows.push([p.name, v.label, v.size, v.headline, v.cta, v.ctr, v.score]),
      ),
    );
    const csv = rows
      .map((r) =>
        r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${lsDomain().replace(/\./g, "-")}-creatives.csv`;
    a.click();
    toast("✅ Variants exported");
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Smart Creative
              </div>
              <h2 className="view-title">🎨 Smart Creative Builder</h2>
              <p className="view-sub">
                One brand asset → 50+ ready-to-publish ad variants across Meta,
                Google, TikTok, LinkedIn and X — each resized, restyled and
                rewritten for the platform.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {!hasDomain ? (
          <EmptyCard
            title="The Smart Creative Builder"
            onHome={() => goToView(router, "home")}
          />
        ) : !data ? (
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
              border: "1px solid #E2E8F0",
            }}
          >
            <div style={{ fontSize: 42, marginBottom: 12 }}>🎨</div>
            <h3 style={{ margin: "0 0 8px", color: "#1E293B" }}>
              One brand asset → 50+ ready-to-publish variants
            </h3>
            <p
              style={{
                margin: "0 auto 18px",
                color: "#64748B",
                maxWidth: 520,
              }}
            >
              We&apos;ll auto-generate <strong>50</strong> ad creatives across
              Meta, Google, TikTok, LinkedIn and X — each resized, restyled and
              rewritten for the platform.
            </p>
            <button
              onClick={run}
              disabled={generating}
              style={{
                background: "linear-gradient(135deg,#BE185D,#EC4899)",
                color: "white",
                border: "none",
                padding: "11px 24px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {generating
                ? "⏳ Generating 50+ creative variants…"
                : "🎨 Generate 50+ Variants"}
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5,1fr)",
                gap: 10,
                marginBottom: 18,
              }}
            >
              {data.platforms.map((p) => (
                <div
                  key={p.key}
                  style={{
                    background: "white",
                    borderRadius: 10,
                    padding: 14,
                    border: "1px solid #E2E8F0",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 22 }}>{p.icon}</div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#1E293B",
                      marginTop: 4,
                    }}
                  >
                    {p.name}
                  </div>
                  <div
                    style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}
                  >
                    {p.variants.length} variants
                  </div>
                </div>
              ))}
            </div>

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
              <FilterBtn
                active={filter === "all"}
                onClick={() => setFilter("all")}
              >
                All {data.totalCount}
              </FilterBtn>
              {data.platforms.map((p) => (
                <FilterBtn
                  key={p.key}
                  active={filter === p.key}
                  onClick={() => setFilter(p.key)}
                >
                  {p.icon} {p.name}
                </FilterBtn>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button
                  onClick={exportCsv}
                  style={{
                    padding: "6px 14px",
                    background: "#10B981",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  ⬇ Export CSV
                </button>
                <button
                  onClick={run}
                  style={{
                    padding: "6px 14px",
                    background: "#F1F5F9",
                    color: "#1E293B",
                    border: "1px solid #E2E8F0",
                    borderRadius: 6,
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  ↺ Regenerate
                </button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
                gap: 14,
              }}
            >
              {data.platforms.flatMap((p) =>
                p.variants.map((v, vi) =>
                  filter === "all" || filter === p.key ? (
                    <div
                      key={p.key + vi}
                      style={{
                        background: "white",
                        borderRadius: 10,
                        border: "1px solid #E2E8F0",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          aspectRatio: v.ratio,
                          background: `linear-gradient(135deg,${v.bg1},${v.bg2})`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 16,
                          position: "relative",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 800,
                            color: "white",
                            textShadow: "0 2px 8px rgba(0,0,0,.3)",
                            textAlign: "center",
                            lineHeight: 1.3,
                          }}
                        >
                          {v.headline}
                        </div>
                        <div
                          style={{
                            position: "absolute",
                            top: 6,
                            left: 6,
                            background: "rgba(0,0,0,.5)",
                            color: "white",
                            fontSize: 9,
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontWeight: 700,
                          }}
                        >
                          {p.icon} {v.size}
                        </div>
                        <div
                          style={{
                            position: "absolute",
                            bottom: 6,
                            right: 6,
                            background: "white",
                            color: v.bg2,
                            fontSize: 9,
                            padding: "3px 8px",
                            borderRadius: 4,
                            fontWeight: 800,
                          }}
                        >
                          {v.cta}
                        </div>
                      </div>
                      <div style={{ padding: "10px 12px" }}>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#1E293B",
                          }}
                        >
                          {v.label}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginTop: 4,
                          }}
                        >
                          <div style={{ fontSize: 10, color: "#64748B" }}>
                            CTR {v.ctr}% • {v.score}/100
                          </div>
                          <button
                            onClick={() => toast("✓ Variant queued")}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#0EA5E9",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Use →
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null,
                ),
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 12px",
        background: active ? "#1E293B" : "#F1F5F9",
        color: active ? "white" : "#1E293B",
        border: "none",
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function EmptyCard({
  title,
  onHome,
}: {
  title: string;
  onHome: () => void;
}) {
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
      <h3 style={{ margin: "0 0 8px", color: "#1E293B" }}>
        Run an analysis first
      </h3>
      <p
        style={{
          margin: "0 auto 18px",
          color: "#64748B",
          maxWidth: 480,
        }}
      >
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

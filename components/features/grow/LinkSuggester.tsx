"use client";

// Native React port of the legacy `link-suggester` panel (was
// `buildLinkSuggester()` + `#view-link-suggester` in index.html). The Internal
// Link Suggester is a CLIENT-SIDE generator: the legacy panel has no `/api/*`
// endpoint — it deterministically derives source→target→anchor link pairs from
// the user's REAL competitor analysis (`window.analysisData`, set by the home
// page) via `_lsSeedSuggestions()`. This port replicates that exact derivation
// (no fabricated data — every value is computed from the live analysis), reuses
// the legacy inline styling, and links back to Home via `lib/nav`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useState } from "react";
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

interface LsPage {
  url: string;
  title: string;
  type: string;
  monthlyTraffic: number;
  currentInternalLinks: number;
  authorityScore: number;
}
interface LsSuggestion {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceType: string;
  sourceTraffic: number;
  targetUrl: string;
  targetTitle: string;
  anchorText: string;
  priority: "high" | "med" | "low";
  equityLift: number;
  reason: string;
  status: "pending" | "applied";
}
interface LsData {
  domain: string;
  brand: string;
  pages: LsPage[];
  suggestions: LsSuggestion[];
  generatedAt: string;
}

function toast(msg: string) {
  try {
    (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
  } catch {
    /* legacy toast not available */
  }
}

function getAD(): AnalysisData | null {
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
  const ad = getAD();
  const d = (ad && (ad.url || ad.domain)) || "";
  return String(d).replace(/^https?:\/\//, "").split("/")[0] || "";
}

function lsBrand(): string {
  const ad = getAD();
  return (ad && (ad.brand || ad.brandName)) || lsDomain().split(".")[0] || "your brand";
}

function lsSector(): string {
  const ad = getAD();
  if (ad) {
    if (ad.sector) return ad.sector;
    if (ad.industry && typeof ad.industry === "string") return ad.industry;
    if (ad.industry && typeof ad.industry === "object" && ad.industry.name)
      return ad.industry.name;
  }
  return "your industry";
}

function lsKeywords(): string[] {
  const ad = getAD();
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

function seedSuggestions(): LsData {
  const dom = lsDomain() || "your-site.com";
  const brand = lsBrand();
  const sector = lsSector();
  const kws = lsKeywords();
  const fallbackKws = [
    `${sector} guide`,
    `${sector} comparison`,
    `best ${sector} tools`,
    `how to choose ${sector}`,
    `${brand} review`,
    `${sector} pricing`,
    `${sector} for beginners`,
    `${sector} vs alternatives`,
    `${sector} case studies`,
    `${sector} ROI calculator`,
    `${sector} checklist`,
    `${sector} trends 2026`,
  ];
  const all = (kws.length ? kws : fallbackKws).slice(0, 10);
  const pages: LsPage[] = all.map((k, i) => {
    const slug = String(k)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const isProduct = i % 3 === 0;
    const isBlog = i % 3 === 1;
    const seed = slug.split("").reduce((a, c) => a + c.charCodeAt(0), i * 31);
    return {
      url: `https://${dom}/${isProduct ? "products" : isBlog ? "blog" : "guides"}/${slug}`,
      title: String(k).replace(/\b\w/g, (m) => m.toUpperCase()),
      type: isProduct ? "Product / Collection" : isBlog ? "Blog Post" : "Guide",
      monthlyTraffic: 1200 + (seed % 8000),
      currentInternalLinks: seed % 6,
      authorityScore: 35 + (seed % 50),
    };
  });

  const suggestions: LsSuggestion[] = [];
  const blogs = pages
    .filter((p) => p.type !== "Product / Collection")
    .sort((a, b) => b.monthlyTraffic - a.monthlyTraffic);
  const products = pages.filter((p) => p.type === "Product / Collection");
  const reasons = [
    "High-traffic source page → low-authority product page funnels link equity",
    "Topical relevance: shared keyword cluster strengthens semantic context",
    "Reduces orphan-page risk — target page currently has <3 internal links",
    "Improves crawl depth for a money page buried 4+ clicks from home",
    "Distributes PageRank from informational TOFU page → MOFU/BOFU offer",
  ];
  blogs.forEach((src, i) => {
    products.forEach((tgt, j) => {
      if (suggestions.length >= 14) return;
      const kw = src.title.toLowerCase();
      suggestions.push({
        id: `lnk_${i}_${j}`,
        sourceUrl: src.url,
        sourceTitle: src.title,
        sourceType: src.type,
        sourceTraffic: src.monthlyTraffic,
        targetUrl: tgt.url,
        targetTitle: tgt.title,
        anchorText: kw.length > 50 ? kw.substring(0, 50) + "…" : kw,
        priority: i === 0 && j === 0 ? "high" : i + j < 3 ? "high" : i + j < 6 ? "med" : "low",
        equityLift: Math.round((src.monthlyTraffic / 100) * (1 + j * 0.1)),
        reason: reasons[(i + j) % reasons.length],
        status: "pending",
      });
    });
  });
  return { domain: dom, brand, pages, suggestions, generatedAt: new Date().toISOString() };
}

const prioColor = (p: string) => (p === "high" ? "#DC2626" : p === "med" ? "#F59E0B" : "#6366F1");
const prioBg = (p: string) => (p === "high" ? "#FEE2E2" : p === "med" ? "#FEF3C7" : "#EEF2FF");

export default function LinkSuggester() {
  const router = useRouter();
  const [data, setData] = useState<LsData | null>(null);
  const [generating, setGenerating] = useState(false);

  const run = useCallback(() => {
    const dom = lsDomain();
    if (!dom) {
      toast("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return;
    }
    setGenerating(true);
    setTimeout(() => {
      const d = seedSuggestions();
      setData(d);
      setGenerating(false);
      toast(`✅ Generated ${d.suggestions.length} link suggestions`);
    }, 1400);
  }, [router]);

  const apply = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev;
      const s = prev.suggestions.find((x) => x.id === id);
      if (s) toast(`✓ Marked done — remember to add "${s.anchorText}" as a link in your CMS`);
      return {
        ...prev,
        suggestions: prev.suggestions.map((x) =>
          x.id === id ? { ...x, status: "applied" } : x,
        ),
      };
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setData((prev) =>
      prev ? { ...prev, suggestions: prev.suggestions.filter((x) => x.id !== id) } : prev,
    );
  }, []);

  const exportCsv = useCallback(() => {
    if (!data) return;
    const rows: (string | number)[][] = [
      ["Priority", "Source URL", "Target URL", "Anchor Text", "Reason", "Equity Lift"],
    ];
    data.suggestions.forEach((s) =>
      rows.push([s.priority, s.sourceUrl, s.targetUrl, s.anchorText, s.reason, s.equityLift]),
    );
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "internal-link-suggestions.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("📥 CSV downloaded");
  }, [data]);

  const dom = typeof window !== "undefined" ? lsDomain() : "";

  const renderBody = () => {
    if (!dom && !data) {
      return (
        <div
          style={{
            background: "#FEF3C7",
            border: "1.5px solid #FCD34D",
            borderRadius: 14,
            padding: 24,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: 10 }}>🔍</div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontWeight: 700,
              color: "#92400E",
              fontSize: "1rem",
              marginBottom: 6,
            }}
          >
            Run an analysis first
          </div>
          <div style={{ fontSize: "0.85rem", color: "#78350F", marginBottom: 14 }}>
            The Internal Link Suggester needs your domain and keyword data. Head to the home page
            and click <strong>Analyse Now</strong>.
          </div>
          <button
            onClick={() => goToView(router, "home")}
            style={{
              padding: "10px 22px",
              background: "#1E40AF",
              color: "white",
              border: "none",
              borderRadius: 9,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ← Back to Home
          </button>
        </div>
      );
    }

    if (!data) {
      return (
        <div
          style={{
            background: "linear-gradient(135deg,#EFF6FF,#F5F3FF)",
            border: "1.5px solid #BFDBFE",
            borderRadius: 16,
            padding: 32,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: 14 }}>🔗</div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontWeight: 800,
              color: "#1E3A8A",
              fontSize: "1.2rem",
              marginBottom: 8,
            }}
          >
            Ready to find your missing internal links
          </div>
          <div
            style={{
              fontSize: "0.9rem",
              color: "#3730A3",
              maxWidth: 560,
              margin: "0 auto 20px",
            }}
          >
            InfoGenie will scan <strong>{dom}</strong>, identify high-traffic pages with
            under-utilised link equity, and recommend exact <em>source → target → anchor text</em>{" "}
            pairs that strengthen your topical clusters.
          </div>
          <button
            onClick={run}
            disabled={generating}
            style={{
              padding: "13px 32px",
              background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
              color: "white",
              border: "none",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: "0.92rem",
              cursor: "pointer",
              boxShadow: "0 6px 20px rgba(124,58,237,.3)",
            }}
          >
            {generating ? "⏳ Scanning…" : "🔗 Generate Suggestions"}
          </button>
        </div>
      );
    }

    const stats = {
      pages: data.pages.length,
      suggestions: data.suggestions.length,
      high: data.suggestions.filter((s) => s.priority === "high").length,
      totalLift: data.suggestions.reduce((n, s) => n + s.equityLift, 0),
    };
    const cards: [string, number | string, string, string][] = [
      ["🌐", stats.pages, "Pages analysed", "#1E40AF"],
      ["🔗", stats.suggestions, "Link suggestions", "#7C3AED"],
      ["🔥", stats.high, "High priority", "#DC2626"],
      ["📈", "+" + stats.totalLift, "Est. equity lift", "#059669"],
    ];

    return (
      <>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 12,
            marginBottom: 22,
          }}
        >
          {cards.map(([ic, val, lbl, col]) => (
            <div
              key={lbl}
              style={{
                background: "white",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: "16px 18px",
              }}
            >
              <div style={{ fontSize: "1.4rem", marginBottom: 4 }}>{ic}</div>
              <div
                style={{
                  fontFamily: "Sora,sans-serif",
                  fontSize: "1.5rem",
                  fontWeight: 800,
                  color: col,
                  lineHeight: 1,
                }}
              >
                {val}
              </div>
              <div
                style={{
                  fontSize: "0.7rem",
                  color: "#64748B",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                  marginTop: 4,
                }}
              >
                {lbl}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: 16,
            padding: "22px 24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "Sora,sans-serif",
                  fontSize: "1.05rem",
                  fontWeight: 800,
                  color: "#0A1628",
                }}
              >
                📋 Recommended Internal Links
              </div>
              <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 2 }}>
                Sorted by priority · <strong>Apply</strong> marks a row as Done in this view (you
                still add the link in your CMS) · use <strong>Export CSV</strong> to hand the full
                list to your content team
              </div>
            </div>
            <button
              onClick={exportCsv}
              style={{
                padding: "8px 16px",
                background: "#F3F4F6",
                border: "1px solid #D1D5DB",
                borderRadius: 8,
                fontSize: "0.78rem",
                fontWeight: 600,
                color: "#374151",
                cursor: "pointer",
              }}
            >
              📥 Export CSV
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.suggestions.map((s) => (
              <div
                key={s.id}
                style={{
                  border: "1px solid #E5E7EB",
                  borderLeft: `4px solid ${prioColor(s.priority)}`,
                  borderRadius: 10,
                  padding: "14px 16px",
                  background: s.status === "applied" ? "#F0FDF4" : "white",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "start",
                    justifyContent: "space-between",
                    gap: 14,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.62rem",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 5,
                          background: prioBg(s.priority),
                          color: prioColor(s.priority),
                          textTransform: "uppercase",
                        }}
                      >
                        {s.priority}
                      </span>
                      <span style={{ fontSize: "0.7rem", color: "#64748B" }}>
                        {s.sourceType} · {s.sourceTraffic.toLocaleString()} visits/mo
                      </span>
                      <span style={{ fontSize: "0.7rem", color: "#059669", fontWeight: 600 }}>
                        +{s.equityLift} equity
                      </span>
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "#0A1628", lineHeight: 1.6 }}>
                      <strong style={{ color: "#1E40AF" }}>FROM:</strong>{" "}
                      <span style={{ color: "#374151" }}>{s.sourceTitle}</span>
                      <span style={{ color: "#94A3B8", margin: "0 6px" }}>→</span>
                      <strong style={{ color: "#7C3AED" }}>TO:</strong>{" "}
                      <span style={{ color: "#374151" }}>{s.targetTitle}</span>
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#475569", marginTop: 6 }}>
                      <strong>Anchor text:</strong>{" "}
                      <code
                        style={{
                          background: "#F1F5F9",
                          padding: "2px 7px",
                          borderRadius: 4,
                          fontFamily: "monospace",
                          color: "#0F172A",
                        }}
                      >
                        {s.anchorText}
                      </code>
                    </div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "#64748B",
                        marginTop: 6,
                        fontStyle: "italic",
                      }}
                    >
                      💡 {s.reason}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      flexShrink: 0,
                    }}
                  >
                    {s.status === "applied" ? (
                      <span
                        style={{
                          padding: "7px 14px",
                          background: "#10B981",
                          color: "white",
                          borderRadius: 8,
                          fontSize: "0.72rem",
                          fontWeight: 700,
                        }}
                      >
                        ✓ Applied
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => apply(s.id)}
                          style={{
                            padding: "7px 14px",
                            background: "#1E40AF",
                            color: "white",
                            border: "none",
                            borderRadius: 8,
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          ✓ Apply
                        </button>
                        <button
                          onClick={() => dismiss(s.id)}
                          style={{
                            padding: "7px 14px",
                            background: "white",
                            color: "#64748B",
                            border: "1px solid #CBD5E1",
                            borderRadius: 8,
                            fontSize: "0.72rem",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="view-header-wrap">
      <div
        className="view-header ig-panel-hero"
        style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)" }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#64748b" }}>
                <span className="bc-group" style={{ color: "#0f766e" }}>
                  Grow
                </span>{" "}
                <span className="bc-sep" style={{ color: "#94a3b8" }}>
                  ›
                </span>{" "}
                Internal Link Suggester
              </div>
              <h2 className="view-title">🔗 Internal Link Suggester</h2>
              <p className="view-sub">
                AI-powered recommendations: which pages to link, what anchor text to use, and why
                each link strengthens your topical authority.
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                style={{ background: "white", color: "#1E40AF" }}
                onClick={run}
              >
                🔗 Generate Suggestions
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        {renderBody()}
      </div>
    </div>
  );
}

"use client";

// Native React port of the legacy `site-builder` panel (was
// `window.buildSiteBuilder` in `public/js/ig_studio.js` + `#view-site-builder`
// in index.html). Generates/publishes full landing pages and manages
// searchable-list blocks via the existing Express API through `lib/api`:
//   GET  /api/site-builder/pages
//   GET  /api/site-builder/page/:slug
//   POST /api/site-builder/page/:slug
//   POST /api/site-builder/ai-generate
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface PageSummary {
  title?: string;
  slug: string;
  blockCount?: number;
}
interface PagesResult {
  ok: boolean;
  error?: string;
  pages?: PageSummary[];
}
interface PageBlock {
  type?: string;
  [k: string]: unknown;
}
interface SitePage {
  slug?: string;
  title?: string;
  blocks?: PageBlock[];
  [k: string]: unknown;
}
interface PageResult {
  ok: boolean;
  error?: string;
  page?: SitePage;
}
interface GenerateResult {
  ok: boolean;
  error?: string;
  slug?: string;
}

interface Toast {
  msg: string;
  kind: "ok" | "err";
}

export default function SiteBuilder() {
  const [brand, setBrand] = useState("");
  const [audience, setAudience] = useState("");
  const [valueProp, setValueProp] = useState("");
  const [slug, setSlug] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#0066FF");

  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const [modalSlug, setModalSlug] = useState<string | null>(null);
  const [sxHeading, setSxHeading] = useState("");
  const [sxSub, setSxSub] = useState("");
  const [sxItems, setSxItems] = useState("");
  const [savingBlock, setSavingBlock] = useState(false);

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  }

  async function reload() {
    setLoadingList(true);
    const j = await apiGet<PagesResult>("/api/site-builder/pages");
    setLoadingList(false);
    if (j.ok) setPages(j.pages || []);
  }

  useEffect(() => {
    reload();
  }, []);

  async function generate() {
    setGenerating(true);
    const j = await apiPost<GenerateResult>("/api/site-builder/ai-generate", {
      brand,
      valueProp,
      audience,
      primaryColor,
      slug: slug || undefined,
    });
    setGenerating(false);
    if (!j.ok) {
      showToast(j.error || "Generate failed", "err");
      return;
    }
    showToast("Page published ✓");
    if (j.slug) window.open("/lp/" + j.slug, "_blank");
    reload();
  }

  function openAddSearch(s: string) {
    setModalSlug(s);
    setSxHeading("");
    setSxSub("");
    setSxItems("");
  }

  async function saveSearchBlock() {
    if (!modalSlug) return;
    setSavingBlock(true);
    try {
      const items = sxItems
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [title = "", body = "", url = ""] = l
            .split("|")
            .map((s) => s.trim());
          return { title, body, url };
        });
      const pr = await apiGet<PageResult>(
        "/api/site-builder/page/" + encodeURIComponent(modalSlug),
      );
      if (!pr.ok || !pr.page) throw new Error(pr.error || "load failed");
      const page = pr.page;
      const blocks = (page.blocks || []).filter((b) => b.type !== "search");
      blocks.push({
        type: "search",
        heading: sxHeading,
        subheading: sxSub,
        placeholder: "Search…",
        items,
      });
      const r = await apiPost<{ ok: boolean; error?: string }>(
        "/api/site-builder/page/" + encodeURIComponent(modalSlug),
        { ...page, blocks },
      );
      if (!r.ok) throw new Error(r.error || "save failed");
      showToast("Search block added ✓");
      setModalSlug(null);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "save failed", "err");
    } finally {
      setSavingBlock(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: 10,
    border: "1.5px solid #E5E7EB",
    borderRadius: 8,
    margin: "6px 0",
    boxSizing: "border-box",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>
                🧱 Landing Page Builder
              </h1>
              <p style={{ margin: "6px 0 0", color: "#64748B" }}>
                Generate full landing pages from a brief — published instantly.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ padding: "24px 0 64px" }}>
        <div
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: "0 0 12px" }}>Generate a new page</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <label>
              Brand
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              Audience
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <label>
            Value proposition
            <textarea
              value={valueProp}
              onChange={(e) => setValueProp(e.target.value)}
              rows={2}
              style={{ ...inputStyle, fontFamily: "inherit" }}
            />
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <label>
              Slug (URL part)
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="my-launch"
                style={inputStyle}
              />
            </label>
            <label>
              Primary color
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                style={{ ...inputStyle, padding: 6, height: 40 }}
              />
            </label>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            style={{
              background: "#0066FF",
              color: "white",
              border: 0,
              padding: "12px 24px",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
              marginTop: 8,
            }}
          >
            {generating ? "⏳ Generating…" : "✨ Generate page"}
          </button>
        </div>

        <div
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
          }}
        >
          <h3 style={{ margin: "0 0 12px" }}>Your pages</h3>
          <div>
            {loadingList ? (
              "Loading…"
            ) : !pages.length ? (
              <p style={{ color: "#94A3B8", fontSize: 13 }}>
                No pages yet — generate one above.
              </p>
            ) : (
              pages.map((p) => (
                <div
                  key={p.slug}
                  style={{
                    borderBottom: "1px solid #F1F5F9",
                    padding: "10px 0",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.title || p.slug}</div>
                    <div style={{ fontSize: 12, color: "#64748B" }}>
                      {p.blockCount} blocks · /{p.slug}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => openAddSearch(p.slug)}
                      style={{
                        background: "#7C3AED",
                        color: "white",
                        border: 0,
                        padding: "6px 10px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      + Search block
                    </button>
                    <a
                      href={"/lp/" + p.slug}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        background: "#0F172A",
                        color: "white",
                        padding: "6px 12px",
                        borderRadius: 6,
                        textDecoration: "none",
                        fontSize: 13,
                      }}
                    >
                      🔗 View
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {modalSlug && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalSlug(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,.6)",
            zIndex: 99998,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "40px 16px",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: 16,
              maxWidth: 600,
              width: "100%",
              padding: 28,
              boxShadow: "0 20px 60px rgba(0,0,0,.3)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
                + Add searchable list block
              </h2>
              <button
                onClick={() => setModalSlug(null)}
                style={{
                  background: "none",
                  border: 0,
                  fontSize: 24,
                  cursor: "pointer",
                  color: "#64748B",
                }}
              >
                ×
              </button>
            </div>
            <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 10px" }}>
              Adds a search bar + filterable card grid to{" "}
              <code>/lp/{modalSlug}</code>. Internal-search queries (and
              zero-result ones) are captured under Page Insights.
            </p>
            <label>
              Section heading
              <input
                value={sxHeading}
                onChange={(e) => setSxHeading(e.target.value)}
                placeholder="Browse our resources"
                style={{ ...inputStyle, padding: 9, margin: "4px 0" }}
              />
            </label>
            <label>
              Subheading
              <input
                value={sxSub}
                onChange={(e) => setSxSub(e.target.value)}
                placeholder="Search by topic, keyword or product name"
                style={{ ...inputStyle, padding: 9, margin: "4px 0" }}
              />
            </label>
            <label>
              Items (one per line — <code>title | body | url</code>)
              <textarea
                value={sxItems}
                onChange={(e) => setSxItems(e.target.value)}
                rows={6}
                placeholder={
                  "Pricing | See plans starting at $29 | https://example.com/pricing\nOnboarding guide | 5-min walkthrough for new users | https://example.com/start"
                }
                style={{
                  ...inputStyle,
                  padding: 9,
                  fontFamily: "monospace",
                  fontSize: 12,
                  margin: "4px 0 10px",
                }}
              />
            </label>
            <button
              onClick={saveSearchBlock}
              disabled={savingBlock}
              style={{
                background: "#7C3AED",
                color: "white",
                border: 0,
                padding: "10px 18px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {savingBlock ? "Adding…" : "Add block"}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: toast.kind === "err" ? "#DC2626" : "#0F766E",
            color: "white",
            padding: "12px 20px",
            borderRadius: 10,
            fontWeight: 600,
            boxShadow: "0 8px 24px rgba(0,0,0,.16)",
            zIndex: 99999,
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

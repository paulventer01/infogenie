"use client";

// Native React port of the legacy `canva` panel (was `window.buildCanvaLauncher`
// in `public/js/ig_intel_pack_b.js` + `#view-canva` in index.html). Browses
// Canva templates, formats InfoGenie copy for paste, and removes image
// backgrounds via the existing Express API
// (`GET /api/canva/templates`, `POST /api/canva/format`,
// `POST /api/tools/remove-bg`, `POST /api/creatives/upload`) through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface TemplateItem {
  name: string;
  platform: string;
  url: string;
}
interface TemplateCategory {
  category: string;
  icon: string;
  label: string;
  description: string;
  templates: TemplateItem[];
}
interface TemplatesResult {
  ok?: boolean;
  templates?: TemplateCategory[];
}
interface FormatResult {
  ok: boolean;
  error?: string;
  formatted?: string;
}
interface RemoveBgResult {
  ok: boolean;
  error?: string;
  result_b64?: string;
  credits_charged?: number;
}

function safeUrl(u: string | undefined): string {
  const s = String(u || "");
  if (/^https?:\/\//i.test(s) || s.startsWith("/")) return s;
  return "";
}

function toast(msg: string) {
  const fn = (window as unknown as { showToast?: (m: string) => void })
    .showToast;
  if (fn) fn(msg);
  else alert(msg);
}

export default function Canva() {
  const [templates, setTemplates] = useState<TemplateCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState("social-post");
  const [oauthReady, setOauthReady] = useState(false);
  const [kitBrief, setKitBrief] = useState("");
  const [kitLinks, setKitLinks] = useState<{ name: string; open_url: string; platform: string }[]>([]);
  const [kitBusy, setKitBusy] = useState(false);
  const [brand, setBrand] = useState("");

  const [formatType, setFormatType] = useState("social-post");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [cta, setCta] = useState("");
  const [formatError, setFormatError] = useState("");
  const [formatted, setFormatted] = useState("");
  const [copied, setCopied] = useState(false);

  const [rbgUrl, setRbgUrl] = useState("");
  const [rbgStatus, setRbgStatus] = useState<
    "idle" | "loading" | "error" | "done"
  >("idle");
  const [rbgError, setRbgError] = useState("");
  const [rbg, setRbg] = useState<RemoveBgResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const d = await apiGet<TemplatesResult>("/api/canva/templates");
      setTemplates(d.templates || []);
      const st = await apiGet<{ ok?: boolean; oauthReady?: boolean }>("/api/canva/status");
      setOauthReady(!!st.oauthReady);
    })();
  }, []);

  const cat =
    templates.find((t) => t.category === activeCategory) || templates[0];

  async function runFormat() {
    if (!title.trim() && !body.trim()) {
      alert("Add at least a title or body copy.");
      return;
    }
    setFormatError("");
    setFormatted("");
    const d = await apiPost<FormatResult>("/api/canva/format", {
      type: formatType,
      title: title.trim(),
      body: body.trim(),
      cta: cta.trim(),
    });
    if (!d.ok) {
      setFormatError(d.error || "Format failed");
      return;
    }
    setFormatted(d.formatted || "");
    setCopied(false);
  }

  async function rbgProcess(opts: { json?: object; form?: FormData }) {
    setRbgStatus("loading");
    setRbgError("");
    setRbg(null);
    try {
      const res = await fetch("/api/tools/remove-bg", {
        method: "POST",
        credentials: "same-origin",
        ...(opts.json
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(opts.json),
            }
          : { body: opts.form }),
      });
      const d = (await res.json()) as RemoveBgResult;
      if (!d.ok) {
        setRbgStatus("error");
        setRbgError(d.error || "Remove background failed");
        return;
      }
      setRbg(d);
      setRbgStatus("done");
    } catch (e) {
      setRbgStatus("error");
      setRbgError(e instanceof Error ? e.message : "network_error");
    }
  }

  async function handleUrl() {
    if (!rbgUrl.trim()) {
      alert("Paste an image URL first.");
      return;
    }
    await rbgProcess({ json: { image_url: rbgUrl.trim() } });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("image", file);
    await rbgProcess({ form });
  }

  async function saveToAssets(b64: string) {
    try {
      const byteArr = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([byteArr], { type: "image/png" });
      const fname = "no_bg_" + Date.now() + ".png";
      const file = new File([blob], fname, { type: "image/png" });
      const form = new FormData();
      form.append("files", file);
      form.append("tag", "No BG");
      await fetch("/api/creatives/upload", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      toast('✅ Saved to Brand Assets as "' + fname + '"');
    } catch (e) {
      toast("⚠ Save failed: " + (e instanceof Error ? e.message : ""));
    }
  }

  const rbgSrc = rbg?.result_b64
    ? "data:image/png;base64," + rbg.result_b64
    : "";

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Canva Launcher
              </div>
              <h2 className="view-title">🎨 Canva Template Launcher</h2>
              <p className="view-sub">
                Bridge your InfoGenie content directly to Canva. Browse curated
                templates by content type, format your copy for instant paste
                into any design, and open the right Canva template in one click —
                no design experience needed.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "linear-gradient(135deg,#EEF2FF,#ECFEFF)",
            border: "1px solid #C7D2FE",
            borderRadius: 14,
            padding: 16,
            marginBottom: 20,
            maxWidth: 1100,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 800, color: "#0F172A" }}>Design Kit + Connect</div>
              <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                Build a paste-ready brief and open matching Canva templates.{" "}
                {oauthReady ? "Canva Connect credentials detected." : "Template deep-links work without OAuth."}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={async () => {
                  const r = await apiGet<{ ok?: boolean; authorize_url?: string; error?: string }>(
                    "/api/canva/oauth/start"
                  );
                  if (r.authorize_url) window.open(r.authorize_url, "_blank", "noopener,noreferrer");
                  else toast(r.error || "Add CANVA_CLIENT_ID + CANVA_CLIENT_SECRET to enable Connect.");
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 9,
                  border: "1px solid #6366F1",
                  background: oauthReady ? "#4F46E5" : "#fff",
                  color: oauthReady ? "#fff" : "#4F46E5",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {oauthReady ? "Connect Canva" : "Connect Canva (needs keys)"}
              </button>
              <button
                type="button"
                disabled={kitBusy}
                onClick={async () => {
                  setKitBusy(true);
                  const r = await apiPost<{
                    ok?: boolean;
                    brief?: string;
                    templates?: { name: string; open_url: string; platform: string }[];
                    error?: string;
                  }>("/api/canva/design-kit", {
                    type: formatType || activeCategory,
                    title: title.trim(),
                    body: body.trim(),
                    cta: cta.trim() || "Learn more",
                    brand: brand.trim(),
                  });
                  setKitBrief(r.brief || "");
                  setKitLinks(r.templates || []);
                  setKitBusy(false);
                  if (!r.ok) toast(r.error || "Design Kit failed");
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 9,
                  border: "none",
                  background: "linear-gradient(135deg,#0066FF,#00C9C8)",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: 13,
                  opacity: kitBusy ? 0.7 : 1,
                }}
              >
                {kitBusy ? "Building…" : "Build Design Kit"}
              </button>
            </div>
          </div>
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Brand name (optional)"
            style={{
              marginTop: 12,
              width: "100%",
              maxWidth: 360,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #CBD5E1",
              fontSize: 13,
            }}
          />
          {kitBrief && (
            <div style={{ marginTop: 12 }}>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: 10,
                  padding: 12,
                  fontSize: 12,
                  color: "#334155",
                  margin: 0,
                }}
              >
                {kitBrief}
              </pre>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(kitBrief);
                      toast("Brief copied");
                    } catch {
                      toast("Copy failed");
                    }
                  }}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 8,
                    border: "1px solid #CBD5E1",
                    background: "#fff",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Copy brief
                </button>
                {kitLinks.map((t) => (
                  <a
                    key={t.name}
                    href={safeUrl(t.open_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "7px 12px",
                      borderRadius: 8,
                      border: "1px solid #A5B4FC",
                      background: "#EEF2FF",
                      color: "#3730A3",
                      fontWeight: 700,
                      fontSize: 12,
                      textDecoration: "none",
                    }}
                  >
                    Open {t.name} →
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            maxWidth: 1100,
          }}
        >
          <div>
            <h3
              style={{
                margin: "0 0 14px",
                fontSize: "1rem",
                fontWeight: 700,
                color: "#111",
              }}
            >
              Browse by Content Type
            </h3>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                marginBottom: 24,
              }}
            >
              {templates.map((t) => (
                <button
                  key={t.category}
                  onClick={() => setActiveCategory(t.category)}
                  style={{
                    textAlign: "left",
                    padding: "10px 16px",
                    borderRadius: 10,
                    border: `2px solid ${
                      activeCategory === t.category ? "#7B68EE" : "#E5E7EB"
                    }`,
                    background:
                      activeCategory === t.category ? "#F5F3FF" : "#fff",
                    cursor: "pointer",
                    fontSize: "0.88rem",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: "1.2rem" }}>{t.icon}</span>
                  <div>
                    <div
                      style={{
                        fontWeight: 700,
                        color:
                          activeCategory === t.category ? "#7B68EE" : "#111",
                      }}
                    >
                      {t.label}
                    </div>
                    <div
                      style={{
                        fontSize: "0.77rem",
                        color: "#6B7280",
                        marginTop: 1,
                      }}
                    >
                      {t.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3
              style={{
                margin: "0 0 14px",
                fontSize: "1rem",
                fontWeight: 700,
                color: "#111",
              }}
            >
              {cat ? cat.icon + " " + cat.label : "Templates"}
            </h3>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                marginBottom: 24,
              }}
            >
              {cat
                ? cat.templates.map((t, i) => (
                    <div
                      key={i}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderRadius: 10,
                        padding: "14px 16px",
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: "0.9rem",
                            color: "#111",
                          }}
                        >
                          {t.name}
                        </div>
                        <div
                          style={{
                            fontSize: "0.78rem",
                            color: "#6B7280",
                            marginTop: 2,
                          }}
                        >
                          Platform: {t.platform}
                        </div>
                      </div>
                      <a
                        href={safeUrl(t.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: "8px 16px",
                          background: "#7B68EE",
                          color: "#fff",
                          borderRadius: 8,
                          textDecoration: "none",
                          fontSize: "0.83rem",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Open in Canva ↗
                      </a>
                    </div>
                  ))
                : null}
            </div>

            <div
              style={{
                background: "#FFF8F0",
                border: "1px solid #FDE68A",
                borderRadius: 12,
                padding: 20,
              }}
            >
              <h4
                style={{
                  margin: "0 0 10px",
                  fontSize: "0.9rem",
                  fontWeight: 700,
                  color: "#92400E",
                }}
              >
                📋 Format Copy for Canva
              </h4>
              <p
                style={{
                  margin: "0 0 12px",
                  fontSize: "0.82rem",
                  color: "#78350F",
                }}
              >
                Paste your InfoGenie content below and get it formatted for easy
                copy-paste into any Canva text field.
              </p>
              <select
                value={formatType}
                onChange={(e) => setFormatType(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #FCA5A5",
                  borderRadius: 8,
                  fontSize: "0.84rem",
                  background: "#fff",
                  marginBottom: 10,
                }}
              >
                <option value="social-post">Social Post</option>
                <option value="carousel">Carousel (slides)</option>
                <option value="email">Email</option>
                <option value="ad-creative">Ad Creative</option>
                <option value="blog">Blog / Article</option>
              </select>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Headline / Title"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "9px 12px",
                  border: "1px solid #E5E7EB",
                  borderRadius: 8,
                  fontSize: "0.84rem",
                  marginBottom: 8,
                }}
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Body copy..."
                rows={4}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "9px 12px",
                  border: "1px solid #E5E7EB",
                  borderRadius: 8,
                  fontSize: "0.84rem",
                  resize: "vertical",
                  marginBottom: 8,
                }}
              />
              <input
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="CTA text (e.g. Learn More)"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "9px 12px",
                  border: "1px solid #E5E7EB",
                  borderRadius: 8,
                  fontSize: "0.84rem",
                  marginBottom: 10,
                }}
              />
              <button
                onClick={runFormat}
                style={{
                  width: "100%",
                  padding: 10,
                  background: "#7B68EE",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Format for Canva
              </button>
              <div style={{ marginTop: 12 }}>
                {formatError && (
                  <div style={{ color: "#DC2626", padding: 10 }}>
                    {formatError}
                  </div>
                )}
                {formatted && (
                  <>
                    <div
                      style={{
                        background: "#F9FAFB",
                        border: "1px solid #E5E7EB",
                        borderRadius: 8,
                        padding: 14,
                      }}
                    >
                      <pre
                        style={{
                          margin: 0,
                          fontSize: "0.82rem",
                          color: "#374151",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontFamily: "inherit",
                        }}
                      >
                        {formatted}
                      </pre>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(formatted);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                      style={{
                        width: "100%",
                        marginTop: 8,
                        padding: 9,
                        background: "#6C63FF",
                        color: "#fff",
                        border: "none",
                        borderRadius: 8,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {copied ? "✅ Copied!" : "📋 Copy to Clipboard"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Background Remover */}
        <div
          style={{
            marginTop: 24,
            background: "linear-gradient(135deg,#F5F3FF 0%,#EDE9FE 100%)",
            border: "1.5px solid #DDD6FE",
            borderRadius: 14,
            padding: 22,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 6,
            }}
          >
            <span style={{ fontSize: "1.4rem" }}>🪄</span>
            <div>
              <h3
                style={{
                  margin: 0,
                  fontSize: "1rem",
                  fontWeight: 800,
                  color: "#4C1D95",
                }}
              >
                Image Background Remover
              </h3>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: "0.78rem",
                  color: "#6D28D9",
                }}
              >
                Powered by remove.bg · Perfect for ad creatives, product shots
                &amp; Canva templates
              </p>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              marginTop: 16,
            }}
          >
            <div>
              <label
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: "#4C1D95",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Upload an image
              </label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFile}
              />
              <button
                onClick={() => fileRef.current?.click()}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  background: "#fff",
                  border: "2px dashed #A78BFA",
                  borderRadius: 10,
                  color: "#6D28D9",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: "0.84rem",
                }}
              >
                📁 Choose file (JPG, PNG, WebP)
              </button>
            </div>
            <div>
              <label
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: "#4C1D95",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Or paste an image URL
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={rbgUrl}
                  onChange={(e) => setRbgUrl(e.target.value)}
                  placeholder="https://example.com/product.jpg"
                  style={{
                    flex: 1,
                    padding: "9px 12px",
                    border: "1.5px solid #C4B5FD",
                    borderRadius: 8,
                    fontSize: "0.82rem",
                  }}
                />
                <button
                  onClick={handleUrl}
                  style={{
                    padding: "9px 16px",
                    background: "#7B68EE",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Remove BG
                </button>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            {rbgStatus === "loading" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: 14,
                  background: "#F5F3FF",
                  borderRadius: 10,
                  color: "#6D28D9",
                  fontSize: "0.85rem",
                }}
              >
                <span style={{ fontSize: "1.3rem" }}>⏳</span> Removing
                background… (this can take a few seconds)
              </div>
            )}
            {rbgStatus === "error" && (
              <div
                style={{
                  padding: 14,
                  background: "#FEE2E2",
                  color: "#B91C1C",
                  borderRadius: 10,
                  fontSize: "0.85rem",
                }}
              >
                ⚠ {rbgError}
              </div>
            )}
            {rbgStatus === "done" && rbg && (
              <div
                style={{
                  background: "#fff",
                  border: "1.5px solid #DDD6FE",
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: "#4C1D95",
                        marginBottom: 8,
                      }}
                    >
                      ✅ Background removed ({rbg.credits_charged} credit used)
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={rbgSrc}
                      alt="Result"
                      style={{
                        maxWidth: "100%",
                        maxHeight: 260,
                        borderRadius: 8,
                        border: "1px solid #E5E7EB",
                        background:
                          "repeating-conic-gradient(#E5E7EB 0% 25%, #fff 0% 50%) 0 0/20px 20px",
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <a
                    href={rbgSrc}
                    download="no_bg.png"
                    style={{
                      flex: 1,
                      textAlign: "center",
                      padding: 9,
                      background: "#7B68EE",
                      color: "#fff",
                      borderRadius: 8,
                      textDecoration: "none",
                      fontWeight: 700,
                      fontSize: "0.83rem",
                    }}
                  >
                    ⬇ Download PNG
                  </a>
                  <button
                    onClick={() => saveToAssets(rbg.result_b64 || "")}
                    style={{
                      flex: 1,
                      padding: 9,
                      background: "#10B981",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontSize: "0.83rem",
                    }}
                  >
                    💾 Save to Brand Assets
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

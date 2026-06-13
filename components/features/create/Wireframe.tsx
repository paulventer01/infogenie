"use client";

// Native React port of the legacy `wireframe` panel (was
// `window.buildWireframe` + `#view-wireframe` in index.html, defined in
// public/js/ig_design_studio.js). Generates a full HTML wireframe for a page
// via the existing Express API (`POST /api/wireframe/generate`,
// `GET /api/wireframe/history`) through `lib/api`. Preview renders in a
// sandboxed iframe; download saves the raw HTML.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface WireframeResult {
  ok: boolean;
  error?: string;
  html: string;
  brand?: string;
  page_type: string;
  source?: string;
}
interface WireframeRun {
  id: number;
  page_type: string;
  description?: string;
  created_at: string;
  source?: string;
}

const PAGE_TYPES: { value: string; label: string }[] = [
  { value: "landing", label: "🚀 Landing Page" },
  { value: "pricing", label: "💰 Pricing Page" },
  { value: "about", label: "👥 About Page" },
  { value: "product", label: "📦 Product Page" },
  { value: "checkout", label: "🛒 Checkout Page" },
  { value: "dashboard", label: "📊 Dashboard" },
  { value: "blog", label: "📝 Blog / Article" },
  { value: "contact", label: "✉️ Contact Page" },
  { value: "login", label: "🔐 Login / Sign Up" },
  { value: "portfolio", label: "🎨 Portfolio" },
];

const PAGE_LABELS: Record<string, string> = {
  landing: "Landing Page",
  pricing: "Pricing Page",
  about: "About Page",
  product: "Product Page",
  checkout: "Checkout",
  dashboard: "Dashboard",
  blog: "Blog",
  contact: "Contact Page",
  login: "Login / Sign Up",
  portfolio: "Portfolio",
};

function toast(msg: string, ok = true) {
  if (typeof document === "undefined") return;
  const t = document.createElement("div");
  t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${ok ? "#22C55E" : "#EF4444"};color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18)`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  border: "1.5px solid #E2E8F0",
  padding: "28px 32px",
  marginBottom: 24,
};
const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
  display: "block",
  marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  border: "1.5px solid #E2E8F0",
  borderRadius: 10,
  fontSize: 14,
  color: "#1E293B",
  outline: "none",
  boxSizing: "border-box",
};

export default function Wireframe() {
  const [pageType, setPageType] = useState("landing");
  const [brand, setBrand] = useState("");
  const [description, setDescription] = useState("");
  const [sections, setSections] = useState("");
  const [mobile, setMobile] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<WireframeResult | null>(null);
  const [history, setHistory] = useState<WireframeRun[]>([]);

  async function loadHistory() {
    const r = await apiGet<{ ok: boolean; runs?: WireframeRun[] }>(
      "/api/wireframe/history",
    );
    if (r.ok && r.runs?.length) setHistory(r.runs);
    else setHistory([]);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function generate() {
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<WireframeResult>("/api/wireframe/generate", {
      page_type: pageType,
      description: description.trim(),
      brand: brand.trim(),
      sections: sections.trim(),
      mobile,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "Generation failed");
      return;
    }
    setResult(r);
    setStatus("idle");
    loadHistory();
  }

  function downloadHtml() {
    if (!result) return;
    const blob = new Blob([result.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wireframe-${result.page_type}-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast("HTML downloaded!", true);
  }

  function fullPreview() {
    if (!result) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(result.html);
    w.document.close();
  }

  return (
    <div className="view-header-wrap">
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Wireframe Generator
              </div>
              <h2 className="view-title">📐 AI Wireframe Generator</h2>
              <p className="view-sub">
                Describe any page and get a complete HTML wireframe in seconds —
                landing pages, pricing, checkout, dashboards. Preview live in the
                browser or download as HTML.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={cardStyle}>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#1E293B",
              margin: "0 0 6px",
            }}
          >
            Generate a Wireframe
          </h3>
          <p style={{ color: "#64748B", fontSize: 14, margin: "0 0 24px" }}>
            Describe your page and get a full HTML wireframe — preview it in the
            browser, download as HTML, or hand it to a developer.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div>
              <label style={labelStyle}>Page Type</label>
              <select
                value={pageType}
                onChange={(e) => setPageType(e.target.value)}
                style={{ ...inputStyle, background: "#fff" }}
              >
                {PAGE_TYPES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Brand / Product Name</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                type="text"
                placeholder="e.g. InfoGenie"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Page Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="e.g. SaaS pricing page with 3 tiers (Starter $29, Pro $79, Enterprise custom), monthly/annual toggle, most popular badge on Pro, feature comparison table below, FAQ section"
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: 16,
              alignItems: "center",
              marginBottom: 24,
            }}
          >
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>
                Specific sections to include{" "}
                <span style={{ fontWeight: 400, color: "#94A3B8" }}>
                  (optional)
                </span>
              </label>
              <input
                value={sections}
                onChange={(e) => setSections(e.target.value)}
                type="text"
                placeholder="e.g. hero, features grid, testimonials, FAQ, CTA"
                style={inputStyle}
              />
            </div>
            <div style={{ paddingTop: 24 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                <input
                  type="checkbox"
                  checked={mobile}
                  onChange={(e) => setMobile(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "#6366F1" }}
                />
                📱 Mobile layout
              </label>
            </div>
          </div>

          <button
            onClick={generate}
            disabled={status === "loading"}
            style={{
              background: "#6366F1",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "13px 28px",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            📐 Generate Wireframe
          </button>
        </div>

        <div style={{ marginTop: 8 }}>
          {status === "loading" && (
            <div style={{ textAlign: "center", padding: "64px 24px" }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  border: "4px solid #E5E7EB",
                  borderTopColor: "#6366F1",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  margin: "0 auto 16px",
                }}
              />
              <p style={{ color: "#64748B", fontSize: 14 }}>
                Generating wireframe… this takes 20-40 seconds
              </p>
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1.5px solid #FECACA",
                borderRadius: 12,
                padding: 20,
                color: "#DC2626",
              }}
            >
              {error}
            </div>
          )}
          {status === "idle" && result && (
            <div style={cardStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div>
                  <h3
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: "#1E293B",
                      margin: "0 0 2px",
                    }}
                  >
                    {result.brand || ""}{" "}
                    {PAGE_LABELS[result.page_type] || result.page_type} Wireframe
                  </h3>
                  <p style={{ fontSize: 12, color: "#94A3B8", margin: 0 }}>
                    📐 {result.source === "ai" ? "AI-generated" : "Template"} ·
                    Click Download to save as HTML
                  </p>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={fullPreview}
                    style={{
                      background: "#F1F5F9",
                      color: "#374151",
                      border: "1.5px solid #E2E8F0",
                      borderRadius: 10,
                      padding: "9px 18px",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    🖥️ Full Preview
                  </button>
                  <button
                    onClick={downloadHtml}
                    style={{
                      background: "#22C55E",
                      color: "#fff",
                      border: "none",
                      borderRadius: 10,
                      padding: "10px 20px",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    ⬇️ Download HTML
                  </button>
                </div>
              </div>

              <div
                style={{
                  border: "2px solid #E2E8F0",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "#F8FAFC",
                }}
              >
                <div
                  style={{
                    background: "#E2E8F0",
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "#EF4444",
                    }}
                  />
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "#F59E0B",
                    }}
                  />
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "#22C55E",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: "#64748B",
                      marginLeft: 8,
                    }}
                  >
                    Wireframe Preview
                  </span>
                </div>
                <iframe
                  title="Wireframe Preview"
                  srcDoc={result.html}
                  style={{
                    width: "100%",
                    height: 600,
                    border: "none",
                    background: "#fff",
                  }}
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          )}
        </div>

        {history.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ ...cardStyle, marginTop: 0 }}>
              <h4
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#1E293B",
                  margin: "0 0 16px",
                }}
              >
                Recent Wireframes
              </h4>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                {history.map((run) => (
                  <div
                    key={run.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "#F8FAFC",
                      borderRadius: 10,
                      padding: "10px 14px",
                      border: "1.5px solid #E2E8F0",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#1E293B",
                          textTransform: "capitalize",
                        }}
                      >
                        {run.page_type}
                      </span>
                      {run.description && (
                        <span
                          style={{
                            fontSize: 12,
                            color: "#64748B",
                            marginLeft: 8,
                          }}
                        >
                          {run.description.slice(0, 60)}…
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 11,
                          color: "#94A3B8",
                          marginLeft: 6,
                        }}
                      >
                        {new Date(run.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        background: run.source === "ai" ? "#EEF2FF" : "#F1F5F9",
                        color: run.source === "ai" ? "#6366F1" : "#94A3B8",
                        padding: "2px 8px",
                        borderRadius: 6,
                        fontWeight: 600,
                      }}
                    >
                      {run.source === "ai" ? "AI" : "Template"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

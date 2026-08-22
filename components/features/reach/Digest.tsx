"use client";

// Native React port of the legacy `digest` panel (was `window.buildDigest` +
// `#view-digest` in index.html). One-page executive AI daily digest across
// Crisis Radar, Share of Voice, Trending Topics, Battle Cards and Influencer
// CRM, backed by the existing Express API (`/api/digest/*`) via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

interface DigestSection {
  kind: string;
  title: string;
  body: string;
}

interface DigestDoc {
  id: number;
  brand: string;
  created_at: string;
  headline: string;
  summary_md: string;
  sections?: DigestSection[];
  delivered_to?: unknown[];
  generated_by?: string;
}

interface HistoryItem {
  id: number;
  headline: string;
  brand: string;
  created_at: string;
  generated_by: string;
  delivered_to?: unknown[];
}

interface HistoryResult {
  ok: boolean;
  error?: string;
  digests: HistoryItem[];
}

interface DigestResult {
  ok: boolean;
  error?: string;
  digest: DigestDoc;
}

interface SendResult {
  ok: boolean;
  error?: string;
  delivered?: { ok: boolean; error?: string }[];
}

const SECTION_KINDS: Record<string, { bg: string; border: string; color: string }> = {
  warning: { bg: "#FEE2E2", border: "#FCA5A5", color: "#991B1B" },
  win: { bg: "#D1FAE5", border: "#6EE7B7", color: "#065F46" },
  action: { bg: "#FEF3C7", border: "#FCD34D", color: "#92400E" },
  highlight: { bg: "#DBEAFE", border: "#93C5FD", color: "#1E40AF" },
};

export default function Digest() {
  const [brand, setBrand] = useState("Nike");
  const [current, setCurrent] = useState<DigestDoc | null>(null);
  const [currentStatus, setCurrentStatus] = useState<"idle" | "loading" | "error">("idle");
  const [currentError, setCurrentError] = useState("");
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState("");

  async function loadHistory() {
    setHistoryError("");
    const r = await apiGet<HistoryResult>("/api/digest/history");
    if (!r.ok) {
      setHistory([]);
      setHistoryError(r.error || "failed");
      return;
    }
    setHistory(r.digests || []);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function runDigest() {
    if (!brand.trim()) {
      showToast("⚠️ Enter a brand");
      return;
    }
    setCurrent(null);
    setCurrentError("");
    setCurrentStatus("loading");
    const r = await apiPost<DigestResult>("/api/digest/run-now", { brand: brand.trim() });
    if (!r.ok) {
      setCurrentStatus("error");
      setCurrentError(r.error || "failed");
      return;
    }
    setCurrent(r.digest);
    setCurrentStatus("idle");
    await loadHistory();
    showToast("✅ Digest generated");
  }

  async function openDigest(id: number) {
    const r = await apiGet<DigestResult>("/api/digest/" + id);
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      return;
    }
    setCurrent(r.digest);
    setCurrentStatus("idle");
    setCurrentError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function sendDigest(id: number) {
    const r = await apiPost<SendResult>(`/api/digest/${id}/send`, { channels: ["slack"] });
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      return;
    }
    const ok = (r.delivered || []).find((x) => x.ok);
    showToast(ok ? "✅ Sent to Slack" : "⚠️ " + ((r.delivered || [])[0]?.error || "no channel configured"));
    await loadHistory();
  }

  async function copyDigest(id: number) {
    const r = await apiGet<DigestResult>("/api/digest/" + id);
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      return;
    }
    const d = r.digest;
    const md = `# ${d.headline}\n\n${d.summary_md}\n\n${(d.sections || [])
      .map((s) => `## ${s.title}\n${s.body}`)
      .join("\n\n")}\n\n_${d.brand} · ${new Date(d.created_at).toLocaleString()}_`;
    try {
      await navigator.clipboard.writeText(md);
      showToast("✅ Copied to clipboard");
    } catch (e) {
      showToast("❌ " + (e instanceof Error ? e.message : String(e)));
    }
  }

  function renderCurrent(d: DigestDoc) {
    return (
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            background: "linear-gradient(135deg,#0f766e 0%,#5B21B6 100%)",
            color: "#fff",
            borderRadius: "12px 12px 0 0",
            padding: "20px 24px",
          }}
        >
          <div style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: ".08em", opacity: 0.85 }}>
            {d.brand} · {new Date(d.created_at).toLocaleString()}
          </div>
          <div
            style={{
              fontSize: "1.2rem",
              fontWeight: 800,
              marginTop: 6,
              color: "#fff",
              WebkitTextFillColor: "#fff",
            }}
          >
            {d.headline}
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderTop: 0,
            borderRadius: "0 0 12px 12px",
            padding: "20px 24px",
          }}
        >
          <div
            style={{
              color: "#374151",
              fontSize: "0.88rem",
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              marginBottom: 16,
            }}
          >
            {d.summary_md}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(d.sections || []).map((s, i) => {
              const k = SECTION_KINDS[s.kind] || SECTION_KINDS.highlight;
              return (
                <div
                  key={i}
                  style={{
                    background: k.bg,
                    borderLeft: `4px solid ${k.border}`,
                    borderRadius: 6,
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ fontWeight: 800, color: k.color, fontSize: "0.82rem", marginBottom: 4 }}>
                    {s.title}
                  </div>
                  <div style={{ color: "#374151", fontSize: "0.85rem", lineHeight: 1.5 }}>{s.body}</div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 18,
              paddingTop: 16,
              borderTop: "1px solid #F3F4F6",
            }}
          >
            <button
              onClick={() => sendDigest(d.id)}
              style={{
                padding: "8px 16px",
                background: "#15803D",
                border: "2px solid #15803D",
                borderRadius: 6,
                fontSize: "0.78rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              📤 Send to Slack
            </button>
            <button
              onClick={() => copyDigest(d.id)}
              style={{
                padding: "8px 16px",
                background: "#fff",
                border: "2px solid #D1D5DB",
                borderRadius: 6,
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "#374151",
                cursor: "pointer",
              }}
            >
              📋 Copy as Markdown
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> Daily Digest
              </div>
              <h2 className="view-title">📋 AI Daily Digest</h2>
              <p className="view-sub">
                One-page executive summary across Crisis Radar, Share of Voice, Trending Topics, Battle Cards and
                Influencer CRM. Auto-generated daily and on demand. Send straight to Slack.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 20,
            marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label
                style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 4 }}
              >
                Brand
              </label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Nike"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.88rem",
                }}
              />
            </div>
            <button
              onClick={runDigest}
              style={{
                padding: "10px 20px",
                background: "#0f766e",
                border: "2px solid #0f766e",
                borderRadius: 8,
                fontSize: "0.82rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              ⚡ Generate Digest Now
            </button>
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 8 }}>
            Auto-runs daily for every brand in your Crisis Radar watchlist. Generates from real data: SoV, incidents,
            trends, new battle cards, new creators.
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          {currentStatus === "loading" && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 20, color: "#6B7280" }}>
              ⏳ Generating digest…
            </div>
          )}
          {currentStatus === "error" && (
            <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10 }}>{currentError}</div>
          )}
          {currentStatus === "idle" && current && renderCurrent(current)}
        </div>

        <div>
          {history === null ? (
            <div style={{ color: "#6B7280", fontSize: "0.85rem" }}>Loading history…</div>
          ) : historyError ? (
            <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10 }}>{historyError}</div>
          ) : history.length === 0 ? (
            <div
              style={{
                background: "#F9FAFB",
                border: "1px dashed #D1D5DB",
                borderRadius: 10,
                padding: 24,
                textAlign: "center",
                color: "#6B7280",
                fontSize: "0.88rem",
              }}
            >
              No digests yet. Click ⚡ Generate Digest Now above.
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 10 }}>📚 History</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {history.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => openDigest(d.id)}
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 10,
                      padding: "14px 16px",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 14,
                      alignItems: "center",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.borderColor = "#0f766e")}
                    onMouseOut={(e) => (e.currentTarget.style.borderColor = "#E5E7EB")}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.9rem" }}>{d.headline}</div>
                      <div style={{ fontSize: "0.7rem", color: "#6B7280", marginTop: 3 }}>
                        {d.brand} · {new Date(d.created_at).toLocaleString()} ·{" "}
                        <span style={{ color: d.generated_by === "openai" ? "#15803D" : "#9CA3AF" }}>
                          {d.generated_by}
                        </span>
                        {(d.delivered_to || []).length ? " · ✉️ sent" : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: "1.1rem", color: "#0f766e" }}>→</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

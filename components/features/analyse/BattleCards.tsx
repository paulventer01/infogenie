"use client";

// Native React port of the legacy `battle-cards` panel (was
// `window.buildBattleCards` + `#view-battle-cards` in app.js / index.html).
// Auto-generates 1-page competitor intel briefs against the existing Express API
// (`GET /api/battle-cards`, `POST /api/battle-cards/generate`,
// `POST /api/battle-cards/suggest-context`, `GET /api/battle-cards/:id`,
// `DELETE /api/battle-cards/:id`) via `lib/api`. Pre-fills the generate modal
// from the legacy `window.analysisData` global, and links to the Battle Plan via
// `goToView`. See `docs/react-panel-migration.md`.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface AnalysisCompetitor {
  name?: string;
  brand?: string;
  domain?: string;
  url?: string;
  website?: string;
}
interface AnalysisData {
  brand_name?: string;
  url?: string;
  competitors?: AnalysisCompetitor[];
}

interface BattleCard {
  id: string;
  competitor: string;
  domain?: string;
  brand?: string;
  summary?: string;
  positioning?: string;
  strengths?: string[];
  weaknesses?: string[];
  recent_moves?: string[];
  counter_plays?: string[];
  generated_by?: string;
  generated_at?: string;
}
interface CardsResult {
  ok: boolean;
  error?: string;
  cards?: BattleCard[];
}
interface GenerateResult {
  ok: boolean;
  error?: string;
  source?: string;
}
interface SuggestResult {
  ok: boolean;
  error?: string;
  context?: string;
}

function norm(u: string): string {
  return String(u || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

interface FormState {
  competitor: string;
  domain: string;
  brand: string;
  context: string;
}

export default function BattleCards() {
  const router = useRouter();
  const [cards, setCards] = useState<BattleCard[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>({ competitor: "", domain: "", brand: "", context: "" });
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [notice, setNotice] = useState("");

  const compRows = useMemo(() => {
    const ad = getAnalysisData();
    const comps = Array.isArray(ad.competitors) ? ad.competitors : [];
    return comps
      .map((c, i) => {
        const name = c.name || c.brand || c.domain || `Competitor ${i + 1}`;
        const d = norm(c.domain || c.url || c.website || "");
        return { name, d };
      })
      .filter((r) => r.name);
  }, []);

  async function load() {
    setStatus("loading");
    const r = await apiGet<CardsResult>("/api/battle-cards");
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "Failed to load battle cards");
      return;
    }
    setCards(Array.isArray(r.cards) ? r.cards : []);
    setStatus("idle");
  }

  useEffect(() => {
    load();
  }, []);

  function openGenerate() {
    const ad = getAnalysisData();
    const brand =
      ad.brand_name ||
      norm(ad.url || "").split(".")[0] ||
      "";
    setForm({ competitor: "", domain: "", brand, context: "" });
    setNotice("");
    setModalOpen(true);
  }

  function pickCompetitor(v: string) {
    const row = compRows.find((r) => `${r.name}|${r.d}` === v);
    if (row) setForm((f) => ({ ...f, competitor: row.name, domain: row.d }));
  }

  async function suggestContext() {
    if (!form.competitor.trim()) {
      setNotice("❌ Enter the competitor name first");
      return;
    }
    setSuggesting(true);
    setNotice("");
    const r = await apiPost<SuggestResult>("/api/battle-cards/suggest-context", {
      competitor: form.competitor.trim(),
      domain: form.domain.trim(),
      brand: form.brand.trim(),
    });
    setSuggesting(false);
    if (!r.ok) {
      setNotice("❌ " + (r.error || "AI suggest failed"));
      return;
    }
    setForm((f) => ({ ...f, context: r.context || "" }));
    setNotice("✨ Context suggested — edit if you want, then Generate");
  }

  async function generate() {
    const competitor = form.competitor.trim();
    if (!competitor) {
      setNotice("❌ Competitor name required");
      return;
    }
    setBusy(true);
    setNotice("⏳ Generating card (~10s)…");
    const r = await apiPost<GenerateResult>("/api/battle-cards/generate", {
      competitor,
      domain: form.domain.trim(),
      brand: form.brand.trim(),
      context: form.context.trim(),
    });
    setBusy(false);
    if (!r.ok) {
      setNotice("❌ " + (r.error || "Generation failed"));
      return;
    }
    setModalOpen(false);
    load();
  }

  async function regen(card: BattleCard) {
    setForm({ competitor: card.competitor, domain: card.domain || "", brand: card.brand || "", context: "" });
    setNotice("");
    setModalOpen(true);
  }

  async function remove(id: string) {
    if (!confirm("Delete this battle card?")) return;
    await apiDelete("/api/battle-cards/" + encodeURIComponent(id));
    load();
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 11px",
    border: "1.5px solid #E5E7EB",
    borderRadius: 6,
    fontSize: "0.86rem",
  };

  return (
    <div className="view-header-wrap">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .bc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}
        .bc-card{background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:12px}
        .bc-section-title{font-size:0.72rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px}
        .bc-list{margin:0;padding-left:18px;font-size:0.82rem;color:#374151;line-height:1.5}
        .bc-list li{margin-bottom:3px}
        .bc-modal-backdrop{position:fixed;inset:0;background:rgba(10,22,40,.55);z-index:10010;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;backdrop-filter:blur(4px)}
        .bc-modal{background:#fff;width:100%;max-width:560px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:28px 32px}
      `,
        }}
      />
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Battle Cards
              </div>
              <h2 className="view-title">⚔️ Competitor Battle Cards</h2>
              <p className="view-sub">
                Auto-generated 1-page intel briefs per competitor — positioning,
                strengths, weaknesses, recent moves, and concrete counter-plays.
              </p>
            </div>
            <div className="vh-actions">
              <button className="btn-primary" onClick={openGenerate}>
                ✨ New Battle Card
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {status === "loading" && (
          <div style={{ padding: 40, textAlign: "center", color: "#64748B" }}>⏳ Loading battle cards…</div>
        )}
        {status === "error" && (
          <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10 }}>{error}</div>
        )}
        {status === "idle" && cards.length === 0 && (
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 48, textAlign: "center", color: "#6B7280" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>⚔️</div>
            <div style={{ fontWeight: 800, color: "#0A1628", marginBottom: 6 }}>No battle cards yet</div>
            <div style={{ fontSize: "0.88rem", marginBottom: 16 }}>
              Generate your first 1-page competitor intel brief.
            </div>
            <button className="btn-primary" onClick={openGenerate}>
              ✨ New Battle Card
            </button>
          </div>
        )}
        {status === "idle" && cards.length > 0 && (
          <div className="bc-grid">
            {cards.map((c) => (
              <div key={c.id} className="bc-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#0A1628" }}>{c.competitor}</div>
                    {c.domain && <div style={{ fontSize: "0.74rem", color: "#9CA3AF" }}>{c.domain}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => regen(c)}
                      title="Regenerate"
                      style={{ background: "#F3F4F6", border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: "0.72rem" }}
                    >
                      ↻
                    </button>
                    <button
                      onClick={() => remove(c.id)}
                      title="Delete"
                      style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: "0.72rem", color: "#B91C1C" }}
                    >
                      🗑
                    </button>
                  </div>
                </div>

                {c.summary && <div style={{ fontSize: "0.84rem", color: "#374151", lineHeight: 1.55 }}>{c.summary}</div>}

                {c.positioning && (
                  <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "10px 12px", fontSize: "0.82rem", color: "#1D4ED8", lineHeight: 1.5 }}>
                    <strong>Positioning:</strong> {c.positioning}
                  </div>
                )}

                {Array.isArray(c.strengths) && c.strengths.length > 0 && (
                  <div>
                    <div className="bc-section-title" style={{ color: "#065F46" }}>💪 Strengths</div>
                    <ul className="bc-list">{c.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {Array.isArray(c.weaknesses) && c.weaknesses.length > 0 && (
                  <div>
                    <div className="bc-section-title" style={{ color: "#991B1B" }}>🎯 Weaknesses</div>
                    <ul className="bc-list">{c.weaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {Array.isArray(c.recent_moves) && c.recent_moves.length > 0 && (
                  <div>
                    <div className="bc-section-title" style={{ color: "#92400E" }}>📰 Recent Moves</div>
                    <ul className="bc-list">{c.recent_moves.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {Array.isArray(c.counter_plays) && c.counter_plays.length > 0 && (
                  <div>
                    <div className="bc-section-title" style={{ color: "#6D28D9" }}>♟ Counter-Plays</div>
                    <ul className="bc-list">{c.counter_plays.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: 6 }}>
                  <span style={{ fontSize: "0.68rem", color: "#9CA3AF" }}>
                    {c.generated_by ? `via ${c.generated_by}` : ""}
                    {c.generated_at ? ` · ${new Date(c.generated_at).toLocaleDateString()}` : ""}
                  </span>
                  <button
                    onClick={() => goToView(router, "battleplan")}
                    style={{ background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: "0.74rem", fontWeight: 700, cursor: "pointer" }}
                  >
                    ⚔️ Battle Plan →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="bc-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="bc-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontWeight: 800, fontSize: "1.15rem" }}>⚔️ Generate Battle Card</div>
              <button onClick={() => setModalOpen(false)} style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#6B7280" }}>
                ×
              </button>
            </div>
            <div style={{ display: "grid", gap: 11 }}>
              {compRows.length > 0 && (
                <div style={{ background: "linear-gradient(135deg,#EFF6FF,#F5F3FF)", border: "1px solid #BFDBFE", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#1D4ED8", marginBottom: 6 }}>
                    ⚡ AI SUGGEST FROM YOUR ANALYSIS
                  </div>
                  <select
                    onChange={(e) => pickCompetitor(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #BFDBFE", borderRadius: 6, fontSize: "0.82rem", background: "#fff" }}
                  >
                    <option value="">— Pick an analysed competitor —</option>
                    {compRows.map((r) => (
                      <option key={`${r.name}|${r.d}`} value={`${r.name}|${r.d}`}>
                        {r.name}
                        {r.d ? ` — ${r.d}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>Competitor name *</div>
                <input value={form.competitor} onChange={(e) => setForm((f) => ({ ...f, competitor: e.target.value }))} style={inputStyle} />
              </label>
              <label>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>Their domain</div>
                <input value={form.domain} onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))} placeholder="competitor.com" style={inputStyle} />
              </label>
              <label>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>Your brand</div>
                <input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} style={inputStyle} />
              </label>
              <label>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#6B7280" }}>Extra context (optional)</span>
                  <button
                    type="button"
                    onClick={suggestContext}
                    disabled={suggesting}
                    style={{ padding: "4px 10px", background: "linear-gradient(135deg,#7C3AED,#0066FF)", border: "none", borderRadius: 6, fontSize: "0.7rem", fontWeight: 700, color: "#fff", cursor: "pointer" }}
                  >
                    {suggesting ? "⏳ Thinking…" : "✨ AI suggest"}
                  </button>
                </div>
                <textarea
                  value={form.context}
                  onChange={(e) => setForm((f) => ({ ...f, context: e.target.value }))}
                  rows={3}
                  placeholder="Anything the AI should know — pricing tier, target ICP, recent news…"
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </label>
            </div>
            {notice && <div style={{ marginTop: 12, fontSize: "0.78rem", color: "#475569" }}>{notice}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => setModalOpen(false)} style={{ padding: "9px 16px", background: "#fff", border: "2px solid #E5E7EB", borderRadius: 7, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}>
                Cancel
              </button>
              <button
                onClick={generate}
                disabled={busy}
                style={{ padding: "9px 18px", background: "#B91C1C", border: "2px solid #B91C1C", borderRadius: 7, fontSize: "0.78rem", fontWeight: 800, color: "#fff", WebkitTextFillColor: "#fff", cursor: "pointer", textShadow: "0 1px 2px rgba(0,0,0,.4)" }}
              >
                ✨ Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

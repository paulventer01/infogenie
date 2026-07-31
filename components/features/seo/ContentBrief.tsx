"use client";

import { useState, useCallback, useRef } from "react";
import { apiPost, apiGet, apiDelete } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────

interface Brief {
  title: string;
  seo_title: string;
  meta_description: string;
  target_word_count: number;
  headings: string[];
  must_cover_topics: string[];
  entities: string[];
  questions_to_answer: string[];
  unique_angle: string;
  recommendations: string[];
  source?: string;
}

interface CompPage {
  url: string;
  title: string;
  meta: string;
  headings: string[];
  words: number;
}

interface RelatedKw {
  keyword: string;
  search_volume: number | null;
  difficulty: number | null;
  relevance: number | null;
}

interface SerpPage {
  rank: number;
  url: string;
  title: string;
  description: string;
}

interface BriefRun {
  id: number;
  keyword: string;
  brief: Brief;
  related_keywords: RelatedKw[];
  competitor_pages: CompPage[];
  serp_snapshot: SerpPage[];
  avg_word_count: number;
  created_at: string;
}

interface HistoryItem {
  id: number;
  keyword: string;
  source: string;
  created_at: string;
}

// ── Helper components ──────────────────────────────────────────────────────

function Pill({ children, color = "#EFF6FF", text = "#1D4ED8" }: { children: React.ReactNode; color?: string; text?: string }) {
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", background: color,
      color: text, borderRadius: 99, fontSize: ".76rem", fontWeight: 500 }}>
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
      padding: "16px 20px", marginBottom: 12 }}>
      <div style={{ fontWeight: 700, fontSize: ".88rem", color: "#111827", marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

/** API payloads sometimes omit list fields — normalize before render/copy. */
function normalizeRun(raw: Partial<BriefRun> & { related_kws?: RelatedKw[] } | null | undefined): BriefRun | null {
  if (!raw || typeof raw !== "object") return null;
  const brief = (raw.brief && typeof raw.brief === "object" ? raw.brief : {}) as Brief;
  const related = Array.isArray(raw.related_keywords)
    ? raw.related_keywords
    : Array.isArray(raw.related_kws)
      ? raw.related_kws
      : [];
  const competitorPages = Array.isArray(raw.competitor_pages) ? raw.competitor_pages : [];
  return {
    id: Number(raw.id) || 0,
    keyword: String(raw.keyword || ""),
    brief: {
      title: brief.title || "",
      seo_title: brief.seo_title || "",
      meta_description: brief.meta_description || "",
      target_word_count: Number(brief.target_word_count) || 0,
      headings: Array.isArray(brief.headings) ? brief.headings : [],
      must_cover_topics: Array.isArray(brief.must_cover_topics) ? brief.must_cover_topics : [],
      entities: Array.isArray(brief.entities) ? brief.entities : [],
      questions_to_answer: Array.isArray(brief.questions_to_answer) ? brief.questions_to_answer : [],
      unique_angle: brief.unique_angle || "",
      recommendations: Array.isArray(brief.recommendations) ? brief.recommendations : [],
      source: brief.source,
    },
    related_keywords: related,
    competitor_pages: competitorPages,
    serp_snapshot: Array.isArray(raw.serp_snapshot) ? raw.serp_snapshot : [],
    avg_word_count: Number(raw.avg_word_count) || 0,
    created_at: String(raw.created_at || ""),
  };
}

// ── Copy to clipboard helper ───────────────────────────────────────────────
function buildMarkdown(run: BriefRun): string {
  const b = run.brief;
  const lines: string[] = [];
  lines.push(`# SEO Content Brief: ${run.keyword}`, "");
  lines.push(`**Target word count:** ${b.target_word_count?.toLocaleString() ?? "—"}`);
  lines.push(`**H1 title:** ${b.title ?? ""}`);
  lines.push(`**SEO title:** ${b.seo_title ?? ""}`);
  lines.push(`**Meta description:** ${b.meta_description ?? ""}`, "");
  lines.push("## Suggested Heading Structure");
  (b.headings || []).forEach(h => lines.push(`- ${h}`));
  lines.push("", "## Topics to Cover");
  (b.must_cover_topics || []).forEach(t => lines.push(`- ${t}`));
  lines.push("", "## Questions to Answer");
  (b.questions_to_answer || []).forEach(q => lines.push(`- ${q}`));
  lines.push("", "## Entities to Mention");
  (b.entities || []).forEach(e => lines.push(`- ${e}`));
  lines.push("", "## Unique Angle");
  lines.push(b.unique_angle ?? "");
  lines.push("", "## Recommendations");
  (b.recommendations || []).forEach(r => lines.push(`- ${r}`));
  lines.push("", "## Related Keywords");
  run.related_keywords.slice(0, 20).forEach(k =>
    lines.push(`- ${k.keyword} (${k.search_volume != null ? k.search_volume.toLocaleString() + "/mo" : "n/a"})`)
  );
  lines.push("", "## Top Competitor Pages");
  run.competitor_pages.forEach(p =>
    lines.push(`- ${p.url} — ${p.words?.toLocaleString() ?? "?"} words`)
  );
  return lines.join("\n");
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ContentBrief() {
  const [keyword, setKeyword]       = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [run, setRun]               = useState<BriefRun | null>(null);
  const [history, setHistory]       = useState<HistoryItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [copied, setCopied]         = useState(false);
  const [activeTab, setActiveTab]   = useState<"brief" | "keywords" | "competitors">("brief");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    try {
      const r = await apiGet<{ ok: boolean; briefs: HistoryItem[] }>("/api/content-brief");
      setHistory(r.briefs || []);
      setHistoryLoaded(true);
    } catch {}
  }, []);

  const generate = useCallback(async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError(null);
    setRun(null);
    try {
      const r = await apiPost<BriefRun & { ok: boolean; error?: string }>("/api/content-brief/generate", {
        keyword: keyword.trim(),
      });
      if (r.ok === false) { setError(r.error || "Generation failed"); return; }
      const normalized = normalizeRun(r);
      if (!normalized?.keyword) { setError(r.error || "Generation failed"); return; }
      setRun(normalized);
      setActiveTab("brief");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  const loadRun = useCallback(async (id: number) => {
    try {
      const r = await apiGet<BriefRun & { ok?: boolean }>(`/api/content-brief/${id}`);
      const normalized = normalizeRun(r);
      if (!normalized) return;
      setRun(normalized);
      setKeyword(normalized.keyword);
      setActiveTab("brief");
    } catch {}
  }, []);

  const deleteRun = useCallback(async (id: number) => {
    await apiDelete(`/api/content-brief/${id}`);
    setHistory(prev => prev.filter(h => h.id !== id));
    if (run?.id === id) setRun(null);
  }, [run]);

  const copyBrief = useCallback(async () => {
    if (!run) return;
    const md = buildMarkdown(run);
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [run]);

  const b = run?.brief;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", padding: "20px 24px", maxWidth: 900, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 6px", color: "#111827" }}>
          📄 SEO Content Brief Studio
        </h1>
        <p style={{ margin: 0, color: "#6B7280", fontSize: ".88rem" }}>
          Enter a keyword — we&apos;ll analyse the top 10 ranking pages, surface semantically related keywords, and generate a complete content brief.
        </p>
      </div>

      {/* Input row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="e.g. content marketing strategy"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && generate()}
          style={{ flex: 1, padding: "10px 14px", border: "1px solid #D1D5DB", borderRadius: 8,
            fontSize: ".9rem", outline: "none" }}
        />
        <button onClick={generate} disabled={loading || !keyword.trim()}
          style={{ padding: "10px 22px", background: loading ? "#E5E7EB" : "#2563EB",
            color: loading ? "#9CA3AF" : "#fff", border: "none", borderRadius: 8,
            fontWeight: 700, fontSize: ".88rem", cursor: loading || !keyword.trim() ? "not-allowed" : "pointer",
            whiteSpace: "nowrap" }}>
          {loading ? "⏳ Generating…" : "✨ Generate Brief"}
        </button>
        <button onClick={() => { loadHistory(); }}
          style={{ padding: "10px 14px", background: "#F9FAFB", color: "#374151",
            border: "1px solid #E5E7EB", borderRadius: 8, fontSize: ".82rem", cursor: "pointer" }}>
          🕐 History
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8,
          padding: "10px 16px", color: "#DC2626", fontSize: ".85rem", marginBottom: 14 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
          padding: "40px 24px", textAlign: "center", color: "#6B7280" }}>
          <div style={{ fontSize: "2rem", marginBottom: 10 }}>⏳</div>
          <div style={{ fontWeight: 600, color: "#374151", marginBottom: 6 }}>Analysing top-ranking pages…</div>
          <div style={{ fontSize: ".82rem" }}>
            Fetching SERP results, scraping competitor pages, and generating your brief.
            This takes 20–40 seconds.
          </div>
        </div>
      )}

      {/* History panel */}
      {historyLoaded && !run && !loading && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
          padding: "16px 20px", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: ".88rem", color: "#111827", marginBottom: 10 }}>
            Recent briefs
          </div>
          {history.length === 0 ? (
            <div style={{ color: "#9CA3AF", fontSize: ".85rem" }}>No briefs yet — generate one above.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {history.map(h => (
                <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB" }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: ".85rem", color: "#111827",
                      cursor: "pointer", textDecoration: "underline" }}
                      onClick={() => loadRun(h.id)}>{h.keyword}</span>
                    <span style={{ marginLeft: 8, fontSize: ".74rem", color: "#9CA3AF" }}>
                      {new Date(h.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <button onClick={() => deleteRun(h.id)}
                    style={{ fontSize: ".72rem", padding: "2px 8px", background: "none",
                      border: "1px solid #FCA5A5", color: "#DC2626", borderRadius: 6, cursor: "pointer" }}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {run && !loading && (
        <>
          {/* Result header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1rem", color: "#111827" }}>
                &ldquo;{run.keyword}&rdquo;
              </div>
              <div style={{ fontSize: ".78rem", color: "#6B7280", marginTop: 2 }}>
                {run.competitor_pages.length} pages scraped ·{" "}
                {run.avg_word_count > 0 ? `competitors avg ${run.avg_word_count.toLocaleString()} words` : "no word count data"} ·{" "}
                {run.related_keywords.length} related keywords
                {b?.source === "template" && (
                  <span style={{ marginLeft: 8, padding: "1px 6px", background: "#FEF3C7",
                    color: "#92400E", borderRadius: 99, fontSize: ".72rem" }}>template fallback</span>
                )}
              </div>
            </div>
            <button onClick={copyBrief}
              style={{ padding: "7px 16px", background: copied ? "#D1FAE5" : "#F9FAFB",
                color: copied ? "#065F46" : "#374151", border: "1px solid #E5E7EB", borderRadius: 8,
                fontSize: ".82rem", fontWeight: 600, cursor: "pointer" }}>
              {copied ? "✅ Copied!" : "📋 Copy brief"}
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
            {(["brief", "keywords", "competitors"] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                style={{ padding: "7px 16px", borderRadius: 8, border: "none", fontWeight: 600,
                  fontSize: ".82rem", cursor: "pointer",
                  background: activeTab === t ? "#2563EB" : "#F3F4F6",
                  color: activeTab === t ? "#fff" : "#374151" }}>
                {t === "brief" ? "📄 Brief" : t === "keywords" ? `🔑 Keywords (${run.related_keywords.length})` : `🏁 Competitors (${run.competitor_pages.length})`}
              </button>
            ))}
          </div>

          {/* ── Brief tab ──────────────────────────────────────────────── */}
          {activeTab === "brief" && b && (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

              {/* Key meta */}
              <Section title="📌 Core meta">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: ".72rem", color: "#6B7280", textTransform: "uppercase",
                      letterSpacing: ".05em", marginBottom: 4 }}>H1 Title</div>
                    <div style={{ fontWeight: 600, color: "#111827", fontSize: ".88rem" }}>{b.title || "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: ".72rem", color: "#6B7280", textTransform: "uppercase",
                      letterSpacing: ".05em", marginBottom: 4 }}>Target word count</div>
                    <div style={{ fontWeight: 700, color: "#2563EB", fontSize: "1.1rem" }}>
                      {b.target_word_count?.toLocaleString() ?? "—"}
                    </div>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: ".72rem", color: "#6B7280", textTransform: "uppercase",
                      letterSpacing: ".05em", marginBottom: 4 }}>SEO Title tag</div>
                    <div style={{ color: "#374151", fontSize: ".85rem" }}>{b.seo_title || "—"}</div>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: ".72rem", color: "#6B7280", textTransform: "uppercase",
                      letterSpacing: ".05em", marginBottom: 4 }}>Meta description</div>
                    <div style={{ color: "#374151", fontSize: ".85rem" }}>{b.meta_description || "—"}</div>
                  </div>
                </div>
              </Section>

              {/* Headings */}
              <Section title="📑 Suggested heading structure">
                <ol style={{ margin: 0, padding: "0 0 0 20px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {(b.headings || []).map((h, i) => (
                    <li key={i} style={{ color: "#374151", fontSize: ".88rem" }}>{h}</li>
                  ))}
                </ol>
              </Section>

              {/* Two-column: topics + questions */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <Section title="📚 Topics to cover">
                  <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 5 }}>
                    {(b.must_cover_topics || []).map((t, i) => (
                      <li key={i} style={{ color: "#374151", fontSize: ".85rem" }}>{t}</li>
                    ))}
                  </ul>
                </Section>
                <Section title="❓ Questions to answer">
                  <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 5 }}>
                    {(b.questions_to_answer || []).map((q, i) => (
                      <li key={i} style={{ color: "#374151", fontSize: ".85rem" }}>{q}</li>
                    ))}
                  </ul>
                </Section>
              </div>

              {/* Entities */}
              {b.entities && b.entities.length > 0 && (
                <Section title="🏷️ Entities &amp; concepts to mention">
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {b.entities.map((e, i) => (
                      <Pill key={i} color="#F0FDF4" text="#166534">{e}</Pill>
                    ))}
                  </div>
                </Section>
              )}

              {/* Unique angle */}
              {b.unique_angle && (
                <Section title="🎯 Unique angle to outrank competitors">
                  <div style={{ color: "#374151", fontSize: ".88rem", lineHeight: 1.6 }}>{b.unique_angle}</div>
                </Section>
              )}

              {/* Recommendations */}
              <Section title="✅ Actionable recommendations">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(b.recommendations || []).map((r, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start",
                      padding: "8px 12px", background: "#F0FDF4", borderRadius: 8,
                      border: "1px solid #BBF7D0" }}>
                      <span style={{ color: "#16A34A", fontWeight: 700, fontSize: ".85rem", flexShrink: 0 }}>✓</span>
                      <span style={{ color: "#374151", fontSize: ".85rem" }}>{r}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          )}

          {/* ── Keywords tab ───────────────────────────────────────────── */}
          {activeTab === "keywords" && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "16px 20px" }}>
              <div style={{ fontWeight: 700, fontSize: ".88rem", color: "#111827", marginBottom: 4 }}>
                Semantically related keywords
              </div>
              <div style={{ fontSize: ".78rem", color: "#6B7280", marginBottom: 12 }}>
                NLP-identified keywords, entities, and questions related to &ldquo;{run.keyword}&rdquo;
              </div>
              {run.related_keywords.length === 0 ? (
                <div style={{ color: "#9CA3AF", fontSize: ".85rem", padding: "20px 0" }}>
                  No related keywords found — DataForSEO may not have data for this keyword/region.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
                    <thead>
                      <tr style={{ background: "#F9FAFB", borderBottom: "2px solid #E5E7EB" }}>
                        {["Keyword", "Monthly Searches", "Difficulty", "Relevance"].map(h => (
                          <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 600,
                            color: "#374151", fontSize: ".76rem", textTransform: "uppercase", letterSpacing: ".04em" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {run.related_keywords.map((kw, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #F3F4F6",
                          background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                          <td style={{ padding: "8px 12px", color: "#111827", fontWeight: 500 }}>
                            {kw.keyword}
                          </td>
                          <td style={{ padding: "8px 12px", color: "#374151" }}>
                            {kw.search_volume != null ? kw.search_volume.toLocaleString() : <span style={{ color: "#9CA3AF" }}>—</span>}
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            {kw.difficulty != null ? (
                              <span style={{
                                padding: "2px 8px", borderRadius: 99, fontSize: ".76rem", fontWeight: 600,
                                background: kw.difficulty > 70 ? "#FEE2E2" : kw.difficulty > 40 ? "#FEF3C7" : "#D1FAE5",
                                color: kw.difficulty > 70 ? "#DC2626" : kw.difficulty > 40 ? "#92400E" : "#065F46",
                              }}>
                                {kw.difficulty}
                              </span>
                            ) : <span style={{ color: "#9CA3AF" }}>—</span>}
                          </td>
                          <td style={{ padding: "8px 12px", color: "#6B7280", fontSize: ".8rem" }}>
                            {kw.relevance != null ? `${(kw.relevance * 100).toFixed(0)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Competitors tab ────────────────────────────────────────── */}
          {activeTab === "competitors" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Metrics summary */}
              {run.competitor_pages.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "16px 20px" }}>
                  <div style={{ fontWeight: 700, fontSize: ".88rem", color: "#111827", marginBottom: 12 }}>
                    Content benchmarks (top {run.competitor_pages.length} pages)
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    {[
                      { label: "Avg word count", value: run.avg_word_count > 0 ? run.avg_word_count.toLocaleString() : "—" },
                      { label: "Your target", value: b?.target_word_count ? `${b.target_word_count.toLocaleString()} ↑` : "—", highlight: true },
                      { label: "Avg headings", value: run.competitor_pages.length > 0
                          ? Math.round(run.competitor_pages.reduce((s, p) => s + (p.headings?.length || 0), 0) / run.competitor_pages.length)
                          : "—" },
                    ].map(stat => (
                      <div key={stat.label} style={{ padding: "12px 16px", background: stat.highlight ? "#EFF6FF" : "#F9FAFB",
                        borderRadius: 8, border: `1px solid ${stat.highlight ? "#BFDBFE" : "#E5E7EB"}` }}>
                        <div style={{ fontSize: ".72rem", color: "#6B7280", textTransform: "uppercase",
                          letterSpacing: ".05em", marginBottom: 4 }}>{stat.label}</div>
                        <div style={{ fontSize: "1.3rem", fontWeight: 700,
                          color: stat.highlight ? "#2563EB" : "#111827" }}>{String(stat.value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Competitor pages */}
              {run.competitor_pages.length === 0 ? (
                <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
                  padding: "30px 24px", textAlign: "center", color: "#9CA3AF" }}>
                  <div style={{ fontSize: "2rem", marginBottom: 8 }}>🕸️</div>
                  Competitor pages could not be scraped — Firecrawl may not be configured.
                </div>
              ) : (
                run.competitor_pages.map((p, i) => (
                  <div key={i} style={{ background: "#fff", border: "1px solid #E5E7EB",
                    borderRadius: 10, padding: "16px 20px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                      marginBottom: 10, gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ background: "#F3F4F6", color: "#374151", fontWeight: 700,
                            fontSize: ".76rem", padding: "1px 7px", borderRadius: 99 }}>#{i + 1}</span>
                          <a href={p.url} target="_blank" rel="noreferrer"
                            style={{ color: "#2563EB", fontSize: ".85rem", fontWeight: 600,
                              textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis",
                              whiteSpace: "nowrap", display: "block", maxWidth: 480 }}>
                            {p.title || p.url}
                          </a>
                        </div>
                        {p.meta && (
                          <div style={{ fontSize: ".78rem", color: "#6B7280", lineHeight: 1.5 }}>{p.meta}</div>
                        )}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#111827" }}>
                          {p.words?.toLocaleString() ?? "—"}
                        </div>
                        <div style={{ fontSize: ".72rem", color: "#6B7280" }}>words</div>
                      </div>
                    </div>
                    {p.headings && p.headings.length > 0 && (
                      <div>
                        <div style={{ fontSize: ".72rem", color: "#9CA3AF", textTransform: "uppercase",
                          letterSpacing: ".05em", marginBottom: 6 }}>Headings ({p.headings.length})</div>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {p.headings.slice(0, 10).map((h, hi) => (
                            <Pill key={hi} color="#F3F4F6" text="#374151">{h}</Pill>
                          ))}
                          {p.headings.length > 10 && (
                            <Pill color="#F3F4F6" text="#9CA3AF">+{p.headings.length - 10} more</Pill>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* SERP overview */}
              {run.serp_snapshot.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "16px 20px" }}>
                  <div style={{ fontWeight: 700, fontSize: ".88rem", color: "#111827", marginBottom: 10 }}>
                    🔍 Full SERP snapshot (top {run.serp_snapshot.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {run.serp_snapshot.map(p => (
                      <div key={p.rank} style={{ display: "flex", gap: 10, padding: "8px 0",
                        borderBottom: "1px solid #F3F4F6" }}>
                        <span style={{ color: "#9CA3AF", fontSize: ".78rem", fontWeight: 700,
                          minWidth: 22, flexShrink: 0 }}>#{p.rank}</span>
                        <div>
                          <a href={p.url} target="_blank" rel="noreferrer"
                            style={{ color: "#1D4ED8", fontSize: ".85rem", fontWeight: 500,
                              textDecoration: "none" }}>
                            {p.title || p.url}
                          </a>
                          {p.description && (
                            <div style={{ fontSize: ".75rem", color: "#6B7280", marginTop: 2 }}>{p.description}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!run && !loading && !historyLoaded && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
          padding: "40px 24px", textAlign: "center", color: "#9CA3AF" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📄</div>
          <div style={{ fontWeight: 600, color: "#374151", marginBottom: 6 }}>Generate your first SEO content brief</div>
          <div style={{ fontSize: ".85rem", maxWidth: 420, margin: "0 auto" }}>
            Enter a target keyword above and we&apos;ll scrape the top-ranking pages, identify related keywords,
            and generate a complete brief — headings, topics, word count targets, and actionable recommendations.
          </div>
        </div>
      )}
    </div>
  );
}

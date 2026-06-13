"use client";

// Native React port of the legacy `hashtag-intel` panel (was
// `window.buildHashtagIntel` + its `_hi*` helpers + `#view-hashtag-intel` /
// `#hiWrap` in public/js/ig_intel_pack_b.js). Researches top-performing
// Instagram/TikTok hashtags for any topic, clustered by strategy, against the
// existing Express API (`/api/hashtag-intel/*`, `/api/studio/ai-suggest`) via
// `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

interface Hashtag {
  tag?: string;
  volume?: string;
  competition?: string;
  trend?: string;
  whyItWorks?: string;
}

interface Cluster {
  name?: string;
  type?: string;
  hashtags?: string[];
  strategy?: string;
}

interface Run {
  id: string | number;
  platform: string;
  seed_keyword: string;
  total_count?: number;
  clusters?: Cluster[];
  created_at: string;
}

interface Current {
  seedKeyword: string;
  platform: string;
  hashtags: Hashtag[];
  clusters: Cluster[];
}

const VOL_COLOR: Record<string, string> = { very_high: "#DC2626", high: "#F97316", medium: "#0EA5E9", low: "#8B5CF6" };
const CMP_COLOR: Record<string, string> = { very_high: "#991B1B", high: "#B45309", medium: "#0369A1", low: "#047857" };
const TRD_ICON: Record<string, string> = { viral: "🔥", growing: "📈", stable: "➡️", declining: "📉" };
const PLAT_GRAD: Record<string, string> = {
  instagram: "linear-gradient(135deg,#E1306C,#F77737,#FCAF45)",
  tiktok: "linear-gradient(135deg,#010101,#25F4EE,#FE2C55)",
};
const VOL_RANK: Record<string, number> = { very_high: 4, high: 3, medium: 2, low: 1 };
const TRD_RANK: Record<string, number> = { viral: 4, growing: 3, stable: 2, declining: 1 };

function sortVal(h: Hashtag, col: string): number | string {
  if (col === "tag") return (h.tag || "").toLowerCase();
  if (col === "volume") return VOL_RANK[(h.volume || "").toLowerCase()] || 0;
  if (col === "competition") return VOL_RANK[(h.competition || "").toLowerCase()] || 0;
  if (col === "trend") return TRD_RANK[(h.trend || "").toLowerCase()] || 0;
  return 0;
}

export default function HashtagIntel() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<number>(1);
  const [selectedPlatform, setSelectedPlatform] = useState("instagram");
  const [keyword, setKeyword] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [outError, setOutError] = useState<string | null>(null);

  async function loadRuns() {
    const r = await apiGet<{ runs?: Run[] }>("/api/hashtag-intel/runs");
    setRuns(r.runs || []);
  }

  useEffect(() => {
    loadRuns();
  }, []);

  function copy(text: string, label?: string) {
    navigator.clipboard.writeText(text).then(() => showToast("📋 " + (label || "Copied!")));
  }

  async function loadRun(id: string | number) {
    setOutError(null);
    setLoading(true);
    const r = await apiGet<{ ok: boolean; error?: string; run: Run & { hashtags?: Hashtag[]; clusters?: Cluster[] } }>(
      "/api/hashtag-intel/runs/" + id,
    );
    setLoading(false);
    if (!r.ok) {
      setOutError(r.error || "failed");
      return;
    }
    renderResult(r.run.seed_keyword, r.run.platform, r.run.hashtags || [], r.run.clusters || []);
  }

  async function delRun(id: string | number) {
    if (!confirm("Delete this run?")) return;
    await apiDelete("/api/hashtag-intel/runs/" + id);
    setRuns((prev) => prev.filter((r) => String(r.id) !== String(id)));
  }

  function renderResult(seedKeyword: string, platform: string, hashtags: Hashtag[], clusters: Cluster[]) {
    setSortCol(null);
    setSortDir(1);
    setCurrent({
      seedKeyword,
      platform,
      hashtags: Array.isArray(hashtags) ? hashtags : [],
      clusters: Array.isArray(clusters) ? clusters : [],
    });
  }

  function sortTable(col: string) {
    if (sortCol === col) setSortDir((d) => d * -1);
    else {
      setSortCol(col);
      setSortDir(-1);
    }
  }

  async function aiSuggest() {
    setSuggesting(true);
    const platLabel = selectedPlatform === "tiktok" ? "TikTok" : "Instagram";
    const r = await apiPost<{ ok: boolean; result?: string }>("/api/studio/ai-suggest", {
      fieldLabel: `${platLabel} hashtag research seed keyword`,
      fieldPlaceholder: "e.g. skincare routine, personal finance, fitness motivation",
      context: `Social media hashtag intelligence tool for ${platLabel}. Suggest 5 specific, high-potential seed keyword topics the user might want to research hashtags for. Return a JSON array of 5 short topic strings (2-4 words each). Example: ["skincare routine", "morning workout", "meal prep ideas", "passive income", "travel hacks"]`,
      format: "json_array",
    });
    let parsed: string[] = [];
    if (r.ok && r.result) {
      try {
        parsed = JSON.parse(r.result);
      } catch {
        const m = String(r.result).match(/\[[\s\S]*\]/);
        if (m) {
          try {
            parsed = JSON.parse(m[0]);
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (!Array.isArray(parsed) || !parsed.length) {
      parsed = ["skincare routine", "morning workout", "meal prep ideas", "passive income", "travel hacks"];
    }
    setSuggestions(parsed.slice(0, 6).map((s) => String(s).slice(0, 80)));
    setSuggesting(false);
  }

  async function research() {
    const seedKeyword = keyword.trim();
    if (!seedKeyword) {
      setOutError("⚠ Topic / keyword is required");
      setCurrent(null);
      return;
    }
    setOutError(null);
    setCurrent(null);
    setLoading(true);
    const r = await apiPost<{ ok: boolean; error?: string; seedKeyword: string; platform: string; hashtags?: Hashtag[]; clusters?: Cluster[] }>(
      "/api/hashtag-intel/research",
      { seedKeyword, platform: selectedPlatform },
    );
    setLoading(false);
    if (!r.ok) {
      setOutError(r.error || "failed");
      return;
    }
    renderResult(r.seedKeyword, r.platform, r.hashtags || [], r.clusters || []);
    loadRuns();
  }

  const sortedHashtags = (() => {
    if (!current) return [];
    if (!sortCol) return current.hashtags;
    return [...current.hashtags].sort((a, b) => {
      const av = sortVal(a, sortCol);
      const bv = sortVal(b, sortCol);
      return av < bv ? sortDir : av > bv ? -sortDir : 0;
    });
  })();

  const allTags = current ? current.hashtags.map((h) => h.tag || "").filter(Boolean) : [];
  const platLabel = current ? (current.platform === "tiktok" ? "TikTok" : "Instagram") : "";
  const platIcon = current ? (current.platform === "tiktok" ? "🎵" : "📷") : "";
  const platGrad = current ? PLAT_GRAD[current.platform] || PLAT_GRAD.instagram : "";

  const sortInd = (col: string) => (sortCol === col ? (sortDir === -1 ? " ▼" : " ▲") : " ⇅");
  const thStyle: React.CSSProperties = {
    padding: "8px 10px",
    textAlign: "left",
    color: "#6B7280",
    fontWeight: 700,
    fontSize: "0.72rem",
    textTransform: "uppercase",
    cursor: "pointer",
    userSelect: "none",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> Hashtag Intelligence
              </div>
              <h2 className="view-title">🏷️ Hashtag Intelligence</h2>
              <p className="view-sub">
                Research the top-performing Instagram and TikTok hashtags for any topic — clustered by strategy so you
                know exactly which tags to use on each post.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 18, marginBottom: 18 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 6 }}>
              PLATFORM
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["instagram", "tiktok"] as const).map((plat) => {
                const active = selectedPlatform === plat;
                const isInsta = plat === "instagram";
                return (
                  <button
                    key={plat}
                    onClick={() => setSelectedPlatform(plat)}
                    style={{
                      padding: "7px 18px",
                      borderRadius: 20,
                      border: `2px solid ${active ? (isInsta ? "#E1306C" : "#25F4EE") : "#D1D5DB"}`,
                      background: active
                        ? isInsta
                          ? "linear-gradient(135deg,#E1306C,#F77737)"
                          : "linear-gradient(135deg,#010101,#25F4EE,#FE2C55)"
                        : "#F9FAFB",
                      color: active ? "#fff" : "#374151",
                      fontWeight: 700,
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    {isInsta ? "📷 Instagram" : "🎵 TikTok"}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
              <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "#6B7280" }}>TOPIC / SEED KEYWORD *</label>
              <button
                onClick={aiSuggest}
                disabled={suggesting}
                style={{
                  padding: "3px 10px",
                  background: "linear-gradient(135deg,#7C3AED,#0EA5E9)",
                  border: "none",
                  borderRadius: 5,
                  color: "#fff",
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {suggesting ? "⏳ Thinking…" : "🧠 AI Suggest"}
              </button>
            </div>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") research();
              }}
              placeholder="e.g. skincare routine, personal finance, fitness motivation"
              style={{ width: "100%", padding: 8, border: "1px solid #D1D5DB", borderRadius: 5, fontSize: "0.84rem", boxSizing: "border-box" }}
            />
            {suggestions.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setKeyword(s);
                      setSuggestions([]);
                    }}
                    style={{
                      padding: "4px 12px",
                      background: "#EDE9FE",
                      color: "#7C3AED",
                      border: "1px solid #DDD6FE",
                      borderRadius: 12,
                      fontSize: "0.74rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={research}
            style={{
              width: "100%",
              background: "linear-gradient(135deg,#4F46E5,#7C3AED)",
              color: "#fff",
              border: "none",
              padding: "10px 20px",
              borderRadius: 6,
              fontSize: "0.84rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            🏷️ Research Hashtags
          </button>
          <div style={{ fontSize: "0.74rem", color: "#6B7280", marginTop: 8 }}>
            Powered by Perplexity Sonar · AI-researched from real platform data · 20-40s per run
          </div>
        </div>

        <div>
          {loading && (
            <div style={{ textAlign: "center", padding: 40, background: "#F8FAFC", borderRadius: 12, color: "#64748B" }}>
              <div style={{ fontSize: "1.8rem", marginBottom: 10 }}>⏳</div>
              <div style={{ fontSize: "0.85rem" }}>
                Researching {selectedPlatform === "tiktok" ? "TikTok" : "Instagram"} hashtags for &quot;
                <strong>{keyword.trim()}</strong>&quot;…
                <br />
                <span style={{ opacity: 0.7 }}>Powered by Perplexity Sonar · 20-40s</span>
              </div>
            </div>
          )}
          {outError && (
            <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10 }}>⚠ {outError}</div>
          )}
          {current && !loading && (
            <>
              <div style={{ background: platGrad, color: "#fff", borderRadius: 12, padding: "18px 22px", marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: "0.74rem", fontWeight: 700, opacity: 0.85, textTransform: "uppercase", marginBottom: 4 }}>
                      {platIcon} {platLabel} · Hashtag Research
                    </div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{current.seedKeyword}</div>
                  </div>
                  <div style={{ display: "flex", gap: 14, textAlign: "center" }}>
                    <div>
                      <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>{allTags.length}</div>
                      <div style={{ fontSize: "0.7rem", opacity: 0.85, fontWeight: 700 }}>HASHTAGS</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>{current.clusters.length}</div>
                      <div style={{ fontSize: "0.7rem", opacity: 0.85, fontWeight: 700 }}>CLUSTERS</div>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => copy(allTags.join(" "), allTags.length + " hashtags copied!")}
                    style={{
                      padding: "6px 14px",
                      background: "rgba(255,255,255,0.2)",
                      border: "1.5px solid rgba(255,255,255,0.5)",
                      borderRadius: 6,
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: "0.8rem",
                      cursor: "pointer",
                    }}
                  >
                    📋 Copy all {allTags.length} tags
                  </button>
                  <button
                    onClick={() => copy(allTags.slice(0, 30).join(" "), "Caption hashtag block copied!")}
                    style={{
                      padding: "6px 14px",
                      background: "rgba(255,255,255,0.2)",
                      border: "1.5px solid rgba(255,255,255,0.5)",
                      borderRadius: 6,
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: "0.8rem",
                      cursor: "pointer",
                    }}
                  >
                    ✍️ Caption-ready (top 30)
                  </button>
                </div>
              </div>

              <h3 style={{ color: "#0A1628", fontSize: "1rem", margin: "0 0 12px", fontWeight: 800 }}>🎯 Strategic Clusters</h3>
              <div>
                {current.clusters.length ? (
                  current.clusters.map((cl, i) => (
                    <div
                      key={i}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderLeft: "4px solid #6366F1",
                        borderRadius: 10,
                        padding: "14px 16px",
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
                        <div>
                          <strong style={{ color: "#0A1628", fontSize: "0.96rem" }}>
                            {i + 1}. {cl.name || "Cluster"}
                          </strong>
                          <span
                            style={{
                              background: "#6366F1",
                              color: "#fff",
                              padding: "2px 8px",
                              borderRadius: 10,
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              marginLeft: 8,
                            }}
                          >
                            {cl.type || ""}
                          </span>
                        </div>
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        {(cl.hashtags || []).map((t, ti) => (
                          <span
                            key={ti}
                            onClick={() => copy(t, "Tag copied!")}
                            title="Click to copy"
                            style={{
                              display: "inline-block",
                              background: "#EFF6FF",
                              color: "#1D4ED8",
                              border: "1px solid #BFDBFE",
                              padding: "3px 10px",
                              borderRadius: 14,
                              fontSize: "0.74rem",
                              fontWeight: 700,
                              margin: 3,
                              cursor: "pointer",
                            }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                      {cl.strategy ? (
                        <div
                          style={{
                            background: "#FEF3C7",
                            borderLeft: "3px solid #F59E0B",
                            padding: "7px 12px",
                            borderRadius: 4,
                            fontSize: "0.8rem",
                            color: "#78350F",
                          }}
                        >
                          <strong>💡 Strategy:</strong> {cl.strategy}
                        </div>
                      ) : null}
                      <div style={{ marginTop: 8 }}>
                        <button
                          onClick={() => copy((cl.hashtags || []).join(" "), (cl.hashtags || []).length + " tags copied!")}
                          style={{
                            padding: "4px 12px",
                            background: "#F3F4F6",
                            border: "1px solid #D1D5DB",
                            borderRadius: 5,
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            color: "#374151",
                            cursor: "pointer",
                          }}
                        >
                          📋 Copy {(cl.hashtags || []).length} tags
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "#9CA3AF" }}>No clusters generated.</div>
                )}
              </div>

              <h3 style={{ color: "#0A1628", fontSize: "1rem", margin: "20px 0 10px", fontWeight: 800 }}>
                📋 All Hashtags ({allTags.length}){" "}
                <span style={{ fontSize: "0.72rem", fontWeight: 400, color: "#9CA3AF" }}>
                  — click column headers to sort · click tag to copy
                </span>
              </h3>
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, overflow: "auto", marginBottom: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ background: "#F9FAFB", borderBottom: "2px solid #E5E7EB" }}>
                      <th style={thStyle} onClick={() => sortTable("tag")}>
                        Hashtag<span>{sortInd("tag")}</span>
                      </th>
                      <th style={thStyle} onClick={() => sortTable("volume")}>
                        Volume<span>{sortInd("volume")}</span>
                      </th>
                      <th style={thStyle} onClick={() => sortTable("competition")}>
                        Competition<span>{sortInd("competition")}</span>
                      </th>
                      <th style={thStyle} onClick={() => sortTable("trend")}>
                        Trend<span>{sortInd("trend")}</span>
                      </th>
                      <th style={{ ...thStyle, cursor: "default" }}>Why It Works</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHashtags.length ? (
                      sortedHashtags.map((h, i) => {
                        const tag = h.tag || "";
                        const vol = (h.volume || "medium").toLowerCase();
                        const cmp = (h.competition || "medium").toLowerCase();
                        const trd = (h.trend || "stable").toLowerCase();
                        const why = h.whyItWorks || "";
                        const vc = VOL_COLOR[vol] || "#9CA3AF";
                        const cc = CMP_COLOR[cmp] || "#9CA3AF";
                        const ti = TRD_ICON[trd] || "➡️";
                        return (
                          <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                            <td
                              onClick={() => copy(tag, "Tag copied!")}
                              style={{
                                padding: "7px 10px",
                                fontWeight: 700,
                                color: "#1D4ED8",
                                fontSize: "0.82rem",
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {tag}
                            </td>
                            <td style={{ padding: "7px 10px" }}>
                              <span style={{ background: `${vc}22`, color: vc, padding: "2px 8px", borderRadius: 10, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase" }}>
                                {vol}
                              </span>
                            </td>
                            <td style={{ padding: "7px 10px" }}>
                              <span style={{ background: `${cc}22`, color: cc, padding: "2px 8px", borderRadius: 10, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase" }}>
                                {cmp}
                              </span>
                            </td>
                            <td style={{ padding: "7px 10px", textAlign: "center" }}>{ti}</td>
                            <td style={{ padding: "7px 10px", color: "#6B7280", fontSize: "0.75rem", maxWidth: 240 }}>
                              {why.slice(0, 120)}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={5} style={{ padding: 14, color: "#9CA3AF" }}>
                          No hashtags.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <h3 style={{ margin: "24px 0 8px", color: "#0A1628", fontSize: "0.96rem", fontWeight: 800 }}>📚 Recent Runs</h3>
        <div>
          {!runs.length ? (
            <div style={{ color: "#9CA3AF", fontSize: "0.8rem" }}>No runs yet.</div>
          ) : (
            runs.slice(0, 20).map((r) => {
              const platIc = r.platform === "tiktok" ? "🎵" : "📷";
              const clusters = Array.isArray(r.clusters) ? r.clusters : [];
              return (
                <div
                  key={r.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 8,
                    padding: "10px 14px",
                    marginBottom: 6,
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", marginRight: 8 }}>
                      {platIc} {r.platform.toUpperCase()}
                    </span>
                    <strong style={{ color: "#0A1628" }}>{r.seed_keyword}</strong>
                    <span style={{ color: "#9CA3AF", fontSize: "0.74rem", marginLeft: 8 }}>
                      {r.total_count || 0} tags · {clusters.length} clusters
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#9CA3AF", fontSize: "0.72rem" }}>{new Date(r.created_at).toLocaleDateString()}</span>
                    <button
                      onClick={() => loadRun(r.id)}
                      style={{
                        padding: "4px 12px",
                        background: "#EFF6FF",
                        border: "1px solid #BFDBFE",
                        borderRadius: 5,
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        color: "#1D4ED8",
                        cursor: "pointer",
                      }}
                    >
                      Load
                    </button>
                    <button
                      onClick={() => delRun(r.id)}
                      style={{
                        padding: "4px 10px",
                        background: "#FEE2E2",
                        border: "1px solid #FECACA",
                        borderRadius: 5,
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        color: "#B91C1C",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

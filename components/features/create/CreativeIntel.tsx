"use client";

// Native React port of the legacy `creative-intel` panel (was
// `window.buildCreativeIntel` in `public/js/ig_intel_pack_b.js` +
// `#view-creative-intel` in index.html). Analyses competitor short-form video
// URLs via the existing Express API (`GET/POST /api/creative-intel/analyze`,
// `GET /api/creative-intel/runs`, `GET/DELETE /api/creative-intel/runs/:id`)
// through `lib/api`, and hands off to the Video Script Generator via `lib/nav`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

const PLATFORM_COLORS: Record<string, string> = {
  TikTok: "#FF0050",
  "YouTube Shorts": "#FF0000",
  "Instagram Reels": "#C13584",
  Instagram: "#C13584",
  YouTube: "#FF0000",
  Unknown: "#6B7280",
};
const HOOK_LABELS: Record<string, string> = {
  curiosity_gap: "Curiosity Gap",
  bold_claim: "Bold Claim",
  question: "Question Hook",
  listicle: "Listicle",
  controversy: "Controversy",
  story: "Story",
  how_to: "How-To",
  social_proof: "Social Proof",
};
const EMOTION_LABELS: Record<string, string> = {
  excitement: "Excitement",
  fear_of_missing_out: "FOMO",
  curiosity: "Curiosity",
  inspiration: "Inspiration",
  humour: "Humour",
  relatability: "Relatability",
  urgency: "Urgency",
};
const MUSIC_LABELS: Record<string, string> = {
  trending_audio: "Trending Audio",
  voiceover_only: "Voiceover Only",
  original_music: "Original Music",
  silence: "Silence / SFX",
  royalty_free: "Royalty Free",
};

interface VideoAnalysis {
  platform?: string;
  engagement_rate?: number | null;
  title?: string;
  creator?: string;
  views?: number | null;
  likes?: number | null;
  duration_sec?: number | null;
  hook_type?: string;
  emotion_trigger?: string;
  has_text_overlay?: boolean;
  cta_present?: boolean;
  music_type?: string;
  caption?: string;
}
interface PatternItem {
  value: string;
  pct: number;
  label?: string;
}
interface LengthItem {
  label?: string;
  value?: string;
  pct: number;
}
interface Patterns {
  avg_engagement_rate?: number | string;
  optimal_length_range?: string;
  text_overlay_pct?: number;
  cta_pct?: number;
  winning_formula?: string[];
  hook_styles?: PatternItem[];
  emotion_triggers?: PatternItem[];
  music_types?: PatternItem[];
  length_buckets?: LengthItem[];
}
interface Run {
  id: number | string;
  urls?: string[];
  url_count?: number;
  patterns?: Patterns;
  created_at?: string;
}
interface RunsResult {
  ok?: boolean;
  runs?: Run[];
}
interface AnalyzeResult {
  ok: boolean;
  error?: string;
  analyses?: VideoAnalysis[];
  patterns?: Patterns;
  brief?: string;
}
interface RunResult {
  ok: boolean;
  error?: string;
  run?: { analyses: VideoAnalysis[]; patterns: Patterns; brief: string };
}

interface CurrentReport {
  analyses: VideoAnalysis[];
  patterns: Patterns;
  brief: string;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function escapeHtml(s: string): string {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

function briefToHtml(brief: string): string {
  return escapeHtml(brief || "")
    .replace(
      /^##\s+(.+)$/gm,
      '<h4 style="font-size:0.88rem;font-weight:800;color:#0A1628;margin:14px 0 4px">$1</h4>',
    )
    .replace(
      /^#\s+(.+)$/gm,
      '<h3 style="font-size:1rem;font-weight:800;color:#0A1628;margin:0 0 8px">$1</h3>',
    )
    .replace(/^\*\*(.+?)\*\*/gm, "<strong>$1</strong>")
    .replace(
      /^- (.+)$/gm,
      '<div style="display:flex;gap:6px;margin-bottom:5px"><span style="color:#0EA5E9">•</span><span>$1</span></div>',
    )
    .split("\n")
    .join("<br>");
}

export default function CreativeIntel() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [urls, setUrls] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "error" | "loadingRun"
  >("idle");
  const [error, setError] = useState("");
  const [report, setReport] = useState<CurrentReport | null>(null);

  async function loadRuns() {
    const r = await apiGet<RunsResult>("/api/creative-intel/runs");
    setRuns(r.runs || []);
  }

  useEffect(() => {
    loadRuns();
  }, []);

  async function analyze() {
    const list = urls
      .split(/[\r\n]+/)
      .map((s) => s.trim())
      .filter((u) => u.startsWith("http"));
    if (!list.length) {
      setStatus("error");
      setError("⚠ Paste at least one valid URL (must start with https://)");
      return;
    }
    setStatus("loading");
    setError("");
    setReport(null);
    const r = await apiPost<AnalyzeResult>("/api/creative-intel/analyze", {
      urls: list,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "Analyse failed");
      return;
    }
    setReport({
      analyses: r.analyses || [],
      patterns: r.patterns || {},
      brief: r.brief || "",
    });
    setStatus("idle");
    loadRuns();
  }

  async function loadRun(id: number | string) {
    setStatus("loadingRun");
    setReport(null);
    const r = await apiGet<RunResult>("/api/creative-intel/runs/" + id);
    if (!r.ok || !r.run) {
      setStatus("error");
      setError(r.error || "Load failed");
      return;
    }
    setReport({
      analyses: r.run.analyses || [],
      patterns: r.run.patterns || {},
      brief: r.run.brief || "",
    });
    setStatus("idle");
  }

  async function deleteRun(id: number | string) {
    if (!confirm("Delete this analysis?")) return;
    await apiDelete("/api/creative-intel/runs/" + id);
    setRuns((prev) => prev.filter((r) => String(r.id) !== String(id)));
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Creative Intel
              </div>
              <h2 className="view-title">🎬 Creative Intel</h2>
              <p className="view-sub">
                Paste competitor TikTok, YouTube Shorts or Instagram Reels URLs —
                AI analyses what makes top content perform and produces an
                actionable creative brief for your next video.
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
            padding: 18,
            marginBottom: 18,
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: "0.7rem",
              fontWeight: 700,
              color: "#6B7280",
              marginBottom: 4,
            }}
          >
            COMPETITOR VIDEO URLs (one per line, up to 20) — TikTok · YouTube
            Shorts · Instagram Reels
          </label>
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={5}
            placeholder={
              "https://www.tiktok.com/@creator/video/123...\nhttps://www.youtube.com/shorts/abc123\nhttps://www.instagram.com/reel/xyz..."
            }
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              fontSize: "0.82rem",
              fontFamily: "monospace",
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 10,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div style={{ color: "#6B7280", fontSize: "0.74rem" }}>
              Powered by Perplexity Sonar + GPT-4o-mini · 30-60s for 10+ videos
            </div>
            <button
              onClick={analyze}
              disabled={status === "loading"}
              style={{
                background: "linear-gradient(135deg,#1a1a2e,#7C3AED)",
                color: "#fff",
                border: "none",
                padding: "9px 22px",
                borderRadius: 6,
                fontSize: "0.85rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              🎬 Analyse Videos
            </button>
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                background: "#F5F3FF",
                borderRadius: 12,
                color: "#4C1D95",
              }}
            >
              <div style={{ fontSize: "1.8rem", marginBottom: 10 }}>🎬</div>
              <div style={{ fontSize: "0.85rem" }}>
                Analysing videos…
                <br />
                <span style={{ opacity: 0.7 }}>
                  Perplexity Sonar + GPT-4o-mini · 30-60s
                </span>
              </div>
            </div>
          )}
          {status === "loadingRun" && (
            <div style={{ color: "#9CA3AF" }}>⏳ Loading…</div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              ⚠ {error}
            </div>
          )}
          {status === "idle" && report && (
            <Report
              report={report}
              onHandoff={() => goToView(router, "video-script")}
            />
          )}
        </div>

        <h3
          style={{
            margin: "24px 0 8px",
            color: "#0A1628",
            fontSize: "0.96rem",
            fontWeight: 800,
          }}
        >
          📚 Recent Analyses
        </h3>
        <div>
          {!runs.length ? (
            <div style={{ color: "#9CA3AF", fontSize: "0.8rem" }}>
              No analyses yet.
            </div>
          ) : (
            runs.slice(0, 20).map((r) => {
              const urlArr = Array.isArray(r.urls) ? r.urls : [];
              const p = r.patterns || {};
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
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <strong style={{ color: "#0A1628" }}>
                      {r.url_count || urlArr.length} videos analysed
                    </strong>
                    <span
                      style={{
                        color: "#9CA3AF",
                        fontSize: "0.72rem",
                        marginLeft: 8,
                      }}
                    >
                      {p.optimal_length_range || ""} · avg{" "}
                      {p.avg_engagement_rate ?? "?"}% eng
                    </span>
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ color: "#9CA3AF", fontSize: "0.72rem" }}>
                      {r.created_at
                        ? new Date(r.created_at).toLocaleDateString()
                        : ""}
                    </span>
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
                      onClick={() => deleteRun(r.id)}
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

function PctBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          flex: 1,
          background: "#F3F4F6",
          borderRadius: 4,
          height: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, pct || 0)}%`,
            background: color || "#0EA5E9",
            height: 8,
            borderRadius: 4,
          }}
        />
      </div>
      <div
        style={{
          minWidth: 36,
          textAlign: "right",
          fontSize: "0.72rem",
          fontWeight: 700,
          color: "#374151",
        }}
      >
        {pct || 0}%
      </div>
    </div>
  );
}

function PatternBlock({
  title,
  items,
  color,
}: {
  title: string;
  items: { label: string; pct: number }[];
  color: string;
}) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: "0.72rem",
          fontWeight: 700,
          color: "#6B7280",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {items.slice(0, 5).map((it, i) => (
        <div key={i} style={{ marginBottom: 6 }}>
          <div
            style={{ fontSize: "0.76rem", color: "#374151", marginBottom: 3 }}
          >
            {it.label}
          </div>
          <PctBar pct={it.pct} color={color} />
        </div>
      ))}
    </div>
  );
}

function Report({
  report,
  onHandoff,
}: {
  report: CurrentReport;
  onHandoff: () => void;
}) {
  const { analyses: ana, patterns: p } = report;
  const hookItems = (p.hook_styles || []).map((h) => ({
    label: HOOK_LABELS[h.value] || h.value,
    pct: h.pct,
  }));
  const emotionItems = (p.emotion_triggers || []).map((e) => ({
    label: EMOTION_LABELS[e.value] || e.value,
    pct: e.pct,
  }));
  const musicItems = (p.music_types || []).map((m) => ({
    label: MUSIC_LABELS[m.value] || m.value,
    pct: m.pct,
  }));
  const lengthItems = (p.length_buckets || []).map((l) => ({
    label: l.label || l.value || "",
    pct: l.pct,
  }));
  const formula = p.winning_formula || [];

  return (
    <div>
      <div
        style={{
          background: "linear-gradient(135deg,#1a1a2e,#16213e)",
          color: "#fff",
          borderRadius: 12,
          padding: "18px 22px",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            fontSize: "0.72rem",
            fontWeight: 700,
            opacity: 0.8,
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          🎬 Creative Intelligence Report
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <Stat value={String(ana.length)} label="VIDEOS ANALYSED" />
          <Stat
            value={`${p.avg_engagement_rate ?? "—"}%`}
            label="AVG ENGAGEMENT"
          />
          <Stat value={p.optimal_length_range || "—"} label="OPTIMAL LENGTH" />
          <Stat value={`${p.text_overlay_pct || 0}%`} label="USE TEXT OVERLAY" />
          <Stat value={`${p.cta_pct || 0}%`} label="INCLUDE CTA" />
        </div>
      </div>

      <h3
        style={{
          fontSize: "0.94rem",
          fontWeight: 800,
          color: "#0A1628",
          margin: "0 0 10px",
        }}
      >
        📹 Video Breakdown ({ana.length})
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
          gap: 12,
          marginBottom: 22,
        }}
      >
        {ana.map((v, i) => (
          <VideoCard key={i} v={v} />
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 10,
            padding: 16,
          }}
        >
          <div
            style={{
              fontWeight: 800,
              color: "#0A1628",
              fontSize: "0.9rem",
              marginBottom: 14,
            }}
          >
            📊 Pattern Analysis
          </div>
          <PatternBlock title="Hook Styles" items={hookItems} color="#7C3AED" />
          <PatternBlock
            title="Emotion Triggers"
            items={emotionItems}
            color="#F59E0B"
          />
          <PatternBlock title="Music / Audio" items={musicItems} color="#0EA5E9" />
          <PatternBlock title="Video Length" items={lengthItems} color="#059669" />
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 10,
            padding: 16,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontWeight: 800,
              color: "#0A1628",
              fontSize: "0.9rem",
              marginBottom: 12,
            }}
          >
            ⚡ Winning Formula
          </div>
          <div style={{ flex: 1 }}>
            {formula.length ? (
              formula.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      color: "#F59E0B",
                      fontSize: "1rem",
                      flexShrink: 0,
                    }}
                  >
                    ⚡
                  </span>
                  <div style={{ color: "#374151", fontSize: "0.82rem" }}>{f}</div>
                </div>
              ))
            ) : (
              <div style={{ color: "#9CA3AF", fontSize: "0.8rem" }}>
                No formula generated.
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          background: "#F0F7FF",
          border: "1px solid #BFDBFE",
          borderRadius: 10,
          padding: 18,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 800, color: "#1E3A5F", fontSize: "0.94rem" }}>
            📋 Creative Brief
          </div>
          <button
            onClick={onHandoff}
            style={{
              background: "linear-gradient(135deg,#0f766e,#0284c7)",
              color: "#fff",
              border: "none",
              padding: "7px 16px",
              borderRadius: 6,
              fontSize: "0.78rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            → Open Video Script Generator
          </button>
        </div>
        <div
          style={{ color: "#1E3A5F", fontSize: "0.82rem", lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: briefToHtml(report.brief) }}
        />
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>{value}</div>
      <div style={{ fontSize: "0.68rem", opacity: 0.8, fontWeight: 700 }}>
        {label}
      </div>
    </div>
  );
}

function VideoCard({ v }: { v: VideoAnalysis }) {
  const pColor = PLATFORM_COLORS[v.platform || "Unknown"] || "#6B7280";
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 10,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            background: pColor,
            color: "#fff",
            padding: "2px 8px",
            borderRadius: 8,
            fontSize: "0.68rem",
            fontWeight: 800,
          }}
        >
          {v.platform || "Unknown"}
        </span>
        {v.engagement_rate != null && (
          <span
            style={{ color: "#059669", fontSize: "0.72rem", fontWeight: 700 }}
          >
            {v.engagement_rate}% eng
          </span>
        )}
      </div>
      <div
        style={{
          fontWeight: 700,
          color: "#0A1628",
          fontSize: "0.82rem",
          lineHeight: 1.3,
        }}
      >
        {(v.title || "Untitled").slice(0, 80)}
      </div>
      {v.creator && (
        <div style={{ color: "#6B7280", fontSize: "0.7rem" }}>
          @{v.creator.slice(0, 40)}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 4,
          textAlign: "center",
        }}
      >
        <MiniStat value={fmt(v.views)} label="VIEWS" />
        <MiniStat value={fmt(v.likes)} label="LIKES" />
        <MiniStat
          value={v.duration_sec != null ? v.duration_sec + "s" : "—"}
          label="LENGTH"
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {v.hook_type && (
          <Tag bg="#EDE9FE" color="#7C3AED">
            {HOOK_LABELS[v.hook_type] || v.hook_type}
          </Tag>
        )}
        {v.emotion_trigger && (
          <Tag bg="#FEF3C7" color="#92400E">
            {EMOTION_LABELS[v.emotion_trigger] || v.emotion_trigger}
          </Tag>
        )}
        {v.has_text_overlay && (
          <Tag bg="#DCFCE7" color="#166534">
            📝 Text Overlay
          </Tag>
        )}
        {v.cta_present && (
          <Tag bg="#FEE2E2" color="#991B1B">
            📣 CTA
          </Tag>
        )}
        {v.music_type && v.music_type !== "silence" && (
          <Tag bg="#DBEAFE" color="#1D4ED8">
            🎵 {MUSIC_LABELS[v.music_type] || v.music_type}
          </Tag>
        )}
      </div>
      {v.caption && (
        <div
          style={{
            color: "#6B7280",
            fontSize: "0.72rem",
            borderTop: "1px solid #F3F4F6",
            paddingTop: 6,
          }}
        >
          {v.caption.slice(0, 120)}
          {v.caption.length > 120 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ background: "#F9FAFB", borderRadius: 6, padding: "4px 2px" }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#374151" }}>
        {value}
      </div>
      <div style={{ fontSize: "0.6rem", color: "#9CA3AF" }}>{label}</div>
    </div>
  );
}

function Tag({
  bg,
  color,
  children,
}: {
  bg: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        padding: "2px 8px",
        background: bg,
        color,
        borderRadius: 8,
        fontSize: "0.65rem",
        fontWeight: 700,
      }}
    >
      {children}
    </span>
  );
}

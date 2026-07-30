"use client";

// Native React port of the legacy `carousel` panel (was `buildCarousel` /
// `_cgRender` / `_cgGenerate` in app.js + `#view-carousel` in index.html).
// Generates 10-slide carousels via the existing Express API
// (`GET /api/carousel/structures`, `GET /api/carousel/list`,
// `POST /api/carousel/generate`, `GET /api/carousel/:id`) through `lib/api`, and
// links to other tools via `lib/nav`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Structure {
  label: string;
  description: string;
}
type Structures = Record<string, Structure>;

interface HistoryItem {
  id: number;
  topic: string;
  structure: string;
  created_at: string;
}
interface Slide {
  n: number | string;
  role?: string;
  headline?: string;
  body?: string;
  visualHint?: string;
}
interface CarouselResult {
  ok: boolean;
  error?: string;
  id?: number;
  topic?: string;
  structure?: string;
  structureLabel?: string;
  slides?: Slide[];
  source?: string;
}
interface StructuresResult {
  ok?: boolean;
  structures?: Structures;
}
interface ListResult {
  ok?: boolean;
  items?: HistoryItem[];
}
interface LoadItem {
  id: number;
  topic: string;
  structure: string;
  slides: string | Slide[];
  meta?: string | { structureLabel?: string; source?: string };
}
interface LoadResult {
  ok: boolean;
  error?: string;
  item?: LoadItem;
}

const PALETTE = [
  "#FB7185",
  "#F97316",
  "#FACC15",
  "#34D399",
  "#10B981",
  "#06B6D4",
  "#3B82F6",
  "#6366F1",
  "#A855F7",
  "#EC4899",
];

export default function Carousel() {
  const router = useRouter();

  const [structures, setStructures] = useState<Structures>({});
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const [topic, setTopic] = useState("");
  const [structure, setStructure] = useState("pure-info");
  const [brandVoice, setBrandVoice] = useState("");
  const [audience, setAudience] = useState("");

  const [generating, setGenerating] = useState(false);
  const [outError, setOutError] = useState("");
  const [current, setCurrent] = useState<CarouselResult | null>(null);

  async function loadHistory() {
    const r = await apiGet<ListResult>("/api/carousel/list");
    setHistory(r.items || []);
  }

  useEffect(() => {
    (async () => {
      const s = await apiGet<StructuresResult>("/api/carousel/structures");
      const map = s.structures || {};
      setStructures(map);
      if (!map["pure-info"]) {
        const first = Object.keys(map)[0];
        if (first) setStructure(first);
      }
      await loadHistory();
    })();
  }, []);

  async function generate() {
    if (!topic.trim()) {
      (
        window as unknown as { showToast?: (m: string) => void }
      ).showToast?.("⚠️ Topic is required") ?? alert("⚠️ Topic is required");
      return;
    }
    setGenerating(true);
    setOutError("");
    setCurrent(null);
    const r = await apiPost<CarouselResult>("/api/carousel/generate", {
      topic: topic.trim(),
      structure,
      brandVoice: brandVoice.trim() || undefined,
      audience: audience.trim() || undefined,
    });
    if (!r.ok) {
      setOutError(r.error || "Generate failed");
      setGenerating(false);
      return;
    }
    setCurrent(r);
    setGenerating(false);
    loadHistory();
  }

  async function load(id: number) {
    const r = await apiGet<LoadResult>("/api/carousel/" + id);
    if (!r.ok || !r.item) {
      (
        window as unknown as { showToast?: (m: string) => void }
      ).showToast?.("⚠️ Could not load: " + (r.error || "")) ??
        alert("⚠️ Could not load");
      return;
    }
    const item = r.item;
    const slides: Slide[] =
      typeof item.slides === "string" ? JSON.parse(item.slides) : item.slides;
    const meta =
      typeof item.meta === "string"
        ? JSON.parse(item.meta)
        : item.meta || {};
    setCurrent({
      ok: true,
      id: item.id,
      topic: item.topic,
      structure: item.structure,
      structureLabel: meta.structureLabel || item.structure,
      slides,
      source: meta.source || "template",
    });
  }

  function copyAll() {
    if (!current?.slides) return;
    const fullCopy = current.slides
      .map(
        (s) =>
          `Slide ${s.n} (${s.role}):\n${s.headline}\n\n${s.body}\n${
            s.visualHint ? "[Visual: " + s.visualHint + "]\n" : ""
          }`,
      )
      .join("\n---\n\n");
    navigator.clipboard
      ?.writeText(fullCopy)
      .then(
        () =>
          (
            window as unknown as { showToast?: (m: string) => void }
          ).showToast?.("✅ All slide copy copied to clipboard"),
      )
      .catch(
        () =>
          (
            window as unknown as { showToast?: (m: string) => void }
          ).showToast?.("⚠️ Copy failed"),
      );
  }

  const structureEntries = useMemo(
    () => Object.entries(structures),
    [structures],
  );

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Carousel Generator
              </div>
              <h2 className="view-title">🎠 Viral Carousel Generator</h2>
              <p className="view-sub">
                Generate paste-ready 10-slide carousels for Instagram and
                LinkedIn. Pick a topic, pick a structure (Pure Info ·
                Storytelling · Problem-Solution · Listicle), and AI fills every
                slide following the proven Hook → Context → Value → Action
                framework. Hand off straight to your Social Publisher or
                designer.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background:
              "linear-gradient(135deg,#FB7185 0%,#F97316 50%,#FACC15 100%)",
            borderRadius: 18,
            padding: "24px 28px",
            color: "white",
            marginBottom: 24,
            boxShadow: "0 8px 24px rgba(251,113,133,.25)",
          }}
        >
          <div
            style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: 6 }}
          >
            🎠 How to Make a Viral Carousel
          </div>
          <div
            style={{
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              fontSize: "0.85rem",
            }}
          >
            <span>
              <b>1. Hook</b> — capture attention
            </span>
            <span style={{ opacity: 0.7 }}>→</span>
            <span>
              <b>2. Context</b> — make people care
            </span>
            <span style={{ opacity: 0.7 }}>→</span>
            <span>
              <b>3. Value</b> — deliver the goods
            </span>
            <span style={{ opacity: 0.7 }}>→</span>
            <span>
              <b>4. Action</b> — convert goodwill
            </span>
          </div>
        </div>

        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 14,
            padding: 22,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              color: "#64748B",
              letterSpacing: ".05em",
              marginBottom: 8,
            }}
          >
            STEP 1 · TOPIC
          </div>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. How small businesses can rank on Google in 2026"
            style={{
              width: "100%",
              padding: 12,
              border: "1px solid #CBD5E1",
              borderRadius: 9,
              fontSize: "0.95rem",
              boxSizing: "border-box",
              fontFamily: "inherit",
              marginBottom: 16,
            }}
          />

          <div
            style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              color: "#64748B",
              letterSpacing: ".05em",
              marginBottom: 8,
            }}
          >
            STEP 2 · STRUCTURE
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {structureEntries.map(([key, s]) => {
              const selected = structure === key;
              return (
                <label key={key} style={{ cursor: "pointer", display: "block" }}>
                  <input
                    type="radio"
                    name="cgStructure"
                    value={key}
                    checked={selected}
                    onChange={() => setStructure(key)}
                    style={{ display: "none" }}
                  />
                  <div
                    style={{
                      background: selected ? "#EFF6FF" : "white",
                      border: `2px solid ${selected ? "#0066FF" : "#E2E8F0"}`,
                      borderRadius: 12,
                      padding: 14,
                      transition: "all .2s",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 800,
                        color: "#0F172A",
                        marginBottom: 4,
                      }}
                    >
                      {s.label}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#64748B" }}>
                      {s.description}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  color: "#64748B",
                  letterSpacing: ".05em",
                  marginBottom: 6,
                }}
              >
                BRAND VOICE (optional)
              </div>
              <input
                value={brandVoice}
                onChange={(e) => setBrandVoice(e.target.value)}
                placeholder="expert, plain-spoken, no jargon"
                style={{
                  width: "100%",
                  padding: 9,
                  border: "1px solid #CBD5E1",
                  borderRadius: 8,
                  fontSize: "0.86rem",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                }}
              />
            </div>
            <div>
              <div
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  color: "#64748B",
                  letterSpacing: ".05em",
                  marginBottom: 6,
                }}
              >
                AUDIENCE (optional)
              </div>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="small business owners and marketers"
                style={{
                  width: "100%",
                  padding: 9,
                  border: "1px solid #CBD5E1",
                  borderRadius: 8,
                  fontSize: "0.86rem",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                }}
              />
            </div>
          </div>

          <button
            onClick={generate}
            disabled={generating}
            style={{
              background: "linear-gradient(135deg,#0066FF,#7C3AED)",
              color: "white",
              border: "none",
              padding: "12px 28px",
              borderRadius: 10,
              fontSize: "0.92rem",
              fontWeight: 800,
              cursor: "pointer",
              width: "100%",
            }}
          >
            {generating ? "⏳ Drafting your slides…" : "✨ Generate 10-Slide Carousel"}
          </button>
        </div>

        <div>
          {generating && (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "#64748B",
              }}
            >
              ⏳ Generating 10 slides…
            </div>
          )}
          {outError && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 12,
                padding: 18,
                color: "#991B1B",
              }}
            >
              ⚠️ {outError}
            </div>
          )}
          {current && !generating && (
            <CarouselResultView
              r={current}
              onCopyAll={copyAll}
              onPublisher={() => goToView(router, "social-publisher")}
              onCalendar={() => goToView(router, "content-calendar")}
            />
          )}
        </div>

        {history.length > 0 && (
          <div
            style={{
              marginTop: 32,
              background: "white",
              border: "1px solid #E2E8F0",
              borderRadius: 14,
              padding: 18,
            }}
          >
            <div
              style={{
                fontSize: "0.72rem",
                fontWeight: 700,
                color: "#64748B",
                letterSpacing: ".05em",
                marginBottom: 10,
              }}
            >
              📚 RECENT CAROUSELS
            </div>
            {history.slice(0, 10).map((h) => (
              <div
                key={h.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: 10,
                  borderBottom: "1px solid #F1F5F9",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#0F172A",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {h.topic}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#64748B" }}>
                    {(structures[h.structure] || {}).label || h.structure} ·{" "}
                    {new Date(h.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => load(h.id)}
                  style={{
                    background: "#F1F5F9",
                    color: "#0F172A",
                    border: "1px solid #CBD5E1",
                    padding: "6px 12px",
                    borderRadius: 6,
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CarouselResultView({
  r,
  onCopyAll,
  onPublisher,
  onCalendar,
}: {
  r: CarouselResult;
  onCopyAll: () => void;
  onPublisher: () => void;
  onCalendar: () => void;
}) {
  const slides = r.slides || [];
  return (
    <div>
      <div
        style={{
          background: "white",
          border: "1px solid #E2E8F0",
          borderRadius: 14,
          padding: "18px 22px",
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <div
            style={{
              fontSize: "0.74rem",
              fontWeight: 700,
              color: "#64748B",
              letterSpacing: ".05em",
              marginBottom: 2,
            }}
          >
            {r.structureLabel || ""}{" "}
            {r.source === "openai" ? (
              <span
                style={{
                  background: "#10B981",
                  color: "white",
                  padding: "3px 8px",
                  borderRadius: 6,
                  fontSize: "0.65rem",
                  fontWeight: 800,
                  letterSpacing: ".05em",
                }}
              >
                AI-WRITTEN
              </span>
            ) : (
              <span
                style={{
                  background: "#F59E0B",
                  color: "white",
                  padding: "3px 8px",
                  borderRadius: 6,
                  fontSize: "0.65rem",
                  fontWeight: 800,
                  letterSpacing: ".05em",
                }}
              >
                TEMPLATE
              </span>
            )}
          </div>
          <div style={{ fontWeight: 800, color: "#0F172A" }}>
            {r.topic || ""}
          </div>
        </div>
        <button
          onClick={onCopyAll}
          style={{
            background: "#0066FF",
            color: "white",
            border: "none",
            padding: "9px 16px",
            borderRadius: 8,
            fontSize: "0.82rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          📋 Copy all slides
        </button>
        <button
          onClick={onPublisher}
          style={{
            background: '#eef4ff',
            color: "white",
            border: "none",
            padding: "9px 16px",
            borderRadius: 8,
            fontSize: "0.82rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          📤 Open Social Publisher
        </button>
        <button
          onClick={onCalendar}
          style={{
            background: "#F1F5F9",
            color: "#0F172A",
            border: "1px solid #CBD5E1",
            padding: "9px 16px",
            borderRadius: 8,
            fontSize: "0.82rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          📅 Add to Calendar
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          gap: 14,
        }}
      >
        {slides.map((s, i) => (
          <div
            key={i}
            style={{
              background: "white",
              border: "1px solid #E2E8F0",
              borderRadius: 14,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                background: `linear-gradient(135deg,${
                  PALETTE[i % PALETTE.length]
                },${PALETTE[(i + 3) % PALETTE.length]})`,
                color: "white",
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontWeight: 800 }}>SLIDE {String(s.n)}</span>
              <span
                style={{
                  background: "rgba(255,255,255,.22)",
                  padding: "3px 10px",
                  borderRadius: 6,
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  letterSpacing: ".05em",
                }}
              >
                {s.role || ""}
              </span>
            </div>
            <div style={{ padding: "14px 16px", flex: 1 }}>
              <div
                style={{
                  fontSize: "1rem",
                  fontWeight: 800,
                  color: "#0F172A",
                  marginBottom: 8,
                  lineHeight: 1.3,
                }}
              >
                {s.headline || ""}
              </div>
              <div
                style={{
                  fontSize: "0.86rem",
                  color: "#475569",
                  lineHeight: 1.5,
                }}
              >
                {s.body || ""}
              </div>
              {s.visualHint && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px dashed #CBD5E1",
                    fontSize: "0.74rem",
                    color: "#94A3B8",
                  }}
                >
                  <b>Visual:</b> {s.visualHint}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

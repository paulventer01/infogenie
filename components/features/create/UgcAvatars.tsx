"use client";

// Native React port of the legacy `ugc-avatars` panel (was `buildUgcAvatars` /
// `selectAvatar` / `playUgcScript` / `runUgcAvatars` in app.js + the
// `#view-ugc-avatars` block in index.html).
//
// NOTE: this is a CLIENT-SIDE generator — the legacy builder has NO backing
// `/api/*` endpoint. It deterministically derives a creator-style script and
// performance prediction from the user's last competitor analysis
// (`window.analysisData`) using the same seeded RNG (`_seedRng`) and the same
// `_lsAD/_lsDomain/_lsBrand/_lsSector/_lsKeywords` lookups as the legacy module,
// and reads the script aloud with the browser Web Speech API (exactly like the
// legacy `playUgcScript`). Reproduced faithfully here; when no analysis exists
// it shows the legacy empty-state card.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
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

function lsAD(): AnalysisData | null {
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
  const ad = lsAD();
  const d = (ad && (ad.url || ad.domain)) || "";
  return String(d).replace(/^https?:\/\//, "").split("/")[0] || "";
}
function lsBrand(): string {
  const ad = lsAD();
  return (
    (ad && (ad.brand || ad.brandName)) || lsDomain().split(".")[0] || "your brand"
  );
}
function lsSector(): string {
  const ad = lsAD();
  if (ad) {
    if (ad.sector) return ad.sector;
    if (ad.industry && typeof ad.industry === "string") return ad.industry;
    if (ad.industry && typeof ad.industry === "object" && ad.industry.name)
      return ad.industry.name;
  }
  return "your industry";
}
function lsKeywords(): string[] {
  const ad = lsAD();
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
function seedRng(seedStr: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };
}
function toast(msg: string) {
  const fn = (window as unknown as { showToast?: (m: string) => void }).showToast;
  if (fn) fn(msg);
  else alert(msg);
}

interface Avatar {
  id: string;
  name: string;
  age: number;
  vibe: string;
  color: string;
  tag: string;
}
const AVATARS: Avatar[] = [
  { id: "sarah", name: "Sarah", age: 28, vibe: "Friendly Gen Z", color: "#F472B6", tag: "Best for: Lifestyle, beauty, DTC" },
  { id: "mark", name: "Mark", age: 34, vibe: "Confident Pro", color: "#0EA5E9", tag: "Best for: SaaS, B2B, finance" },
  { id: "aisha", name: "Aisha", age: 31, vibe: "Warm Educator", color: "#10B981", tag: "Best for: Health, edtech, services" },
  { id: "james", name: "James", age: 42, vibe: "Trusted Expert", color: "#8B5CF6", tag: "Best for: Insurance, real estate" },
  { id: "lily", name: "Lily", age: 24, vibe: "Bubbly Creator", color: "#F59E0B", tag: "Best for: Fashion, food, wellness" },
  { id: "kai", name: "Kai", age: 29, vibe: "Tech Reviewer", color: "#06B6D4", tag: "Best for: Apps, gadgets, startups" },
];

interface UgcData {
  avatarId: string;
  script: string;
  duration: number;
  scores: {
    hook: number;
    auth: number;
    conv: number;
    ctr: string;
    cost: string;
  };
}

function generate(avatarId: string): UgcData {
  const brand = lsBrand();
  const sector = lsSector();
  const kw = lsKeywords()[0] || lsSector();
  const rng = seedRng(lsDomain() + avatarId);
  const scripts = [
    `Okay, I have to tell you about ${brand}. I was spending hours every week on ${kw} — until last month. Now? It takes me literally 5 minutes. The AI does everything. I'm getting more leads, paying way less, and finally have my evenings back. If you're in ${sector}, just try the free trial. You'll thank me.`,
    `Real talk — I tried every tool out there for ${kw}. Most of them are overpriced and complicated. Then I found ${brand}. It's like having a full marketing team for the price of a coffee. My ROAS doubled in the first month. I'm not sponsored, I just genuinely love it.`,
    `If you run a ${sector} business and you're not using ${brand} yet, you're leaving money on the table. I'm serious. The AI writes ads, builds landing pages, optimises my campaigns — all while I sleep. Best 100 bucks a month I've ever spent.`,
  ];
  return {
    avatarId,
    script: scripts[Math.floor(rng() * scripts.length)],
    duration: 28 + Math.floor(rng() * 22),
    scores: {
      hook: 78 + Math.floor(rng() * 18),
      auth: 82 + Math.floor(rng() * 14),
      conv: 71 + Math.floor(rng() * 22),
      ctr: (3.2 + rng() * 4.5).toFixed(1),
      cost: (2.4 + rng() * 3.8).toFixed(2),
    },
  };
}

// ── Web Speech helpers (ported from app.js `_pickSpeechVoice` / `_speak`) ────
function pickSpeechVoice(gender: "F" | "M"): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || !voices.length) return null;
    const pool = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
    const search = pool.length ? pool : voices;
    if (gender === "F") {
      const f = search.find((v) =>
        /female|samantha|victoria|karen|moira|tessa|serena|aria|olivia|sofia|isla|lily|aisha/i.test(v.name),
      );
      if (f) return f;
    } else {
      const m = search.find((v) =>
        /male|daniel|alex|fred|tom|aaron|liam|mark|james|ethan|noah|arjun|kai/i.test(v.name),
      );
      if (m) return m;
    }
    return search[0];
  } catch {
    return null;
  }
}

const GENDER: Record<string, "F" | "M"> = {
  sarah: "F",
  lily: "F",
  aisha: "F",
  mark: "M",
  james: "M",
  kai: "M",
};

export default function UgcAvatars() {
  const router = useRouter();
  const hasDomain = typeof window !== "undefined" && !!lsDomain();
  const [data, setData] = useState<UgcData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [playing, setPlaying] = useState(false);

  function selectAvatar(avatarId: string) {
    if (!lsDomain()) {
      toast("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return;
    }
    setGenerating(true);
    setTimeout(() => {
      setData(generate(avatarId));
      setGenerating(false);
      toast("✅ Avatar video ready");
    }, 1300);
  }

  function run() {
    if (!lsDomain()) {
      toast("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return;
    }
    selectAvatar(data ? data.avatarId : "sarah");
  }

  function playScript() {
    if (!data || !data.script) {
      toast("⚠️ Generate an avatar first");
      return;
    }
    if (!("speechSynthesis" in window)) {
      toast("⚠️ Your browser does not support speech playback");
      return;
    }
    if (playing) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      setPlaying(false);
      return;
    }
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    const u = new SpeechSynthesisUtterance(data.script);
    const v = pickSpeechVoice(GENDER[data.avatarId] || "F");
    if (v) u.voice = v;
    u.lang = v ? v.lang : "en";
    u.rate = 1.05;
    u.onend = () => setPlaying(false);
    u.onerror = () => setPlaying(false);
    if (!window.speechSynthesis.getVoices().length) {
      window.speechSynthesis.onvoiceschanged = () => {
        const vv = pickSpeechVoice(GENDER[data.avatarId] || "F");
        if (vv) u.voice = vv;
        window.speechSynthesis.speak(u);
      };
    } else {
      window.speechSynthesis.speak(u);
    }
    setPlaying(true);
    toast("▶ Playing AI script…");
  }

  const av = data ? AVATARS.find((a) => a.id === data.avatarId) : undefined;

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> AI UGC Avatars
              </div>
              <h2 className="view-title">🧑‍🎤 AI UGC Avatars</h2>
              <p className="view-sub">
                Pick an avatar, write a script (or let AI write it from your
                analysis), and generate a TikTok / Reels-ready creator video — no
                filming needed.
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                onClick={run}
                disabled={generating}
              >
                🧑‍🎤 Generate Avatar Video
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        {!hasDomain ? (
          <EmptyCard
            title="AI UGC Avatars"
            onHome={() => goToView(router, "home")}
          />
        ) : !data || !av ? (
          <>
            <div
              style={{
                background: "white",
                borderRadius: 12,
                padding: 24,
                border: "1px solid #E2E8F0",
                marginBottom: 16,
              }}
            >
              <h3 style={{ margin: "0 0 6px", color: "#1E293B" }}>
                Pick an avatar &amp; let AI write the script
              </h3>
              <p style={{ margin: "0 0 16px", color: "#64748B", fontSize: 14 }}>
                Each avatar matches a different audience archetype — pick the one
                closest to your buyer.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
                  gap: 12,
                }}
              >
                {AVATARS.map((a) => (
                  <div
                    key={a.id}
                    onClick={() => selectAvatar(a.id)}
                    style={{
                      background: "white",
                      border: "2px solid #E2E8F0",
                      borderRadius: 12,
                      padding: 14,
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "all .15s",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = a.color;
                      e.currentTarget.style.transform = "translateY(-2px)";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = "#E2E8F0";
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                  >
                    <div
                      style={{
                        width: 72,
                        height: 72,
                        borderRadius: "50%",
                        background: `linear-gradient(135deg,${a.color},${a.color}88)`,
                        margin: "0 auto 10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 30,
                        color: "white",
                        fontWeight: 800,
                      }}
                    >
                      {a.name[0]}
                    </div>
                    <div style={{ fontWeight: 700, color: "#1E293B" }}>
                      {a.name}, {a.age}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                      {a.vibe}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#94A3B8",
                        marginTop: 6,
                        lineHeight: 1.3,
                      }}
                    >
                      {a.tag}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
              {generating ? (
                "⏳ Generating script and rendering avatar…"
              ) : (
                <>
                  ↑ Pick an avatar to start, or{" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      selectAvatar("sarah");
                    }}
                    style={{ color: "#7E22CE", fontWeight: 700 }}
                  >
                    use our recommended pick
                  </a>
                </>
              )}
            </div>
          </>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 380px",
              gap: 18,
            }}
          >
            {/* Left: video preview */}
            <div
              style={{
                background: "white",
                borderRadius: 12,
                border: "1px solid #E2E8F0",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  aspectRatio: "9 / 16",
                  maxHeight: 560,
                  background: `linear-gradient(180deg,${av.color}25,${av.color}05)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    width: 140,
                    height: 140,
                    borderRadius: "50%",
                    background: `linear-gradient(135deg,${av.color},${av.color}aa)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 54,
                    color: "white",
                    fontWeight: 800,
                    boxShadow: `0 18px 50px ${av.color}55`,
                  }}
                >
                  {av.name[0]}
                </div>
                <button
                  onClick={playScript}
                  title="Play the AI-generated script aloud"
                  style={{
                    position: "absolute",
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,.95)",
                    border: "none",
                    fontSize: 24,
                    cursor: "pointer",
                    boxShadow: "0 6px 20px rgba(0,0,0,.2)",
                  }}
                >
                  {playing ? "⏸" : "▶"}
                </button>
                <div
                  style={{
                    position: "absolute",
                    bottom: 14,
                    left: 14,
                    right: 14,
                    background: "rgba(0,0,0,.7)",
                    color: "white",
                    padding: "10px 12px",
                    borderRadius: 8,
                    fontSize: 13,
                    lineHeight: 1.4,
                  }}
                >
                  &quot;{data.script.split(". ")[0]}…&quot;
                </div>
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    background: "#10B981",
                    color: "white",
                    fontSize: 10,
                    padding: "3px 8px",
                    borderRadius: 4,
                    fontWeight: 800,
                  }}
                >
                  ▶ READY
                </div>
              </div>
              <div
                style={{
                  padding: "14px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, color: "#1E293B" }}>
                    {av.name}, {av.age} — {av.vibe}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>
                    {data.duration}s • 1080×1920 • H.264
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => toast("✓ Downloading MP4…")}
                    style={{
                      padding: "8px 14px",
                      background: "#7E22CE",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    ⬇ MP4
                  </button>
                  <button
                    onClick={run}
                    style={{
                      padding: "8px 14px",
                      background: "#F1F5F9",
                      color: "#1E293B",
                      border: "1px solid #E2E8F0",
                      borderRadius: 6,
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    ↺
                  </button>
                </div>
              </div>
            </div>

            {/* Right: script + controls */}
            <div>
              <div
                style={{
                  background: "white",
                  borderRadius: 12,
                  padding: 18,
                  border: "1px solid #E2E8F0",
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#64748B",
                    letterSpacing: ".05em",
                    marginBottom: 8,
                  }}
                >
                  AI-GENERATED SCRIPT
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#1E293B",
                    lineHeight: 1.55,
                    background: "#F8FAFC",
                    padding: 12,
                    borderRadius: 8,
                    borderLeft: `3px solid ${av.color}`,
                  }}
                >
                  {data.script}
                </div>
                <button
                  onClick={() => {
                    try {
                      window.speechSynthesis.cancel();
                    } catch {
                      /* ignore */
                    }
                    setPlaying(false);
                    setData(null);
                  }}
                  style={{
                    marginTop: 10,
                    padding: "8px 14px",
                    background: "#F1F5F9",
                    color: "#1E293B",
                    border: "1px solid #E2E8F0",
                    borderRadius: 6,
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  ← Pick different avatar
                </button>
              </div>
              <div
                style={{
                  background: "white",
                  borderRadius: 12,
                  padding: 18,
                  border: "1px solid #E2E8F0",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#64748B",
                    letterSpacing: ".05em",
                    marginBottom: 10,
                  }}
                >
                  PERFORMANCE PREDICTION
                </div>
                {(
                  [
                    ["Hook strength", data.scores.hook, "#10B981"],
                    ["Authenticity", data.scores.auth, "#0EA5E9"],
                    ["Conversion potential", data.scores.conv, "#F59E0B"],
                  ] as [string, number, string][]
                ).map((s) => (
                  <div key={s[0]} style={{ marginBottom: 10 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 12,
                        color: "#1E293B",
                        fontWeight: 600,
                        marginBottom: 3,
                      }}
                    >
                      <span>{s[0]}</span>
                      <span>{s[1]}/100</span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        background: "#F1F5F9",
                        borderRadius: 99,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${s[1]}%`,
                          background: s[2],
                        }}
                      />
                    </div>
                  </div>
                ))}
                <div
                  style={{
                    marginTop: 12,
                    padding: 10,
                    background: "#F0FDF4",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "#065F46",
                  }}
                >
                  <strong>Predicted CTR:</strong> {data.scores.ctr}% &nbsp;•&nbsp;{" "}
                  <strong>Cost:</strong> ${data.scores.cost}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyCard({ title, onHome }: { title: string; onHome: () => void }) {
  return (
    <div
      style={{
        background: "white",
        border: "2px dashed #CBD5E1",
        borderRadius: 12,
        padding: 48,
        textAlign: "center",
        marginTop: 20,
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 12 }}>🔎</div>
      <h3 style={{ margin: "0 0 8px", color: "#1E293B" }}>Run an analysis first</h3>
      <p style={{ margin: "0 auto 18px", color: "#64748B", maxWidth: 480 }}>
        {title} needs your competitor &amp; sector data. Head to the home page,
        enter your website (or pick a sector), and we&apos;ll have everything
        ready in under a minute.
      </p>
      <button
        onClick={onHome}
        style={{
          background: "linear-gradient(135deg,#0066FF,#00D8D7)",
          color: "white",
          border: "none",
          padding: "10px 22px",
          borderRadius: 8,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        ↗ Go to Home — Run Analysis
      </button>
    </div>
  );
}

"use client";

// Native React port of the legacy `video-script` panel (was
// `window.buildVideoScript` in `public/js/ig_intel_pack_a.js` + `#view-video-script`
// in index.html). Generates short-form video scripts via the existing Express API
// (`POST /api/video-script/generate`) through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiPost } from "@/lib/api";

interface BodyLine {
  line?: string;
  onscreen_text?: string;
  cue?: string;
}
interface Script {
  viral_pattern?: string;
  estimated_duration_sec?: number;
  hook?: string;
  body?: BodyLine[];
  cta?: string;
  hashtags?: string[];
}
interface GenerateResult {
  ok: boolean;
  error?: string;
  scripts?: Script[];
}

export default function VideoScript() {
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("tiktok");
  const [tone, setTone] = useState("energetic");
  const [duration, setDuration] = useState(30);
  const [count, setCount] = useState(3);

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState("");
  const [scripts, setScripts] = useState<Script[]>([]);

  async function generate() {
    if (!topic.trim()) {
      setStatus("error");
      setError("⚠ Topic required");
      return;
    }
    setStatus("loading");
    setError("");
    setScripts([]);
    const r = await apiPost<GenerateResult>("/api/video-script/generate", {
      topic: topic.trim(),
      platform,
      tone,
      duration,
      count,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "Generate failed");
      return;
    }
    setScripts(r.scripts || []);
    setStatus("done");
  }

  const selStyle: React.CSSProperties = {
    width: "100%",
    padding: 7,
    border: "1px solid #D1D5DB",
    borderRadius: 5,
    fontSize: "0.8rem",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.68rem",
    fontWeight: 700,
    color: "#6B7280",
    marginBottom: 3,
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Video Scripts
              </div>
              <h2 className="view-title">🎬 Video Script Generator</h2>
              <p className="view-sub">
                Generate short-form video scripts for TikTok, Reels, Shorts and
                LinkedIn. Each variant includes hook, body lines, on-screen text
                cues, B-roll directions, CTA and hashtags.
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
              marginBottom: 3,
            }}
          >
            TOPIC / PRODUCT
          </label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder='e.g. "5 hidden features of our analytics dashboard"'
            style={{
              width: "100%",
              padding: 9,
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              fontSize: "0.88rem",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: 8,
              marginTop: 10,
            }}
          >
            <div>
              <label style={labelStyle}>PLATFORM</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                style={selStyle}
              >
                <option value="tiktok">TikTok</option>
                <option value="reels">Reels</option>
                <option value="shorts">YT Shorts</option>
                <option value="linkedin">LinkedIn</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>TONE</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                style={selStyle}
              >
                <option value="energetic">Energetic</option>
                <option value="educational">Educational</option>
                <option value="funny">Funny</option>
                <option value="dramatic">Dramatic</option>
                <option value="authoritative">Authoritative</option>
                <option value="conversational">Conversational</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>DURATION (s)</label>
              <input
                type="number"
                min={15}
                max={180}
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value, 10) || 0)}
                style={selStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>VARIANTS</label>
              <input
                type="number"
                min={1}
                max={5}
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value, 10) || 0)}
                style={selStyle}
              />
            </div>
          </div>
          <button
            onClick={generate}
            disabled={status === "loading"}
            style={{
              marginTop: 12,
              background: "linear-gradient(135deg,#EC4899,#F472B6)",
              color: "#fff",
              border: "none",
              padding: "10px 20px",
              borderRadius: 6,
              fontSize: "0.84rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            🎬 Generate Scripts
          </button>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ color: "#9CA3AF" }}>
              ⏳ Generating {count} script(s)…
            </div>
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
              {error}
            </div>
          )}
          {status === "done" && (
            <div style={{ display: "grid", gap: 14 }}>
              {scripts.map((s, i) => (
                <ScriptCard key={i} s={s} i={i} duration={duration} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScriptCard({
  s,
  i,
  duration,
}: {
  s: Script;
  i: number;
  duration: number;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        padding: 18,
        borderLeft: "4px solid #EC4899",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <h3 style={{ margin: 0, color: "#0A1628", fontSize: "1rem" }}>
          🎬 Variant {i + 1}{" "}
          <span
            style={{
              background: "#FCE7F3",
              color: "#9F1239",
              padding: "3px 10px",
              borderRadius: 14,
              fontSize: "0.7rem",
              fontWeight: 700,
              marginLeft: 8,
            }}
          >
            {s.viral_pattern || ""}
          </span>
        </h3>
        <span
          style={{ fontSize: "0.74rem", color: "#6B7280", fontWeight: 700 }}
        >
          {s.estimated_duration_sec ?? duration}s
        </span>
      </div>
      <div
        style={{
          background: "linear-gradient(135deg,#FCE7F3,#FBCFE8)",
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: "0.66rem",
            fontWeight: 800,
            color: "#9F1239",
            textTransform: "uppercase",
            marginBottom: 3,
          }}
        >
          ⚡ HOOK (0-3s)
        </div>
        <div
          style={{ fontSize: "0.96rem", fontWeight: 700, color: "#0A1628" }}
        >
          &quot;{s.hook || ""}&quot;
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            fontSize: "0.7rem",
            fontWeight: 800,
            color: "#6B7280",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          📝 BODY
        </div>
        {(s.body || []).map((b, bi) => (
          <div
            key={bi}
            style={{
              display: "grid",
              gridTemplateColumns: "24px 1fr 1fr 1fr",
              gap: 8,
              padding: "8px 0",
              borderBottom: "1px solid #F3F4F6",
              fontSize: "0.78rem",
            }}
          >
            <div style={{ color: "#9CA3AF", fontWeight: 700 }}>{bi + 1}.</div>
            <div>
              <div
                style={{ fontSize: "0.66rem", color: "#9CA3AF", fontWeight: 700 }}
              >
                SPOKEN
              </div>
              <div style={{ color: "#0A1628" }}>{b.line || ""}</div>
            </div>
            <div>
              <div
                style={{ fontSize: "0.66rem", color: "#9CA3AF", fontWeight: 700 }}
              >
                ON-SCREEN
              </div>
              <div style={{ color: "#1E1B4B", fontWeight: 700 }}>
                {b.onscreen_text || ""}
              </div>
            </div>
            <div>
              <div
                style={{ fontSize: "0.66rem", color: "#9CA3AF", fontWeight: 700 }}
              >
                CUE
              </div>
              <div style={{ color: "#0f766e", fontStyle: "italic" }}>
                {b.cue || ""}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          background: "linear-gradient(135deg,#10B981,#34D399)",
          color: "#fff",
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: "0.66rem",
            fontWeight: 800,
            textTransform: "uppercase",
            marginBottom: 3,
          }}
        >
          🎯 CTA
        </div>
        <div style={{ fontSize: "0.92rem", fontWeight: 700 }}>
          &quot;{s.cta || ""}&quot;
        </div>
      </div>
      <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>
        {(s.hashtags || []).map((h, hi) => (
          <span
            key={hi}
            style={{
              background: "#F3F4F6",
              padding: "2px 8px",
              borderRadius: 10,
              marginRight: 4,
              color: "#0066FF",
              fontWeight: 700,
            }}
          >
            {h}
          </span>
        ))}
      </div>
    </div>
  );
}

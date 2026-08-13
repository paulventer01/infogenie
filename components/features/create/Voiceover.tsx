"use client";

// Native React port of the legacy `voiceover` panel (was
// `window.buildVoiceover` in `public/js/ig_intel_pack_a.js` + `#view-voiceover`
// in index.html). Turns a script into narration via the existing Express API
// (`POST /api/voiceover/generate`, `GET /api/voiceover/list`) through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface GenerateResult {
  ok: boolean;
  error?: string;
  mp3Url?: string;
  charCount?: number;
  sizeBytes?: number;
}
interface HistoryItem {
  label?: string;
  voice?: string;
  model?: string;
  char_count?: number;
  mp3_url?: string;
  created_at?: string;
}
interface ListResult {
  ok: boolean;
  items?: HistoryItem[];
}

function safeUrl(u: string | undefined): string {
  const s = String(u || "");
  if (/^https?:\/\//i.test(s) || s.startsWith("/")) return s;
  return "";
}

export default function Voiceover() {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("alloy");
  const [model, setModel] = useState("tts-1");
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState<"openai" | "elevenlabs">("openai");
  const [elevenVoices, setElevenVoices] = useState<{ id: string; name: string }[]>([]);
  const [elevenVoiceId, setElevenVoiceId] = useState("");
  const [elevenReady, setElevenReady] = useState(false);

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  async function loadHistory() {
    const j = await apiGet<ListResult>("/api/voiceover/list");
    setHistory(j.ok && j.items ? j.items : []);
  }

  useEffect(() => {
    loadHistory();
    (async () => {
      const t = await apiGet<{ ok?: boolean; elevenlabs?: boolean }>("/api/voiceover/test");
      setElevenReady(!!t.elevenlabs);
      const v = await apiGet<{ ok?: boolean; voices?: { id: string; name: string }[] }>(
        "/api/voiceover/elevenlabs/voices"
      );
      const list = v.voices || [];
      setElevenVoices(list);
      if (list[0]?.id) setElevenVoiceId(list[0].id);
    })();
  }, []);

  async function generate() {
    const t = text.trim();
    if (!t) {
      setStatus("error");
      setError("⚠ Paste some text to narrate");
      return;
    }
    const max = provider === "elevenlabs" ? 5000 : 4000;
    if (t.length > max) {
      setStatus("error");
      setError(`⚠ Text exceeds ${max} character limit. Split into multiple voiceovers.`);
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<GenerateResult>("/api/voiceover/generate", {
      text: t,
      voice,
      model,
      label: label.trim(),
      provider,
      eleven_voice_id: elevenVoiceId,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "Generate failed");
      return;
    }
    setResult(r);
    setStatus("done");
    loadHistory();
  }

  const countColor = text.length > 4000 ? "#B91C1C" : "#9CA3AF";
  const sizeKb = Math.round((result?.sizeBytes || 0) / 1024);

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.66rem",
    fontWeight: 700,
    color: "#6B7280",
    marginBottom: 4,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: 8,
    border: "1px solid #D1D5DB",
    borderRadius: 5,
    fontSize: "0.84rem",
    boxSizing: "border-box",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Voiceover
              </div>
              <h2 className="view-title">🔊 Voiceover</h2>
              <p className="view-sub">
                Turn any script into studio-quality narration — OpenAI TTS or ElevenLabs brand voices.
                Paste a script, pick a provider + voice, get an mp3.
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
              marginBottom: 6,
            }}
          >
            SCRIPT (max 4000 chars)
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder="Paste your video script, ad copy, or any text you want narrated..."
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              fontSize: "0.86rem",
              fontFamily: "inherit",
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: 10,
              marginTop: 12,
              alignItems: "end",
            }}
          >
            <div>
              <label style={labelStyle}>PROVIDER</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as "openai" | "elevenlabs")}
                style={inputStyle}
              >
                <option value="openai">OpenAI TTS</option>
                <option value="elevenlabs">
                  ElevenLabs{elevenReady ? "" : " (add key in Settings)"}
                </option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>VOICE</label>
              {provider === "elevenlabs" ? (
                <select
                  value={elevenVoiceId}
                  onChange={(e) => setElevenVoiceId(e.target.value)}
                  style={inputStyle}
                >
                  {elevenVoices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  style={inputStyle}
                >
                  <option value="alloy">Alloy (neutral)</option>
                  <option value="echo">Echo (male, calm)</option>
                  <option value="fable">Fable (British, warm)</option>
                  <option value="onyx">Onyx (male, deep)</option>
                  <option value="nova">Nova (female, bright)</option>
                  <option value="shimmer">Shimmer (female, soft)</option>
                </select>
              )}
            </div>
            <div>
              <label style={labelStyle}>QUALITY</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={inputStyle}
                disabled={provider === "elevenlabs"}
              >
                <option value="tts-1">Standard (fast &amp; cheap)</option>
                <option value="tts-1-hd">HD (richer, ~3x slower)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>LABEL (opt.)</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Q4 launch hero"
                style={inputStyle}
              />
            </div>
            <div>
              <button
                onClick={generate}
                disabled={status === "loading"}
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg,#0066FF,#0f766e)",
                  color: "#fff",
                  border: "none",
                  padding: "9px 16px",
                  borderRadius: 6,
                  fontSize: "0.84rem",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                🔊 Generate
              </button>
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: "0.7rem", color: countColor }}>
            {text.length} / 4000 chars
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ color: "#9CA3AF" }}>⏳ Generating audio (3-15s)…</div>
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
          {status === "done" && result && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <strong style={{ color: "#0A1628" }}>
                  🔊 {voice} · {model}
                </strong>
                <span style={{ color: "#6B7280", fontSize: "0.78rem" }}>
                  {result.charCount ?? 0} chars · {sizeKb} KB
                </span>
              </div>
              <audio
                src={safeUrl(result.mp3Url)}
                controls
                style={{ width: "100%" }}
              />
              <div style={{ marginTop: 10 }}>
                <a
                  href={safeUrl(result.mp3Url)}
                  download
                  style={{
                    display: "inline-block",
                    background: "#0066FF",
                    color: "#fff",
                    padding: "8px 16px",
                    borderRadius: 6,
                    fontSize: "0.84rem",
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  ⬇ Download mp3
                </a>
              </div>
            </div>
          )}
        </div>

        {history.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h3
              style={{
                fontSize: "0.94rem",
                color: "#374151",
                marginBottom: 10,
              }}
            >
              Recent voiceovers
            </h3>
            <div style={{ display: "grid", gap: 10 }}>
              {history.slice(0, 10).map((it, i) => (
                <div
                  key={i}
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 8,
                    padding: "10px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "0.84rem",
                        color: "#0A1628",
                      }}
                    >
                      {it.label || "(no label)"}{" "}
                      <span
                        style={{
                          color: "#9CA3AF",
                          fontWeight: 500,
                          marginLeft: 6,
                        }}
                      >
                        {it.voice} · {it.model} · {it.char_count ?? 0} chars
                      </span>
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "#6B7280" }}>
                      {it.created_at
                        ? new Date(it.created_at).toLocaleString()
                        : ""}
                    </div>
                  </div>
                  <audio
                    src={safeUrl(it.mp3_url)}
                    controls
                    style={{ height: 32, flexShrink: 0 }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

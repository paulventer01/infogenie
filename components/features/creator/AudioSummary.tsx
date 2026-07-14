"use client";

import { useState } from "react";
import { apiPost, apiGet } from "@/lib/api";

interface Run {
  id: number;
  title: string;
  voice: string;
  audio_url: string | null;
  script: string | null;
  word_count: number | null;
  created_at: string;
}

const VOICES = [
  { id: "nova",    label: "Nova",    desc: "Warm & friendly (female)" },
  { id: "alloy",   label: "Alloy",   desc: "Neutral & balanced" },
  { id: "echo",    label: "Echo",    desc: "Clear & professional (male)" },
  { id: "fable",   label: "Fable",   desc: "Expressive storyteller" },
  { id: "onyx",    label: "Onyx",    desc: "Deep & authoritative (male)" },
  { id: "shimmer", label: "Shimmer", desc: "Bright & energetic (female)" },
];

export default function AudioSummary() {
  const [runs, setRuns]         = useState<Run[]>([]);
  const [loaded, setLoaded]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [generating, setGen]    = useState(false);
  const [toast, setToast]       = useState("");
  const [selected, setSelected] = useState<Run | null>(null);
  const [form, setForm] = useState({ title: "", text: "", voice: "nova" });

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  async function loadRuns() {
    if (loaded) return;
    setLoading(true);
    const r = await apiGet("/api/audio-summary/list");
    if (r?.runs) setRuns(r.runs);
    setLoaded(true);
    setLoading(false);
  }

  async function handleGenerate() {
    if (!form.text.trim()) { showToast("Paste or type article text first."); return; }
    setGen(true);
    const r = await apiPost("/api/audio-summary/generate", { title: form.title, text: form.text, voice: form.voice });
    if (r?.ok) {
      showToast("✅ Audio summary ready!");
      const run = r.run || { id: Date.now(), title: form.title, voice: form.voice, audio_url: r.audio_url, script: r.script, word_count: r.word_count, created_at: new Date().toISOString() };
      setRuns(prev => [run, ...prev]);
      setSelected(run);
      setForm(f => ({ ...f, title: "", text: "" }));
    } else {
      showToast(r?.error === "openai_key_required" ? "⚠️ OpenAI key required — configure it in AI Providers." : `Error: ${r?.error || "generation failed"}`);
    }
    setGen(false);
  }

  const card:   React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 2px 8px rgba(10,20,50,.06)" };
  const input:  React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", boxSizing: "border-box" };
  const lbl:    React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 5 };
  const btnPri: React.CSSProperties = { padding: "10px 22px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" };

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "#0A1628", color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Create › Audio Summaries</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>🎙️ Audio Summary Generator</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>Turn any article, report, or brief into a 90-second spoken summary with 6 AI voices — perfect for newsletters, podcasts, and accessibility.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 20 }}>
        {/* Left — generator */}
        <div>
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 14 }}>➕ Generate Audio Summary</div>
            <div style={{ display: "grid", gap: 11 }}>
              <div><label style={lbl}>Title (optional)</label><input style={input} placeholder="Q3 Marketing Report" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
              <div>
                <label style={lbl}>Article / Report Text *</label>
                <textarea style={{ ...input, minHeight: 160, resize: "vertical" }} placeholder="Paste your article, blog post, or report here (up to 4,000 words)…" value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} />
                <div style={{ fontSize: "0.7rem", color: "#94A3B8", marginTop: 3 }}>{form.text.split(/\s+/).filter(Boolean).length} words</div>
              </div>
              <div>
                <label style={lbl}>Voice</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {VOICES.map(v => (
                    <div key={v.id} onClick={() => setForm(f => ({ ...f, voice: v.id }))} style={{ padding: "8px 12px", border: `2px solid ${form.voice === v.id ? "#0066FF" : "#E2E8F0"}`, borderRadius: 9, cursor: "pointer", background: form.voice === v.id ? "#EFF6FF" : "#fff" }}>
                      <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.82rem" }}>{v.label}</div>
                      <div style={{ color: "#64748B", fontSize: "0.68rem" }}>{v.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={handleGenerate} disabled={generating} style={{ ...btnPri, marginTop: 14, width: "100%", opacity: generating ? 0.7 : 1 }}>
              {generating ? "Generating… (~20s)" : "🎙️ Generate Audio Summary"}
            </button>
            <div style={{ marginTop: 12, background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 9, padding: "10px 14px", fontSize: "0.75rem", color: "#166534" }}>
              <strong>How it works:</strong> GPT-4o-mini condenses your article to ~250 spoken words with a hook, 2–3 key points, and a takeaway — then OpenAI TTS renders it to MP3 in your chosen voice.
            </div>
          </div>

          <button onClick={loadRuns} disabled={loading} style={{ width: "100%", padding: "10px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9, color: "#475569", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}>
            {loading ? "Loading…" : loaded ? `📚 ${runs.length} saved summaries` : "📚 Load Previous Summaries"}
          </button>
        </div>

        {/* Right — result + history */}
        <div>
          {selected && (
            <div style={{ ...card, borderLeft: "4px solid #0066FF", marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem" }}>{selected.title || "Untitled Summary"}</div>
                  <div style={{ color: "#64748B", fontSize: "0.75rem", marginTop: 3 }}>Voice: {selected.voice} · {selected.word_count || "—"} words · {new Date(selected.created_at).toLocaleString()}</div>
                </div>
                <button onClick={() => setSelected(null)} style={{ background: "transparent", border: "none", color: "#94A3B8", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
              </div>

              {selected.audio_url ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#374151", marginBottom: 6 }}>🔊 Audio</div>
                  <audio controls style={{ width: "100%", borderRadius: 8 }} src={selected.audio_url}>
                    Your browser does not support the audio element.
                  </audio>
                  <a href={selected.audio_url} download style={{ display: "inline-block", marginTop: 8, fontSize: "0.75rem", color: "#0066FF", fontWeight: 600, textDecoration: "none" }}>⬇️ Download MP3</a>
                </div>
              ) : (
                <div style={{ background: "#FFF7ED", border: "1px solid #FDE68A", borderRadius: 8, padding: "10px 14px", fontSize: "0.78rem", color: "#92400E", marginBottom: 14 }}>
                  ⚠️ Audio file not available — OpenAI TTS requires a valid API key. The script below was generated.
                </div>
              )}

              {selected.script && (
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#374151", marginBottom: 6 }}>📝 Script</div>
                  <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9, padding: "14px 16px", fontSize: "0.82rem", color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                    {selected.script}
                  </div>
                </div>
              )}
            </div>
          )}

          {loaded && runs.length === 0 && !selected && (
            <div style={{ ...card, textAlign: "center", padding: "50px 20px" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>🎙️</div>
              <div style={{ fontWeight: 700, color: "#0A1628" }}>No audio summaries yet</div>
              <div style={{ color: "#64748B", fontSize: "0.82rem", marginTop: 4 }}>Generate your first one from the panel on the left.</div>
            </div>
          )}

          {runs.filter(r => r.id !== selected?.id).slice(0, 10).map(run => (
            <div key={run.id} style={{ ...card, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }} onClick={() => setSelected(run)}>
              <div>
                <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.88rem" }}>{run.title || "Untitled Summary"}</div>
                <div style={{ color: "#64748B", fontSize: "0.72rem", marginTop: 2 }}>Voice: {run.voice} · {new Date(run.created_at).toLocaleDateString()}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {run.audio_url && <span style={{ fontSize: "0.72rem", background: "#ECFDF5", color: "#065F46", padding: "3px 8px", borderRadius: 99, fontWeight: 700 }}>🔊 MP3</span>}
                <span style={{ fontSize: "0.72rem", color: "#0066FF", fontWeight: 600 }}>Open →</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { apiPost } from "@/lib/api";

interface Platform {
  id: string;
  label: string;
  icon: string;
}

interface FunnelStage {
  id: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  tip: string;
}

const FUNNEL_STAGES: FunnelStage[] = [
  { id: "awareness", label: "Awareness", icon: "🌱", color: "#10B981", bg: "#ECFDF5", tip: "Stop the scroll with hooks and micro-education." },
  { id: "interest", label: "Interest", icon: "💡", color: "#3B82F6", bg: "#EFF6FF", tip: "Frameworks and tutorials that build curiosity." },
  { id: "nurture", label: "Nurture", icon: "❤️", color: "#EC4899", bg: "#FDF2F8", tip: "Process sharing and soft CTAs that build trust." },
  { id: "conversion", label: "Conversion", icon: "💰", color: "#F59E0B", bg: "#FFFBEB", tip: "Situation-based CTAs that turn trust into action." },
  { id: "advocacy", label: "Advocacy", icon: "🌟", color: "#7C3AED", bg: "#F5F3FF", tip: "Client wins and referral loops." },
];

interface Archetype {
  id: string;
  icon: string;
  title: string;
  hint: string;
  prompt: string;
}

const POST_ARCHETYPES: Record<string, Archetype[]> = {
  awareness: [
    { id: "pattern_interrupt", icon: "🪝", title: "Pattern Interrupt Hook", hint: "POV-style opener that stops the scroll", prompt: 'Write a pattern-interrupt hook caption for {brand} in {industry} starting with "POV:" — open with an uncomfortable truth. Keep it 2-3 short punchy lines. Add 2-3 relevant emojis and 2 niche hashtags.' },
    { id: "contrarian", icon: "⚡", title: "Contrarian Take", hint: "Challenge a popular belief", prompt: 'Write a contrarian-take caption for {brand} in {industry} starting with "Unpopular opinion:" — provocative but not insulting. End with a question.' },
    { id: "micro_story", icon: "📖", title: "Relatable Micro-Story", hint: "A short personal moment", prompt: "Write a 2-3 sentence relatable micro-story caption for {brand} in {industry}. Raw and honest. Soft CTA." },
    { id: "niche_callout", icon: "🎯", title: "Niche Call-Out", hint: "Speak to a specific sub-audience", prompt: 'Write a niche call-out caption for {brand} in {industry} opening with "This is for [specific sub-audience]". 4-5 lines then a clear next step.' },
  ],
  interest: [
    { id: "if_then", icon: "🧩", title: '"If you\'re X, do Y"', hint: "Diagnostic prescription", prompt: 'Write an "If you\'re X, do Y" framework caption for {brand} in {industry}. 4-6 lines.' },
    { id: "mistake_based", icon: "❌", title: "Mistake-Based Content", hint: "Common error + the fix", prompt: 'Write a mistake-based caption for {brand} in {industry} naming a common error and revealing the fix in 3-4 lines.' },
    { id: "positioning", icon: "🎯", title: "Clear Positioning", hint: "Who you help & how", prompt: 'Write a positioning caption for {brand} in {industry} opening with "I help [audience] [outcome] through [method]".' },
    { id: "proof_story", icon: "📊", title: "Proof-Led Story", hint: "Mini case study", prompt: 'Write a proof-led story for {brand} in {industry}: "How a [client type] [achieved result]". Specific numbers.' },
  ],
  nurture: [
    { id: "bts_thinking", icon: "🔍", title: "Behind-the-Scenes", hint: "Reveal your process", prompt: 'Write a behind-the-scenes caption for {brand} in {industry} ("How I structure X"). 3-4 numbered steps.' },
    { id: "decision_breakdown", icon: "⚖️", title: "Decision Breakdown", hint: "Walk through a real choice", prompt: 'Write a decision-breakdown for {brand} in {industry}: "Why we [changed] X". 5-6 honest lines.' },
    { id: "journey_story", icon: "🛤️", title: "Client Journey", hint: "From → To with the messy middle", prompt: 'Write a client-journey caption for {brand} in {industry}: "From [start] → [end]". Include one turning point.' },
    { id: "real_talk", icon: "🗣️", title: "Real Talk", hint: "Honest take no one says", prompt: 'Write a real-talk caption for {brand} in {industry} opening "What no one tells you about [topic]".' },
  ],
  conversion: [
    { id: "situation_cta", icon: "💬", title: "Situation-Based CTA", hint: "DM keyword trigger", prompt: 'Write a situation-based CTA for {brand} in {industry} ending with "DM [KEYWORD] if [situation]".' },
    { id: "callout_post", icon: "📣", title: "Call-Out Post", hint: "Direct address to ideal buyer", prompt: 'Write a call-out conversion caption for {brand} in {industry} opening "If you\'re tired of [pain]".' },
    { id: "micro_offer", icon: "🎁", title: "Micro-Offer", hint: "Low-friction entry", prompt: "Write a micro-offer caption for {brand} in {industry}: free or low-friction offer with clear value." },
    { id: "objection_handle", icon: "🛡️", title: "Objection Handling", hint: "Flip the #1 hesitation", prompt: 'Write an objection-handling caption for {brand} in {industry} that flips "You don\'t need more X, you need better Y".' },
  ],
  advocacy: [
    { id: "screenshot_proof", icon: "📸", title: "Screenshot Proof", hint: "Caption for a win screenshot", prompt: "Write a caption to accompany a client win screenshot for {brand} in {industry}. 4-5 lines of social proof." },
    { id: "client_led", icon: "🎤", title: "Client-Led Content", hint: "Hand the mic to a client", prompt: 'Write a client-led caption for {brand} in {industry}: "In their words:" + quoted takeaway.' },
    { id: "public_win", icon: "🏆", title: "Public Win", hint: "Celebrate a result", prompt: 'Write a public-win caption for {brand} in {industry} with specific numbers. Credit the client.' },
    { id: "referral_loop", icon: "🔁", title: "Referral Loop", hint: "Invite advocates to bring others", prompt: "Write a referral-loop caption for {brand} in {industry} inviting followers to tag someone who needs it." },
  ],
};

const PLATFORM_NAME_TO_ID: Record<string, string> = {
  Meta: "facebook",
  Instagram: "instagram",
  TikTok: "tiktok",
  LinkedIn: "linkedin",
  X: "twitter",
  YouTube: "youtube",
  Pinterest: "pinterest",
  Snapchat: "snapchat",
  Threads: "threads",
};

interface Props {
  platforms: Platform[];
  onUseCaption: (payload: {
    text: string;
    platforms: string[];
    meta: { funnel_stage: string; archetype_id: string; archetype_title: string };
  }) => void;
}

export default function SocialIdeasPanel({ platforms, onUseCaption }: Props) {
  const [stageId, setStageId] = useState("awareness");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ text: string; archetype: Archetype } | null>(null);

  const stage = FUNNEL_STAGES.find((s) => s.id === stageId) || FUNNEL_STAGES[0];
  const archetypes = POST_ARCHETYPES[stageId] || [];

  const brandCtx = useMemo(() => {
    if (typeof window === "undefined") return { brand: "our brand", industry: "our industry" };
    const a = (window as unknown as { analysisData?: { url?: string; industry?: { name?: string } } }).analysisData || {};
    const brand = a.url ? String(a.url).replace(/^https?:\/\//, "").replace(/\/$/, "") : "our brand";
    const industry = a.industry?.name || "our industry";
    return { brand, industry };
  }, []);

  async function generate(arch: Archetype) {
    setBusyId(arch.id);
    setError(null);
    const prompt = arch.prompt.replace(/\{brand\}/g, brandCtx.brand).replace(/\{industry\}/g, brandCtx.industry);
    const r = await apiPost<{ ok?: boolean; error?: string; caption?: string; text?: string }>(
      "/api/ai-social-caption",
      { prompt, brand: brandCtx.brand, industry: brandCtx.industry },
    );
    setBusyId(null);
    const text = String(r.caption || r.text || "").trim();
    if (!text) {
      setError(r.error || "Caption generation failed");
      return;
    }
    setPreview({ text, archetype: arch });
  }

  function usePreview(platformIds?: string[]) {
    if (!preview) return;
    const plats = platformIds?.length
      ? platformIds
      : platforms.slice(0, 3).map((p) => p.id);
    onUseCaption({
      text: preview.text,
      platforms: plats,
      meta: {
        funnel_stage: stageId,
        archetype_id: preview.archetype.id,
        archetype_title: preview.archetype.title,
      },
    });
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }}>
      <h3 style={{ margin: "0 0 6px", color: "#0A1628", fontSize: "0.95rem", fontFamily: "Sora,sans-serif" }}>
        💡 Content ideas
      </h3>
      <p style={{ margin: "0 0 14px", fontSize: "0.78rem", color: "#6B7280", lineHeight: 1.5 }}>
        Pick a funnel stage and archetype, generate an AI caption, then send it to Compose as a draft ready to schedule.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {FUNNEL_STAGES.map((s) => {
          const on = s.id === stageId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => { setStageId(s.id); setPreview(null); }}
              style={{
                background: on ? s.bg : "#F9FAFB",
                border: `1px solid ${on ? s.color : "#E5E7EB"}`,
                color: on ? s.color : "#374151",
                padding: "6px 10px",
                borderRadius: 8,
                fontSize: "0.72rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {s.icon} {s.label}
            </button>
          );
        })}
      </div>

      <div style={{ background: stage.bg, border: `1px solid ${stage.color}33`, borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: "0.78rem", color: stage.color, fontWeight: 600 }}>
        {stage.tip}
      </div>

      {error && <div style={{ color: "#991B1B", fontSize: "0.78rem", marginBottom: 10 }}>⚠ {error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10 }}>
        {archetypes.map((a) => (
          <div key={a.id} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 12, background: "#F9FAFB" }}>
            <div style={{ fontSize: "1.1rem", marginBottom: 4 }}>{a.icon}</div>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: "0.82rem", color: "#0A1628" }}>{a.title}</div>
            <div style={{ fontSize: "0.72rem", color: "#6B7280", margin: "4px 0 10px", lineHeight: 1.4 }}>{a.hint}</div>
            <button
              type="button"
              onClick={() => generate(a)}
              disabled={busyId === a.id}
              style={{
                width: "100%",
                background: "#0A1628",
                color: "#fff",
                border: "none",
                padding: "8px 10px",
                borderRadius: 7,
                fontSize: "0.74rem",
                fontWeight: 800,
                cursor: busyId === a.id ? "wait" : "pointer",
                opacity: busyId === a.id ? 0.7 : 1,
              }}
            >
              {busyId === a.id ? "Generating…" : "✨ AI Suggest"}
            </button>
          </div>
        ))}
      </div>

      {preview && (
        <div style={{ marginTop: 16, border: "1px solid #A7F3D0", background: "#ECFDF5", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#065F46", marginBottom: 6 }}>
            Preview · {preview.archetype.title}
          </div>
          <div style={{ fontSize: "0.86rem", color: "#0A1628", lineHeight: 1.55, whiteSpace: "pre-wrap", marginBottom: 12 }}>
            {preview.text}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => usePreview(["instagram", "linkedin", "twitter"])}
              style={{ background: "#FF5722", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 7, fontSize: "0.78rem", fontWeight: 800, cursor: "pointer" }}
            >
              Use in Compose
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              style={{ background: "#fff", color: "#374151", border: "1px solid #D1D5DB", padding: "8px 14px", borderRadius: 7, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: "0.68rem", color: "#9CA3AF" }}>
        Platform map reference: {Object.entries(PLATFORM_NAME_TO_ID).map(([k, v]) => `${k}→${v}`).join(" · ")}
      </div>
    </div>
  );
}

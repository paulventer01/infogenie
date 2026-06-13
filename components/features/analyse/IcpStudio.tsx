"use client";

// Native React port of the legacy `icp-studio` panel (was `buildICPStudio`
// + `#view-icp-studio` in index.html, defined in public/js/ig_research_tools.js).
// Builds an Ideal Customer Profile, mines Voice-of-Customer signals, then
// activates the result across Creative / Social / Email. Talks to the existing
// Express API:
//   • POST /api/reddit-monitor  — scan Reddit for buyer signals
//   • POST /api/icp-draft       — auto-draft the ICP from brand intel
//   • POST /api/icp-voc         — mine triggers / objections / emotional drivers
//   • POST /api/openai          — GPT-4o copy generation for activation flows
// Reads/writes the shared SPA globals (`analysisData`, `_icpProfile`, `_icpVoC`,
// `_redditPosts`, `_counterTarget`, `_socialPosts`) so cross-module integration
// keeps working, and uses `goToView` for cross-tool navigation.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface IcpProfile {
  ageRange?: string;
  role?: string;
  intent?: string;
  painPoints?: string[];
  desires?: string[];
  budget?: string;
}
interface VoCItem {
  text: string;
  evidence?: string;
}
interface VoC {
  triggers: VoCItem[];
  objections: VoCItem[];
  emotionalDrivers: VoCItem[];
}
interface AnalysisCompetitor {
  name?: string;
  domain?: string;
  url?: string;
}
interface AnalysisData {
  url?: string;
  country?: string;
  industry?: { name?: string };
  competitors?: AnalysisCompetitor[];
}
interface EmailSeqItem {
  subject?: string;
  body?: string;
}
interface SocialPost {
  id: string;
  platform: string;
  caption: string;
  scheduledDate: string;
  scheduledTime: string;
  status: string;
  funnelStage: string;
  archetypeId: string;
  archetypeTitle: string;
  sourceObjection?: string;
  sourceModule: string;
  createdAt: string;
}
interface CounterTarget {
  name: string;
  persona: string;
  pains: string[];
  desires: string[];
  budget: string;
  source: string;
  expiresAt: number;
}
interface OpenAiResponse {
  ok?: boolean;
  error?: string;
  choices?: { message?: { content?: string } }[];
}

interface IcpWindow {
  analysisData?: AnalysisData;
  _icpProfile?: IcpProfile | null;
  _icpVoC?: VoC | null;
  _redditPosts?: unknown[];
  _counterTarget?: CounterTarget;
  _socialPosts?: SocialPost[];
  showToast?: (msg: string, kind?: string) => void;
}

function ig(): IcpWindow {
  if (typeof window === "undefined") return {};
  return window as unknown as IcpWindow;
}

function toast(msg: string): void {
  const w = ig();
  if (typeof w.showToast === "function") w.showToast(msg);
}

const PRIMARY = "#7C3AED";

export default function IcpStudio() {
  const router = useRouter();

  // Controlled ICP builder fields
  const [ageRange, setAgeRange] = useState("");
  const [role, setRole] = useState("");
  const [intent, setIntent] = useState("");
  const [pain, setPain] = useState<string[]>(["", "", ""]);
  const [desire, setDesire] = useState<string[]>(["", "", ""]);
  const [budget, setBudget] = useState("");

  // Mined Voice-of-Customer
  const [voc, setVoc] = useState<VoC | null>(null);
  const [savedIcp, setSavedIcp] = useState<IcpProfile | null>(null);

  // Reddit signals (count from the shared global)
  const [redditCount, setRedditCount] = useState(0);

  // Async / status flags
  const [drafting, setDrafting] = useState(false);
  const [mining, setMining] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanFailed, setScanFailed] = useState(false);
  const [actStatus, setActStatus] = useState<string>("");
  const [act2Busy, setAct2Busy] = useState(false);
  const [act3Busy, setAct3Busy] = useState(false);

  // Email sequence modal
  const [emailModal, setEmailModal] = useState<{
    trigger: VoCItem;
    seq: EmailSeqItem[];
  } | null>(null);

  const ad = useMemo<AnalysisData>(() => ig().analysisData || {}, []);
  const domain = ad.url || "your brand";
  const industry = ad.industry?.name || "your industry";
  const compCount = (ad.competitors || []).length;

  // Hydrate from the shared SPA globals on mount.
  useEffect(() => {
    const w = ig();
    const icp = w._icpProfile || {};
    setAgeRange(icp.ageRange || "");
    setRole(icp.role || "");
    setIntent(icp.intent || "");
    setPain([
      icp.painPoints?.[0] || "",
      icp.painPoints?.[1] || "",
      icp.painPoints?.[2] || "",
    ]);
    setDesire([
      icp.desires?.[0] || "",
      icp.desires?.[1] || "",
      icp.desires?.[2] || "",
    ]);
    setBudget(icp.budget || "");
    if (icp.role || icp.ageRange) setSavedIcp(icp);
    if (w._icpVoC) setVoc(w._icpVoC);
    setRedditCount((w._redditPosts || []).length);
  }, []);

  const readForm = useCallback((): IcpProfile => {
    return {
      ageRange: ageRange.trim(),
      role: role.trim(),
      intent: intent.trim(),
      painPoints: pain.map((p) => p.trim()).filter(Boolean),
      desires: desire.map((d) => d.trim()).filter(Boolean),
      budget: budget.trim(),
    };
  }, [ageRange, role, intent, pain, desire, budget]);

  const hasICP = !!(savedIcp && (savedIcp.role || savedIcp.ageRange));
  const hasVoC = !!(voc && (voc.triggers.length || voc.objections.length));

  function applyDraft(icp: IcpProfile) {
    setAgeRange(icp.ageRange || "");
    setRole(icp.role || "");
    setIntent(icp.intent || "");
    setPain([
      icp.painPoints?.[0] || "",
      icp.painPoints?.[1] || "",
      icp.painPoints?.[2] || "",
    ]);
    setDesire([
      icp.desires?.[0] || "",
      icp.desires?.[1] || "",
      icp.desires?.[2] || "",
    ]);
    setBudget(icp.budget || "");
  }

  // ── Save ICP ────────────────────────────────────────────────────────────
  function saveForm() {
    const icp = readForm();
    if (!icp.role && !icp.ageRange && (icp.painPoints || []).length === 0) {
      toast("⚠️ Add at least one field before saving");
      return;
    }
    ig()._icpProfile = icp;
    setSavedIcp(icp);
    toast("✅ ICP saved — now mine your VoC or activate it");
  }

  // ── Auto-draft from brand intel ─────────────────────────────────────────
  async function autoDraft() {
    if (drafting) return;
    setDrafting(true);
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 45000);
    try {
      const data = await apiFetch<{ icp?: IcpProfile; error?: string }>(
        "/api/icp-draft",
        {
          method: "POST",
          body: JSON.stringify({
            domain: ad.url || "yourdomain.com",
            industry: ad.industry?.name || "your industry",
            country: ad.country || "Global",
            competitors: (ad.competitors || []).slice(0, 6),
          }),
          signal: ac.signal,
        },
      );
      if (data.error) throw new Error(data.error);
      if (data.icp && (data.icp.role || data.icp.ageRange)) {
        const icp: IcpProfile = {
          ageRange: data.icp.ageRange || "",
          role: data.icp.role || "",
          intent: data.icp.intent || "",
          painPoints: Array.isArray(data.icp.painPoints)
            ? data.icp.painPoints.slice(0, 3)
            : [],
          desires: Array.isArray(data.icp.desires)
            ? data.icp.desires.slice(0, 3)
            : [],
          budget: data.icp.budget || "",
        };
        ig()._icpProfile = icp;
        applyDraft(icp);
        toast("✨ ICP drafted — review & edit, then save");
      } else {
        throw new Error("Empty draft returned");
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "AbortError"
          ? "AI draft timed out after 45s — try again"
          : err instanceof Error
            ? err.message
            : "unknown error";
      toast("⚠️ Draft failed: " + msg);
    } finally {
      clearTimeout(timeoutId);
      setDrafting(false);
    }
  }

  // ── Scan Reddit ─────────────────────────────────────────────────────────
  async function scanReddit() {
    if (scanning || redditCount > 0) return;
    const brand = (ad.url || "")
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "");
    const ind = ad.industry?.name || "marketing";
    const competitors = (ad.competitors || [])
      .slice(0, 5)
      .map((c) => c?.name || c?.domain || "")
      .filter(Boolean);
    const keywords = competitors.length ? [] : [ind];
    if (!brand && competitors.length === 0) {
      toast("⚠️ Run a site analysis first");
      return;
    }
    setScanning(true);
    setScanFailed(false);
    try {
      const data = await apiFetch<{ posts?: unknown[]; error?: string }>(
        "/api/reddit-monitor",
        {
          method: "POST",
          body: JSON.stringify({
            brand,
            keywords,
            competitors,
            industry: ind,
          }),
        },
      );
      if (data.error) throw new Error(data.error);
      const posts = data.posts || [];
      ig()._redditPosts = posts;
      setRedditCount(posts.length);
      if (posts.length === 0) {
        toast(
          "🕳️ No threads found — try the full Reddit Monitor with custom keywords",
        );
        setScanFailed(true);
        return;
      }
      toast(`✅ Found ${posts.length} Reddit signals — refreshing ICP Studio`);
    } catch (err) {
      toast(
        "⚠️ Reddit scan failed: " +
          (err instanceof Error ? err.message : String(err)),
      );
      setScanFailed(true);
    } finally {
      setScanning(false);
    }
  }

  // ── Mine Voice-of-Customer ──────────────────────────────────────────────
  async function mineVoC() {
    const icp = readForm();
    if (!icp.role && !icp.ageRange) {
      toast("⚠️ Build & save your ICP first (or auto-draft it)");
      return;
    }
    ig()._icpProfile = icp;
    setSavedIcp(icp);
    setMining(true);
    try {
      const data = await apiFetch<{
        triggers?: VoCItem[];
        objections?: VoCItem[];
        emotionalDrivers?: VoCItem[];
        error?: string;
      }>("/api/icp-voc", {
        method: "POST",
        body: JSON.stringify({
          icp,
          redditPosts: (ig()._redditPosts || []).slice(0, 12),
          competitors: (ad.competitors || []).slice(0, 6),
          industry: ad.industry?.name || "your industry",
          domain: ad.url || "yourdomain.com",
        }),
      });
      if (data.error) throw new Error(data.error);
      const mined: VoC = {
        triggers: data.triggers || [],
        objections: data.objections || [],
        emotionalDrivers: data.emotionalDrivers || [],
      };
      ig()._icpVoC = mined;
      setVoc(mined);
      toast("🎤 Voice-of-Customer mined — activate it on the right →");
    } catch (err) {
      toast(
        "⚠️ Mining failed: " +
          (err instanceof Error ? err.message : "unknown error"),
      );
    } finally {
      setMining(false);
    }
  }

  // ── Activation 1: Creative Studio target ────────────────────────────────
  function actCreativeTarget() {
    const icp = ig()._icpProfile;
    if (!icp) {
      toast("⚠️ Save your ICP first");
      return;
    }
    ig()._counterTarget = {
      name: `ICP: ${icp.role || "Ideal Customer"}`,
      persona: `${icp.ageRange || ""} ${icp.role || ""} (${icp.intent || ""})`.trim(),
      pains: icp.painPoints || [],
      desires: icp.desires || [],
      budget: icp.budget || "",
      source: "icp-studio",
      expiresAt: Date.now() + 30 * 60 * 1000,
    };
    toast("🎯 ICP set as Creative Studio target — opening Campaigns…");
    setTimeout(() => goToView(router, "campaigns"), 600);
  }

  // ── Activation 2: Counter-objection caption pack ────────────────────────
  async function actObjectionPack() {
    const icp = ig()._icpProfile;
    const v = ig()._icpVoC;
    if (!icp || !v?.objections?.length) {
      toast("⚠️ Need ICP + at least 1 objection");
      return;
    }
    setAct2Busy(true);
    setActStatus("⏳ Generating 5 counter-objection captions with GPT-4o…");
    const objections = v.objections.slice(0, 5);
    const userPrompt = `Brand: ${domain}
Industry: ${industry}
ICP: ${icp.ageRange || ""} ${icp.role || ""} · ${icp.intent || ""}
Their pains: ${(icp.painPoints || []).join(" / ")}
Their desires: ${(icp.desires || []).join(" / ")}

Write exactly ${objections.length} short social-media post captions — one per objection. Each caption flips that objection into a confident, empathetic answer (objection-handling format). 60-90 words each. Plain text. Add 2-3 relevant emojis. End with a soft CTA.

Objections:
${objections.map((o, i) => `${i + 1}. ${o.text}`).join("\n")}

Return JSON: { "captions": [ { "objection": "...", "caption": "..." }, ... ] }`;
    try {
      const data = await apiFetch<OpenAiResponse>("/api/openai", {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "You are a senior social media copywriter who specialises in objection-handling content. Return JSON only.",
            },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 1200,
          response_format: { type: "json_object" },
        }),
      });
      const raw = data.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(raw) as {
        captions?: { objection?: string; caption?: string }[];
      };
      const captions = (parsed.captions || []).filter((c) => c.caption);
      if (captions.length === 0) throw new Error("No captions returned");
      const w = ig();
      if (!w._socialPosts) w._socialPosts = [];
      const today = new Date();
      captions.forEach((c, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() + i + 1);
        w._socialPosts!.push({
          id: "post_icp_" + Date.now() + "_" + i,
          platform: "Instagram",
          caption: c.caption || "",
          scheduledDate: d.toISOString().split("T")[0],
          scheduledTime: "09:00",
          status: "draft",
          funnelStage: "nurture",
          archetypeId: "objection_handle",
          archetypeTitle: "Objection Handling",
          sourceObjection: c.objection || objections[i]?.text,
          sourceModule: "icp-studio",
          createdAt: new Date().toLocaleString(),
        });
      });
      toast(
        `✊ ${captions.length} counter-objection drafts added to Social Calendar (Drafts)`,
      );
      setActStatus(
        `✅ ${captions.length} drafts added to Social Calendar — open the Social Calendar to review.`,
      );
    } catch (err) {
      toast(
        "⚠️ Generation failed: " +
          (err instanceof Error ? err.message : "unknown"),
      );
      setActStatus("");
    } finally {
      setAct2Busy(false);
    }
  }

  // ── Activation 3: Email sequence for top trigger ────────────────────────
  async function actEmailSequence() {
    const icp = ig()._icpProfile;
    const v = ig()._icpVoC;
    if (!icp || !v?.triggers?.length) {
      toast("⚠️ Need ICP + at least 1 trigger");
      return;
    }
    setAct3Busy(true);
    setActStatus("⏳ Drafting 3-email warm-up sequence with GPT-4o…");
    const topTrigger = v.triggers[0];
    const userPrompt = `Brand: ${domain}
Industry: ${industry}
ICP: ${icp.ageRange || ""} ${icp.role || ""} · ${icp.intent || ""}
Top buying trigger: ${topTrigger.text}
Trigger evidence: ${topTrigger.evidence || ""}

Write a 3-email warm-up sequence that leans into this trigger. The reader is the ICP above; this trigger is what makes them buy. Each email should escalate from awareness → consideration → invitation.

Return JSON: {
  "sequence": [
    { "subject": "...", "body": "..." },
    { "subject": "...", "body": "..." },
    { "subject": "...", "body": "..." }
  ]
}

Rules:
- Subject: under 8 words, curiosity-driven, no clickbait clichés.
- Body: 110-150 words, plain text, line breaks between paragraphs.
- Email 1: name the situation that triggers buying, no pitch.
- Email 2: show how ${domain} solves it (1 specific example).
- Email 3: clear soft CTA + 1-line PS.`;
    try {
      const data = await apiFetch<OpenAiResponse>("/api/openai", {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "You are a senior B2C/B2B email copywriter. Return JSON only.",
            },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 1400,
          response_format: { type: "json_object" },
        }),
      });
      const raw = data.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(raw) as { sequence?: EmailSeqItem[] };
      const seq = parsed.sequence || [];
      if (seq.length === 0) throw new Error("No sequence returned");
      setEmailModal({ trigger: topTrigger, seq });
      setActStatus("");
    } catch (err) {
      toast(
        "⚠️ Generation failed: " +
          (err instanceof Error ? err.message : "unknown"),
      );
      setActStatus("");
    } finally {
      setAct3Busy(false);
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────
  const listInput: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 12px",
    border: "1.5px solid #E2E8F0",
    borderRadius: 9,
    fontSize: "0.82rem",
    color: "#0A1628",
    outline: "none",
    marginBottom: 6,
  };
  const fieldLabel: React.CSSProperties = {
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#374151",
    textTransform: "uppercase",
    letterSpacing: ".06em",
    marginBottom: 6,
  };
  const card: React.CSSProperties = {
    background: "white",
    border: "1px solid #E5E7EB",
    borderRadius: 18,
    padding: "22px 26px",
    marginBottom: 18,
    boxShadow: "0 1px 6px rgba(0,0,0,.05)",
  };

  function VocColumn({
    title,
    icon,
    color,
    bg,
    items,
    emptyText,
  }: {
    title: string;
    icon: string;
    color: string;
    bg: string;
    items: VoCItem[] | undefined;
    emptyText: string;
  }) {
    return (
      <div
        style={{
          background: "white",
          border: "1px solid #E5E7EB",
          borderRadius: 14,
          padding: "16px 18px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: "1.1rem" }}>{icon}</span>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 800,
              color,
            }}
          >
            {title}
          </div>
        </div>
        {items && items.length ? (
          items.map((it, i) => (
            <div
              key={i}
              style={{
                background: bg,
                border: `1px solid ${color}33`,
                borderRadius: 10,
                padding: "10px 12px",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  color,
                  lineHeight: 1.35,
                }}
              >
                {it.text}
              </div>
              {it.evidence && (
                <div
                  style={{
                    fontSize: "0.66rem",
                    color: "#6B7280",
                    marginTop: 4,
                    fontStyle: "italic",
                    lineHeight: 1.4,
                  }}
                >
                  ↳ {it.evidence}
                </div>
              )}
            </div>
          ))
        ) : (
          <div
            style={{
              fontSize: "0.74rem",
              color: "#9CA3AF",
              textAlign: "center",
              padding: "18px 0",
            }}
          >
            {emptyText}
          </div>
        )}
      </div>
    );
  }

  function ActButton({
    icon,
    title,
    desc,
    color,
    bg,
    disabled,
    disabledReason,
    busy,
    onClick,
  }: {
    icon: string;
    title: string;
    desc: string;
    color: string;
    bg: string;
    disabled: boolean;
    disabledReason: string;
    busy?: boolean;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        disabled={disabled || busy}
        onClick={onClick}
        title={disabled ? disabledReason : undefined}
        style={{
          textAlign: "left",
          padding: "18px 20px",
          background: disabled ? "#F9FAFB" : "white",
          border: `1.5px solid ${disabled ? "#E5E7EB" : color + "55"}`,
          borderRadius: 14,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : busy ? 0.7 : 1,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 36,
              height: 36,
              background: bg,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.2rem",
            }}
          >
            {icon}
          </div>
          <div
            style={{
              fontSize: "0.88rem",
              fontWeight: 800,
              color: disabled ? "#9CA3AF" : "#0A1628",
            }}
          >
            {title}
          </div>
        </div>
        <div
          style={{ fontSize: "0.72rem", color: "#6B7280", lineHeight: 1.45 }}
        >
          {desc}
        </div>
        {disabled ? (
          <div
            style={{
              fontSize: "0.65rem",
              color: "#9CA3AF",
              fontStyle: "italic",
              marginTop: 2,
            }}
          >
            {disabledReason}
          </div>
        ) : (
          <div
            style={{
              fontSize: "0.7rem",
              color,
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            {busy ? "→ Working…" : "→ Activate"}
          </div>
        )}
      </button>
    );
  }

  const actDis2 = !hasVoC || !(voc && voc.objections.length);
  const actDis3 = !hasVoC || !(voc && voc.triggers.length);

  return (
    <div className="view-header-wrap">
      <div
        className="view-header"
        style={{ background: "linear-gradient(135deg,#7C3AED 0%,#EC4899 100%)" }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#F5D0FE" }}>
                <span
                  className="bc-group"
                  style={{ color: "rgba(245,208,254,.8)" }}
                >
                  Analyse
                </span>{" "}
                <span
                  className="bc-sep"
                  style={{ color: "rgba(255,255,255,.3)" }}
                >
                  ›
                </span>{" "}
                ICP Studio
              </div>
              <h2 className="view-title">
                🎯 ICP Studio — Ideal Customer Profile
              </h2>
              <p className="view-sub">
                Build a detailed customer profile, mine voice-of-customer
                signals from Reddit &amp; competitor data, then activate it
                across Creative, Social &amp; Email.
              </p>
            </div>
            <div className="vh-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={autoDraft}
                disabled={drafting}
                style={{ background: "white", color: PRIMARY }}
              >
                ✨ Auto-Draft from Brand Intel
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 60 }}
      >
        {/* Context bar */}
        <div
          style={{
            background: "linear-gradient(135deg,#F5F3FF,#FDF2F8)",
            border: "1px solid #E9D5FF",
            borderRadius: 14,
            padding: "14px 18px",
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "#6B21A8" }}>
            <strong>Brand:</strong> {domain} · <strong>Industry:</strong>{" "}
            {industry} · <strong>Reddit threads available:</strong>{" "}
            {redditCount} · <strong>Competitors:</strong> {compCount}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#9333EA" }}>
            {hasICP ? "✅ ICP saved" : "⚪ ICP not built yet"} ·{" "}
            {hasVoC ? "✅ VoC mined" : "⚪ VoC not mined yet"}
          </div>
        </div>

        {/* Panel A — ICP Builder */}
        <div style={card}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div>
              <div
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span style={{ fontSize: "1.1rem" }}>🧬</span>
                <div
                  style={{
                    fontSize: "1rem",
                    fontWeight: 800,
                    color: "#0A1628",
                  }}
                >
                  ICP Builder
                </div>
              </div>
              <div
                style={{
                  fontSize: "0.74rem",
                  color: "#6B7280",
                  marginTop: 2,
                }}
              >
                6 fields define who you&apos;re really selling to. Edit anything
                — AI will auto-draft if you leave it blank.
              </div>
            </div>
            <button
              type="button"
              onClick={autoDraft}
              disabled={drafting}
              style={{
                padding: "9px 18px",
                background: "linear-gradient(135deg,#7C3AED,#EC4899)",
                border: "none",
                borderRadius: 10,
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "white",
                cursor: drafting ? "wait" : "pointer",
                opacity: drafting ? 0.6 : 1,
              }}
            >
              ✨ Auto-Draft from Brand Intel
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <div>
              <div style={fieldLabel}>Age Range</div>
              <input
                value={ageRange}
                onChange={(e) => setAgeRange(e.target.value)}
                placeholder="e.g. 28–45"
                style={{ ...listInput, marginBottom: 0 }}
              />
            </div>
            <div>
              <div style={fieldLabel}>Role / Stage</div>
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. Solo trader / SMB founder"
                style={{ ...listInput, marginBottom: 0 }}
              />
            </div>
            <div>
              <div style={fieldLabel}>Intent Stage</div>
              <input
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="e.g. Actively comparing alternatives"
                style={{ ...listInput, marginBottom: 0 }}
              />
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <div>
              <div style={fieldLabel}>Top 3 Pain Points</div>
              {pain.map((p, i) => (
                <input
                  key={i}
                  value={p}
                  onChange={(e) =>
                    setPain((prev) =>
                      prev.map((x, xi) => (xi === i ? e.target.value : x)),
                    )
                  }
                  placeholder="Pain point…"
                  style={listInput}
                />
              ))}
            </div>
            <div>
              <div style={fieldLabel}>Top 3 Desires</div>
              {desire.map((d, i) => (
                <input
                  key={i}
                  value={d}
                  onChange={(e) =>
                    setDesire((prev) =>
                      prev.map((x, xi) => (xi === i ? e.target.value : x)),
                    )
                  }
                  placeholder="Desire…"
                  style={listInput}
                />
              ))}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
            }}
          >
            <div>
              <div style={fieldLabel}>Budget Band</div>
              <input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="e.g. £500–£2,000/mo"
                style={{ ...listInput, marginBottom: 0 }}
              />
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={scanReddit}
                disabled={redditCount > 0 || scanning}
                style={{
                  width: "100%",
                  padding: 10,
                  background: redditCount > 0 ? "#E5E7EB" : "#FF4500",
                  border: "none",
                  borderRadius: 10,
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  color: redditCount > 0 ? "#6B7280" : "white",
                  cursor: redditCount > 0 ? "default" : "pointer",
                  opacity: scanning ? 0.7 : 1,
                }}
              >
                {scanning
                  ? "⏳ Scanning…"
                  : redditCount > 0
                    ? `✅ Reddit scanned (${redditCount})`
                    : scanFailed
                      ? "🔄 Try again"
                      : "🔍 Scan Reddit now"}
              </button>
              <button
                type="button"
                onClick={saveForm}
                style={{
                  width: "100%",
                  padding: 11,
                  background: "#0A1628",
                  border: "none",
                  borderRadius: 10,
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: "white",
                  cursor: "pointer",
                }}
              >
                💾 Save ICP
              </button>
            </div>
          </div>
          {drafting && (
            <div
              style={{
                marginTop: 10,
                fontSize: "0.74rem",
                color: "#7C3AED",
              }}
            >
              ⏳ AI is drafting your ICP from {domain} brand intelligence…
            </div>
          )}
        </div>

        {/* Panel B — Voice-of-Customer Mining */}
        <div style={card}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div>
              <div
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span style={{ fontSize: "1.1rem" }}>🎤</span>
                <div
                  style={{
                    fontSize: "1rem",
                    fontWeight: 800,
                    color: "#0A1628",
                  }}
                >
                  Voice-of-Customer Mining
                </div>
              </div>
              <div
                style={{
                  fontSize: "0.74rem",
                  color: "#6B7280",
                  marginTop: 2,
                }}
              >
                Pulls from <strong>{redditCount}</strong> Reddit threads ·{" "}
                <strong>{compCount}</strong> competitors · brand context —
                extracts buying psychology.
              </div>
            </div>
            <button
              type="button"
              onClick={mineVoC}
              disabled={mining}
              style={{
                padding: "9px 18px",
                background: "linear-gradient(135deg,#EC4899,#F59E0B)",
                border: "none",
                borderRadius: 10,
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "white",
                cursor: mining ? "wait" : "pointer",
                opacity: mining ? 0.6 : 1,
              }}
            >
              {mining ? "⏳ Mining…" : "🔍 Mine My Data"}
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
            }}
          >
            <VocColumn
              title="Top 5 Buying Triggers"
              icon="⚡"
              color="#059669"
              bg="#ECFDF5"
              items={voc?.triggers}
              emptyText='Click "Mine My Data" — surfaces what makes them buy.'
            />
            <VocColumn
              title="Top 5 Objections"
              icon="🛡️"
              color="#DC2626"
              bg="#FEF2F2"
              items={voc?.objections}
              emptyText='Click "Mine My Data" — surfaces why they hesitate.'
            />
            <VocColumn
              title="Top 5 Emotional Drivers"
              icon="❤️"
              color="#7C3AED"
              bg="#F5F3FF"
              items={voc?.emotionalDrivers}
              emptyText='Click "Mine My Data" — surfaces what they want to feel.'
            />
          </div>
          {mining && (
            <div
              style={{
                marginTop: 12,
                fontSize: "0.74rem",
                color: "#EC4899",
              }}
            >
              ⏳ Mining {redditCount} Reddit threads + competitor signals with
              GPT-4o…
            </div>
          )}
        </div>

        {/* Panel C — Activation */}
        <div
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: 18,
            padding: "22px 26px",
            boxShadow: "0 1px 6px rgba(0,0,0,.05)",
          }}
        >
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "1.1rem" }}>🚀</span>
              <div
                style={{
                  fontSize: "1rem",
                  fontWeight: 800,
                  color: "#0A1628",
                }}
              >
                Activation
              </div>
            </div>
            <div
              style={{
                fontSize: "0.74rem",
                color: "#6B7280",
                marginTop: 2,
              }}
            >
              One-click flows that pipe your ICP &amp; VoC into other modules.
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
            }}
          >
            <ActButton
              icon="🎨"
              title="Use as Creative Studio Target"
              desc="Pre-fills your next ad with this ICP as the target persona."
              color="#7C3AED"
              bg="#F5F3FF"
              disabled={!hasICP}
              disabledReason="Build & save your ICP first."
              onClick={actCreativeTarget}
            />
            <ActButton
              icon="✊"
              title="Counter-Objection Caption Pack"
              desc="Generates 5 social posts — one per objection — auto-tagged Nurture stage."
              color="#DC2626"
              bg="#FEF2F2"
              disabled={actDis2}
              disabledReason="Mine your VoC first — needs at least 1 objection."
              busy={act2Busy}
              onClick={actObjectionPack}
            />
            <ActButton
              icon="📧"
              title="Email Sequence for Top Trigger"
              desc="3-email warm-up that leans into your strongest buying trigger."
              color="#0891B2"
              bg="#ECFEFF"
              disabled={actDis3}
              disabledReason="Mine your VoC first — needs at least 1 trigger."
              busy={act3Busy}
              onClick={actEmailSequence}
            />
          </div>
          {actStatus && (
            <div
              style={{
                marginTop: 12,
                fontSize: "0.76rem",
                color: "#0A1628",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span>{actStatus}</span>
              {actStatus.startsWith("✅") && (
                <button
                  type="button"
                  onClick={() => goToView(router, "social")}
                  style={{
                    color: "#7C3AED",
                    fontWeight: 700,
                    textDecoration: "underline",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Open Calendar →
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Email sequence modal */}
      {emailModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setEmailModal(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,30,61,.65)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: 18,
              width: "100%",
              maxWidth: 680,
              maxHeight: "92vh",
              overflowY: "auto",
              boxShadow: "0 24px 80px rgba(0,0,0,.3)",
            }}
          >
            <div
              style={{
                background: "linear-gradient(135deg,#0891B2,#7C3AED)",
                borderRadius: "18px 18px 0 0",
                padding: "20px 24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    color: "#A5F3FC",
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                    marginBottom: 3,
                  }}
                >
                  3-Email Warm-Up Sequence
                </div>
                <div
                  style={{
                    fontSize: "1.05rem",
                    fontWeight: 800,
                    color: "#fff",
                    lineHeight: 1.3,
                  }}
                >
                  ⚡ Trigger: {emailModal.trigger.text}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEmailModal(null)}
                style={{
                  background: "rgba(255,255,255,.18)",
                  border: "none",
                  borderRadius: "50%",
                  width: 32,
                  height: 32,
                  fontSize: "1.1rem",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "20px 22px" }}>
              {emailModal.seq.map((e, i) => (
                <div
                  key={i}
                  style={{
                    background: "#F9FAFB",
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: "16px 18px",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          background:
                            "linear-gradient(135deg,#0891B2,#7C3AED)",
                          color: "white",
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 800,
                          fontSize: "0.78rem",
                        }}
                      >
                        {i + 1}
                      </div>
                      <div
                        style={{
                          fontSize: "0.88rem",
                          fontWeight: 800,
                          color: "#0A1628",
                        }}
                      >
                        {e.subject}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard.writeText(e.body || "")
                      }
                      style={{
                        padding: "5px 12px",
                        background: "white",
                        border: "1px solid #E5E7EB",
                        borderRadius: 7,
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: "#374151",
                        cursor: "pointer",
                      }}
                    >
                      📋 Copy
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#374151",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {e.body}
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    const text = emailModal.seq
                      .map(
                        (e, i) =>
                          `EMAIL ${i + 1}\nSubject: ${e.subject || ""}\n\n${e.body || ""}\n\n────────────────\n`,
                      )
                      .join("\n");
                    navigator.clipboard.writeText(text);
                  }}
                  style={{
                    flex: 1,
                    padding: 11,
                    background: "#F3F4F6",
                    border: "none",
                    borderRadius: 10,
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    color: "#374151",
                    cursor: "pointer",
                  }}
                >
                  📋 Copy All 3 Emails
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEmailModal(null);
                    goToView(router, "reengage");
                  }}
                  style={{
                    flex: 1,
                    padding: 11,
                    background: "linear-gradient(135deg,#7C3AED,#EC4899)",
                    border: "none",
                    borderRadius: 10,
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  → Open Re-Engage Hub
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

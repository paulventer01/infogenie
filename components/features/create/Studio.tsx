"use client";

// Native React port of the legacy `studio` panel (was `window.buildStudio` +
// `#view-studio` in index.html, built by public/js/ig_studio.js). The Creator
// Studio hub renders a grid of tiles; 5 navigate to other tools, the other 8
// open modals (Brand Identity, Image Toolkit, AI Video, Presentation, Email
// Signature, Case Study, Page Insights, SEO Change Log). It calls the same
// Express endpoints as the legacy module:
//   POST /api/studio/ai-suggest · /brand/{logo-brief,palette,names,slogans}
//   POST /api/studio/image/{sketch-to-image,product-shot,upscale-prompt}
//   POST /api/studio/video/{storyboard,render-frames,voiceover,render-mp4}
//   POST /api/studio/presentation/generate · /presentation/:id/images
//   GET  /api/studio/presentation/:id/pptx
//   POST /api/studio/signature/generate · /case-study/generate
//   GET  /api/scroll-tracker/summary · /scroll-tracker/page/:type/:slug
//   GET  /api/site-search/insights/:slug
//   GET  /api/seo-annotations/list · POST /seo-annotations/log · DELETE /:id
//   POST /api/integrations/workspace/drive/upload
// Pre-fills brand/industry/competitors from the legacy `window.analysisData`
// global (set by the home-page competitor analysis), still in the SPA shell.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiDelete, type ApiResult } from "@/lib/api";
import { goToView } from "@/lib/nav";
import { showToast } from "@/hooks/useToast";

// ── Shared studio context (from window.analysisData) ────────────────────────
interface AnalysisCompetitor {
  name?: string;
  domain?: string;
}
interface AnalysisData {
  url?: string;
  industry?: string;
  competitors?: AnalysisCompetitor[];
}
interface Competitor {
  name: string;
  domain: string;
}
interface StudioCtx {
  url: string;
  mainBrand: string;
  industry: string;
  competitors: Competitor[];
}

function domainToBrand(u?: string): string {
  try {
    const h = String(u || "")
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .split(".");
    const core = (h.length >= 2 ? h[h.length - 2] : h[0]) || "";
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch {
    return "";
  }
}

function getStudioCtx(): StudioCtx {
  const ad: AnalysisData =
    typeof window === "undefined"
      ? {}
      : ((window as unknown as { analysisData?: AnalysisData }).analysisData ||
        {});
  const competitors = (Array.isArray(ad.competitors) ? ad.competitors : [])
    .filter((c) => c && (c.name || c.domain))
    .map((c) => ({ name: c.name || domainToBrand(c.domain), domain: c.domain || "" }));
  return {
    url: ad.url || "",
    mainBrand: domainToBrand(ad.url),
    industry: ad.industry || "",
    competitors,
  };
}

// ── API helpers (throw on !ok, like the legacy `_api`) ──────────────────────
async function sPost<T extends ApiResult>(path: string, body?: unknown): Promise<T> {
  const r = await apiPost<T>(path, body);
  if (!r.ok) throw new Error(r.error || "Request failed");
  return r;
}
async function sGet<T extends ApiResult>(path: string): Promise<T> {
  const r = await apiGet<T>(path);
  if (!r.ok) throw new Error(r.error || "Request failed");
  return r;
}

interface SuggestOpts {
  brand?: string;
  industry?: string;
  competitors?: Competitor[];
  currentValue?: string;
  context?: string;
}
async function aiSuggestField(
  ctx: StudioCtx,
  field: string,
  opts: SuggestOpts = {},
): Promise<string> {
  const j = await sPost<{ ok: boolean; value?: string }>("/api/studio/ai-suggest", {
    field,
    brand: opts.brand ?? ctx.mainBrand ?? "",
    industry: opts.industry ?? ctx.industry ?? "",
    competitors: opts.competitors ?? ctx.competitors ?? [],
    currentValue: opts.currentValue ?? "",
    context: opts.context ?? "",
  });
  const v = String(j.value || "").trim();
  if (!v) throw new Error("AI returned an empty suggestion");
  return v;
}

// ── Shared styles ───────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  border: "1.5px solid #E5E7EB",
  borderRadius: 8,
  margin: "6px 0 12px",
  boxSizing: "border-box",
};
const aiBtnStyle: React.CSSProperties = {
  background: "linear-gradient(135deg,#7C3AED,#A855F7)",
  color: "#fff",
  border: 0,
  padding: "4px 10px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const useBrandBtnStyle: React.CSSProperties = {
  background: "#EEF2FF",
  color: "#4F46E5",
  border: "1px solid #C7D2FE",
  padding: "4px 10px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const goBtnStyle: React.CSSProperties = {
  background: "#0066FF",
  color: "white",
  border: 0,
  padding: "12px 24px",
  borderRadius: 8,
  fontWeight: 700,
  cursor: "pointer",
};
const errStyle: React.CSSProperties = { color: "#DC2626" };

// ── Modal shell ─────────────────────────────────────────────────────────────
function Modal({
  title,
  width,
  onClose,
  children,
}: {
  title: string;
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.6)",
        zIndex: 99998,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 16px",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 16,
          maxWidth: width || 640,
          width: "100%",
          padding: 28,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: 0,
              fontSize: 24,
              cursor: "pointer",
              color: "#64748B",
            }}
          >
            ×
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

// ── AI-suggestable field (label row + input + thinking timer + inline error) ─
function AiField({
  label,
  value,
  setValue,
  suggest,
  suggestLabel,
  extraBtn,
  placeholder,
  multiline,
  rows,
  monospace,
  margin,
}: {
  label: React.ReactNode;
  value: string;
  setValue: (v: string) => void;
  suggest?: () => Promise<string>;
  suggestLabel?: string;
  extraBtn?: React.ReactNode;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  monospace?: boolean;
  margin?: string;
}) {
  const [thinking, setThinking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState("");

  async function run() {
    if (!suggest) return;
    setErr("");
    setThinking(true);
    const t0 = performance.now();
    const iv = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
    try {
      const v = await suggest();
      if (!v || !String(v).trim()) throw new Error("AI returned empty value");
      setValue(String(v).trim());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        showToast("AI unavailable: " + msg);
      } catch {
        /* toast best-effort */
      }
      setErr("⚠ " + (msg || "AI unavailable. Connect an API key in Settings."));
      setTimeout(() => setErr(""), 8000);
    } finally {
      clearInterval(iv);
      setThinking(false);
    }
  }

  const display = thinking ? `⏳ Thinking… [${elapsed.toFixed(1)}s]` : value;
  const style: React.CSSProperties = {
    ...inputStyle,
    ...(margin ? { margin } : {}),
    ...(monospace ? { fontFamily: "monospace", fontSize: 12 } : {}),
    ...(multiline ? { fontFamily: monospace ? "monospace" : "inherit" } : {}),
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 6,
          marginTop: 8,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
        <span style={{ display: "flex", gap: 6 }}>
          {extraBtn}
          {suggest && (
            <button type="button" onClick={run} style={aiBtnStyle}>
              🧠 {suggestLabel || "AI Suggest"}
            </button>
          )}
        </span>
      </div>
      {multiline ? (
        <textarea
          value={display}
          disabled={thinking}
          rows={rows || 3}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          style={style}
        />
      ) : (
        <input
          value={display}
          disabled={thinking}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          style={style}
        />
      )}
      {err && <div style={{ ...errStyle, fontSize: 11, marginTop: -6, marginBottom: 8 }}>{err}</div>}
    </>
  );
}

function UseBrandBtn({ label, onClick }: { label: string; onClick: () => void }) {
  if (!label) return null;
  return (
    <button type="button" onClick={onClick} style={useBrandBtnStyle}>
      📊 Use &quot;{label}&quot;
    </button>
  );
}

// ── Google Drive save button ────────────────────────────────────────────────
function DriveSaveButton({ filename, content }: { filename: string; content: string }) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [link, setLink] = useState("");

  async function save() {
    if (link) {
      window.open(link, "_blank");
      return;
    }
    setState("saving");
    const r = await apiPost<{ ok: boolean; error?: string; webViewLink?: string; name?: string }>(
      "/api/integrations/workspace/drive/upload",
      {
        name: filename,
        content,
        mimeType: "text/plain",
        description: "Saved from InfoGenie Creator Studio",
      },
    );
    if (!r.ok) {
      const notConn =
        r.error && (r.error.includes("not connected") || r.error.includes("token_refresh"));
      if (notConn) {
        alert(
          "Google Workspace is not connected.\n\nGo to Settings → Google Workspace → Connect via OAuth to enable Drive saving.",
        );
      } else {
        alert("Drive upload failed: " + (r.error || "unknown"));
      }
      setState("idle");
      return;
    }
    setState("saved");
    if (r.webViewLink) setLink(r.webViewLink);
    try {
      showToast("☁ Saved to Google Drive · " + (r.name || filename));
    } catch {
      /* best-effort */
    }
  }

  return (
    <button
      onClick={save}
      disabled={state === "saving"}
      title={link ? "Click to open in Google Drive" : undefined}
      style={{
        background: state === "saved" ? "#16a34a" : "#4285F4",
        color: "white",
        border: 0,
        padding: "8px 14px",
        borderRadius: 6,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {state === "saving" ? "⏳ Saving…" : state === "saved" ? "✅ Saved!" : "☁ Save to Drive"}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 1. BRAND IDENTITY MODAL
// ════════════════════════════════════════════════════════════════════════════
interface Brief {
  concept?: string;
  symbol?: string;
  wordmarkStyle?: string;
  primaryColor?: string;
  secondaryColor?: string;
  doNotDo?: string[];
  midjourneyPrompt?: string;
}
interface PaletteColor {
  hex: string;
  name: string;
  usage: string;
}
interface BrandName {
  name: string;
  rationale: string;
  score?: number;
}
interface Slogan {
  text: string;
  style: string;
  wordCount?: number;
}

function BrandModal({ ctx, onClose }: { ctx: StudioCtx; onClose: () => void }) {
  const [tab, setTab] = useState(0);
  // Logo
  const [bn, setBn] = useState(ctx.mainBrand);
  const [bi, setBi] = useState(ctx.industry);
  const [bv, setBv] = useState("modern minimalist");
  // Palette
  const [pn, setPn] = useState(ctx.mainBrand);
  const [pm, setPm] = useState("energetic professional");
  // Names
  const [nd, setNd] = useState("");
  const [ns, setNs] = useState("modern");
  // Slogans
  const [sn, setSn] = useState(ctx.mainBrand);
  const [sv, setSv] = useState("");

  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<React.ReactNode>(null);
  const [outErr, setOutErr] = useState("");

  async function aiName(seed: string): Promise<string> {
    const j = await sPost<{ ok: boolean; names?: BrandName[] }>("/api/studio/brand/names", {
      description: `A brand like ${seed || ctx.mainBrand || "this business"} operating in the ${
        ctx.industry || "consumer"
      } space`,
      style: "modern",
      count: 6,
      industry: ctx.industry,
      competitors: ctx.competitors,
    });
    const pick = (j.names || [])[0]?.name;
    if (!pick) throw new Error("AI did not return any brand name candidates");
    return pick;
  }
  async function aiSlogan(brand: string): Promise<string> {
    if (!brand) throw new Error("Fill in Brand name first");
    const j = await sPost<{ ok: boolean; slogans?: Slogan[] }>("/api/studio/brand/slogans", {
      brandName: brand,
      valueProp: sv || "",
      industry: ctx.industry,
      competitors: ctx.competitors,
      count: 6,
    });
    const pick = (j.slogans || [])[0]?.text;
    if (!pick) throw new Error("AI did not return any slogan candidates");
    return pick;
  }

  async function generate() {
    setBusy(true);
    setOut(null);
    setOutErr("");
    try {
      if (tab === 0) {
        const j = await sPost<{ ok: boolean; brief?: Brief }>("/api/studio/brand/logo-brief", {
          brandName: bn,
          industry: bi,
          vibe: bv,
        });
        const b = j.brief || {};
        setOut(
          <div style={{ background: "#F8FAFC", padding: 16, borderRadius: 10 }}>
            <strong>Concept:</strong> {b.concept || ""}
            <br />
            <br />
            <strong>Symbol:</strong> {b.symbol || ""}
            <br />
            <br />
            <strong>Wordmark:</strong> {b.wordmarkStyle || ""}
            <br />
            <br />
            <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
              <div style={{ background: b.primaryColor, width: 60, height: 60, borderRadius: 8 }} />
              <div
                style={{ background: b.secondaryColor, width: 60, height: 60, borderRadius: 8 }}
              />
            </div>
            <strong>Don&apos;t:</strong>
            <ul>{(b.doNotDo || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
            <strong>AI image prompt:</strong>
            <br />
            <code
              style={{
                background: "white",
                padding: 8,
                display: "block",
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              {b.midjourneyPrompt || ""}
            </code>
          </div>,
        );
      } else if (tab === 1) {
        const j = await sPost<{ ok: boolean; palette?: PaletteColor[]; rationale?: string }>(
          "/api/studio/brand/palette",
          { brandName: pn, mood: pm },
        );
        setOut(
          <>
            <div
              style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}
            >
              {(j.palette || []).map((p, i) => (
                <div
                  key={i}
                  style={{
                    background: p.hex,
                    color: "white",
                    padding: 18,
                    borderRadius: 10,
                    textShadow: "0 1px 2px rgba(0,0,0,.4)",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{p.name}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 12 }}>{p.hex}</div>
                  <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>{p.usage}</div>
                </div>
              ))}
            </div>
            <p style={{ color: "#64748B", fontSize: 13, marginTop: 12 }}>{j.rationale || ""}</p>
          </>,
        );
      } else if (tab === 2) {
        const j = await sPost<{ ok: boolean; names?: BrandName[] }>("/api/studio/brand/names", {
          description: nd,
          style: ns,
        });
        setOut(
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
            {(j.names || []).map((n, i) => (
              <div
                key={i}
                style={{
                  background: "#F8FAFC",
                  padding: "12px 14px",
                  borderRadius: 8,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>{n.name}</div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>{n.rationale}</div>
                </div>
                <div
                  style={{
                    background: "#0066FF",
                    color: "white",
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {n.score || "-"}/10
                </div>
              </div>
            ))}
          </div>,
        );
      } else {
        const j = await sPost<{ ok: boolean; slogans?: Slogan[] }>("/api/studio/brand/slogans", {
          brandName: sn,
          valueProp: sv,
        });
        setOut(
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
            {(j.slogans || []).map((s, i) => (
              <div key={i} style={{ background: "#F8FAFC", padding: "12px 14px", borderRadius: 8 }}>
                <div style={{ fontWeight: 600 }}>&quot;{s.text}&quot;</div>
                <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                  {s.style} · {s.wordCount || "?"} words
                </div>
              </div>
            ))}
          </div>,
        );
      }
    } catch (e) {
      setOutErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const tabs = ["Logo Brief", "Palette", "Names", "Slogans"];
  function switchTab(i: number) {
    setTab(i);
    setOut(null);
    setOutErr("");
  }

  return (
    <Modal title="🎨 Brand Identity Studio" width={720} onClose={onClose}>
      <div
        style={{ display: "flex", gap: 8, marginBottom: 18, borderBottom: "1px solid #E5E7EB" }}
      >
        {tabs.map((t, i) => (
          <button
            key={i}
            onClick={() => switchTab(i)}
            style={{
              background: "none",
              border: 0,
              padding: "10px 14px",
              fontWeight: 600,
              cursor: "pointer",
              borderBottom: `2px solid ${i === tab ? "#0066FF" : "transparent"}`,
              color: i === tab ? "#0066FF" : "#64748B",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && (
        <>
          <AiField
            label="Brand name"
            value={bn}
            setValue={setBn}
            placeholder="e.g. Acme"
            suggest={() => aiName(bn)}
            extraBtn={<UseBrandBtn label={ctx.mainBrand} onClick={() => setBn(ctx.mainBrand)} />}
          />
          <AiField
            label="Industry"
            value={bi}
            setValue={setBi}
            placeholder="e.g. SaaS for SMBs"
            suggest={() => aiSuggestField(ctx, "Industry / vertical", { currentValue: bi })}
          />
          <AiField
            label="Vibe"
            value={bv}
            setValue={setBv}
            suggest={() =>
              aiSuggestField(
                ctx,
                'Brand visual vibe (3-5 words, e.g. "warm editorial premium")',
                { currentValue: bv },
              )
            }
          />
        </>
      )}
      {tab === 1 && (
        <>
          <AiField
            label="Brand name"
            value={pn}
            setValue={setPn}
            suggest={() => aiName(pn)}
            extraBtn={<UseBrandBtn label={ctx.mainBrand} onClick={() => setPn(ctx.mainBrand)} />}
          />
          <AiField
            label="Mood"
            value={pm}
            setValue={setPm}
            suggest={() =>
              aiSuggestField(ctx, "Brand mood for a colour palette (2-4 words)", {
                currentValue: pm,
              })
            }
          />
        </>
      )}
      {tab === 2 && (
        <>
          <AiField
            label="Describe the business (1 paragraph)"
            value={nd}
            setValue={setNd}
            multiline
            rows={3}
            placeholder={ctx.industry ? `A ${ctx.industry} brand that…` : "A brand that…"}
            suggest={() =>
              aiSuggestField(
                ctx,
                "One-paragraph description of this business for a naming brief",
                {
                  currentValue: nd,
                  context:
                    "Write 2-3 sentences. Mention the real audience and the real category — no clichés.",
                },
              )
            }
          />
          <AiField
            label="Style"
            value={ns}
            setValue={setNs}
            suggest={() =>
              aiSuggestField(
                ctx,
                'Naming style (single word, e.g. "modern", "editorial", "playful")',
                { currentValue: ns },
              )
            }
          />
        </>
      )}
      {tab === 3 && (
        <>
          <AiField
            label="Brand name"
            value={sn}
            setValue={setSn}
            suggest={() => aiName(sn)}
            extraBtn={<UseBrandBtn label={ctx.mainBrand} onClick={() => setSn(ctx.mainBrand)} />}
          />
          <AiField
            label="Value prop"
            value={sv}
            setValue={setSv}
            multiline
            rows={2}
            placeholder={
              ctx.industry
                ? `What ${ctx.mainBrand || "we"} delivers in ${ctx.industry}…`
                : "What you deliver…"
            }
            suggest={() => aiSlogan(sn)}
          />
        </>
      )}

      <button onClick={generate} disabled={busy} style={{ ...goBtnStyle, marginTop: 6 }}>
        {tab === 0
          ? "Generate logo brief"
          : tab === 1
            ? "Generate palette"
            : tab === 2
              ? "Generate names"
              : "Generate slogans"}
      </button>
      <div style={{ marginTop: 18 }}>
        {busy && "⏳ Generating…"}
        {outErr && <div style={errStyle}>{outErr}</div>}
        {out}
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. IMAGE TOOLKIT MODAL
// ════════════════════════════════════════════════════════════════════════════
function ImageModal({ ctx, onClose }: { ctx: StudioCtx; onClose: () => void }) {
  const [imp, setImp] = useState("");
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState("");
  const [prompt, setPrompt] = useState("");
  const [err, setErr] = useState("");

  async function gen(endpoint: string, body: Record<string, string>) {
    setBusy(true);
    setImg("");
    setErr("");
    try {
      const j = await sPost<{ ok: boolean; image?: string }>(endpoint, body);
      setImg(j.image || "");
      setPrompt(body.prompt || body.product || "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="🖼️ Image Toolkit" width={640} onClose={onClose}>
      <p style={{ color: "#64748B", margin: "0 0 18px" }}>
        Generate product shots, sketches and concept images via Cloudflare Workers AI.
      </p>
      <AiField
        label="What do you want?"
        value={imp}
        setValue={setImp}
        multiline
        rows={3}
        placeholder="e.g. A luxury skincare bottle on marble, soft window light, photo-real"
        suggest={() =>
          aiSuggestField(
            ctx,
            "Image generation prompt — one cinematic sentence describing a real, on-brand product or lifestyle scene",
            {
              currentValue: imp,
              context:
                "The prompt will be sent to an image model. Include subject, setting, lighting, camera/lens cue, mood. No clichés. Match the brand + industry exactly.",
            },
          )
        }
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button
          onClick={() =>
            gen("/api/studio/image/sketch-to-image", {
              prompt: imp || "a clean modern design concept",
            })
          }
          style={{ ...goBtnStyle, padding: "10px 16px", fontWeight: 600 }}
        >
          Generate concept
        </button>
        <button
          onClick={() => gen("/api/studio/image/product-shot", { product: imp || "product" })}
          style={{
            background: "#0F766E",
            color: "white",
            border: 0,
            padding: "10px 16px",
            borderRadius: 8,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Product photo
        </button>
        <button
          onClick={() =>
            gen("/api/studio/image/upscale-prompt", {
              prompt: imp || "a high resolution detailed image",
            })
          }
          style={{
            background: "#7C3AED",
            color: "white",
            border: 0,
            padding: "10px 16px",
            borderRadius: 8,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          High-fidelity render
        </button>
      </div>
      <div>
        {busy && "⏳ Generating image (8-15 sec)…"}
        {err && <div style={errStyle}>{err}</div>}
        {img && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img}
              alt=""
              style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid #E5E7EB" }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <a
                href={img}
                download="image.png"
                style={{
                  background: '#eef4ff',
                  color: "white",
                  padding: "8px 14px",
                  borderRadius: 6,
                  textDecoration: "none",
                  fontSize: 13,
                  display: "inline-block",
                }}
              >
                ⬇ Download
              </a>
              <DriveSaveButton
                filename={"AI Image " + new Date().toLocaleDateString() + ".txt"}
                content={
                  "Image URL: " +
                  img +
                  "\nGenerated: " +
                  new Date().toISOString() +
                  "\nPrompt: " +
                  prompt
                }
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. VIDEO STORYBOARD MODAL
// ════════════════════════════════════════════════════════════════════════════
interface Scene {
  tStart: number;
  tEnd: number;
  visual: string;
  textOverlay?: string;
}
interface Storyboard {
  title?: string;
  voiceoverScript?: string;
  scenes?: Scene[];
  music?: string;
  endFrame?: string;
}
interface Frame {
  tStart: number;
  tEnd: number;
  image?: string;
  error?: string;
}

function VideoModal({ ctx, onClose }: { ctx: StudioCtx; onClose: () => void }) {
  const [vb, setVb] = useState("");
  const [vbComp, setVbComp] = useState("");
  const [vv, setVv] = useState("");
  const [vd, setVd] = useState("15");
  const [busy, setBusy] = useState(false);
  const [story, setStory] = useState<Storyboard | null>(null);
  const [storyId, setStoryId] = useState("");
  const [storyErr, setStoryErr] = useState("");

  const [frames, setFrames] = useState<{ items: Frame[]; note: string } | null>(null);
  const [framesMsg, setFramesMsg] = useState("");
  const [voice, setVoice] = useState<{ mp3Url: string; chars: number } | null>(null);
  const [voiceMsg, setVoiceMsg] = useState("");
  const [mp4, setMp4] = useState<{ mp4Url: string; hasAudio: boolean; scenes: number } | null>(null);
  const [mp4Msg, setMp4Msg] = useState("");

  async function aiBrand(): Promise<string> {
    const seed = ctx.mainBrand || vb;
    if (!seed) throw new Error("Run an analysis or type something first so AI has context");
    const j = await sPost<{ ok: boolean; names?: BrandName[] }>("/api/studio/brand/names", {
      description: `A brand similar to ${seed} in the ${
        ctx.industry || "consumer"
      } space — short, memorable, web-friendly`,
      style: "modern",
      count: 6,
      industry: ctx.industry,
      competitors: ctx.competitors,
    });
    const pick = (j.names || [])[0]?.name;
    if (!pick) throw new Error("AI did not return any brand name candidates");
    return pick;
  }
  async function aiValueProp(): Promise<string> {
    const brand = vb.trim() || ctx.mainBrand;
    if (!brand) throw new Error("Fill in Brand name first");
    const j = await sPost<{ ok: boolean; slogans?: Slogan[] }>("/api/studio/brand/slogans", {
      brandName: brand,
      valueProp: "",
      industry: ctx.industry,
      competitors: ctx.competitors,
      count: 6,
    });
    const pick = (j.slogans || [])[0]?.text;
    if (!pick) throw new Error("AI did not return any slogan candidates");
    return pick;
  }

  async function generate() {
    setBusy(true);
    setStory(null);
    setStoryErr("");
    setFrames(null);
    setVoice(null);
    setMp4(null);
    setFramesMsg("");
    setVoiceMsg("");
    setMp4Msg("");
    try {
      const j = await sPost<{ ok: boolean; id?: string; storyboard?: Storyboard }>(
        "/api/studio/video/storyboard",
        { brandName: vb, valueProp: vv, duration: Number(vd) || 15 },
      );
      setStory(j.storyboard || {});
      setStoryId(j.id || "");
    } catch (e) {
      setStoryErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function renderFrames() {
    setFramesMsg("⏳ Rendering frames via Cloudflare SDXL (may take 30-60s)…");
    setFrames(null);
    try {
      const j = await sPost<{ ok: boolean; frames?: Frame[]; note?: string }>(
        "/api/studio/video/render-frames",
        { id: storyId },
      );
      setFrames({ items: j.frames || [], note: j.note || "" });
      setFramesMsg("");
    } catch (e) {
      setFramesMsg("");
      setFrames(null);
      setFramesErr(e instanceof Error ? e.message : String(e));
    }
  }
  const [framesErr, setFramesErr] = useState("");

  async function renderVoice() {
    setVoiceMsg("⏳ Generating voice-over via OpenAI TTS…");
    setVoice(null);
    try {
      const j = await sPost<{ ok: boolean; mp3Url?: string; chars?: number }>(
        "/api/studio/video/voiceover",
        { id: storyId, voice: "alloy" },
      );
      setVoice({ mp3Url: j.mp3Url || "", chars: j.chars || 0 });
      setVoiceMsg("");
    } catch (e) {
      setVoiceMsg("__err:" + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function renderMp4() {
    setMp4Msg(
      "⏳ Stitching MP4 (needs Render Key Frames first — voice-over auto-attached if generated)…",
    );
    setMp4(null);
    try {
      const j = await sPost<{ ok: boolean; mp4Url?: string; hasAudio?: boolean; scenes?: number }>(
        "/api/studio/video/render-mp4",
        { id: storyId },
      );
      setMp4({ mp4Url: j.mp4Url || "", hasAudio: !!j.hasAudio, scenes: j.scenes || 0 });
      setMp4Msg("");
    } catch (e) {
      setMp4Msg("__err:" + (e instanceof Error ? e.message : String(e)));
    }
  }

  const compOpts = ctx.competitors.map((c) => c.name).filter(Boolean);

  return (
    <Modal title="🎬 AI Video Storyboard" width={720} onClose={onClose}>
      <AiField
        label="Brand name"
        value={vb}
        setValue={setVb}
        placeholder={`e.g. ${ctx.mainBrand || "Acme"}`}
        margin="6px 0 6px"
        suggest={aiBrand}
        extraBtn={
          ctx.mainBrand ? (
            <UseBrandBtn label={ctx.mainBrand} onClick={() => setVb(ctx.mainBrand)} />
          ) : undefined
        }
      />
      {compOpts.length ? (
        <div style={{ margin: "0 0 12px" }}>
          <label style={{ display: "block", fontSize: 11, color: "#6B7280", marginBottom: 4 }}>
            …or pick an analysed competitor
          </label>
          <select
            value={vbComp}
            onChange={(e) => {
              setVbComp(e.target.value);
              if (e.target.value) setVb(e.target.value);
            }}
            style={{
              width: "100%",
              padding: 9,
              border: "1.5px solid #E5E7EB",
              borderRadius: 8,
              background: "#fff",
            }}
          >
            <option value="">— select competitor —</option>
            {compOpts.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "#9CA3AF", margin: "0 0 12px" }}>
          Run an analysis first to pull competitors here.
        </div>
      )}

      <AiField
        label="Value prop"
        value={vv}
        setValue={setVv}
        placeholder="What you want viewers to take away in 15 seconds"
        suggest={aiValueProp}
      />

      <label>
        Duration (seconds)
        <input
          type="number"
          value={vd}
          onChange={(e) => setVd(e.target.value)}
          style={{ ...inputStyle, margin: "6px 0 16px" }}
        />
      </label>
      <button onClick={generate} disabled={busy} style={goBtnStyle}>
        Generate storyboard
      </button>

      <div style={{ marginTop: 18 }}>
        {busy && "⏳ Storyboarding…"}
        {storyErr && <div style={errStyle}>{storyErr}</div>}
        {story && (
          <div style={{ background: "#F8FAFC", padding: 16, borderRadius: 10 }}>
            <h3 style={{ margin: "0 0 4px" }}>{story.title || ""}</h3>
            <p style={{ fontStyle: "italic", color: "#475569", margin: "0 0 16px" }}>
              &quot;{story.voiceoverScript || ""}&quot;
            </p>
            <strong>Scenes:</strong>
            {(story.scenes || []).map((sc, i) => (
              <div
                key={i}
                style={{
                  background: "white",
                  padding: 10,
                  borderRadius: 8,
                  margin: "8px 0",
                  borderLeft: "3px solid #0066FF",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {sc.tStart}s → {sc.tEnd}s
                </div>
                <div style={{ fontSize: 13, color: "#475569" }}>{sc.visual}</div>
                {sc.textOverlay && (
                  <div style={{ fontSize: 12, color: "#0066FF", marginTop: 4 }}>
                    📝 &quot;{sc.textOverlay}&quot;
                  </div>
                )}
              </div>
            ))}
            <p style={{ margin: "12px 0 4px" }}>
              <strong>🎵 Music:</strong> {story.music || ""}
            </p>
            <p style={{ margin: "4px 0" }}>
              <strong>🎬 End frame:</strong> {story.endFrame || ""}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button
                onClick={renderFrames}
                style={{
                  background: "linear-gradient(135deg,#7C3AED,#A855F7)",
                  color: "#fff",
                  border: 0,
                  padding: "10px 18px",
                  borderRadius: 7,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                🖼️ Render Key Frames
              </button>
              <button
                onClick={renderVoice}
                style={{
                  background: "linear-gradient(135deg,#0EA5E9,#06B6D4)",
                  color: "#fff",
                  border: 0,
                  padding: "10px 18px",
                  borderRadius: 7,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                🎙️ Generate Voice-Over
              </button>
              <button
                onClick={renderMp4}
                style={{
                  background: "linear-gradient(135deg,#16A34A,#10B981)",
                  color: "#fff",
                  border: 0,
                  padding: "10px 18px",
                  borderRadius: 7,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                🎬 Stitch to MP4
              </button>
            </div>

            <div style={{ marginTop: 14 }}>
              {framesMsg}
              {framesErr && <div style={errStyle}>{framesErr}</div>}
              {frames && (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
                      gap: 10,
                    }}
                  >
                    {frames.items.map((f, i) =>
                      f.image ? (
                        <div
                          key={i}
                          style={{
                            background: "#fff",
                            border: "1px solid #E5E7EB",
                            borderRadius: 8,
                            overflow: "hidden",
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={f.image} alt="" style={{ width: "100%", display: "block" }} />
                          <div style={{ padding: 6, fontSize: "0.72rem", color: "#64748B" }}>
                            {f.tStart}s–{f.tEnd}s
                          </div>
                        </div>
                      ) : (
                        <div
                          key={i}
                          style={{
                            background: "#FEE2E2",
                            color: "#B91C1C",
                            padding: 8,
                            fontSize: "0.72rem",
                            borderRadius: 6,
                          }}
                        >
                          {f.tStart}s: {f.error || "failed"}
                        </div>
                      ),
                    )}
                  </div>
                  <div style={{ marginTop: 10, fontSize: "0.78rem", color: "#64748B" }}>
                    {frames.note}
                  </div>
                </>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              {voiceMsg.startsWith("__err:") ? (
                <div style={errStyle}>{voiceMsg.slice(6)}</div>
              ) : (
                voiceMsg
              )}
              {voice && (
                <div
                  style={{
                    background: "#F0F9FF",
                    border: "1px solid #BAE6FD",
                    padding: 12,
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontWeight: 800, color: "#075985", marginBottom: 6 }}>
                    🎙️ Voice-over ready ({voice.chars} chars)
                  </div>
                  <audio controls src={voice.mp3Url} style={{ width: "100%" }} />
                </div>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              {mp4Msg.startsWith("__err:") ? <div style={errStyle}>{mp4Msg.slice(6)}</div> : mp4Msg}
              {mp4 && (
                <div
                  style={{
                    background: "#ECFDF5",
                    border: "1px solid #6EE7B7",
                    padding: 12,
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontWeight: 800, color: "#065F46", marginBottom: 6 }}>
                    🎬 MP4 ready — {mp4.scenes} scene(s), {mp4.hasAudio ? "with voice-over" : "video-only"}
                  </div>
                  <video
                    controls
                    src={mp4.mp4Url}
                    style={{ width: "100%", borderRadius: 6, background: "#000" }}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    <a
                      href={mp4.mp4Url}
                      download
                      style={{
                        color: "#065F46",
                        fontWeight: 700,
                        textDecoration: "underline",
                        padding: "4px 0",
                      }}
                    >
                      ⬇ Download MP4
                    </a>
                    <DriveSaveButton
                      filename={"AI Video " + new Date().toLocaleDateString() + ".txt"}
                      content={
                        "MP4 URL: " +
                        mp4.mp4Url +
                        "\nGenerated: " +
                        new Date().toISOString() +
                        "\nScenes: " +
                        mp4.scenes
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. PRESENTATION MODAL
// ════════════════════════════════════════════════════════════════════════════
interface DeckSlide {
  n: number;
  type: string;
  heading?: string;
  subheading?: string;
  bullets?: string[];
  speakerNotes?: string;
  image?: string;
  imageError?: string;
}
interface Deck {
  title?: string;
  subtitle?: string;
  slides?: DeckSlide[];
}

function PresentationModal({ ctx, onClose }: { ctx: StudioCtx; onClose: () => void }) {
  const [pt, setPt] = useState("");
  const [pa, setPa] = useState("investors");
  const [pc, setPc] = useState("10");
  const [status, setStatus] = useState("");
  const [deck, setDeck] = useState<Deck | null>(null);
  const [deckId, setDeckId] = useState("");
  const [imgBusy, setImgBusy] = useState(false);

  async function generate() {
    setStatus("⏳ Generating (" + pc + " slides)… 0s");
    setDeck(null);
    const t0 = Date.now();
    const tick = setInterval(
      () =>
        setStatus(
          "⏳ Generating (" + pc + " slides)… " + Math.floor((Date.now() - t0) / 1000) + "s",
        ),
      500,
    );
    try {
      const j = await sPost<{ ok: boolean; id?: string; deck?: Deck }>(
        "/api/studio/presentation/generate",
        { topic: pt, audience: pa, slideCount: Number(pc) || 10 },
      );
      clearInterval(tick);
      setDeck(j.deck || {});
      setDeckId(j.id || "");
      setStatus("");
    } catch (e) {
      clearInterval(tick);
      setStatus("");
      setDeck(null);
      setGenErr(e instanceof Error ? e.message : String(e));
    }
  }
  const [genErr, setGenErr] = useState("");

  async function addImages() {
    if (!deck) return;
    setImgBusy(true);
    const t0 = Date.now();
    const tick = setInterval(
      () =>
        setStatus(
          "⏳ Generating images… " +
            Math.floor((Date.now() - t0) / 1000) +
            "s (≈10s per slide)",
        ),
      500,
    );
    try {
      const j = await sPost<{ ok: boolean; deck?: Deck }>(
        "/api/studio/presentation/" + encodeURIComponent(deckId) + "/images",
        {},
      );
      clearInterval(tick);
      setDeck(j.deck || deck);
      setStatus("");
    } catch (e) {
      clearInterval(tick);
      setStatus("");
      setGenErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImgBusy(false);
    }
  }

  function downloadPptx() {
    if (!deck) return;
    setStatus("Building .pptx…");
    const a = document.createElement("a");
    a.href = "/api/studio/presentation/" + encodeURIComponent(deckId) + "/pptx";
    a.download = (deck.title || "presentation") + ".pptx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => setStatus("Download started."), 800);
  }

  const hasImages = (deck?.slides || []).some((s) => s.image);

  return (
    <Modal title="📑 AI Presentation Generator" width={760} onClose={onClose}>
      <AiField
        label="Topic"
        value={pt}
        setValue={setPt}
        placeholder={`e.g. Why ${ctx.mainBrand || "our SaaS"} will win the ${
          ctx.industry || "SMB"
        } market`}
        suggest={() =>
          aiSuggestField(
            ctx,
            "Presentation topic / title — one concrete sentence specific to this brand and industry",
            {
              currentValue: pt,
              context:
                'No buzzwords like "redefine" or "category-defining". Reference a real angle a real exec would actually pitch.',
            },
          )
        }
      />
      <AiField
        label="Audience"
        value={pa}
        setValue={setPa}
        suggest={() =>
          aiSuggestField(
            ctx,
            'Target audience for this presentation (e.g. "Series-B SaaS CFOs", "regional Shopify store owners")',
            { currentValue: pa },
          )
        }
      />
      <label>
        Slide count
        <input
          type="number"
          value={pc}
          min={5}
          max={20}
          onChange={(e) => setPc(e.target.value)}
          style={{ ...inputStyle, margin: "6px 0 16px" }}
        />
      </label>
      <button onClick={generate} style={goBtnStyle}>
        Generate deck
      </button>

      <div style={{ marginTop: 18 }}>
        {genErr && <div style={errStyle}>{genErr}</div>}
        {!deck && !genErr && status}
        {deck && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 14px" }}>
              <button
                onClick={addImages}
                disabled={imgBusy}
                style={{
                  background: hasImages ? "#E2E8F0" : "#7C3AED",
                  color: hasImages ? "#475569" : "white",
                  border: 0,
                  padding: "10px 16px",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                🎨 {hasImages ? "Regenerate images" : "Add images to slides"}
              </button>
              <button
                onClick={downloadPptx}
                style={{
                  background: '#eef4ff',
                  color: "white",
                  border: 0,
                  padding: "10px 16px",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                ⬇ PowerPoint
              </button>
              <span style={{ alignSelf: "center", color: "#64748B", fontSize: 12 }}>{status}</span>
            </div>
            <div style={{ background: "#F8FAFC", padding: 16, borderRadius: 10 }}>
              <h2 style={{ margin: 0 }}>{deck.title}</h2>
              <p style={{ color: "#475569", margin: "4px 0 14px" }}>{deck.subtitle || ""}</p>
              {(deck.slides || []).map((s, i) => (
                <div
                  key={i}
                  style={{
                    background: "white",
                    padding: 14,
                    borderRadius: 8,
                    margin: "8px 0",
                    borderLeft: "3px solid #0066FF",
                    display: "grid",
                    gridTemplateColumns: s.image ? "1fr 180px" : "1fr",
                    gap: 14,
                    alignItems: "start",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#94A3B8",
                        textTransform: "uppercase",
                        fontWeight: 700,
                      }}
                    >
                      Slide {s.n} · {s.type}
                    </div>
                    <div style={{ fontWeight: 700, marginTop: 4 }}>{s.heading || ""}</div>
                    {s.subheading && (
                      <div style={{ color: "#64748B", fontSize: 13 }}>{s.subheading}</div>
                    )}
                    {(s.bullets || []).length > 0 && (
                      <ul style={{ margin: "8px 0 0", fontSize: 13, color: "#0F172A" }}>
                        {(s.bullets || []).map((b, bi) => (
                          <li key={bi}>{b}</li>
                        ))}
                      </ul>
                    )}
                    {s.speakerNotes && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: 8,
                          background: "#FEF3C7",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "#78350F",
                        }}
                      >
                        📝 {s.speakerNotes}
                      </div>
                    )}
                    {s.imageError && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: "6px 8px",
                          background: "#FEE2E2",
                          borderRadius: 6,
                          fontSize: 11,
                          color: "#991B1B",
                        }}
                      >
                        Image failed: {s.imageError}
                      </div>
                    )}
                  </div>
                  {s.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.image}
                      alt=""
                      style={{
                        width: 180,
                        height: 135,
                        objectFit: "cover",
                        borderRadius: 6,
                        background: "#F1F5F9",
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. EMAIL SIGNATURE MODAL
// ════════════════════════════════════════════════════════════════════════════
function PlainField({
  label,
  value,
  setValue,
  type,
  extraBtn,
  gridSpan,
  height,
}: {
  label: React.ReactNode;
  value: string;
  setValue: (v: string) => void;
  type?: string;
  extraBtn?: React.ReactNode;
  gridSpan?: string;
  height?: number;
}) {
  return (
    <label style={gridSpan ? { gridColumn: gridSpan } : undefined}>
      {extraBtn ? (
        <span
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
          {extraBtn}
        </span>
      ) : (
        label
      )}
      <input
        type={type || "text"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{
          width: "100%",
          padding: type === "color" ? 6 : 10,
          border: "1.5px solid #E5E7EB",
          borderRadius: 8,
          margin: "6px 0",
          ...(height ? { height } : {}),
        }}
      />
    </label>
  );
}

function SignatureModal({ ctx, onClose }: { ctx: StudioCtx; onClose: () => void }) {
  const websiteDefault = ctx.url ? ctx.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  const [n, setN] = useState("");
  const [t, setT] = useState("");
  const [c, setC] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [web, setWeb] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [logo, setLogo] = useState("");
  const [tag, setTag] = useState("");
  const [color, setColor] = useState("#0066FF");
  const [tracking, setTracking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [html, setHtml] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  function autofill() {
    if (!c) setC(ctx.mainBrand);
    if (!web && websiteDefault) setWeb("https://" + websiteDefault);
  }

  async function generate() {
    setBusy(true);
    setHtml("");
    setErr("");
    setCopied(false);
    try {
      const j = await sPost<{ ok: boolean; html?: string }>("/api/studio/signature/generate", {
        name: n,
        title: t,
        company: c,
        email,
        phone,
        website: web,
        linkedin,
        logoUrl: logo,
        tagline: tag,
        primaryColor: color,
        enableTracking: tracking,
      });
      setHtml(j.html || "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="✍️ Email Signature Designer" width={720} onClose={onClose}>
      {ctx.mainBrand && (
        <div
          style={{
            background: "#EEF2FF",
            border: "1px solid #C7D2FE",
            color: "#3730A3",
            padding: "8px 12px",
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            📊 Auto-fill Company + Website from <strong>{ctx.mainBrand}</strong>?
          </span>
          <button
            type="button"
            onClick={autofill}
            style={{
              background: "#4F46E5",
              color: "#fff",
              border: 0,
              padding: "5px 12px",
              borderRadius: 6,
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Fill
          </button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <PlainField label="Name" value={n} setValue={setN} />
        <label>
          <AiField
            label="Title"
            value={t}
            setValue={setT}
            placeholder="e.g. Head of Growth"
            suggest={() =>
              aiSuggestField(
                ctx,
                "Job title for an email signature — a realistic title for someone at this company in this industry",
                { brand: c || ctx.mainBrand, currentValue: t },
              )
            }
          />
        </label>
        <PlainField
          label="Company"
          value={c}
          setValue={setC}
          extraBtn={<UseBrandBtn label={ctx.mainBrand} onClick={() => setC(ctx.mainBrand)} />}
        />
        <PlainField label="Email" value={email} setValue={setEmail} type="email" />
        <PlainField label="Phone" value={phone} setValue={setPhone} />
        <PlainField label="Website" value={web} setValue={setWeb} />
        <PlainField label="LinkedIn URL" value={linkedin} setValue={setLinkedin} />
        <PlainField label="Logo URL" value={logo} setValue={setLogo} />
        <label style={{ gridColumn: "1/-1" }}>
          <AiField
            label="Tagline"
            value={tag}
            setValue={setTag}
            suggest={async () => {
              const brand = c || ctx.mainBrand;
              if (!brand) throw new Error("Fill in Company first");
              const j = await sPost<{ ok: boolean; slogans?: Slogan[] }>(
                "/api/studio/brand/slogans",
                {
                  brandName: brand,
                  valueProp: "",
                  industry: ctx.industry,
                  competitors: ctx.competitors,
                  count: 6,
                },
              );
              const pick = (j.slogans || [])[0]?.text;
              if (!pick) throw new Error("AI did not return any slogan candidates");
              return pick;
            }}
          />
        </label>
        <PlainField label="Primary color" value={color} setValue={setColor} type="color" height={40} />
      </div>
      <label style={{ marginTop: 8, display: "block" }}>
        <input
          type="checkbox"
          checked={tracking}
          onChange={(e) => setTracking(e.target.checked)}
        />{" "}
        Enable open + click tracking
      </label>
      <button onClick={generate} disabled={busy} style={{ ...goBtnStyle, marginTop: 12 }}>
        Generate signature
      </button>
      <div style={{ marginTop: 18 }}>
        {busy && "⏳ Generating…"}
        {err && <div style={errStyle}>{err}</div>}
        {html && (
          <>
            <h3
              style={{
                margin: "0 0 8px",
                fontSize: 14,
                color: "#64748B",
                textTransform: "uppercase",
              }}
            >
              Preview
            </h3>
            <div
              style={{
                border: "1px dashed #CBD5E1",
                padding: 18,
                borderRadius: 8,
                background: "white",
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
            <h3
              style={{
                margin: "18px 0 8px",
                fontSize: 14,
                color: "#64748B",
                textTransform: "uppercase",
              }}
            >
              HTML (paste into Gmail/Outlook signature settings)
            </h3>
            <textarea
              readOnly
              value={html}
              style={{
                width: "100%",
                height: 120,
                padding: 10,
                border: "1.5px solid #E5E7EB",
                borderRadius: 8,
                fontFamily: "monospace",
                fontSize: 11,
              }}
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText(html);
                setCopied(true);
              }}
              style={{
                marginTop: 8,
                background: '#eef4ff',
                color: "white",
                border: 0,
                padding: "8px 14px",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {copied ? "✓ Copied" : "Copy HTML"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. CASE STUDY MODAL
// ════════════════════════════════════════════════════════════════════════════
interface Metric {
  value: string;
  label: string;
  context: string;
}
interface Section {
  title?: string;
  body?: string;
}
interface CaseStudy {
  headline?: string;
  subheadline?: string;
  metrics?: Metric[];
  pullQuote?: { text?: string; attribution?: string };
  challenge?: Section;
  solution?: Section;
  result?: Section;
}

function CaseStudyModal({ ctx, onClose }: { ctx: StudioCtx; onClose: () => void }) {
  const [cn, setCn] = useState("");
  const [inn, setInn] = useState(ctx.industry || "");
  const [pickComp, setPickComp] = useState("");
  const [bn, setBn] = useState(ctx.mainBrand || "");
  const [ch, setCh] = useState("");
  const [so, setSo] = useState("");
  const [re, setRe] = useState("");
  const [busy, setBusy] = useState(false);
  const [study, setStudy] = useState<CaseStudy | null>(null);
  const [studyId, setStudyId] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setStudy(null);
    setErr("");
    setCopied(false);
    try {
      const j = await sPost<{ ok: boolean; id?: string; study?: CaseStudy }>(
        "/api/studio/case-study/generate",
        {
          customerName: cn,
          industry: inn,
          brandName: bn,
          challenge: ch,
          solution: so,
          result: re,
        },
      );
      setStudy(j.study || {});
      setStudyId(j.id || "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const compOpts = ctx.competitors.map((c) => c.name).filter(Boolean);

  return (
    <Modal title="📰 AI Case Study Builder" width={760} onClose={onClose}>
      <p style={{ color: "#64748B", margin: "0 0 16px" }}>
        Describe a customer story in 3 lines. We&apos;ll write the headline, pull quote, challenge →
        solution → result, metrics and a share-ready landing page.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ gridColumn: "1/2" }}>
          <AiField
            label="Customer name"
            value={cn}
            setValue={setCn}
            placeholder="Acme Logistics"
            suggest={() =>
              aiSuggestField(
                ctx,
                "Realistic customer name for a case study — a plausible real-world company in this industry (NOT Acme/Nexus/Apex/Vega)",
                { industry: inn || ctx.industry, currentValue: cn },
              )
            }
          />
        </div>
        <div style={{ gridColumn: "2/3" }}>
          <AiField
            label="Industry"
            value={inn}
            setValue={setInn}
            placeholder="Logistics"
            suggest={() =>
              aiSuggestField(ctx, "Industry / vertical the customer operates in", {
                currentValue: inn || ctx.industry,
              })
            }
          />
        </div>
      </div>
      {compOpts.length > 0 && (
        <label style={{ display: "block", fontSize: 12, color: "#6B7280", margin: "6px 0" }}>
          …or pick an analysed competitor as the customer
          <select
            value={pickComp}
            onChange={(e) => {
              setPickComp(e.target.value);
              if (e.target.value) setCn(e.target.value);
            }}
            style={{
              width: "100%",
              padding: 9,
              border: "1.5px solid #E5E7EB",
              borderRadius: 8,
              background: "#fff",
              marginTop: 4,
            }}
          >
            <option value="">— select competitor —</option>
            {compOpts.map((nm) => (
              <option key={nm} value={nm}>
                {nm}
              </option>
            ))}
          </select>
        </label>
      )}
      <PlainField
        label="Your brand (optional)"
        value={bn}
        setValue={setBn}
        extraBtn={<UseBrandBtn label={ctx.mainBrand} onClick={() => setBn(ctx.mainBrand)} />}
      />
      <AiField
        label="Challenge they faced"
        value={ch}
        setValue={setCh}
        multiline
        rows={2}
        placeholder="Their conversion rate was stuck at 1.1%, ad spend was ballooning…"
        suggest={() =>
          aiSuggestField(
            ctx,
            "The challenge the customer faced before working with us — 2-3 sentences, concrete numbers, industry-specific pain",
            {
              brand: bn || ctx.mainBrand,
              industry: inn || ctx.industry,
              currentValue: ch,
              context: `Customer: ${cn || "unspecified"}. Real, plausible metrics only — never the same 1.1% conversion / 40% CAC template.`,
            },
          )
        }
      />
      <AiField
        label="Solution you delivered"
        value={so}
        setValue={setSo}
        multiline
        rows={2}
        placeholder="We rebuilt the funnel with our X tool, ran a 30-day creative test…"
        suggest={() =>
          aiSuggestField(
            ctx,
            "The solution we delivered — 2-3 sentences, specific tactics that map to the stated challenge",
            {
              brand: bn || ctx.mainBrand,
              industry: inn || ctx.industry,
              currentValue: so,
              context: `Customer: ${cn || "unspecified"}. Challenge: ${ch || "unspecified"}.`,
            },
          )
        }
      />
      <AiField
        label="Result / outcome (optional — we'll infer if blank)"
        value={re}
        setValue={setRe}
        multiline
        rows={2}
        placeholder="3.2% conversion in 60 days, CAC down 40%…"
        suggest={() =>
          aiSuggestField(
            ctx,
            "The result / outcome — 2-3 sentences, plausible metrics directly tied to the solution and industry",
            {
              brand: bn || ctx.mainBrand,
              industry: inn || ctx.industry,
              currentValue: re,
              context: `Customer: ${cn || "unspecified"}. Solution: ${so || "unspecified"}.`,
            },
          )
        }
      />
      <button onClick={generate} disabled={busy} style={{ ...goBtnStyle, marginTop: 6 }}>
        ✨ Generate case study
      </button>
      <div style={{ marginTop: 18 }}>
        {busy && "⏳ Generating (15-25 sec)…"}
        {err && <div style={errStyle}>{err}</div>}
        {study && (
          <div style={{ background: "#F8FAFC", padding: 18, borderRadius: 12 }}>
            <div
              style={{
                color: "#64748B",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".5px",
                textTransform: "uppercase",
              }}
            >
              Headline
            </div>
            <h2 style={{ margin: "4px 0 6px", fontSize: 22, lineHeight: 1.25 }}>
              {study.headline || ""}
            </h2>
            <p style={{ color: "#475569", margin: "0 0 14px" }}>{study.subheadline || ""}</p>
            {(study.metrics || []).length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                {(study.metrics || []).map((m, i) => (
                  <div
                    key={i}
                    style={{
                      background: "white",
                      padding: 12,
                      borderRadius: 8,
                      textAlign: "center",
                      border: "1px solid #E5E7EB",
                    }}
                  >
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#0066FF" }}>{m.value}</div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{m.label}</div>
                    <div style={{ fontSize: 11, color: "#64748B" }}>{m.context}</div>
                  </div>
                ))}
              </div>
            )}
            {study.pullQuote?.text && (
              <div
                style={{
                  background: "linear-gradient(135deg,#0066FF,#7C3AED)",
                  color: "white",
                  padding: 18,
                  borderRadius: 10,
                  marginBottom: 14,
                }}
              >
                <div style={{ fontSize: 15, lineHeight: 1.5 }}>
                  &quot;{study.pullQuote.text}&quot;
                </div>
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>
                  — {study.pullQuote.attribution || ""}
                </div>
              </div>
            )}
            <details open style={{ marginBottom: 8 }}>
              <summary style={{ fontWeight: 700, cursor: "pointer", padding: "6px 0" }}>
                {study.challenge?.title || "The Challenge"}
              </summary>
              <div
                style={{
                  fontSize: 13,
                  color: "#475569",
                  whiteSpace: "pre-line",
                  padding: "6px 0",
                }}
              >
                {study.challenge?.body || ""}
              </div>
            </details>
            <details style={{ marginBottom: 8 }}>
              <summary style={{ fontWeight: 700, cursor: "pointer", padding: "6px 0" }}>
                {study.solution?.title || "The Solution"}
              </summary>
              <div
                style={{
                  fontSize: 13,
                  color: "#475569",
                  whiteSpace: "pre-line",
                  padding: "6px 0",
                }}
              >
                {study.solution?.body || ""}
              </div>
            </details>
            <details>
              <summary style={{ fontWeight: 700, cursor: "pointer", padding: "6px 0" }}>
                {study.result?.title || "The Result"}
              </summary>
              <div
                style={{
                  fontSize: 13,
                  color: "#475569",
                  whiteSpace: "pre-line",
                  padding: "6px 0",
                }}
              >
                {study.result?.body || ""}
              </div>
            </details>
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a
                href={`/api/studio/case-study/${studyId}/page`}
                target="_blank"
                rel="noreferrer"
                style={{
                  background: '#eef4ff',
                  color: "white",
                  padding: "10px 16px",
                  borderRadius: 8,
                  textDecoration: "none",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                🔗 Open share page
              </a>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.origin}/api/studio/case-study/${studyId}/page`,
                  );
                  setCopied(true);
                }}
                style={{
                  background: "#0F766E",
                  color: "white",
                  border: 0,
                  padding: "10px 16px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                {copied ? "✓ Copied" : "📋 Copy share URL"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 7. PAGE INSIGHTS MODAL
// ════════════════════════════════════════════════════════════════════════════
interface SummaryPage {
  type: string;
  slug: string;
  sessions: number;
  midReadPct: number;
  fullReadPct: number;
}
interface ReadRate {
  p25: number;
  p50: number;
  p75: number;
  p100: number;
}
interface PageDetail {
  sessions: number;
  readRate: ReadRate;
  hint?: string;
}
interface SearchQuery {
  query: string;
  searches: number;
  zeroHits?: number;
}
interface SearchInsights {
  total: number;
  top: SearchQuery[];
  zeroResults: { query: string; searches: number }[];
}

function PageInsightsModal({ onClose }: { onClose: () => void }) {
  const [pages, setPages] = useState<SummaryPage[] | null>(null);
  const [summaryErr, setSummaryErr] = useState("");
  const [pick, setPick] = useState("");
  const [detail, setDetail] = useState<{ sd: PageDetail; ss: SearchInsights | null } | null>(null);
  const [detailMsg, setDetailMsg] = useState("");
  const [detailErr, setDetailErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const j = await sGet<{ ok: boolean; pages: SummaryPage[] }>("/api/scroll-tracker/summary");
        setPages(j.pages || []);
      } catch (e) {
        setSummaryErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  async function load() {
    if (!pick) return;
    const [type, slug] = pick.split("|");
    setDetailMsg("⏳ Loading…");
    setDetail(null);
    setDetailErr("");
    try {
      const sd = await sGet<PageDetail & ApiResult>(
        `/api/scroll-tracker/page/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`,
      );
      let ss: SearchInsights | null = null;
      if (type === "lp") {
        const r = await apiGet<SearchInsights & { ok: boolean }>(
          `/api/site-search/insights/${encodeURIComponent(slug)}`,
        );
        ss = r.ok
          ? { total: r.total, top: r.top || [], zeroResults: r.zeroResults || [] }
          : { total: 0, top: [], zeroResults: [] };
      }
      setDetail({ sd, ss });
      setDetailMsg("");
    } catch (e) {
      setDetailMsg("");
      setDetailErr(e instanceof Error ? e.message : String(e));
    }
  }

  function bar(label: string, pct: number) {
    return (
      <div style={{ margin: "6px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
          <span>{label}</span>
          <span style={{ fontWeight: 700 }}>{pct}%</span>
        </div>
        <div style={{ background: "#F1F5F9", borderRadius: 4, height: 8, overflow: "hidden" }}>
          <div
            style={{
              background: "linear-gradient(90deg,#0066FF,#7C3AED)",
              height: "100%",
              width: `${pct}%`,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <Modal title="📊 Page Insights" width={720} onClose={onClose}>
      <p style={{ color: "#64748B", margin: "0 0 12px", fontSize: 13 }}>
        Every public Site Builder (<code>/lp/…</code>) and Link-in-Bio (<code>/bio/…</code>) page now
        silently tracks scroll depth + internal-search queries. Pages need a few visitors before
        numbers stabilise.
      </p>
      <div>
        {summaryErr ? (
          <div style={errStyle}>{summaryErr}</div>
        ) : !pages ? (
          "Loading leaderboard…"
        ) : pages.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#F8FAFC", textAlign: "left" }}>
                <th style={{ padding: 8 }}>Page</th>
                <th style={{ padding: 8 }}>Sessions</th>
                <th style={{ padding: 8 }}>Read 50%</th>
                <th style={{ padding: 8 }}>Read 100%</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #F1F5F9" }}>
                  <td style={{ padding: 8 }}>
                    <code>
                      /{p.type}/{p.slug}
                    </code>
                  </td>
                  <td style={{ padding: 8 }}>{p.sessions}</td>
                  <td style={{ padding: 8 }}>
                    <span
                      style={{ color: p.midReadPct >= 50 ? "#059669" : "#DC2626", fontWeight: 600 }}
                    >
                      {p.midReadPct}%
                    </span>
                  </td>
                  <td style={{ padding: 8 }}>
                    <span
                      style={{ color: p.fullReadPct >= 20 ? "#059669" : "#DC2626", fontWeight: 600 }}
                    >
                      {p.fullReadPct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: "#94A3B8", fontSize: 13 }}>
            No tracked sessions yet — share one of your pages and the data will appear here within a
            few minutes.
          </p>
        )}
      </div>
      <hr style={{ border: 0, borderTop: "1px solid #E5E7EB", margin: "16px 0" }} />
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, alignItems: "end" }}>
        <label style={{ fontSize: 13 }}>
          Drill into a specific page
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            style={{
              width: "100%",
              padding: 9,
              border: "1.5px solid #E5E7EB",
              borderRadius: 8,
              margin: "4px 0",
            }}
          >
            <option value="">— pick a page —</option>
            {(pages || []).map((p, i) => (
              <option key={i} value={p.type + "|" + p.slug}>
                {p.type}/{p.slug} ({p.sessions} sessions)
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={load}
          style={{
            background: "#0066FF",
            color: "white",
            border: 0,
            padding: "10px 16px",
            borderRadius: 8,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Load
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        {detailMsg}
        {detailErr && <div style={errStyle}>{detailErr}</div>}
        {detail && (
          <>
            <div style={{ background: "#F8FAFC", padding: 14, borderRadius: 10 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>
                📜 Scroll-depth funnel — {detail.sd.sessions} sessions
              </h3>
              {bar("25% read", detail.sd.readRate.p25)}
              {bar("50% read", detail.sd.readRate.p50)}
              {bar("75% read", detail.sd.readRate.p75)}
              {bar("100% read", detail.sd.readRate.p100)}
              {detail.sd.hint && (
                <div
                  style={{
                    color: "#78350F",
                    background: "#FEF3C7",
                    padding: "8px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    marginTop: 10,
                  }}
                >
                  {detail.sd.hint}
                </div>
              )}
            </div>
            {detail.ss && (
              <div
                style={{
                  background: "white",
                  border: "1px solid #E5E7EB",
                  padding: 14,
                  borderRadius: 10,
                  marginTop: 10,
                }}
              >
                <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>
                  🔍 Site-search insights — {detail.ss.total} searches
                </h3>
                {detail.ss.top.length > 0 && (
                  <>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#64748B",
                        textTransform: "uppercase",
                        marginTop: 8,
                      }}
                    >
                      Top queries
                    </div>
                    <div style={{ fontSize: 13 }}>
                      {detail.ss.top.slice(0, 10).map((q, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            padding: "4px 0",
                            borderBottom: "1px solid #F1F5F9",
                          }}
                        >
                          <span>{q.query}</span>
                          <span style={{ color: "#64748B" }}>
                            {q.searches}×{" "}
                            {q.zeroHits ? (
                              <span style={{ color: "#DC2626" }}>{q.zeroHits} zero-result</span>
                            ) : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {detail.ss.zeroResults.length > 0 && (
                  <>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#DC2626",
                        textTransform: "uppercase",
                        marginTop: 12,
                      }}
                    >
                      ⚠ Content gaps (zero-result queries)
                    </div>
                    <div style={{ fontSize: 13, color: "#475569" }}>
                      {detail.ss.zeroResults.slice(0, 10).map((q, i) => (
                        <div key={i} style={{ padding: "3px 0" }}>
                          &quot;{q.query}&quot; ({q.searches}×)
                        </div>
                      ))}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#64748B",
                        marginTop: 6,
                        fontStyle: "italic",
                      }}
                    >
                      → Each of these is a blog post or product you should consider creating.
                    </div>
                  </>
                )}
                {!detail.ss.total && (
                  <p style={{ color: "#94A3B8", fontSize: 13, margin: "6px 0" }}>
                    No searches yet (page has no search block, or no one has searched).
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 8. SEO CHANGE LOG MODAL
// ════════════════════════════════════════════════════════════════════════════
interface Annotation {
  id: string;
  tag: string;
  title: string;
  occurredAt: string;
  description?: string;
  urls?: string[];
}
const TAG_COLOR: Record<string, string> = {
  content: "#0066FF",
  technical: "#7C3AED",
  onpage: "#0F766E",
  backlink: "#DB2777",
  redesign: "#F59E0B",
  launch: "#059669",
  outage: "#DC2626",
  other: "#64748B",
};
const TAG_OPTS = [
  "content",
  "technical",
  "onpage",
  "backlink",
  "redesign",
  "launch",
  "outage",
  "other",
];

function SeoAnnotationsModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [tag, setTag] = useState("content");
  const today = new Date().toISOString().slice(0, 10);
  const [when, setWhen] = useState(today);
  const [desc, setDesc] = useState("");
  const [urls, setUrls] = useState("");
  const [list, setList] = useState<Annotation[] | null>(null);
  const [listErr, setListErr] = useState("");

  async function reload() {
    setListErr("");
    try {
      const j = await sGet<{ ok: boolean; annotations: Annotation[] }>("/api/seo-annotations/list");
      setList(j.annotations || []);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function save() {
    try {
      const urlList = urls
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      await sPost("/api/seo-annotations/log", {
        title,
        description: desc,
        tag,
        urls: urlList,
        occurredAt: when ? new Date(when).toISOString() : undefined,
      });
      try {
        showToast("Logged ✓");
      } catch {
        /* best-effort */
      }
      setTitle("");
      setDesc("");
      setUrls("");
      reload();
    } catch (e) {
      try {
        showToast(e instanceof Error ? e.message : String(e));
      } catch {
        /* best-effort */
      }
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this annotation?")) return;
    await apiDelete("/api/seo-annotations/" + id);
    reload();
  }

  const smallInput: React.CSSProperties = {
    width: "100%",
    padding: 8,
    border: "1.5px solid #E5E7EB",
    borderRadius: 6,
    margin: "3px 0",
  };

  return (
    <Modal title="📌 SEO Change Log" width={700} onClose={onClose}>
      <p style={{ color: "#64748B", margin: "0 0 12px", fontSize: 13 }}>
        Log &quot;what we did&quot; so future-you can answer{" "}
        <em>&quot;did our last edit help?&quot;</em>. Annotations are available for overlay on any
        chart via <code>/api/seo-annotations/list</code>.
      </p>
      <div style={{ background: "#F8FAFC", padding: 14, borderRadius: 10, marginBottom: 14 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>+ Log a change</h3>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
          <label style={{ fontSize: 12 }}>
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Rewrote homepage hero"
              style={smallInput}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Tag
            <select value={tag} onChange={(e) => setTag(e.target.value)} style={smallInput}>
              {TAG_OPTS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            When
            <input
              type="date"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              style={smallInput}
            />
          </label>
        </div>
        <label style={{ fontSize: 12 }}>
          Notes
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
            placeholder="Replaced 'Marketing software' with 'AI marketing OS for SMBs'."
            style={{ ...smallInput, fontFamily: "inherit" }}
          />
        </label>
        <label style={{ fontSize: 12 }}>
          Affected URLs (one per line, optional)
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={2}
            placeholder={"https://example.com/\nhttps://example.com/pricing"}
            style={{ ...smallInput, fontFamily: "monospace", fontSize: 11, margin: "3px 0 8px" }}
          />
        </label>
        <button
          onClick={save}
          style={{
            background: "#0066FF",
            color: "white",
            border: 0,
            padding: "9px 18px",
            borderRadius: 8,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          📌 Log change
        </button>
      </div>
      <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Timeline</h3>
      <div>
        {listErr ? (
          <div style={errStyle}>{listErr}</div>
        ) : !list ? (
          "Loading…"
        ) : list.length ? (
          list.map((a) => {
            const c = TAG_COLOR[a.tag] || "#64748B";
            return (
              <div
                key={a.id}
                style={{ borderLeft: `3px solid ${c}`, padding: "8px 0 8px 12px", marginBottom: 6 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "start",
                    gap: 8,
                  }}
                >
                  <div>
                    <span
                      style={{
                        background: c + "15",
                        color: c,
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 99,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        marginRight: 6,
                      }}
                    >
                      {a.tag}
                    </span>
                    <strong>{a.title}</strong>{" "}
                    <span style={{ color: "#94A3B8", fontSize: 12 }}>
                      · {new Date(a.occurredAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    onClick={() => del(a.id)}
                    style={{
                      background: "#FEE2E2",
                      color: "#991B1B",
                      border: 0,
                      padding: "3px 8px",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    Delete
                  </button>
                </div>
                {a.description && (
                  <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>{a.description}</div>
                )}
                {(a.urls || []).length > 0 && (
                  <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
                    {(a.urls || []).map((u, i) => (
                      <code
                        key={i}
                        style={{
                          background: "#F1F5F9",
                          padding: "1px 6px",
                          borderRadius: 4,
                          marginRight: 4,
                        }}
                      >
                        {u}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <p style={{ color: "#94A3B8", fontSize: 13 }}>No changes logged yet.</p>
        )}
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STUDIO HUB
// ════════════════════════════════════════════════════════════════════════════
interface Tile {
  id: string;
  icon: string;
  title: string;
  desc: string;
  kind: "modal" | "nav";
  target: string;
}
const TILES: Tile[] = [
  { id: "brand", icon: "🎨", title: "Brand Identity", desc: "Logo brief, palette, business names, slogans — all AI-generated.", kind: "modal", target: "brand" },
  { id: "image", icon: "🖼️", title: "Image Toolkit", desc: "Background remove, upscale, sketch→image, product photos.", kind: "modal", target: "image" },
  { id: "video", icon: "🎬", title: "AI Video", desc: "Storyboard a 15-second ad video for Meta / TikTok / YouTube.", kind: "modal", target: "video" },
  { id: "pres", icon: "📑", title: "AI Presentation", desc: "Pitch decks and slide decks generated from a topic.", kind: "modal", target: "pres" },
  { id: "sig", icon: "✍️", title: "Email Signature", desc: "Branded HTML signature with open + click tracking.", kind: "modal", target: "sig" },
  { id: "case", icon: "📰", title: "Case Study Builder", desc: "Turn a customer story into a polished case study + share page.", kind: "modal", target: "case" },
  { id: "insights", icon: "📊", title: "Page Insights", desc: "How far visitors scroll on your landing & bio pages — and what they search for.", kind: "modal", target: "insights" },
  { id: "annot", icon: "📌", title: "SEO Change Log", desc: "Log content / technical / on-page changes and overlay them on every chart.", kind: "modal", target: "annot" },
  { id: "whatsapp", icon: "💬", title: "WhatsApp Channel", desc: "Send WhatsApp messages and reply to inbound chats.", kind: "nav", target: "whatsapp" },
  { id: "voice", icon: "📞", title: "AI Voice Caller", desc: "Outbound voice agent that calls leads and books meetings.", kind: "nav", target: "voice-caller" },
  { id: "bookings", icon: "📅", title: "Bookings", desc: "Public booking page with email confirmation.", kind: "nav", target: "bookings" },
  { id: "site", icon: "🧱", title: "Site Builder", desc: "No-code landing pages — generate full pages from a brief.", kind: "nav", target: "site-builder" },
  { id: "linksell", icon: "🔗", title: "Link-in-Bio + Sell", desc: "Public bio page with links, lead opt-in, and Stripe checkout.", kind: "nav", target: "linksell" },
];

export default function Studio() {
  const router = useRouter();
  const [modal, setModal] = useState<string | null>(null);
  const ctx = useMemo(() => getStudioCtx(), []);

  function onTile(t: Tile) {
    if (t.kind === "nav") {
      goToView(router, t.target);
    } else {
      setModal(t.target);
    }
  }

  return (
    <div>
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>🎨 Creator Studio</h1>
              <p style={{ margin: "6px 0 0", color: "#64748B" }}>
                Brand kit, content &amp; engagement tools — all AI-powered.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="container" style={{ padding: "24px 0 64px" }}>
        <style
          dangerouslySetInnerHTML={{
            __html:
              ".studio-tile:hover{border-color:#0066FF;transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,102,255,.08)}",
          }}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
            gap: 16,
          }}
        >
          {TILES.map((t) => (
            <button
              key={t.id}
              className="studio-tile"
              onClick={() => onTile(t)}
              style={{
                textAlign: "left",
                background: "white",
                border: "1.5px solid #E5E7EB",
                borderRadius: 14,
                padding: 24,
                cursor: "pointer",
                transition: "all .15s",
                fontFamily: "inherit",
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 12 }}>{t.icon}</div>
              <div style={{ fontWeight: 800, fontSize: 17, color: "#0F172A", marginBottom: 6 }}>
                {t.title}
              </div>
              <div style={{ color: "#64748B", fontSize: 13, lineHeight: 1.5 }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {modal === "brand" && <BrandModal ctx={ctx} onClose={() => setModal(null)} />}
      {modal === "image" && <ImageModal ctx={ctx} onClose={() => setModal(null)} />}
      {modal === "video" && <VideoModal ctx={ctx} onClose={() => setModal(null)} />}
      {modal === "pres" && <PresentationModal ctx={ctx} onClose={() => setModal(null)} />}
      {modal === "sig" && <SignatureModal ctx={ctx} onClose={() => setModal(null)} />}
      {modal === "case" && <CaseStudyModal ctx={ctx} onClose={() => setModal(null)} />}
      {modal === "insights" && <PageInsightsModal onClose={() => setModal(null)} />}
      {modal === "annot" && <SeoAnnotationsModal onClose={() => setModal(null)} />}
    </div>
  );
}

"use client";

// Native React port of the legacy `persona-studio` panel (was
// `window.buildPersonaStudio` + `#view-persona-studio` in index.html, defined in
// public/js/ig_creator_suite.js). Manages AI influencer personas against the
// existing Express API (`/api/personas*`) through `lib/api` — create / AI-build /
// edit / delete, plus avatar and content generation.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import PanelHero from "@/components/layout/PanelHero";

interface PersonaForm {
  name: string;
  niche: string;
  age_range: string;
  gender: string;
  appearance_prompt: string;
  personality: string;
  content_voice: string;
  posting_style: string;
}
interface Persona extends PersonaForm {
  id: number;
  avatar_url?: string;
  is_active?: boolean;
  sample_content?: { caption?: string }[];
}
interface Msg {
  type: "info" | "success" | "warning" | "error";
  text: string;
}
interface GenContent {
  caption?: string;
  hashtags?: string[];
  cta?: string;
}

const EMPTY_FORM: PersonaForm = {
  name: "",
  niche: "",
  age_range: "24-28",
  gender: "female",
  appearance_prompt: "",
  personality: "",
  content_voice: "",
  posting_style: "",
};

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid rgba(11, 18, 32, 0.1)",
  borderRadius: 14,
  padding: 20,
  boxShadow: "0 1px 0 rgba(11, 18, 32, 0.04), 0 10px 24px rgba(11, 18, 32, 0.05)",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 42,
  padding: "0 18px",
  border: "none",
  borderRadius: 10,
  background: "linear-gradient(135deg,#0f766e,#0284c7)",
  color: "#fff",
  fontWeight: 800,
  fontSize: "0.84rem",
  cursor: "pointer",
  fontFamily: "inherit",
  boxShadow: "0 4px 14px rgba(15,118,110,0.22)",
};

const btnSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 38,
  padding: "0 14px",
  border: "1.5px solid rgba(11, 18, 32, 0.12)",
  borderRadius: 10,
  background: "#ffffff",
  color: "#0f172a",
  fontWeight: 700,
  fontSize: "0.8rem",
  cursor: "pointer",
  fontFamily: "inherit",
};

const btnDanger: React.CSSProperties = {
  ...btnSecondary,
  color: "#b91c1c",
  borderColor: "rgba(185,28,28,0.25)",
  background: "#fef2f2",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.78rem",
  fontWeight: 700,
  color: "#334155",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid rgba(11, 18, 32, 0.12)",
  borderRadius: 10,
  fontSize: "0.84rem",
  fontFamily: "inherit",
  color: "#0f172a",
  background: "#fff",
  boxSizing: "border-box",
};

const sectionTitle: React.CSSProperties = {
  margin: "0 0 4px",
  fontSize: "0.92rem",
  fontWeight: 800,
  color: "#0f172a",
};

const sectionSub: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: "0.8rem",
  color: "#64748b",
  lineHeight: 1.5,
};

function alertStyle(type: Msg["type"]): React.CSSProperties {
  const map: Record<Msg["type"], { bg: string; border: string; color: string }> = {
    info: { bg: "#eff6ff", border: "#bfdbfe", color: "#1e40af" },
    success: { bg: "#ecfdf5", border: "#a7f3d0", color: "#047857" },
    warning: { bg: "#fffbeb", border: "#fde68a", color: "#b45309" },
    error: { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
  };
  const c = map[type];
  return {
    padding: "10px 14px",
    borderRadius: 10,
    background: c.bg,
    border: `1px solid ${c.border}`,
    color: c.color,
    fontSize: "0.8rem",
    fontWeight: 600,
    lineHeight: 1.45,
  };
}

export default function PersonaStudio() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PersonaForm>(EMPTY_FORM);
  const [aiNiche, setAiNiche] = useState("");
  const [aiAudience, setAiAudience] = useState("");
  const [aiStatus, setAiStatus] = useState<Msg | null>(null);
  const [saveStatus, setSaveStatus] = useState<Msg | null>(null);
  const [aiBuilding, setAiBuilding] = useState(false);

  const [avatarBusyId, setAvatarBusyId] = useState<number | null>(null);

  const [contentId, setContentId] = useState<number | null>(null);
  const [cgType, setCgType] = useState("instagram_caption");
  const [cgProduct, setCgProduct] = useState("");
  const [cgResult, setCgResult] = useState<GenContent | null>(null);
  const [cgLoading, setCgLoading] = useState(false);
  const [cgError, setCgError] = useState("");

  async function load() {
    setLoading(true);
    const r = await apiGet<{ ok?: boolean; personas?: Persona[]; error?: string }>(
      "/api/personas",
    );
    setLoading(false);
    if (r.ok === false || (r.ok !== true && !Array.isArray(r.personas))) {
      setLoadError(r.error || "Failed to load personas.");
      return;
    }
    setLoadError("");
    setPersonas(r.personas || []);
  }

  useEffect(() => {
    load();
  }, []);

  function setField(k: keyof PersonaForm, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function openCreate() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setAiNiche("");
    setAiAudience("");
    setAiStatus(null);
    setSaveStatus(null);
    setModalOpen(true);
  }

  async function openEdit(id: number) {
    const r = await apiGet<{ ok: boolean; persona?: Persona }>(
      `/api/personas/${id}`,
    );
    const p = r.persona;
    if (!p) return;
    setEditId(id);
    setForm({
      name: p.name || "",
      niche: p.niche || "",
      age_range: p.age_range || "",
      gender: p.gender || "female",
      appearance_prompt: p.appearance_prompt || "",
      personality: p.personality || "",
      content_voice: p.content_voice || "",
      posting_style: p.posting_style || "",
    });
    setAiStatus(null);
    setSaveStatus(null);
    setModalOpen(true);
  }

  async function aiBuild() {
    setAiBuilding(true);
    setAiStatus({ type: "info", text: "Building persona with AI…" });
    const r = await apiPost<{ ok: boolean; suggestion?: Partial<Persona> }>(
      "/api/personas/ai-build",
      { niche: aiNiche, target_audience: aiAudience },
    );
    setAiBuilding(false);
    const s = r.suggestion || {};
    if (s.name) {
      setForm({
        name: s.name || "",
        niche: s.niche || aiNiche || "",
        age_range: s.age_range || "",
        gender: s.gender || "female",
        appearance_prompt: s.appearance_prompt || "",
        personality: s.personality || "",
        content_voice: s.content_voice || "",
        posting_style: s.posting_style || "",
      });
      setAiStatus({
        type: "success",
        text: "Persona built — review the fields below and save when ready.",
      });
    } else {
      setAiStatus({ type: "warning", text: "AI build failed — fill in manually." });
    }
  }

  async function save() {
    setSaveStatus({ type: "info", text: "Saving…" });
    const r = editId
      ? await apiPut<{ ok?: boolean; persona?: Persona; error?: string }>(
          `/api/personas/${editId}`,
          form,
        )
      : await apiPost<{ ok?: boolean; persona?: Persona; error?: string }>(
          "/api/personas",
          form,
        );
    if (r.ok === false || (r.ok !== true && !r.persona)) {
      setSaveStatus({ type: "error", text: r.error || "Save failed." });
      return;
    }
    setModalOpen(false);
    load();
  }

  async function del(id: number, name: string) {
    if (!confirm(`Delete persona "${name}"?`)) return;
    await apiDelete(`/api/personas/${id}`);
    load();
  }

  async function genAvatar(id: number) {
    setAvatarBusyId(id);
    const r = await apiPost<{ ok?: boolean; avatar_url?: string; error?: string }>(
      `/api/personas/${id}/generate-avatar`,
      {},
    );
    setAvatarBusyId(null);
    if (r.ok === false || (r.ok !== true && !r.avatar_url)) {
      alert("Avatar error: " + (r.error || "failed"));
      return;
    }
    load();
  }

  function openContent(id: number) {
    setContentId(id);
    setCgType("instagram_caption");
    setCgProduct("");
    setCgResult(null);
    setCgError("");
  }

  async function doGenContent() {
    if (contentId == null) return;
    setCgLoading(true);
    setCgError("");
    setCgResult(null);
    const r = await apiPost<{ ok?: boolean; content?: GenContent; error?: string }>(
      `/api/personas/${contentId}/generate-content`,
      { content_type: cgType, product: cgProduct },
    );
    setCgLoading(false);
    if (r.ok === false || (r.ok !== true && !r.content)) {
      setCgError(r.error || "Generation failed.");
      return;
    }
    setCgResult(r.content || {});
  }

  const activeCount = personas.filter((p) => p.is_active).length;
  const contentPersona = contentId != null ? personas.find((p) => p.id === contentId) : null;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "8px 4px 48px" }}>
      <PanelHero
        group="Create"
        title="🎭 AI Persona Studio"
        subtitle="Design virtual influencer personas — define their niche, appearance, personality, and content voice. Generate consistent avatars and posts from a saved character profile."
        actions={
          personas.length > 0 ? (
            <button type="button" style={btnPrimary} onClick={openCreate}>
              + New Persona
            </button>
          ) : null
        }
      />

      {loadError ? (
        <div style={{ ...alertStyle("error"), marginBottom: 16 }}>{loadError}</div>
      ) : loading ? (
        <div style={{ ...card, textAlign: "center", padding: 48, color: "#64748b", fontSize: "0.88rem" }}>
          Loading personas…
        </div>
      ) : personas.length === 0 ? (
        <div
          style={{
            ...card,
            textAlign: "center",
            padding: "48px 32px",
            background:
              "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(15,118,110,0.08), transparent 70%), #ffffff",
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              margin: "0 auto 20px",
              borderRadius: "50%",
              background: "linear-gradient(135deg,#0f766e,#0284c7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              boxShadow: "0 8px 24px rgba(15,118,110,0.25)",
            }}
          >
            🎭
          </div>
          <h3 style={{ margin: "0 0 8px", fontSize: "1.25rem", fontWeight: 800, color: "#0f172a" }}>
            No AI Personas yet
          </h3>
          <p style={{ margin: "0 auto 24px", maxWidth: 420, fontSize: "0.9rem", color: "#64748b", lineHeight: 1.6 }}>
            Create your first virtual influencer persona — define their niche, personality, appearance, and content voice in minutes.
          </p>
          <button type="button" style={btnPrimary} onClick={openCreate}>
            Create your first persona
          </button>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div style={card}>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>{personas.length}</div>
              <div style={{ marginTop: 4, fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
                Total Personas
              </div>
            </div>
            <div style={card}>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#059669" }}>{activeCount}</div>
              <div style={{ marginTop: 4, fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
                Active
              </div>
            </div>
            <div style={card}>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0284c7" }}>
                {personas.filter((p) => p.avatar_url).length}
              </div>
              <div style={{ marginTop: 4, fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
                With Avatar
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))",
              gap: 16,
            }}
          >
            {personas.map((p) => (
              <div key={p.id} style={{ ...card, padding: 18, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  {p.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.avatar_url}
                      alt={p.name}
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: "50%",
                        objectFit: "cover",
                        flexShrink: 0,
                        border: "2px solid rgba(15,118,110,0.2)",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: "50%",
                        background: "linear-gradient(135deg,#0f766e,#0284c7)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 24,
                        flexShrink: 0,
                        color: "#fff",
                        fontWeight: 800,
                      }}
                    >
                      {p.name?.[0]?.toUpperCase() || "🎭"}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ margin: "0 0 6px", fontSize: "1.05rem", fontWeight: 800, color: "#0f172a" }}>
                      {p.name}
                    </h3>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      <span
                        style={{
                          fontSize: "0.68rem",
                          fontWeight: 700,
                          background: "#ecfdf5",
                          color: "#047857",
                          padding: "3px 10px",
                          borderRadius: 20,
                        }}
                      >
                        {p.niche}
                      </span>
                      <span
                        style={{
                          fontSize: "0.68rem",
                          fontWeight: 600,
                          background: "#f1f5f9",
                          color: "#475569",
                          padding: "3px 10px",
                          borderRadius: 20,
                        }}
                      >
                        {p.age_range} · {p.gender}
                      </span>
                      {p.is_active ? (
                        <span
                          style={{
                            fontSize: "0.68rem",
                            fontWeight: 700,
                            background: "#dbeafe",
                            color: "#1d4ed8",
                            padding: "3px 10px",
                            borderRadius: 20,
                          }}
                        >
                          Active
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: "0.68rem",
                            fontWeight: 600,
                            background: "#f8fafc",
                            color: "#94a3b8",
                            padding: "3px 10px",
                            borderRadius: 20,
                          }}
                        >
                          Inactive
                        </span>
                      )}
                    </div>
                    {p.personality && (
                      <p style={{ margin: "0 0 4px", fontSize: "0.8rem", color: "#64748b", lineHeight: 1.45 }}>
                        {p.personality}
                      </p>
                    )}
                    {p.content_voice && (
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "#94a3b8", lineHeight: 1.45, fontStyle: "italic" }}>
                        &ldquo;{p.content_voice}&rdquo;
                      </p>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={btnSecondary}
                    onClick={() => genAvatar(p.id)}
                    disabled={avatarBusyId === p.id}
                  >
                    {avatarBusyId === p.id ? "Generating…" : "Generate avatar"}
                  </button>
                  <button type="button" style={btnSecondary} onClick={() => openContent(p.id)}>
                    Generate content
                  </button>
                  <button type="button" style={btnSecondary} onClick={() => openEdit(p.id)}>
                    Edit
                  </button>
                  <button type="button" style={btnDanger} onClick={() => del(p.id, p.name)}>
                    Delete
                  </button>
                </div>

                {(p.sample_content || []).length > 0 && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(11,18,32,0.08)" }}>
                    <div
                      style={{
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "#94a3b8",
                        marginBottom: 8,
                      }}
                    >
                      Latest content
                    </div>
                    <div
                      style={{
                        fontSize: "0.82rem",
                        lineHeight: 1.55,
                        background: "#f8fafc",
                        padding: 12,
                        borderRadius: 10,
                        color: "#334155",
                      }}
                    >
                      {p.sample_content![p.sample_content!.length - 1]?.caption || ""}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {modalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(15,23,42,0.45)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 720,
              maxHeight: "90vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 24px 48px rgba(15,23,42,0.18)",
            }}
          >
            <div
              style={{
                padding: "18px 22px",
                borderBottom: "1px solid rgba(11,18,32,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "linear-gradient(135deg,#f0fdfa,#eff6ff)",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 800, color: "#0f172a" }}>
                  {editId ? "Edit AI Persona" : "Create AI Persona"}
                </h3>
                <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                  {editId ? "Update your persona profile" : "Start with AI or fill in manually"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid rgba(11,18,32,0.1)",
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: "1.2rem",
                  color: "#64748b",
                  lineHeight: 1,
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1 }}>
              <div
                style={{
                  background:
                    "radial-gradient(ellipse 80% 70% at 0% 0%, rgba(15,118,110,0.1), transparent 60%), linear-gradient(135deg,#f0fdfa,#eff6ff)",
                  border: "1px solid rgba(15,118,110,0.18)",
                  borderRadius: 12,
                  padding: 18,
                  marginBottom: 22,
                }}
              >
                <h4 style={sectionTitle}>Let AI build it for you</h4>
                <p style={sectionSub}>
                  Enter a niche and target audience — AI will draft a complete persona you can refine.
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr auto",
                    gap: 10,
                    alignItems: "end",
                  }}
                >
                  <div>
                    <label style={labelStyle}>Niche</label>
                    <input
                      style={inputStyle}
                      value={aiNiche}
                      onChange={(e) => setAiNiche(e.target.value)}
                      placeholder="e.g. fitness, beauty, travel"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Target audience</label>
                    <input
                      style={inputStyle}
                      value={aiAudience}
                      onChange={(e) => setAiAudience(e.target.value)}
                      placeholder="e.g. Gen Z women, 18–24"
                    />
                  </div>
                  <button
                    type="button"
                    style={{ ...btnPrimary, minHeight: 42, whiteSpace: "nowrap" }}
                    onClick={aiBuild}
                    disabled={aiBuilding}
                  >
                    {aiBuilding ? "Building…" : "AI Build"}
                  </button>
                </div>
                {aiStatus && (
                  <div style={{ ...alertStyle(aiStatus.type), marginTop: 12 }}>{aiStatus.text}</div>
                )}
              </div>

              <div style={{ marginBottom: 22 }}>
                <h4 style={sectionTitle}>Identity</h4>
                <p style={sectionSub}>Core details that define who this persona is.</p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
                    gap: 14,
                  }}
                >
                  <div>
                    <label style={labelStyle}>Persona name *</label>
                    <input
                      style={inputStyle}
                      value={form.name}
                      onChange={(e) => setField("name", e.target.value)}
                      placeholder="e.g. Aria Chen"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Niche *</label>
                    <input
                      style={inputStyle}
                      value={form.niche}
                      onChange={(e) => setField("niche", e.target.value)}
                      placeholder="e.g. sustainable fashion"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Age range</label>
                    <input
                      style={inputStyle}
                      value={form.age_range}
                      onChange={(e) => setField("age_range", e.target.value)}
                      placeholder="e.g. 24-28"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Gender</label>
                    <select
                      style={{ ...inputStyle, cursor: "pointer" }}
                      value={form.gender}
                      onChange={(e) => setField("gender", e.target.value)}
                    >
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="non-binary">Non-binary</option>
                    </select>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 22 }}>
                <h4 style={sectionTitle}>Appearance</h4>
                <p style={sectionSub}>Used when generating avatar images — be specific for best results.</p>
                <label style={labelStyle}>Appearance prompt</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
                  rows={3}
                  value={form.appearance_prompt}
                  onChange={(e) => setField("appearance_prompt", e.target.value)}
                  placeholder="e.g. Petite East Asian woman, long dark hair, minimalist aesthetic, warm smile…"
                />
              </div>

              <div>
                <h4 style={sectionTitle}>Voice &amp; style</h4>
                <p style={sectionSub}>How this persona speaks and posts across channels.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={labelStyle}>Personality</label>
                    <input
                      style={inputStyle}
                      value={form.personality}
                      onChange={(e) => setField("personality", e.target.value)}
                      placeholder="e.g. confident, witty, relatable, eco-conscious"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Content voice</label>
                    <input
                      style={inputStyle}
                      value={form.content_voice}
                      onChange={(e) => setField("content_voice", e.target.value)}
                      placeholder="e.g. casual but inspiring, never preachy, uses humour"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Posting style</label>
                    <input
                      style={inputStyle}
                      value={form.posting_style}
                      onChange={(e) => setField("posting_style", e.target.value)}
                      placeholder="e.g. daily outfit + weekly brand deals + monthly deep dive"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                padding: "16px 22px",
                borderTop: "1px solid rgba(11,18,32,0.08)",
                background: "#f8fafc",
              }}
            >
              {saveStatus && (
                <div style={{ ...alertStyle(saveStatus.type), marginBottom: 12 }}>{saveStatus.text}</div>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" style={btnSecondary} onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="button" style={btnPrimary} onClick={save}>
                  {editId ? "Save changes" : "Create persona"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {contentId != null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(15,23,42,0.45)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setContentId(null);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 600,
              maxHeight: "90vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 24px 48px rgba(15,23,42,0.18)",
            }}
          >
            <div
              style={{
                padding: "18px 22px",
                borderBottom: "1px solid rgba(11,18,32,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "linear-gradient(135deg,#f0fdfa,#eff6ff)",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 800, color: "#0f172a" }}>
                  Generate content
                </h3>
                {contentPersona && (
                  <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                    for {contentPersona.name} · {contentPersona.niche}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setContentId(null)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid rgba(11,18,32,0.1)",
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: "1.2rem",
                  color: "#64748b",
                  lineHeight: 1,
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 18 }}>
                <div>
                  <label style={labelStyle}>Content type</label>
                  <select
                    style={{ ...inputStyle, cursor: "pointer" }}
                    value={cgType}
                    onChange={(e) => setCgType(e.target.value)}
                  >
                    <option value="instagram_caption">Instagram Caption</option>
                    <option value="tiktok_caption">TikTok Caption</option>
                    <option value="twitter_thread">Twitter/X Thread</option>
                    <option value="youtube_description">YouTube Description</option>
                    <option value="linkedin_post">LinkedIn Post</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Product to feature (optional)</label>
                  <input
                    style={inputStyle}
                    value={cgProduct}
                    onChange={(e) => setCgProduct(e.target.value)}
                    placeholder="e.g. LUMI Vitamin C Serum"
                  />
                </div>
              </div>

              {cgLoading && (
                <div style={{ textAlign: "center", padding: 32, color: "#64748b", fontSize: "0.88rem" }}>
                  Generating content…
                </div>
              )}
              {cgError && <div style={alertStyle("error")}>{cgError}</div>}
              {cgResult && !cgLoading && (
                <div
                  style={{
                    background: "#f8fafc",
                    borderRadius: 12,
                    padding: 18,
                    border: "1px solid rgba(11,18,32,0.08)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.88rem",
                      lineHeight: 1.7,
                      whiteSpace: "pre-wrap",
                      color: "#334155",
                    }}
                  >
                    {cgResult.caption || ""}
                  </div>
                  {(cgResult.hashtags || []).length > 0 && (
                    <div style={{ marginTop: 12, color: "#0284c7", fontSize: "0.82rem", fontWeight: 600 }}>
                      {(cgResult.hashtags || []).join(" ")}
                    </div>
                  )}
                  {cgResult.cta && (
                    <div style={{ marginTop: 10, fontWeight: 700, fontSize: "0.82rem", color: "#0f766e" }}>
                      CTA: {cgResult.cta}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              style={{
                padding: "16px 22px",
                borderTop: "1px solid rgba(11,18,32,0.08)",
                background: "#f8fafc",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button type="button" style={btnPrimary} onClick={doGenContent} disabled={cgLoading}>
                {cgLoading ? "Generating…" : "Generate content"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

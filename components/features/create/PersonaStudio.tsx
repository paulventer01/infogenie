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

export default function PersonaStudio() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loadError, setLoadError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PersonaForm>(EMPTY_FORM);
  const [aiNiche, setAiNiche] = useState("");
  const [aiAudience, setAiAudience] = useState("");
  const [aiStatus, setAiStatus] = useState<Msg | null>(null);
  const [saveStatus, setSaveStatus] = useState<Msg | null>(null);

  const [avatarBusyId, setAvatarBusyId] = useState<number | null>(null);

  const [contentId, setContentId] = useState<number | null>(null);
  const [cgType, setCgType] = useState("instagram_caption");
  const [cgProduct, setCgProduct] = useState("");
  const [cgResult, setCgResult] = useState<GenContent | null>(null);
  const [cgLoading, setCgLoading] = useState(false);
  const [cgError, setCgError] = useState("");

  async function load() {
    const r = await apiGet<{ ok?: boolean; personas?: Persona[]; error?: string }>(
      "/api/personas",
    );
    // Success is ok:true OR a personas array (API historically omitted ok).
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
    setAiStatus({ type: "info", text: "Building persona with AI…" });
    const r = await apiPost<{ ok: boolean; suggestion?: Partial<Persona> }>(
      "/api/personas/ai-build",
      { niche: aiNiche, target_audience: aiAudience },
    );
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
        text: "✓ Persona built — review and save below.",
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

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> AI Persona Studio
              </div>
              <h2 className="view-title">🎭 AI Persona Studio</h2>
              <p className="view-sub">
                Design and manage virtual AI influencer personas — define their
                niche, appearance, personality, content voice, and posting style.
                Generate consistent content and avatars from a saved character
                profile.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {loadError ? (
          <div className="ig-alert ig-alert-error">{loadError}</div>
        ) : (
          <>
            <div className="ig-toolbar" style={{ marginBottom: 16 }}>
              <button className="btn btn-primary" onClick={openCreate}>
                ✨ New Persona
              </button>
            </div>

            {personas.length === 0 ? (
              <div className="ig-empty-state">
                <div className="ies-icon">🎭</div>
                <h3>No AI Personas yet</h3>
                <p>
                  Create your first virtual influencer persona — define their
                  niche, personality, appearance, and content voice.
                </p>
              </div>
            ) : (
              <div className="ig-card-grid">
                {personas.map((p) => (
                  <div className="ig-card" key={p.id} style={{ position: "relative" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                      {p.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.avatar_url}
                          alt={p.name}
                          style={{
                            width: 72,
                            height: 72,
                            borderRadius: "50%",
                            objectFit: "cover",
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 72,
                            height: 72,
                            borderRadius: "50%",
                            background: "linear-gradient(135deg,#667eea,#764ba2)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 28,
                            flexShrink: 0,
                          }}
                        >
                          🎭
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 style={{ margin: "0 0 4px", fontSize: "1.1rem" }}>
                          {p.name}
                        </h3>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            marginBottom: 8,
                          }}
                        >
                          <span className="ig-badge">{p.niche}</span>
                          <span className="ig-badge ig-badge-outline">
                            {p.age_range} · {p.gender}
                          </span>
                          {p.is_active ? (
                            <span className="ig-badge ig-badge-green">Active</span>
                          ) : (
                            <span className="ig-badge ig-badge-muted">Inactive</span>
                          )}
                        </div>
                        {p.personality && (
                          <p
                            style={{
                              margin: "0 0 4px",
                              fontSize: "0.85rem",
                              color: "var(--text-muted)",
                            }}
                          >
                            🧠 {p.personality}
                          </p>
                        )}
                        {p.content_voice && (
                          <p
                            style={{
                              margin: 0,
                              fontSize: "0.85rem",
                              color: "var(--text-muted)",
                            }}
                          >
                            🎙️ {p.content_voice}
                          </p>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        marginTop: 16,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => genAvatar(p.id)}
                        disabled={avatarBusyId === p.id}
                      >
                        {avatarBusyId === p.id ? "⏳ Generating…" : "📸 Generate Avatar"}
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => openContent(p.id)}
                      >
                        ✍️ Generate Content
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => openEdit(p.id)}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        className="btn btn-sm btn-danger-outline"
                        onClick={() => del(p.id, p.name)}
                      >
                        🗑️
                      </button>
                    </div>
                    {(p.sample_content || []).length > 0 && (
                      <div
                        style={{
                          marginTop: 12,
                          paddingTop: 12,
                          borderTop: "1px solid var(--border)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            color: "var(--text-muted)",
                            marginBottom: 8,
                          }}
                        >
                          LATEST CONTENT
                        </div>
                        <div
                          style={{
                            fontSize: "0.85rem",
                            background: "var(--bg-subtle,#f8f9fa)",
                            padding: 10,
                            borderRadius: 8,
                          }}
                        >
                          {p.sample_content![p.sample_content!.length - 1]?.caption || ""}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {modalOpen && (
        <div
          className="ig-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div className="ig-modal" style={{ maxWidth: 680 }}>
            <div className="ig-modal-header">
              <h3>{editId ? "✏️ Edit AI Persona" : "✨ Create AI Persona"}</h3>
              <button
                className="ig-modal-close"
                onClick={() => setModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="ig-modal-body">
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{ fontWeight: 600, display: "block", marginBottom: 6 }}
                >
                  Let AI build it for you
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="ig-input"
                    style={{ flex: 1 }}
                    value={aiNiche}
                    onChange={(e) => setAiNiche(e.target.value)}
                    placeholder="Niche (e.g. fitness, beauty, travel)"
                  />
                  <input
                    className="ig-input"
                    style={{ flex: 1 }}
                    value={aiAudience}
                    onChange={(e) => setAiAudience(e.target.value)}
                    placeholder="Target audience"
                  />
                  <button className="btn btn-secondary" onClick={aiBuild}>
                    🤖 AI Build
                  </button>
                </div>
                {aiStatus && (
                  <div
                    className={`ig-alert ig-alert-${aiStatus.type}`}
                    style={{ margin: "8px 0" }}
                  >
                    {aiStatus.text}
                  </div>
                )}
              </div>
              <div
                style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <label className="ig-label">Persona Name *</label>
                    <input
                      className="ig-input"
                      value={form.name}
                      onChange={(e) => setField("name", e.target.value)}
                      placeholder="e.g. Aria Chen"
                    />
                  </div>
                  <div>
                    <label className="ig-label">Niche *</label>
                    <input
                      className="ig-input"
                      value={form.niche}
                      onChange={(e) => setField("niche", e.target.value)}
                      placeholder="e.g. sustainable fashion"
                    />
                  </div>
                  <div>
                    <label className="ig-label">Age Range</label>
                    <input
                      className="ig-input"
                      value={form.age_range}
                      onChange={(e) => setField("age_range", e.target.value)}
                      placeholder="e.g. 24-28"
                    />
                  </div>
                  <div>
                    <label className="ig-label">Gender</label>
                    <select
                      className="ig-select"
                      value={form.gender}
                      onChange={(e) => setField("gender", e.target.value)}
                    >
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="non-binary">Non-binary</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="ig-label">
                    Appearance Prompt (for image generation)
                  </label>
                  <textarea
                    className="ig-textarea"
                    rows={2}
                    value={form.appearance_prompt}
                    onChange={(e) =>
                      setField("appearance_prompt", e.target.value)
                    }
                    placeholder="e.g. Petite East Asian woman, long dark hair, minimalist aesthetic, warm smile..."
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="ig-label">Personality</label>
                  <input
                    className="ig-input"
                    value={form.personality}
                    onChange={(e) => setField("personality", e.target.value)}
                    placeholder="e.g. confident, witty, relatable, eco-conscious"
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="ig-label">Content Voice</label>
                  <input
                    className="ig-input"
                    value={form.content_voice}
                    onChange={(e) => setField("content_voice", e.target.value)}
                    placeholder="e.g. casual but inspiring, never preachy, uses humour"
                  />
                </div>
                <div>
                  <label className="ig-label">Posting Style</label>
                  <input
                    className="ig-input"
                    value={form.posting_style}
                    onChange={(e) => setField("posting_style", e.target.value)}
                    placeholder="e.g. daily outfit + weekly brand deals + monthly deep dive"
                  />
                </div>
              </div>
            </div>
            <div className="ig-modal-footer">
              {saveStatus && (
                <div
                  className={`ig-alert ig-alert-${saveStatus.type}`}
                  style={{ margin: "8px 0" }}
                >
                  {saveStatus.text}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                  marginTop: 8,
                }}
              >
                <button
                  className="btn btn-outline"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={save}>
                  {editId ? "Save Changes" : "Create Persona"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {contentId != null && (
        <div
          className="ig-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setContentId(null);
          }}
        >
          <div className="ig-modal" style={{ maxWidth: 580 }}>
            <div className="ig-modal-header">
              <h3>✍️ Generate Content</h3>
              <button
                className="ig-modal-close"
                onClick={() => setContentId(null)}
              >
                ×
              </button>
            </div>
            <div className="ig-modal-body">
              <div style={{ marginBottom: 12 }}>
                <label className="ig-label">Content Type</label>
                <select
                  className="ig-select"
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
                <label className="ig-label">Product to feature (optional)</label>
                <input
                  className="ig-input"
                  value={cgProduct}
                  onChange={(e) => setCgProduct(e.target.value)}
                  placeholder="e.g. LUMI Vitamin C Serum"
                />
              </div>
              <div style={{ marginTop: 16 }}>
                {cgLoading && (
                  <div style={{ textAlign: "center", padding: 32 }}>
                    <span className="ig-spinner" />
                  </div>
                )}
                {cgError && (
                  <div className="ig-alert ig-alert-error">{cgError}</div>
                )}
                {cgResult && !cgLoading && (
                  <div
                    style={{
                      background: "var(--bg-subtle,#f8f9fa)",
                      borderRadius: 10,
                      padding: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.9rem",
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {cgResult.caption || ""}
                    </div>
                    {(cgResult.hashtags || []).length > 0 && (
                      <div
                        style={{
                          marginTop: 10,
                          color: "var(--ig-primary,#667eea)",
                          fontSize: "0.85rem",
                        }}
                      >
                        {(cgResult.hashtags || []).join(" ")}
                      </div>
                    )}
                    {cgResult.cta && (
                      <div
                        style={{
                          marginTop: 8,
                          fontWeight: 600,
                          fontSize: "0.85rem",
                        }}
                      >
                        CTA: {cgResult.cta}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="ig-modal-footer">
              <button className="btn btn-primary" onClick={doGenContent}>
                ✨ Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

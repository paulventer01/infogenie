"use client";

// Native React port of the legacy `ai-providers` panel (was
// `window.buildAiProviders` in public/js/ig_manage_pack.js + `#view-ai-providers`).
// Manage BYO OpenAI-compatible LLM endpoints against the existing Express API
// (`GET /api/ai-providers/list` + `/active`, `POST /api/ai-providers/create`,
// `/update/:id`, `/test/:id`, `DELETE /api/ai-providers/:id`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Provider {
  id: string;
  name: string;
  category: string;
  model: string;
  base_url: string;
  api_key_preview?: string;
  is_default?: boolean;
  enabled?: boolean;
  compatible_categories?: string[];
  categories?: string[];
  assignments?: { category: string; enabled?: boolean; is_default?: boolean }[];
}
interface ActiveEntry {
  name: string;
  model: string;
  id?: number | string;
  pool_size?: number;
  mode?: string;
  pool?: { id: number | string; name: string; model: string; is_default?: boolean }[];
}
interface TestState {
  loading?: boolean;
  ok?: boolean;
  text?: string;
}

const CATS = [
  { key: "writing", label: "✍️ Writing", hint: "Copy, ad creative, content calendar, cold emails" },
  {
    key: "analysis",
    label: "🧮 Analysis",
    hint: "Attack plans, scoring, classification, Q&A over your data",
  },
  { key: "vision", label: "👁️ Vision", hint: "Image understanding, brand audits, screenshot reviews" },
  { key: "audio", label: "🎙️ Audio", hint: "Voice-over / TTS for storyboards" },
];

const PRESETS = [
  {
    name: "Kimi K3 (Moonshot)",
    base_url: "https://api.moonshot.ai/v1",
    model: "kimi-k3",
  },
  {
    name: "Groq Llama 3.1 70B",
    base_url: "https://api.groq.com/openai/v1",
    model: "llama-3.1-70b-versatile",
  },
  {
    name: "Z.ai GLM 5.2 (AutoClaw Coding)",
    base_url: "https://api.z.ai/api/coding/paas/v4",
    model: "glm-5.2",
  },
  {
    name: "Z.ai GLM 5.2",
    base_url: "https://api.z.ai/api/paas/v4",
    model: "glm-5.2",
  },
  { name: "DeepSeek Chat", base_url: "https://api.deepseek.com", model: "deepseek-chat" },
  { name: "Mistral Large", base_url: "https://api.mistral.ai/v1", model: "mistral-large-latest" },
  {
    name: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.1-70b-instruct",
  },
  {
    name: "Together AI",
    base_url: "https://api.together.xyz/v1",
    model: "meta-llama/Llama-3-70b-chat-hf",
  },
  { name: "Ollama (local)", base_url: "http://localhost:11434/v1", model: "llama3.1" },
  {
    name: "Azure OpenAI",
    base_url: "https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT",
    model: "gpt-4o",
  },
];

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
  marginBottom: 3,
};
const field: React.CSSProperties = {
  width: "100%",
  padding: 9,
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  boxSizing: "border-box",
};

export default function AiProviders() {
  const [items, setItems] = useState<Provider[] | null>(null);
  const [active, setActive] = useState<Record<string, ActiveEntry>>({});
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const [name, setName] = useState("");
  const [cat, setCat] = useState("writing");
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [pickerCat, setPickerCat] = useState<string | null>(null);
  const [pickerSelected, setPickerSelected] = useState<string[]>([]);
  const [pickerPrimary, setPickerPrimary] = useState<string>("");
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerMsg, setPickerMsg] = useState("");

  async function load() {
    try {
      // Expand existing providers into all compatible tiles (idempotent)
      await apiPost("/api/ai-providers/expand-compatible", {});
      const [list, act] = await Promise.all([
        apiGet<{ items?: Provider[] }>("/api/ai-providers/list"),
        apiGet<{ active?: Record<string, ActiveEntry> }>("/api/ai-providers/active"),
      ]);
      setItems(list.items || []);
      setActive(act.active || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await apiPost("/api/ai-providers/expand-compatible", {});
        if (cancelled) return;
        const [list, act] = await Promise.all([
          apiGet<{ items?: Provider[] }>("/api/ai-providers/list"),
          apiGet<{ active?: Record<string, ActiveEntry> }>("/api/ai-providers/active"),
        ]);
        if (cancelled) return;
        setItems(list.items || []);
        setActive(act.active || {});
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyPreset(p: (typeof PRESETS)[number]) {
    setName(p.name);
    setUrl(p.base_url);
    setModel(p.model);
  }

  async function addProvider() {
    const body = {
      name: name.trim(),
      category: cat,
      base_url: url.trim(),
      model: model.trim(),
      api_key: key.trim(),
      is_default: isDefault,
    };
    if (!body.name || !body.base_url || !body.model || !body.api_key) {
      alert("Name, base URL, model and API key are required.");
      return;
    }
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/ai-providers/create", body);
    if (!r.ok) {
      alert(r.error || "failed");
      return;
    }
    setName("");
    setUrl("");
    setModel("");
    setKey("");
    load();
  }

  async function test(id: string) {
    setTests((p) => ({ ...p, [id]: { loading: true } }));
    const j = await apiPost<{
      ok: boolean;
      latency_ms?: number;
      sample?: string;
      error?: string;
      status?: number | string;
    }>("/api/ai-providers/test/" + id);
    if (j.ok) {
      setTests((p) => ({
        ...p,
        [id]: { ok: true, text: `✅ ${j.latency_ms}ms · "${String(j.sample || "").slice(0, 80)}"` },
      }));
    } else {
      setTests((p) => ({
        ...p,
        [id]: { ok: false, text: `❌ ${j.error || "HTTP " + (j.status || "?")}` },
      }));
    }
  }

  async function setAsDefault(id: string) {
    await apiPost("/api/ai-providers/update/" + id, { is_default: true });
    load();
  }
  async function toggle(it: Provider) {
    await apiPost("/api/ai-providers/update/" + it.id, { enabled: !it.enabled });
    load();
  }
  async function del(id: string) {
    if (!confirm("Delete this provider? Routes using it will fall back to built-in.")) return;
    await apiDelete("/api/ai-providers/" + id);
    load();
  }

  function providersForTile(catKey: string) {
    return (items || []).filter((p) => {
      const compat = p.compatible_categories || [p.category];
      return compat.includes(catKey) || p.category === catKey;
    });
  }

  function openPicker(catKey: string) {
    const inCat = providersForTile(catKey);
    const enabled = inCat
      .filter((p) => p.assignments?.some((a) => a.category === catKey && a.enabled))
      .map((p) => String(p.id));
    // Fallback: if assignments missing, treat home-category enabled providers as selected
    const selected =
      enabled.length > 0
        ? enabled
        : inCat
            .filter((p) => p.category === catKey && p.enabled !== false)
            .map((p) => String(p.id));
    const primary =
      String(
        inCat.find((p) => p.assignments?.some((a) => a.category === catKey && a.is_default))?.id
          || inCat.find((p) => p.category === catKey && p.is_default)?.id
          || selected[0]
          || "",
      );
    setPickerCat(catKey);
    setPickerSelected(selected);
    setPickerPrimary(primary);
    setPickerMsg("");
    setCat(catKey);
  }

  function closePicker() {
    setPickerCat(null);
    setPickerMsg("");
  }

  function togglePickerId(id: string) {
    setPickerSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (!next.includes(pickerPrimary)) {
        setPickerPrimary(next[0] || "");
      }
      return next;
    });
  }

  function selectAllInPicker() {
    if (!pickerCat) return;
    const ids = providersForTile(pickerCat).map((p) => String(p.id));
    setPickerSelected(ids);
    if (!ids.includes(pickerPrimary)) setPickerPrimary(ids[0] || "");
  }

  function clearPickerSelection() {
    setPickerSelected([]);
    setPickerPrimary("");
  }

  async function applyPicker() {
    if (!pickerCat) return;
    setPickerBusy(true);
    setPickerMsg("");
    const r = await apiPost<{
      ok: boolean;
      error?: string;
      mode?: string;
      enabled?: { name: string }[];
    }>("/api/ai-providers/category/" + pickerCat + "/selection", {
      ids: pickerSelected.map(Number),
      primaryId: pickerPrimary ? Number(pickerPrimary) : null,
    });
    setPickerBusy(false);
    if (!r.ok) {
      setPickerMsg(r.error || "Could not save selection");
      return;
    }
    const n = r.enabled?.length || 0;
    setPickerMsg(
      n === 0
        ? "Using built-in providers for this category."
        : n === 1
          ? `Primary set to ${r.enabled?.[0]?.name}.`
          : `Cascade pool of ${n} providers — tries primary first, then the rest.`,
    );
    await load();
  }

  const pickerMeta = CATS.find((c) => c.key === pickerCat);
  const pickerProviders = pickerCat ? providersForTile(pickerCat) : [];

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span> <span className="bc-sep">›</span> AI
                Providers
              </div>
              <h2 className="view-title">🧠 AI Providers</h2>
              <p className="view-sub">
                Plug in any OpenAI-compatible LLM (Groq, DeepSeek, Mistral, OpenRouter, Together,
                Azure OpenAI, Ollama, etc.) and pick a default for each task category — writing,
                analysis, vision, audio.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {error ? (
          <div style={{ color: "#DC2626" }}>{error}</div>
        ) : !items ? (
          <div style={{ color: "#9CA3AF" }}>Loading…</div>
        ) : (
          <>
            <div
              style={{
                background: "#F0F9FF",
                border: "1px solid #BAE6FD",
                borderRadius: 10,
                padding: 14,
                marginBottom: 18,
                fontSize: "0.86rem",
                color: "#075985",
              }}
            >
              <strong>How this works:</strong> Add a provider once — InfoGenie places it on every
              tile it can serve (chat → Writing, Analysis, Audio; multimodal like Kimi K3 → also
              Vision). Click a tile to choose primary / cascade pool, or Select all. Empty = built-ins.
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
                gap: 10,
                marginBottom: 18,
              }}
            >
              {CATS.map((c) => {
                const a = active[c.key];
                const count = providersForTile(c.key).length;
                const open = pickerCat === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => (open ? closePicker() : openPicker(c.key))}
                    style={{
                      textAlign: "left",
                      background: open ? "#ECFDF5" : "#fff",
                      border: open ? "2px solid #0F766E" : "1px solid #E5E7EB",
                      borderRadius: 10,
                      padding: 12,
                      cursor: "pointer",
                      boxShadow: open ? "0 4px 14px rgba(15,118,110,0.12)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontWeight: 800, color: "#0A1628" }}>{c.label}</div>
                      <span style={{ fontSize: "0.68rem", color: "#64748B", fontWeight: 700 }}>
                        {open ? "Close" : "Choose →"}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280", margin: "4px 0 8px" }}>
                      {c.hint}
                    </div>
                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: a ? "#065F46" : "#9CA3AF",
                        fontWeight: 700,
                      }}
                    >
                      {a
                        ? a.pool_size && a.pool_size > 1
                          ? `${a.name} · cascade ×${a.pool_size}`
                          : `${a.name} · ${a.model}`
                        : "— (using built-in)"}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 6 }}>
                      {count} compatible provider{count === 1 ? "" : "s"}
                    </div>
                  </button>
                );
              })}
            </div>

            {pickerCat && pickerMeta && (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #A7F3D0",
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 18,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: "1rem", color: "#0F172A" }}>
                      Providers for {pickerMeta.label.replace(/^[^\s]+\s/, "")}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#64748B", marginTop: 4, maxWidth: 560 }}>
                      Pick one primary, or select several to run as a cascade pool (tries primary
                      first, then the rest on failure). Clear all to use built-in models.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={selectAllInPicker}
                      disabled={!pickerProviders.length}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: "1px solid #A7F3D0",
                        background: "#ECFDF5",
                        color: "#0F766E",
                        fontWeight: 700,
                        fontSize: "0.78rem",
                        cursor: pickerProviders.length ? "pointer" : "not-allowed",
                      }}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={clearPickerSelection}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: "1px solid #E5E7EB",
                        background: "#F8FAFC",
                        color: "#475569",
                        fontWeight: 700,
                        fontSize: "0.78rem",
                        cursor: "pointer",
                      }}
                    >
                      Use built-in
                    </button>
                  </div>
                </div>

                {pickerProviders.length === 0 ? (
                  <div style={{ marginTop: 14, fontSize: "0.85rem", color: "#94A3B8" }}>
                    No compatible providers for this tile yet. Add an OpenAI-compatible LLM below —
                    it will be placed on every tile it can serve.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                    {pickerProviders.map((p) => {
                      const id = String(p.id);
                      const checked = pickerSelected.includes(id);
                      const isPrimary = pickerPrimary === id;
                      return (
                        <div
                          key={id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: checked ? "1px solid #6EE7B7" : "1px solid #E5E7EB",
                            background: checked ? "#F0FDF4" : "#F8FAFC",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePickerId(id)}
                            style={{ width: 16, height: 16 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "0.9rem" }}>
                              {p.name}
                              {isPrimary && checked && (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    fontSize: "0.65rem",
                                    background: "#D1FAE5",
                                    color: "#065F46",
                                    padding: "2px 6px",
                                    borderRadius: 8,
                                  }}
                                >
                                  PRIMARY
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
                              {p.model} · {p.base_url}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!checked}
                            onClick={() => setPickerPrimary(id)}
                            style={{
                              padding: "5px 10px",
                              borderRadius: 6,
                              border: "1px solid #E5E7EB",
                              background: isPrimary ? "#FEF3C7" : "#fff",
                              color: "#92400E",
                              fontSize: "0.72rem",
                              fontWeight: 700,
                              cursor: checked ? "pointer" : "not-allowed",
                              opacity: checked ? 1 : 0.45,
                            }}
                          >
                            Set primary
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={pickerBusy}
                    onClick={applyPicker}
                    style={{
                      padding: "9px 16px",
                      borderRadius: 8,
                      border: "none",
                      background: "#0F766E",
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    {pickerBusy ? "Saving…" : "Apply to this tile"}
                  </button>
                  <button
                    type="button"
                    onClick={closePicker}
                    style={{
                      padding: "9px 14px",
                      borderRadius: 8,
                      border: "1px solid #E5E7EB",
                      background: "#fff",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  {pickerMsg && (
                    <span style={{ fontSize: "0.8rem", color: "#0F766E", fontWeight: 600 }}>
                      {pickerMsg}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 18,
                marginBottom: 18,
              }}
            >
              <h3 style={{ margin: "0 0 12px", fontFamily: "Sora,sans-serif" }}>➕ Add Provider</h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <div>
                  <label style={fieldLabel}>DISPLAY NAME</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Groq Llama 3.1"
                    style={field}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>CATEGORY</label>
                  <select value={cat} onChange={(e) => setCat(e.target.value)} style={field}>
                    {CATS.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={fieldLabel}>BASE URL (OpenAI-compatible)</label>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://api.groq.com/openai/v1"
                    style={field}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>MODEL</label>
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="llama-3.1-70b-versatile"
                    style={field}
                  />
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <label style={fieldLabel}>API KEY</label>
                  <input
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="sk-…"
                    style={field}
                  />
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "0.84rem",
                      color: "#374151",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isDefault}
                      onChange={(e) => setIsDefault(e.target.checked)}
                    />{" "}
                    Set as default for this category
                  </label>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>
                  PRESETS (click to pre-fill)
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {PRESETS.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => applyPreset(p)}
                      style={{
                        background: p.model === "kimi-k3" ? "#ECFDF5" : "#F3F4F6",
                        border: p.model === "kimi-k3" ? "1px solid #A7F3D0" : "1px solid #E5E7EB",
                        color: p.model === "kimi-k3" ? "#0F766E" : "#374151",
                        padding: "5px 10px",
                        borderRadius: 14,
                        fontSize: "0.74rem",
                        cursor: "pointer",
                        fontWeight: p.model === "kimi-k3" ? 700 : 400,
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                {(model === "kimi-k3" || /moonshot\.ai|kimi\.ai/i.test(url)) && (
                  <p style={{ margin: "8px 0 0", fontSize: "0.72rem", color: "#0F766E", lineHeight: 1.4 }}>
                    Kimi K3 always thinks. InfoGenie sends <code>reasoning_effort=high</code> by default
                    (override with <code>KIMI_REASONING_EFFORT</code>) and omits fixed sampling params.
                    Get a key at platform.kimi.ai — K3 requires a small top-up to unlock.
                  </p>
                )}
              </div>
              <button
                onClick={addProvider}
                style={{
                  background: "linear-gradient(135deg,#0066FF,#7C3AED)",
                  color: "#fff",
                  border: 0,
                  padding: "10px 22px",
                  borderRadius: 7,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                💾 Add Provider
              </button>
            </div>

            <h3 style={{ margin: "0 0 10px", fontFamily: "Sora,sans-serif" }}>
              📚 Configured Providers ({items.length})
            </h3>
            {items.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map((it) => {
                  const t = tests[it.id];
                  return (
                    <div
                      key={it.id}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderRadius: 10,
                        padding: 14,
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 800, color: "#0A1628" }}>
                          {it.name}{" "}
                          {it.is_default && (
                            <span
                              style={{
                                background: "#D1FAE5",
                                color: "#065F46",
                                fontSize: "0.68rem",
                                padding: "2px 6px",
                                borderRadius: 10,
                                marginLeft: 6,
                              }}
                            >
                              DEFAULT
                            </span>
                          )}{" "}
                          {!it.enabled && (
                            <span
                              style={{
                                background: "#FEE2E2",
                                color: "#991B1B",
                                fontSize: "0.68rem",
                                padding: "2px 6px",
                                borderRadius: 10,
                                marginLeft: 6,
                              }}
                            >
                              DISABLED
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: 3 }}>
                          home: {it.category} ·{" "}
                          <code style={{ background: "#F3F4F6", padding: "1px 5px", borderRadius: 3 }}>
                            {it.model}
                          </code>{" "}
                          · {it.base_url} · key {it.api_key_preview || "(not set)"}
                        </div>
                        {(it.compatible_categories || it.categories || []).length > 0 && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                            {(it.compatible_categories || it.categories || []).map((c) => {
                              const on = it.assignments?.some((a) => a.category === c && a.enabled);
                              return (
                                <span
                                  key={c}
                                  style={{
                                    fontSize: "0.65rem",
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.04em",
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    background: on ? "#D1FAE5" : "#F1F5F9",
                                    color: on ? "#065F46" : "#64748B",
                                  }}
                                >
                                  {c}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {t && t.text && (
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: "0.78rem",
                              color: t.ok ? "#065F46" : "#991B1B",
                              fontWeight: 700,
                            }}
                          >
                            {t.text}
                          </div>
                        )}
                        {t && t.loading && (
                          <div style={{ marginTop: 6, fontSize: "0.78rem", color: "#9CA3AF" }}>
                            ⏳ Testing…
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={() => test(it.id)}
                          style={{
                            background: "#F0F9FF",
                            border: "1px solid #BAE6FD",
                            color: "#075985",
                            padding: "6px 12px",
                            borderRadius: 6,
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          🧪 Test
                        </button>
                        <button
                          onClick={() => setAsDefault(it.id)}
                          style={{
                            background: "#FEF3C7",
                            border: "1px solid #FCD34D",
                            color: "#92400E",
                            padding: "6px 12px",
                            borderRadius: 6,
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          ⭐ Default
                        </button>
                        <button
                          onClick={() => toggle(it)}
                          style={{
                            background: "#F3F4F6",
                            border: "1px solid #E5E7EB",
                            color: "#374151",
                            padding: "6px 12px",
                            borderRadius: 6,
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {it.enabled ? "⏸ Disable" : "▶ Enable"}
                        </button>
                        <button
                          onClick={() => del(it.id)}
                          style={{
                            background: "#FEE2E2",
                            border: "1px solid #FCA5A5",
                            color: "#991B1B",
                            padding: "6px 12px",
                            borderRadius: 6,
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: "#9CA3AF", fontSize: "0.85rem" }}>
                No providers configured yet — add one above.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

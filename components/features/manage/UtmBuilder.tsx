"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface UtmLink {
  id: number;
  label: string;
  destination: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string | null;
  utm_term: string | null;
  full_url: string;
  slug: string | null;
  click_count: number;
  last_clicked: string | null;
  created_at: string;
}

interface Preset {
  id: number;
  label: string;
  source: string;
  medium: string;
  campaign: string | null;
}

const CHANNEL_PRESETS: Preset[] = [
  { id: -1, label: "Google / CPC", source: "google", medium: "cpc", campaign: null },
  { id: -2, label: "Meta / Paid Social", source: "meta", medium: "paid_social", campaign: null },
  { id: -3, label: "LinkedIn / Paid Social", source: "linkedin", medium: "paid_social", campaign: null },
  { id: -4, label: "TikTok / Paid Social", source: "tiktok", medium: "paid_social", campaign: null },
  { id: -5, label: "Email / Newsletter", source: "email", medium: "newsletter", campaign: null },
  { id: -6, label: "Organic / Social", source: "instagram", medium: "organic_social", campaign: null },
];

function buildUrl(dest: string, source: string, medium: string, campaign: string, content: string, term: string) {
  try {
    const base = dest.startsWith("http") ? dest : "https://" + dest;
    const u = new URL(base);
    if (source) u.searchParams.set("utm_source", source);
    if (medium) u.searchParams.set("utm_medium", medium);
    if (campaign) u.searchParams.set("utm_campaign", campaign);
    if (content) u.searchParams.set("utm_content", content);
    if (term) u.searchParams.set("utm_term", term);
    return u.toString();
  } catch { return dest; }
}

function shortUrl(slug: string | null) {
  if (!slug) return null;
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/l/${slug}`;
}

export default function UtmBuilder() {
  const [links, setLinks] = useState<UtmLink[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<"builder" | "links" | "presets">("builder");

  const [form, setForm] = useState({
    label: "", destination: "", utm_source: "", utm_medium: "",
    utm_campaign: "", utm_content: "", utm_term: "",
  });
  const [presetForm, setPresetForm] = useState({ label: "", source: "", medium: "", campaign: "" });

  const preview = buildUrl(form.destination, form.utm_source, form.utm_medium, form.utm_campaign, form.utm_content, form.utm_term);

  const load = useCallback(async () => {
    setLoading(true);
    const [l, p] = await Promise.all([
      apiGet<{ ok: boolean; error?: string; links?: UtmLink[] }>("/api/utm-builder/links"),
      apiGet<{ ok: boolean; error?: string; presets?: Preset[] }>("/api/utm-builder/presets"),
    ]);
    if (l?.links) setLinks(l.links);
    if (p?.presets) setPresets(p.presets);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function applyPreset(p: Preset) {
    setForm(f => ({ ...f, utm_source: p.source, utm_medium: p.medium, utm_campaign: p.campaign || f.utm_campaign }));
  }

  async function handleSave() {
    if (!form.destination || !form.utm_source || !form.utm_medium || !form.utm_campaign) {
      setToast("Fill in destination, source, medium and campaign."); setTimeout(() => setToast(""), 3000); return;
    }
    setSaving(true);
    const r = await apiPost<{ ok: boolean; error?: string; link?: UtmLink }>("/api/utm-builder/links", form);
    if (r?.ok && r.link) {
      const link = r.link;
      setLinks(prev => [link, ...prev]);
      setForm({ label: "", destination: "", utm_source: "", utm_medium: "", utm_campaign: "", utm_content: "", utm_term: "" });
      setTab("links");
      setToast("✅ Link saved!"); setTimeout(() => setToast(""), 2500);
    } else {
      setToast("Error saving link."); setTimeout(() => setToast(""), 3000);
    }
    setSaving(false);
  }

  async function handleDeleteLink(id: number) {
    await apiDelete(`/api/utm-builder/links/${id}`);
    setLinks(prev => prev.filter(l => l.id !== id));
  }

  async function handleSavePreset() {
    if (!presetForm.label || !presetForm.source || !presetForm.medium) {
      setToast("Label, source and medium are required."); setTimeout(() => setToast(""), 3000); return;
    }
    const r = await apiPost<{ ok: boolean; error?: string; preset?: Preset }>("/api/utm-builder/presets", presetForm);
    if (r?.ok && r.preset) {
      const preset = r.preset;
      setPresets(prev => { const idx = prev.findIndex(p => p.id === preset.id); return idx >= 0 ? prev.map(p => p.id === preset.id ? preset : p) : [preset, ...prev]; });
      setPresetForm({ label: "", source: "", medium: "", campaign: "" });
      setToast("✅ Preset saved!"); setTimeout(() => setToast(""), 2500);
    }
  }

  async function handleDeletePreset(id: number) {
    await apiDelete(`/api/utm-builder/presets/${id}`);
    setPresets(prev => prev.filter(p => p.id !== id));
  }

  function copyText(text: string, key: string) {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2000); });
  }

  const cardStyle: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 2px 8px rgba(10,20,50,.06)" };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 };
  const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", background: "#fff", outline: "none", boxSizing: "border-box" };
  const btnPrimary: React.CSSProperties = { padding: "10px 22px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" };
  const btnGhost: React.CSSProperties = { padding: "7px 14px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 8, color: "#374151", fontWeight: 600, fontSize: "0.78rem", cursor: "pointer" };

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, background: "#0A1628", color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>
      )}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Manage › UTM Builder</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>🔗 UTM Architecture</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>Build standardised UTM-tagged URLs with click tracking. Every saved link gets a short redirect URL — clicks are counted automatically.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {(["builder", "links", "presets"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#0066FF" : "transparent"}`, color: tab === t ? "#0066FF" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: "pointer", textTransform: "capitalize", marginBottom: -2 }}>
            {t === "builder" ? "🔨 Builder" : t === "links" ? `📋 Saved Links (${links.length})` : "⚡ Presets"}
          </button>
        ))}
      </div>

      {tab === "builder" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Form */}
          <div style={cardStyle}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 16 }}>Build UTM URL</div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Quick-fill channel</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[...CHANNEL_PRESETS, ...presets].map(p => (
                  <button key={p.id} onClick={() => applyPreset(p)} style={{ padding: "5px 12px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 20, fontSize: "0.72rem", fontWeight: 600, color: "#1D4ED8", cursor: "pointer" }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {[
                { key: "label", placeholder: "e.g. Q3 Google Brand Campaign", label: "Link Label" },
                { key: "destination", placeholder: "https://yourdomain.com/landing-page", label: "Destination URL *" },
                { key: "utm_source", placeholder: "google", label: "utm_source *" },
                { key: "utm_medium", placeholder: "cpc", label: "utm_medium *" },
                { key: "utm_campaign", placeholder: "brand-q3-2026", label: "utm_campaign *" },
                { key: "utm_content", placeholder: "ad-variant-a (optional)", label: "utm_content" },
                { key: "utm_term", placeholder: "best crm software (optional)", label: "utm_term" },
              ].map(({ key, placeholder, label }) => (
                <div key={key}>
                  <label style={labelStyle}>{label}</label>
                  <input style={inputStyle} placeholder={placeholder} value={(form as Record<string, string>)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
            </div>

            <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary, marginTop: 16, width: "100%", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving…" : "💾 Save & Get Short URL"}
            </button>
          </div>

          {/* Preview */}
          <div>
            <div style={cardStyle}>
              <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 12 }}>Live Preview</div>
              <div style={{ background: "#F8FAFF", border: "1.5px solid #E0EAFF", borderRadius: 10, padding: "14px 16px", wordBreak: "break-all", fontSize: "0.8rem", color: "#1E3A8A", lineHeight: 1.7, minHeight: 80, fontFamily: "monospace" }}>
                {preview || <span style={{ color: "#94A3B8" }}>Fill in the form to preview your UTM URL…</span>}
              </div>
              {preview && (
                <button onClick={() => copyText(preview, "preview")} style={{ ...btnPrimary, marginTop: 12, width: "100%" }}>
                  {copied === "preview" ? "✅ Copied!" : "📋 Copy Full URL"}
                </button>
              )}
            </div>

            <div style={{ ...cardStyle, background: "#FFFBEB", border: "1px solid #FDE68A" }}>
              <div style={{ fontWeight: 800, color: "#92400E", fontSize: "0.85rem", marginBottom: 8 }}>📐 UTM Best Practices</div>
              <ul style={{ margin: 0, paddingLeft: 16, color: "#78350F", fontSize: "0.78rem", lineHeight: 1.8 }}>
                <li>Use <strong>lowercase</strong> and <strong>underscores</strong> — no spaces or capitals</li>
                <li><strong>utm_source</strong>: referring platform (google, meta, email)</li>
                <li><strong>utm_medium</strong>: channel type (cpc, paid_social, newsletter)</li>
                <li><strong>utm_campaign</strong>: campaign name or ID (brand-q3, promo-launch)</li>
                <li><strong>utm_content</strong>: ad variant or creative identifier</li>
                <li><strong>utm_term</strong>: keyword for paid search campaigns</li>
                <li>Short URLs track clicks automatically — share them instead</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {tab === "links" && (
        <div style={cardStyle}>
          <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 16 }}>Saved UTM Links</div>
          {loading ? (
            <div style={{ color: "#94A3B8", textAlign: "center", padding: 40 }}>Loading…</div>
          ) : links.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#94A3B8" }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>🔗</div>
              <div style={{ fontWeight: 600 }}>No UTM links yet — build your first one on the Builder tab.</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #E8EEF8", color: "#475569", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: ".05em" }}>
                    {["Label", "Source / Medium", "Campaign", "Short URL", "Clicks", ""].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {links.map(l => {
                    const short = shortUrl(l.slug);
                    return (
                      <tr key={l.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 700, color: "#0A1628", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <a href={l.full_url} target="_blank" rel="noopener noreferrer" style={{ color: "#0A1628", textDecoration: "none" }} title={l.full_url}>{l.label}</a>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#475569" }}>
                          <div style={{ fontSize: "0.8rem" }}>{l.utm_source}</div>
                          <div style={{ fontSize: "0.72rem", color: "#94A3B8" }}>{l.utm_medium}</div>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#475569", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.utm_campaign}</td>
                        <td style={{ padding: "10px 12px" }}>
                          {short ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <code style={{ fontSize: "0.75rem", color: "#0066FF", background: "#EFF6FF", padding: "2px 8px", borderRadius: 6 }}>{short}</code>
                              <button onClick={() => copyText(short, `short-${l.id}`)} style={{ ...btnGhost, padding: "3px 8px", fontSize: "0.7rem" }}>{copied === `short-${l.id}` ? "✅" : "📋"}</button>
                            </div>
                          ) : <span style={{ color: "#94A3B8", fontSize: "0.75rem" }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ fontWeight: 700, color: l.click_count > 0 ? "#059669" : "#94A3B8" }}>{l.click_count}</span>
                          {l.last_clicked && <div style={{ fontSize: "0.68rem", color: "#94A3B8" }}>{new Date(l.last_clicked).toLocaleDateString()}</div>}
                        </td>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                          <button onClick={() => copyText(l.full_url, `full-${l.id}`)} style={{ ...btnGhost, marginRight: 6 }}>{copied === `full-${l.id}` ? "✅" : "🔗"}</button>
                          <button onClick={() => handleDeleteLink(l.id)} style={{ ...btnGhost, color: "#DC2626", borderColor: "#FECACA" }}>🗑</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "presets" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={cardStyle}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 16 }}>Save Custom Preset</div>
            <div style={{ display: "grid", gap: 12 }}>
              {[
                { key: "label", placeholder: "My Email Channel", label: "Preset Name *" },
                { key: "source", placeholder: "mailchimp", label: "utm_source *" },
                { key: "medium", placeholder: "email", label: "utm_medium *" },
                { key: "campaign", placeholder: "optional default campaign", label: "Default Campaign" },
              ].map(({ key, placeholder, label }) => (
                <div key={key}>
                  <label style={labelStyle}>{label}</label>
                  <input style={inputStyle} placeholder={placeholder} value={(presetForm as Record<string, string>)[key]} onChange={e => setPresetForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <button onClick={handleSavePreset} style={{ ...btnPrimary, marginTop: 16, width: "100%" }}>💾 Save Preset</button>
          </div>

          <div style={cardStyle}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 16 }}>Your Presets</div>
            {presets.length === 0 ? (
              <div style={{ color: "#94A3B8", fontSize: "0.85rem" }}>No custom presets yet.</div>
            ) : presets.map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #F1F5F9" }}>
                <div>
                  <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.85rem" }}>{p.label}</div>
                  <div style={{ color: "#64748B", fontSize: "0.75rem" }}>{p.source} / {p.medium}{p.campaign ? ` / ${p.campaign}` : ""}</div>
                </div>
                <button onClick={() => handleDeletePreset(p.id)} style={{ ...btnGhost, color: "#DC2626" }}>🗑</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Brand } from "@/lib/api";

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function BrandPage() {
  const [current, setCurrent] = useState<Brand | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    companyName: "", mission: "", positioning: "", voiceTone: "",
    keyMessages: "", differentiators: "", competitors: "", prohibitedTerms: "",
  });

  useEffect(() => {
    api.brand().then(({ brand }) => {
      setCurrent(brand);
      if (brand) {
        setForm({
          companyName: brand.company_name,
          mission: brand.mission ?? "",
          positioning: brand.positioning ?? "",
          voiceTone: brand.voice_tone ?? "",
          keyMessages: (brand.key_messages ?? []).join(", "),
          differentiators: (brand.differentiators ?? []).join(", "),
          competitors: (brand.competitors ?? []).join(", "),
          prohibitedTerms: (brand.prohibited_terms ?? []).join(", "),
        });
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(null);
    try {
      const result = await api.saveBrand({
        companyName: form.companyName,
        mission: form.mission || undefined,
        positioning: form.positioning || undefined,
        voiceTone: form.voiceTone || undefined,
        keyMessages: split(form.keyMessages),
        differentiators: split(form.differentiators),
        competitors: split(form.competitors),
        prohibitedTerms: split(form.prohibitedTerms),
      });
      setSaved(result.version);
      const { brand } = await api.brand();
      setCurrent(brand);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403
        ? "Saving the Brand Foundation requires the tenant:admin permission (owner role)."
        : err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <>
      <h1 className="page-title">Brand Foundation</h1>
      <p className="page-sub">
        The tenant-scoped source of truth injected into every generation path. It is versioned —
        saving creates version {current ? current.version + 1 : 1} and keeps the full history, so any
        output can be traced to the exact brand version that grounded it.
      </p>

      {current ? (
        <div className="banner pass">
          Current: <b>v{current.version}</b> · saved {new Date(current.created_at).toLocaleString()} —
          injected into every AI prompt for this tenant.
        </div>
      ) : (
        <div className="banner block">
          No Brand Foundation yet. Until one exists, generation for this tenant is <b>blocked by the gate</b> —
          ungrounded generation is a defect, not a feature.
        </div>
      )}

      <form className="card" onSubmit={save}>
        <div className="two-col">
          <label className="field"><span>Company name *</span>
            <input type="text" value={form.companyName} onChange={set("companyName")} required />
          </label>
          <label className="field"><span>Voice &amp; tone</span>
            <input type="text" value={form.voiceTone} onChange={set("voiceTone")} placeholder="e.g. warm, plain-spoken, no hype" />
          </label>
        </div>
        <label className="field"><span>Positioning</span>
          <input type="text" value={form.positioning} onChange={set("positioning")} placeholder="One sentence on where this brand wins" />
        </label>
        <label className="field"><span>Mission</span>
          <textarea value={form.mission} onChange={set("mission")} />
        </label>
        <div className="two-col">
          <label className="field"><span>Key messages</span>
            <input type="text" value={form.keyMessages} onChange={set("keyMessages")} placeholder="comma-separated" />
          </label>
          <label className="field"><span>Differentiators</span>
            <input type="text" value={form.differentiators} onChange={set("differentiators")} placeholder="comma-separated" />
          </label>
        </div>
        <div className="two-col">
          <label className="field"><span>Named competitors</span>
            <input type="text" value={form.competitors} onChange={set("competitors")} placeholder="comma-separated" />
          </label>
          <label className="field"><span>Prohibited terms</span>
            <input type="text" value={form.prohibitedTerms} onChange={set("prohibitedTerms")} placeholder="comma-separated — the gate blocks output containing these" />
            <div className="hint">Machine-checked by the guardrail gate on every output.</div>
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : current ? `Save as v${current.version + 1}` : "Create Brand Foundation"}
          </button>
          {saved && <span className="pill executed">saved v{saved}</span>}
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>
    </>
  );
}

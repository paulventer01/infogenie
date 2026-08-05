"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

interface Preset {
  id: string;
  name: string;
  description: string;
  source_platform: string;
  target_platforms: string[];
  delay_minutes: number;
  enabled: boolean;
  auto_publish: boolean;
}

interface EvergreenRule {
  id: number;
  text: string;
  platforms: string[];
  interval_days: number;
  next_run_at: string;
  repost_count: number;
  max_reposts: number | null;
  is_active: boolean;
}

interface Props {
  profileId: string;
  platforms: Array<{ id: string; label: string; icon: string }>;
  draftText?: string;
  draftPlatforms?: string[];
}

export default function SocialAutomationPanel({ profileId, platforms, draftText, draftPlatforms }: Props) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [rules, setRules] = useState<EvergreenRule[]>([]);
  const [intervalDays, setIntervalDays] = useState(30);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, e] = await Promise.all([
      apiGet<{ ok: boolean; presets?: Preset[] }>("/api/social-workflows/presets"),
      apiGet<{ ok: boolean; rules?: EvergreenRule[] }>("/api/social-evergreen/list"),
    ]);
    if (p.ok) setPresets(p.presets || []);
    if (e.ok) setRules(e.rules || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function togglePreset(id: string, enabled: boolean) {
    await apiPost(`/api/social-workflows/presets/${id}/toggle`, { enabled });
    load();
  }

  async function createEvergreen() {
    if (!profileId) {
      setMsg("Pick a profile first");
      return;
    }
    const text = (draftText || "").trim();
    if (!text) {
      setMsg("Compose a post first (or paste text), then set evergreen from here.");
      return;
    }
    const plats = (draftPlatforms || []).length ? draftPlatforms! : ["instagram", "linkedin"];
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/social-evergreen", {
      profileId,
      text,
      platforms: plats,
      interval_days: intervalDays,
      max_reposts: null,
    });
    if (!r.ok) {
      setMsg(r.error || "Failed");
      return;
    }
    setMsg("Evergreen rule created");
    load();
  }

  async function toggleRule(id: number, is_active: boolean) {
    await apiPatch(`/api/social-evergreen/${id}`, { is_active });
    load();
  }

  async function deleteRule(id: number) {
    if (!confirm("Delete evergreen rule?")) return;
    await apiDelete(`/api/social-evergreen/${id}`);
    load();
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: "0 0 6px", fontFamily: "Sora,sans-serif", fontSize: "0.95rem", color: "#0A1628" }}>
          🔁 Cross-post workflows
        </h3>
        <p style={{ margin: "0 0 12px", fontSize: "0.78rem", color: "#6B7280" }}>
          When a post publishes on the source platform, create an adapted draft for the target.
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {presets.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 12px", background: "#F9FAFB" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.82rem", color: "#0A1628" }}>{p.name}</div>
                <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>{p.description}</div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.74rem", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                <input type="checkbox" checked={!!p.enabled} onChange={(e) => togglePreset(p.id, e.target.checked)} />
                On
              </label>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: "0 0 6px", fontFamily: "Sora,sans-serif", fontSize: "0.95rem", color: "#0A1628" }}>
          ♻️ Evergreen reposts
        </h3>
        <p style={{ margin: "0 0 12px", fontSize: "0.78rem", color: "#6B7280" }}>
          Re-queue the current compose text on a recurring interval.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <label style={{ fontSize: "0.74rem", fontWeight: 700, color: "#374151" }}>
            Every{" "}
            <input
              type="number"
              min={1}
              max={365}
              value={intervalDays}
              onChange={(e) => setIntervalDays(Number(e.target.value) || 30)}
              style={{ width: 64, padding: 6, border: "1px solid #D1D5DB", borderRadius: 6, margin: "0 4px" }}
            />{" "}
            days
          </label>
          <button type="button" onClick={createEvergreen} style={primaryBtn}>
            Set evergreen from Compose
          </button>
        </div>
        {msg && <div style={{ fontSize: "0.78rem", color: "#065F46", marginBottom: 8 }}>{msg}</div>}
        {!rules.length ? (
          <div style={{ color: "#9CA3AF", fontSize: "0.78rem", fontStyle: "italic" }}>No evergreen rules yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {rules.map((r) => (
              <div key={r.id} style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: 10, background: "#F9FAFB" }}>
                <div style={{ fontSize: "0.8rem", color: "#0A1628", marginBottom: 4 }}>{(r.text || "").slice(0, 140)}</div>
                <div style={{ fontSize: "0.68rem", color: "#6B7280", marginBottom: 8 }}>
                  {(r.platforms || []).map((id) => platforms.find((p) => p.id === id)?.label || id).join(" · ")}
                  {" · "}every {r.interval_days}d · next {new Date(r.next_run_at).toLocaleDateString()}
                  {" · "}reposts {r.repost_count}{r.max_reposts != null ? `/${r.max_reposts}` : ""}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => toggleRule(r.id, !r.is_active)} style={smallBtn}>
                    {r.is_active ? "Pause" : "Resume"}
                  </button>
                  <button type="button" onClick={() => deleteRule(r.id)} style={{ ...smallBtn, color: "#991B1B" }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const primaryBtn: CSSProperties = {
  background: "#0D9488",
  color: "#fff",
  border: "none",
  padding: "8px 12px",
  borderRadius: 7,
  fontSize: "0.74rem",
  fontWeight: 800,
  cursor: "pointer",
};

const smallBtn: CSSProperties = {
  background: "#F3F4F6",
  color: "#374151",
  border: "1px solid #E5E7EB",
  padding: "5px 10px",
  borderRadius: 5,
  fontSize: "0.7rem",
  fontWeight: 700,
  cursor: "pointer",
};

"use client";

// Native React port of the legacy `identity-spine` panel (T97 — was
// `window.buildIdentitySpine` in the SHARED `public/js/ig_strategic_features.js`
// + `#view-identity-spine` in index.html). Unified first-party customer
// profiles: stats, CSV import, AI scoring, lifecycle-stage filter. Same API
// surface: `/api/identity/*`.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import PanelHero from "@/components/layout/PanelHero";

const STAGE_COLORS: Record<string, string> = {
  unknown: "#64748b",
  aware: "#8b5cf6",
  interested: "#3b82f6",
  considering: "#f59e0b",
  customer: "#22c55e",
  churned: "#ef4444",
};

const STAGES = [
  "unknown",
  "aware",
  "interested",
  "considering",
  "customer",
  "churned",
];

interface StatsResponse {
  ok: boolean;
  error?: string;
  total?: number;
  ltv?: { avg_ltv?: number; max_ltv?: number };
  stages?: { lifecycle_stage: string; n: number }[];
}

interface Profile {
  email?: string;
  name?: string;
  company?: string;
  lifecycle_stage: string;
  ltv_score?: number;
  propensity_score?: number;
  next_best_action?: string;
  source_channels?: string;
}

interface ProfilesResponse {
  ok: boolean;
  error?: string;
  profiles?: Profile[];
}

const cur = (n: unknown) => "$" + (+((n as number) || 0)).toLocaleString();

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid rgba(11, 18, 32, 0.1)",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 0 rgba(11, 18, 32, 0.04), 0 10px 24px rgba(11, 18, 32, 0.05)",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 40,
  padding: "0 16px",
  border: "none",
  borderRadius: 10,
  background: "linear-gradient(135deg,#0f766e,#0284c7)",
  color: "#fff",
  fontWeight: 800,
  fontSize: "0.84rem",
  cursor: "pointer",
  fontFamily: "inherit",
};

const btnSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 40,
  padding: "0 16px",
  border: "1.5px solid rgba(11, 18, 32, 0.12)",
  borderRadius: 10,
  background: "#ffffff",
  color: "#0f172a",
  fontWeight: 700,
  fontSize: "0.84rem",
  cursor: "pointer",
  fontFamily: "inherit",
};

export default function IdentitySpine() {
  const toast = useToast();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [stageFilter, setStageFilter] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);

  const loadStats = useCallback(async () => {
    const data = await apiGet<StatsResponse>("/api/identity/stats");
    if (data.ok) setStats(data);
  }, []);

  const loadProfiles = useCallback(async (stage: string) => {
    const data = await apiGet<ProfilesResponse>(
      "/api/identity/profiles" + (stage ? "?stage=" + stage : ""),
    );
    setProfiles(data.ok && data.profiles ? data.profiles : []);
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadProfiles(stageFilter);
  }, [loadProfiles, stageFilter]);

  const doImport = async () => {
    const lines = csv.trim().split("\n").slice(1);
    const contacts = lines
      .map((l) => {
        const p = l.split(",");
        return {
          email: p[0]?.trim(),
          name: p[1]?.trim(),
          company: p[2]?.trim(),
          source_channels: p[3]?.trim() || "manual",
        };
      })
      .filter((c) => c.email);
    if (!contacts.length) {
      toast("⚠️ No valid rows found");
      return;
    }
    setBusy(true);
    const data = await apiPost("/api/identity/import", { contacts });
    setBusy(false);
    if (data.ok) {
      toast(`✓ Imported ${data.imported} contacts`);
      setShowImport(false);
      setCsv("");
      loadStats();
      loadProfiles(stageFilter);
    } else {
      toast("⚠️ " + (data.error || "Import failed"));
    }
  };

  const doScore = async () => {
    toast("Scoring profiles with AI…");
    setBusy(true);
    const data = await apiPost("/api/identity/score", {});
    setBusy(false);
    if (data.ok) {
      toast(`✓ Scored ${data.scored} profiles`);
      loadStats();
      loadProfiles(stageFilter);
    } else {
      toast("⚠️ " + (data.error || "Scoring failed"));
    }
  };

  return (
    <div className="view active" style={{ maxWidth: 1100, margin: "0 auto", padding: "8px 4px 40px" }}>
      <PanelHero
        group="Reach"
        title="🪪 Identity Spine"
        subtitle="Unified first-party customer profiles — consent-aware, LTV-scored, and enriched with next-best-action recommendations."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div style={card}>
          <div style={{ fontSize: "1.45rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
            {stats?.total ?? 0}
          </div>
          <div style={{ marginTop: 6, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#64748b" }}>
            Total Profiles
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "1.45rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
            {cur(stats?.ltv?.avg_ltv)}
          </div>
          <div style={{ marginTop: 6, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#64748b" }}>
            Avg LTV
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "1.45rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
            {cur(stats?.ltv?.max_ltv)}
          </div>
          <div style={{ marginTop: 6, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#64748b" }}>
            Top LTV
          </div>
        </div>
        {(stats?.stages || []).map((s) => (
          <div
            key={s.lifecycle_stage}
            style={{
              ...card,
              borderLeft: `3px solid ${STAGE_COLORS[s.lifecycle_stage] || "#888"}`,
            }}
          >
            <div style={{ fontSize: "1.45rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>{s.n}</div>
            <div style={{ marginTop: 6, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#64748b" }}>
              {s.lifecycle_stage}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 18,
        }}
      >
        <button type="button" style={btnPrimary} onClick={() => setShowImport(true)}>
          + Import Contacts
        </button>
        <button type="button" style={btnSecondary} onClick={doScore} disabled={busy}>
          🧠 AI Score All
        </button>
        <select
          className="ig-input"
          style={{ maxWidth: 200, minHeight: 40 }}
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
        >
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {showImport && (
        <div style={{ ...card, padding: 20, marginBottom: 18 }}>
          <h4 style={{ margin: "0 0 6px", color: "#0f172a", fontSize: "1rem", fontWeight: 800 }}>
            Import Contacts
          </h4>
          <p style={{ margin: "0 0 14px", color: "#475569", fontSize: "0.84rem", lineHeight: 1.5 }}>
            Paste CSV with columns: <code>email,name,company,source_channels</code>
          </p>
          <textarea
            className="ig-input"
            style={{
              width: "100%",
              minHeight: 120,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              marginBottom: 14,
            }}
            placeholder={
              "email,name,company,source_channels\nalice@example.com,Alice Smith,Acme,email\nbob@acme.io,Bob Jones,Globex,ads"
            }
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={btnPrimary} onClick={doImport} disabled={busy}>
              {busy ? "Importing…" : "Import"}
            </button>
            <button type="button" style={btnSecondary} onClick={() => setShowImport(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {profiles !== null &&
        (profiles.length === 0 ? (
          <div
            style={{
              ...card,
              textAlign: "center",
              padding: 40,
              color: "#475569",
            }}
          >
            No profiles yet. Import contacts to build your identity spine.
          </div>
        ) : (
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <table className="ig-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Stage</th>
                  <th>LTV</th>
                  <th>Propensity</th>
                  <th>Next Action</th>
                  <th>Channels</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p, i) => {
                  const stageColor = STAGE_COLORS[p.lifecycle_stage] || "#888";
                  return (
                    <tr key={p.email || i}>
                      <td>
                        <strong style={{ color: "#0f172a" }}>{p.name || p.email || "—"}</strong>
                        <br />
                        <small style={{ color: "#64748b" }}>{p.company || ""}</small>
                      </td>
                      <td>
                        <span
                          className="ig-badge"
                          style={{
                            background: stageColor + "20",
                            color: stageColor,
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 999,
                            fontSize: "0.72rem",
                          }}
                        >
                          {p.lifecycle_stage}
                        </span>
                      </td>
                      <td style={{ color: "#0f172a", fontWeight: 700 }}>{cur(p.ltv_score)}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div
                            style={{
                              width: 60,
                              height: 6,
                              background: "#e2e8f0",
                              borderRadius: 3,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${p.propensity_score || 0}%`,
                                height: "100%",
                                background: "#0284c7",
                                borderRadius: 3,
                              }}
                            />
                          </div>
                          <span style={{ color: "#0f172a", fontSize: "0.84rem" }}>
                            {p.propensity_score || 0}%
                          </span>
                        </div>
                      </td>
                      <td style={{ fontSize: 13, color: "#334155" }}>{p.next_best_action || "—"}</td>
                      <td>
                        <small style={{ color: "#64748b" }}>{p.source_channels || "—"}</small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

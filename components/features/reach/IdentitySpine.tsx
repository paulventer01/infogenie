"use client";

// Native React port of the legacy `identity-spine` panel (T97 — was
// `window.buildIdentitySpine` in the SHARED `public/js/ig_strategic_features.js`
// + `#view-identity-spine` in index.html). Unified first-party customer
// profiles: stats, CSV import, AI scoring, lifecycle-stage filter. Same API
// surface: `/api/identity/*`.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

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
    <div className="ig-panel">
      <div className="ig-panel-header">
        <h2>🪪 Identity Spine</h2>
        <p className="ig-panel-sub">
          Unified first-party customer profiles — consent-aware, LTV-scored, and
          enriched with next-best-action recommendations.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        {stats && (
          <>
            <div className="ig-stat-card">
              <div className="ig-stat-num">{stats.total}</div>
              <div className="ig-stat-label">Total Profiles</div>
            </div>
            <div className="ig-stat-card">
              <div className="ig-stat-num">{cur(stats.ltv?.avg_ltv)}</div>
              <div className="ig-stat-label">Avg LTV</div>
            </div>
            <div className="ig-stat-card">
              <div className="ig-stat-num">{cur(stats.ltv?.max_ltv)}</div>
              <div className="ig-stat-label">Top LTV</div>
            </div>
            {(stats.stages || []).map((s) => (
              <div
                key={s.lifecycle_stage}
                className="ig-stat-card"
                style={{
                  borderLeft: `3px solid ${STAGE_COLORS[s.lifecycle_stage] || "#888"}`,
                }}
              >
                <div className="ig-stat-num">{s.n}</div>
                <div className="ig-stat-label">{s.lifecycle_stage}</div>
              </div>
            ))}
          </>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <button
          className="ig-btn ig-btn-primary"
          onClick={() => setShowImport(true)}
        >
          + Import Contacts
        </button>
        <button className="ig-btn" onClick={doScore} disabled={busy}>
          🧠 AI Score All
        </button>
        <select
          className="ig-input"
          style={{ maxWidth: 180 }}
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
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 18,
            marginBottom: 18,
          }}
        >
          <h4 style={{ margin: "0 0 12px" }}>
            Import Contacts (paste CSV: email,name,company,source_channels)
          </h4>
          <textarea
            className="ig-input"
            style={{
              width: "100%",
              minHeight: 100,
              fontFamily: "monospace",
            }}
            placeholder={
              "email,name,company,source_channels\nalice@example.com,Alice Smith,Acme,email\nbob@acme.io,Bob Jones,Globex,ads"
            }
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button
              className="ig-btn ig-btn-primary"
              onClick={doImport}
              disabled={busy}
            >
              Import
            </button>
            <button className="ig-btn" onClick={() => setShowImport(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {profiles !== null &&
        (profiles.length === 0 ? (
          <div
            className="ig-empty"
            style={{
              textAlign: "center",
              padding: 40,
              color: "var(--text-muted)",
            }}
          >
            No profiles. Import contacts to build your identity spine.
          </div>
        ) : (
          <table
            className="ig-table"
            style={{ width: "100%", borderCollapse: "collapse" }}
          >
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
                      <strong>{p.name || p.email || "—"}</strong>
                      <br />
                      <small style={{ color: "var(--text-muted)" }}>
                        {p.company || ""}
                      </small>
                    </td>
                    <td>
                      <span
                        className="ig-badge"
                        style={{
                          background: stageColor + "20",
                          color: stageColor,
                        }}
                      >
                        {p.lifecycle_stage}
                      </span>
                    </td>
                    <td>{cur(p.ltv_score)}</td>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <div
                          style={{
                            width: 60,
                            height: 6,
                            background: "var(--bg-hover)",
                            borderRadius: 3,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${p.propensity_score || 0}%`,
                              height: "100%",
                              background: "#3b82f6",
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        {p.propensity_score || 0}%
                      </div>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {p.next_best_action || "—"}
                    </td>
                    <td>
                      <small>{p.source_channels || "—"}</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
    </div>
  );
}

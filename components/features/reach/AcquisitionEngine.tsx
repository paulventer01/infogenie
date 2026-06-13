"use client";

// Native React port of the legacy `acquisition-engine` panel (was
// `window.buildAcquisitionengine` + `#view-acquisition-engine` in index.html,
// built in public/js/ig_advanced_features.js). Autonomous prospecting engine
// driven by the existing Express API:
//   POST /api/acquisition-engine/launch                       — find + score + write
//   GET  /api/acquisition-engine/campaigns                    — list campaigns
//   POST /api/acquisition-engine/prospects/:id/mark-meeting   — mark meeting booked
//   POST /api/acquisition-engine/prospects/:id/mark-sent      — mark email sent
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Prospect {
  id: number;
  name?: string;
  company?: string;
  role?: string;
  email?: string;
  score: number;
}

interface SequenceEmail {
  step: number;
  subject?: string;
  body?: string;
}

interface AEStats {
  total_found?: number;
  emails_sent?: number;
  replies?: number;
  meetings_booked?: number;
}

interface LaunchResult {
  ok: boolean;
  error?: string;
  stats?: AEStats;
  prospects?: Prospect[];
  email_sequence?: { emails?: SequenceEmail[] };
}

interface Campaign {
  name: string;
  status: string;
  stats?: AEStats;
}

interface CampaignsResult {
  ok: boolean;
  campaigns?: Campaign[];
}

export default function AcquisitionEngine() {
  const [name, setName] = useState("Q3 Outreach");
  const [industry, setIndustry] = useState("");
  const [roleTarget, setRoleTarget] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [valueProp, setValueProp] = useState("");
  const [count, setCount] = useState(10);

  const [launching, setLaunching] = useState(false);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);

  async function loadCampaigns() {
    const d = await apiGet<CampaignsResult>("/api/acquisition-engine/campaigns");
    setCampaigns(d.ok && d.campaigns ? d.campaigns : []);
  }

  useEffect(() => {
    loadCampaigns();
  }, []);

  async function launch() {
    if (!industry.trim()) {
      alert("Enter a target industry.");
      return;
    }
    setLaunching(true);
    const d = await apiPost<LaunchResult>("/api/acquisition-engine/launch", {
      name: name || "Campaign",
      target_industry: industry.trim(),
      target_role: roleTarget,
      target_size: companySize,
      value_prop: valueProp,
      count: count || 10,
    });
    setLaunching(false);
    if (!d.ok) {
      alert(d.error || "Error");
      return;
    }
    setResult(d);
    loadCampaigns();
  }

  async function mark(id: number, type: "meeting" | "sent") {
    const path =
      type === "meeting"
        ? `/api/acquisition-engine/prospects/${id}/mark-meeting`
        : `/api/acquisition-engine/prospects/${id}/mark-sent`;
    await apiPost(path);
    loadCampaigns();
  }

  const seq = result?.email_sequence?.emails || [];
  const stats = result?.stats || {};

  return (
    <>
      <div className="view-header">
        <h2>🚀 AI Acquisition Engine</h2>
        <p className="view-sub">
          Finds prospects, scores them, writes emails, and tracks meetings — fully autonomous.
        </p>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div className="ig-card" style={{ flex: 1, minWidth: 300 }}>
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Launch New Campaign</h3>
          <div className="form-group">
            <label>Campaign Name</label>
            <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Target Industry</label>
            <input
              className="form-control"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. E-commerce, SaaS, Healthcare"
            />
          </div>
          <div className="form-group">
            <label>Target Role</label>
            <input
              className="form-control"
              value={roleTarget}
              onChange={(e) => setRoleTarget(e.target.value)}
              placeholder="e.g. Marketing Director, CEO"
            />
          </div>
          <div className="form-group">
            <label>Company Size</label>
            <select
              className="form-control"
              value={companySize}
              onChange={(e) => setCompanySize(e.target.value)}
            >
              <option value="">Any</option>
              <option>1-10</option>
              <option>11-50</option>
              <option>51-200</option>
              <option>201-500</option>
              <option>500+</option>
            </select>
          </div>
          <div className="form-group">
            <label>Value Proposition</label>
            <input
              className="form-control"
              value={valueProp}
              onChange={(e) => setValueProp(e.target.value)}
              placeholder="e.g. AI that doubles your ad ROAS"
            />
          </div>
          <div className="form-group">
            <label>Prospects to Find</label>
            <input
              className="form-control"
              type="number"
              value={count}
              min={5}
              max={20}
              onChange={(e) => setCount(parseInt(e.target.value, 10) || 10)}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            onClick={launch}
            disabled={launching}
          >
            {launching ? "Finding & scoring prospects…" : "🚀 Launch Engine"}
          </button>
        </div>

        <div style={{ flex: 2, minWidth: 300 }}>
          {campaigns && campaigns.length > 0 ? (
            <>
              <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Active Campaigns</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {campaigns.map((c, i) => {
                  const s = c.stats || {};
                  return (
                    <div key={i} className="ig-card" style={{ padding: 12 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 8,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                        <span
                          style={{
                            background: "#dbeafe",
                            color: "#1d4ed8",
                            borderRadius: 4,
                            padding: "2px 8px",
                            fontSize: ".75rem",
                            fontWeight: 600,
                          }}
                        >
                          {c.status}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 16, fontSize: ".8rem", color: "#6b7280" }}>
                        <span>👥 {s.total_found || 0} found</span>
                        <span>📧 {s.emails_sent || 0} emailed</span>
                        <span>💬 {s.replies || 0} replies</span>
                        <span>📅 {s.meetings_booked || 0} meetings</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="ig-card" style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
              No campaigns yet — launch your first above.
            </div>
          )}
        </div>
      </div>

      <div>
        {result && (
          <>
            <div className="ig-card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
                {(
                  [
                    [stats.total_found || 0, "Prospects Found", "#3b82f6"],
                    [stats.emails_sent || 0, "Emails Sent", "#10b981"],
                    [stats.replies || 0, "Replies", "#f59e0b"],
                    [stats.meetings_booked || 0, "Meetings Booked", "#8b5cf6"],
                  ] as [number, string, string][]
                ).map(([v, l, col]) => (
                  <div key={l} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "2rem", fontWeight: 800, color: col }}>{v}</div>
                    <div style={{ fontSize: ".75rem", color: "#6b7280" }}>{l}</div>
                  </div>
                ))}
              </div>
              <h4 style={{ fontWeight: 600, marginBottom: 8 }}>Prospects</h4>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Name", "Company", "Role", "Email", "Score", "Actions"].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: 8,
                            textAlign: "left",
                            color: "#6b7280",
                            fontWeight: 600,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(result.prospects || []).map((p) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: 8 }}>{p.name || "—"}</td>
                        <td style={{ padding: 8, fontWeight: 600 }}>{p.company || "—"}</td>
                        <td style={{ padding: 8 }}>{p.role || "—"}</td>
                        <td style={{ padding: 8, color: "#6b7280" }}>
                          {p.email ? p.email : <span style={{ color: "#d1d5db" }}>—</span>}
                        </td>
                        <td style={{ padding: 8 }}>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 32,
                              height: 32,
                              borderRadius: "50%",
                              background:
                                p.score >= 70 ? "#d1fae5" : p.score >= 40 ? "#fef3c7" : "#fee2e2",
                              color:
                                p.score >= 70 ? "#065f46" : p.score >= 40 ? "#92400e" : "#991b1b",
                              fontWeight: 700,
                              fontSize: ".8rem",
                            }}
                          >
                            {p.score}
                          </div>
                        </td>
                        <td style={{ padding: 8, display: "flex", gap: 6 }}>
                          <button
                            className="btn btn-xs"
                            onClick={() => mark(p.id, "sent")}
                            title="Mark emailed"
                          >
                            📧
                          </button>
                          <button
                            className="btn btn-xs"
                            onClick={() => mark(p.id, "meeting")}
                            title="Mark meeting booked"
                          >
                            📅
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {seq.length > 0 && (
              <div className="ig-card">
                <h4 style={{ fontWeight: 600, marginBottom: 12 }}>
                  📧 AI-Generated Email Sequence ({seq.length} steps)
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {seq.map((e, i) => (
                    <div
                      key={i}
                      style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}
                    >
                      <div
                        style={{
                          fontSize: ".75rem",
                          fontWeight: 700,
                          color: "#3b82f6",
                          marginBottom: 4,
                        }}
                      >
                        STEP {e.step}
                      </div>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>
                        Subject: {e.subject || ""}
                      </div>
                      <pre
                        style={{
                          whiteSpace: "pre-wrap",
                          fontFamily: "inherit",
                          fontSize: ".85rem",
                          color: "#374151",
                          margin: 0,
                          background: "#f9fafb",
                          padding: 10,
                          borderRadius: 6,
                        }}
                      >
                        {e.body || ""}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

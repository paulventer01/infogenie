"use client";

// Native React port of the legacy `new-project` panel (was
// `window.buildNewProject` in public/js/ig_manage_pack.js + `#view-new-project`).
// Creates marketing projects and lists/sets-active/deletes them against the
// existing Express API (`GET`/`POST /api/projects`, `DELETE /api/projects/:id`)
// via lib/api. Active project is tracked in localStorage exactly as before.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface Project {
  id: string;
  name: string;
  goal?: string;
  monthly_budget?: number;
  channels?: string[];
  owner_email?: string;
  start_date?: string | null;
  end_date?: string | null;
}

const CHANNELS = [
  "Email",
  "SMS",
  "WhatsApp",
  "Voice",
  "Web Push",
  "Meta Ads",
  "Google Ads",
  "TikTok Ads",
  "Social Organic",
  "SEO",
  "Influencer",
  "Events",
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 9,
  border: "1px solid #FED7AA",
  borderRadius: 8,
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.78rem",
  fontWeight: 700,
  color: "#475569",
  marginBottom: 4,
};

export default function NewProject() {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState("");

  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [channels, setChannels] = useState<Set<string>>(new Set());

  function showOk(msg: string) {
    toast("✓ " + msg);
  }
  function showErr(msg: string) {
    toast("⚠️ " + msg);
  }

  async function refresh() {
    const j = await apiGet<{ ok: boolean; projects?: Project[]; error?: string }>("/api/projects");
    if (!j.ok) {
      setLoadError(j.error || "unknown");
      return;
    }
    setLoadError(null);
    setProjects(j.projects || []);
    try {
      setActiveId(localStorage.getItem("ig_active_project_id") || "");
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const j = await apiGet<{ ok: boolean; projects?: Project[]; error?: string }>("/api/projects");
      if (cancelled) return;
      if (!j.ok) {
        setLoadError(j.error || "unknown");
        return;
      }
      setProjects(j.projects || []);
      try {
        setActiveId(localStorage.getItem("ig_active_project_id") || "");
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleChannel(c: string) {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  async function save() {
    const nm = name.trim();
    if (!nm) {
      showErr("Project name required");
      return;
    }
    const r = await apiPost<{ ok: boolean; id?: string; error?: string }>("/api/projects", {
      name: nm,
      goal,
      monthly_budget: +budget || 0,
      channels: [...channels],
      owner_email: owner.trim(),
      start_date: start || null,
      end_date: end || null,
    });
    if (!r.ok) {
      showErr(r.error || "Failed");
      return;
    }
    try {
      if (r.id) localStorage.setItem("ig_active_project_id", r.id);
      localStorage.setItem("ig_active_project_name", nm);
    } catch {
      /* ignore */
    }
    showOk("Project created — set as active");
    setName("");
    setGoal("");
    setBudget("");
    setChannels(new Set());
    refresh();
  }

  function setActive(p: Project) {
    try {
      localStorage.setItem("ig_active_project_id", p.id);
      localStorage.setItem("ig_active_project_name", p.name);
    } catch {
      /* ignore */
    }
    showOk("Active: " + p.name);
    setActiveId(p.id);
  }

  async function del(p: Project) {
    if (!confirm("Delete this project?")) return;
    const r = await apiDelete<{ ok: boolean; error?: string }>("/api/projects/" + p.id);
    if (!r.ok) {
      showErr(r.error || "Failed");
      return;
    }
    refresh();
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FFF7ED", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: "1.6rem", color: "#0F172A" }}>
            ✨ New Marketing Project
          </h1>
          <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.92rem" }}>
            Set up a project once — then launch campaigns, schedule posts, track budget, and measure
            results all under one roof.
          </p>
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid #FED7AA",
            borderRadius: 14,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <h3 style={{ margin: "0 0 16px", color: "#9A3412", fontSize: "1.05rem" }}>
            Project details
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <div>
              <label style={labelStyle}>Project name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q1 2026 Product Launch"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Owner email</label>
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="you@company.com"
                style={inputStyle}
              />
            </div>
          </div>
          <label style={labelStyle}>Primary goal *</label>
          <textarea
            rows={2}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Drive 500 demo bookings in Q1 from US enterprise market"
            style={{ ...inputStyle, fontFamily: "inherit", marginBottom: 14 }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <div>
              <label style={labelStyle}>Monthly budget (USD)</label>
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="5000"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Start date</label>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>End date</label>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          <label style={{ ...labelStyle, marginBottom: 6 }}>Channels</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
            {CHANNELS.map((c) => (
              <label
                key={c}
                style={{
                  background: "#FFF7ED",
                  border: "1px solid #FED7AA",
                  borderRadius: 99,
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <input
                  type="checkbox"
                  value={c}
                  checked={channels.has(c)}
                  onChange={() => toggleChannel(c)}
                  style={{ margin: 0 }}
                />
                {c}
              </label>
            ))}
          </div>
          <button
            onClick={save}
            style={{
              padding: "11px 22px",
              background: "linear-gradient(135deg,#F97316,#EA580C)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Create Project
          </button>
        </div>
        <h3 style={{ margin: "0 0 12px", color: "#0F172A", fontSize: "1.05rem" }}>Your projects</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {loadError ? (
            <div style={{ color: "#B91C1C" }}>{loadError}</div>
          ) : projects && projects.length === 0 ? (
            <div
              style={{
                background: "#fff",
                border: "1px dashed #FED7AA",
                borderRadius: 10,
                padding: 24,
                textAlign: "center",
                color: "#64748B",
              }}
            >
              No projects yet.
            </div>
          ) : (
            (projects || []).map((p) => (
              <div
                key={p.id}
                style={{
                  background: "#fff",
                  border: `1px solid ${p.id === activeId ? "#F97316" : "#E2E8F0"}`,
                  borderRadius: 12,
                  padding: 16,
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <strong style={{ color: "#0F172A", fontSize: "1rem" }}>{p.name}</strong>
                    {p.id === activeId && (
                      <span
                        style={{
                          background: "#F97316",
                          color: "#fff",
                          padding: "2px 8px",
                          borderRadius: 99,
                          fontSize: "0.65rem",
                          fontWeight: 700,
                        }}
                      >
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div style={{ color: "#64748B", fontSize: "0.84rem", marginTop: 4 }}>
                    {p.goal || "No goal set"} · ${(p.monthly_budget || 0).toLocaleString()}/mo ·{" "}
                    {(p.channels || []).length} channels
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setActive(p)}
                    style={{
                      padding: "6px 12px",
                      background: "#FED7AA",
                      border: "1px solid #F97316",
                      borderRadius: 7,
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                    }}
                  >
                    Set Active
                  </button>
                  <button
                    onClick={() => del(p)}
                    style={{
                      padding: "6px 11px",
                      background: "#FEE2E2",
                      color: "#B91C1C",
                      border: "1px solid #FCA5A5",
                      borderRadius: 7,
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

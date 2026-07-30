"use client";

// Native React port of the legacy `lead-qualifier` panel (was
// `window.buildLeadQualifier` / `refreshLeadQualifier` + `#view-lead-qualifier`
// in index.html, built in public/js/ig_attribution_scorer.js). Scores inbound
// leads on BANT/fit/intent via the existing Express API:
//   GET    /api/leads/qualified      — list recent qualifications
//   POST   /api/leads/qualify        — qualify a new lead
//   DELETE /api/leads/qualified/:id  — delete a qualified lead
//
// Cross-tool actions reuse the legacy command bar / company-intel modal when
// present (graceful fallback otherwise). See `docs/react-panel-migration.md`.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface BantVerdict {
  verdict?: string;
  why?: string;
}

interface Qualification {
  tier?: string;
  score?: number;
  reasoning?: string;
  bant?: {
    budget?: BantVerdict;
    authority?: BantVerdict;
    need?: BantVerdict;
    timeline?: BantVerdict;
  };
  suggestedActions?: string[];
}

interface Lead {
  id?: string;
  name?: string;
  email?: string;
  company?: string;
  source?: string;
  qualification?: Qualification;
}

interface QualifiedResult {
  ok: boolean;
  error?: string;
  leads?: Lead[];
}

interface QualifyResult {
  ok: boolean;
  error?: string;
}

const TIER_STYLES: Record<
  string,
  { bg: string; border: string; text: string; label: string }
> = {
  hot: { bg: "#FEE2E2", border: "#FCA5A5", text: "#991B1B", label: "🔥 HOT" },
  warm: { bg: "#FFEDD5", border: "#FDBA74", text: "#9A3412", label: "☀️ WARM" },
  cold: { bg: "#E0F2FE", border: "#7DD3FC", text: "#075985", label: "❄️ COLD" },
};

function BantRow({ label, v }: { label: string; v?: BantVerdict }) {
  const verdict = String((v && v.verdict) || "unknown").toLowerCase();
  const vc = verdict === "strong" ? "#065F46" : verdict === "weak" ? "#991B1B" : "#475569";
  const vbg = verdict === "strong" ? "#ECFDF5" : verdict === "weak" ? "#FEF2F2" : "#F1F5F9";
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "7px 0",
        borderTop: "1px solid #F1F5F9",
      }}
    >
      <div
        style={{
          fontSize: "0.7rem",
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: ".4px",
          color: "#64748B",
          width: 72,
          flexShrink: 0,
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1 }}>
        <span
          style={{
            display: "inline-block",
            fontSize: "0.68rem",
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 999,
            background: vbg,
            color: vc,
            marginRight: 6,
          }}
        >
          {verdict.toUpperCase()}
        </span>
        <span style={{ fontSize: "0.78rem", color: "#475569" }}>{(v && v.why) || "—"}</span>
      </div>
    </div>
  );
}

function LeadCard({ lead, onDelete }: { lead: Lead; onDelete: (id: string) => void }) {
  const q = lead.qualification || {};
  const tier = String(q.tier || "cold").toLowerCase();
  const ts = TIER_STYLES[tier] || TIER_STYLES.cold;
  const score = Number(q.score || 0);
  const bant = q.bant || {};
  const actions = Array.isArray(q.suggestedActions) ? q.suggestedActions : [];
  const safeId = String(lead.id || "").replace(/[^a-zA-Z0-9_-]/g, "");

  function intel() {
    const fn = (window as unknown as { showCompanyIntel?: (s: string) => void }).showCompanyIntel;
    if (lead.email && typeof fn === "function") fn(lead.email);
  }

  function enrollHot() {
    if (!lead.email) return;
    const w = window as unknown as {
      openCommandBar?: () => void;
    };
    if (typeof w.openCommandBar === "function") {
      w.openCommandBar();
      setTimeout(() => {
        const inp = document.getElementById("commandBarInput") as HTMLInputElement | null;
        if (inp) {
          inp.value = `Enrol ${lead.email} into the default 3-touch drip`;
          inp.focus();
        }
      }, 80);
    } else {
      alert("Command bar not available — open it with ⌘K and ask to enrol " + lead.email);
    }
  }

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #E5E7EB",
        borderRadius: 14,
        padding: 18,
        marginBottom: 12,
        boxShadow: "0 1px 2px rgba(0,0,0,.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: "#0F172A", fontSize: "0.95rem" }}>
            {lead.name || "(no name)"}{" "}
            <span style={{ color: "#94A3B8", fontWeight: 500, fontSize: "0.82rem" }}>
              · {lead.email}
            </span>
          </div>
          <div style={{ fontSize: "0.78rem", color: "#64748B", marginTop: 2 }}>
            {lead.company || "—"}
            {lead.source ? " · via " + lead.source : ""}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 800,
              padding: "4px 10px",
              borderRadius: 999,
              background: ts.bg,
              color: ts.text,
              border: `1px solid ${ts.border}`,
            }}
          >
            {ts.label}
          </span>
          <span style={{ fontSize: "0.72rem", color: "#64748B" }}>
            <b style={{ color: "#0F172A" }}>{score}</b>/100
          </span>
        </div>
      </div>

      {q.reasoning && (
        <div
          style={{
            fontSize: "0.82rem",
            color: "#475569",
            background: "#F8FAFC",
            borderLeft: "3px solid #0EA5E9",
            padding: "8px 12px",
            borderRadius: "0 8px 8px 0",
            margin: "8px 0",
          }}
        >
          {q.reasoning}
        </div>
      )}

      <div style={{ marginTop: 6 }}>
        <BantRow label="Budget" v={bant.budget} />
        <BantRow label="Authority" v={bant.authority} />
        <BantRow label="Need" v={bant.need} />
        <BantRow label="Timeline" v={bant.timeline} />
      </div>

      {actions.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #F1F5F9" }}>
          <div
            style={{
              fontSize: "0.72rem",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: ".4px",
              color: "#0F172A",
              marginBottom: 6,
            }}
          >
            Suggested next moves
          </div>
          {actions.map((a, i) => (
            <div key={i} style={{ fontSize: "0.82rem", color: "#0F172A", padding: "4px 0" }}>
              → {a}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={intel}
          title="Enrich this lead's company via Apollo + BuiltWith"
          style={{
            padding: "7px 12px",
            background: "#F1F5F9",
            color: "#0369A1",
            border: "1px solid #CBD5E1",
            borderRadius: 7,
            fontSize: "0.78rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          🔍 Intel
        </button>
        {tier === "hot" && (
          <button
            type="button"
            onClick={enrollHot}
            style={{
              padding: "7px 12px",
              background: "#0369A1",
              color: "white",
              border: "none",
              borderRadius: 7,
              fontSize: "0.78rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            → Enrol in nurture
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(safeId)}
          style={{
            padding: "7px 12px",
            background: "#FEE2E2",
            color: "#991B1B",
            border: "none",
            borderRadius: 7,
            fontSize: "0.78rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function LeadQualifier() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [behaviour, setBehaviour] = useState("");
  const [qualifying, setQualifying] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  async function load() {
    setLoadError("");
    const r = await apiGet<QualifiedResult>("/api/leads/qualified");
    if (!r.ok) {
      setLoadError(r.error || "Failed");
      setLeads(null);
      return;
    }
    setLeads(r.leads || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function submit() {
    const payload = {
      name: name.trim(),
      email: email.trim(),
      company: company.trim(),
      source: source.trim(),
      notes: notes.trim(),
      behaviour: behaviour.trim(),
    };
    if (!payload.email) {
      setResult({ kind: "error", msg: "⚠️ Email is required." });
      return;
    }
    setQualifying(true);
    setResult(null);
    const r = await apiPost<QualifyResult>("/api/leads/qualify", payload);
    setQualifying(false);
    if (!r.ok) {
      setResult({ kind: "error", msg: "⚠️ " + (r.error || "Failed") });
      return;
    }
    setResult({ kind: "ok", msg: "✓ Lead qualified — see the panel on the right." });
    setName("");
    setEmail("");
    setCompany("");
    setSource("");
    setNotes("");
    setBehaviour("");
    setTimeout(() => load(), 600);
  }

  async function remove(id: string) {
    if (!id) return;
    if (!confirm("Delete this qualified lead?")) return;
    await apiDelete("/api/leads/qualified/" + encodeURIComponent(id));
    load();
  }

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px",
    border: "1px solid #E5E7EB",
    borderRadius: 8,
    fontSize: "0.88rem",
  };

  return (
    <>
      <div
        className="view-header"
        style={{ background: "linear-gradient(135deg,#0C4A6E 0%,#0369A1 50%,#0EA5E9 100%)" }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: '#64748b' }}>
                <span className="bc-group" style={{ color: "rgba(186,230,253,.8)" }}>
                  Reach
                </span>{" "}
                <span className="bc-sep" style={{ color: '#94a3b8' }}>
                  ›
                </span>{" "}
                Lead Qualifier
              </div>
              <h2 className="view-title">Lead Qualifier</h2>
              <p className="view-sub">
                Drop in any inbound lead — InfoGenie&apos;s GPT-4o agent scores them on BANT, fit and
                intent, then tells you the best next move. Hot leads can be enrolled into a nurture in
                one click.
              </p>
            </div>
            <div className="vh-actions">
              <button className="btn-refresh-light" onClick={load}>
                ↻ Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        {leads === null && !loadError ? (
          <div style={{ textAlign: "center", padding: 48, color: "#64748B" }}>
            ⏳ Loading qualified leads…
          </div>
        ) : loadError ? (
          <div
            style={{
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: 14,
              padding: 24,
              color: "#991B1B",
            }}
          >
            <b>⚠️ Could not load</b>
            <div style={{ fontSize: "0.85rem", marginTop: 6 }}>{loadError}</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, alignItems: "start" }}>
            <div
              style={{
                background: "white",
                border: "1px solid #E5E7EB",
                borderRadius: 14,
                padding: 22,
                boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              }}
            >
              <div style={{ fontSize: "1rem", fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>
                Qualify a new lead
              </div>
              <div style={{ fontSize: "0.8rem", color: "#64748B", marginBottom: 16 }}>
                GPT-4o scores fit + intent and gives you the best next move.
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name (optional)"
                  style={inputStyle}
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email * (required)"
                  style={inputStyle}
                />
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Company (optional)"
                  style={inputStyle}
                />
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Source — webform, demo, referral…"
                  style={inputStyle}
                />
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes — anything you know (role, budget, timing, pain)…"
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                />
                <textarea
                  value={behaviour}
                  onChange={(e) => setBehaviour(e.target.value)}
                  placeholder="Recent behaviour (optional) — e.g. visited pricing 3x, downloaded CAC ebook"
                  rows={2}
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                />
                <button
                  onClick={submit}
                  disabled={qualifying}
                  style={{
                    marginTop: 6,
                    padding: "11px 18px",
                    background: "linear-gradient(135deg,#0369A1,#0EA5E9)",
                    color: "white",
                    border: "none",
                    borderRadius: 9,
                    fontWeight: 700,
                    fontSize: "0.88rem",
                    cursor: "pointer",
                  }}
                >
                  {qualifying ? "⏳ Qualifying…" : "🧲 Qualify Lead"}
                </button>
              </div>
              {result && (
                <div style={{ marginTop: 14 }}>
                  {result.kind === "ok" ? (
                    <div
                      style={{
                        background: "#ECFDF5",
                        border: "1px solid #A7F3D0",
                        borderRadius: 8,
                        padding: "10px 12px",
                        fontSize: "0.82rem",
                        color: "#065F46",
                      }}
                    >
                      {result.msg}
                    </div>
                  ) : (
                    <div
                      style={{
                        background: "#FEF2F2",
                        border: "1px solid #FECACA",
                        borderRadius: 8,
                        padding: "10px 12px",
                        fontSize: "0.82rem",
                        color: "#991B1B",
                      }}
                    >
                      {result.msg}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: "1rem", fontWeight: 800, color: "#0F172A", marginBottom: 10 }}>
                Recent qualifications{" "}
                <span style={{ fontWeight: 500, color: "#94A3B8" }}>({(leads || []).length})</span>
              </div>
              {(leads || []).length === 0 ? (
                <div
                  style={{
                    background: "#F8FAFC",
                    border: "1px dashed #CBD5E1",
                    borderRadius: 14,
                    padding: 32,
                    textAlign: "center",
                    color: "#64748B",
                  }}
                >
                  <div style={{ fontSize: "2rem", marginBottom: 8 }}>🧲</div>
                  <div style={{ fontWeight: 600, color: "#475569" }}>No leads qualified yet</div>
                  <div style={{ fontSize: "0.82rem", marginTop: 4 }}>
                    Qualify your first lead with the form on the left, or ask the ✨ command bar:{" "}
                    <i>&quot;qualify jane@acme.com, CMO at Acme, downloaded our CAC ebook&quot;</i>.
                  </div>
                </div>
              ) : (
                (leads || []).map((lead, i) => (
                  <LeadCard key={lead.id || i} lead={lead} onDelete={remove} />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

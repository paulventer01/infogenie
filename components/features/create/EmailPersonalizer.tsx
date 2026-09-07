"use client";

// Native React port of the legacy `email-personalizer` panel
// (`window.buildEmailPersonalizer` + `#view-email-personalizer` in index.html,
// builder in public/js/ig_intel_pack_a.js). Takes a base cold-email template +
// pasted leads and returns one personalized email per lead via
// `POST /api/email-personalizer/bulk`. "Pull leads" reads the legacy B2B Lead
// Finder cache (`window._lfLeads`). Renders REAL API results only.

import { useState } from "react";
import { apiPost } from "@/lib/api";

interface Lead {
  name?: string;
  role?: string;
  company?: string;
  website?: string;
  linkedin?: string;
}
interface PersonalizedEmail {
  subject?: string;
  body?: string;
  reasoning?: string;
}
interface ResultItem {
  ok: boolean;
  source?: string;
  research_used?: boolean;
  lead?: Lead;
  email?: PersonalizedEmail;
  error?: string;
}
interface BulkResult {
  ok: boolean;
  error?: string;
  total: number;
  succeeded: number;
  ai_personalized: number;
  results: ResultItem[];
}

type RawLead = Record<string, unknown>;

function toast(msg: string) {
  const w = window as unknown as { showToast?: (m: string) => void };
  if (typeof w.showToast === "function") w.showToast(msg);
}

function getLfLeads(): RawLead[] {
  const w = window as unknown as { _lfLeads?: RawLead[] };
  return Array.isArray(w._lfLeads) ? w._lfLeads : [];
}

const str = (v: unknown): string => (v == null ? "" : String(v));

export default function EmailPersonalizer() {
  const [template, setTemplate] = useState("");
  const [tone, setTone] = useState("professional, warm, specific");
  const [research, setResearch] = useState(true);
  const [leadsText, setLeadsText] = useState("");

  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);
  const [progressNote, setProgressNote] = useState("");

  function loadSample() {
    setTemplate(`Hi [FIRST_NAME],

I noticed [COMPANY] is in the [ROLE]-led growth space. We help teams like yours cut campaign waste 30% with AI-driven optimization.

Would 15 min next week make sense to walk you through how we'd attack [COMPANY] specifically?

Best,
Paul`);
    setLeadsText(`{"name":"Jane Doe","role":"VP Marketing","company":"Acme Corp","website":"acme.com"}
{"name":"John Smith","role":"Head of Growth","company":"Stripe","website":"stripe.com"}`);
  }

  function pullLeads() {
    const cached = getLfLeads();
    if (!cached.length) {
      toast("⚠ No B2B Lead Finder cache. Run a search there first.");
      return;
    }
    const lines = cached
      .slice(0, 25)
      .map((l) =>
        JSON.stringify({
          name: str(l.name || l.contact_name),
          role: str(l.title || l.role),
          company: str(l.company || l.company_name),
          website: str(l.website || l.domain),
          linkedin: str(l.linkedin),
        }),
      )
      .join("\n");
    setLeadsText(lines);
    toast(`✅ Pulled ${Math.min(cached.length, 25)} lead(s)`);
  }

  async function run() {
    const tpl = template.trim();
    if (!tpl) {
      setStatus("error");
      setErrorMsg("⚠ Template required");
      setResult(null);
      return;
    }
    const leads: Lead[] = [];
    for (const line of leadsText.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        leads.push(JSON.parse(t) as Lead);
      } catch {
        setStatus("error");
        setErrorMsg(`⚠ Invalid JSON line: ${t.slice(0, 80)}`);
        setResult(null);
        return;
      }
    }
    if (!leads.length) {
      setStatus("error");
      setErrorMsg("⚠ Add at least one lead");
      setResult(null);
      return;
    }

    setStatus("loading");
    setErrorMsg("");
    setResult(null);
    setProgressNote(
      `⏳ Personalizing ${leads.length} email${leads.length > 1 ? "s" : ""}…${
        research ? " (researching websites — this takes 10-30s)" : ""
      }`,
    );
    const r = await apiPost<BulkResult>("/api/email-personalizer/bulk", {
      template: tpl,
      leads,
      tone: tone.trim(),
      research,
    });
    if (!r.ok) {
      setStatus("error");
      setErrorMsg(r.error || "failed");
      return;
    }
    const rows = Array.isArray(r.results) ? r.results : [];
    setResult({
      ...r,
      results: rows,
      total: typeof r.total === "number" ? r.total : rows.length,
      succeeded:
        typeof r.succeeded === "number"
          ? r.succeeded
          : rows.filter((x) => x && x.ok).length,
      ai_personalized:
        typeof r.ai_personalized === "number"
          ? r.ai_personalized
          : rows.filter((x) => x && x.source === "ai").length,
    });
    setStatus("idle");
  }

  async function copyEmail(i: number) {
    const el = document.getElementById(`epEmail-${i}`);
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.innerText || el.textContent || "");
      toast("✅ Copied");
    } catch (e) {
      toast("❌ " + (e instanceof Error ? e.message : "copy failed"));
    }
  }

  function exportCsv() {
    const results = result?.results || [];
    if (!results.length) return;
    const headers = [
      "name",
      "role",
      "company",
      "website",
      "source",
      "subject",
      "body",
    ];
    const rows = results
      .filter((r) => r.ok)
      .map((r) =>
        [
          r.lead?.name || "",
          r.lead?.role || "",
          r.lead?.company || "",
          r.lead?.website || "",
          r.source || "",
          r.email?.subject || "",
          r.email?.body || "",
        ]
          .map((v) => '"' + String(v).replace(/"/g, '""') + '"')
          .join(","),
      );
    const csv = [headers.join(",")].concat(rows).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "personalized-emails.csv";
    a.click();
  }

  const cardStyle: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #E5E7EB",
    borderRadius: 12,
    padding: 20,
    marginBottom: 18,
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> Email Personalizer
              </div>
              <h2 className="view-title">✉️ AI Sales Email Personalizer</h2>
              <p className="view-sub">
                Take a base cold-email template, paste your leads, and get one
                personalized email per lead — with real research from each
                lead&apos;s company website (Firecrawl + GPT-4o-mini). Pulls leads
                automatically from B2B Lead Finder.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <h3
              style={{
                margin: 0,
                color: "#0A1628",
                fontFamily: "Sora,sans-serif",
                fontSize: "1rem",
              }}
            >
              📝 Base Template
            </h3>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={pullLeads}
                style={{
                  background: "#F3F4F6",
                  border: "1px solid #E5E7EB",
                  color: "#374151",
                  padding: "7px 12px",
                  borderRadius: 6,
                  fontSize: "0.74rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                ⬇ Pull leads from B2B Lead Finder
              </button>
              <button
                onClick={loadSample}
                style={{
                  background: "#F3F4F6",
                  border: "1px solid #E5E7EB",
                  color: "#374151",
                  padding: "7px 12px",
                  borderRadius: 6,
                  fontSize: "0.74rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                📋 Load sample
              </button>
            </div>
          </div>
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={6}
            placeholder="Hi [FIRST_NAME], I noticed [COMPANY] is doing X — wanted to ask about Y. Worth 15 min?"
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              fontSize: "0.84rem",
              fontFamily: "inherit",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginTop: 4 }}>
            Tokens supported: [NAME] [FIRST_NAME] [COMPANY] [ROLE] [WEBSITE]. AI
            will replace + personalize using each lead&apos;s website.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 200px",
              gap: 10,
              marginTop: 12,
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                TONE
              </label>
              <input
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="professional, warm, specific"
                style={{
                  width: "100%",
                  padding: 8,
                  border: "1px solid #D1D5DB",
                  borderRadius: 6,
                  fontSize: "0.84rem",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "end" }}>
              <label
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  fontSize: "0.78rem",
                  color: "#374151",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={research}
                  onChange={(e) => setResearch(e.target.checked)}
                />{" "}
                Use website research (Firecrawl)
              </label>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <h3
            style={{
              margin: "0 0 10px",
              color: "#0A1628",
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
            }}
          >
            👥 Leads (one per line, JSON)
          </h3>
          <textarea
            value={leadsText}
            onChange={(e) => setLeadsText(e.target.value)}
            rows={6}
            placeholder='{"name":"Jane Doe","role":"VP Marketing","company":"Acme Corp","website":"acme.com"}'
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              fontSize: "0.78rem",
              fontFamily: "monospace",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginTop: 4 }}>
            Each line = one lead JSON. Max 25 per batch.
          </div>
          <button
            onClick={run}
            disabled={status === "loading"}
            style={{
              marginTop: 14,
              background: "linear-gradient(135deg,#0f766e,#0284c7)",
              color: "#fff",
              border: "none",
              padding: "12px 24px",
              borderRadius: 8,
              fontSize: "0.86rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            ✨ Personalize All
          </button>
        </div>

        <div>
          {status === "loading" && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 20,
                color: "#6B7280",
              }}
            >
              {progressNote}
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              {errorMsg}
            </div>
          )}
          {status === "idle" && result && (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div style={{ fontWeight: 800, color: "#0A1628" }}>
                  ✅ {result.succeeded}/{result.total} personalized ·{" "}
                  {result.ai_personalized} via AI ·{" "}
                  {result.total - result.ai_personalized} via template
                </div>
                <button
                  onClick={exportCsv}
                  style={{
                    padding: "7px 14px",
                    background: "#fff",
                    border: "2px solid #D1D5DB",
                    borderRadius: 6,
                    fontSize: "0.74rem",
                    fontWeight: 700,
                    color: "#374151",
                    cursor: "pointer",
                  }}
                >
                  📋 Export as CSV
                </button>
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {(result.results || []).map((x, i) => {
                  if (!x.ok) {
                    return (
                      <div
                        key={i}
                        style={{
                          background: "#FEF2F2",
                          border: "1px solid #FECACA",
                          color: "#991B1B",
                          padding: 12,
                          borderRadius: 8,
                          fontSize: "0.82rem",
                        }}
                      >
                        ❌ {x.lead?.name || "Unknown"} ({x.lead?.company || ""}):{" "}
                        {x.error || "failed"}
                      </div>
                    );
                  }
                  const e = x.email || {};
                  const lead = x.lead || {};
                  const isAi = x.source === "ai";
                  const sourcePill = isAi ? "AI" : "TEMPLATE";
                  const sourceColor = isAi
                    ? ["#EDE9FE", "#5B21B6"]
                    : ["#F3F4F6", "#374151"];
                  return (
                    <div
                      key={i}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderLeft: "3px solid #0f766e",
                        borderRadius: 10,
                        padding: "14px 16px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 8,
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 700,
                            color: "#0A1628",
                            fontSize: "0.88rem",
                          }}
                        >
                          {lead.name || "?"} ·{" "}
                          <span style={{ color: "#6B7280", fontWeight: 500 }}>
                            {lead.role || ""} @ {lead.company || ""}
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              background: sourceColor[0],
                              color: sourceColor[1],
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: "0.66rem",
                              fontWeight: 800,
                            }}
                          >
                            {sourcePill}
                            {x.research_used ? " + RESEARCH" : ""}
                          </span>
                          <button
                            onClick={() => copyEmail(i)}
                            style={{
                              background: "#F3F4F6",
                              border: "1px solid #E5E7EB",
                              color: "#374151",
                              padding: "4px 10px",
                              borderRadius: 5,
                              fontSize: "0.7rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            📋 Copy
                          </button>
                        </div>
                      </div>
                      <div id={`epEmail-${i}`}>
                        <div
                          style={{
                            fontWeight: 700,
                            color: "#0A1628",
                            fontSize: "0.86rem",
                            marginBottom: 6,
                          }}
                        >
                          Subject: {e.subject || ""}
                        </div>
                        <div
                          style={{
                            color: "#374151",
                            fontSize: "0.84rem",
                            lineHeight: 1.55,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {e.body || ""}
                        </div>
                      </div>
                      {e.reasoning && (
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: "0.7rem",
                            color: "#6B7280",
                            fontStyle: "italic",
                          }}
                        >
                          💡 {e.reasoning}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

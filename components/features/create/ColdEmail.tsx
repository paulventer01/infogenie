"use client";

// Native React port of the legacy `cold-email` panel
// (was `window.buildColdEmail` / `window._ceGo` in app.js ~20449 filling
// `#ceWrap`, header from `#view-cold-email` in index.html). Drafts a multi-step
// cold-outreach sequence via the existing Express API:
//   POST /api/cold-email/generate
//     { sender_brand, sender_name, sender_offer, target_company, target_role,
//       target_pain, tone, steps }
//     → { ok, emails:[{ step, days_after_prev, subject, preview, body, cta,
//                        why_this_works }], tone, source }
// Pre-fills from the legacy handoff global window._cePreset (set by Link
// Prospector), still populated in the replayed SPA.

import { useEffect, useState } from "react";
import { apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface ColdEmailItem {
  step: number;
  days_after_prev: number;
  subject?: string;
  preview?: string;
  body?: string;
  cta?: string;
  why_this_works?: string;
}
interface GenerateResult {
  ok: boolean;
  error?: string;
  emails?: ColdEmailItem[];
  tone?: string;
  source?: string;
}

const TONES = ["direct", "warm", "consultative", "witty", "executive", "curious"];

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
  marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontSize: "0.86rem",
  boxSizing: "border-box",
};
const taStyle: React.CSSProperties = {
  ...inputStyle,
  padding: "10px 12px",
  fontFamily: "inherit",
  resize: "vertical",
};

declare global {
  interface Window {
    _cePreset?: {
      target_company?: string;
      target_pain?: string;
      sender_offer?: string;
      target_role?: string;
    } | null;
  }
}

export default function ColdEmail() {
  const toast = useToast();
  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [offer, setOffer] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [pain, setPain] = useState("");
  const [tone, setTone] = useState("direct");
  const [steps, setSteps] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emails, setEmails] = useState<ColdEmailItem[] | null>(null);
  const [resultTone, setResultTone] = useState("");
  const [source, setSource] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined" && window._cePreset) {
      const p = window._cePreset;
      window._cePreset = null;
      if (p.target_company) setCompany(p.target_company);
      if (p.target_pain) setPain(p.target_pain);
      if (p.sender_offer) setOffer(p.sender_offer);
      if (p.target_role) setRole(p.target_role);
    }
  }, []);

  async function generate() {
    if (!offer.trim()) { toast('⚠️ "What you sell" required'); return; }
    setLoading(true);
    setError("");
    setEmails(null);
    const r = await apiPost<GenerateResult>("/api/cold-email/generate", {
      sender_brand: brand,
      sender_name: name,
      sender_offer: offer,
      target_company: company,
      target_role: role,
      target_pain: pain,
      tone,
      steps,
    });
    setLoading(false);
    if (!r.ok || !r.emails) {
      setError(r.error || "failed");
      return;
    }
    setEmails(r.emails);
    setResultTone(r.tone || "");
    setSource(r.source || "");
  }

  async function copyEmail(step: number) {
    const em = (emails || []).find((e) => e.step === step);
    if (!em) return;
    const txt = `Subject: ${em.subject}\n\n${em.body}`;
    try {
      await navigator.clipboard.writeText(txt);
      toast("✅ Email copied");
    } catch {
      toast("❌ Copy failed");
    }
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Cold Email Writer
              </div>
              <h2 className="view-title">✉️ AI Cold Email Writer</h2>
              <p className="view-sub">
                Drafts a multi-step cold outreach sequence — opener, follow-ups,
                and breakup — tailored to one prospect&apos;s role, company, and
                pain point.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 20,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label style={labelStyle}>Your brand</label>
              <input
                placeholder="e.g. InfoGenie"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Your name</label>
              <input
                placeholder="e.g. Paul"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>What you sell / offer</label>
            <textarea
              rows={2}
              placeholder="One sentence about your product and the outcome it delivers."
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              style={taStyle}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label style={labelStyle}>Target company (optional)</label>
              <input
                placeholder="e.g. Nike"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Target role</label>
              <input
                placeholder="e.g. Head of Growth"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Their pain / trigger event</label>
            <textarea
              rows={2}
              placeholder="What problem they're hitting right now, or a recent trigger (funding round, hire, product launch)."
              value={pain}
              onChange={(e) => setPain(e.target.value)}
              style={taStyle}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr auto",
              gap: 12,
              alignItems: "end",
            }}
          >
            <div>
              <label style={labelStyle}>Tone</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                style={inputStyle}
              >
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Sequence steps</label>
              <select
                value={steps}
                onChange={(e) => setSteps(parseInt(e.target.value, 10))}
                style={inputStyle}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} step{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={generate}
              disabled={loading}
              style={{
                padding: "10px 22px",
                background: "#DC2626",
                border: "2px solid #DC2626",
                borderRadius: 8,
                fontSize: "0.84rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              ✉️ Draft Sequence
            </button>
          </div>
        </div>

        <div>
          {loading && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 20,
                color: "#6B7280",
              }}
            >
              ⏳ Drafting {steps}-step sequence…
            </div>
          )}
          {error && !loading && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              {error}
            </div>
          )}
          {emails && !loading && (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontWeight: 800, color: "#0A1628" }}>
                  📧 {emails.length}-step sequence · {resultTone} tone{" "}
                  <span
                    style={{
                      background: source === "openai" ? "#DC2626" : "#9CA3AF",
                      color: "#fff",
                      padding: "3px 9px",
                      borderRadius: 5,
                      fontSize: "0.62rem",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      marginLeft: 8,
                    }}
                  >
                    {source}
                  </span>
                </div>
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                {emails.map((em) => (
                  <div
                    key={em.step}
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderLeft: "4px solid #DC2626",
                      borderRadius: 10,
                      padding: "18px 22px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            background: "#DC2626",
                            color: "#fff",
                            width: 30,
                            height: 30,
                            borderRadius: "50%",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 800,
                            fontSize: "0.82rem",
                            textShadow: "0 1px 2px rgba(0,0,0,.4)",
                          }}
                        >
                          {em.step}
                        </span>
                        <div style={{ fontSize: "0.74rem", color: "#6B7280" }}>
                          {em.days_after_prev === 0
                            ? "Day 0 (opener)"
                            : `+${em.days_after_prev} days`}
                        </div>
                      </div>
                      <button
                        onClick={() => copyEmail(em.step)}
                        style={{
                          padding: "6px 12px",
                          background: "#fff",
                          border: "1.5px solid #D1D5DB",
                          borderRadius: 5,
                          fontSize: "0.72rem",
                          fontWeight: 700,
                          color: "#374151",
                          cursor: "pointer",
                        }}
                      >
                        📋 Copy
                      </button>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: "0.7rem",
                          color: "#6B7280",
                          fontWeight: 700,
                          letterSpacing: ".06em",
                          marginBottom: 3,
                        }}
                      >
                        SUBJECT
                      </div>
                      <div
                        style={{
                          fontSize: "1rem",
                          color: "#0A1628",
                          fontWeight: 700,
                          marginBottom: 8,
                        }}
                      >
                        {em.subject || ""}
                      </div>
                      {em.preview && (
                        <div
                          style={{
                            fontSize: "0.78rem",
                            color: "#6B7280",
                            marginBottom: 12,
                            fontStyle: "italic",
                          }}
                        >
                          ↳ {em.preview}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: "0.7rem",
                          color: "#6B7280",
                          fontWeight: 700,
                          letterSpacing: ".06em",
                          marginBottom: 3,
                        }}
                      >
                        BODY
                      </div>
                      <div
                        style={{
                          fontSize: "0.88rem",
                          color: "#1F2937",
                          lineHeight: 1.65,
                          whiteSpace: "pre-wrap",
                          background: "#F9FAFB",
                          padding: "12px 16px",
                          borderRadius: 6,
                        }}
                      >
                        {em.body || ""}
                      </div>
                      {em.cta && (
                        <div
                          style={{
                            marginTop: 10,
                            fontSize: "0.82rem",
                            color: "#DC2626",
                            fontWeight: 700,
                          }}
                        >
                          → CTA: {em.cta}
                        </div>
                      )}
                    </div>
                    {em.why_this_works && (
                      <div
                        style={{
                          marginTop: 10,
                          fontSize: "0.74rem",
                          color: "#6B7280",
                          fontStyle: "italic",
                          paddingTop: 8,
                          borderTop: "1px dashed #E5E7EB",
                        }}
                      >
                        💡 {em.why_this_works}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

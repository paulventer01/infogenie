"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";
import PanelShell from "@/components/layout/PanelShell";

interface Principle {
  id: string;
  label: string;
  description: string;
}

interface Pillar extends Principle {
  score: number;
  checks?: { id: string; label: string; status: string; message?: string; fix?: string }[];
}

interface Fix {
  id: string;
  label: string;
  status: string;
  fix: string;
}

interface RunSummary {
  id?: string;
  url: string;
  score: number;
  grade: string;
  pillars?: Pillar[];
  fixes?: Fix[];
  priority?: string;
  checks?: { id: string; label: string; status: string; message?: string; fix?: string }[];
  created_at?: string;
}

interface FaqResult {
  faqs?: { question: string; answer: string }[];
  leadParagraph?: string;
  suggestedH2Questions?: string[];
  faqPageSchema?: object;
}

const pillarColors: Record<string, string> = {
  structure: "#6366F1",
  direct_answers: "#0EA5E9",
  authority: "#10B981",
  ai_formatting: "#F59E0B",
};

const statusIcon = (s: string) => (s === "pass" ? "✅" : s === "warn" ? "⚠️" : "❌");

type FixCta = { label: string; view?: string; action?: "faq" };

const FIX_CTA: Record<string, FixCta> = {
  schema: { label: "Open Schema Generator", view: "schema-generator" },
  q_headings: { label: "Generate FAQ + schema", action: "faq" },
  lead_answer: { label: "Generate FAQ + schema", action: "faq" },
  concise_paras: { label: "Generate FAQ + schema", action: "faq" },
  semantic_chunks: { label: "Generate FAQ + schema", action: "faq" },
  llms_txt: { label: "Open SEO Auditor", view: "seo-auditor" },
  meta_desc: { label: "Open SEO Auditor", view: "seo-auditor" },
  title: { label: "Open SEO Auditor", view: "seo-auditor" },
  alt_text: { label: "Open SEO Auditor", view: "seo-auditor" },
  eeat: { label: "Open Content Score", view: "content-score" },
  freshness: { label: "Open SEO Roadmap", view: "seo-roadmap" },
  internal_links: { label: "Open Link Suggester", view: "link-suggester" },
};

function ctaForFix(id: string): FixCta {
  return FIX_CTA[id] || { label: "Citation check (GEO)", view: "geo-audit" };
}

const btnPrimary: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: "linear-gradient(135deg,#0066FF,#00C9C8)",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "0.78rem",
};
const btnOutline: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #D1D5DB",
  background: "#fff",
  color: "#0F172A",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "0.78rem",
};

export default function AeoOptimizer() {
  const router = useRouter();
  const [principles, setPrinciples] = useState<Principle[]>([]);
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<RunSummary | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [faq, setFaq] = useState<FaqResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyFaq, setBusyFaq] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [p, h] = await Promise.all([
      apiGet<{ ok?: boolean; principles?: Principle[] }>("/api/aeo/principles"),
      apiGet<{ ok?: boolean; runs?: RunSummary[] }>("/api/aeo/runs"),
    ]);
    if (p.principles) setPrinciples(p.principles);
    setHistory(h.runs || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAudit = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setErr("");
    setFaq(null);
    const r = await apiPost<RunSummary & { ok?: boolean; error?: string }>("/api/aeo/run", { url: url.trim() });
    setLoading(false);
    if (!r.ok) {
      setErr(r.error || "Audit failed");
      return;
    }
    setReport(r);
    void load();
  };

  const generateFaq = async () => {
    if (!report) return;
    setBusyFaq(true);
    setErr("");
    // Prefer persisted run; fall back to URL-based endpoint when DB row missing.
    const path = report.id
      ? `/api/aeo/runs/${report.id}/generate-faq`
      : "/api/aeo/generate-faq";
    const r = await apiPost<{ ok?: boolean; faq?: FaqResult; error?: string }>(path, {
      url: report.url,
      topic: report.url,
    });
    setBusyFaq(false);
    if (!r.ok || !r.faq) {
      setErr(r.error || "FAQ generation failed — check AI keys in Settings");
      return;
    }
    setFaq(r.faq);
  };

  const runFixCta = (cta: FixCta) => {
    if (cta.action === "faq") {
      void generateFaq();
      return;
    }
    if (cta.view) goToView(router, cta.view);
  };

  return (
    <PanelShell
      group="Reach"
      title="💬 Answer Engine Optimization"
      subtitle="Optimize pages for ChatGPT, Perplexity, Gemini, and Google AI Overviews — structure, direct answers, authority, and AI-friendly formatting."
    >
      {principles.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 20 }}>
          {principles.map((p) => (
            <div key={p.id} className="ig-tile" style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ fontWeight: 800, fontSize: "0.85rem", color: pillarColors[p.id] || "#374151", marginBottom: 6 }}>{p.label}</div>
              <div style={{ fontSize: "0.78rem", color: "#6B7280", lineHeight: 1.45 }}>{p.description}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
        <h3 style={{ margin: "0 0 12px", color: "#0F172A" }}>Run AEO audit</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yoursite.com/page-to-optimize"
            style={{ flex: 1, minWidth: 240, padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", color: "#0F172A" }}
          />
          <button type="button" disabled={loading} onClick={runAudit} style={{ ...btnPrimary, padding: "10px 18px", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Auditing…" : "Analyze page"}
          </button>
        </div>
        {err && <p style={{ color: "#B91C1C", fontSize: "0.85rem", marginTop: 10 }}>{err}</p>}
      </div>

      {report && (
        <>
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: "2rem", fontWeight: 900, color: "#0A1628" }}>
                  {report.score}/100 <span style={{ fontSize: "1.2rem" }}>Grade {report.grade}</span>
                </div>
                <div style={{ fontSize: "0.82rem", color: "#6B7280", marginTop: 4 }}>{report.url}</div>
                {report.priority && <p style={{ fontSize: "0.85rem", marginTop: 10, color: "#374151" }}>{report.priority}</p>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" disabled={busyFaq} onClick={generateFaq} style={{ ...btnOutline, opacity: busyFaq ? 0.6 : 1 }}>
                  {busyFaq ? "Generating…" : "✨ Generate FAQ + schema"}
                </button>
                <button type="button" onClick={() => goToView(router, "schema-generator")} style={{ ...btnPrimary, background: "#10B981" }}>
                  Open Schema Generator
                </button>
                <button type="button" onClick={() => goToView(router, "geo-audit")} style={btnOutline}>
                  Citation check (GEO)
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginTop: 18 }}>
              {(report.pillars || []).map((p) => (
                <div key={p.id} className="ig-tile" style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 12, background: "#fff" }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: pillarColors[p.id] || "#6B7280", textTransform: "uppercase" }}>{p.label}</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: 4, color: "#0F172A" }}>{p.score}</div>
                </div>
              ))}
            </div>
          </div>

          {report.fixes && report.fixes.length > 0 && (
            <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
              <h3 style={{ margin: "0 0 12px", color: "#0F172A" }}>Priority fixes</h3>
              {report.fixes.map((f) => {
                const cta = ctaForFix(f.id);
                return (
                  <div
                    key={f.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "12px 0",
                      borderBottom: "1px solid #F3F4F6",
                      fontSize: "0.85rem",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ color: "#0F172A" }}>
                        {statusIcon(f.status)} {f.label}
                      </strong>
                      <p style={{ margin: "6px 0 0", color: "#4B5563" }}>{f.fix}</p>
                    </div>
                    <button type="button" onClick={() => runFixCta(cta)} style={{ ...btnPrimary, flexShrink: 0, whiteSpace: "nowrap" }}>
                      {cta.label} →
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {faq?.faqs && (
            <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                <h3 style={{ margin: 0, color: "#0F172A" }}>AI-generated FAQ pack</h3>
                {faq.faqPageSchema && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(JSON.stringify(faq.faqPageSchema, null, 2));
                      } catch {
                        /* ignore */
                      }
                    }}
                    style={btnOutline}
                  >
                    Copy FAQ schema JSON-LD
                  </button>
                )}
              </div>
              {faq.leadParagraph && (
                <div style={{ background: "#F0FDF4", padding: 12, borderRadius: 8, marginBottom: 12, fontSize: "0.85rem", color: "#0F172A" }}>
                  <strong>Suggested lead paragraph:</strong> {faq.leadParagraph}
                </div>
              )}
              {faq.faqs.map((item, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#0F172A" }}>{item.question}</div>
                  <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "#4B5563" }}>{item.answer}</p>
                </div>
              ))}
              {faq.faqPageSchema && (
                <pre
                  style={{
                    marginTop: 12,
                    background: "#F8FAFC",
                    border: "1px solid #E2E8F0",
                    borderRadius: 10,
                    padding: 12,
                    fontSize: 11,
                    overflow: "auto",
                    maxHeight: 220,
                    color: "#334155",
                  }}
                >
                  {JSON.stringify(faq.faqPageSchema, null, 2)}
                </pre>
              )}
            </div>
          )}

          {report.checks && (
            <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
              <h3 style={{ margin: "0 0 12px", color: "#0F172A" }}>All checks</h3>
              {report.checks.map((c) => (
                <div key={c.id} style={{ display: "flex", gap: 8, padding: "6px 0", fontSize: "0.8rem", borderBottom: "1px solid #F9FAFB", color: "#0F172A" }}>
                  <span>{statusIcon(c.status)}</span>
                  <span style={{ fontWeight: 600, minWidth: 180 }}>{c.label}</span>
                  <span style={{ color: "#6B7280" }}>{c.message}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {history.length > 0 && !report && (
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
          <h3 style={{ margin: "0 0 12px", color: "#0F172A" }}>Recent AEO audits</h3>
          {history.slice(0, 8).map((h) => (
            <div
              key={h.id || h.url + h.created_at}
              style={{ padding: "8px 0", borderBottom: "1px solid #F3F4F6", fontSize: "0.82rem", cursor: "pointer", color: "#0F172A" }}
              onClick={() => {
                setUrl(h.url);
                setReport(h);
              }}
            >
              <strong>
                {h.score}/100 ({h.grade})
              </strong>{" "}
              — {h.url}
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

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

export default function AeoOptimizer() {
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

  useEffect(() => { load(); }, [load]);

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
    load();
  };

  const generateFaq = async () => {
    if (!report?.id) return;
    setBusyFaq(true);
    const r = await apiPost<{ ok?: boolean; faq?: FaqResult }>(`/api/aeo/runs/${report.id}/generate-faq`, {});
    setBusyFaq(false);
    if (r.faq) setFaq(r.faq);
  };

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#eef2ff 0%,#f0f9ff 50%,#ecfdf5 100%)" }}>
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Reach</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> AEO
        </div>
        <h1 className="ih-title">💬 Answer Engine Optimization</h1>
        <p className="ih-sub">
          Optimize pages for ChatGPT, Perplexity, Gemini, and Google AI Overviews. AEO scores your content on four principles:
          clear structure, direct answers, authority signals, and AI-friendly formatting.
        </p>
      </div>

      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        {principles.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 20 }}>
            {principles.map((p) => (
              <div key={p.id} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontWeight: 800, fontSize: "0.85rem", color: pillarColors[p.id] || "#374151", marginBottom: 6 }}>{p.label}</div>
                <div style={{ fontSize: "0.78rem", color: "#6B7280", lineHeight: 1.45 }}>{p.description}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
          <h3 style={{ margin: "0 0 12px" }}>Run AEO audit</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yoursite.com/page-to-optimize"
              style={{ flex: 1, minWidth: 240, padding: 10, borderRadius: 8, border: "1px solid #D1D5DB" }}
            />
            <button type="button" disabled={loading} onClick={runAudit} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#0066FF", color: "white", fontWeight: 700, cursor: "pointer" }}>
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
                  <div style={{ fontSize: "2rem", fontWeight: 900, color: "#0A1628" }}>{report.score}/100 <span style={{ fontSize: "1.2rem" }}>Grade {report.grade}</span></div>
                  <div style={{ fontSize: "0.82rem", color: "#6B7280", marginTop: 4 }}>{report.url}</div>
                  {report.priority && <p style={{ fontSize: "0.85rem", marginTop: 10, color: "#374151" }}>{report.priority}</p>}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" disabled={busyFaq || !report.id} onClick={generateFaq} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #D1D5DB", background: "white", fontWeight: 700, cursor: "pointer" }}>
                    {busyFaq ? "Generating…" : "✨ Generate FAQ + schema"}
                  </button>
                  <button type="button" onClick={() => goToView("schema-generator")} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#10B981", color: "white", fontWeight: 700, cursor: "pointer" }}>
                    Open Schema Generator
                  </button>
                  <button type="button" onClick={() => goToView("geo-audit")} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #D1D5DB", background: "white", fontWeight: 700, cursor: "pointer" }}>
                    Citation check (GEO)
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginTop: 18 }}>
                {(report.pillars || []).map((p) => (
                  <div key={p.id} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: pillarColors[p.id] || "#6B7280", textTransform: "uppercase" }}>{p.label}</div>
                    <div style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: 4 }}>{p.score}</div>
                  </div>
                ))}
              </div>
            </div>

            {report.fixes && report.fixes.length > 0 && (
              <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
                <h3 style={{ margin: "0 0 12px" }}>Priority fixes</h3>
                {report.fixes.map((f) => (
                  <div key={f.id} style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6", fontSize: "0.85rem" }}>
                    <strong>{statusIcon(f.status)} {f.label}</strong>
                    <p style={{ margin: "6px 0 0", color: "#4B5563" }}>{f.fix}</p>
                  </div>
                ))}
              </div>
            )}

            {faq?.faqs && (
              <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
                <h3 style={{ margin: "0 0 12px" }}>AI-generated FAQ pack</h3>
                {faq.leadParagraph && (
                  <div style={{ background: "#F0FDF4", padding: 12, borderRadius: 8, marginBottom: 12, fontSize: "0.85rem" }}>
                    <strong>Suggested lead paragraph:</strong> {faq.leadParagraph}
                  </div>
                )}
                {faq.faqs.map((item, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>{item.question}</div>
                    <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "#4B5563" }}>{item.answer}</p>
                  </div>
                ))}
              </div>
            )}

            {report.checks && (
              <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
                <h3 style={{ margin: "0 0 12px" }}>All checks</h3>
                {report.checks.map((c) => (
                  <div key={c.id} style={{ display: "flex", gap: 8, padding: "6px 0", fontSize: "0.8rem", borderBottom: "1px solid #F9FAFB" }}>
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
            <h3 style={{ margin: "0 0 12px" }}>Recent AEO audits</h3>
            {history.slice(0, 8).map((h) => (
              <div key={h.id || h.url + h.created_at} style={{ padding: "8px 0", borderBottom: "1px solid #F3F4F6", fontSize: "0.82rem", cursor: "pointer" }} onClick={() => { setUrl(h.url); }}>
                <strong>{h.score}/100 ({h.grade})</strong> — {h.url}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

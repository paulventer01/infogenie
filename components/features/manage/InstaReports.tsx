"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, type ApiResult } from "@/lib/api";

interface Prospect {
  id: number;
  business_name: string;
  contact_name: string | null;
  email: string | null;
  website_url: string | null;
  industry: string | null;
  location: string | null;
  report_count: number;
  created_at: string;
}

interface Report {
  id: number;
  prospect_id: number;
  business_name: string;
  contact_name: string | null;
  email: string | null;
  website_url: string | null;
  industry: string | null;
  status: string;
  sections_enabled: string[];
  report_data: Record<string, ReportSection>;
  public_token: string;
  generated_at: string | null;
  viewed_at: string | null;
  send_count: number;
  created_at: string;
}

interface ReportSection {
  score?: number;
  grade?: string;
  headline?: string;
  findings?: string[];
  issues?: string[];
  quick_fixes?: string[];
  gaps?: string[];
  opportunities?: string[];
  platforms_detected?: string[];
  overall_score?: number;
  overall_grade?: string;
  executive_summary?: string;
  quick_wins?: { action: string; impact: string; effort: string; timeline: string }[];
  strategic_priorities?: string[];
  estimated_opportunity?: string;
}

interface Section { id: string; label: string; icon: string; description: string; }

interface ConfigResponse extends ApiResult { sections?: Section[]; }
interface ReportsResponse extends ApiResult { reports?: Report[]; }
interface ProspectsResponse extends ApiResult { prospects?: Prospect[]; }
interface CreateProspectResponse extends ApiResult { prospect: Prospect; }
interface CreateReportResponse extends ApiResult { report: Report; prospect: Prospect; }
interface ReportResponse extends ApiResult { report: Report; }

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: "⏳ Pending",    color: "#64748B", bg: "#F1F5F9" },
  generating: { label: "⚙️ Generating", color: "#D97706", bg: "#FFF7ED" },
  ready:      { label: "✅ Ready",      color: "#059669", bg: "#ECFDF5" },
  failed:     { label: "❌ Failed",     color: "#DC2626", bg: "#FEF2F2" },
};

const GRADE_COLOR: Record<string, string> = { A: "#059669", B: "#10B981", C: "#D97706", D: "#F59E0B", F: "#DC2626" };

export default function InstaReports() {
  const [reports, setReports]       = useState<Report[]>([]);
  const [prospects, setProspects]   = useState<Prospect[]>([]);
  const [sections, setSections]     = useState<Section[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<"reports" | "new" | "view">("reports");
  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const [toast, setToast]           = useState("");
  const [saving, setSaving]         = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending]       = useState(false);
  const [bulkText, setBulkText]     = useState("");
  const [sendTo, setSendTo]         = useState("");
  const [copied, setCopied]         = useState(false);
  const [reportTab, setReportTab]   = useState("overview");

  // Wizard state
  const [step, setStep]             = useState(1);
  const [dataSource, setDataSource] = useState<"manual" | "csv">("manual");
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);
  const [enabledSections, setEnabledSections]   = useState<string[]>(["seo", "pagespeed", "content", "social", "competitors", "recommendations"]);
  const [prospectForm, setProspectForm] = useState({ business_name: "", contact_name: "", email: "", website_url: "", industry: "", location: "" });

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    const [cfg, r, pr] = await Promise.all([
      apiGet<ConfigResponse>("/api/insta-reports/config"),
      apiGet<ReportsResponse>("/api/insta-reports/reports"),
      apiGet<ProspectsResponse>("/api/insta-reports/prospects"),
    ]);
    if (cfg?.sections) setSections(cfg.sections);
    if (r?.reports) setReports(r.reports);
    if (pr?.prospects) setProspects(pr.prospects);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleBulkImport() {
    const lines = bulkText.trim().split("\n").filter(Boolean);
    const parsed = lines.map(line => {
      const parts = line.split(/[,\t]/).map(s => s.trim());
      return { business_name: parts[0] || "", contact_name: parts[1] || "", email: parts[2] || "", website_url: parts[3] || "", industry: parts[4] || "", location: parts[5] || "" };
    }).filter(p => p.business_name);
    const r = await apiPost<ApiResult & { added: number }>("/api/insta-reports/prospects/bulk", { prospects: parsed });
    if (r?.ok) {
      showToast(`✅ Imported ${r.added} prospect(s)`);
      setBulkText("");
      const fresh = await apiGet<ProspectsResponse>("/api/insta-reports/prospects");
      if (fresh?.prospects) setProspects(fresh.prospects);
    }
  }

  async function handleCreateReport() {
    setSaving(true);
    let prospectId = selectedProspect?.id;
    if (!prospectId) {
      if (!prospectForm.business_name) { showToast("Business name required."); setSaving(false); return; }
      const pr = await apiPost<CreateProspectResponse>("/api/insta-reports/prospects", prospectForm);
      if (!pr?.ok) { showToast("Failed to create prospect."); setSaving(false); return; }
      prospectId = pr.prospect.id;
      setProspects(prev => [pr.prospect, ...prev]);
    }
    const r = await apiPost<CreateReportResponse>("/api/insta-reports/reports", { prospect_id: prospectId, sections_enabled: enabledSections });
    if (r?.ok) {
      showToast("✅ Report created — generating now…");
      setReports(prev => [{ ...r.report, business_name: r.prospect.business_name, email: r.prospect.email, website_url: r.prospect.website_url, contact_name: r.prospect.contact_name, industry: r.prospect.industry, send_count: 0, report_data: {} }, ...prev]);
      setGenerating(true);
      const gen = await apiPost<ApiResult>(`/api/insta-reports/reports/${r.report.id}/generate`, {});
      if (gen?.ok) {
        const fresh = await apiGet<ReportResponse>(`/api/insta-reports/reports/${r.report.id}`);
        if (fresh?.ok) {
          setActiveReport(fresh.report);
          setReports(prev => prev.map(rp => rp.id === r.report.id ? fresh.report : rp));
          setTab("view");
          setReportTab("overview");
        }
      } else { showToast("Generation failed — ensure OpenAI key is configured."); }
      setGenerating(false);
      setStep(1);
      setSelectedProspect(null);
      setProspectForm({ business_name: "", contact_name: "", email: "", website_url: "", industry: "", location: "" });
    } else { showToast("Failed to create report."); }
    setSaving(false);
  }

  async function openReport(r: Report) {
    setActiveReport(r);
    setTab("view");
    setReportTab("overview");
    setSendTo(r.email || "");
  }

  async function handleSend() {
    if (!activeReport) return;
    if (!sendTo) { showToast("Enter recipient email."); return; }
    setSending(true);
    const r = await apiPost(`/api/insta-reports/reports/${activeReport.id}/send`, { to_email: sendTo });
    if (r?.ok) {
      showToast(r.sent ? `✅ Report sent to ${sendTo}!` : "Report queued (configure Resend API key to send live emails).");
    } else { showToast(r?.error || "Send failed."); }
    setSending(false);
  }

  function handleCopyLink() {
    if (!activeReport) return;
    const url = `${window.location.origin}/report/${activeReport.public_token}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const card:   React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 2px 8px rgba(10,20,50,.06)" };
  const input:  React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", boxSizing: "border-box" };
  const lbl:    React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 5 };
  const btnPri: React.CSSProperties = { padding: "10px 22px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" };

  const rd = activeReport?.report_data || {};
  const overallScore = (rd.recommendations as ReportSection)?.overall_score || 0;
  const overallGrade = (rd.recommendations as ReportSection)?.overall_grade || "—";

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "#0A1628", color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Manage › Reports</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>📋 InstaReports</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>Generate a personalised AI-powered digital marketing audit for any prospect in seconds. Email it to them as a lead-gen tool — they see their gaps, you provide the solution.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {([
          ["reports", `📋 Reports (${reports.length})`],
          ["new",     "➕ New Report"],
          ...(activeReport ? [["view", `📊 ${activeReport.business_name}`]] : []),
        ] as [string, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as "reports" | "new" | "view")}
            style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#0066FF" : "transparent"}`, color: tab === t ? "#0066FF" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: "pointer", marginBottom: -2 }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Reports list ── */}
      {tab === "reports" && (
        <div>
          {loading ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 60 }}>Loading…</div> :
            reports.length === 0 ? (
              <div style={{ ...card, textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: "3rem", marginBottom: 8 }}>📋</div>
                <div style={{ fontWeight: 700, color: "#0A1628" }}>No reports yet</div>
                <div style={{ color: "#64748B", fontSize: "0.84rem", marginTop: 4 }}>Create your first prospect audit report to start converting cold outreach into warm leads.</div>
                <button onClick={() => setTab("new")} style={{ ...btnPri, marginTop: 16 }}>➕ New Report</button>
              </div>
            ) : reports.map(r => {
              const sc = STATUS_CFG[r.status] || STATUS_CFG.pending;
              const overallGrade = (r.report_data?.recommendations as ReportSection)?.overall_grade;
              return (
                <div key={r.id} style={{ ...card, cursor: "pointer" }} onClick={() => openReport(r)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628" }}>{r.business_name}</div>
                        {overallGrade && (
                          <span style={{ background: `${GRADE_COLOR[overallGrade] || "#94A3B8"}20`, color: GRADE_COLOR[overallGrade] || "#94A3B8", padding: "2px 10px", borderRadius: 99, fontWeight: 800, fontSize: "0.82rem" }}>
                            Grade: {overallGrade}
                          </span>
                        )}
                      </div>
                      <div style={{ color: "#64748B", fontSize: "0.75rem", marginTop: 2 }}>
                        {r.contact_name && `${r.contact_name} · `}{r.email || "no email"} · {r.website_url || "no website"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ background: sc.bg, color: sc.color, padding: "3px 10px", borderRadius: 99, fontSize: "0.68rem", fontWeight: 700 }}>{sc.label}</span>
                      {r.viewed_at && <span style={{ fontSize: "0.68rem", color: "#059669" }}>👁 Viewed</span>}
                      {r.send_count > 0 && <span style={{ fontSize: "0.68rem", color: "#7C3AED" }}>✉️ Sent</span>}
                    </div>
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {r.sections_enabled?.map(s => {
                      const sec = sections.find(x => x.id === s);
                      return <span key={s} style={{ background: "#F1F5F9", color: "#64748B", padding: "2px 8px", borderRadius: 99, fontSize: "0.65rem" }}>{sec?.icon} {sec?.label}</span>;
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* ── New report wizard ── */}
      {tab === "new" && (
        <div style={{ maxWidth: 680 }}>
          {/* Step indicator */}
          <div style={{ display: "flex", gap: 0, marginBottom: 24 }}>
            {[["1","Data Source"],["2","Sections"],["3","Generate"]].map(([n, lbl], i) => (
              <div key={n} style={{ flex: 1, display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: step > i + 1 ? "#059669" : step === i + 1 ? "#0066FF" : "#E2E8F0", color: step >= i + 1 ? "#fff" : "#94A3B8", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.82rem" }}>
                    {step > i + 1 ? "✓" : n}
                  </div>
                  <span style={{ fontSize: "0.75rem", fontWeight: 600, color: step === i + 1 ? "#0066FF" : "#94A3B8" }}>{lbl}</span>
                </div>
                {i < 2 && <div style={{ flex: 1, height: 2, background: step > i + 1 ? "#059669" : "#E2E8F0", margin: "0 8px" }} />}
              </div>
            ))}
          </div>

          {/* Step 1: Data source */}
          {step === 1 && (
            <div style={card}>
              <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>Select Prospect</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                {(["manual", "csv"] as const).map(src => (
                  <div key={src} onClick={() => setDataSource(src)} style={{ border: `2px solid ${dataSource === src ? "#0066FF" : "#E2E8F0"}`, borderRadius: 10, padding: "14px", cursor: "pointer", background: dataSource === src ? "#EFF6FF" : "#fff", textAlign: "center" }}>
                    <div style={{ fontSize: "2rem" }}>{src === "manual" ? "✏️" : "📄"}</div>
                    <div style={{ fontWeight: 700, color: "#0A1628", marginTop: 6 }}>{src === "manual" ? "Manual Entry" : "CSV / Bulk Import"}</div>
                    <div style={{ color: "#64748B", fontSize: "0.72rem" }}>{src === "manual" ? "Enter one prospect" : "Import many prospects at once"}</div>
                  </div>
                ))}
              </div>

              {dataSource === "manual" && (
                <div>
                  {/* Select existing or create new */}
                  {prospects.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={lbl}>Or pick an existing prospect</label>
                      <select style={input} value={selectedProspect?.id || ""} onChange={e => {
                        const p = prospects.find(x => x.id === +e.target.value);
                        setSelectedProspect(p || null);
                        if (p) setProspectForm({ business_name: p.business_name, contact_name: p.contact_name || "", email: p.email || "", website_url: p.website_url || "", industry: p.industry || "", location: p.location || "" });
                      }}>
                        <option value="">— Enter new prospect —</option>
                        {prospects.map(p => <option key={p.id} value={p.id}>{p.business_name} {p.email ? `(${p.email})` : ""}</option>)}
                      </select>
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div><label style={lbl}>Business Name *</label><input style={input} placeholder="Acme Corp" value={prospectForm.business_name} onChange={e => setProspectForm(f => ({ ...f, business_name: e.target.value }))} /></div>
                    <div><label style={lbl}>Contact Name</label><input style={input} placeholder="John Smith" value={prospectForm.contact_name} onChange={e => setProspectForm(f => ({ ...f, contact_name: e.target.value }))} /></div>
                    <div><label style={lbl}>Email</label><input style={input} placeholder="john@acme.com" value={prospectForm.email} onChange={e => setProspectForm(f => ({ ...f, email: e.target.value }))} /></div>
                    <div><label style={lbl}>Website URL</label><input style={input} placeholder="https://acme.com" value={prospectForm.website_url} onChange={e => setProspectForm(f => ({ ...f, website_url: e.target.value }))} /></div>
                    <div><label style={lbl}>Industry</label><input style={input} placeholder="B2B SaaS" value={prospectForm.industry} onChange={e => setProspectForm(f => ({ ...f, industry: e.target.value }))} /></div>
                    <div><label style={lbl}>Location</label><input style={input} placeholder="London, UK" value={prospectForm.location} onChange={e => setProspectForm(f => ({ ...f, location: e.target.value }))} /></div>
                  </div>
                </div>
              )}

              {dataSource === "csv" && (
                <div>
                  <label style={lbl}>Bulk Import (CSV) — Business Name, Contact, Email, Website, Industry, Location</label>
                  <textarea style={{ ...input, minHeight: 100, resize: "vertical", fontFamily: "monospace", fontSize: "0.78rem" }} placeholder={"Acme Corp, John Smith, john@acme.com, https://acme.com, SaaS, London\nWidget Co, Jane Doe, jane@widget.co, https://widget.co, E-commerce, New York"} value={bulkText} onChange={e => setBulkText(e.target.value)} />
                  <button onClick={handleBulkImport} style={{ ...btnPri, marginTop: 8, padding: "8px 16px", fontSize: "0.78rem" }}>Import Prospects</button>
                  {prospects.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <label style={lbl}>Select prospect to generate report for</label>
                      <select style={input} value={selectedProspect?.id || ""} onChange={e => setSelectedProspect(prospects.find(x => x.id === +e.target.value) || null)}>
                        <option value="">— Select —</option>
                        {prospects.map(p => <option key={p.id} value={p.id}>{p.business_name} {p.email ? `(${p.email})` : ""}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <button onClick={() => setStep(2)} style={{ ...btnPri, marginTop: 16, width: "100%" }}>Next: Select Sections →</button>
            </div>
          )}

          {/* Step 2: Sections */}
          {step === 2 && (
            <div style={card}>
              <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>Choose Report Sections</div>
              <div style={{ display: "grid", gap: 8 }}>
                {sections.map(s => {
                  const on = enabledSections.includes(s.id);
                  return (
                    <div key={s.id} onClick={() => setEnabledSections(prev => on ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", border: `2px solid ${on ? "#0066FF" : "#E2E8F0"}`, borderRadius: 9, cursor: "pointer", background: on ? "#EFF6FF" : "#fff" }}>
                      <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${on ? "#0066FF" : "#CBD5E1"}`, background: on ? "#0066FF" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {on && <span style={{ color: "#fff", fontSize: "0.65rem", fontWeight: 900 }}>✓</span>}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.85rem" }}>{s.icon} {s.label}</div>
                        <div style={{ color: "#64748B", fontSize: "0.72rem" }}>{s.description}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
                <button onClick={() => setStep(1)} style={{ padding: "10px", background: "#F1F5F9", border: "none", borderRadius: 9, color: "#374151", fontWeight: 700, cursor: "pointer" }}>← Back</button>
                <button onClick={() => setStep(3)} disabled={enabledSections.length === 0} style={{ ...btnPri, padding: "10px", opacity: enabledSections.length === 0 ? 0.5 : 1 }}>Next: Generate →</button>
              </div>
            </div>
          )}

          {/* Step 3: Generate */}
          {step === 3 && (
            <div style={card}>
              <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 10 }}>Ready to Generate</div>
              <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9, padding: "14px", marginBottom: 14 }}>
                <div style={{ fontWeight: 700, color: "#374151", marginBottom: 6 }}>Summary</div>
                <div style={{ fontSize: "0.82rem", color: "#374151" }}>
                  <div>📋 Prospect: <strong>{selectedProspect?.business_name || prospectForm.business_name || "—"}</strong></div>
                  {(selectedProspect?.website_url || prospectForm.website_url) && <div>🌐 Website: {selectedProspect?.website_url || prospectForm.website_url}</div>}
                  <div style={{ marginTop: 6 }}>📊 Sections: {enabledSections.map(s => sections.find(x => x.id === s)?.label).filter(Boolean).join(", ")}</div>
                </div>
              </div>
              {generating && (
                <div style={{ background: "#EFF6FF", borderRadius: 9, padding: "14px", marginBottom: 14, textAlign: "center" }}>
                  <div style={{ color: "#2563EB", fontWeight: 700 }}>⚙️ Generating report…</div>
                  <div style={{ color: "#64748B", fontSize: "0.75rem", marginTop: 4 }}>AI is analysing {selectedProspect?.business_name || prospectForm.business_name}. This takes ~15–30 seconds.</div>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button onClick={() => setStep(2)} style={{ padding: "10px", background: "#F1F5F9", border: "none", borderRadius: 9, color: "#374151", fontWeight: 700, cursor: "pointer" }}>← Back</button>
                <button onClick={handleCreateReport} disabled={saving || generating} style={{ ...btnPri, padding: "10px", opacity: saving || generating ? 0.7 : 1 }}>
                  {saving || generating ? "Generating…" : "🚀 Generate Report"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Report viewer ── */}
      {tab === "view" && activeReport && (
        <div>
          {activeReport.status !== "ready" ? (
            <div style={{ ...card, textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>⚙️</div>
              <div style={{ fontWeight: 700, color: "#0A1628" }}>Report {activeReport.status}</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20 }}>
              {/* Main report */}
              <div>
                {/* Report header */}
                <div style={{ ...card, background: "linear-gradient(135deg,#0A1628,#1E3A5F)", color: "#fff", padding: "28px 32px" }}>
                  <div style={{ fontSize: "0.7rem", color: "#93C5FD", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 8 }}>Digital Marketing Audit</div>
                  <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 900, fontSize: "1.6rem", marginBottom: 4 }}>{activeReport.business_name}</div>
                  {activeReport.website_url && <div style={{ color: "#93C5FD", fontSize: "0.82rem" }}>{activeReport.website_url}</div>}
                  <div style={{ display: "flex", gap: 20, marginTop: 20 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 900, fontSize: "2.5rem", color: GRADE_COLOR[overallGrade] || "#fff" }}>{overallGrade}</div>
                      <div style={{ fontSize: "0.65rem", color: "#93C5FD" }}>Overall Grade</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 900, fontSize: "2.5rem", color: "#fff" }}>{overallScore}/100</div>
                      <div style={{ fontSize: "0.65rem", color: "#93C5FD" }}>Score</div>
                    </div>
                    {(rd.recommendations as ReportSection)?.estimated_opportunity && (
                      <div style={{ flex: 1, background: "rgba(255,255,255,.1)", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: "0.65rem", color: "#93C5FD" }}>Estimated Opportunity</div>
                          <div style={{ fontWeight: 700, color: "#34D399", fontSize: "0.88rem", marginTop: 2 }}>{(rd.recommendations as ReportSection).estimated_opportunity}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section sub-tabs */}
                <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 16, flexWrap: "wrap" }}>
                  {["overview", ...activeReport.sections_enabled].map(t => (
                    <button key={t} onClick={() => setReportTab(t)} style={{ padding: "8px 14px", background: "transparent", border: "none", borderBottom: `3px solid ${reportTab === t ? "#0066FF" : "transparent"}`, color: reportTab === t ? "#0066FF" : "#64748B", fontWeight: reportTab === t ? 700 : 500, fontSize: "0.78rem", cursor: "pointer", marginBottom: -2, textTransform: "capitalize" }}>
                      {t === "overview" ? "📊 Overview" : `${sections.find(s => s.id === t)?.icon} ${sections.find(s => s.id === t)?.label || t}`}
                    </button>
                  ))}
                </div>

                {/* Overview: executive summary + quick wins */}
                {reportTab === "overview" && (
                  <div>
                    {(rd.recommendations as ReportSection)?.executive_summary && (
                      <div style={card}>
                        <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 8 }}>Executive Summary</div>
                        <p style={{ color: "#374151", fontSize: "0.88rem", lineHeight: 1.7, margin: 0 }}>{(rd.recommendations as ReportSection).executive_summary}</p>
                      </div>
                    )}
                    {(rd.recommendations as ReportSection)?.quick_wins?.length ? (
                      <div style={card}>
                        <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>⚡ Quick Wins</div>
                        {(rd.recommendations as ReportSection).quick_wins!.map((w, i) => (
                          <div key={i} style={{ display: "flex", gap: 12, marginBottom: 10, padding: "10px", background: "#F8FAFC", borderRadius: 9, borderLeft: "3px solid #0066FF" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.84rem" }}>{w.action}</div>
                              <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 2 }}>{w.timeline}</div>
                            </div>
                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                              {[["Impact", w.impact], ["Effort", w.effort]].map(([k, v]) => (
                                <span key={k} style={{ background: v === "high" ? (k === "Impact" ? "#ECFDF5" : "#FEF2F2") : "#FFF7ED", color: v === "high" ? (k === "Impact" ? "#065F46" : "#7F1D1D") : "#92400E", padding: "2px 7px", borderRadius: 99, fontSize: "0.62rem", fontWeight: 700 }}>
                                  {k}: {v}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {/* Section score cards */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                      {activeReport.sections_enabled.filter(s => s !== "recommendations").map(s => {
                        const sec = rd[s] as ReportSection;
                        if (!sec) return null;
                        const info = sections.find(x => x.id === s);
                        return (
                          <div key={s} style={{ ...card, marginBottom: 0, textAlign: "center", cursor: "pointer" }} onClick={() => setReportTab(s)}>
                            <div style={{ fontSize: "1.5rem" }}>{info?.icon}</div>
                            <div style={{ fontWeight: 700, color: "#374151", fontSize: "0.78rem", margin: "4px 0" }}>{info?.label}</div>
                            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 900, fontSize: "1.6rem", color: GRADE_COLOR[sec.grade || ""] || "#94A3B8" }}>{sec.grade || "—"}</div>
                            <div style={{ fontSize: "0.68rem", color: "#94A3B8" }}>score: {sec.score ?? "—"}/100</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Individual section */}
                {reportTab !== "overview" && rd[reportTab] && (
                  <div style={card}>
                    {(() => {
                      const sec = rd[reportTab] as ReportSection;
                      const info = sections.find(s => s.id === reportTab);
                      return (
                        <>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "1rem" }}>{info?.icon} {info?.label}</div>
                            {sec.grade && (
                              <div style={{ textAlign: "center" }}>
                                <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 900, fontSize: "2rem", color: GRADE_COLOR[sec.grade] || "#94A3B8" }}>{sec.grade}</div>
                                <div style={{ fontSize: "0.65rem", color: "#94A3B8" }}>{sec.score ?? "—"}/100</div>
                              </div>
                            )}
                          </div>
                          {sec.headline && <p style={{ color: "#374151", fontSize: "0.88rem", marginBottom: 14, lineHeight: 1.6 }}>{sec.headline}</p>}
                          {[
                            ["Findings", sec.findings, "#2563EB", "#EFF6FF"],
                            ["Issues", sec.issues, "#DC2626", "#FEF2F2"],
                            ["Quick Fixes", sec.quick_fixes, "#059669", "#ECFDF5"],
                            ["Gaps", sec.gaps, "#D97706", "#FFF7ED"],
                            ["Opportunities", sec.opportunities, "#7C3AED", "#F5F3FF"],
                            ["Platforms Detected", sec.platforms_detected, "#0A66C2", "#EFF6FF"],
                            ["Strategic Priorities", sec.strategic_priorities, "#0A1628", "#F8FAFC"],
                          ].filter(([, arr]) => Array.isArray(arr) && (arr as string[]).length > 0).map(([title, items, color, bg]) => (
                            <div key={title as string} style={{ marginBottom: 12 }}>
                              <div style={{ fontWeight: 700, color: color as string, fontSize: "0.75rem", marginBottom: 6 }}>{title as string}</div>
                              {(items as string[]).map((item, i) => (
                                <div key={i} style={{ background: bg as string, borderRadius: 7, padding: "7px 10px", fontSize: "0.78rem", color: "#374151", marginBottom: 4 }}>
                                  • {item}
                                </div>
                              ))}
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Sidebar: send + share */}
              <div>
                <div style={card}>
                  <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>✉️ Send to Prospect</div>
                  <label style={lbl}>Recipient Email</label>
                  <input style={{ ...input, marginBottom: 10 }} type="email" placeholder="prospect@company.com" value={sendTo} onChange={e => setSendTo(e.target.value)} />
                  <button onClick={handleSend} disabled={sending} style={{ ...btnPri, width: "100%", opacity: sending ? 0.7 : 1, marginBottom: 10 }}>
                    {sending ? "Sending…" : "📧 Send Report"}
                  </button>
                  <button onClick={handleCopyLink} style={{ width: "100%", padding: "9px", background: "#F1F5F9", border: "none", borderRadius: 8, color: "#374151", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>
                    {copied ? "✅ Copied!" : "🔗 Copy Report Link"}
                  </button>
                </div>

                <div style={{ ...card, background: "#F5F3FF", border: "1px solid #DDD6FE" }}>
                  <div style={{ fontWeight: 800, color: "#7C3AED", fontSize: "0.82rem", marginBottom: 8 }}>💡 How to use this</div>
                  {["Email the report to the prospect before your first call", "Reference the Quick Wins on the call — they already know the problems", "Offer to fix the top 3 issues as your service pitch", "Track when they open the report (viewed_at timestamp)", "Follow up 2 days after sending if unopened"].map((tip, i) => (
                    <div key={i} style={{ fontSize: "0.75rem", color: "#7C3AED", marginBottom: 4 }}>• {tip}</div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

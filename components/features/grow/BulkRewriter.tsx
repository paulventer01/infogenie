"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiDelete, type ApiResult } from "@/lib/api";

interface Job {
  id: number;
  name: string;
  tone: string;
  intensity: string;
  target_keywords: string;
  seo_focus: boolean;
  status: string;
  total_items: number;
  processed_items: number;
  failed_items: number;
  created_at: string;
}

interface Item {
  id: number;
  title: string | null;
  original_text: string;
  rewritten_text: string | null;
  word_count_orig: number;
  word_count_new: number;
  seo_score_new: number | null;
  changes_summary: string | null;
  status: string;
  error_message: string | null;
}

interface Tone { id: string; label: string; }
interface Intensity { id: string; label: string; }

interface ConfigResponse extends ApiResult {
  tones?: Tone[];
  intensities?: Intensity[];
}

interface JobsResponse extends ApiResult { jobs?: Job[]; }
interface JobResponse extends ApiResult { job: Job; items: Item[]; }
interface CreateJobResponse extends ApiResult { job: Job; }
interface ProcessJobResponse extends ApiResult { processing: number; }

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: "⏳ Pending",    color: "#64748B", bg: "#F1F5F9" },
  processing: { label: "⚙️ Processing", color: "#D97706", bg: "#FFF7ED" },
  done:       { label: "✅ Done",       color: "#059669", bg: "#ECFDF5" },
  failed:     { label: "❌ Failed",     color: "#DC2626", bg: "#FEF2F2" },
};

const ITEM_STATUS_CFG: Record<string, { label: string; color: string }> = {
  pending:  { label: "Queued",     color: "#94A3B8" },
  done:     { label: "✅ Done",    color: "#059669" },
  failed:   { label: "❌ Failed",  color: "#DC2626" },
};

export default function BulkRewriter() {
  const [jobs, setJobs]             = useState<Job[]>([]);
  const [tones, setTones]           = useState<Tone[]>([]);
  const [intensities, setIntensities] = useState<Intensity[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<"jobs" | "new" | "detail">("jobs");
  const [active, setActive]         = useState<{ job: Job; items: Item[] } | null>(null);
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState("");
  const [pollTimer, setPollTimer]   = useState<ReturnType<typeof setTimeout> | null>(null);

  const [form, setForm] = useState({
    name: "", tone: "professional", intensity: "moderate", target_keywords: "", seo_focus: true,
  });
  const [articles, setArticles] = useState([
    { title: "", text: "" },
    { title: "", text: "" },
  ]);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    const [cfg, r] = await Promise.all([
      apiGet<ConfigResponse>("/api/bulk-rewriter/config"),
      apiGet<JobsResponse>("/api/bulk-rewriter/jobs"),
    ]);
    if (cfg?.tones) setTones(cfg.tones);
    if (cfg?.intensities) setIntensities(cfg.intensities);
    if (r?.jobs) setJobs(r.jobs);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (pollTimer) clearTimeout(pollTimer); }, [pollTimer]);

  async function openJob(id: number) {
    const r = await apiGet<JobResponse>(`/api/bulk-rewriter/jobs/${id}`);
    if (r?.ok) {
      setActive({ job: r.job, items: r.items });
      setTab("detail");
      if (r.job.status === "processing") startPolling(id);
    }
  }

  function startPolling(id: number) {
    const t = setTimeout(async () => {
      const r = await apiGet<JobResponse>(`/api/bulk-rewriter/jobs/${id}`);
      if (r?.ok) {
        setActive({ job: r.job, items: r.items });
        setJobs(prev => prev.map(j => j.id === id ? r.job : j));
        if (r.job.status === "processing") startPolling(id);
      }
    }, 3000);
    setPollTimer(t);
  }

  async function handleCreate() {
    const validArticles = articles.filter(a => a.text.trim().length > 30);
    if (!validArticles.length) { showToast("Add at least one article (30+ chars)."); return; }
    if (!form.name) { showToast("Give this job a name."); return; }
    setSaving(true);
    const r = await apiPost<CreateJobResponse>("/api/bulk-rewriter/jobs", {
      ...form, items: validArticles.map(a => ({ title: a.title, text: a.text })),
    });
    if (r?.ok) {
      showToast("✅ Job created! Starting AI rewriting…");
      setJobs(prev => [r.job, ...prev]);
      // Auto-start processing
      const pr = await apiPost<ProcessJobResponse>(`/api/bulk-rewriter/jobs/${r.job.id}/process`, {});
      if (pr?.ok) {
        openJob(r.job.id);
        setForm({ name: "", tone: "professional", intensity: "moderate", target_keywords: "", seo_focus: true });
        setArticles([{ title: "", text: "" }, { title: "", text: "" }]);
      }
    } else { showToast("Error creating job."); }
    setSaving(false);
  }

  async function handleProcess(id: number) {
    setProcessing(true);
    const r = await apiPost<ProcessJobResponse>(`/api/bulk-rewriter/jobs/${id}/process`, {});
    if (r?.ok) { showToast(`Processing ${r.processing} article(s)…`); startPolling(id); }
    else showToast("Process failed — ensure OpenAI key is configured.");
    setProcessing(false);
  }

  async function handleDelete(id: number) {
    await apiDelete(`/api/bulk-rewriter/jobs/${id}`);
    setJobs(prev => prev.filter(j => j.id !== id));
    if (active?.job.id === id) { setActive(null); setTab("jobs"); }
    showToast("Job deleted.");
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    showToast("📋 Copied to clipboard!");
  }

  const card:   React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 2px 8px rgba(10,20,50,.06)" };
  const input:  React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", boxSizing: "border-box" };
  const lbl:    React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 5 };
  const btnPri: React.CSSProperties = { padding: "10px 22px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" };

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "#0A1628", color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Grow › SEO & Content</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>✍️ Bulk Content Rewriter</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>Paste up to 20 articles at once. AI rewrites them in your chosen tone and intensity — improving SEO, readability, and flow in a single batch.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {([
          ["jobs",   `📋 Jobs (${jobs.length})`],
          ["new",    "➕ New Batch"],
          ...(active ? [["detail", `⚙️ ${active.job.name}`]] : []),
        ] as [string, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as "jobs" | "new" | "detail")}
            style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#0066FF" : "transparent"}`, color: tab === t ? "#0066FF" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: "pointer", marginBottom: -2 }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Jobs list ── */}
      {tab === "jobs" && (
        <div>
          {loading ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 60 }}>Loading…</div> :
            jobs.length === 0 ? (
              <div style={{ ...card, textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: "3rem", marginBottom: 8 }}>✍️</div>
                <div style={{ fontWeight: 700, color: "#0A1628" }}>No rewrite jobs yet</div>
                <div style={{ color: "#64748B", fontSize: "0.84rem", marginTop: 4 }}>Create a batch to rewrite up to 20 articles at once with AI.</div>
                <button onClick={() => setTab("new")} style={{ ...btnPri, marginTop: 16 }}>➕ New Batch</button>
              </div>
            ) : jobs.map(job => {
              const sc = STATUS_CFG[job.status] || STATUS_CFG.pending;
              const progress = job.total_items > 0 ? Math.round((job.processed_items / job.total_items) * 100) : 0;
              return (
                <div key={job.id} style={{ ...card, cursor: "pointer" }} onClick={() => openJob(job.id)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628" }}>{job.name}</div>
                      <div style={{ color: "#64748B", fontSize: "0.75rem", marginTop: 2 }}>
                        {job.tone} · {job.intensity} · {job.total_items} article{job.total_items !== 1 ? "s" : ""} · {new Date(job.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ background: sc.bg, color: sc.color, padding: "3px 10px", borderRadius: 99, fontSize: "0.68rem", fontWeight: 700 }}>{sc.label}</span>
                      <button onClick={e => { e.stopPropagation(); handleDelete(job.id); }} style={{ background: "transparent", border: "none", color: "#DC2626", cursor: "pointer", fontSize: "0.85rem" }}>🗑</button>
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#64748B", marginBottom: 4 }}>
                      <span>{job.processed_items}/{job.total_items} processed</span>
                      {job.failed_items > 0 && <span style={{ color: "#DC2626" }}>{job.failed_items} failed</span>}
                      <span>{progress}%</span>
                    </div>
                    <div style={{ height: 6, background: "#E2E8F0", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${progress}%`, background: job.status === "failed" ? "#FCA5A5" : "linear-gradient(90deg,#0066FF,#00C9C8)", borderRadius: 99, transition: "width 0.6s" }} />
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* ── New batch ── */}
      {tab === "new" && (
        <div style={{ maxWidth: 780 }}>
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>Batch Settings</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div><label style={lbl}>Job Name *</label><input style={input} placeholder="Q3 Blog Refresh" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><label style={lbl}>Target Keywords (optional)</label><input style={input} placeholder="digital marketing, AI tools, …" value={form.target_keywords} onChange={e => setForm(f => ({ ...f, target_keywords: e.target.value }))} /></div>
              <div>
                <label style={lbl}>Tone</label>
                <select style={input} value={form.tone} onChange={e => setForm(f => ({ ...f, tone: e.target.value }))}>
                  {tones.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Rewrite Intensity</label>
                <select style={input} value={form.intensity} onChange={e => setForm(f => ({ ...f, intensity: e.target.value }))}>
                  {intensities.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", color: "#374151", cursor: "pointer" }}>
              <input type="checkbox" checked={form.seo_focus} onChange={e => setForm(f => ({ ...f, seo_focus: e.target.checked }))} />
              🔍 SEO focus — improve headings, keyword density, and meta-description opening
            </label>
          </div>

          <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>Articles ({articles.filter(a => a.text.trim().length > 30).length}/{articles.length} ready)</div>

          {articles.map((a, i) => (
            <div key={i} style={{ ...card, padding: "16px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.85rem" }}>Article {i + 1}</div>
                <button onClick={() => setArticles(prev => prev.filter((_, idx) => idx !== i))} style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer", fontSize: "0.85rem" }}>✕</button>
              </div>
              <input style={{ ...input, marginBottom: 8 }} placeholder="Title (optional)" value={a.title} onChange={e => setArticles(prev => prev.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x))} />
              <textarea style={{ ...input, minHeight: 120, resize: "vertical", fontFamily: "inherit" }} placeholder="Paste your article content here (minimum 30 characters)…" value={a.text} onChange={e => setArticles(prev => prev.map((x, idx) => idx === i ? { ...x, text: e.target.value } : x))} />
              <div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 2 }}>{a.text.split(/\s+/).filter(Boolean).length} words</div>
            </div>
          ))}

          {articles.length < 20 && (
            <button onClick={() => setArticles(prev => [...prev, { title: "", text: "" }])} style={{ padding: "8px 16px", background: "#F0FDF4", border: "1px dashed #6EE7B7", borderRadius: 8, color: "#065F46", fontWeight: 600, fontSize: "0.78rem", cursor: "pointer", marginBottom: 16 }}>
              ＋ Add Article {articles.length < 20 ? `(${20 - articles.length} more available)` : ""}
            </button>
          )}

          <button onClick={handleCreate} disabled={saving} style={{ ...btnPri, width: "100%", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Creating…" : `✨ Rewrite ${articles.filter(a => a.text.trim().length > 30).length} Article(s) with AI`}
          </button>
        </div>
      )}

      {/* ── Job detail ── */}
      {tab === "detail" && active && (
        <div>
          {/* Status bar */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628" }}>{active.job.name}</div>
                <div style={{ color: "#64748B", fontSize: "0.75rem" }}>{active.job.tone} · {active.job.intensity} {active.job.seo_focus ? "· SEO focus" : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ background: (STATUS_CFG[active.job.status] || STATUS_CFG.pending).bg, color: (STATUS_CFG[active.job.status] || STATUS_CFG.pending).color, padding: "4px 12px", borderRadius: 99, fontWeight: 700, fontSize: "0.75rem" }}>
                  {(STATUS_CFG[active.job.status] || STATUS_CFG.pending).label}
                </span>
                {active.job.status === "pending" && (
                  <button onClick={() => handleProcess(active.job.id)} disabled={processing} style={{ ...btnPri, padding: "7px 16px", fontSize: "0.78rem", opacity: processing ? 0.7 : 1 }}>
                    {processing ? "Starting…" : "▶️ Start Processing"}
                  </button>
                )}
              </div>
            </div>
            {active.job.status === "processing" && (
              <div style={{ marginTop: 12 }}>
                <div style={{ height: 8, background: "#E2E8F0", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round((active.job.processed_items / Math.max(1, active.job.total_items)) * 100)}%`, background: "linear-gradient(90deg,#0066FF,#00C9C8)", borderRadius: 99, transition: "width 0.6s", animation: "pulse 2s infinite" }} />
                </div>
                <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 4 }}>
                  {active.job.processed_items}/{active.job.total_items} articles processed…
                </div>
              </div>
            )}
          </div>

          {/* Items */}
          {active.items.map(item => {
            const sc = ITEM_STATUS_CFG[item.status] || ITEM_STATUS_CFG.pending;
            const isExpanded = expandedItem === item.id;
            return (
              <div key={item.id} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", cursor: "pointer" }} onClick={() => setExpandedItem(isExpanded ? null : item.id)}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.88rem" }}>{item.title || `Article ${item.id}`}</div>
                    <div style={{ color: "#64748B", fontSize: "0.72rem", marginTop: 2 }}>
                      {item.word_count_orig} words original
                      {item.word_count_new ? ` → ${item.word_count_new} words rewritten` : ""}
                      {item.seo_score_new ? ` · SEO score: ${item.seo_score_new}/100` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ color: sc.color, fontWeight: 700, fontSize: "0.75rem" }}>{sc.label}</span>
                    {item.rewritten_text && (
                      <button onClick={e => { e.stopPropagation(); handleCopy(item.rewritten_text!); }} style={{ padding: "5px 10px", background: "#EFF6FF", border: "none", borderRadius: 7, color: "#2563EB", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer" }}>
                        📋 Copy
                      </button>
                    )}
                    <span style={{ color: "#94A3B8", fontSize: "0.8rem" }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {item.error_message && (
                  <div style={{ marginTop: 8, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, padding: "7px 10px", fontSize: "0.75rem", color: "#7F1D1D" }}>
                    ⚠️ {item.error_message.includes("key") ? "OpenAI key required — configure it in AI Providers." : item.error_message}
                  </div>
                )}

                {item.changes_summary && (
                  <div style={{ marginTop: 8, background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 7, padding: "7px 10px", fontSize: "0.75rem", color: "#065F46" }}>
                    📝 {item.changes_summary}
                  </div>
                )}

                {isExpanded && item.rewritten_text && (
                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "#94A3B8", fontSize: "0.72rem", marginBottom: 6 }}>ORIGINAL</div>
                      <div style={{ background: "#F8FAFC", borderRadius: 8, padding: "12px", fontSize: "0.78rem", color: "#374151", lineHeight: 1.7, maxHeight: 320, overflowY: "auto", whiteSpace: "pre-wrap", border: "1px solid #E2E8F0" }}>
                        {item.original_text}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: "#059669", fontSize: "0.72rem", marginBottom: 6 }}>REWRITTEN ✨</div>
                      <div style={{ background: "#F0FDF4", borderRadius: 8, padding: "12px", fontSize: "0.78rem", color: "#374151", lineHeight: 1.7, maxHeight: 320, overflowY: "auto", whiteSpace: "pre-wrap", border: "1px solid #BBF7D0" }}>
                        {item.rewritten_text}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";
import { useState, useEffect } from "react";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#ef4444", error: "#ef4444",
  high: "#0f766e",
  medium: "#f59e0b", warning: "#f59e0b",
  low: "#10b981", info: "#10b981",
};

const SEVERITY_BG: Record<string, string> = {
  critical: "#fee2e2", error: "#fee2e2",
  high: "#ffedd5",
  medium: "#fffbeb", warning: "#fffbeb",
  low: "#dcfce7", info: "#f0fdf4",
};

function SeverityBadge({ severity }: { severity: string }) {
  const s = severity?.toLowerCase() || "info";
  return (
    <span style={{ background: SEVERITY_BG[s] || "#f1f5f9", color: SEVERITY_COLOR[s] || "#64748b", borderRadius: 6, padding: "2px 8px", fontSize: "0.72rem", fontWeight: 700 }}>
      {severity || "info"}
    </span>
  );
}

export default function ContentKingMonitor() {
  const [tab, setTab] = useState<"websites" | "changes" | "issues" | "pages">("websites");
  const [websites, setWebsites] = useState<any[]>([]);
  const [selectedSite, setSelectedSite] = useState("");
  const [changes, setChanges] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [issuesSummary, setIssuesSummary] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);

  async function apiFetch(path: string) {
    const r = await fetch(`/api/contentking/${path}`, { credentials: "include" });
    return r.json();
  }

  async function run(action: () => Promise<void>) {
    setLoading(true); setError("");
    try { await action(); }
    catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      const s = await apiFetch("status");
      setConfigured(s.configured);
      if (s.configured) {
        run(async () => {
          const d = await apiFetch("websites");
          if (!d.ok) throw new Error(d.error);
          setWebsites(d.websites || []);
          if (d.websites?.length) setSelectedSite(d.websites[0].id);
        });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadChanges() {
    if (!selectedSite) return;
    run(async () => {
      const d = await apiFetch(`changes?website_id=${encodeURIComponent(selectedSite)}&limit=30`);
      if (!d.ok) throw new Error(d.error);
      setChanges(d.changes || []);
    });
  }

  async function loadIssues() {
    if (!selectedSite) return;
    run(async () => {
      const d = await apiFetch(`issues?website_id=${encodeURIComponent(selectedSite)}&limit=30`);
      if (!d.ok) throw new Error(d.error);
      setIssues(d.issues || []);
      setIssuesSummary(d.summary || null);
    });
  }

  async function loadPages() {
    if (!selectedSite) return;
    run(async () => {
      const d = await apiFetch(`pages?website_id=${encodeURIComponent(selectedSite)}&limit=25`);
      if (!d.ok) throw new Error(d.error);
      setPages(d.pages || []);
    });
  }

  function handleTabChange(t: typeof tab) {
    setTab(t);
    if (t === "changes") loadChanges();
    if (t === "issues")  loadIssues();
    if (t === "pages")   loadPages();
  }

  const TABS = [
    { k: "websites" as const, label: "🌐 Monitored Sites" },
    { k: "changes" as const,  label: "🔄 Recent Changes" },
    { k: "issues" as const,   label: "⚠️ SEO Issues" },
    { k: "pages" as const,    label: "📄 Page Health" },
  ];

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb"><span className="bc-group">SEO</span> <span className="bc-sep">›</span> ContentKing</div>
              <h2 className="view-title">👑 ContentKing SEO Monitor</h2>
              <p className="view-sub">Real-time SEO change detection, issue tracking, and page health monitoring. ContentKing detects changes within minutes — far faster than manual audits.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 20, paddingBottom: 56 }}>

        {configured === false && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "18px 22px", marginBottom: 20 }}>
            <div style={{ fontWeight: 700, color: "#78350f", marginBottom: 6 }}>⚙️ ContentKing not configured</div>
            <p style={{ color: "#92400e", fontSize: "0.86rem", margin: 0 }}>
              Add your <code>CONTENTKING_API_KEY</code> via <strong>Manage → Platform APIs</strong> to connect your ContentKing account.
              Get your API key at <a href="https://www.contentkingapp.com" target="_blank" rel="noreferrer" style={{ color: "#b45309" }}>contentkingapp.com</a>.
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #e2e8f0" }}>
          {TABS.map(t => (
            <button key={t.k} onClick={() => handleTabChange(t.k)} style={{
              padding: "8px 14px", border: 0, background: "none", cursor: "pointer",
              fontWeight: tab === t.k ? 700 : 500,
              color: tab === t.k ? "#10b981" : "#64748b",
              borderBottom: tab === t.k ? "2px solid #10b981" : "2px solid transparent",
              marginBottom: -2, fontSize: "0.85rem", whiteSpace: "nowrap",
            }}>{t.label}</button>
          ))}
        </div>

        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", color: "#b91c1c", fontSize: "0.85rem", marginBottom: 14 }}>
            ⚠️ {error}
          </div>
        )}

        {/* Site selector (visible on non-websites tabs) */}
        {tab !== "websites" && websites.length > 0 && (
          <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px" }}>
              <label style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Website</label>
              <select className="form-control" value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
                {websites.map(w => <option key={w.id} value={w.id}>{w.name || w.url}</option>)}
              </select>
            </div>
            <button className="btn btn-outline" disabled={loading}
              onClick={() => { if (tab === "changes") loadChanges(); if (tab === "issues") loadIssues(); if (tab === "pages") loadPages(); }}>
              {loading ? "Loading…" : "🔄 Refresh"}
            </button>
          </div>
        )}

        {/* Monitored Sites */}
        {tab === "websites" && (
          <div>
            {loading && <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading websites…</div>}
            {!loading && websites.length === 0 && configured !== false && (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>
                No websites configured in ContentKing yet. Add sites at <a href="https://www.contentkingapp.com" target="_blank" rel="noreferrer">contentkingapp.com</a>.
              </div>
            )}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {websites.map(w => (
                <div key={w.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px", flex: "1 1 260px", cursor: "pointer" }}
                  onClick={() => { setSelectedSite(w.id); handleTabChange("issues"); }}>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 4 }}>
                    <a href={w.url} target="_blank" rel="noreferrer" style={{ color: "#10b981", textDecoration: "none" }}>{w.name || w.url}</a>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "#94a3b8", marginBottom: 10 }}>{w.url}</div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>{w.pageCount?.toLocaleString() ?? "—"}</div>
                      <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>Pages</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontWeight: 800, fontSize: "1.1rem", color: (w.issueCount||0) > 0 ? "#ef4444" : "#10b981" }}>{w.issueCount?.toLocaleString() ?? "—"}</div>
                      <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>Issues</div>
                    </div>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                      <span style={{ background: w.status === "active" ? "#dcfce7" : "#f1f5f9", color: w.status === "active" ? "#15803d" : "#64748b", borderRadius: 6, padding: "2px 8px", fontSize: "0.72rem", fontWeight: 700 }}>
                        {w.status || "unknown"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Changes */}
        {tab === "changes" && (
          <div>
            {loading && <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading changes…</div>}
            {!loading && changes.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>No recent changes detected.</div>}
            {changes.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
                {changes.map((c, i) => (
                  <div key={i} style={{ padding: "12px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <SeverityBadge severity={c.severity} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 2 }}>{c.type || "Change"} — <span style={{ color: "#64748b", fontWeight: 400 }}>{c.field}</span></div>
                      <div style={{ fontSize: "0.78rem", color: "#0ea5e9", marginBottom: 4, wordBreak: "break-all" }}>
                        <a href={c.url} target="_blank" rel="noreferrer" style={{ color: "#0ea5e9", textDecoration: "none" }}>{c.url}</a>
                      </div>
                      {(c.oldValue || c.newValue) && (
                        <div style={{ display: "flex", gap: 8, fontSize: "0.76rem", flexWrap: "wrap" }}>
                          {c.oldValue && <span style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 4, padding: "1px 6px", fontFamily: "monospace" }}>— {String(c.oldValue).slice(0, 100)}</span>}
                          {c.newValue && <span style={{ background: "#dcfce7", color: "#15803d", borderRadius: 4, padding: "1px 6px", fontFamily: "monospace" }}>+ {String(c.newValue).slice(0, 100)}</span>}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#94a3b8", whiteSpace: "nowrap" }}>{c.detectedAt ? c.detectedAt.slice(0, 16).replace("T", " ") : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SEO Issues */}
        {tab === "issues" && (
          <div>
            {issuesSummary && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                {[
                  { label: "Critical", value: issuesSummary.critical, bg: "#fee2e2", color: "#b91c1c" },
                  { label: "High",     value: issuesSummary.high,     bg: "#ffedd5", color: "#0b5f59" },
                  { label: "Medium",   value: issuesSummary.medium,   bg: "#fffbeb", color: "#78350f" },
                  { label: "Low",      value: issuesSummary.low,      bg: "#f0fdf4", color: "#15803d" },
                ].map(s => (
                  <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: "12px 18px", flex: "1 1 100px", textAlign: "center" }}>
                    <div style={{ fontSize: "1.5rem", fontWeight: 800, color: s.color }}>{s.value || 0}</div>
                    <div style={{ fontSize: "0.72rem", color: s.color, fontWeight: 600 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}
            {loading && <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading issues…</div>}
            {!loading && issues.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>No open issues. 🎉</div>}
            {issues.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
                {issues.map((issue, i) => (
                  <div key={i} style={{ padding: "12px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <SeverityBadge severity={issue.severity} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 2 }}>{issue.type}</div>
                      {issue.description && <div style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: 4 }}>{issue.description}</div>}
                      {issue.url && (
                        <div style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>
                          <a href={issue.url} target="_blank" rel="noreferrer" style={{ color: "#0ea5e9", textDecoration: "none" }}>{issue.url}</a>
                        </div>
                      )}
                    </div>
                    {issue.pagesCount !== null && (
                      <div style={{ textAlign: "center", flexShrink: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>{issue.pagesCount}</div>
                        <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>pages affected</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Page Health */}
        {tab === "pages" && (
          <div>
            {loading && <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading pages…</div>}
            {!loading && pages.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: "0.88rem" }}>No page data available.</div>}
            {pages.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["URL", "Title", "Status", "Issues", "Indexable"].map(h => (
                        <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map((p, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <a href={p.url} target="_blank" rel="noreferrer" style={{ color: "#10b981", textDecoration: "none", fontSize: "0.76rem" }}>{p.url.replace(/^https?:\/\/[^/]+/, "")}</a>
                        </td>
                        <td style={{ padding: "8px 12px", color: "#475569", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title || "—"}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <span style={{ background: p.statusCode === 200 ? "#dcfce7" : "#fee2e2", color: p.statusCode === 200 ? "#15803d" : "#b91c1c", borderRadius: 6, padding: "2px 7px", fontSize: "0.72rem", fontWeight: 700 }}>
                            {p.statusCode ?? "—"}
                          </span>
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          {p.issueCount > 0
                            ? <span style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 6, padding: "2px 7px", fontWeight: 700, fontSize: "0.76rem" }}>{p.issueCount}</span>
                            : <span style={{ color: "#10b981", fontWeight: 700 }}>✓</span>}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <span style={{ color: p.isIndexable ? "#10b981" : "#ef4444", fontWeight: 700 }}>{p.isIndexable ? "Yes" : "No"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

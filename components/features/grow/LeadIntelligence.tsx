"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";

interface Stats {
  leads30d?: Record<string, number>;
  openReviews?: number;
  searchTerms?: number;
  searchSpend?: number;
  negativeSuggestions?: number;
}

interface Lead {
  id: number;
  channel: string;
  contact_email?: string;
  contact_phone?: string;
  contact_name?: string;
  platform?: string;
  utm_campaign?: string;
  tier?: string;
  score?: number;
  reasoning?: string;
  created_at: string;
}

interface ReviewItem {
  id: number;
  item_type: string;
  title: string;
  summary?: string;
  priority: string;
  status: string;
  created_at: string;
}

interface SearchTerm {
  id: number;
  search_term: string;
  campaign_name?: string;
  cost: number;
  clicks: number;
  conversions: number;
}

interface NegativeKw {
  id: number;
  keyword: string;
  reason?: string;
  estimated_waste?: number;
  status: string;
}

interface TransparencyReport {
  narrative?: string;
  leadQuality?: { total: number; byTier: Record<string, number> };
  optimizerChanges?: { action_type: string; campaign_name?: string; reason?: string; created_at: string }[];
  negativeKeywordSuggestions?: NegativeKw[];
}

type Tab = "leads" | "review" | "search" | "report";

const tierStyle: Record<string, { bg: string; color: string; label: string }> = {
  sales_opportunity: { bg: "#D1FAE5", color: "#065F46", label: "Sales opportunity" },
  qualified: { bg: "#DBEAFE", color: "#1E40AF", label: "Qualified" },
  junk: { bg: "#FEE2E2", color: "#991B1B", label: "Junk" },
};

export default function LeadIntelligence() {
  const [tab, setTab] = useState<Tab>("leads");
  const [stats, setStats] = useState<Stats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [terms, setTerms] = useState<SearchTerm[]>([]);
  const [negatives, setNegatives] = useState<NegativeKw[]>([]);
  const [report, setReport] = useState<TransparencyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const [st, ld, rv, tr, ng, rp] = await Promise.all([
      apiGet<{ ok?: boolean } & Stats>("/api/lead-intelligence/stats"),
      apiGet<{ ok?: boolean; leads?: Lead[] }>("/api/lead-intelligence/leads?limit=50"),
      apiGet<{ ok?: boolean; items?: ReviewItem[] }>("/api/lead-intelligence/review-queue"),
      apiGet<{ ok?: boolean; terms?: SearchTerm[] }>("/api/lead-intelligence/search-terms"),
      apiGet<{ ok?: boolean; items?: NegativeKw[] }>("/api/lead-intelligence/negative-keywords"),
      apiGet<{ ok?: boolean } & TransparencyReport>("/api/lead-intelligence/transparency-report?days=7"),
    ]);
    if (st.ok) setStats(st);
    setLeads(ld.leads || []);
    setReviews(rv.items || []);
    setTerms(tr.terms || []);
    setNegatives(ng.items || []);
    if (rp.ok) setReport(rp);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const syncTerms = async () => {
    setBusy("sync");
    const r = await apiPost<{ ok?: boolean; error?: string; synced?: number }>("/api/lead-intelligence/search-terms/sync", { windowDays: 30 });
    setBusy("");
    if (!r.ok) setErr(r.error || "Sync failed — connect Google Ads in Settings.");
    else load();
  };

  const suggestNegatives = async () => {
    setBusy("neg");
    const r = await apiPost<{ ok?: boolean; error?: string }>("/api/lead-intelligence/negative-keywords/suggest");
    setBusy("");
    if (!r.ok) setErr(r.error || "Suggestion failed");
    else load();
  };

  const resolveReview = async (id: number) => {
    await apiPatch(`/api/lead-intelligence/review-queue/${id}`, { status: "resolved", resolution: "Reviewed" });
    load();
  };

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      style={{
        padding: "8px 14px",
        borderRadius: 8,
        border: tab === id ? "1px solid #0066FF" : "1px solid #E5E7EB",
        background: tab === id ? "#EFF6FF" : "white",
        color: tab === id ? "#1D4ED8" : "#374151",
        fontWeight: 700,
        fontSize: "0.78rem",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#eef6ff 0%,#e8f6f3 55%,#f0fdf4 100%)" }}>
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Grow</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Lead Intelligence
        </div>
        <h1 className="ih-title">🎯 Lead Intelligence</h1>
        <p className="ih-sub">
          Classifies inbound calls, forms, and WhatsApp enquiries as qualified, junk, or sales-ready — tied to ad source.
          Includes search-term waste review, negative keyword suggestions, specialist queue, and client transparency reports.
          Powered by <strong>Z.ai GLM 5.2</strong> via the AutoClaw Coding endpoint when configured (Manage → AutoClaw or Admin → Platform APIs).
        </p>
      </div>

      <div style={{ padding: 24, maxWidth: 1240, margin: "0 auto" }}>
        {err && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", padding: 14, borderRadius: 10, marginBottom: 16 }}>
            {err}
          </div>
        )}

        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 18 }}>
            {[
              ["Sales opps (30d)", stats.leads30d?.sales_opportunity || 0],
              ["Qualified (30d)", stats.leads30d?.qualified || 0],
              ["Junk filtered", stats.leads30d?.junk || 0],
              ["Open reviews", stats.openReviews || 0],
              ["Search terms", stats.searchTerms || 0],
              ["Neg. suggestions", stats.negativeSuggestions || 0],
            ].map(([label, val]) => (
              <div key={String(label)} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: "0.68rem", color: "#6B7280", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
                <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0A1628", marginTop: 4 }}>{val}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          {tabBtn("leads", "Leads")}
          {tabBtn("review", "Specialist queue")}
          {tabBtn("search", "Search terms")}
          {tabBtn("report", "Transparency report")}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: "#6B7280" }}>Loading…</div>
        ) : (
          <>
            {tab === "leads" && (
              <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
                <h3 style={{ margin: "0 0 14px" }}>Classified leads</h3>
                {leads.length === 0 ? (
                  <p style={{ color: "#6B7280" }}>No leads yet. Form captures from conversion boosters auto-ingest here. Use POST /api/lead-intelligence/ingest for custom channels.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {leads.map((l) => {
                      const t = tierStyle[l.tier || "qualified"] || tierStyle.qualified;
                      return (
                        <div key={l.id} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                            <strong>{l.contact_email || l.contact_phone || l.contact_name || "Unknown"}</strong>
                            <span style={{ background: t.bg, color: t.color, padding: "2px 10px", borderRadius: 12, fontSize: "0.72rem", fontWeight: 700 }}>{t.label} · {l.score ?? "—"}</span>
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "#6B7280", marginTop: 6 }}>
                            {l.channel} · {l.platform || "direct"} · {l.utm_campaign || "no campaign"}
                          </div>
                          {l.reasoning && <p style={{ fontSize: "0.82rem", margin: "8px 0 0", color: "#374151" }}>{l.reasoning}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === "review" && (
              <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <h3 style={{ margin: 0 }}>Specialist review queue</h3>
                  <button type="button" onClick={async () => { await apiPost("/api/lead-intelligence/sync-optimizer-review"); load(); }} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #D1D5DB", background: "white", cursor: "pointer", fontSize: "0.75rem", fontWeight: 700 }}>
                    Queue weekly optimizer review
                  </button>
                </div>
                {reviews.length === 0 ? <p style={{ color: "#6B7280" }}>No open review items.</p> : reviews.map((r) => (
                  <div key={r.id} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <div style={{ fontWeight: 700 }}>{r.title}</div>
                    <div style={{ fontSize: "0.8rem", color: "#6B7280", marginTop: 4 }}>{r.item_type} · {r.priority}</div>
                    {r.summary && <p style={{ fontSize: "0.82rem", margin: "8px 0" }}>{r.summary}</p>}
                    <button type="button" onClick={() => resolveReview(r.id)} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#10B981", color: "white", fontWeight: 700, fontSize: "0.74rem", cursor: "pointer" }}>Mark resolved</button>
                  </div>
                ))}
              </div>
            )}

            {tab === "search" && (
              <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                  <button type="button" disabled={busy === "sync"} onClick={syncTerms} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#0066FF", color: "white", fontWeight: 700, cursor: "pointer" }}>
                    {busy === "sync" ? "Syncing…" : "Sync Google search terms"}
                  </button>
                  <button type="button" disabled={busy === "neg"} onClick={suggestNegatives} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #D1D5DB", background: "white", fontWeight: 700, cursor: "pointer" }}>
                    {busy === "neg" ? "Analyzing…" : "Suggest negative keywords"}
                  </button>
                </div>
                <h3 style={{ margin: "0 0 10px" }}>Wasteful search terms</h3>
                {terms.length === 0 ? <p style={{ color: "#6B7280" }}>Sync search terms from Google Ads to find query-level waste.</p> : (
                  <table style={{ width: "100%", fontSize: "0.82rem", borderCollapse: "collapse" }}>
                    <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #E5E7EB" }}><th>Term</th><th>Campaign</th><th>Spend</th><th>Conv.</th></tr></thead>
                    <tbody>
                      {terms.slice(0, 25).map((t) => (
                        <tr key={t.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "8px 4px" }}>{t.search_term}</td>
                          <td>{t.campaign_name || "—"}</td>
                          <td>${Number(t.cost).toFixed(2)}</td>
                          <td>{t.conversions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {negatives.length > 0 && (
                  <>
                    <h3 style={{ margin: "18px 0 10px" }}>Negative keyword suggestions</h3>
                    {negatives.slice(0, 15).map((n) => (
                      <div key={n.id} style={{ padding: "8px 0", borderBottom: "1px solid #F3F4F6", fontSize: "0.82rem" }}>
                        <strong>{n.keyword}</strong> — {n.reason} {n.estimated_waste ? `(~$${Number(n.estimated_waste).toFixed(0)} waste)` : ""}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {tab === "report" && report && (
              <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
                <h3 style={{ margin: "0 0 10px" }}>Client transparency report (7 days)</h3>
                <p style={{ fontSize: "0.9rem", color: "#374151", lineHeight: 1.5 }}>{report.narrative}</p>
                {report.optimizerChanges && report.optimizerChanges.length > 0 && (
                  <>
                    <h4 style={{ margin: "16px 0 8px" }}>Optimizer changes</h4>
                    {report.optimizerChanges.slice(0, 10).map((a, i) => (
                      <div key={i} style={{ fontSize: "0.8rem", padding: "6px 0", borderBottom: "1px solid #F3F4F6" }}>
                        <strong>{a.action_type}</strong> · {a.campaign_name || "campaign"} — {a.reason?.slice(0, 120)}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

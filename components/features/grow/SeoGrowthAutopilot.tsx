"use client";

/**
 * One-screen Growth Plan — RankPill-style UX moat:
 * niche → keywords → 30-day calendar → autopilot toggle
 * + multi-destination publish + Reddit → AEO assist.
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/api";

interface Keyword {
  keyword: string;
  monthly_volume?: number;
  difficulty?: number;
  intent?: string;
  opportunity_score?: number;
}

interface CalendarItem {
  day: number;
  date: string;
  title: string;
  keyword: string;
  intent?: string;
  status?: string;
}

interface Destination {
  type: "wordpress" | "shopify" | "webflow" | "webhook";
  enabled?: boolean;
  site_id?: number;
  shop?: string;
  url?: string;
  collection_id?: string;
}

interface Plan {
  id?: number;
  niche?: string;
  domain?: string;
  brand?: string;
  industry?: string;
  keywords?: Keyword[];
  calendar?: CalendarItem[];
  destinations?: Destination[];
  autopilot?: boolean;
  publish_status?: string;
  frequency?: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
}

interface Run {
  id: number;
  status: string;
  keyword?: string;
  title?: string;
  word_count?: number;
  publish_results?: { ok?: boolean; destination?: string; simulated?: boolean; post_url?: string }[];
  error?: string;
  created_at: string;
}

interface RedditThread {
  id?: string;
  title: string;
  subreddit?: string;
  url?: string;
  score?: number;
  num_comments?: number;
  selftext?: string;
  aeo_angle?: string;
}

const DEST_TYPES: { type: Destination["type"]; label: string; hint: string }[] = [
  { type: "wordpress", label: "WordPress", hint: "Uses connected WP site_id" },
  { type: "shopify", label: "Shopify", hint: "SHOPIFY_SHOP + admin token" },
  { type: "webhook", label: "Webhook", hint: "Custom URL or SEO_PUBLISH_WEBHOOK_URL" },
  { type: "webflow", label: "Webflow", hint: "Collection CMS item" },
];

export default function SeoGrowthAutopilot() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [niche, setNiche] = useState("");
  const [domain, setDomain] = useState("");
  const [brand, setBrand] = useState("");
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([
    { type: "wordpress", enabled: true },
  ]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [threads, setThreads] = useState<RedditThread[]>([]);
  const [draft, setDraft] = useState<{ reply?: string; aeo_snippet?: string; title?: string } | null>(null);
  const [feedback, setFeedback] = useState<{
    summary?: string;
    winners?: { keyword: string; score: number; reasons?: string[] }[];
    losers?: { keyword: string; score: number; reasons?: string[] }[];
    sources?: string[];
    demo?: boolean;
  } | null>(null);
  const [replanMeta, setReplanMeta] = useState<{ at?: string; summary?: string; changes_count?: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const [p, r, fb] = await Promise.all([
      apiGet<{ ok?: boolean; plan?: Plan & { meta?: { replan?: { at?: string; summary?: string; changes_count?: number } } } }>("/api/seo-autopilot/plan"),
      apiGet<{ ok?: boolean; runs?: Run[] }>("/api/seo-autopilot/runs?limit=12"),
      apiGet<{ ok?: boolean; feedback?: typeof feedback; replan?: typeof replanMeta }>("/api/seo-autopilot/feedback"),
    ]);
    if (p.plan) {
      setPlan(p.plan);
      setNiche(p.plan.niche || "");
      setDomain(p.plan.domain || "");
      setBrand(p.plan.brand || "");
      setKeywords(p.plan.keywords || []);
      setCalendar(p.plan.calendar || []);
      if (p.plan.destinations?.length) setDestinations(p.plan.destinations as Destination[]);
      setReplanMeta(p.plan.meta?.replan || fb.replan || null);
    }
    setRuns(r.runs || []);
    if (fb.feedback) setFeedback(fb.feedback);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const research = async () => {
    if (!niche.trim()) { setErr("Enter a niche first"); return; }
    setBusy("keywords");
    setErr("");
    const r = await apiPost<{ ok?: boolean; keywords?: Keyword[]; error?: string }>(
      "/api/seo-autopilot/research-keywords",
      { niche, domain, industry: niche },
    );
    setBusy("");
    if (!r.ok) { setErr(r.error || "Keyword research failed"); return; }
    setKeywords(r.keywords || []);
  };

  const buildCal = async () => {
    setBusy("calendar");
    setErr("");
    const r = await apiPost<{ ok?: boolean; calendar?: CalendarItem[]; error?: string }>(
      "/api/seo-autopilot/build-calendar",
      { keywords, days: 30 },
    );
    setBusy("");
    if (!r.ok) { setErr(r.error || "Calendar build failed"); return; }
    setCalendar(r.calendar || []);
  };

  const saveOnboard = async (enableAutopilot = false) => {
    if (!niche.trim()) { setErr("Niche is required"); return; }
    setBusy(enableAutopilot ? "autopilot" : "save");
    setErr("");
    const r = await apiPost<{ ok?: boolean; plan?: Plan; error?: string }>(
      "/api/seo-autopilot/onboard",
      {
        niche,
        domain,
        brand: brand || domain,
        keywords,
        calendar,
        destinations,
        autopilot: enableAutopilot || !!plan?.autopilot,
        publish_status: "draft",
        frequency: "daily",
      },
    );
    setBusy("");
    if (!r.ok) { setErr(r.error || "Save failed"); return; }
    setPlan(r.plan || null);
    if (r.plan?.keywords) setKeywords(r.plan.keywords);
    if (r.plan?.calendar) setCalendar(r.plan.calendar);
    load();
  };

  const toggleAutopilot = async () => {
    if (!plan) {
      await saveOnboard(true);
      return;
    }
    setBusy("toggle");
    const r = await apiPost<{ ok?: boolean; plan?: Plan; error?: string }>(
      "/api/seo-autopilot/autopilot",
      { enabled: !plan.autopilot },
    );
    setBusy("");
    if (!r.ok) { setErr(r.error || "Toggle failed"); return; }
    setPlan(r.plan || null);
  };

  const runNow = async () => {
    setBusy("run");
    setErr("");
    if (!plan) await saveOnboard(false);
    const r = await apiPost<{ ok?: boolean; error?: string; article?: { title?: string } }>(
      "/api/seo-autopilot/run-now",
      {},
    );
    setBusy("");
    if (!r.ok && r.error) setErr(r.error);
    load();
  };

  const saveDestinations = async () => {
    if (!plan) { await saveOnboard(false); return; }
    setBusy("dest");
    const r = await apiPut<{ ok?: boolean; plan?: Plan; error?: string }>(
      "/api/seo-autopilot/plan",
      { ...plan, destinations },
    );
    setBusy("");
    if (!r.ok) setErr(r.error || "Could not save destinations");
    else setPlan(r.plan || null);
  };

  const testDest = async () => {
    setBusy("test");
    const r = await apiPost<{ ok?: boolean; results?: unknown[]; error?: string }>(
      "/api/seo-autopilot/destinations/test",
      { destinations },
    );
    setBusy("");
    if (!r.ok) setErr(r.error || "Destination test failed");
    else setErr("");
    alert(JSON.stringify(r.results || r, null, 2).slice(0, 800));
  };

  const loadFeedback = async () => {
    setBusy("feedback");
    const r = await apiGet<{ ok?: boolean; feedback?: typeof feedback; error?: string }>("/api/seo-autopilot/feedback");
    setBusy("");
    if (!r.ok) { setErr(r.error || "Feedback failed"); return; }
    setFeedback(r.feedback || null);
  };

  const runReplan = async () => {
    setBusy("replan");
    setErr("");
    const r = await apiPost<{
      ok?: boolean;
      error?: string;
      plan?: Plan;
      changes?: unknown[];
      feedback?: typeof feedback;
    }>("/api/seo-autopilot/replan", { apply: true });
    setBusy("");
    if (!r.ok) { setErr(r.error || "Replan failed"); return; }
    if (r.plan) {
      setPlan(r.plan);
      setCalendar(r.plan.calendar || []);
      setReplanMeta((r.plan as Plan & { meta?: { replan?: typeof replanMeta } }).meta?.replan || null);
    }
    if (r.feedback) setFeedback(r.feedback as typeof feedback);
    load();
  };

  const discoverReddit = async () => {
    setBusy("reddit");
    setDraft(null);
    const r = await apiPost<{ ok?: boolean; threads?: RedditThread[]; error?: string }>(
      "/api/seo-autopilot/reddit-aeo/discover",
      { niche, brand: brand || niche, limit: 8 },
    );
    setBusy("");
    if (!r.ok) { setErr(r.error || "Reddit discover failed"); return; }
    setThreads(r.threads || []);
  };

  const draftReply = async (thread: RedditThread) => {
    setBusy("draft");
    const r = await apiPost<{ ok?: boolean; reply?: string; aeo_snippet?: string; error?: string }>(
      "/api/seo-autopilot/reddit-aeo/draft-reply",
      { thread, brand: brand || niche, niche },
    );
    setBusy("");
    if (!r.ok) { setErr(r.error || "Draft failed"); return; }
    setDraft({ reply: r.reply, aeo_snippet: r.aeo_snippet, title: thread.title });
  };

  const toggleDest = (type: Destination["type"]) => {
    setDestinations((prev) => {
      const exists = prev.find((d) => d.type === type);
      if (exists) {
        return prev.map((d) => (d.type === type ? { ...d, enabled: !d.enabled } : d));
      }
      return [...prev, { type, enabled: true }];
    });
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #D1D5DB",
    fontSize: "0.9rem",
    background: "#fff",
  };

  const btn = (label: string, onClick: () => void, primary?: boolean, key?: string) => (
    <button
      type="button"
      disabled={!!busy}
      onClick={onClick}
      style={{
        padding: "9px 14px",
        borderRadius: 8,
        border: primary ? "1px solid #0F766E" : "1px solid #D1D5DB",
        background: primary ? "#0F766E" : "#fff",
        color: primary ? "#fff" : "#1F2937",
        fontWeight: 700,
        fontSize: "0.8rem",
        cursor: busy ? "wait" : "pointer",
        opacity: busy && key && busy !== key ? 0.6 : 1,
      }}
    >
      {busy === key ? "…" : label}
    </button>
  );

  return (
    <div>
      <div
        className="intel-header ig-panel-hero"
        style={{ background: "linear-gradient(135deg,#ecfdf5 0%,#f0fdfa 45%,#eff6ff 100%)" }}
      >
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Grow</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> SEO Growth Autopilot
        </div>
        <h2 style={{ margin: "8px 0 4px", fontSize: "1.45rem", fontWeight: 800, color: "#134E4A" }}>
          Growth Plan
        </h2>
        <p style={{ margin: 0, color: "#475569", maxWidth: 640, fontSize: "0.92rem", lineHeight: 1.45 }}>
          Niche → keywords → 30-day calendar → autopilot. Publishes daily to WordPress, Shopify, Webflow, or webhook — with Reddit → AEO replies in the same screen.
        </p>
      </div>

      {err && (
        <div style={{ margin: "12px 0", padding: "10px 14px", background: "#FEF2F2", color: "#991B1B", borderRadius: 8, fontSize: "0.85rem" }}>
          {err}
        </div>
      )}

      {loading ? (
        <p style={{ padding: 24, color: "#64748B" }}>Loading plan…</p>
      ) : (
        <div style={{ display: "grid", gap: 20, padding: "8px 0 32px" }}>
          {/* Step 1 — Niche */}
          <section style={{ display: "grid", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: "1rem", color: "#0F172A" }}>1 · Niche & brand</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: "#64748B" }}>
                Niche *
                <input style={inputStyle} value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g. B2B SEO tools" />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: "#64748B" }}>
                Domain
                <input style={inputStyle} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: "#64748B" }}>
                Brand
                <input style={inputStyle} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" />
              </label>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {btn("Research keywords", research, true, "keywords")}
              {btn("Build 30-day calendar", buildCal, false, "calendar")}
              {btn("Save Growth Plan", () => saveOnboard(false), false, "save")}
            </div>
          </section>

          {/* Step 2 — Keywords */}
          <section>
            <h3 style={{ margin: "0 0 8px", fontSize: "1rem", color: "#0F172A" }}>
              2 · Keywords {keywords.length ? `(${keywords.length})` : ""}
            </h3>
            {!keywords.length ? (
              <p style={{ color: "#94A3B8", fontSize: "0.85rem" }}>Run research to populate high-opportunity keywords.</p>
            ) : (
              <div style={{ display: "grid", gap: 6, maxHeight: 220, overflow: "auto" }}>
                {keywords.slice(0, 12).map((k) => (
                  <div key={k.keyword} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 10px", background: "#F8FAFC", borderRadius: 6, fontSize: "0.82rem" }}>
                    <span style={{ fontWeight: 600 }}>{k.keyword}</span>
                    <span style={{ color: "#64748B", whiteSpace: "nowrap" }}>
                      vol {k.monthly_volume ?? "—"} · diff {k.difficulty ?? "—"} · {k.intent || "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Step 3 — Calendar */}
          <section>
            <h3 style={{ margin: "0 0 8px", fontSize: "1rem", color: "#0F172A" }}>
              3 · 30-day calendar {calendar.length ? `(${calendar.length} days)` : ""}
            </h3>
            {!calendar.length ? (
              <p style={{ color: "#94A3B8", fontSize: "0.85rem" }}>Build a calendar from your keywords.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8, maxHeight: 280, overflow: "auto" }}>
                {calendar.slice(0, 30).map((c) => (
                  <div key={`${c.day}-${c.date}`} style={{ padding: "10px 12px", background: c.status === "queued" ? "#ECFDF5" : "#F8FAFC", borderRadius: 8, borderLeft: c.status === "queued" ? "3px solid #0F766E" : "3px solid transparent" }}>
                    <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700 }}>Day {c.day} · {c.date}</div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: 4, color: "#0F172A" }}>{c.title}</div>
                    <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 2 }}>{c.status || "planned"}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Step 4 — Destinations + Autopilot */}
          <section style={{ display: "grid", gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: "1rem", color: "#0F172A" }}>4 · Publish destinations & autopilot</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {DEST_TYPES.map((d) => {
                const active = destinations.some((x) => x.type === d.type && x.enabled !== false);
                return (
                  <button
                    key={d.type}
                    type="button"
                    onClick={() => toggleDest(d.type)}
                    title={d.hint}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      border: active ? "1px solid #0F766E" : "1px solid #E2E8F0",
                      background: active ? "#F0FDFA" : "#fff",
                      fontWeight: 700,
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      color: active ? "#134E4A" : "#64748B",
                    }}
                  >
                    {active ? "✓ " : ""}{d.label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {btn("Save destinations", saveDestinations, false, "dest")}
              {btn("Test publish", testDest, false, "test")}
              {btn("Run once now", runNow, false, "run")}
              <button
                type="button"
                disabled={!!busy}
                onClick={toggleAutopilot}
                style={{
                  padding: "10px 18px",
                  borderRadius: 999,
                  border: "none",
                  background: plan?.autopilot ? "#0F766E" : "#CBD5E1",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                {busy === "toggle" || busy === "autopilot" ? "…" : plan?.autopilot ? "Autopilot ON · daily" : "Enable autopilot"}
              </button>
              {plan?.next_run_at && (
                <span style={{ fontSize: "0.75rem", color: "#64748B" }}>
                  Next run {new Date(plan.next_run_at).toLocaleString()}
                </span>
              )}
            </div>
          </section>

          {/* Environment feedback + replan */}
          <section style={{ display: "grid", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: "1rem", color: "#0F172A" }}>
              Autopilot loop · feedback & replan
            </h3>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748B" }}>
              Evaluator–Optimizer revises each article before publish. Environment signals (runs, SERP, GSC) score keywords so the calendar defers losers and doubles down on winners.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {btn("Refresh feedback", loadFeedback, false, "feedback")}
              {btn("Replan calendar now", runReplan, true, "replan")}
            </div>
            {feedback?.summary && (
              <div style={{ padding: "12px 14px", background: "#F0F9FF", borderRadius: 8, fontSize: "0.85rem", color: "#0C4A6E" }}>
                {feedback.summary}
                {feedback.demo ? " (demo scores until GSC/SERP connected)" : ""}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
              <div>
                <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#047857", marginBottom: 6 }}>WINNERS</div>
                {(feedback?.winners || []).length ? (feedback?.winners || []).map((w) => (
                  <div key={w.keyword} style={{ fontSize: "0.8rem", padding: "6px 0", borderBottom: "1px solid #E2E8F0" }}>
                    <strong>{w.keyword}</strong> · {w.score}
                    <div style={{ color: "#64748B", fontSize: "0.72rem" }}>{(w.reasons || []).slice(0, 2).join(" · ")}</div>
                  </div>
                )) : <div style={{ fontSize: "0.8rem", color: "#94A3B8" }}>No winners yet — publish a few posts.</div>}
              </div>
              <div>
                <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#B45309", marginBottom: 6 }}>DEFER / SKIP</div>
                {(feedback?.losers || []).length ? (feedback?.losers || []).map((w) => (
                  <div key={w.keyword} style={{ fontSize: "0.8rem", padding: "6px 0", borderBottom: "1px solid #E2E8F0" }}>
                    <strong>{w.keyword}</strong> · {w.score}
                    <div style={{ color: "#64748B", fontSize: "0.72rem" }}>{(w.reasons || []).slice(0, 2).join(" · ")}</div>
                  </div>
                )) : <div style={{ fontSize: "0.8rem", color: "#94A3B8" }}>No losers flagged.</div>}
              </div>
            </div>
            {replanMeta?.at && (
              <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
                Last replan {new Date(replanMeta.at).toLocaleString()}
                {replanMeta.changes_count != null ? ` · ${replanMeta.changes_count} changes` : ""}
              </div>
            )}
          </section>

          {/* Runs */}
          {!!runs.length && (
            <section>
              <h3 style={{ margin: "0 0 8px", fontSize: "1rem", color: "#0F172A" }}>Recent autopilot runs</h3>
              <div style={{ display: "grid", gap: 6 }}>
                {runs.map((r) => (
                  <div key={r.id} style={{ padding: "8px 12px", background: "#F8FAFC", borderRadius: 6, fontSize: "0.8rem", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <span>
                      <strong>{r.title || r.keyword}</strong>
                      <span style={{ color: "#64748B" }}> · {r.status}{r.word_count ? ` · ${r.word_count}w` : ""}</span>
                    </span>
                    <span style={{ color: "#94A3B8" }}>{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Reddit → AEO */}
          <section style={{ paddingTop: 8, borderTop: "1px solid #E2E8F0" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: "1rem", color: "#0F172A" }}>Reddit → AEO assist</h3>
            <p style={{ margin: "0 0 10px", fontSize: "0.85rem", color: "#64748B" }}>
              Surface ranking threads and draft brand replies optimized for answer-engine citation.
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {btn("Find Reddit threads", discoverReddit, true, "reddit")}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {threads.map((t) => (
                <div key={t.id || t.title} style={{ padding: "12px 14px", background: "#FFFBEB", borderRadius: 8 }}>
                  <div style={{ fontSize: "0.72rem", color: "#92400E", fontWeight: 700 }}>
                    r/{t.subreddit} · {t.aeo_angle} · ↑{t.score ?? 0} · 💬{t.num_comments ?? 0}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: "0.9rem", margin: "4px 0", color: "#1C1917" }}>{t.title}</div>
                  {t.url && (
                    <a href={t.url} target="_blank" rel="noreferrer" style={{ fontSize: "0.75rem", color: "#0F766E" }}>
                      Open thread
                    </a>
                  )}
                  <div style={{ marginTop: 8 }}>
                    {btn("Draft brand reply", () => draftReply(t), false, "draft")}
                  </div>
                </div>
              ))}
            </div>
            {draft && (
              <div style={{ marginTop: 12, padding: 14, background: "#F0FDFA", borderRadius: 8 }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#134E4A" }}>Draft for: {draft.title}</div>
                {draft.aeo_snippet && (
                  <p style={{ fontSize: "0.8rem", color: "#0F766E", margin: "8px 0", fontStyle: "italic" }}>
                    AEO snippet: {draft.aeo_snippet}
                  </p>
                )}
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.85rem", margin: 0, color: "#1E293B" }}>
                  {draft.reply}
                </pre>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

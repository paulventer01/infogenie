"use client";

// Unified "Lead Generation" hub (Next.js Phase 3). Merges four existing
// lead-gen tools behind one mode picker, reusing the existing Express APIs
// unchanged:
//   • Find Business Contacts  — POST /api/lead-aggregator/sweep (source selector:
//       AI web search [perplexity] / Apollo [apollo] / Both). Replaces the
//       separate B2B Lead Finder + Multi-Source Sweep panels.
//   • Find Local Businesses   — POST /api/apify/maps-leads + GET /run-status
//       (Google Maps via Apify).
//   • Autonomous Outreach     — POST /api/acquisition-engine/launch + GET
//       /campaigns + prospect mark-sent / mark-meeting.
//
// Per-lead actions preserved from the legacy panels: CSV export, push to HubSpot
// (contacts via /api/hubspot-sync/push-bulk, local businesses via
// /api/hubspot/create-company), and the window._cePreset → cold-email hand-off.
//
// A unified recent-runs panel (localStorage) records every successful run across
// all three modes so users can jump back to — and re-run — a past search. This
// is real session data (the user's own runs), never fabricated. Every mode shows
// real API results or an explicit empty state.

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { goToView } from "@/lib/nav";

// ── Shared types ─────────────────────────────────────────────────────────────
type Mode = "contacts" | "local" | "outreach";
type ContactSource = "web" | "apollo" | "both";

interface ContactsParams {
  source: ContactSource;
  industry: string;
  role: string;
  location: string;
  size: string;
}
interface LocalParams {
  cat: string;
  loc: string;
  limit: number;
}
interface OutreachParams {
  name: string;
  industry: string;
  roleTarget: string;
  companySize: string;
  valueProp: string;
  count: number;
}

type RunParams =
  | ({ mode: "contacts" } & ContactsParams)
  | ({ mode: "local" } & LocalParams)
  | ({ mode: "outreach" } & OutreachParams);

interface RecentRun {
  id: string;
  label: string;
  sublabel: string;
  ts: number;
  count: number;
  params: RunParams;
}

// ── Recent-runs store (localStorage, real session history) ───────────────────
const RECENT_KEY = "ig_leadgen_recent_v1";
const RECENT_MAX = 12;

function loadRecent(): RecentRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as RecentRun[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: RecentRun[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* storage full / disabled — recent history is best-effort */
  }
}

const MODE_META: Record<Mode, { icon: string; title: string }> = {
  contacts: { icon: "🧲", title: "Find Business Contacts" },
  local: { icon: "📍", title: "Find Local Businesses" },
  outreach: { icon: "🚀", title: "Autonomous Outreach" },
};

// ── Small shared UI helpers ──────────────────────────────────────────────────
function safeUrl(u?: string): string {
  if (!u) return "#";
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "#";
  } catch {
    return "#";
  }
}

function Badge({
  label,
  color,
}: {
  label: string;
  color: "green" | "blue" | "purple" | "gray";
}) {
  const map: Record<string, [string, string]> = {
    green: ["#D1FAE5", "#065F46"],
    blue: ["#DBEAFE", "#1E40AF"],
    purple: ["#EDE9FE", "#5B21B6"],
    gray: ["#F3F4F6", "#374151"],
  };
  const [bg, fg] = map[color] || map.gray;
  return (
    <span
      style={{
        background: bg,
        color: fg,
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

function ScoreDot({ score }: { score: number }) {
  const bg = score >= 70 ? "#d1fae5" : score >= 40 ? "#fef3c7" : "#fee2e2";
  const fg = score >= 70 ? "#065f46" : score >= 40 ? "#92400e" : "#991b1b";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 30,
        height: 30,
        padding: "0 6px",
        borderRadius: 15,
        background: bg,
        color: fg,
        fontWeight: 700,
        fontSize: 12,
      }}
    >
      {score || "—"}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #D1D5DB",
  borderRadius: 7,
  fontSize: 13,
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 5,
};

// ═══════════════════════════════════════════════════════════════════════════
// Mode 1 — Find Business Contacts (Lead Finder + Multi-Source Sweep merged)
// ═══════════════════════════════════════════════════════════════════════════
interface ContactLead {
  name?: string;
  title?: string;
  company?: string;
  company_domain?: string;
  location?: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  score?: number | string;
  source?: string;
  [key: string]: unknown;
}
interface SweepResult {
  ok: boolean;
  error?: string;
  total?: number;
  with_email?: number;
  with_linkedin?: number;
  source_counts?: Record<string, number>;
  leads?: ContactLead[];
}
interface SourcesResult {
  ok: boolean;
  sources?: { available: boolean; label: string }[];
}

const SOURCE_OPTS: { key: ContactSource; label: string; hint: string }[] = [
  { key: "web", label: "AI web search", hint: "Perplexity research" },
  { key: "apollo", label: "Apollo database", hint: "275M+ B2B contacts" },
  { key: "both", label: "Both", hint: "Sweep & dedupe" },
];

function sourcesFor(source: ContactSource): string[] {
  if (source === "web") return ["perplexity"];
  if (source === "apollo") return ["apollo"];
  return ["perplexity", "apollo"];
}

function ContactsMode({
  initial,
  autoRun,
  onRecord,
}: {
  initial: ContactsParams | null;
  autoRun: boolean;
  onRecord: (p: RunParams, count: number) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [source, setSource] = useState<ContactSource>(initial?.source ?? "both");
  const [industry, setIndustry] = useState(initial?.industry ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [size, setSize] = useState(initial?.size ?? "");
  const [available, setAvailable] = useState<SourcesResult["sources"] | null>(null);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    apiGet<SourcesResult>("/api/lead-aggregator/sources").then((d) => {
      if (d.ok && d.sources) setAvailable(d.sources);
    });
  }, []);

  const run = useCallback(
    async (p: ContactsParams) => {
      setLoading(true);
      setError("");
      setResult(null);
      const d = await apiPost<SweepResult>("/api/lead-aggregator/sweep", {
        industry: p.industry.trim(),
        role: p.role.trim(),
        location: p.location.trim(),
        company_size: p.size,
        sources: sourcesFor(p.source),
      });
      setLoading(false);
      if (!d.ok) {
        setError(d.error || "Search failed");
        return;
      }
      setResult(d);
      onRecord({ mode: "contacts", ...p }, d.total || (d.leads || []).length);
    },
    [onRecord],
  );

  // Replay: when arriving from a recent run with autoRun, fire it once on mount.
  const fired = useRef(false);
  useEffect(() => {
    if (autoRun && initial && !fired.current) {
      fired.current = true;
      run(initial);
    }
  }, [autoRun, initial, run]);

  function submit() {
    if (!industry.trim() && !role.trim()) {
      toast("⚠️ Enter at least an industry or a target role");
      return;
    }
    run({ source, industry, role, location, size });
  }

  function sendToColdEmail(l: ContactLead) {
    const pain = [l.company, l.title].filter(Boolean).join(" / ");
    (
      window as Window &
        typeof globalThis & {
          _cePreset?: { target_company?: string; target_role?: string; target_pain?: string } | null;
        }
    )._cePreset = {
      target_company: l.company || "",
      target_role: l.title || "",
      target_pain: pain,
    };
    goToView(router, "cold-email");
  }

  const leads = result?.leads || [];

  function exportCsv() {
    if (!leads.length) return;
    const cols: (keyof ContactLead)[] = [
      "name",
      "title",
      "company",
      "company_domain",
      "location",
      "email",
      "email_status",
      "linkedin_url",
      "score",
      "source",
    ];
    const csv = [cols.join(",")]
      .concat(
        leads.map((r) =>
          cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","),
        ),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `contacts-${Date.now()}.csv`;
    a.click();
    toast("✅ CSV downloaded");
  }

  async function pushHubSpot() {
    const withContact = leads.filter((l) => l.email || l.name);
    if (!withContact.length) {
      toast("No contacts to push");
      return;
    }
    setPushing(true);
    const d = await apiPost<{ ok: boolean; pushed?: number; error?: string }>(
      "/api/hubspot-sync/push-bulk",
      {
        leads: withContact.slice(0, 50).map((l) => ({
          name: l.name,
          email: l.email,
          title: l.title,
          company: l.company,
          company_domain: l.company_domain,
        })),
      },
    );
    setPushing(false);
    toast(d.ok ? `✅ Pushed ${d.pushed ?? 0} contacts to HubSpot` : `⚠️ ${d.error || "HubSpot push failed"}`);
  }

  const availMap: Record<string, boolean> = {};
  (available || []).forEach((s) => {
    availMap[s.label.toLowerCase()] = s.available;
  });

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <label style={labelStyle}>Industry</label>
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="SaaS, FinTech…"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Target role</label>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="VP Marketing, CMO…"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Location</label>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="United States, London…"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Company size</label>
          <select value={size} onChange={(e) => setSize(e.target.value)} style={{ ...inputStyle, padding: 9 }}>
            <option value="">Any</option>
            <option value="1-10">1-10</option>
            <option value="11-50">11-50</option>
            <option value="51-200">51-200</option>
            <option value="201-1000">201-1000</option>
            <option value="1000+">1000+</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Source</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SOURCE_OPTS.map((o) => {
            const active = source === o.key;
            return (
              <button
                key={o.key}
                onClick={() => setSource(o.key)}
                style={{
                  textAlign: "left",
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: active ? "2px solid #6366F1" : "1.5px solid #D1D5DB",
                  background: active ? "#EEF2FF" : "#fff",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13, color: "#1E1B4B" }}>{o.label}</div>
                <div style={{ fontSize: 11, color: "#6B7280" }}>{o.hint}</div>
              </button>
            );
          })}
        </div>
        {available && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#6B7280" }}>
            {available.map((s, i) => (
              <span key={i} style={{ marginRight: 12 }}>
                {s.available ? "✓" : "–"} {s.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={submit}
        disabled={loading}
        style={{
          padding: "11px 28px",
          background: "#6366F1",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 700,
          cursor: loading ? "default" : "pointer",
          marginBottom: 24,
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "🔎 Searching…" : "🔎 Find contacts"}
      </button>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 0", color: "#6B7280" }}>
          <div
            style={{
              width: 18,
              height: 18,
              border: "2px solid #E5E7EB",
              borderTopColor: "#6366F1",
              borderRadius: "50%",
              animation: "_lgSpin 0.8s linear infinite",
            }}
          />
          <span>Searching sources — this can take 20-40 seconds…</span>
          <style>{"@keyframes _lgSpin{to{transform:rotate(360deg)}}"}</style>
        </div>
      )}

      {!loading && error && (
        <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10 }}>{error}</div>
      )}

      {!loading && result && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <Badge label={`${result.total || leads.length} found`} color="green" />
            <Badge label={`${result.with_email || 0} with email`} color="purple" />
            <Badge label={`${result.with_linkedin || 0} with LinkedIn`} color="blue" />
            {Object.entries(result.source_counts || {}).map(([s, c]) => (
              <Badge key={s} label={`${s}: ${c}`} color="gray" />
            ))}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                onClick={exportCsv}
                disabled={!leads.length}
                style={{
                  padding: "7px 14px",
                  background: "#fff",
                  border: "1.5px solid #6366F1",
                  borderRadius: 6,
                  color: "#6366F1",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: leads.length ? "pointer" : "default",
                }}
              >
                📥 Export CSV
              </button>
              <button
                onClick={pushHubSpot}
                disabled={!leads.length || pushing}
                style={{
                  padding: "7px 14px",
                  background: "#fff",
                  border: "1.5px solid #6366F1",
                  borderRadius: 6,
                  color: "#6366F1",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: leads.length && !pushing ? "pointer" : "default",
                }}
              >
                {pushing ? "⏳ Pushing…" : "→ Push to HubSpot"}
              </button>
            </div>
          </div>

          {leads.length === 0 ? (
            <p style={{ color: "#6B7280", fontSize: 14 }}>
              No contacts matched these filters. Try broader criteria or a different source.
            </p>
          ) : (
            <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #E5E7EB" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Name", "Company", "Role", "Email", "Source", "Score", "Actions"].map((c) => (
                      <th
                        key={c}
                        style={{
                          padding: "10px 12px",
                          background: "#F9FAFB",
                          borderBottom: "1px solid #E5E7EB",
                          textAlign: "left",
                          fontSize: 11,
                          textTransform: "uppercase",
                          color: "#6B7280",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l, i) => {
                    const scoreNum = Math.round(parseFloat(String(l.score ?? "0")) || 0);
                    return (
                      <tr key={i}>
                        <td style={cellStyle}>{l.name || "—"}</td>
                        <td style={{ ...cellStyle, fontWeight: 600 }}>
                          {l.company || "—"}
                          {l.location ? (
                            <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 400 }}>{l.location}</div>
                          ) : null}
                        </td>
                        <td style={cellStyle}>{l.title || "—"}</td>
                        <td style={cellStyle}>
                          {l.email ? (
                            <span>
                              {l.email}
                              {l.email_status === "verified" && (
                                <span style={{ color: "#059669", marginLeft: 4 }}>✓</span>
                              )}
                            </span>
                          ) : (
                            <span style={{ color: "#D1D5DB" }}>—</span>
                          )}
                        </td>
                        <td style={cellStyle}>
                          {l.source ? <Badge label={String(l.source)} color="gray" /> : "—"}
                        </td>
                        <td style={cellStyle}>
                          <ScoreDot score={scoreNum} />
                        </td>
                        <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => sendToColdEmail(l)}
                              style={{
                                padding: "5px 10px",
                                background: "#EDE9FE",
                                border: "1.5px solid #6366F1",
                                color: "#4F46E5",
                                borderRadius: 5,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              ✉ Cold email
                            </button>
                            {l.linkedin_url && (
                              <a
                                href={safeUrl(l.linkedin_url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  padding: "5px 10px",
                                  background: "#0A66C2",
                                  color: "#fff",
                                  borderRadius: 5,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  textDecoration: "none",
                                }}
                              >
                                in
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #F3F4F6",
  fontSize: 13,
  color: "#111827",
  maxWidth: 260,
  wordBreak: "break-word",
  verticalAlign: "top",
};

// ═══════════════════════════════════════════════════════════════════════════
// Mode 2 — Find Local Businesses (Apify / Google Maps)
// ═══════════════════════════════════════════════════════════════════════════
interface MapsLead {
  title?: string;
  name?: string;
  address?: string;
  vicinity?: string;
  phone?: string;
  phoneUnformatted?: string;
  website?: string;
  totalScore?: number | string;
  rating?: number | string;
  reviewsCount?: number | string;
  userRatingsTotal?: number | string;
  categories?: string[];
  categoryName?: string;
  url?: string;
  city?: string;
  countryCode?: string;
}
interface MapsStartResult {
  ok: boolean;
  error?: string;
  run_id?: string;
  dataset_id?: string;
}
interface RunStatusResult {
  ok?: boolean;
  status?: string;
  error?: string;
  items?: MapsLead[];
}

const POLL_MAX = 40;
const POLL_INTERVAL = 8000;

function stars(r: number): string {
  const full = Math.round(r || 0);
  return "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full));
}

function LocalMode({
  initial,
  autoRun,
  onRecord,
}: {
  initial: LocalParams | null;
  autoRun: boolean;
  onRecord: (p: RunParams, count: number) => void;
}) {
  const toast = useToast();
  const [cat, setCat] = useState(initial?.cat ?? "");
  const [loc, setLoc] = useState(initial?.loc ?? "");
  const [limit, setLimit] = useState(initial?.limit ?? 20);
  const [statusMsg, setStatusMsg] = useState("");
  const [statusKind, setStatusKind] = useState<"idle" | "error" | "success" | "info" | "spinner">("idle");
  const [running, setRunning] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [leads, setLeads] = useState<MapsLead[] | null>(null);
  const [query, setQuery] = useState("");

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const limitRef = useRef(limit);
  limitRef.current = limit;

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  const poll = useCallback(
    (runId: string, datasetId: string, attempts: number, q: string, p: LocalParams) => {
      if (attempts >= POLL_MAX) {
        setStatusKind("error");
        setStatusMsg("Apify timed out — try a smaller result count.");
        setRunning(false);
        return;
      }
      pollRef.current = setTimeout(async () => {
        if (cancelledRef.current) return;
        const url = `/api/apify/run-status?run_id=${encodeURIComponent(runId)}&dataset_id=${encodeURIComponent(datasetId)}&limit=${limitRef.current}`;
        const d = await apiGet<RunStatusResult>(url);
        if (cancelledRef.current) return;
        if (d.error) {
          setStatusKind("error");
          setStatusMsg(d.error);
          setRunning(false);
          return;
        }
        if (d.status === "failed") {
          setStatusKind("error");
          setStatusMsg("Scrape failed: " + (d.error || "unknown"));
          setRunning(false);
          return;
        }
        if (d.status === "pending") {
          setStatusKind("spinner");
          setStatusMsg(`Still running… attempt ${attempts + 1}/${POLL_MAX} (${(attempts + 1) * 8}s elapsed)`);
          poll(runId, datasetId, attempts + 1, q, p);
          return;
        }
        const items = d.items || [];
        setStatusKind("success");
        setStatusMsg(`✓ Scraped ${items.length} results`);
        setLeads(items);
        setQuery(q);
        setRunning(false);
        onRecord({ mode: "local", ...p }, items.length);
      }, POLL_INTERVAL);
    },
    [onRecord],
  );

  const run = useCallback(
    async (p: LocalParams) => {
      const c = p.cat.trim();
      const l = p.loc.trim();
      if (!c || !l) {
        setStatusKind("error");
        setStatusMsg("Category and location are both required");
        return;
      }
      const q = `${c} in ${l}`;
      setLeads(null);
      setQuery(q);
      setRunning(true);
      cancelledRef.current = false;
      setStatusKind("spinner");
      setStatusMsg(`Starting Google Maps scrape for "${q}"…`);
      const d = await apiPost<MapsStartResult>("/api/apify/maps-leads", { query: q, limit: p.limit });
      if (!d.ok) {
        setStatusKind("error");
        setStatusMsg(d.error?.includes("APIFY_API_KEY") ? "APIFY_API_KEY required — add it in Settings → Integrations → Apify." : d.error || "Failed to start");
        setRunning(false);
        return;
      }
      setStatusKind("spinner");
      setStatusMsg("Maps scrape running… checking every 8s (usually 45-120s)");
      poll(d.run_id || "", d.dataset_id || "", 0, q, p);
    },
    [poll],
  );

  const fired = useRef(false);
  useEffect(() => {
    if (autoRun && initial && !fired.current) {
      fired.current = true;
      run(initial);
    }
  }, [autoRun, initial, run]);

  function exportCsv() {
    if (!leads) return;
    const rows: string[][] = [["Name", "Category", "Address", "Phone", "Website", "Rating", "Reviews"]];
    leads.forEach((b) => {
      rows.push([
        '"' + String(b.title || b.name || "").replace(/"/g, '""') + '"',
        '"' + String((Array.isArray(b.categories) ? b.categories[0] : b.categoryName) || "").replace(/"/g, '""') + '"',
        '"' + String(b.address || b.vicinity || "").replace(/"/g, '""') + '"',
        String(b.phone || b.phoneUnformatted || ""),
        String(b.website || ""),
        String(b.totalScore ?? b.rating ?? ""),
        String(b.reviewsCount ?? b.userRatingsTotal ?? ""),
      ]);
    });
    const csv = rows.map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "local_leads_" + (query || "export").replace(/\W+/g, "_") + ".csv";
    a.click();
    toast("✅ CSV downloaded");
  }

  async function pushHubSpot() {
    if (!leads || !leads.length) return;
    setPushing(true);
    let ok = 0;
    let fail = 0;
    for (const b of leads.slice(0, 20)) {
      const r = await apiPost("/api/hubspot/create-company", {
        name: b.title || b.name || "Unknown",
        domain: b.website ? b.website.replace(/^https?:\/\//, "").split("/")[0] : "",
        phone: b.phone || b.phoneUnformatted || "",
        address: b.address || "",
        city: b.city || "",
        country: b.countryCode || "",
      });
      if (r.ok) ok++;
      else fail++;
    }
    setPushing(false);
    setStatusKind(ok > 0 ? "success" : "error");
    setStatusMsg(`Pushed to HubSpot: ${ok} companies created${fail ? " · " + fail + " failed" : ""}`);
  }

  const stat = leads
    ? {
        withPhone: leads.filter((b) => b.phone || b.phoneUnformatted).length,
        withWebsite: leads.filter((b) => b.website).length,
      }
    : null;

  const alertColors: Record<string, [string, string]> = {
    error: ["#FEE2E2", "#991B1B"],
    success: ["#D1FAE5", "#065F46"],
    info: ["#EFF6FF", "#1E40AF"],
  };

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto auto",
          gap: 10,
          alignItems: "end",
          marginBottom: 12,
        }}
      >
        <div>
          <label style={labelStyle}>Business category</label>
          <input
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run({ cat, loc, limit })}
            placeholder="e.g. dentists, gyms, coffee shops"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Location</label>
          <input
            value={loc}
            onChange={(e) => setLoc(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run({ cat, loc, limit })}
            placeholder="e.g. Miami FL, London UK, Toronto"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Limit</label>
          <select value={limit} onChange={(e) => setLimit(parseInt(e.target.value, 10) || 20)} style={{ ...inputStyle, padding: 9 }}>
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="30">30</option>
          </select>
        </div>
        <button
          onClick={() => run({ cat, loc, limit })}
          disabled={running}
          style={{
            padding: "10px 20px",
            background: "#6366F1",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            cursor: running ? "default" : "pointer",
            opacity: running ? 0.7 : 1,
          }}
        >
          {running ? "⏳ Starting…" : "🗺 Find businesses"}
        </button>
      </div>

      {statusKind !== "idle" && (
        <div style={{ marginBottom: 16 }}>
          {statusKind === "spinner" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#6B7280" }}>
              <div
                style={{
                  width: 16,
                  height: 16,
                  border: "2px solid #E5E7EB",
                  borderTopColor: "#6366F1",
                  borderRadius: "50%",
                  animation: "_lgSpin 0.8s linear infinite",
                }}
              />
              <span style={{ fontSize: 13 }}>{statusMsg}</span>
              <style>{"@keyframes _lgSpin{to{transform:rotate(360deg)}}"}</style>
            </div>
          ) : (
            <div
              style={{
                background: (alertColors[statusKind] || alertColors.info)[0],
                color: (alertColors[statusKind] || alertColors.info)[1],
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              {statusMsg}
            </div>
          )}
        </div>
      )}

      {leads && stat && leads.length === 0 && (
        <div style={{ background: "#EFF6FF", color: "#1E40AF", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>
          No businesses found — try a broader category or different location.
        </div>
      )}

      {leads && stat && leads.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
            {(
              [
                ["📍", `${leads.length}`, "Businesses"],
                ["📞", `${stat.withPhone} / ${leads.length}`, "With phone"],
                ["🌐", `${stat.withWebsite} / ${leads.length}`, "With website"],
              ] as [string, string, string][]
            ).map(([ic, v, l]) => (
              <div key={l} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 14, textAlign: "center" }}>
                <div style={{ fontSize: "1.4rem" }}>{ic}</div>
                <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#0A1628" }}>{v}</div>
                <div style={{ fontSize: 11, color: "#9CA3AF" }}>{l}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, color: "#0A1628", fontSize: 14 }}>
              Results for &quot;<span style={{ color: "#6366F1" }}>{query}</span>&quot;
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={exportCsv}
                style={{ padding: "7px 14px", background: "#fff", border: "1.5px solid #6366F1", borderRadius: 6, color: "#6366F1", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                📥 Export CSV
              </button>
              <button
                onClick={pushHubSpot}
                disabled={pushing}
                style={{ padding: "7px 14px", background: "#fff", border: "1.5px solid #6366F1", borderRadius: 6, color: "#6366F1", fontSize: 12, fontWeight: 700, cursor: pushing ? "default" : "pointer" }}
              >
                {pushing ? "⏳ Pushing…" : "→ Push to HubSpot"}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(255px,1fr))", gap: 12 }}>
            {leads.map((b, i) => {
              const name = b.title || b.name || "";
              const addr = b.address || b.vicinity || "";
              const phone = b.phone || b.phoneUnformatted || "";
              const website = b.website || "";
              const rating = parseFloat(String(b.totalScore ?? b.rating ?? "")) || 0;
              const reviews = parseInt(String(b.reviewsCount ?? b.userRatingsTotal ?? ""), 10) || 0;
              const category = (Array.isArray(b.categories) ? b.categories[0] : b.categoryName) || "";
              const mapUrl = b.url || "";
              return (
                <div key={i} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#1E1B4B", marginBottom: 2 }}>{name}</div>
                  {category && (
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 6, textTransform: "capitalize" }}>{category}</div>
                  )}
                  {rating > 0 && (
                    <div style={{ color: "#F59E0B", fontSize: 13, marginBottom: 5 }} title={`${rating.toFixed(1)} stars, ${reviews} reviews`}>
                      {stars(rating)} <span style={{ color: "#6B7280", fontSize: 11 }}>{rating.toFixed(1)} ({reviews})</span>
                    </div>
                  )}
                  {addr && <div style={{ fontSize: 13, color: "#374151", marginBottom: 3 }}>📍 {addr}</div>}
                  {phone && (
                    <div style={{ fontSize: 13, color: "#374151", marginBottom: 3 }}>
                      📞 <a href={`tel:${phone}`} style={{ color: "#0066FF" }}>{phone}</a>
                    </div>
                  )}
                  {website && (
                    <div style={{ fontSize: 13, marginBottom: 6 }}>
                      🌐{" "}
                      <a href={website} target="_blank" rel="noopener noreferrer" style={{ color: "#0066FF" }}>
                        {website.replace(/^https?:\/\//, "").slice(0, 38)}
                      </a>
                    </div>
                  )}
                  {mapUrl && (
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "inline-block", marginTop: 4, fontSize: 12, color: "#6366F1", fontWeight: 700, textDecoration: "none" }}
                    >
                      🗺 View on Maps
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Mode 3 — Autonomous Outreach Campaign (Acquisition Engine)
// ═══════════════════════════════════════════════════════════════════════════
interface Prospect {
  id: number;
  campaign_id?: number;
  name?: string;
  company?: string;
  role?: string;
  email?: string;
  score: number;
  status?: string;
}
interface SequenceEmail {
  step: number;
  subject?: string;
  body?: string;
}
interface AEStats {
  total_found?: number;
  emails_sent?: number;
  replies?: number;
  meetings_booked?: number;
}
interface LaunchResult {
  ok: boolean;
  error?: string;
  stats?: AEStats;
  prospects?: Prospect[];
  email_sequence?: { emails?: SequenceEmail[] };
}
interface Campaign {
  id?: number;
  name: string;
  status: string;
  stats?: AEStats;
  created_at?: string;
}
interface CampaignsResult {
  ok: boolean;
  campaigns?: Campaign[];
  prospects?: Prospect[];
}

// Shared prospects table — used by both a fresh launch result and the
// detail view of a previously-run campaign.
function ProspectsTable({
  prospects,
  onMark,
}: {
  prospects: Prospect[];
  onMark: (id: number, type: "meeting" | "sent") => void;
}) {
  if (!prospects.length) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: "#6b7280", fontSize: 13 }}>
        No prospects were recorded for this campaign.
      </div>
    );
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f9fafb" }}>
            {["Name", "Company", "Role", "Email", "Score", "Actions"].map((h) => (
              <th key={h} style={{ padding: 8, textAlign: "left", color: "#6b7280", fontWeight: 600 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {prospects.map((p) => (
            <tr key={p.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: 8 }}>{p.name || "—"}</td>
              <td style={{ padding: 8, fontWeight: 600 }}>{p.company || "—"}</td>
              <td style={{ padding: 8 }}>{p.role || "—"}</td>
              <td style={{ padding: 8, color: "#6b7280" }}>{p.email || "—"}</td>
              <td style={{ padding: 8 }}>
                <ScoreDot score={p.score} />
              </td>
              <td style={{ padding: 8 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-xs" onClick={() => onMark(p.id, "sent")} title="Mark emailed">
                    📧
                  </button>
                  <button className="btn btn-xs" onClick={() => onMark(p.id, "meeting")} title="Mark meeting booked">
                    📅
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutreachMode({
  initial,
  onRecord,
}: {
  initial: OutreachParams | null;
  onRecord: (p: RunParams, count: number) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "Q3 Outreach");
  const [industry, setIndustry] = useState(initial?.industry ?? "");
  const [roleTarget, setRoleTarget] = useState(initial?.roleTarget ?? "");
  const [companySize, setCompanySize] = useState(initial?.companySize ?? "");
  const [valueProp, setValueProp] = useState(initial?.valueProp ?? "");
  const [count, setCount] = useState(initial?.count ?? 10);

  const [launching, setLaunching] = useState(false);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [campaignProspects, setCampaignProspects] = useState<Prospect[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  const loadCampaigns = useCallback(async () => {
    const d = await apiGet<CampaignsResult>("/api/acquisition-engine/campaigns");
    setCampaigns(d.ok && d.campaigns ? d.campaigns : []);
    setCampaignProspects(d.ok && d.prospects ? d.prospects : []);
  }, []);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  async function launch() {
    if (!industry.trim()) {
      toast("⚠️ Enter a target industry");
      return;
    }
    setLaunching(true);
    const p: OutreachParams = { name, industry, roleTarget, companySize, valueProp, count };
    const d = await apiPost<LaunchResult>("/api/acquisition-engine/launch", {
      name: name || "Campaign",
      target_industry: industry.trim(),
      target_role: roleTarget,
      target_size: companySize,
      value_prop: valueProp,
      count: count || 10,
    });
    setLaunching(false);
    if (!d.ok) {
      toast(`⚠️ ${d.error || "Launch failed"}`);
      return;
    }
    setResult(d);
    onRecord({ mode: "outreach", ...p }, d.stats?.total_found || (d.prospects || []).length);
    loadCampaigns();
  }

  async function mark(id: number, type: "meeting" | "sent") {
    const path =
      type === "meeting"
        ? `/api/acquisition-engine/prospects/${id}/mark-meeting`
        : `/api/acquisition-engine/prospects/${id}/mark-sent`;
    await apiPost(path);
    loadCampaigns();
  }

  const seq = result?.email_sequence?.emails || [];
  const stats = result?.stats || {};
  const selectedCampaign =
    selectedCampaignId != null ? campaigns?.find((c) => c.id === selectedCampaignId) ?? null : null;
  const selectedProspects =
    selectedCampaignId != null ? campaignProspects.filter((p) => p.campaign_id === selectedCampaignId) : [];

  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div className="ig-card" style={{ flex: 1, minWidth: 300, padding: 18 }}>
          <h3 style={{ fontWeight: 700, marginBottom: 16 }}>Launch new campaign</h3>
          {initial && (
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>
              Restored from a previous run — review and click launch to run it again.
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Campaign name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Target industry</label>
            <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. E-commerce, SaaS, Healthcare" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Target role</label>
            <input value={roleTarget} onChange={(e) => setRoleTarget(e.target.value)} placeholder="e.g. Marketing Director, CEO" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Company size</label>
            <select value={companySize} onChange={(e) => setCompanySize(e.target.value)} style={{ ...inputStyle, padding: 9 }}>
              <option value="">Any</option>
              <option>1-10</option>
              <option>11-50</option>
              <option>51-200</option>
              <option>201-500</option>
              <option>500+</option>
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Value proposition</label>
            <input value={valueProp} onChange={(e) => setValueProp(e.target.value)} placeholder="e.g. AI that doubles your ad ROAS" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Prospects to find</label>
            <input type="number" value={count} min={5} max={20} onChange={(e) => setCount(parseInt(e.target.value, 10) || 10)} style={inputStyle} />
          </div>
          <button
            onClick={launch}
            disabled={launching}
            style={{
              width: "100%",
              padding: "11px 0",
              background: "#6366F1",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
              cursor: launching ? "default" : "pointer",
              opacity: launching ? 0.7 : 1,
            }}
          >
            {launching ? "Finding & scoring prospects…" : "🚀 Launch engine"}
          </button>
        </div>

        <div style={{ flex: 2, minWidth: 300 }}>
          {campaigns && campaigns.length > 0 ? (
            <>
              <h3 style={{ fontWeight: 700, marginBottom: 8 }}>Your campaigns</h3>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                Click a campaign to see the prospects it found and update their status.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {campaigns.map((c, i) => {
                  const s = c.stats || {};
                  const cid = c.id ?? null;
                  const isSelected = cid != null && cid === selectedCampaignId;
                  return (
                    <div
                      key={c.id ?? i}
                      className="ig-card"
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedCampaignId(isSelected ? null : cid)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedCampaignId(isSelected ? null : cid);
                        }
                      }}
                      style={{
                        padding: 12,
                        cursor: "pointer",
                        border: isSelected ? "1px solid #6366F1" : undefined,
                        boxShadow: isSelected ? "0 0 0 2px rgba(99,102,241,.18)" : undefined,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ background: "#dbeafe", color: "#1d4ed8", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
                            {c.status}
                          </span>
                          <span style={{ fontSize: 11, color: "#6366F1", fontWeight: 600 }}>{isSelected ? "Hide ▲" : "View ▾"}</span>
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#6b7280", flexWrap: "wrap" }}>
                        <span>👥 {s.total_found || 0} found</span>
                        <span>📧 {s.emails_sent || 0} emailed</span>
                        <span>💬 {s.replies || 0} replies</span>
                        <span>📅 {s.meetings_booked || 0} meetings</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="ig-card" style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
              No campaigns yet — launch your first above.
            </div>
          )}
        </div>
      </div>

      {selectedCampaign && (
        <div className="ig-card" style={{ marginBottom: 16, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h4 style={{ fontWeight: 700, margin: 0 }}>
              {selectedCampaign.name} — prospects
            </h4>
            <button
              className="btn btn-xs"
              onClick={() => setSelectedCampaignId(null)}
              title="Close"
              style={{ cursor: "pointer" }}
            >
              ✕ Close
            </button>
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
            {(
              [
                [selectedCampaign.stats?.total_found ?? selectedProspects.length, "Prospects Found", "#3b82f6"],
                [selectedCampaign.stats?.emails_sent || 0, "Emails Sent", "#10b981"],
                [selectedCampaign.stats?.replies || 0, "Replies", "#f59e0b"],
                [selectedCampaign.stats?.meetings_booked || 0, "Meetings Booked", "#8b5cf6"],
              ] as [number, string, string][]
            ).map(([v, l, col]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "2rem", fontWeight: 800, color: col }}>{v}</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{l}</div>
              </div>
            ))}
          </div>
          <ProspectsTable prospects={selectedProspects} onMark={mark} />
        </div>
      )}

      {result && (
        <>
          <div className="ig-card" style={{ marginBottom: 16, padding: 18 }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
              {(
                [
                  [stats.total_found || 0, "Prospects Found", "#3b82f6"],
                  [stats.emails_sent || 0, "Emails Sent", "#10b981"],
                  [stats.replies || 0, "Replies", "#f59e0b"],
                  [stats.meetings_booked || 0, "Meetings Booked", "#8b5cf6"],
                ] as [number, string, string][]
              ).map(([v, l, col]) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "2rem", fontWeight: 800, color: col }}>{v}</div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>{l}</div>
                </div>
              ))}
            </div>
            <h4 style={{ fontWeight: 700, marginBottom: 8 }}>Prospects</h4>
            <ProspectsTable prospects={result.prospects || []} onMark={mark} />
          </div>

          {seq.length > 0 && (
            <div className="ig-card" style={{ padding: 18 }}>
              <h4 style={{ fontWeight: 700, marginBottom: 12 }}>📧 AI-generated email sequence ({seq.length} steps)</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {seq.map((e, i) => (
                  <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6", marginBottom: 4 }}>STEP {e.step}</div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Subject: {e.subject || ""}</div>
                    <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, color: "#374151", margin: 0, background: "#f9fafb", padding: 10, borderRadius: 6 }}>
                      {e.body || ""}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Hub shell — mode picker, recent runs, and the active mode
// ═══════════════════════════════════════════════════════════════════════════
const MODE_CARDS: { mode: Mode; icon: string; title: string; best: string; desc: string }[] = [
  {
    mode: "contacts",
    icon: "🧲",
    title: "Find Business Contacts",
    best: "Best for: building a list of decision-makers at target companies.",
    desc: "Search by industry, role, location & size across AI web research, Apollo, or both — one ranked contacts table with email, LinkedIn & score.",
  },
  {
    mode: "local",
    icon: "📍",
    title: "Find Local Businesses",
    best: "Best for: outreach to local or brick-and-mortar businesses by city.",
    desc: "Pull live Google Maps listings — name, address, phone, website, rating & reviews — for any category in any location.",
  },
  {
    mode: "outreach",
    icon: "🚀",
    title: "Autonomous Outreach Campaign",
    best: "Best for: hands-off prospecting that finds, scores & writes emails for you.",
    desc: "Launch a campaign that finds prospects, scores them, drafts an email sequence, and tracks sends, replies & meetings.",
  },
];

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function LeadGenHub() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [initial, setInitial] = useState<RunParams | null>(null);
  const [autoRun, setAutoRun] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [recent, setRecent] = useState<RecentRun[]>([]);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  const onRecord = useCallback((params: RunParams, count: number) => {
    const meta = MODE_META[params.mode];
    let sublabel = "";
    if (params.mode === "contacts") {
      sublabel = [params.role, params.industry, params.location].filter(Boolean).join(" · ") || "all contacts";
    } else if (params.mode === "local") {
      sublabel = `${params.cat} in ${params.loc}`;
    } else {
      sublabel = [params.roleTarget, params.industry].filter(Boolean).join(" · ") || params.name;
    }
    const entry: RecentRun = {
      id: `${params.mode}-${Date.now()}`,
      label: meta.title,
      sublabel,
      ts: Date.now(),
      count,
      params,
    };
    setRecent((prev) => {
      const deduped = prev.filter((r) => !(r.params.mode === params.mode && r.sublabel === sublabel));
      const next = [entry, ...deduped].slice(0, RECENT_MAX);
      saveRecent(next);
      return next;
    });
  }, []);

  function openMode(m: Mode) {
    setInitial(null);
    setAutoRun(false);
    setMode(m);
    setReplayKey((k) => k + 1);
  }

  function replay(run: RecentRun) {
    setInitial(run.params);
    setAutoRun(run.params.mode !== "outreach"); // outreach launches cost — restore only
    setMode(run.params.mode);
    setReplayKey((k) => k + 1);
  }

  function clearRecent() {
    setRecent([]);
    saveRecent([]);
  }

  const activeMeta = mode ? MODE_META[mode] : null;

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> Lead Generation
                {activeMeta && (
                  <>
                    {" "}
                    <span className="bc-sep">›</span> {activeMeta.title}
                  </>
                )}
              </div>
              <h2 className="view-title">🧲 Lead Generation</h2>
              <p className="view-sub">
                One hub for every way to source leads — find business contacts, discover local businesses, or run
                an autonomous outreach campaign. Export to CSV, push to HubSpot, or hand off to cold email.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {mode === null ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16, marginBottom: 28 }}>
              {MODE_CARDS.map((c) => (
                <button
                  key={c.mode}
                  onClick={() => openMode(c.mode)}
                  style={{
                    textAlign: "left",
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 14,
                    padding: 20,
                    cursor: "pointer",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#6366F1";
                    e.currentTarget.style.boxShadow = "0 4px 14px rgba(99,102,241,0.12)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#E5E7EB";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div style={{ fontSize: "2rem" }}>{c.icon}</div>
                  <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#0A1628" }}>{c.title}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#6366F1" }}>{c.best}</div>
                  <div style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.5 }}>{c.desc}</div>
                  <div style={{ marginTop: "auto", paddingTop: 8, fontSize: 13, fontWeight: 700, color: "#4F46E5" }}>
                    Open →
                  </div>
                </button>
              ))}
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ fontWeight: 800, fontSize: "1rem", color: "#0A1628", margin: 0 }}>Recent runs</h3>
                {recent.length > 0 && (
                  <button
                    onClick={clearRecent}
                    style={{ background: "none", border: "none", color: "#9CA3AF", fontSize: 12, cursor: "pointer" }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {recent.length === 0 ? (
                <div style={{ background: "#fff", border: "1px dashed #D1D5DB", borderRadius: 12, padding: 24, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>
                  No runs yet — pick a mode above to find your first leads. Your searches will appear here so you can jump back to them.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
                  {recent.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => replay(r)}
                      style={{
                        textAlign: "left",
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderRadius: 10,
                        padding: 14,
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{MODE_META[r.params.mode].icon}</span>
                        <span style={{ fontWeight: 700, fontSize: 13, color: "#0A1628" }}>{r.label}</span>
                        <span style={{ marginLeft: "auto", fontSize: 11, color: "#9CA3AF" }}>{timeAgo(r.ts)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.sublabel}
                      </div>
                      <div style={{ fontSize: 11, color: "#6366F1", fontWeight: 600 }}>
                        {r.count} result{r.count === 1 ? "" : "s"} · re-run →
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setMode(null)}
              style={{
                background: "none",
                border: "none",
                color: "#6366F1",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                marginBottom: 16,
                padding: 0,
              }}
            >
              ← All modes
            </button>

            {mode === "contacts" && (
              <ContactsMode
                key={`contacts-${replayKey}`}
                initial={initial && initial.mode === "contacts" ? initial : null}
                autoRun={autoRun}
                onRecord={onRecord}
              />
            )}
            {mode === "local" && (
              <LocalMode
                key={`local-${replayKey}`}
                initial={initial && initial.mode === "local" ? initial : null}
                autoRun={autoRun}
                onRecord={onRecord}
              />
            )}
            {mode === "outreach" && (
              <OutreachMode
                key={`outreach-${replayKey}`}
                initial={initial && initial.mode === "outreach" ? initial : null}
                onRecord={onRecord}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

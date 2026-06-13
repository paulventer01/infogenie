"use client";

// Native React port of the legacy `local-leads` panel (was
// `window.buildLocalLeads` + `#view-local-leads` in index.html, built in
// public/js/ig_apify.js). Pulls live Google Maps business leads via Apify
// against the existing Express API:
//   POST /api/apify/maps-leads        — start the scrape (returns run_id/dataset_id)
//   GET  /api/apify/run-status        — poll every 8s until the run completes
//   POST /api/hubspot/create-company  — push found businesses into HubSpot
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

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
  openingHours?: string[];
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

type StatusKind = "idle" | "spinner" | "error" | "success" | "info" | "nokey";
interface Status {
  kind: StatusKind;
  msg: string;
}

const POLL_MAX = 40;
const POLL_INTERVAL = 8000;

const ALERT_COLORS: Record<string, [string, string]> = {
  error: ["#FEE2E2", "#991B1B"],
  success: ["#D1FAE5", "#065F46"],
  info: ["#EFF6FF", "#1E40AF"],
};

function fmt(n: number | string | undefined): string {
  const v = parseInt(String(n ?? "0"), 10) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return String(v);
}

function stars(r: number): string {
  const full = Math.round(r || 0);
  return "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full));
}

function Spinner({ msg }: { msg: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}>
      <div
        style={{
          width: 16,
          height: 16,
          border: "2px solid var(--ig-primary,#667eea)",
          borderTopColor: "transparent",
          borderRadius: "50%",
          animation: "_apSpin 0.8s linear infinite",
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{msg}</span>
      <style>{"@keyframes _apSpin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}

function NoKeyBanner() {
  return (
    <div
      style={{
        background: "linear-gradient(135deg,#EEF2FF,#F5F3FF)",
        border: "1px solid #C7D2FE",
        borderRadius: 12,
        padding: 24,
        textAlign: "center",
        margin: "16px 0",
      }}
    >
      <div style={{ fontSize: "2rem", marginBottom: 8 }}>🔑</div>
      <div style={{ fontWeight: 700, fontSize: "1rem", color: "#1E1B4B", marginBottom: 6 }}>
        APIFY_API_KEY required
      </div>
      <div style={{ fontSize: "0.85rem", color: "#6B7280", maxWidth: 400, margin: "0 auto 16px" }}>
        Local Lead Finder uses Apify&apos;s web scraping platform. Add your free Apify API key to
        unlock it.
      </div>
      <a
        href="https://console.apify.com/sign-up"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-block",
          padding: "10px 22px",
          background: "#667eea",
          color: "#fff",
          borderRadius: 8,
          fontWeight: 700,
          fontSize: "0.85rem",
          textDecoration: "none",
        }}
      >
        Get Free Apify Key →
      </a>
      <div style={{ fontSize: "0.75rem", color: "#9CA3AF", marginTop: 10 }}>
        Then add it in <strong>Settings → Integrations → Apify</strong>
      </div>
    </div>
  );
}

function StatusBox({ status }: { status: Status }) {
  if (status.kind === "idle") return null;
  if (status.kind === "spinner") return <Spinner msg={status.msg} />;
  if (status.kind === "nokey") return <NoKeyBanner />;
  const [bg, fg] = ALERT_COLORS[status.kind] || ALERT_COLORS.info;
  return (
    <div style={{ background: bg, color: fg, padding: "10px 14px", borderRadius: 8, fontSize: "0.84rem" }}>
      {status.msg}
    </div>
  );
}

export default function LocalLeads() {
  const [cat, setCat] = useState("");
  const [loc, setLoc] = useState("");
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState<Status>({ kind: "idle", msg: "" });
  const [running, setRunning] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [leads, setLeads] = useState<MapsLead[] | null>(null);
  const [query, setQuery] = useState("");

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  function poll(runId: string, datasetId: string, attempts: number, q: string) {
    if (attempts >= POLL_MAX) {
      setStatus({
        kind: "error",
        msg: "Apify timed out — the scraper took too long. Try a smaller result count.",
      });
      setRunning(false);
      return;
    }
    pollRef.current = setTimeout(async () => {
      if (cancelledRef.current) return;
      const url = `/api/apify/run-status?run_id=${encodeURIComponent(runId)}&dataset_id=${encodeURIComponent(datasetId)}&limit=${limit}`;
      const d = await apiGet<RunStatusResult>(url);
      if (cancelledRef.current) return;
      if (d.error) {
        setStatus({ kind: "error", msg: d.error });
        setRunning(false);
        return;
      }
      if (d.status === "failed") {
        setStatus({ kind: "error", msg: "Scrape failed: " + (d.error || "unknown") });
        setRunning(false);
        return;
      }
      if (d.status === "pending") {
        setStatus({
          kind: "spinner",
          msg: `Still running… attempt ${attempts + 1}/${POLL_MAX} (${(attempts + 1) * 8}s elapsed)`,
        });
        poll(runId, datasetId, attempts + 1, q);
        return;
      }
      const items = d.items || [];
      setStatus({ kind: "success", msg: `✓ Scraped ${items.length} results` });
      setLeads(items);
      setQuery(q);
      setRunning(false);
    }, POLL_INTERVAL);
  }

  async function run() {
    const c = cat.trim();
    const l = loc.trim();
    if (!c || !l) {
      setStatus({ kind: "error", msg: "Category and location are both required" });
      return;
    }
    const q = `${c} in ${l}`;
    setLeads(null);
    setQuery(q);
    setRunning(true);
    cancelledRef.current = false;
    setStatus({ kind: "spinner", msg: `Starting Google Maps scrape for "${q}"…` });
    const d = await apiPost<MapsStartResult>("/api/apify/maps-leads", { query: q, limit });
    if (!d.ok) {
      if (d.error?.includes("APIFY_API_KEY")) setStatus({ kind: "nokey", msg: "" });
      else setStatus({ kind: "error", msg: d.error || "Failed to start" });
      setRunning(false);
      return;
    }
    setStatus({ kind: "spinner", msg: "Maps scrape running… checking every 8s (usually 45-120s)" });
    poll(d.run_id || "", d.dataset_id || "", 0, q);
  }

  function copyLead(b: MapsLead) {
    const name = b.title || b.name || "";
    const addr = b.address || b.vicinity || "";
    const phone = b.phone || b.phoneUnformatted || "";
    const website = b.website || "";
    const text = [name, addr, phone, website].filter(Boolean).join("\n");
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  function exportCsv() {
    if (!leads) return;
    const rows: string[][] = [["Name", "Category", "Address", "Phone", "Website", "Rating", "Reviews"]];
    leads.forEach((b) => {
      rows.push([
        '"' + String(b.title || b.name || "").replace(/"/g, '""') + '"',
        '"' +
          String((Array.isArray(b.categories) ? b.categories[0] : b.categoryName) || "").replace(
            /"/g,
            '""',
          ) +
          '"',
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
  }

  async function pushHubSpot() {
    if (!leads || !leads.length) return;
    setPushing(true);
    let ok = 0;
    let fail = 0;
    for (const b of leads.slice(0, 20)) {
      const name = b.title || b.name || "Unknown";
      const r = await apiPost("/api/hubspot/create-company", {
        name,
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
    setStatus({
      kind: ok > 0 ? "success" : "error",
      msg: `Pushed to HubSpot: ${ok} companies created${fail ? " · " + fail + " failed" : ""}`,
    });
  }

  const stat = leads
    ? {
        withPhone: leads.filter((b) => b.phone || b.phoneUnformatted).length,
        withWebsite: leads.filter((b) => b.website).length,
      }
    : null;

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> Local Lead
                Finder
              </div>
              <h2 className="view-title">📍 Local Lead Finder</h2>
              <p className="view-sub">
                Pull live business leads from Google Maps — name, address, phone, website, rating.
                Export CSV or push to HubSpot.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div className="ig-card" style={{ marginBottom: 20 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr auto auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
              <label className="ig-label">Business Category</label>
              <input
                className="ig-input"
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                placeholder="e.g. dentists, gyms, coffee shops"
              />
            </div>
            <div>
              <label className="ig-label">Location</label>
              <input
                className="ig-input"
                value={loc}
                onChange={(e) => setLoc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                placeholder="e.g. Miami FL, London UK, Toronto"
              />
            </div>
            <div>
              <label className="ig-label">Limit</label>
              <select
                className="ig-select"
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value, 10) || 20)}
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="30">30</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={run} disabled={running}>
              {running ? "⏳ Starting…" : "🗺 Find Leads"}
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            <StatusBox status={status} />
          </div>
        </div>

        {leads && stat && (
          <div>
            {leads.length === 0 ? (
              <StatusBox
                status={{
                  kind: "info",
                  msg: "No businesses found — try a broader category or different location",
                }}
              />
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3,1fr)",
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  {(
                    [
                      ["📍", `${leads.length} Businesses`, "Found"],
                      ["📞", `${stat.withPhone} / ${leads.length}`, "With Phone"],
                      ["🌐", `${stat.withWebsite} / ${leads.length}`, "With Website"],
                    ] as [string, string, string][]
                  ).map(([ic, v, l]) => (
                    <div
                      key={l}
                      style={{
                        background: "var(--bg-card,#fff)",
                        border: "1px solid #E5E7EB",
                        borderRadius: 10,
                        padding: 14,
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: "1.4rem" }}>{ic}</div>
                      <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#0A1628" }}>{v}</div>
                      <div style={{ fontSize: "0.72rem", color: "#9CA3AF" }}>{l}</div>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#0A1628" }}>
                    Results for &quot;<span style={{ color: "#667eea" }}>{query}</span>&quot;
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: "0.78rem" }}
                      onClick={exportCsv}
                    >
                      ⬇ Export CSV
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: "0.78rem" }}
                      onClick={pushHubSpot}
                      disabled={pushing}
                    >
                      {pushing ? "⏳ Pushing…" : "→ HubSpot"}
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(255px,1fr))",
                    gap: 12,
                  }}
                >
                  {leads.map((b, i) => {
                    const name = b.title || b.name || "";
                    const addr = b.address || b.vicinity || "";
                    const phone = b.phone || b.phoneUnformatted || "";
                    const website = b.website || "";
                    const rating = parseFloat(String(b.totalScore ?? b.rating ?? "")) || 0;
                    const reviews = parseInt(String(b.reviewsCount ?? b.userRatingsTotal ?? ""), 10) || 0;
                    const category =
                      (Array.isArray(b.categories) ? b.categories[0] : b.categoryName) || "";
                    const hours = b.openingHours?.join(", ") || "";
                    const mapUrl = b.url || "";
                    return (
                      <div
                        key={i}
                        style={{
                          background: "var(--bg-card,#fff)",
                          border: "1px solid #E5E7EB",
                          borderRadius: 10,
                          padding: 14,
                        }}
                      >
                        <div
                          style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1E1B4B", marginBottom: 2 }}
                        >
                          {name}
                        </div>
                        {category && (
                          <div
                            style={{
                              fontSize: "0.7rem",
                              color: "#9CA3AF",
                              marginBottom: 6,
                              textTransform: "capitalize",
                            }}
                          >
                            {category}
                          </div>
                        )}
                        {rating > 0 && (
                          <div
                            style={{ color: "#F59E0B", fontSize: "0.82rem", marginBottom: 5 }}
                            title={`${rating.toFixed(1)} stars, ${reviews} reviews`}
                          >
                            {stars(rating)}{" "}
                            <span style={{ color: "#6B7280", fontSize: "0.72rem" }}>
                              {rating.toFixed(1)} ({fmt(reviews)})
                            </span>
                          </div>
                        )}
                        {addr && (
                          <div style={{ fontSize: "0.78rem", color: "#374151", marginBottom: 3 }}>
                            📍 {addr}
                          </div>
                        )}
                        {phone && (
                          <div style={{ fontSize: "0.78rem", color: "#374151", marginBottom: 3 }}>
                            📞{" "}
                            <a href={`tel:${phone}`} style={{ color: "#0066FF" }}>
                              {phone}
                            </a>
                          </div>
                        )}
                        {website && (
                          <div style={{ fontSize: "0.78rem", marginBottom: 6 }}>
                            🌐{" "}
                            <a
                              href={website}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "#0066FF" }}
                            >
                              {website.replace(/^https?:\/\//, "").slice(0, 38)}
                            </a>
                          </div>
                        )}
                        {hours && (
                          <div
                            style={{ fontSize: "0.7rem", color: "#9CA3AF", marginBottom: 8 }}
                            title={hours}
                          >
                            🕐 {hours.slice(0, 60)}
                            {hours.length > 60 ? "…" : ""}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                          {mapUrl && (
                            <a
                              href={mapUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-secondary"
                              style={{ fontSize: "0.7rem", padding: "4px 10px" }}
                            >
                              🗺 Maps
                            </a>
                          )}
                          {website && (
                            <a
                              href={website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-secondary"
                              style={{ fontSize: "0.7rem", padding: "4px 10px" }}
                            >
                              🌐 Site
                            </a>
                          )}
                          <button
                            onClick={() => copyLead(b)}
                            className="btn btn-secondary"
                            style={{ fontSize: "0.7rem", padding: "4px 10px" }}
                          >
                            📋 Copy
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

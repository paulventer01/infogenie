"use client";

// Native React port of the legacy `lead-finder` panel (was
// `window.buildLeadFinder` + `_lfGo`/`_lfExportCsv` in app.js +
// `#view-lead-finder`). Searches Apollo's B2B contact database by ICP filters
// (title, seniority, location, company size) via the existing Express API
// (`POST /api/lead-finder/search`) and exports matched leads to CSV client-side.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { goToView } from "@/lib/nav";

const SENIORITIES = ["c_suite", "vp", "director", "head", "manager", "senior"];

interface Lead {
  name?: string;
  title?: string;
  company?: string;
  company_domain?: string;
  company_size?: number | string;
  company_industry?: string;
  location?: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  photo_url?: string;
}

interface SearchResponse {
  ok: boolean;
  error?: string;
  note?: string;
  leads?: Lead[];
  total?: number;
}

function safeUrl(u?: string): string {
  if (!u) return "#";
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "#";
  } catch {
    return "#";
  }
}

export default function LeadFinder() {
  const toast = useToast();
  const router = useRouter();
  const [titles, setTitles] = useState("");
  const [seniorities, setSeniorities] = useState<string[]>([]);
  const [locations, setLocations] = useState("");
  const [minSize, setMinSize] = useState("");
  const [maxSize, setMaxSize] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);

  async function go() {
    const titleList = titles.split(",").map((s) => s.trim()).filter(Boolean);
    const locList = locations.split(",").map((s) => s.trim()).filter(Boolean);
    const company_size_min = parseInt(minSize, 10) || null;
    const company_size_max = parseInt(maxSize, 10) || null;
    if (!titleList.length && !seniorities.length) {
      toast("⚠️ Enter at least one title or seniority");
      return;
    }
    setStatus("loading");
    setMessage("");
    setLeads([]);
    try {
      const r = await apiPost<SearchResponse>("/api/lead-finder/search", {
        titles: titleList,
        seniorities,
        locations: locList,
        company_size_min,
        company_size_max,
        per_page: 10,
      });
      if (!r.ok) throw new Error(r.error || "failed");
      if (r.note) {
        setStatus("done");
        setMessage(r.note);
        return;
      }
      const found = r.leads || [];
      if (!found.length) {
        setStatus("done");
        setMessage("No leads matched these filters. Try broader criteria.");
        return;
      }
      setLeads(found);
      setTotal(r.total || 0);
      setStatus("done");
      setMessage("");
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "error");
    }
  }

  function sendToColdEmail(l: Lead) {
    const pain = [l.company_industry, l.title].filter(Boolean).join(" / ");
    (window as Window & typeof globalThis & { _cePreset?: { target_company?: string; target_role?: string; target_pain?: string } | null })._cePreset = {
      target_company: l.company || "",
      target_role: l.title || "",
      target_pain: pain,
    };
    goToView(router, "cold-email");
  }

  function exportCsv() {
    if (!leads.length) return;
    const cols: (keyof Lead)[] = [
      "name",
      "title",
      "company",
      "company_domain",
      "company_size",
      "company_industry",
      "location",
      "email",
      "email_status",
      "linkedin_url",
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
    a.download = `leads-${Date.now()}.csv`;
    a.click();
    toast("✅ CSV downloaded");
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> B2B Lead Finder
              </div>
              <h2 className="view-title">🎯 B2B Lead Finder</h2>
              <p className="view-sub">
                Search Apollo&apos;s 275M+ contact database for prospects matching
                your ICP — by job title, seniority, location, industry, and company
                size.
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>
                Job titles (comma-sep)
              </label>
              <input
                value={titles}
                onChange={(e) => setTitles(e.target.value)}
                placeholder="VP Marketing, Head of Growth, CMO"
                style={{ width: "100%", padding: "9px 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.86rem", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>
                Seniorities
              </label>
              <select
                multiple
                size={3}
                value={seniorities}
                onChange={(e) =>
                  setSeniorities(Array.from(e.target.selectedOptions).map((o) => o.value))
                }
                style={{ width: "100%", padding: 6, border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.82rem", boxSizing: "border-box" }}
              >
                {SENIORITIES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>
                Locations (comma-sep)
              </label>
              <input
                value={locations}
                onChange={(e) => setLocations(e.target.value)}
                placeholder="United States, United Kingdom"
                style={{ width: "100%", padding: "9px 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.86rem", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>
                Company size
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="number"
                  value={minSize}
                  onChange={(e) => setMinSize(e.target.value)}
                  placeholder="min"
                  style={{ flex: 1, padding: "9px 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.86rem", boxSizing: "border-box" }}
                />
                <input
                  type="number"
                  value={maxSize}
                  onChange={(e) => setMaxSize(e.target.value)}
                  placeholder="max"
                  style={{ flex: 1, padding: "9px 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.86rem", boxSizing: "border-box" }}
                />
              </div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: "0.74rem", color: "#9CA3AF" }}>
              Powered by Apollo.io · 275M+ B2B contacts · per request: 10 leads
            </div>
            <button
              onClick={go}
              style={{
                padding: "10px 22px",
                background: "#6366F1",
                border: "2px solid #6366F1",
                borderRadius: 8,
                fontSize: "0.84rem",
                fontWeight: 800,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              🎯 Find Leads
            </button>
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 20, color: "#6B7280" }}>
              ⏳ Searching Apollo for matching prospects…
            </div>
          )}
          {status === "error" && (
            <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10 }}>{message}</div>
          )}
          {status === "done" && message && (
            <div style={{ background: "#FEF3C7", color: "#92400E", padding: 14, borderRadius: 10 }}>{message}</div>
          )}
          {status === "done" && !message && leads.length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 800, color: "#0A1628" }}>
                  🎯 {leads.length} leads · {(total || 0).toLocaleString()} total matches in Apollo
                </div>
                <button
                  onClick={exportCsv}
                  style={{ padding: "7px 14px", background: "#fff", border: "1.5px solid #6366F1", borderRadius: 6, color: "#6366F1", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}
                >
                  📥 Export CSV
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(380px,1fr))", gap: 12 }}>
                {leads.map((l, i) => (
                  <div key={i} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      {l.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={safeUrl(l.photo_url)}
                          alt=""
                          style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#6366F1", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, flexShrink: 0 }}>
                          {(l.name || "?").charAt(0)}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.95rem" }}>{l.name || "(no name)"}</div>
                        <div style={{ fontSize: "0.78rem", color: "#374151" }}>{l.title || ""}</div>
                        <div style={{ fontSize: "0.78rem", color: "#6366F1", fontWeight: 700, marginTop: 2 }}>
                          {l.company || ""}
                          {l.company_size ? ` · ${l.company_size} emp` : ""}
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 5, fontSize: "0.7rem" }}>
                      {l.location && (
                        <span style={{ background: "#F3F4F6", color: "#374151", padding: "2px 7px", borderRadius: 4 }}>📍 {l.location}</span>
                      )}
                      {l.company_industry && (
                        <span style={{ background: "#EDE9FE", color: "#5B21B6", padding: "2px 7px", borderRadius: 4 }}>{l.company_industry}</span>
                      )}
                      {l.email_status === "verified" ? (
                        <span style={{ background: "#D1FAE5", color: "#065F46", padding: "2px 7px", borderRadius: 4 }}>✓ email verified</span>
                      ) : l.email ? (
                        <span style={{ background: "#FEF3C7", color: "#92400E", padding: "2px 7px", borderRadius: 4 }}>{l.email_status}</span>
                      ) : null}
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {l.linkedin_url && (
                        <a href={safeUrl(l.linkedin_url)} target="_blank" rel="noopener noreferrer" style={{ padding: "5px 10px", background: "#0A66C2", color: "#fff", borderRadius: 5, fontSize: "0.72rem", fontWeight: 700, textDecoration: "none" }}>
                          in LinkedIn
                        </a>
                      )}
                      {l.company_domain && (
                        <a
                          href={safeUrl("https://" + l.company_domain.replace(/^https?:\/\//, ""))}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ padding: "5px 10px", background: "#fff", border: "1.5px solid #D1D5DB", color: "#374151", borderRadius: 5, fontSize: "0.72rem", fontWeight: 700, textDecoration: "none" }}
                        >
                          🌐 Site
                        </a>
                      )}
                      <button
                        onClick={() => sendToColdEmail(l)}
                        style={{ padding: "5px 10px", background: "#EDE9FE", border: "1.5px solid #6366F1", color: "#4F46E5", borderRadius: 5, fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}
                      >
                        ✉ Write cold email
                      </button>
                    </div>
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

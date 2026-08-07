"use client";

// Native React port of the legacy `hubspot-sync` panel (was
// `window.buildHubspotSync` + `#view-hubspot-sync` in index.html, built in
// public/js/ig_intel_pack_a.js). Pushes leads and influencers into HubSpot via
// the existing Express API:
//   POST /api/hubspot-sync/test             — test connection
//   POST /api/hubspot-sync/push-lead        — push a single contact
//   POST /api/hubspot-sync/push-bulk        — push the last Lead Finder run
//   GET  /api/hubspot-sync/recent-contacts  — list recent HubSpot contacts
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

interface HsContact {
  firstname?: string;
  lastname?: string;
  email?: string;
  jobtitle?: string;
  company?: string;
  lifecyclestage?: string;
  createdate?: string;
}

interface RecentResult {
  ok: boolean;
  error?: string;
  contacts?: HsContact[];
}

interface TestResult {
  ok: boolean;
  error?: string;
  message?: string;
}

interface PushResult {
  ok: boolean;
  error?: string;
  action?: string;
  contact_id?: string | number;
}

interface BulkResult {
  ok: boolean;
  error?: string;
  pushed?: number;
  total_attempted?: number;
}

interface CachedLead {
  [key: string]: unknown;
}

export default function HubspotSync() {
  const [contacts, setContacts] = useState<HsContact[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");

  async function loadRecent() {
    setLoading(true);
    setLoadError("");
    const r = await apiGet<RecentResult>("/api/hubspot-sync/recent-contacts?limit=15");
    setLoading(false);
    if (!r.ok) {
      setLoadError(r.error || "request failed");
      setContacts(null);
      return;
    }
    setContacts(r.contacts || []);
  }

  useEffect(() => {
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function test() {
    showToast("⏳ Testing HubSpot…");
    const r = await apiPost<TestResult>("/api/hubspot-sync/test");
    showToast(r.ok ? "✅ " + (r.message || "") : "❌ " + (r.error || ""));
  }

  async function pushOne() {
    const lead = { name, email, title, company };
    if (!lead.name && !lead.email) {
      showToast("⚠️ Name or email required");
      return;
    }
    const r = await apiPost<PushResult>("/api/hubspot-sync/push-lead", { lead });
    if (!r.ok) {
      showToast("❌ " + (r.error || ""));
      return;
    }
    showToast("✅ Contact " + r.action + " (id " + r.contact_id + ")");
    setName("");
    setEmail("");
    setTitle("");
    setCompany("");
    loadRecent();
  }

  async function bulkFromLeads() {
    const cached =
      (window as unknown as { _lfLeads?: CachedLead[] })._lfLeads || [];
    if (!cached.length) {
      showToast("⚠️ No leads cached. Run a B2B Lead Finder search first.");
      return;
    }
    showToast(`⏳ Pushing ${cached.length} leads…`);
    const r = await apiPost<BulkResult>("/api/hubspot-sync/push-bulk", {
      leads: cached.map((l) => ({ ...l, _source: "b2b_lead_finder" })),
    });
    if (!r.ok) {
      showToast("❌ " + (r.error || ""));
      return;
    }
    showToast(`✅ Pushed ${r.pushed}/${r.total_attempted} to HubSpot`);
    loadRecent();
  }

  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    border: "1px solid #D1D5DB",
    borderRadius: 6,
    fontSize: "0.82rem",
  };

  const th: React.CSSProperties = { padding: "9px 12px", fontSize: "0.7rem", color: "#6B7280" };

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> HubSpot Sync
              </div>
              <h2 className="view-title">🔄 HubSpot Sync</h2>
              <p className="view-sub">
                Push leads from B2B Lead Finder + influencers from your CRM straight into HubSpot.
                Auto-dedups by email, supports bulk upsert (50/batch), and sees recent contacts at a
                glance.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "linear-gradient(135deg,#FF7A59 0%,#FF5C35 100%)",
            color: "#fff",
            borderRadius: 12,
            padding: "18px 22px",
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>🔄 HubSpot CRM</div>
            <div style={{ fontSize: "0.82rem", opacity: 0.92, marginTop: 2 }}>
              Push prospects + influencers as contacts. Auto-dedups by email, syncs lifecycle stage =
              lead.
            </div>
          </div>
          <button
            onClick={test}
            style={{
              padding: "8px 16px",
              background: "rgba(255,255,255,.18)",
              border: "2px solid rgba(255,255,255,.35)",
              color: "#fff",
              WebkitTextFillColor: "#fff",
              borderRadius: 8,
              fontWeight: 800,
              cursor: "pointer",
              fontSize: "0.82rem",
            }}
          >
            ⚡ Test connection
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <div style={{ fontWeight: 800, color: "#0A1628", marginBottom: 10 }}>
              📥 Sync from Lead Finder
            </div>
            <p style={{ margin: "0 0 10px", color: "#6B7280", fontSize: "0.82rem" }}>
              Run a B2B Lead Finder search first, then click below to push the most recent run into
              HubSpot.
            </p>
            <button
              onClick={bulkFromLeads}
              style={{
                padding: "10px 16px",
                background: "#F97316",
                border: "2px solid #F97316",
                borderRadius: 8,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                fontWeight: 800,
                cursor: "pointer",
                fontSize: "0.84rem",
                width: "100%",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              → Push last lead-finder run
            </button>
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <div style={{ fontWeight: 800, color: "#0A1628", marginBottom: 10 }}>
              ✏️ Push single contact
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                style={inputStyle}
              />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@company.com"
                style={inputStyle}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Job title"
                style={inputStyle}
              />
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Company"
                style={inputStyle}
              />
            </div>
            <button
              onClick={pushOne}
              style={{
                padding: "9px 14px",
                background: "#F97316",
                border: "2px solid #F97316",
                borderRadius: 6,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                fontWeight: 800,
                cursor: "pointer",
                fontSize: "0.82rem",
                width: "100%",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              → Push to HubSpot
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <h3 style={{ margin: 0, color: "#0A1628", fontSize: "1.05rem" }}>Recent HubSpot contacts</h3>
          <button
            onClick={loadRecent}
            style={{
              padding: "7px 14px",
              background: "#fff",
              border: "1.5px solid #F97316",
              color: "#F97316",
              borderRadius: 6,
              fontSize: "0.78rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ↻ Refresh
          </button>
        </div>

        <div>
          {loading && <div style={{ color: "#6B7280", padding: 14 }}>⏳ Loading…</div>}

          {!loading && loadError && (
            <div
              style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10 }}
            >
              {loadError}
            </div>
          )}

          {!loading && !loadError && contacts && contacts.length === 0 && (
            <div
              style={{
                background: "#F9FAFB",
                border: "1px dashed #D1D5DB",
                borderRadius: 10,
                padding: 30,
                textAlign: "center",
                color: "#6B7280",
              }}
            >
              No contacts in HubSpot yet.
            </div>
          )}

          {!loading && !loadError && contacts && contacts.length > 0 && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                <thead>
                  <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                    <th style={th}>Name</th>
                    <th style={th}>Email</th>
                    <th style={th}>Title</th>
                    <th style={th}>Company</th>
                    <th style={th}>Stage</th>
                    <th style={th}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "9px 12px", color: "#0A1628", fontWeight: 600 }}>
                        {(c.firstname || "") + " " + (c.lastname || "")}
                      </td>
                      <td style={{ padding: "9px 12px", color: "#374151", fontSize: "0.78rem" }}>
                        {c.email || ""}
                      </td>
                      <td style={{ padding: "9px 12px", color: "#6B7280", fontSize: "0.78rem" }}>
                        {c.jobtitle || ""}
                      </td>
                      <td style={{ padding: "9px 12px", color: "#6B7280", fontSize: "0.78rem" }}>
                        {c.company || ""}
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        <span
                          style={{
                            background: "#FEF3C7",
                            color: "#92400E",
                            padding: "2px 7px",
                            borderRadius: 4,
                            fontSize: "0.7rem",
                            fontWeight: 700,
                          }}
                        >
                          {c.lifecyclestage || "lead"}
                        </span>
                      </td>
                      <td style={{ padding: "9px 12px", color: "#9CA3AF", fontSize: "0.74rem" }}>
                        {c.createdate ? new Date(c.createdate).toLocaleDateString() : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

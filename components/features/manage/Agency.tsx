"use client";

// Native React port of the legacy `agency` panel (was `window.buildAgency`
// in public/js/ig_reach_automation.js + `#view-agency`). Agency Hub: a
// multi-tab (Clients / Reports / Scheduled Sends / White-label) workspace for
// managing client accounts, generating branded reports and scheduling sends.
// Client/report/brand/schedule state is client-side (matching the legacy
// panel's window globals + seeded demo clients). Report generation hits the
// same Express endpoint (`POST /api/agency-report`) via lib/api. Add/edit
// client, generate-report and report-preview modals are ported to React
// overlays (replacing the legacy DOM-built modals + window.open preview).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";
import { useToast } from "@/hooks/useToast";
import { apiPost } from "@/lib/api";

interface Client {
  id: string;
  name: string;
  domain: string;
  industry: string;
  contact: string;
  email: string;
  budget: number;
  status: string;
  campaigns: number;
  addedDate: string;
  lastReport: string;
  freq: string;
  color: string;
  revenue: number;
}

interface ReportContent {
  executive_summary?: string;
  kpis?: { reach?: string; roas?: string; ctr?: string; conversions?: string };
  campaign_performance?: string;
  competitor_intel?: string;
  social_metrics?: string;
  recommendations?: string;
}

interface AgencyReport {
  id: string;
  clientId: string;
  generatedAt: string;
  type: string;
  status: string;
  content: ReportContent;
}

interface Brand {
  name: string;
  color: string;
  footer: string;
  reportFreq: string;
}

const SEED_CLIENTS: Client[] = [
  { id: "cl1", name: "TechFlow Solutions", domain: "techflow.io", industry: "SaaS", contact: "Sarah Chen", email: "sarah@techflow.io", budget: 4500, status: "active", campaigns: 3, addedDate: "12 Jan 2026", lastReport: "15 Mar 2026", freq: "monthly", color: "#6366F1", revenue: 12400 },
  { id: "cl2", name: "BrightShop Retail", domain: "brightshop.com", industry: "eCommerce", contact: "Marcus Webb", email: "marcus@brightshop.com", budget: 2800, status: "active", campaigns: 5, addedDate: "3 Feb 2026", lastReport: "1 Apr 2026", freq: "weekly", color: "#059669", revenue: 8700 },
  { id: "cl3", name: "Nova Fintech", domain: "novafintech.co", industry: "Fintech", contact: "Priya Patel", email: "priya@novafintech.co", budget: 7200, status: "active", campaigns: 4, addedDate: "20 Jan 2026", lastReport: "8 Apr 2026", freq: "monthly", color: "#DC2626", revenue: 21000 },
];

const COLORS = ["#6366F1", "#059669", "#DC2626", "#D97706", "#0066FF", "#7C3AED", "#0A66C2", "#E1306C"];
const INDUSTRIES = ["SaaS", "eCommerce", "Fintech", "Health & Wellness", "Real Estate", "Education", "Agency", "Retail", "B2B Services", "Travel"];

const TABS = [
  { id: "clients", icon: "👥", label: "Clients" },
  { id: "reports", icon: "📊", label: "Reports" },
  { id: "schedule", icon: "📅", label: "Scheduled Sends" },
  { id: "whitelabel", icon: "🎨", label: "White-label" },
] as const;

function dateStr() {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

interface ClientForm {
  name: string;
  domain: string;
  contact: string;
  email: string;
  budget: string;
  industry: string;
  color: string;
  freq: string;
}

export default function Agency() {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<string>("clients");
  const [clients, setClients] = useState<Client[]>(SEED_CLIENTS);
  const [reports, setReports] = useState<AgencyReport[]>([]);
  const [schedules, setSchedules] = useState<Record<string, boolean>>({});
  const [brand, setBrand] = useState<Brand>({ name: "My Agency", color: "#6366F1", footer: "Prepared exclusively for {client} by {agency}", reportFreq: "monthly" });

  const [clientModal, setClientModal] = useState<{ editId: string | null } | null>(null);
  const [genModal, setGenModal] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const totalRevenue = clients.reduce((a, c) => a + c.revenue, 0);
  const totalBudget = clients.reduce((a, c) => a + c.budget, 0);
  const activeClients = clients.filter((c) => c.status === "active").length;

  async function generateClientReport(clientId: string) {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    toast(`⏳ Generating report for ${c.name}…`);
    const data = await apiPost<{ ok: boolean } & ReportContent>("/api/agency-report", {
      clientName: c.name, domain: c.domain, industry: c.industry, budget: c.budget, agencyName: brand.name,
    });
    if (!data || data.ok === false) {
      toast("⚠️ Report generation failed — please retry");
      return;
    }
    const rId = "rpt_" + Date.now();
    setReports((prev) => [...prev, { id: rId, clientId, generatedAt: new Date().toLocaleString(), type: "Full Report", status: "draft", content: data }]);
    setClients((prev) => prev.map((x) => (x.id === clientId ? { ...x, lastReport: dateStr() } : x)));
    toast(`✅ Report for ${c.name} ready — view in Reports tab`);
    setTab("reports");
  }

  function switchToClient(id: string) {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    toast(`🔄 Switched to ${c.name} — all views now show ${c.name}'s data`);
    goToView(router, "dashboard");
  }

  function saveClient(form: ClientForm, editId: string | null) {
    if (!form.name.trim()) {
      toast("⚠️ Please enter a client name");
      return;
    }
    if (editId) {
      setClients((prev) => prev.map((c) => (c.id === editId ? {
        ...c, name: form.name.trim(), domain: form.domain.trim(), contact: form.contact.trim(),
        email: form.email.trim(), budget: +form.budget || 0, industry: form.industry, freq: form.freq, color: form.color,
      } : c)));
      toast("✅ Client updated");
    } else {
      setClients((prev) => [...prev, {
        id: "cl" + Date.now(), name: form.name.trim(), domain: form.domain.trim(), contact: form.contact.trim(),
        email: form.email.trim(), budget: +form.budget || 0, industry: form.industry, freq: form.freq, color: form.color,
        status: "active", campaigns: 0, addedDate: dateStr(), lastReport: "—", revenue: 0,
      }]);
      toast("✅ Client added!");
    }
    setClientModal(null);
  }

  function toggleSchedule(clientId: string) {
    const enabled = schedules[clientId] !== false;
    setSchedules((prev) => ({ ...prev, [clientId]: !enabled ? true : false }));
    const c = clients.find((x) => x.id === clientId);
    toast(!enabled ? `📅 Scheduled sends enabled for ${c?.name}` : `⏸ Scheduled sends paused for ${c?.name}`);
  }

  function updateClientFreq(clientId: string, freq: string) {
    setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, freq } : c)));
    const c = clients.find((x) => x.id === clientId);
    if (c) toast(`✅ ${c.name} report frequency set to ${freq}`);
  }

  function sendReportToClient(rId: string) {
    const r = reports.find((x) => x.id === rId);
    if (!r) return;
    const c = clients.find((x) => x.id === r.clientId) || { name: "Client", email: "—" };
    setReports((prev) => prev.map((x) => (x.id === rId ? { ...x, status: "sent" } : x)));
    toast(`📤 Report marked as sent to ${"email" in c ? c.email : "—"}`);
  }

  const tabBar = (
    <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #E5E7EB", marginBottom: 24, background: "white", borderRadius: "14px 14px 0 0", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          style={{ flex: 1, padding: "14px 8px", border: "none", borderBottom: `3px solid ${tab === t.id ? "#6366F1" : "transparent"}`, background: tab === t.id ? "#EEF2FF" : "white", fontSize: "0.8rem", fontWeight: tab === t.id ? 800 : 600, color: tab === t.id ? "#4F46E5" : "#6B7280", cursor: "pointer", transition: "all .15s" }}
        >
          {t.icon} {t.label}
        </button>
      ))}
    </div>
  );

  const hero = (
    <div style={{ background: "linear-gradient(135deg,#312E81,#4338CA,#6366F1)", borderRadius: 20, padding: "28px 32px", marginBottom: 24, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -40, right: -40, width: 220, height: 220, background: "rgba(255,255,255,.05)", borderRadius: "50%" }} />
      <div style={{ position: "absolute", bottom: -60, right: 100, width: 160, height: 160, background: "rgba(255,255,255,.04)", borderRadius: "50%" }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "0.6rem", fontWeight: 800, color: "#C7D2FE", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 3 }}>Grow › Agency</div>
          <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#DDD6FE", textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 6 }}>Agency Hub · {brand.name}</div>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.65rem", fontWeight: 800, color: "#FFFFFF", lineHeight: 1.2, marginBottom: 8, textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>
            Manage Every Client.<br />Deliver Branded Results.
          </div>
          <div style={{ fontSize: "0.84rem", color: "rgba(255,255,255,0.92)", maxWidth: 460, lineHeight: 1.55 }}>
            Run InfoGenie for multiple clients from one dashboard. Generate white-label reports, schedule automatic sends, and switch context in one click.
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          {([
            ["👥", "Clients", activeClients],
            ["💰", "Managed Budget", "$" + totalBudget.toLocaleString()],
            ["📈", "Client Revenue", "$" + totalRevenue.toLocaleString()],
            ["📋", "Reports", reports.length],
          ] as const).map(([ic, l, v]) => (
            <div key={l} style={{ background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.15)", backdropFilter: "blur(8px)", borderRadius: 14, padding: "14px 16px", textAlign: "center", minWidth: 90 }}>
              <div style={{ fontSize: "1rem", marginBottom: 2 }}>{ic}</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "white" }}>{v}</div>
              <div style={{ fontSize: "0.63rem", fontWeight: 600, color: "rgba(255,255,255,.7)" }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#F5F3FF", padding: "28px 32px" }}>
      {hero}
      {tabBar}

      {tab === "clients" && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628" }}>{clients.length} Client{clients.length !== 1 ? "s" : ""} · {activeClients} Active</div>
            <button onClick={() => setClientModal({ editId: null })} style={{ padding: "10px 20px", background: "linear-gradient(135deg,#4338CA,#6366F1)", border: "none", borderRadius: 10, fontSize: "0.8rem", fontWeight: 700, color: "white", cursor: "pointer" }}>+ Add Client</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16 }}>
            {clients.map((c) => (
              <div key={c.id} style={{ background: "white", border: "1.5px solid #E5E7EB", borderRadius: 18, padding: 22, boxShadow: "0 1px 4px rgba(0,0,0,.05)", transition: "box-shadow .2s", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: c.color }} />
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                    <div style={{ width: 42, height: 42, background: `${c.color}18`, border: `2px solid ${c.color}33`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.1rem", fontWeight: 800, color: c.color, flexShrink: 0 }}>{c.name[0]}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.9rem", fontWeight: 800, color: "#0A1628", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                      <div style={{ fontSize: "0.68rem", color: "#6B7280" }}>{c.domain} · {c.industry}</div>
                    </div>
                  </div>
                  <span style={{ background: c.status === "active" ? "#F0FDF4" : "#F9FAFB", color: c.status === "active" ? "#059669" : "#9CA3AF", borderRadius: 6, padding: "2px 9px", fontSize: "0.62rem", fontWeight: 700, flexShrink: 0 }}>{c.status === "active" ? "● Active" : "○ Paused"}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                  {([
                    ["💰", "Budget", "$" + c.budget.toLocaleString() + "/mo"],
                    ["📈", "Revenue", "$" + c.revenue.toLocaleString()],
                    ["📣", "Campaigns", c.campaigns],
                    ["📅", "Last Report", c.lastReport],
                  ] as const).map(([ic, l, v], i) => (
                    <div key={i} style={{ background: "#F8FAFC", borderRadius: 9, padding: "8px 10px" }}>
                      <div style={{ fontSize: "0.62rem", color: "#9CA3AF", fontWeight: 600 }}>{ic} {l}</div>
                      <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0A1628", marginTop: 1 }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginBottom: 12 }}>Contact: <span style={{ color: "#374151", fontWeight: 600 }}>{c.contact}</span> · <span style={{ color: "#6366F1" }}>{c.email}</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  <button onClick={() => switchToClient(c.id)} style={{ padding: 8, background: "linear-gradient(135deg,#4338CA,#6366F1)", border: "none", borderRadius: 9, fontSize: "0.7rem", fontWeight: 700, color: "white", cursor: "pointer" }}>🔄 Switch</button>
                  <button onClick={() => generateClientReport(c.id)} style={{ padding: 8, background: "#F5F3FF", border: "1px solid #C7D2FE", borderRadius: 9, fontSize: "0.7rem", fontWeight: 700, color: "#4F46E5", cursor: "pointer" }}>📊 Report</button>
                  <button onClick={() => setClientModal({ editId: c.id })} style={{ padding: 8, background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 9, fontSize: "0.7rem", fontWeight: 600, color: "#6B7280", cursor: "pointer" }}>✏️ Edit</button>
                </div>
              </div>
            ))}
            <div onClick={() => setClientModal({ editId: null })} style={{ background: "white", border: "2px dashed #C7D2FE", borderRadius: 18, padding: 40, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#818CF8", transition: "all .15s" }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>+</div>
              <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>Add New Client</div>
            </div>
          </div>
        </>
      )}

      {tab === "reports" && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628" }}>{reports.length} Report{reports.length !== 1 ? "s" : ""} Generated</div>
            <button onClick={() => { if (!clients.length) { toast("⚠️ Add a client first"); return; } setGenModal(true); }} style={{ padding: "10px 20px", background: "linear-gradient(135deg,#4338CA,#6366F1)", border: "none", borderRadius: 10, fontSize: "0.8rem", fontWeight: 700, color: "white", cursor: "pointer" }}>+ Generate Report</button>
          </div>
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E5E7EB" }}>
                  <th style={{ textAlign: "left", padding: "11px 14px", color: "#6B7280", fontWeight: 700, fontSize: "0.65rem", textTransform: "uppercase" }}>Client</th>
                  <th style={{ textAlign: "center", padding: "11px 14px", color: "#6B7280", fontWeight: 700, fontSize: "0.65rem", textTransform: "uppercase" }}>Type</th>
                  <th style={{ textAlign: "center", padding: "11px 14px", color: "#6B7280", fontWeight: 700, fontSize: "0.65rem", textTransform: "uppercase" }}>Status</th>
                  <th style={{ textAlign: "right", padding: "11px 14px", color: "#6B7280", fontWeight: 700, fontSize: "0.65rem", textTransform: "uppercase" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.length > 0 ? (
                  reports.slice().reverse().map((r) => {
                    const c = clients.find((x) => x.id === r.clientId) || { name: "Unknown", color: "#6B7280" };
                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.82rem" }}>{c.name}</div>
                          <div style={{ fontSize: "0.65rem", color: "#9CA3AF" }}>{r.generatedAt}</div>
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}><span style={{ background: "#EEF2FF", color: "#4F46E5", borderRadius: 6, padding: "2px 9px", fontSize: "0.65rem", fontWeight: 700 }}>{r.type || "Full Report"}</span></td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}><span style={{ background: r.status === "sent" ? "#F0FDF4" : "#FFFBEB", color: r.status === "sent" ? "#059669" : "#D97706", borderRadius: 6, padding: "2px 9px", fontSize: "0.65rem", fontWeight: 700 }}>{r.status === "sent" ? "✓ Sent" : "Draft"}</span></td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                            <button onClick={() => setPreviewId(r.id)} style={{ padding: "5px 10px", background: "#EEF2FF", border: "none", borderRadius: 7, fontSize: "0.65rem", fontWeight: 700, color: "#4F46E5", cursor: "pointer" }}>👁 Preview</button>
                            <button onClick={() => { setPreviewId(r.id); toast("📄 Report opened — use Ctrl+P / Cmd+P to save as PDF"); }} style={{ padding: "5px 10px", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 7, fontSize: "0.65rem", fontWeight: 600, color: "#374151", cursor: "pointer" }}>⬇ PDF</button>
                            <button onClick={() => sendReportToClient(r.id)} style={{ padding: "5px 10px", background: "linear-gradient(135deg,#4338CA,#6366F1)", border: "none", borderRadius: 7, fontSize: "0.65rem", fontWeight: 700, color: "white", cursor: "pointer" }}>📤 Send</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr><td colSpan={4} style={{ textAlign: "center", padding: 40, color: "#9CA3AF", fontSize: "0.82rem" }}>No reports generated yet — click &quot;Generate Report&quot; on any client card</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "schedule" && (
        <>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628", marginBottom: 4 }}>Automated Report Schedule</div>
            <div style={{ fontSize: "0.75rem", color: "#6B7280" }}>InfoGenie auto-generates and emails reports to each client at their scheduled interval.</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
            {clients.map((c) => {
              const enabled = schedules[c.id] !== false;
              const d = new Date();
              d.setDate(d.getDate() + (c.freq === "weekly" ? 7 : 30));
              const nextSend = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
              return (
                <div key={c.id} style={{ background: "white", border: `1.5px solid ${enabled ? "#C7D2FE" : "#E5E7EB"}`, borderRadius: 16, padding: "18px 22px", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 200 }}>
                      <div style={{ width: 38, height: 38, background: `${c.color}18`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: 800, color: c.color }}>{c.name[0]}</div>
                      <div>
                        <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.85rem" }}>{c.name}</div>
                        <div style={{ fontSize: "0.68rem", color: "#6B7280" }}>{c.email}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "0.62rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", marginBottom: 2 }}>Frequency</div>
                        <select value={c.freq || "monthly"} onChange={(e) => updateClientFreq(c.id, e.target.value)} style={{ padding: "5px 10px", border: "1.5px solid #E5E7EB", borderRadius: 7, fontSize: "0.75rem", color: "#0A1628", background: "white", fontFamily: "'Inter',sans-serif" }}>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="quarterly">Quarterly</option>
                        </select>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "0.62rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", marginBottom: 2 }}>Next Send</div>
                        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#4F46E5" }}>{nextSend}</div>
                      </div>
                      <div onClick={() => toggleSchedule(c.id)} style={{ cursor: "pointer" }}>
                        <div style={{ width: 46, height: 26, background: enabled ? "#6366F1" : "#D1D5DB", borderRadius: 13, position: "relative", transition: "background .2s" }}>
                          <div style={{ position: "absolute", top: 3, left: enabled ? 23 : 3, width: 20, height: 20, background: "white", borderRadius: "50%", boxShadow: "0 1px 4px rgba(0,0,0,.2)", transition: "left .18s" }} />
                        </div>
                      </div>
                      <button onClick={() => generateClientReport(c.id)} style={{ padding: "7px 14px", background: "linear-gradient(135deg,#4338CA,#6366F1)", border: "none", borderRadius: 9, fontSize: "0.72rem", fontWeight: 700, color: "white", cursor: "pointer", whiteSpace: "nowrap" }}>📤 Send Now</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ background: "linear-gradient(135deg,#EEF2FF,#E0E7FF)", border: "1.5px solid #C7D2FE", borderRadius: 16, padding: "20px 24px" }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#4338CA", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 }}>💡 How automated reporting works</div>
            <div style={{ fontSize: "0.78rem", color: "#3730A3", lineHeight: 1.7 }}>When scheduled sends are active, InfoGenie automatically generates a full branded report at the scheduled interval — covering campaign performance, competitor movements, social metrics, and AI-recommended next steps — then delivers it to your client&apos;s inbox with your agency branding. No manual steps required.</div>
          </div>
        </>
      )}

      {tab === "whitelabel" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20, alignItems: "flex-start" }}>
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628", marginBottom: 18 }}>🎨 White-label Settings</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Agency Name</div>
                <input type="text" value={brand.name} placeholder="Your Agency Name" onChange={(e) => setBrand((b) => ({ ...b, name: e.target.value }))} style={{ width: "100%", boxSizing: "border-box", padding: "10px 13px", border: "1.5px solid #E5E7EB", borderRadius: 10, fontSize: "0.85rem", color: "#0A1628", fontFamily: "'Inter',sans-serif", outline: "none" }} />
              </div>
              <div>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Brand Colour</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="color" value={brand.color} onChange={(e) => setBrand((b) => ({ ...b, color: e.target.value }))} style={{ width: 44, height: 38, padding: 2, border: "1.5px solid #E5E7EB", borderRadius: 9, cursor: "pointer", background: "white" }} />
                  <input type="text" value={brand.color} onChange={(e) => setBrand((b) => ({ ...b, color: e.target.value }))} style={{ flex: 1, padding: "10px 13px", border: "1.5px solid #E5E7EB", borderRadius: 10, fontSize: "0.85rem", color: "#0A1628", fontFamily: "'Inter',sans-serif", outline: "none" }} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Report Footer Text</div>
                <textarea rows={2} value={brand.footer} onChange={(e) => setBrand((b) => ({ ...b, footer: e.target.value }))} style={{ width: "100%", boxSizing: "border-box", padding: "10px 13px", border: "1.5px solid #E5E7EB", borderRadius: 10, fontSize: "0.82rem", color: "#0A1628", fontFamily: "'Inter',sans-serif", outline: "none", resize: "none" }} />
                <div style={{ fontSize: "0.65rem", color: "#9CA3AF", marginTop: 3 }}>Use {"{client}"} and {"{agency}"} as placeholders</div>
              </div>
              <div>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Default Report Frequency</div>
                <select value={brand.reportFreq} onChange={(e) => setBrand((b) => ({ ...b, reportFreq: e.target.value }))} style={{ width: "100%", padding: "10px 13px", border: "1.5px solid #E5E7EB", borderRadius: 10, fontSize: "0.85rem", color: "#0A1628", background: "white", fontFamily: "'Inter',sans-serif" }}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>
              <button onClick={() => toast("✅ White-label settings saved")} style={{ padding: 11, background: "linear-gradient(135deg,#4338CA,#6366F1)", border: "none", borderRadius: 10, fontSize: "0.85rem", fontWeight: 700, color: "white", cursor: "pointer", marginTop: 4 }}>💾 Save Settings</button>
            </div>
          </div>

          <div style={{ background: "white", border: "2px solid #C7D2FE", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 12px rgba(99,102,241,.12)" }}>
            <div style={{ background: `linear-gradient(135deg,${brand.color},${brand.color}CC)`, padding: "20px 22px" }}>
              <div style={{ fontSize: "0.6rem", fontWeight: 700, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 4 }}>{brand.name}</div>
              <div style={{ fontSize: "1rem", fontWeight: 800, color: "white", marginBottom: 2 }}>Monthly Performance Report</div>
              <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,.7)" }}>Prepared for [Client Name] · {new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
            </div>
            <div style={{ padding: "16px 18px", fontSize: "0.72rem", color: "#374151", lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: "#0A1628", marginBottom: 6 }}>📋 Executive Summary</div>
              <div style={{ color: "#6B7280", marginBottom: 12 }}>This report covers campaign performance, competitor intelligence, social metrics, and strategic recommendations for the period ending {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
                {([["Total Reach", "84,200"], ["Ad Spend", "$4,500"], ["ROAS", "3.8×"], ["Engagement", "4.2%"]] as const).map(([l, v]) => (
                  <div key={l} style={{ background: "#F8FAFC", borderRadius: 7, padding: "8px 10px" }}>
                    <div style={{ fontSize: "0.6rem", color: "#9CA3AF" }}>{l}</div>
                    <div style={{ fontSize: "0.88rem", fontWeight: 800, color: brand.color }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1px solid #E5E7EB", paddingTop: 10, fontSize: "0.65rem", color: "#9CA3AF", textAlign: "center" }}>{brand.footer.replace("{client}", "[Client]").replace("{agency}", brand.name)}</div>
            </div>
          </div>
        </div>
      )}

      {clientModal && (
        <ClientModal
          client={clientModal.editId ? clients.find((c) => c.id === clientModal.editId) || null : null}
          onClose={() => setClientModal(null)}
          onSave={(form) => saveClient(form, clientModal.editId)}
        />
      )}

      {genModal && (
        <GenerateReportModal
          clients={clients}
          onClose={() => setGenModal(false)}
          onGenerate={(cid) => { setGenModal(false); generateClientReport(cid); }}
        />
      )}

      {previewId && (() => {
        const r = reports.find((x) => x.id === previewId);
        if (!r) return null;
        const c = clients.find((x) => x.id === r.clientId) || { name: "Client", color: "#6366F1" } as Partial<Client>;
        return <ReportPreview report={r} clientName={c.name || "Client"} brand={brand} onClose={() => setPreviewId(null)} />;
      })()}
    </div>
  );
}

function ClientModal({ client, onClose, onSave }: { client: Client | null; onClose: () => void; onSave: (form: ClientForm) => void }) {
  const [form, setForm] = useState<ClientForm>({
    name: client?.name || "", domain: client?.domain || "", contact: client?.contact || "",
    email: client?.email || "", budget: client?.budget != null ? String(client.budget) : "",
    industry: client?.industry || INDUSTRIES[0], color: client?.color || COLORS[0], freq: client?.freq || "monthly",
  });
  const fields: { key: keyof ClientForm; type: string; ph: string }[] = [
    { key: "name", type: "text", ph: "Client / Company Name" },
    { key: "domain", type: "text", ph: "Website domain (e.g. company.com)" },
    { key: "contact", type: "text", ph: "Primary Contact Name" },
    { key: "email", type: "email", ph: "Contact Email" },
    { key: "budget", type: "number", ph: "Monthly Ad Budget (USD)" },
  ];
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 20, width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,.3)" }}>
        <div style={{ background: "linear-gradient(135deg,#312E81,#6366F1)", borderRadius: "20px 20px 0 0", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1rem", fontWeight: 800, color: "white" }}>{client ? "Edit Client" : "Add New Client"}</div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,.15)", border: "none", borderRadius: "50%", width: 30, height: 30, fontSize: "1rem", color: "white", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 13 }}>
          {fields.map((f) => (
            <div key={f.key}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>{f.ph}</div>
              <input type={f.type} value={form[f.key]} placeholder={f.ph} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", border: "1.5px solid #E5E7EB", borderRadius: 9, fontSize: "0.82rem", color: "#0A1628", fontFamily: "'Inter',sans-serif", outline: "none" }} />
            </div>
          ))}
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>Industry</div>
            <select value={form.industry} onChange={(e) => setForm((p) => ({ ...p, industry: e.target.value }))} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #E5E7EB", borderRadius: 9, fontSize: "0.82rem", color: "#0A1628", background: "white", fontFamily: "'Inter',sans-serif" }}>
              {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Brand Colour</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {COLORS.map((col) => (
                <div key={col} onClick={() => setForm((p) => ({ ...p, color: col }))} style={{ width: 28, height: 28, background: col, borderRadius: 7, cursor: "pointer", outline: form.color === col ? "3px solid #000" : "none" }} />
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>Report Frequency</div>
            <select value={form.freq} onChange={(e) => setForm((p) => ({ ...p, freq: e.target.value }))} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #E5E7EB", borderRadius: 9, fontSize: "0.82rem", color: "#0A1628", background: "white", fontFamily: "'Inter',sans-serif" }}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={onClose} style={{ flex: 1, padding: 11, background: "#F3F4F6", border: "none", borderRadius: 10, fontSize: "0.82rem", fontWeight: 600, color: "#6B7280", cursor: "pointer" }}>Cancel</button>
            <button onClick={() => onSave(form)} style={{ flex: 2, padding: 11, background: "linear-gradient(135deg,#4338CA,#6366F1)", border: "none", borderRadius: 10, fontSize: "0.82rem", fontWeight: 700, color: "white", cursor: "pointer" }}>{client ? "💾 Save Changes" : "➕ Add Client"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GenerateReportModal({ clients, onClose, onGenerate }: { clients: Client[]; onClose: () => void; onGenerate: (cid: string) => void }) {
  const [clientId, setClientId] = useState(clients[0]?.id || "");
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 18, width: "100%", maxWidth: 420, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,.3)" }}>
        <div style={{ background: "linear-gradient(135deg,#312E81,#6366F1)", padding: "18px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.95rem", fontWeight: 800, color: "white" }}>Generate Client Report</div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,.15)", border: "none", borderRadius: "50%", width: 28, height: 28, color: "white", cursor: "pointer", fontSize: "0.9rem" }}>✕</button>
        </div>
        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", marginBottom: 5 }}>Select Client</div>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #E5E7EB", borderRadius: 9, fontSize: "0.82rem", color: "#0A1628", background: "white" }}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", marginBottom: 5 }}>Report Type</div>
            <select style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #E5E7EB", borderRadius: 9, fontSize: "0.82rem", color: "#0A1628", background: "white" }}>
              <option>Full Report</option><option>Campaign Only</option><option>Competitor Intel</option><option>Social Summary</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={onClose} style={{ flex: 1, padding: 10, background: "#F3F4F6", border: "none", borderRadius: 9, fontSize: "0.8rem", fontWeight: 600, color: "#6B7280", cursor: "pointer" }}>Cancel</button>
            <button onClick={() => onGenerate(clientId)} style={{ flex: 2, padding: 10, background: "linear-gradient(135deg,#4338CA,#6366F1)", border: "none", borderRadius: 9, fontSize: "0.8rem", fontWeight: 700, color: "white", cursor: "pointer" }}>✨ Generate Report</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportPreview({ report, clientName, brand, onClose }: { report: AgencyReport; clientName: string; brand: Brand; onClose: () => void }) {
  const d = report.content || {};
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, overflowY: "auto" }}>
      <div style={{ background: "#F8FAFC", borderRadius: 14, width: "100%", maxWidth: 900, margin: "24px 0", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,.3)" }}>
        <div style={{ background: `linear-gradient(135deg,${brand.color},${brand.color}BB)`, color: "white", padding: "36px 48px", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,.2)", border: "none", borderRadius: "50%", width: 32, height: 32, color: "white", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
          <div style={{ fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", opacity: 0.65, marginBottom: 8 }}>{brand.name}</div>
          <h1 style={{ fontSize: "1.8rem", margin: "0 0 4px", fontWeight: 800 }}>Performance Report</h1>
          <p style={{ margin: 0, opacity: 0.75, fontSize: "0.85rem" }}>Prepared for <strong>{clientName}</strong> · {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "36px 48px" }}>
          <ReportSection title="📋 Executive Summary" color={brand.color}>
            <p style={pStyle}>{d.executive_summary || "This report provides a comprehensive overview of campaign performance, competitive landscape, and strategic recommendations for the reporting period."}</p>
          </ReportSection>
          <ReportSection title="📈 Campaign Performance" color={brand.color}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
              {([["Total Reach", d.kpis?.reach || "84.2K"], ["ROAS", d.kpis?.roas || "3.8×"], ["CTR", d.kpis?.ctr || "3.2%"], ["Conversions", d.kpis?.conversions || "142"]] as const).map(([l, v]) => (
                <div key={l} style={{ background: "#F8FAFC", borderRadius: 8, padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: "1.4rem", fontWeight: 800, color: brand.color }}>{v}</div>
                  <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginTop: 3 }}>{l}</div>
                </div>
              ))}
            </div>
            <p style={pStyle}>{d.campaign_performance || "Campaign performance exceeded benchmarks this period with strong ROAS across all channels."}</p>
          </ReportSection>
          <ReportSection title="🕵️ Competitor Intelligence" color={brand.color}>
            <p style={pStyle}>{d.competitor_intel || "Competitor activity analysis shows increased spend from primary competitors. Key opportunities identified in underserved keyword segments."}</p>
          </ReportSection>
          <ReportSection title="📱 Social Media" color={brand.color}>
            <p style={pStyle}>{d.social_metrics || "Social engagement rates are trending above industry average. Instagram and LinkedIn driving highest quality traffic."}</p>
          </ReportSection>
          <ReportSection title="💡 Recommendations" color={brand.color}>
            <p style={{ ...pStyle, whiteSpace: "pre-wrap" }}>{d.recommendations || "1. Increase budget allocation to highest-ROAS campaigns.\n2. Launch retargeting sequences for mid-funnel leads.\n3. Expand content clusters in top keyword gaps."}</p>
          </ReportSection>
          <div style={{ textAlign: "center", padding: 24, fontSize: "0.72rem", color: "#9CA3AF", borderTop: "1px solid #E5E7EB", marginTop: 32 }}>{brand.footer.replace("{client}", clientName).replace("{agency}", brand.name)}</div>
        </div>
      </div>
    </div>
  );
}

const pStyle: React.CSSProperties = { margin: "0 0 8px", lineHeight: 1.7, fontSize: "0.85rem", color: "#374151" };

function ReportSection({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "white", borderRadius: 12, padding: 24, marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 800, color: "#0A1628", margin: "0 0 12px", paddingBottom: 8, borderBottom: `2px solid ${color}20` }}>{title}</h2>
      {children}
    </div>
  );
}

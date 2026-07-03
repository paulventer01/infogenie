"use client";
import { useState, useEffect } from "react";
import { apiGet } from "@/lib/api";

interface Broadcast {
  id: number;
  name: string;
  subject: string;
  status: string;
  recipient_count: number;
  sent_count: number;
  open_count: number;
  click_count: number;
  bounce_count: number;
  complaint_count: number;
  unsubscribe_count: number;
  created_at: string;
  sent_at: string | null;
}

interface AnalyticsData {
  ok: boolean;
  broadcasts: Broadcast[];
  totals: {
    campaigns: number;
    sent: number;
    opens: number;
    clicks: number;
    bounces: number;
    unsubscribes: number;
  };
}

function pct(num: number, denom: number) {
  if (!denom) return "—";
  return ((num / denom) * 100).toFixed(1) + "%";
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function StatCard({ label, value, sub, color, icon }: { label: string; value: string; sub: string; color: string; icon: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: "1.1rem" }}>{icon}</span>
        <span style={{ fontSize: "0.68rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</span>
      </div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, color, marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>{sub}</div>
    </div>
  );
}

function HealthBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pctVal = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "#F3F4F6", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pctVal}%`, background: color, borderRadius: 3, transition: "width .4s ease" }} />
      </div>
      <span style={{ fontSize: "0.72rem", color: "#374151", minWidth: 36, textAlign: "right" }}>{pct(value, max)}</span>
    </div>
  );
}

function getRateColor(rate: number, type: "open" | "click" | "bounce" | "unsub") {
  if (type === "open") return rate >= 25 ? "#059669" : rate >= 15 ? "#D97706" : "#DC2626";
  if (type === "click") return rate >= 3 ? "#059669" : rate >= 1 ? "#D97706" : "#DC2626";
  if (type === "bounce") return rate <= 0.5 ? "#059669" : rate <= 2 ? "#D97706" : "#DC2626";
  if (type === "unsub") return rate <= 0.2 ? "#059669" : rate <= 0.5 ? "#D97706" : "#DC2626";
  return "#6B7280";
}

function getBenchmark(type: "open" | "click" | "bounce" | "unsub") {
  if (type === "open") return "Good: >25% · Avg: 20–25% · Poor: <15%";
  if (type === "click") return "Good: >3% · Avg: 1–3% · Poor: <1%";
  if (type === "bounce") return "Good: <0.5% · Avg: 0.5–2% · Poor: >2%";
  if (type === "unsub") return "Good: <0.2% · Avg: 0.2–0.5% · Poor: >0.5%";
  return "";
}

export default function EmailCampaignAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"date" | "sent" | "open_rate" | "click_rate">("date");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    apiGet<AnalyticsData>("/api/email-broadcast/analytics").then(d => {
      setData(d);
      setLoading(false);
    });
  }, []);

  const broadcasts = data?.broadcasts || [];
  const totals = data?.totals || { campaigns: 0, sent: 0, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0 };

  const avgOpenRate = totals.sent > 0 ? (totals.opens / totals.sent) * 100 : 0;
  const avgClickRate = totals.sent > 0 ? (totals.clicks / totals.sent) * 100 : 0;
  const avgBounceRate = totals.sent > 0 ? (totals.bounces / totals.sent) * 100 : 0;
  const avgUnsubRate = totals.sent > 0 ? (totals.unsubscribes / totals.sent) * 100 : 0;

  const filtered = broadcasts
    .filter(b => !filter || b.name.toLowerCase().includes(filter.toLowerCase()) || b.subject.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "date") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === "sent") return (b.sent_count - a.sent_count);
      if (sortBy === "open_rate") {
        const ra = a.sent_count ? a.open_count / a.sent_count : 0;
        const rb = b.sent_count ? b.open_count / b.sent_count : 0;
        return rb - ra;
      }
      if (sortBy === "click_rate") {
        const ra = a.sent_count ? a.click_count / a.sent_count : 0;
        const rb = b.sent_count ? b.click_count / b.sent_count : 0;
        return rb - ra;
      }
      return 0;
    });

  return (
    <div style={{ fontFamily: "Inter, sans-serif", background: "#F8FAFF", minHeight: "100vh" }}>
      {/* Hero */}
      <div style={{ background: "linear-gradient(135deg, #0A1F4E 0%, #1E3A8A 55%, #0066CC 100%)", padding: "28px 28px 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: "0.65rem", fontWeight: 800, background: "rgba(255,255,255,.15)", color: "#E0E7FF", padding: "3px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: ".07em" }}>REACH</span>
            <span style={{ color: "rgba(255,255,255,.3)", fontSize: "0.65rem" }}>›</span>
            <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "rgba(255,255,255,.55)", textTransform: "uppercase", letterSpacing: ".07em" }}>Email Analytics</span>
          </div>
          <h2 style={{ margin: 0, fontFamily: "Sora, sans-serif", fontSize: "1.55rem", fontWeight: 900, color: "#fff" }}>📊 Email Campaign Analytics</h2>
          <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,.7)", fontSize: "0.85rem", maxWidth: 560 }}>
            Open rates, click rates, bounce rates, and unsubscribe tracking across every email broadcast — with industry benchmarks to show exactly where you stand.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#9CA3AF" }}>Loading analytics…</div>
        ) : (
          <>
            {/* Overall stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 20 }}>
              <StatCard icon="📧" label="Campaigns" value={String(totals.campaigns)} sub="total broadcasts" color="#1D4ED8" />
              <StatCard icon="📤" label="Sent" value={totals.sent >= 1000 ? (totals.sent / 1000).toFixed(1) + "K" : String(totals.sent)} sub="total emails" color="#374151" />
              <StatCard icon="📬" label="Open Rate" value={avgOpenRate.toFixed(1) + "%"} sub={getBenchmark("open").split("·")[0].trim()} color={getRateColor(avgOpenRate, "open")} />
              <StatCard icon="👆" label="Click Rate" value={avgClickRate.toFixed(1) + "%"} sub={getBenchmark("click").split("·")[0].trim()} color={getRateColor(avgClickRate, "click")} />
              <StatCard icon="↩️" label="Bounce Rate" value={avgBounceRate.toFixed(2) + "%"} sub={getBenchmark("bounce").split("·")[0].trim()} color={getRateColor(avgBounceRate, "bounce")} />
              <StatCard icon="🚪" label="Unsub Rate" value={avgUnsubRate.toFixed(2) + "%"} sub={getBenchmark("unsub").split("·")[0].trim()} color={getRateColor(avgUnsubRate, "unsub")} />
            </div>

            {/* Benchmark reference */}
            {totals.campaigns > 0 && (
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16, marginBottom: 20 }}>
                <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: "0.85rem", marginBottom: 12 }}>📏 Industry Benchmarks</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                  {([
                    { label: "Open Rate", rate: avgOpenRate, type: "open" as const },
                    { label: "Click Rate", rate: avgClickRate, type: "click" as const },
                    { label: "Bounce Rate", rate: avgBounceRate, type: "bounce" as const },
                    { label: "Unsub Rate", rate: avgUnsubRate, type: "unsub" as const },
                  ]).map(m => (
                    <div key={m.label}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#374151" }}>{m.label}</span>
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: getRateColor(m.rate, m.type) }}>{m.rate.toFixed(1)}%</span>
                      </div>
                      <div style={{ height: 6, background: "#F3F4F6", borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                        <div style={{ height: "100%", width: `${Math.min(m.rate * (m.type === "open" ? 2.5 : m.type === "click" ? 15 : 25), 100)}%`, background: getRateColor(m.rate, m.type), borderRadius: 3 }} />
                      </div>
                      <div style={{ fontSize: "0.66rem", color: "#9CA3AF" }}>{getBenchmark(m.type)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Per-campaign table */}
            {broadcasts.length === 0 ? (
              <div style={{ background: "#fff", border: "1px dashed #D1D5DB", borderRadius: 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60, color: "#9CA3AF" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📭</div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>No email broadcasts yet</div>
                <div style={{ fontSize: "0.78rem", marginTop: 4, textAlign: "center" }}>Send your first broadcast from Reach → Email Broadcast + Tracking, then come back here for analytics.</div>
              </div>
            ) : (
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, overflow: "hidden" }}>
                <div style={{ background: "linear-gradient(135deg, #F8FAFF, #EFF4FF)", padding: "14px 18px", borderBottom: "1px solid #E8EEF8", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: "0.88rem" }}>Campaign Performance</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter campaigns…" style={{ padding: "5px 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.75rem", width: 180 }} />
                    <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} style={{ padding: "5px 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.75rem" }}>
                      <option value="date">Sort: Date</option>
                      <option value="sent">Sort: Sent</option>
                      <option value="open_rate">Sort: Open Rate</option>
                      <option value="click_rate">Sort: Click Rate</option>
                    </select>
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #E5E7EB", background: "#F9FAFB" }}>
                        {["Campaign","Status","Sent","Open Rate","Click Rate","Bounce Rate","Unsub Rate","Sent Date"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontWeight: 700, color: "#374151", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(b => {
                        const openR = b.sent_count > 0 ? (b.open_count / b.sent_count) * 100 : 0;
                        const clickR = b.sent_count > 0 ? (b.click_count / b.sent_count) * 100 : 0;
                        const bounceR = b.sent_count > 0 ? (b.bounce_count / b.sent_count) * 100 : 0;
                        const unsubR = b.sent_count > 0 ? (b.unsubscribe_count / b.sent_count) * 100 : 0;
                        const statusColor: Record<string, string> = { sent: "#059669", sending: "#D97706", draft: "#6B7280", paused: "#DC2626" };
                        return (
                          <tr key={b.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ fontWeight: 600, color: "#0A1628" }}>{b.name}</div>
                              <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginTop: 2 }}>{b.subject}</div>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <span style={{ background: (statusColor[b.status] || "#6B7280") + "15", color: statusColor[b.status] || "#6B7280", padding: "2px 8px", borderRadius: 20, fontSize: "0.7rem", fontWeight: 600, textTransform: "capitalize" }}>{b.status}</span>
                            </td>
                            <td style={{ padding: "10px 12px", fontWeight: 600 }}>{b.sent_count.toLocaleString()}</td>
                            <td style={{ padding: "10px 12px", minWidth: 120 }}>
                              <div style={{ fontWeight: 700, color: getRateColor(openR, "open"), marginBottom: 3 }}>{openR.toFixed(1)}%</div>
                              <HealthBar value={b.open_count} max={b.sent_count} color={getRateColor(openR, "open")} />
                            </td>
                            <td style={{ padding: "10px 12px", minWidth: 120 }}>
                              <div style={{ fontWeight: 700, color: getRateColor(clickR, "click"), marginBottom: 3 }}>{clickR.toFixed(1)}%</div>
                              <HealthBar value={b.click_count} max={b.sent_count} color={getRateColor(clickR, "click")} />
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <span style={{ color: getRateColor(bounceR, "bounce"), fontWeight: 700 }}>{bounceR.toFixed(2)}%</span>
                              <div style={{ fontSize: "0.68rem", color: "#9CA3AF" }}>{b.bounce_count} bounced</div>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <span style={{ color: getRateColor(unsubR, "unsub"), fontWeight: 700 }}>{unsubR.toFixed(2)}%</span>
                              <div style={{ fontSize: "0.68rem", color: "#9CA3AF" }}>{b.unsubscribe_count} unsubs</div>
                            </td>
                            <td style={{ padding: "10px 12px", color: "#6B7280", whiteSpace: "nowrap" }}>{fmtDate(b.sent_at || b.created_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Account {
  id: number;
  email: string;
  display_name: string | null;
  provider: string;
  status: string;
  current_day: number;
  target_days: number;
  current_daily_volume: number;
  max_volume: number;
  start_volume: number;
  reputation_score: number;
  warmup_start: string;
  last_sent_at: string | null;
  days_logged: number;
}

interface LogEntry {
  day_number: number;
  planned_volume: number;
  sent_volume: number;
  delivered_count: number;
  bounced_count: number;
  spam_count: number;
  open_rate: number;
  reputation_score: number;
}

interface ScheduleEntry {
  day: number;
  projected_volume: number;
}

interface AiAdvice {
  health: "good" | "warning" | "critical";
  overall_assessment: string;
  issues: string[];
  recommendations: string[];
  next_steps: string[];
  estimated_inbox_rate: number;
}

interface Provider {
  id: string;
  label: string;
  smtp_host: string;
  smtp_port: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  active:      { label: "▶️ Warming",    color: "#059669", bg: "#ECFDF5" },
  paused:      { label: "⏸ Paused",      color: "#D97706", bg: "#FFF7ED" },
  completed:   { label: "✅ Complete",   color: "#2563EB", bg: "#EFF6FF" },
  blacklisted: { label: "🚫 Blacklisted",color: "#DC2626", bg: "#FEF2F2" },
};

const HEALTH_COLOR = { good: "#059669", warning: "#D97706", critical: "#DC2626" };

export default function EmailWarmup() {
  const [accounts, setAccounts]     = useState<Account[]>([]);
  const [providers, setProviders]   = useState<Provider[]>([]);
  const [loading, setLoading]       = useState(true);
  const [active, setActive]         = useState<Account | null>(null);
  const [logData, setLogData]       = useState<{ log: LogEntry[]; schedule: ScheduleEntry[] } | null>(null);
  const [advice, setAdvice]         = useState<AiAdvice | null>(null);
  const [loadingLog, setLoadingLog] = useState(false);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [tab, setTab]               = useState<"accounts" | "new" | "detail">("accounts");
  const [toast, setToast]           = useState("");
  const [saving, setSaving]         = useState(false);
  const [logDayForm, setLogDayForm] = useState({ sent_volume: "", delivered_count: "", bounced_count: "", spam_count: "", open_rate: "" });
  const [checkingBL, setCheckingBL] = useState(false);
  const [blResult, setBlResult]     = useState<{ clean: boolean; lists_hit: number; domain: string } | null>(null);
  const [form, setForm]             = useState({ email: "", display_name: "", provider: "gmail", smtp_host: "", smtp_port: "587", smtp_user: "", max_volume: "200", target_days: "42" });

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    const [cfg, accs] = await Promise.all([apiGet("/api/email-warmup/config"), apiGet("/api/email-warmup/accounts")]);
    if (cfg?.providers) setProviders(cfg.providers);
    if (accs?.accounts) setAccounts(accs.accounts);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openAccount(acc: Account) {
    setActive(acc);
    setAdvice(null);
    setBlResult(null);
    setLogData(null);
    setTab("detail");
    setLoadingLog(true);
    const r = await apiGet(`/api/email-warmup/accounts/${acc.id}/log`);
    if (r?.log) setLogData({ log: r.log, schedule: r.schedule || [] });
    setLoadingLog(false);
  }

  async function handleCreate() {
    if (!form.email) { showToast("Email address required."); return; }
    setSaving(true);
    const r = await apiPost("/api/email-warmup/accounts", {
      ...form,
      smtp_port: +form.smtp_port,
      max_volume: +form.max_volume,
      target_days: +form.target_days,
    });
    if (r?.ok) {
      showToast("✅ Warmup account added!");
      setAccounts(prev => [r.account, ...prev]);
      setTab("accounts");
      setForm({ email: "", display_name: "", provider: "gmail", smtp_host: "", smtp_port: "587", smtp_user: "", max_volume: "200", target_days: "42" });
    } else { showToast("Error creating account."); }
    setSaving(false);
  }

  async function handlePause(id: number) {
    const r = await apiPost(`/api/email-warmup/accounts/${id}/pause`, {});
    if (r?.ok) {
      const next = r.status;
      setAccounts(prev => prev.map(a => a.id === id ? { ...a, status: next } : a));
      if (active?.id === id) setActive(a => a ? { ...a, status: next } : a);
      showToast(next === "paused" ? "Warmup paused." : "Warmup resumed.");
    }
  }

  async function handleCheckBlacklist(id: number) {
    setCheckingBL(true);
    const r = await apiPost(`/api/email-warmup/accounts/${id}/check-blacklist`, {});
    if (r?.ok) {
      setBlResult({ clean: r.clean, lists_hit: r.lists_hit, domain: r.domain });
      showToast(r.clean ? "✅ Not on any blacklist!" : `⚠️ Found on ${r.lists_hit} blacklist(s)`);
      load();
    } else { showToast("Blacklist check failed."); }
    setCheckingBL(false);
  }

  async function handleLogDay(id: number) {
    if (!logDayForm.sent_volume) { showToast("Enter sent volume."); return; }
    const r = await apiPost(`/api/email-warmup/accounts/${id}/log-day`, {
      sent_volume:    +logDayForm.sent_volume,
      delivered_count:+logDayForm.delivered_count || 0,
      bounced_count:  +logDayForm.bounced_count || 0,
      spam_count:     +logDayForm.spam_count || 0,
      open_rate:      +logDayForm.open_rate || 0,
    });
    if (r?.ok) {
      showToast(`✅ Day ${r.day} logged! Tomorrow's target: ${r.next_day_volume} emails.`);
      setLogDayForm({ sent_volume: "", delivered_count: "", bounced_count: "", spam_count: "", open_rate: "" });
      if (active) openAccount({ ...active, current_day: r.day, reputation_score: r.reputation_score });
      load();
    } else { showToast("Log failed."); }
  }

  async function handleGetAdvice(id: number) {
    setLoadingAdvice(true);
    const r = await apiPost(`/api/email-warmup/accounts/${id}/ai-advice`, {});
    if (r?.ok) setAdvice(r.advice);
    else showToast(r?.error?.includes("key") ? "⚠️ OpenAI key required — configure it in AI Providers." : "Advice generation failed.");
    setLoadingAdvice(false);
  }

  const card:   React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 2px 8px rgba(10,20,50,.06)" };
  const input:  React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", boxSizing: "border-box" };
  const lbl:    React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 5 };
  const btnPri: React.CSSProperties = { padding: "10px 22px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" };

  const selectedProvider = providers.find(pp => pp.id === form.provider);

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "#0A1628", color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Reach › Deliverability</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>🔥 Email Warm-Up</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>Gradually increase sending volume on a new domain so inbox providers build trust before your real campaigns go out. Monitor reputation, open rates, and blacklists in one place.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {([["accounts","📋 Accounts"], ["new","➕ Add Account"], ...(active ? [["detail", `🔍 ${active.email}`]] : [])] as [string,string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as "accounts"|"new"|"detail")} style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#0066FF" : "transparent"}`, color: tab === t ? "#0066FF" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: "pointer", marginBottom: -2 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "new" && (
        <div style={{ maxWidth: 600 }}>
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>Add Email Account to Warm Up</div>
            <div style={{ display: "grid", gap: 12 }}>
              <div><label style={lbl}>Email Address *</label><input style={input} placeholder="hello@yourdomain.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><label style={lbl}>Display Name</label><input style={input} placeholder="Sarah from YourBrand" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} /></div>
              <div>
                <label style={lbl}>Provider</label>
                <select style={input} value={form.provider} onChange={e => { const pp = providers.find(p => p.id === e.target.value); setForm(f => ({ ...f, provider: e.target.value, smtp_host: pp?.smtp_host || "", smtp_port: String(pp?.smtp_port || 587) })); }}>
                  {providers.map(pp => <option key={pp.id} value={pp.id}>{pp.label}</option>)}
                </select>
              </div>
              {form.provider === "smtp" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10 }}>
                  <div><label style={lbl}>SMTP Host</label><input style={input} placeholder="mail.yourdomain.com" value={form.smtp_host} onChange={e => setForm(f => ({ ...f, smtp_host: e.target.value }))} /></div>
                  <div><label style={lbl}>Port</label><input style={input} placeholder="587" value={form.smtp_port} onChange={e => setForm(f => ({ ...f, smtp_port: e.target.value }))} /></div>
                </div>
              )}
              {selectedProvider && form.provider !== "smtp" && (
                <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "8px 12px", fontSize: "0.75rem", color: "#065F46" }}>
                  SMTP: {selectedProvider.smtp_host}:{selectedProvider.smtp_port}
                </div>
              )}
              <div><label style={lbl}>SMTP Username</label><input style={input} placeholder="hello@yourdomain.com" value={form.smtp_user} onChange={e => setForm(f => ({ ...f, smtp_user: e.target.value }))} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={lbl}>Max Daily Volume</label><input style={input} type="number" value={form.max_volume} onChange={e => setForm(f => ({ ...f, max_volume: e.target.value }))} /></div>
                <div><label style={lbl}>Warmup Duration (days)</label><input style={input} type="number" value={form.target_days} onChange={e => setForm(f => ({ ...f, target_days: e.target.value }))} /></div>
              </div>
              <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 9, padding: "10px 14px", fontSize: "0.75rem", color: "#1D4ED8" }}>
                <strong>Warmup plan:</strong> Starts at 3 emails/day, reaches {form.max_volume || "200"}/day over {form.target_days || "42"} days using an exponential ramp. Ideal for cold outreach domains.
              </div>
            </div>
            <button onClick={handleCreate} disabled={saving} style={{ ...btnPri, marginTop: 14, width: "100%", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Adding…" : "🔥 Start Warmup"}
            </button>
          </div>
        </div>
      )}

      {tab === "accounts" && (
        <div>
          {loading ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 60 }}>Loading…</div> :
            accounts.length === 0 ? (
              <div style={{ ...card, textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: "3rem", marginBottom: 8 }}>🔥</div>
                <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "1rem" }}>No accounts warming up yet</div>
                <div style={{ color: "#64748B", fontSize: "0.84rem", marginTop: 4 }}>Add your first sending account to build inbox trust before your campaigns launch.</div>
                <button onClick={() => setTab("new")} style={{ ...btnPri, marginTop: 16 }}>➕ Add Account</button>
              </div>
            ) : accounts.map(acc => {
              const sc = STATUS_CONFIG[acc.status] || STATUS_CONFIG.active;
              const progress = Math.round((acc.current_day / acc.target_days) * 100);
              return (
                <div key={acc.id} style={{ ...card, cursor: "pointer" }} onClick={() => openAccount(acc)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                        <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem" }}>{acc.email}</div>
                        <span style={{ background: sc.bg, color: sc.color, padding: "3px 9px", borderRadius: 99, fontSize: "0.68rem", fontWeight: 700 }}>{sc.label}</span>
                      </div>
                      <div style={{ color: "#64748B", fontSize: "0.75rem" }}>{acc.display_name && `${acc.display_name} · `}{acc.provider} · Started {new Date(acc.warmup_start).toLocaleDateString()}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={e => { e.stopPropagation(); handlePause(acc.id); }} style={{ padding: "6px 12px", background: acc.status === "active" ? "#FFF7ED" : "#ECFDF5", border: "none", borderRadius: 7, color: acc.status === "active" ? "#D97706" : "#065F46", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer" }}>
                        {acc.status === "active" ? "⏸ Pause" : "▶️ Resume"}
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, textAlign: "center" }}>
                    {[
                      ["📅 Day", `${acc.current_day}/${acc.target_days}`],
                      ["📤 Today", `${acc.current_daily_volume}/day`],
                      ["🎯 Target", `${acc.max_volume}/day`],
                      ["⭐ Reputation", `${acc.reputation_score}/100`],
                      ["📊 Progress", `${progress}%`],
                    ].map(([l, v]) => (
                      <div key={l as string} style={{ background: "#F8FAFC", borderRadius: 8, padding: "7px 4px" }}>
                        <div style={{ fontSize: "0.65rem", color: "#64748B" }}>{l}</div>
                        <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.82rem" }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={{ height: 6, background: "#E2E8F0", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#0066FF,#00C9C8)", borderRadius: 99, transition: "width 0.4s" }} />
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 3 }}>
                      Day {acc.current_day} of {acc.target_days} · {acc.target_days - acc.current_day} days remaining
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {tab === "detail" && active && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20 }}>
          {/* Left: log + schedule */}
          <div>
            {/* Log Day */}
            <div style={card}>
              <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>📝 Log Today&apos;s Sending</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}>
                {[
                  ["sent_volume", "Sent"],
                  ["delivered_count", "Delivered"],
                  ["bounced_count", "Bounced"],
                  ["spam_count", "Spam"],
                  ["open_rate", "Open Rate %"],
                ].map(([key, label]) => (
                  <div key={key}>
                    <label style={lbl}>{label}</label>
                    <input style={input} type="number" step={key === "open_rate" ? "0.1" : "1"} value={(logDayForm as Record<string,string>)[key]} onChange={e => setLogDayForm(f => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <button onClick={() => handleLogDay(active.id)} style={{ ...btnPri, marginTop: 12, fontSize: "0.8rem", padding: "8px 18px" }}>
                ✅ Log Day {active.current_day + 1}
              </button>
            </div>

            {/* History */}
            {loadingLog ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 40 }}>Loading…</div> : logData && (
              <div style={card}>
                <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>📈 Warmup Progress</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                    <thead>
                      <tr style={{ background: "#F8FAFC", color: "#374151", fontWeight: 700 }}>
                        {["Day","Planned","Sent","Delivered","Bounced","Spam","Open %","Reputation"].map(h => (
                          <th key={h} style={{ padding: "7px 10px", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {logData.log.slice().reverse().map(l => (
                        <tr key={l.day_number} style={{ borderBottom: "1px solid #F1F5F9" }}>
                          <td style={{ padding: "6px 10px", fontWeight: 700 }}>Day {l.day_number}</td>
                          <td style={{ padding: "6px 10px", color: "#64748B" }}>{l.planned_volume}</td>
                          <td style={{ padding: "6px 10px" }}>{l.sent_volume}</td>
                          <td style={{ padding: "6px 10px", color: "#059669" }}>{l.delivered_count}</td>
                          <td style={{ padding: "6px 10px", color: l.bounced_count > 0 ? "#DC2626" : "#374151" }}>{l.bounced_count}</td>
                          <td style={{ padding: "6px 10px", color: l.spam_count > 0 ? "#DC2626" : "#374151" }}>{l.spam_count}</td>
                          <td style={{ padding: "6px 10px" }}>{Number(l.open_rate).toFixed(1)}%</td>
                          <td style={{ padding: "6px 10px" }}>
                            <span style={{ color: l.reputation_score >= 80 ? "#059669" : l.reputation_score >= 50 ? "#D97706" : "#DC2626", fontWeight: 700 }}>{l.reputation_score}</span>
                          </td>
                        </tr>
                      ))}
                      {logData.log.length === 0 && (
                        <tr><td colSpan={8} style={{ padding: "20px", textAlign: "center", color: "#94A3B8" }}>No days logged yet — use the form above after sending today.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {logData.schedule.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ fontWeight: 700, color: "#374151", fontSize: "0.8rem", marginBottom: 8 }}>📅 Upcoming Schedule (next 14 days)</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {logData.schedule.slice(0, 14).map(s => (
                        <div key={s.day} style={{ background: "#EFF6FF", borderRadius: 8, padding: "6px 10px", textAlign: "center", minWidth: 56 }}>
                          <div style={{ fontSize: "0.62rem", color: "#64748B" }}>Day {s.day}</div>
                          <div style={{ fontWeight: 700, color: "#2563EB", fontSize: "0.82rem" }}>{s.projected_volume}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: actions + advice */}
          <div>
            {/* Account summary */}
            <div style={{ ...card, borderLeft: "4px solid #0066FF" }}>
              <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 4 }}>{active.email}</div>
              <div style={{ color: "#64748B", fontSize: "0.75rem", marginBottom: 14 }}>{active.provider} · Day {active.current_day}/{active.target_days}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                {[["Today's Volume", `${active.current_daily_volume} emails`], ["Reputation", `${active.reputation_score}/100`]].map(([l, v]) => (
                  <div key={l} style={{ background: "#F8FAFC", borderRadius: 9, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.68rem", color: "#64748B" }}>{l}</div>
                    <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "1rem" }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <button onClick={() => handlePause(active.id)} style={{ padding: "8px", background: active.status === "active" ? "#FFF7ED" : "#ECFDF5", border: "none", borderRadius: 8, color: active.status === "active" ? "#D97706" : "#065F46", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>
                  {active.status === "active" ? "⏸ Pause Warmup" : "▶️ Resume Warmup"}
                </button>
                <button onClick={() => handleCheckBlacklist(active.id)} disabled={checkingBL} style={{ padding: "8px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, color: "#374151", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", opacity: checkingBL ? 0.7 : 1 }}>
                  {checkingBL ? "Checking…" : "🔍 Check Blacklists"}
                </button>
              </div>

              {blResult && (
                <div style={{ marginTop: 10, background: blResult.clean ? "#ECFDF5" : "#FEF2F2", border: `1px solid ${blResult.clean ? "#6EE7B7" : "#FECACA"}`, borderRadius: 8, padding: "10px 12px", fontSize: "0.78rem", color: blResult.clean ? "#065F46" : "#7F1D1D" }}>
                  {blResult.clean ? `✅ ${blResult.domain} is clean across all checked lists.` : `⚠️ ${blResult.domain} appears on ${blResult.lists_hit} blacklist(s). Take action immediately.`}
                </div>
              )}
            </div>

            {/* AI Advice */}
            <div style={card}>
              <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 10 }}>🤖 AI Deliverability Advice</div>
              {!advice ? (
                <button onClick={() => handleGetAdvice(active.id)} disabled={loadingAdvice} style={{ ...btnPri, width: "100%", opacity: loadingAdvice ? 0.7 : 1, fontSize: "0.8rem" }}>
                  {loadingAdvice ? "Analysing…" : "✨ Get AI Advice"}
                </button>
              ) : (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ background: `${HEALTH_COLOR[advice.health]}20`, color: HEALTH_COLOR[advice.health], padding: "3px 10px", borderRadius: 99, fontWeight: 700, fontSize: "0.75rem" }}>
                      {advice.health === "good" ? "✅ Good" : advice.health === "warning" ? "⚠️ Warning" : "🚨 Critical"}
                    </span>
                    <span style={{ fontSize: "0.72rem", color: "#64748B" }}>Est. inbox rate: {advice.estimated_inbox_rate}%</span>
                  </div>
                  <p style={{ fontSize: "0.8rem", color: "#374151", lineHeight: 1.6, marginBottom: 10 }}>{advice.overall_assessment}</p>
                  {advice.issues.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#DC2626", marginBottom: 4 }}>Issues:</div>
                      {advice.issues.map((i, idx) => <div key={idx} style={{ fontSize: "0.76rem", color: "#374151", marginBottom: 3 }}>• {i}</div>)}
                    </div>
                  )}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", marginBottom: 4 }}>Recommendations:</div>
                    {advice.recommendations.map((r, idx) => <div key={idx} style={{ fontSize: "0.76rem", color: "#374151", marginBottom: 3 }}>• {r}</div>)}
                  </div>
                  <button onClick={() => setAdvice(null)} style={{ fontSize: "0.72rem", color: "#0066FF", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Refresh advice</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

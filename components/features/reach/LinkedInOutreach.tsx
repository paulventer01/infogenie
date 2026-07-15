"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";

interface Sequence {
  id: number;
  name: string;
  objective: string;
  target_title: string | null;
  target_industry: string | null;
  connection_message: string | null;
  followup_1_message: string | null;
  followup_1_delay_days: number;
  followup_2_message: string | null;
  followup_2_delay_days: number;
  followup_3_message: string | null;
  followup_3_delay_days: number;
  daily_connection_limit: number;
  status: string;
  pending_count: number;
  sent_count: number;
  connected_count: number;
  replied_count: number;
  converted_count: number;
  total_count: number;
  created_at: string;
}

interface Contact {
  id: number;
  linkedin_url: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  company: string | null;
  status: string;
  connection_sent_at: string | null;
  connected_at: string | null;
  replied_at: string | null;
  reply_snippet: string | null;
  added_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:          { label: "⏳ Pending",       color: "#64748B", bg: "#F1F5F9" },
  connection_sent:  { label: "📤 Req Sent",      color: "#2563EB", bg: "#EFF6FF" },
  connected:        { label: "🤝 Connected",     color: "#7C3AED", bg: "#F5F3FF" },
  followup_1_sent:  { label: "✉️ F/U 1 Sent",   color: "#D97706", bg: "#FFF7ED" },
  followup_2_sent:  { label: "✉️ F/U 2 Sent",   color: "#D97706", bg: "#FFF7ED" },
  followup_3_sent:  { label: "✉️ F/U 3 Sent",   color: "#D97706", bg: "#FFF7ED" },
  replied:          { label: "💬 Replied",       color: "#059669", bg: "#ECFDF5" },
  converted:        { label: "🎯 Converted",     color: "#065F46", bg: "#D1FAE5" },
  not_interested:   { label: "❌ Not Interested",color: "#DC2626", bg: "#FEF2F2" },
  no_response:      { label: "😶 No Response",   color: "#94A3B8", bg: "#F8FAFC" },
};

const OBJECTIVE_LABELS: Record<string, string> = {
  lead_generation: "Lead Generation", partnership: "Partnership / BD",
  recruitment: "Recruiting", brand_awareness: "Brand Awareness",
  event_promotion: "Event Promotion", product_launch: "Product Launch",
};

export default function LinkedInOutreach() {
  const [sequences, setSequences]     = useState<Sequence[]>([]);
  const [contacts, setContacts]       = useState<Contact[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [active, setActive]           = useState<Sequence | null>(null);
  const [tab, setTab]                 = useState<"sequences" | "new" | "contacts" | "messages">("sequences");
  const [toast, setToast]             = useState("");
  const [saving, setSaving]           = useState(false);
  const [genAi, setGenAi]             = useState(false);
  const [aiMessages, setAiMessages]   = useState<{ tips?: string[]; subject_angles?: string[] } | null>(null);
  const [bulkText, setBulkText]       = useState("");
  const [addingContacts, setAddingContacts] = useState(false);
  const [aiForm, setAiForm]           = useState({ brand_name: "", your_role: "", value_prop: "", tone: "professional" });
  const [form, setForm] = useState({
    name: "", objective: "lead_generation", target_title: "", target_industry: "",
    connection_message: "", followup_1_message: "", followup_1_delay_days: "3",
    followup_2_message: "", followup_2_delay_days: "7",
    followup_3_message: "", followup_3_delay_days: "14", daily_connection_limit: "20"
  });

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiGet("/api/linkedin-outreach/sequences");
    if (r?.sequences) setSequences(r.sequences);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openSequence(seq: Sequence) {
    setActive(seq);
    setAiMessages(null);
    setContacts([]);
    setForm({
      name: seq.name, objective: seq.objective,
      target_title: seq.target_title || "", target_industry: seq.target_industry || "",
      connection_message: seq.connection_message || "",
      followup_1_message: seq.followup_1_message || "", followup_1_delay_days: String(seq.followup_1_delay_days),
      followup_2_message: seq.followup_2_message || "", followup_2_delay_days: String(seq.followup_2_delay_days),
      followup_3_message: seq.followup_3_message || "", followup_3_delay_days: String(seq.followup_3_delay_days),
      daily_connection_limit: String(seq.daily_connection_limit)
    });
    setTab("messages");
    setLoadingContacts(true);
    const r = await apiGet(`/api/linkedin-outreach/contacts/${seq.id}`);
    if (r?.contacts) setContacts(r.contacts);
    setLoadingContacts(false);
  }

  async function handleCreate() {
    if (!form.name) { showToast("Sequence name required."); return; }
    setSaving(true);
    const r = await apiPost("/api/linkedin-outreach/sequences", { ...form, followup_1_delay_days: +form.followup_1_delay_days, followup_2_delay_days: +form.followup_2_delay_days, followup_3_delay_days: +form.followup_3_delay_days, daily_connection_limit: +form.daily_connection_limit });
    if (r?.ok) {
      showToast("✅ Sequence created!");
      setSequences(prev => [r.sequence, ...prev]);
      setActive(r.sequence);
      setTab("messages");
    } else { showToast("Error creating sequence."); }
    setSaving(false);
  }

  async function handleSaveMessages() {
    if (!active) return;
    setSaving(true);
    const r = await apiPut(`/api/linkedin-outreach/sequences/${active.id}`, {
      connection_message: form.connection_message,
      followup_1_message: form.followup_1_message, followup_1_delay_days: +form.followup_1_delay_days,
      followup_2_message: form.followup_2_message, followup_2_delay_days: +form.followup_2_delay_days,
      followup_3_message: form.followup_3_message, followup_3_delay_days: +form.followup_3_delay_days,
    });
    if (r?.ok) showToast("✅ Messages saved!");
    else showToast("Save failed.");
    setSaving(false);
  }

  async function handleAiGenerate() {
    if (!active) return;
    if (!aiForm.value_prop) { showToast("Enter your value proposition first."); return; }
    setGenAi(true);
    const r = await apiPost(`/api/linkedin-outreach/sequences/${active.id}/ai-generate`, aiForm);
    if (r?.ok && r?.messages) {
      setForm(f => ({
        ...f,
        connection_message: r.messages.connection_message || f.connection_message,
        followup_1_message: r.messages.followup_1_message || f.followup_1_message,
        followup_2_message: r.messages.followup_2_message || f.followup_2_message,
        followup_3_message: r.messages.followup_3_message || f.followup_3_message,
      }));
      setAiMessages({ tips: r.messages.tips, subject_angles: r.messages.subject_angles });
      showToast("✅ AI generated your message sequence!");
    } else {
      showToast(r?.error?.includes("key") ? "⚠️ OpenAI key required — configure it in AI Providers." : "Generation failed.");
    }
    setGenAi(false);
  }

  async function handleAddContacts() {
    if (!active || !bulkText.trim()) { showToast("Paste contact data first."); return; }
    setAddingContacts(true);
    const lines = bulkText.trim().split("\n").filter(Boolean);
    const parsed: Record<string, string>[] = lines.map(line => {
      const parts = line.split(/[,\t]/).map(s => s.trim());
      return { first_name: parts[0] || "", last_name: parts[1] || "", title: parts[2] || "", company: parts[3] || "", linkedin_url: parts[4] || "" };
    });
    const r = await apiPost("/api/linkedin-outreach/contacts", { sequence_id: active.id, contacts: parsed });
    if (r?.ok) {
      showToast(`✅ Added ${r.added} contact(s)!`);
      setBulkText("");
      const fresh = await apiGet(`/api/linkedin-outreach/contacts/${active.id}`);
      if (fresh?.contacts) setContacts(fresh.contacts);
    } else { showToast("Failed to add contacts."); }
    setAddingContacts(false);
  }

  async function handleUpdateStatus(contactId: number, status: string) {
    const r = await apiPost(`/api/linkedin-outreach/contacts/${contactId}/status`, { status });
    if (r?.ok) {
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, status } : c));
    }
  }

  async function handleDeleteContact(contactId: number) {
    await apiDelete(`/api/linkedin-outreach/contacts/${contactId}`);
    setContacts(prev => prev.filter(c => c.id !== contactId));
  }

  const card:   React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 2px 8px rgba(10,20,50,.06)" };
  const input:  React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", boxSizing: "border-box" };
  const lbl:    React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 5 };
  const btnPri: React.CSSProperties = { padding: "10px 22px", background: "linear-gradient(135deg,#0A66C2,#7C3AED)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" };

  const connectRate = active ? (Number(active.connected_count) / Math.max(1, Number(active.sent_count)) * 100).toFixed(0) : "0";
  const replyRate   = active ? (Number(active.replied_count) / Math.max(1, Number(active.connected_count)) * 100).toFixed(0) : "0";

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "#0A1628", color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Reach › Outreach</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>💼 LinkedIn Outreach Automation</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>Build connection request + follow-up sequences for LinkedIn B2B outreach. AI writes the messages, you track who connected, replied, and converted.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {([
          ["sequences", `📋 Sequences (${sequences.length})`],
          ["new", "➕ New Sequence"],
          ...(active ? [["messages", "✉️ Messages"], ["contacts", `👥 Contacts (${contacts.length})`]] : [])
        ] as [string,string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as "sequences"|"new"|"messages"|"contacts")} style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#0A66C2" : "transparent"}`, color: tab === t ? "#0A66C2" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: "pointer", marginBottom: -2 }}>
            {label}
          </button>
        ))}
      </div>

      {/* Sequences list */}
      {tab === "sequences" && (
        <div>
          {loading ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 60 }}>Loading…</div> :
            sequences.length === 0 ? (
              <div style={{ ...card, textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: "3rem", marginBottom: 8 }}>💼</div>
                <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "1rem" }}>No sequences yet</div>
                <div style={{ color: "#64748B", fontSize: "0.84rem", marginTop: 4 }}>Create a sequence, add contacts, and let AI write your connection messages.</div>
                <button onClick={() => setTab("new")} style={{ ...btnPri, marginTop: 16 }}>➕ Create Sequence</button>
              </div>
            ) : sequences.map(seq => (
              <div key={seq.id} style={{ ...card, cursor: "pointer" }} onClick={() => openSequence(seq)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem" }}>{seq.name}</div>
                    <div style={{ color: "#64748B", fontSize: "0.75rem", marginTop: 2 }}>
                      {OBJECTIVE_LABELS[seq.objective] || seq.objective}
                      {seq.target_title && ` · ${seq.target_title}`}
                      {seq.target_industry && ` · ${seq.target_industry}`}
                    </div>
                  </div>
                  <span style={{ background: seq.status === "active" ? "#ECFDF5" : "#F1F5F9", color: seq.status === "active" ? "#065F46" : "#64748B", padding: "3px 10px", borderRadius: 99, fontSize: "0.68rem", fontWeight: 700 }}>
                    {seq.status === "active" ? "▶️ Active" : "⏸ Paused"}
                  </span>
                </div>
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8, textAlign: "center" }}>
                  {[
                    ["👥 Total",     seq.total_count],
                    ["📤 Sent",      seq.sent_count],
                    ["🤝 Connected", seq.connected_count],
                    ["💬 Replied",   seq.replied_count],
                    ["🎯 Converted", seq.converted_count],
                    ["📊 Conn %",    `${Math.round(Number(seq.connected_count)/Math.max(1,Number(seq.sent_count))*100)}%`],
                  ].map(([l, v]) => (
                    <div key={l as string} style={{ background: "#F8FAFC", borderRadius: 8, padding: "6px 4px" }}>
                      <div style={{ fontSize: "0.62rem", color: "#64748B" }}>{l}</div>
                      <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.82rem" }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* New sequence form */}
      {tab === "new" && (
        <div style={{ maxWidth: 640 }}>
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>Create LinkedIn Sequence</div>
            <div style={{ display: "grid", gap: 12 }}>
              <div><label style={lbl}>Sequence Name *</label><input style={input} placeholder="SaaS CTOs — Q3 Outreach" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div>
                <label style={lbl}>Objective</label>
                <select style={input} value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))}>
                  {Object.entries(OBJECTIVE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={lbl}>Target Job Title</label><input style={input} placeholder="VP of Marketing" value={form.target_title} onChange={e => setForm(f => ({ ...f, target_title: e.target.value }))} /></div>
                <div><label style={lbl}>Target Industry</label><input style={input} placeholder="B2B SaaS" value={form.target_industry} onChange={e => setForm(f => ({ ...f, target_industry: e.target.value }))} /></div>
              </div>
              <div><label style={lbl}>Daily Connection Limit</label><input style={input} type="number" max={50} value={form.daily_connection_limit} onChange={e => setForm(f => ({ ...f, daily_connection_limit: e.target.value }))} /><div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 2 }}>LinkedIn recommends ≤20/day for new accounts, ≤50/day for established profiles.</div></div>
            </div>
            <button onClick={handleCreate} disabled={saving} style={{ ...btnPri, marginTop: 14, width: "100%", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Creating…" : "💼 Create Sequence"}
            </button>
          </div>
        </div>
      )}

      {/* Messages editor */}
      {tab === "messages" && active && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>
          <div>
            {/* AI Generator */}
            <div style={{ ...card, background: "#F5F3FF", border: "1px solid #DDD6FE" }}>
              <div style={{ fontWeight: 800, color: "#7C3AED", marginBottom: 10 }}>🤖 AI Message Generator</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div><label style={lbl}>Your Brand / Company</label><input style={input} placeholder="Acme Corp" value={aiForm.brand_name} onChange={e => setAiForm(f => ({ ...f, brand_name: e.target.value }))} /></div>
                <div><label style={lbl}>Your Role</label><input style={input} placeholder="Head of Growth" value={aiForm.your_role} onChange={e => setAiForm(f => ({ ...f, your_role: e.target.value }))} /></div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>Value Proposition *</label>
                <textarea style={{ ...input, minHeight: 60, resize: "vertical" }} placeholder="We help B2B SaaS companies reduce churn by 30% using AI-powered customer success playbooks" value={aiForm.value_prop} onChange={e => setAiForm(f => ({ ...f, value_prop: e.target.value }))} />
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Tone</label>
                  <select style={input} value={aiForm.tone} onChange={e => setAiForm(f => ({ ...f, tone: e.target.value }))}>
                    {["professional","conversational","direct","friendly","consultative"].map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                  </select>
                </div>
                <button onClick={handleAiGenerate} disabled={genAi} style={{ ...btnPri, padding: "9px 20px", opacity: genAi ? 0.7 : 1, whiteSpace: "nowrap" }}>
                  {genAi ? "Generating…" : "✨ Generate Messages"}
                </button>
              </div>
              {aiMessages?.subject_angles && (
                <div style={{ marginTop: 10, fontSize: "0.75rem", color: "#7C3AED" }}>
                  <strong>Angle suggestions:</strong> {aiMessages.subject_angles.join(" · ")}
                </div>
              )}
            </div>

            {/* Message fields */}
            {[
              { key: "connection_message", label: "🤝 Connection Request", delay: null, limit: 300, placeholder: "Hi [First Name], I noticed you're a [Title] at [Company]…" },
              { key: "followup_1_message", label: "✉️ Follow-up 1", delay: "followup_1_delay_days", limit: 600, placeholder: "Thanks for connecting, [First Name]! I wanted to share…" },
              { key: "followup_2_message", label: "✉️ Follow-up 2", delay: "followup_2_delay_days", limit: 500, placeholder: "Hi [First Name], wanted to quickly follow up…" },
              { key: "followup_3_message", label: "✉️ Follow-up 3 (last nudge)", delay: "followup_3_delay_days", limit: 400, placeholder: "Hey [First Name], last message from me — promise!" },
            ].map(({ key, label, delay, limit, placeholder }) => (
              <div key={key} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, color: "#0A1628" }}>{label}</div>
                  {delay && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "#64748B" }}>
                      Send after
                      <input type="number" style={{ ...input, width: 54, padding: "5px 8px", display: "inline-block" }} value={(form as Record<string,string>)[delay]} onChange={e => setForm(f => ({ ...f, [delay]: e.target.value }))} />
                      days
                    </div>
                  )}
                </div>
                <textarea
                  style={{ ...input, minHeight: key === "connection_message" ? 80 : 100, resize: "vertical" }}
                  placeholder={placeholder}
                  value={(form as Record<string,string>)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                />
                <div style={{ fontSize: "0.68rem", color: (form as Record<string,string>)[key]?.length > limit ? "#DC2626" : "#94A3B8", marginTop: 2 }}>
                  {(form as Record<string,string>)[key]?.length || 0}/{limit} chars {key === "connection_message" ? "(LinkedIn limit: 300)" : ""}
                </div>
              </div>
            ))}

            <button onClick={handleSaveMessages} disabled={saving} style={{ ...btnPri, width: "100%", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving…" : "💾 Save Messages"}
            </button>
          </div>

          {/* Stats sidebar */}
          <div>
            <div style={card}>
              <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>{active.name}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {[["🤝 Connect Rate", `${connectRate}%`], ["💬 Reply Rate", `${replyRate}%`], ["👥 Total", active.total_count], ["🎯 Converted", active.converted_count]].map(([l, v]) => (
                  <div key={l as string} style={{ background: "#F8FAFC", borderRadius: 9, padding: "10px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.65rem", color: "#64748B" }}>{l}</div>
                    <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "1rem" }}>{v}</div>
                  </div>
                ))}
              </div>
              <button onClick={() => setTab("contacts")} style={{ width: "100%", padding: "8px", background: "#EFF6FF", border: "none", borderRadius: 8, color: "#2563EB", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>
                👥 Manage Contacts →
              </button>
            </div>

            <div style={{ ...card, background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
              <div style={{ fontWeight: 700, color: "#1D4ED8", fontSize: "0.82rem", marginBottom: 8 }}>💡 LinkedIn Best Practices</div>
              {["Use [First Name] for personalisation", "Keep connection requests under 300 chars", "Wait 3+ days before first follow-up", "Don't pitch in the connection request", "Cap at 20 connection requests/day", "Personalise using title + company in message 1"].map((tip, i) => (
                <div key={i} style={{ fontSize: "0.75rem", color: "#1D4ED8", marginBottom: 4 }}>• {tip}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Contacts tab */}
      {tab === "contacts" && active && (
        <div>
          {/* Bulk add */}
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 8 }}>➕ Add Contacts</div>
            <div style={{ fontSize: "0.75rem", color: "#64748B", marginBottom: 8 }}>Paste CSV rows: <code style={{ background: "#F1F5F9", padding: "1px 5px", borderRadius: 4 }}>First Name, Last Name, Title, Company, LinkedIn URL</code> — one per line</div>
            <textarea style={{ ...input, minHeight: 100, resize: "vertical", fontFamily: "monospace", fontSize: "0.78rem" }} placeholder={"Sarah,Johnson,VP Marketing,Acme Corp,https://linkedin.com/in/sarahjohnson\nJohn,Smith,CTO,TechCo,https://linkedin.com/in/johnsmith"} value={bulkText} onChange={e => setBulkText(e.target.value)} />
            <button onClick={handleAddContacts} disabled={addingContacts} style={{ ...btnPri, marginTop: 10, opacity: addingContacts ? 0.7 : 1 }}>
              {addingContacts ? "Adding…" : `➕ Add ${bulkText.trim().split("\n").filter(Boolean).length || 0} Contacts`}
            </button>
          </div>

          {/* Contacts list */}
          {loadingContacts ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 40 }}>Loading…</div> : (
            <div>
              {contacts.length === 0 ? (
                <div style={{ ...card, textAlign: "center", padding: "40px 20px", color: "#94A3B8" }}>No contacts yet — add some above.</div>
              ) : contacts.map(c => {
                const sc = STATUS_CONFIG[c.status] || STATUS_CONFIG.pending;
                return (
                  <div key={c.id} style={{ ...card, padding: "14px 20px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.88rem" }}>{[c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown"}</div>
                        <div style={{ color: "#64748B", fontSize: "0.73rem" }}>{[c.title, c.company].filter(Boolean).join(" · ")}</div>
                        {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" style={{ fontSize: "0.7rem", color: "#0A66C2", textDecoration: "none" }}>LinkedIn →</a>}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ background: sc.bg, color: sc.color, padding: "3px 8px", borderRadius: 99, fontSize: "0.65rem", fontWeight: 700 }}>{sc.label}</span>
                        <select style={{ padding: "4px 6px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: "0.72rem", color: "#374151", cursor: "pointer" }}
                          value={c.status}
                          onChange={e => handleUpdateStatus(c.id, e.target.value)}>
                          {Object.entries(STATUS_CONFIG).map(([s, cfg]) => <option key={s} value={s}>{cfg.label}</option>)}
                        </select>
                        <button onClick={() => handleDeleteContact(c.id)} style={{ background: "transparent", border: "none", color: "#DC2626", cursor: "pointer", fontSize: "0.85rem" }}>🗑</button>
                      </div>
                    </div>
                    {c.reply_snippet && <div style={{ marginTop: 8, background: "#ECFDF5", border: "1px solid #6EE7B7", borderRadius: 7, padding: "6px 10px", fontSize: "0.75rem", color: "#065F46" }}>💬 {c.reply_snippet}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Campaign {
  id: number;
  name: string;
  channel: "rcs" | "apple_messages";
  message_body: string;
  rich_card: string | null;
  cta_buttons: string | null;
  sender_name: string | null;
  status: string;
  recipient_count: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  reply_count: number;
  created_at: string;
  sent_at: string | null;
}

interface AiResult {
  plain_text: string;
  rich_card?: { title: string; description: string; layout: string; media_url?: string };
  cta_buttons?: { type: string; label: string; value: string }[];
  suggested_replies?: string[];
  sender_name?: string;
  best_send_time?: string;
  personalisation_tips?: string[];
}

const CHANNEL_CONFIG = {
  rcs:            { label: "💬 RCS (Android)",         color: "#4285F4", bg: "#EEF2FF" },
  apple_messages: { label: "🍎 Apple Messages",        color: "#34C759", bg: "#F0FDF4" },
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  draft:     { label: "📝 Draft",     bg: "#F1F5F9", color: "#64748B" },
  sending:   { label: "🔄 Sending",   bg: "#FFF7ED", color: "#D97706" },
  sent:      { label: "✅ Sent",      bg: "#ECFDF5", color: "#065F46" },
  completed: { label: "✅ Complete",  bg: "#F0F9FF", color: "#0369A1" },
};

export default function RcsCampaigns() {
  const [campaigns, setCampaigns]   = useState<Campaign[]>([]);
  const [loading, setLoading]       = useState(true);
  const [active, setActive]         = useState<Campaign | null>(null);
  const [aiResult, setAiResult]     = useState<AiResult | null>(null);
  const [genAi, setGenAi]           = useState(false);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState("");
  const [tab, setTab]               = useState<"campaigns" | "new">("campaigns");
  const [aiForm, setAiForm]         = useState({ channel: "rcs", goal: "", brand_name: "", offer: "", target_audience: "", cta_label: "Learn More", cta_url: "" });
  const [form, setForm]             = useState({ name: "", channel: "rcs", message_body: "", sender_name: "", media_url: "" });
  const [sendRecipients, setSendRecipients] = useState("");
  const [sending, setSending]       = useState(false);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiGet<{ ok: boolean; error?: string; campaigns?: Campaign[] }>("/api/rcs/campaigns");
    if (r?.campaigns) setCampaigns(r.campaigns);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAiGenerate() {
    if (!aiForm.goal) { showToast("Enter a campaign goal first."); return; }
    setGenAi(true);
    const r = await apiPost<{ ok: boolean; error?: string; generated?: AiResult }>("/api/rcs/campaigns/0/ai-generate", aiForm);
    if (r?.ok && r?.generated) {
      const generated = r.generated;
      setAiResult(generated);
      setForm(f => ({
        ...f,
        channel: aiForm.channel,
        name: f.name || `${aiForm.brand_name || "Campaign"} — ${new Date().toLocaleDateString()}`,
        message_body: generated.plain_text || "",
        sender_name: generated.sender_name || f.sender_name,
      }));
      showToast("✅ AI generated your RCS message!");
      setTab("new");
    } else {
      showToast(r?.error?.includes("key") ? "⚠️ OpenAI key required — configure it in AI Providers." : "AI generation failed.");
    }
    setGenAi(false);
  }

  async function handleCreate() {
    if (!form.name || !form.message_body) { showToast("Name and message body required."); return; }
    setSaving(true);
    const payload = { ...form, rich_card: aiResult?.rich_card || undefined, cta_buttons: aiResult?.cta_buttons || undefined };
    const r = await apiPost<{ ok: boolean; error?: string; campaign?: Campaign }>("/api/rcs/campaigns/create", payload);
    if (r?.ok && r.campaign) {
      const campaign = r.campaign;
      showToast("✅ Campaign created!");
      setCampaigns(prev => [campaign, ...prev]);
      setActive(campaign);
      setForm({ name: "", channel: "rcs", message_body: "", sender_name: "", media_url: "" });
      setAiResult(null);
      setTab("campaigns");
    } else { showToast("Error creating campaign."); }
    setSaving(false);
  }

  async function handleSend(id: number) {
    const phones = sendRecipients.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    if (phones.length === 0) { showToast("Enter at least one phone number to send to."); return; }
    setSending(true);
    const r = await apiPost(`/api/rcs/campaigns/${id}/send`, { recipients: phones.map(p => ({ phone: p })) });
    if (r?.ok) {
      showToast(`✅ Queued ${r.queued || phones.length} messages!`);
      setSendRecipients("");
      load();
    } else { showToast("Send failed."); }
    setSending(false);
  }

  const card:   React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 2px 8px rgba(10,20,50,.06)" };
  const input:  React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.85rem", color: "#0A1628", boxSizing: "border-box" };
  const lbl:    React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 5 };
  const btnPri: React.CSSProperties = { padding: "10px 22px", background: "linear-gradient(135deg,#4285F4,#34C759)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" };

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: '#eef4ff', color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Reach › Next-Gen Messaging</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>💬 RCS & Apple Messages</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>Send rich interactive messages via RCS (Android) and Apple Messages for Business — with image cards, CTA buttons, and suggested replies. AI generates the full campaign in one click.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {([["campaigns","📋 Campaigns"], ["new","🤖 AI Generate + Create"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#4285F4" : "transparent"}`, color: tab === t ? "#4285F4" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: "pointer", marginBottom: -2 }}>
            {label}{t === "campaigns" ? ` (${campaigns.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "new" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* AI Generator */}
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 4 }}>🤖 AI Message Generator</div>
            <div style={{ color: "#64748B", fontSize: "0.78rem", marginBottom: 14 }}>Describe your campaign and AI will generate the full rich message — plain text fallback, rich card, CTA buttons, and suggested replies.</div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={lbl}>Channel</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {(["rcs","apple_messages"] as const).map(ch => {
                    const cc = CHANNEL_CONFIG[ch];
                    return <div key={ch} onClick={() => setAiForm(f => ({ ...f, channel: ch }))} style={{ padding: "10px 12px", border: `2px solid ${aiForm.channel === ch ? cc.color : "#E2E8F0"}`, borderRadius: 9, cursor: "pointer", background: aiForm.channel === ch ? cc.bg : "#fff", textAlign: "center" }}>
                      <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.82rem" }}>{cc.label}</div>
                    </div>;
                  })}
                </div>
              </div>
              <div><label style={lbl}>Campaign Goal *</label><input style={input} placeholder="Drive 50 bookings for our summer sale" value={aiForm.goal} onChange={e => setAiForm(f => ({ ...f, goal: e.target.value }))} /></div>
              <div><label style={lbl}>Brand Name</label><input style={input} placeholder="YourBrand" value={aiForm.brand_name} onChange={e => setAiForm(f => ({ ...f, brand_name: e.target.value }))} /></div>
              <div><label style={lbl}>Offer / Promotion</label><input style={input} placeholder="30% off this weekend only" value={aiForm.offer} onChange={e => setAiForm(f => ({ ...f, offer: e.target.value }))} /></div>
              <div><label style={lbl}>Target Audience</label><input style={input} placeholder="Existing customers who haven't purchased in 90 days" value={aiForm.target_audience} onChange={e => setAiForm(f => ({ ...f, target_audience: e.target.value }))} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={lbl}>CTA Label</label><input style={input} placeholder="Shop Now" value={aiForm.cta_label} onChange={e => setAiForm(f => ({ ...f, cta_label: e.target.value }))} /></div>
                <div><label style={lbl}>CTA URL</label><input style={input} placeholder="https://yourdomain.com" value={aiForm.cta_url} onChange={e => setAiForm(f => ({ ...f, cta_url: e.target.value }))} /></div>
              </div>
            </div>
            <button onClick={handleAiGenerate} disabled={genAi} style={{ ...btnPri, marginTop: 14, width: "100%", opacity: genAi ? 0.7 : 1 }}>
              {genAi ? "Generating…" : "🤖 Generate RCS Campaign"}
            </button>
          </div>

          {/* Campaign builder */}
          <div style={card}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>✏️ Campaign Details</div>
            <div style={{ display: "grid", gap: 10 }}>
              <div><label style={lbl}>Campaign Name *</label><input style={input} placeholder="Summer Sale — RCS Push" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div>
                <label style={lbl}>Message Body * <span style={{ color: "#94A3B8", textTransform: "none", fontWeight: 400 }}>(plain text / SMS fallback, ≤160 chars ideal)</span></label>
                <textarea style={{ ...input, minHeight: 90, resize: "vertical" }} placeholder="Hi [Name], your exclusive offer is waiting…" value={form.message_body} onChange={e => setForm(f => ({ ...f, message_body: e.target.value }))} />
                <div style={{ fontSize: "0.7rem", color: form.message_body.length > 160 ? "#D97706" : "#94A3B8", marginTop: 2 }}>{form.message_body.length} chars {form.message_body.length > 160 ? "— over SMS limit (RCS will use rich fallback)" : ""}</div>
              </div>
              <div><label style={lbl}>Sender Name</label><input style={input} placeholder="YourBrand" value={form.sender_name} onChange={e => setForm(f => ({ ...f, sender_name: e.target.value }))} /></div>
              <div><label style={lbl}>Media URL (image for rich card)</label><input style={input} placeholder="https://…/banner.jpg" value={form.media_url} onChange={e => setForm(f => ({ ...f, media_url: e.target.value }))} /></div>
            </div>

            {aiResult && (
              <div style={{ marginTop: 14, background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontWeight: 800, color: "#7C3AED", fontSize: "0.82rem", marginBottom: 8 }}>🤖 AI-Generated Extras</div>
                {aiResult.rich_card && <div style={{ fontSize: "0.75rem", color: "#374151", marginBottom: 4 }}>📇 Rich Card: <strong>{aiResult.rich_card.title}</strong></div>}
                {aiResult.cta_buttons && <div style={{ fontSize: "0.75rem", color: "#374151", marginBottom: 4 }}>🔘 {aiResult.cta_buttons.length} CTA button(s): {aiResult.cta_buttons.map(b => b.label).join(", ")}</div>}
                {aiResult.suggested_replies && <div style={{ fontSize: "0.75rem", color: "#374151", marginBottom: 4 }}>💬 Suggested replies: {aiResult.suggested_replies.slice(0, 3).join(", ")}</div>}
                {aiResult.best_send_time && <div style={{ fontSize: "0.75rem", color: "#7C3AED" }}>⏰ Best send time: {aiResult.best_send_time}</div>}
              </div>
            )}

            <button onClick={handleCreate} disabled={saving} style={{ ...btnPri, marginTop: 14, width: "100%", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Creating…" : "💬 Create Campaign"}
            </button>
          </div>
        </div>
      )}

      {tab === "campaigns" && (
        <div style={{ display: "grid", gridTemplateColumns: active ? "1fr 380px" : "1fr", gap: 20 }}>
          <div>
            {loading ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 60 }}>Loading…</div> :
              campaigns.length === 0 ? (
                <div style={{ ...card, textAlign: "center", padding: "50px 20px" }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>💬</div>
                  <div style={{ fontWeight: 700, color: "#0A1628" }}>No RCS campaigns yet</div>
                  <div style={{ color: "#64748B", fontSize: "0.82rem", marginTop: 4 }}>Switch to &ldquo;AI Generate + Create&rdquo; to build your first rich message campaign.</div>
                </div>
              ) : campaigns.map(c => {
                const cc = CHANNEL_CONFIG[c.channel] || CHANNEL_CONFIG.rcs;
                const sc = STATUS_CONFIG[c.status] || STATUS_CONFIG.draft;
                const delivRate = c.sent_count > 0 ? Math.round((c.delivered_count / c.sent_count) * 100) : 0;
                const readRate  = c.delivered_count > 0 ? Math.round((c.read_count / c.delivered_count) * 100) : 0;
                return (
                  <div key={c.id} onClick={() => setActive(c)} style={{ ...card, cursor: "pointer", borderLeft: `4px solid ${cc.color}`, background: active?.id === c.id ? "#F8FAFF" : "#fff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.9rem" }}>{c.name}</div>
                        <div style={{ color: "#64748B", fontSize: "0.72rem", marginTop: 2 }}>
                          <span style={{ background: cc.bg, color: cc.color, padding: "2px 7px", borderRadius: 99, fontWeight: 700, fontSize: "0.68rem" }}>{cc.label}</span>
                          {" · "}{new Date(c.created_at).toLocaleDateString()}
                          {c.sender_name && ` · From: ${c.sender_name}`}
                        </div>
                      </div>
                      <span style={{ background: sc.bg, color: sc.color, padding: "3px 9px", borderRadius: 99, fontSize: "0.68rem", fontWeight: 700 }}>{sc.label}</span>
                    </div>
                    <div style={{ color: "#374151", fontSize: "0.76rem", marginTop: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message_body}</div>
                    {c.sent_count > 0 && (
                      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6, textAlign: "center" }}>
                        {[["📤 Sent", c.sent_count], ["📬 Delivered", c.delivered_count], ["👁 Read", c.read_count], ["💬 Reply", c.reply_count], ["📬 Rate", `${delivRate}%`]].map(([l, v]) => (
                          <div key={l as string} style={{ background: "#F8FAFC", borderRadius: 7, padding: "4px 2px" }}>
                            <div style={{ fontSize: "0.62rem", color: "#64748B" }}>{l}</div>
                            <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.78rem" }}>{v}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Send panel */}
          {active && (
            <div>
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 900, color: "#0A1628" }}>{active.name}</div>
                  <button onClick={() => setActive(null)} style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer" }}>✕</button>
                </div>

                <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9, padding: "12px 14px", marginBottom: 16 }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", marginBottom: 4 }}>Message Preview</div>
                  <div style={{ fontSize: "0.82rem", color: "#0A1628", lineHeight: 1.6 }}>{active.message_body}</div>
                  {active.sender_name && <div style={{ fontSize: "0.7rem", color: "#64748B", marginTop: 6 }}>From: {active.sender_name}</div>}
                </div>

                {active.status === "draft" && (
                  <div>
                    <label style={lbl}>Recipients (phone numbers, one per line or comma-separated)</label>
                    <textarea style={{ ...input, minHeight: 100, resize: "vertical", fontFamily: "monospace", fontSize: "0.78rem" }} placeholder={"+44 7700 900123\n+1 415 555 0100\n..."} value={sendRecipients} onChange={e => setSendRecipients(e.target.value)} />
                    <div style={{ fontSize: "0.7rem", color: "#64748B", marginTop: 3 }}>
                      {sendRecipients.split(/[\n,]/).filter(s => s.trim()).length} recipient(s) · max 1,000 per send
                    </div>
                    <button onClick={() => handleSend(active.id)} disabled={sending} style={{ marginTop: 10, width: "100%", padding: "10px", background: "#4285F4", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer", opacity: sending ? 0.7 : 1 }}>
                      {sending ? "Queueing…" : `📤 Send to ${sendRecipients.split(/[\n,]/).filter(s => s.trim()).length || "—"} Recipients`}
                    </button>
                    <div style={{ marginTop: 8, fontSize: "0.72rem", color: "#94A3B8", textAlign: "center" }}>Delivery depends on carrier RCS support and Apple Business registration. Messages fall back to SMS where unsupported.</div>
                  </div>
                )}

                {active.status !== "draft" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {[["📤 Sent", active.sent_count], ["📬 Delivered", active.delivered_count], ["👁 Read", active.read_count], ["💬 Replies", active.reply_count]].map(([l, v]) => (
                      <div key={l as string} style={{ background: "#F8FAFC", borderRadius: 10, padding: "12px", textAlign: "center" }}>
                        <div style={{ fontSize: "0.7rem", color: "#64748B" }}>{l}</div>
                        <div style={{ fontWeight: 900, color: "#0A1628", fontSize: "1.2rem" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

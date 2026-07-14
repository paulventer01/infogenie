"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface PixelConfig {
  id: number;
  platform: string;
  pixel_id: string;
  enabled: boolean;
  test_result: { ok: boolean; message: string } | null;
  created_at: string;
  updated_at: string;
}

interface CAPIEvent {
  id: number;
  platform: string;
  event_name: string;
  status: string;
  created_at: string;
}

const PLATFORMS = [
  {
    id: "meta",
    label: "Meta (Facebook/Instagram)",
    icon: "📘",
    color: "#1877F2",
    idLabel: "Pixel ID",
    idPlaceholder: "e.g. 1234567890123456",
    needsToken: true,
    tokenLabel: "Conversions API Access Token",
    tokenPlaceholder: "EAAx… (from Meta Events Manager)",
    docsUrl: "https://www.facebook.com/business/help/952192354843755",
    snippet: (pid: string) => `<!-- Meta Pixel -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pid}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${pid}&ev=PageView&noscript=1"/></noscript>`,
  },
  {
    id: "linkedin",
    label: "LinkedIn Insight Tag",
    icon: "💼",
    color: "#0A66C2",
    idLabel: "Partner ID",
    idPlaceholder: "e.g. 1234567",
    needsToken: false,
    tokenLabel: "",
    tokenPlaceholder: "",
    docsUrl: "https://www.linkedin.com/help/lms/answer/a418880",
    snippet: (pid: string) => `<!-- LinkedIn Insight Tag -->
<script type="text/javascript">
_linkedin_partner_id = "${pid}";
window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
window._linkedin_data_partner_ids.push(_linkedin_partner_id);
</script><script type="text/javascript">
(function(l) {
if (!l){window.lintrk = function(a,b){window.lintrk.q.push([a,b])};
window.lintrk.q=[]}
var s = document.getElementsByTagName("script")[0];
var b = document.createElement("script");
b.type = "text/javascript";b.async = true;
b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
s.parentNode.insertBefore(b, s);})(window.lintrk);
</script>
<noscript>
<img height="1" width="1" style="display:none;" alt="" src="https://px.ads.linkedin.com/collect/?pid=${pid}&fmt=gif" />
</noscript>`,
  },
  {
    id: "tiktok",
    label: "TikTok Pixel",
    icon: "🎵",
    color: "#010101",
    idLabel: "Pixel ID",
    idPlaceholder: "e.g. C1ABCDEFGH1234567890",
    needsToken: false,
    tokenLabel: "",
    tokenPlaceholder: "",
    docsUrl: "https://ads.tiktok.com/help/article/pixel-install",
    snippet: (pid: string) => `<!-- TikTok Pixel -->
<script>
!function (w, d, t) {
  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
  ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
  ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
  for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
  ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
  ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
  ttq.load('${pid}');
  ttq.page();
}(window, document, 'ttq');
</script>`,
  },
];

export default function PixelManager() {
  const [configs, setConfigs] = useState<PixelConfig[]>([]);
  const [capiLog, setCAPILog] = useState<CAPIEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<"pixels" | "capi" | "log">("pixels");
  const [forms, setForms] = useState<Record<string, { pixelId: string; token: string; enabled: boolean }>>({});
  const [capiForm, setCapiForm] = useState({ event_name: "Purchase", email: "", url: "", custom_data: "" });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    const [cfgR, logR] = await Promise.all([apiGet("/api/pixel-manager/configs"), apiGet("/api/pixel-manager/capi-log")]);
    if (cfgR?.configs) {
      setConfigs(cfgR.configs);
      const initForms: typeof forms = {};
      for (const plat of PLATFORMS) {
        const c = (cfgR.configs as PixelConfig[]).find(x => x.platform === plat.id);
        initForms[plat.id] = { pixelId: c?.pixel_id || "", token: "", enabled: c?.enabled !== false };
      }
      setForms(initForms);
    }
    if (logR?.events) setCAPILog(logR.events);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function savePlatform(platformId: string) {
    const f = forms[platformId];
    if (!f?.pixelId) { showToast("Pixel ID is required."); return; }
    setSaving(platformId);
    const body: Record<string, unknown> = { platform: platformId, pixel_id: f.pixelId, enabled: f.enabled };
    if (f.token) body.access_token = f.token;
    const r = await apiPost("/api/pixel-manager/configs", body);
    if (r?.ok) {
      setConfigs(prev => { const idx = prev.findIndex(c => c.platform === platformId); return idx >= 0 ? prev.map(c => c.platform === platformId ? r.config : c) : [r.config, ...prev]; });
      showToast(`✅ ${platformId} pixel saved`);
    } else { showToast("Error saving."); }
    setSaving(null);
  }

  async function testPlatform(platformId: string) {
    setTesting(platformId);
    const r = await apiPost(`/api/pixel-manager/test/${platformId}`, {});
    if (r?.ok) {
      setConfigs(prev => prev.map(c => c.platform === platformId ? { ...c, test_result: r.result } : c));
      showToast(r.result?.ok ? `✅ ${r.result.message}` : `⚠️ ${r.result?.message}`);
    }
    setTesting(null);
  }

  async function deleteConfig(id: number, platformId: string) {
    await apiDelete(`/api/pixel-manager/configs/${id}`);
    setConfigs(prev => prev.filter(c => c.id !== id));
    setForms(f => ({ ...f, [platformId]: { pixelId: "", token: "", enabled: true } }));
    showToast("Removed.");
  }

  async function sendCAPIEvent() {
    setSaving("capi");
    const body: Record<string, unknown> = { event_name: capiForm.event_name, event_data: { email: capiForm.email, url: capiForm.url } };
    if (capiForm.custom_data) { try { body.event_data = { ...(body.event_data as object), custom_data: JSON.parse(capiForm.custom_data) }; } catch { /* ignore */ } }
    const r = await apiPost("/api/pixel-manager/capi/meta", body);
    if (r?.ok) { showToast("✅ CAPI event sent to Meta!"); load(); }
    else { showToast(`Error: ${r?.error || "send failed"}`); }
    setSaving(null);
  }

  function copySnippet(text: string, key: string) {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2000); });
  }

  const cardStyle: React.CSSProperties = { background: "#fff", border: "1px solid #E8EEF8", borderRadius: 14, padding: "20px 24px", boxShadow: "0 2px 8px rgba(10,20,50,.06)", marginBottom: 16 };
  const inputStyle: React.CSSProperties = { padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: "0.84rem", color: "#0A1628", background: "#fff", width: "100%", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { fontSize: "0.7rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".05em", display: "block", marginBottom: 4 };

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "var(--ig-page)", minHeight: "100vh", padding: "24px 28px" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "#0A1628", color: "#fff", borderRadius: 10, padding: "12px 20px", fontWeight: 600, fontSize: "0.85rem", zIndex: 9999 }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Manage › Pixel Manager</div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#0A1628", margin: "0 0 6px" }}>📡 Platform Pixels & CAPI</h1>
        <p style={{ color: "#475569", fontSize: "0.88rem", margin: 0 }}>Configure Meta Pixel + Conversions API, LinkedIn Insight Tag, and TikTok Pixel — with pixel snippet generation and server-side event forwarding.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E8EEF8", marginBottom: 24 }}>
        {([["pixels", "📡 Pixel Setup"], ["capi", "⚡ Send CAPI Event (Meta)"], ["log", `📋 CAPI Log (${capiLog.length})`]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 18px", background: "transparent", border: "none", borderBottom: `3px solid ${tab === t ? "#0066FF" : "transparent"}`, color: tab === t ? "#0066FF" : "#64748B", fontWeight: tab === t ? 700 : 500, fontSize: "0.84rem", cursor: "pointer", marginBottom: -2, whiteSpace: "nowrap" }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ color: "#94A3B8", textAlign: "center", padding: 60 }}>Loading…</div> : tab === "pixels" ? (
        PLATFORMS.map(plat => {
          const config = configs.find(c => c.platform === plat.id);
          const f = forms[plat.id] || { pixelId: "", token: "", enabled: true };
          const snippet = plat.snippet(f.pixelId || "YOUR_PIXEL_ID");

          return (
            <div key={plat.id} style={{ ...cardStyle, borderLeft: `4px solid ${plat.color}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: "1.5rem" }}>{plat.icon}</span>
                  <div>
                    <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem" }}>{plat.label}</div>
                    {config ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: config.enabled ? "#10B981" : "#94A3B8", display: "inline-block" }} />
                        <span style={{ fontSize: "0.7rem", color: config.enabled ? "#065F46" : "#64748B" }}>{config.enabled ? "Active" : "Disabled"} · ID: {config.pixel_id}</span>
                        {config.test_result && (
                          <span style={{ fontSize: "0.7rem", color: config.test_result.ok ? "#059669" : "#DC2626", fontWeight: 700 }}>
                            {config.test_result.ok ? "✅ Verified" : "⚠️ " + config.test_result.message}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: "0.7rem", color: "#94A3B8" }}>Not configured</span>
                    )}
                  </div>
                </div>
                <a href={plat.docsUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.72rem", color: "#0066FF", textDecoration: "none" }}>📖 Docs →</a>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: plat.needsToken ? "1fr 1fr" : "1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>{plat.idLabel} *</label>
                  <input style={inputStyle} placeholder={plat.idPlaceholder} value={f.pixelId} onChange={e => setForms(prev => ({ ...prev, [plat.id]: { ...prev[plat.id], pixelId: e.target.value } }))} />
                </div>
                {plat.needsToken && (
                  <div>
                    <label style={labelStyle}>{plat.tokenLabel}</label>
                    <input type="password" style={inputStyle} placeholder={plat.tokenPlaceholder} value={f.token} onChange={e => setForms(prev => ({ ...prev, [plat.id]: { ...prev[plat.id], token: e.target.value } }))} />
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                <button onClick={() => savePlatform(plat.id)} disabled={saving === plat.id} style={{ padding: "9px 18px", background: `linear-gradient(135deg,${plat.color},${plat.color}cc)`, border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", opacity: saving === plat.id ? 0.7 : 1 }}>
                  {saving === plat.id ? "Saving…" : "💾 Save"}
                </button>
                {config && (
                  <>
                    <button onClick={() => testPlatform(plat.id)} disabled={testing === plat.id} style={{ padding: "9px 18px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 9, color: "#1D4ED8", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
                      {testing === plat.id ? "Testing…" : "🔍 Verify"}
                    </button>
                    <button onClick={() => deleteConfig(config.id, plat.id)} style={{ padding: "9px 18px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 9, color: "#DC2626", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
                      🗑 Remove
                    </button>
                  </>
                )}
              </div>

              {/* Pixel snippet */}
              {f.pixelId && (
                <div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Pixel Snippet — paste into {"<head>"}</div>
                  <div style={{ background: "#0F172A", borderRadius: 10, padding: "14px 16px", position: "relative" }}>
                    <pre style={{ margin: 0, fontSize: "0.72rem", color: "#94A3B8", lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{snippet}</pre>
                    <button onClick={() => copySnippet(snippet, plat.id)} style={{ position: "absolute", top: 10, right: 10, padding: "5px 12px", background: "#1E293B", border: "1px solid #334155", borderRadius: 6, color: "#94A3B8", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>
                      {copied === plat.id ? "✅ Copied" : "📋 Copy"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      ) : tab === "capi" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={cardStyle}>
            <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 4 }}>⚡ Send Server-Side Event (Meta CAPI)</div>
            <div style={{ fontSize: "0.78rem", color: "#475569", marginBottom: 16 }}>Fires a server-to-server conversion event directly to the Meta Conversions API, bypassing browser ad blockers and iOS tracking restrictions.</div>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={labelStyle}>Event Name *</label>
                <select style={inputStyle} value={capiForm.event_name} onChange={e => setCapiForm(f => ({ ...f, event_name: e.target.value }))}>
                  {["Purchase", "Lead", "CompleteRegistration", "AddToCart", "InitiateCheckout", "ViewContent", "Search", "Contact"].map(ev => (
                    <option key={ev} value={ev}>{ev}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>User Email (hashed automatically)</label>
                <input style={inputStyle} type="email" placeholder="user@example.com" value={capiForm.email} onChange={e => setCapiForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Event Source URL</label>
                <input style={inputStyle} placeholder="https://yourdomain.com/thank-you" value={capiForm.url} onChange={e => setCapiForm(f => ({ ...f, url: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Custom Data (JSON, optional)</label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} placeholder={`{"value": 99.99, "currency": "USD"}`} value={capiForm.custom_data} onChange={e => setCapiForm(f => ({ ...f, custom_data: e.target.value }))} />
              </div>
            </div>
            <button onClick={sendCAPIEvent} disabled={saving === "capi"} style={{ marginTop: 16, padding: "10px 22px", background: "linear-gradient(135deg,#1877F2,#3b5998)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer", width: "100%", opacity: saving === "capi" ? 0.7 : 1 }}>
              {saving === "capi" ? "Sending…" : "📡 Send CAPI Event"}
            </button>
          </div>
          <div style={{ ...cardStyle, background: "#FFFBEB", border: "1px solid #FDE68A" }}>
            <div style={{ fontWeight: 800, color: "#92400E", fontSize: "0.85rem", marginBottom: 8 }}>📘 Why CAPI Matters</div>
            <ul style={{ margin: 0, paddingLeft: 16, color: "#78350F", fontSize: "0.78rem", lineHeight: 2 }}>
              <li>Bypasses iOS 14.5+ tracking restrictions that block browser pixels</li>
              <li>Immune to ad blockers (server-to-server, no client JS)</li>
              <li>Improves event match quality and attribution accuracy</li>
              <li>Required for Meta to optimise bidding correctly</li>
              <li>User PII is SHA-256 hashed before leaving your server</li>
              <li>Requires a Meta Pixel ID + System User Access Token</li>
            </ul>
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 16 }}>CAPI Event Log</div>
          {capiLog.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#94A3B8" }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>📋</div>
              <div style={{ fontWeight: 600 }}>No CAPI events sent yet.</div>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #E8EEF8", color: "#475569", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: ".05em" }}>
                  {["Platform", "Event", "Status", "Time"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {capiLog.map(e => (
                  <tr key={e.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <td style={{ padding: "10px 12px" }}><span style={{ fontWeight: 700, textTransform: "capitalize" }}>{e.platform}</span></td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#1E3A8A" }}>{e.event_name}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ background: e.status === "sent" ? "#D1FAE5" : "#FEF2F2", color: e.status === "sent" ? "#065F46" : "#DC2626", padding: "2px 8px", borderRadius: 99, fontSize: "0.7rem", fontWeight: 700 }}>{e.status}</span>
                    </td>
                    <td style={{ padding: "10px 12px", color: "#64748B", fontSize: "0.78rem" }}>{new Date(e.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

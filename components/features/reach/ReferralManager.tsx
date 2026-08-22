"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Program { id: number; name: string; reward_type: string; reward_value: number; enabled: boolean }
interface Link { id: number; code: string; program_name?: string; referrer_email?: string; clicks: number; conversions: number }
interface Stats { links?: number; clicks?: number; conversions?: number; revenue30d?: number }

export default function ReferralManager() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [name, setName] = useState("Customer referral program");
  const [reward, setReward] = useState(10);
  const [progId, setProgId] = useState<number | "">("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [p, l, s] = await Promise.all([
      apiGet<{ ok?: boolean; programs?: Program[] }>("/api/referrals/programs"),
      apiGet<{ ok?: boolean; links?: Link[] }>("/api/referrals/links"),
      apiGet<{ ok?: boolean } & Stats>("/api/referrals/stats"),
    ]);
    setPrograms(p.programs || []);
    setLinks(l.links || []);
    setStats(s);
    if (p.programs?.length && !progId) setProgId(p.programs[0].id);
  }, [progId]);

  useEffect(() => { load(); }, [load]);

  const createProgram = async () => {
    const r = await apiPost<{ ok?: boolean; error?: string }>("/api/referrals/programs", { name, reward_value: reward });
    setMsg(r.ok ? "Program created." : r.error || "Failed");
    load();
  };

  const createLink = async () => {
    if (!progId) return;
    const r = await apiPost<{ ok?: boolean; link?: Link; error?: string }>("/api/referrals/links", { program_id: progId, referrer_email: email });
    setMsg(r.ok ? `Link created: ?ref=${r.link?.code}` : r.error || "Failed");
    load();
  };

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#fdf4ff 0%,#eef2ff 55%,#ecfdf5 100%)" }}>
        <div className="breadcrumb"><span className="bc-group" style={{ opacity: 0.85 }}>Reach</span> <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Referral Manager</div>
        <h1 className="ih-title">🎁 Referral Program Manager</h1>
        <p className="ih-sub">Launch referral links, track clicks and conversions, and reward advocates — feeds Lead Intelligence when forms include UTM ref codes.</p>
      </div>

      <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
        {msg && <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", padding: 12, borderRadius: 10, marginBottom: 16, fontSize: "0.85rem" }}>{msg}</div>}

        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 18 }}>
            {[["Links", stats.links], ["Clicks", stats.clicks], ["Conversions", stats.conversions], ["Revenue 30d", stats.revenue30d != null ? `$${Math.round(stats.revenue30d)}` : "$0"]].map(([l, v]) => (
              <div key={String(l)} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: "0.65rem", color: "#6B7280", fontWeight: 700 }}>{l}</div>
                <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
            <h3 style={{ margin: "0 0 12px" }}>New program</h3>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Program name" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", marginBottom: 8, boxSizing: "border-box" }} />
            <input type="number" value={reward} onChange={(e) => setReward(Number(e.target.value))} placeholder="Reward %" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", marginBottom: 10, boxSizing: "border-box" }} />
            <button type="button" onClick={createProgram} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "#0f766e", color: "white", fontWeight: 700, cursor: "pointer" }}>Create program</button>
          </div>

          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
            <h3 style={{ margin: "0 0 12px" }}>Issue referral link</h3>
            <select value={progId} onChange={(e) => setProgId(Number(e.target.value))} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", marginBottom: 8 }}>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Referrer email" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", marginBottom: 10, boxSizing: "border-box" }} />
            <button type="button" onClick={createLink} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "#0066FF", color: "white", fontWeight: 700, cursor: "pointer" }}>Generate link</button>
          </div>
        </div>

        {links.length > 0 && (
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginTop: 18 }}>
            <h3 style={{ margin: "0 0 12px" }}>Active links</h3>
            {links.map((l) => (
              <div key={l.id} style={{ padding: "8px 0", borderBottom: "1px solid #F3F4F6", fontSize: "0.82rem", display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span><code>ref={l.code}</code> · {l.program_name}</span>
                <span>{l.clicks} clicks · {l.conversions} conv.</span>
              </div>
            ))}
            <p style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 10 }}>Track: POST /api/referrals/track/:code with {`{ "event": "click" | "conversion" }`}</p>
          </div>
        )}
      </div>
    </div>
  );
}

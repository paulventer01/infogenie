"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Program { id: number; name: string; commission_pct: number; cookie_days: number }
interface Partner { id: number; name: string; email?: string; code: string; clicks: number; conversions: number; earned: number; program_name?: string }
interface Stats { partners?: number; clicks?: number; conversions?: number; earned?: number }

export default function AffiliateHub() {
  const router = useRouter();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [name, setName] = useState("Affiliate program");
  const [pct, setPct] = useState(15);
  const [progId, setProgId] = useState<number | "">("");
  const [partnerName, setPartnerName] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [p, pt, s] = await Promise.all([
      apiGet<{ ok?: boolean; programs?: Program[] }>("/api/affiliates/programs"),
      apiGet<{ ok?: boolean; partners?: Partner[] }>("/api/affiliates/partners"),
      apiGet<{ ok?: boolean } & Stats>("/api/affiliates/stats"),
    ]);
    setPrograms(p.programs || []);
    setPartners(pt.partners || []);
    setStats(s);
    if (p.programs?.length && !progId) setProgId(p.programs[0].id);
  }, [progId]);

  useEffect(() => { load(); }, [load]);

  const createProgram = async () => {
    await apiPost("/api/affiliates/programs", { name, commission_pct: pct });
    setMsg("Affiliate program created.");
    load();
  };

  const addPartner = async () => {
    if (!progId || !partnerName) return;
    const r = await apiPost<{ ok?: boolean; partner?: Partner }>("/api/affiliates/partners", { program_id: progId, name: partnerName });
    setMsg(r.partner ? `Partner code: ${r.partner.code}` : "Partner added.");
    load();
  };

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#fff7ed 0%,#eef2ff 55%,#f0fdf4 100%)" }}>
        <div className="breadcrumb"><span className="bc-group" style={{ opacity: 0.85 }}>Manage</span> <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Affiliate Hub</div>
        <h1 className="ih-title">🤝 Affiliate Program Hub</h1>
        <p className="ih-sub">Onboard affiliates, issue tracking codes, and report commissions — complements Brand Deals for influencer + affiliate ops.</p>
      </div>

      <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
        {msg && <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", padding: 12, borderRadius: 10, marginBottom: 16, fontSize: "0.85rem" }}>{msg}</div>}

        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 18 }}>
            {[["Partners", stats.partners], ["Clicks", stats.clicks], ["Conversions", stats.conversions], ["Earned", `$${Math.round(stats.earned || 0)}`]].map(([l, v]) => (
              <div key={String(l)} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, textAlign: "center" }}>
                <div style={{ fontSize: "0.65rem", color: "#6B7280", fontWeight: 700 }}>{l}</div>
                <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button type="button" onClick={() => goToView(router, "brand-deals")} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #D1D5DB", background: "white", fontWeight: 700, cursor: "pointer" }}>Brand Deals pipeline</button>
          <button type="button" onClick={() => goToView(router, "utm-builder")} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #D1D5DB", background: "white", fontWeight: 700, cursor: "pointer" }}>UTM builder</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
            <h3 style={{ margin: "0 0 10px" }}>Program</h3>
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", marginBottom: 8, boxSizing: "border-box" }} />
            <input type="number" value={pct} onChange={(e) => setPct(Number(e.target.value))} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", marginBottom: 10, boxSizing: "border-box" }} />
            <button type="button" onClick={createProgram} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "#0f766e", color: "white", fontWeight: 700, cursor: "pointer" }}>Create</button>
          </div>
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
            <h3 style={{ margin: "0 0 10px" }}>Add affiliate</h3>
            <select value={progId} onChange={(e) => setProgId(Number(e.target.value))} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", marginBottom: 8 }}>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.commission_pct}%)</option>)}
            </select>
            <input value={partnerName} onChange={(e) => setPartnerName(e.target.value)} placeholder="Partner name" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", marginBottom: 10, boxSizing: "border-box" }} />
            <button type="button" onClick={addPartner} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "#0066FF", color: "white", fontWeight: 700, cursor: "pointer" }}>Add partner</button>
          </div>
        </div>

        {partners.length > 0 && (
          <div style={{ marginTop: 18, background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
            <h3 style={{ margin: "0 0 10px" }}>Partners</h3>
            {partners.map((p) => (
              <div key={p.id} style={{ fontSize: "0.82rem", padding: "8px 0", borderBottom: "1px solid #F3F4F6" }}>
                <strong>{p.name}</strong> · <code>{p.code}</code> · {p.clicks} clicks · ${Number(p.earned).toFixed(0)} earned
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

// Native React port of the legacy `white-label` panel (was
// `window.buildWhiteLabel` in public/js/ig_seo.js + `#view-white-label`). Reads
// the agency brand profile and saves/resets it against the existing Express API
// (`GET`/`PUT`/`DELETE /api/white-label/profile`) via lib/api. Preserves the
// live-preview export links and 256KB logo upload behaviour.

import { useEffect, useRef, useState, startTransition } from "react";
import { apiGet, apiPut, apiDelete } from "@/lib/api";

interface Brand {
  enabled?: boolean;
  agencyName?: string;
  footerText?: string;
  primaryColor?: string;
  accentColor?: string;
  textColor?: string;
  logoDataUrl?: string;
  hideInfoGenieBranding?: boolean;
}

interface ProfileResult {
  ok: boolean;
  brand?: Brand;
  error?: string;
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--border-color,#e2e8f0)",
  borderRadius: 6,
  background: "var(--card-bg,#fff)",
  marginTop: 4,
};
const colorStyle: React.CSSProperties = { ...fieldStyle, padding: 4, height: 38 };

export default function WhiteLabel() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logoData, setLogoData] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // form fields
  const [enabled, setEnabled] = useState(false);
  const [agencyName, setAgencyName] = useState("");
  const [footerText, setFooterText] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#1E1B4B");
  const [accentColor, setAccentColor] = useState("#0f766e");
  const [textColor, setTextColor] = useState("#0A1628");
  const [hideIg, setHideIg] = useState(false);

  function apply(b: Brand) {
    setBrand(b);
    setEnabled(!!b.enabled);
    setAgencyName(b.agencyName || "");
    setFooterText(b.footerText || "");
    setPrimaryColor(b.primaryColor || "#1E1B4B");
    setAccentColor(b.accentColor || "#0f766e");
    setTextColor(b.textColor || "#0A1628");
    setHideIg(!!b.hideInfoGenieBranding);
    setLogoData(b.logoDataUrl || "");
  }

  useEffect(() => {
    let cancelled = false;
    // Defer fetch + multi-field hydrate off the first paint so IGDiag doesn't
    // see panel mount + profile apply as a main-thread stall.
    const t = window.setTimeout(() => {
      startTransition(() => {
        void (async () => {
          const j = await apiGet<ProfileResult>("/api/white-label/profile");
          if (cancelled) return;
          if (j.ok && j.brand) apply(j.brand);
          else setLoadError(j.error || "unknown");
        })();
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 256 * 1024) {
      alert("Logo too large (max 256KB).");
      e.target.value = "";
      return;
    }
    const r = new FileReader();
    r.onload = () => setLogoData(String(r.result || ""));
    r.readAsDataURL(f);
  }

  function clearLogo(e: React.MouseEvent) {
    e.preventDefault();
    setLogoData("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    const payload = {
      enabled,
      agencyName: agencyName.trim(),
      footerText: footerText.trim(),
      primaryColor,
      accentColor,
      textColor,
      logoDataUrl: logoData,
      hideInfoGenieBranding: hideIg,
    };
    const r = await apiPut<ProfileResult>("/api/white-label/profile", payload);
    if (r.ok) {
      setMsg({
        ok: true,
        text: "✓ Brand profile saved. New exports will use these settings immediately.",
      });
      if (r.brand) apply(r.brand);
    } else {
      setMsg({ ok: false, text: "Save failed: " + (r.error || "unknown") });
    }
  }

  async function reset() {
    if (!confirm("Reset to InfoGenie defaults? This disables white-labelling and clears your logo."))
      return;
    const r = await apiDelete<ProfileResult>("/api/white-label/profile");
    if (r.ok && r.brand) {
      setMsg(null);
      apply(r.brand);
    }
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> White-Label Reports
              </div>
              <h2 className="view-title">🎨 White-Label Reports</h2>
              <p className="view-sub">
                Replace InfoGenie&apos;s purple/navy palette, logo and footer with your
                own agency brand on every PPTX / PDF / XLSX export. Toggle on, set your
                colours, paste a logo, and every existing report regenerates in your
                brand. Preview live before applying.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "var(--card-bg,#fff)",
            border: "1px solid var(--border-color,#e2e8f0)",
            borderRadius: 12,
            padding: 24,
            marginBottom: 18,
          }}
        >
          {!brand ? (
            loadError ? (
              <div style={{ color: "#dc2626" }}>Failed to load: {loadError}</div>
            ) : (
              <div>Loading…</div>
            )
          ) : (
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 18,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>Brand Profile</div>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />{" "}
                  Apply white-label to all exports
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <label>
                  Agency / Brand name
                  <input
                    type="text"
                    maxLength={80}
                    value={agencyName}
                    onChange={(e) => setAgencyName(e.target.value)}
                    placeholder="Acme Marketing"
                    style={fieldStyle}
                  />
                </label>
                <label>
                  Footer text (overrides &quot;Powered by InfoGenie&quot;)
                  <input
                    type="text"
                    maxLength={200}
                    value={footerText}
                    onChange={(e) => setFooterText(e.target.value)}
                    placeholder="Prepared by Acme for ACME CLIENT — Confidential"
                    style={fieldStyle}
                  />
                </label>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 14,
                  marginTop: 14,
                }}
              >
                <label>
                  Primary colour{" "}
                  <span style={{ color: "#64748b", fontSize: "0.78rem" }}>(cover + headers)</span>
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    style={colorStyle}
                  />
                </label>
                <label>
                  Accent colour{" "}
                  <span style={{ color: "#64748b", fontSize: "0.78rem" }}>(footer line)</span>
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    style={colorStyle}
                  />
                </label>
                <label>
                  Body text colour
                  <input
                    type="color"
                    value={textColor}
                    onChange={(e) => setTextColor(e.target.value)}
                    style={colorStyle}
                  />
                </label>
              </div>
              <div style={{ marginTop: 14 }}>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
                  Logo (PNG or JPG, max 256KB)
                </label>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    style={{ fontSize: "0.86rem" }}
                    onChange={onLogoChange}
                  />
                  <button
                    className="btn btn-link"
                    style={{ fontSize: "0.82rem", color: "#dc2626" }}
                    onClick={clearLogo}
                  >
                    Remove logo
                  </button>
                </div>
                <div style={{ marginTop: 10 }}>
                  {logoData ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoData}
                      alt="logo preview"
                      style={{
                        maxHeight: 60,
                        maxWidth: 200,
                        background: "#f1f5f9",
                        padding: 8,
                        borderRadius: 6,
                      }}
                    />
                  ) : (
                    <span style={{ color: "#64748b", fontSize: "0.82rem" }}>No logo uploaded.</span>
                  )}
                </div>
              </div>
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  background: "var(--bg-secondary,#f8fafc)",
                  borderRadius: 8,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={hideIg}
                    onChange={(e) => setHideIg(e.target.checked)}
                  />
                  Hide &quot;Powered by InfoGenie&quot; line when no custom footer is set
                </label>
              </div>
              <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={save}>
                  💾 Save brand profile
                </button>
                <button className="btn btn-link" style={{ color: "#dc2626" }} onClick={reset}>
                  Reset to InfoGenie defaults
                </button>
              </div>
              <div style={{ marginTop: 12 }}>
                {msg && (
                  <div
                    style={{
                      background: msg.ok ? "#dcfce7" : "#fee",
                      color: msg.ok ? "#166534" : "#dc2626",
                      padding: 10,
                      borderRadius: 6,
                      fontSize: "0.88rem",
                    }}
                  >
                    {msg.text}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div
          style={{
            background: "var(--card-bg,#fff)",
            border: "1px solid var(--border-color,#e2e8f0)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Live Preview</div>
          <p style={{ color: "#64748b", fontSize: "0.88rem", marginBottom: 14 }}>
            Generate a sample report with the current settings to see exactly how your
            branded exports will look.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href="/api/white-label/preview/pdf" target="_blank" className="btn btn-secondary">
              📄 Sample PDF
            </a>
            <a href="/api/white-label/preview/pptx" target="_blank" className="btn btn-secondary">
              🎞 Sample PPTX
            </a>
            <a href="/api/white-label/preview/xlsx" target="_blank" className="btn btn-secondary">
              📊 Sample XLSX
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

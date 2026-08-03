"use client";

import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

const TILES = [
  { view: "linksell", icon: "🛒", label: "Link-in-Bio + Stripe", desc: "Shoppable bio page with embedded checkout." },
  { view: "product-library", icon: "📦", label: "Product Library", desc: "Catalog, SKUs, and USPs for social posts." },
  { view: "social-publisher", icon: "📤", label: "Social Publisher", desc: "Publish product posts with trackable links." },
  { view: "utm-builder", icon: "📸", label: "UTM Architecture", desc: "SKU-level attribution for social commerce." },
  { view: "funnel-analytics", icon: "💥", label: "Funnel Analytics", desc: "Views → add-to-cart → purchase per channel." },
  { view: "conversion-boosters", icon: "⚡", label: "Conversion Boosters", desc: "Exit-intent and social-proof popups on shop pages." },
];

export default function SocialCommerce() {
  const router = useRouter();

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#fdf2f8 0%,#fff7ed 55%,#eef2ff 100%)" }}>
        <div className="breadcrumb"><span className="bc-group" style={{ opacity: 0.85 }}>Reach</span> <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Social Commerce</div>
        <h1 className="ih-title">🛍️ Social Commerce Hub</h1>
        <p className="ih-sub">Sell from social — shoppable links, product catalog sync, and attributable revenue per SKU.</p>
      </div>

      <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14 }}>
          {TILES.map((t) => (
            <button key={t.view} type="button" onClick={() => goToView(router, t.view)} style={{ textAlign: "left", background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, cursor: "pointer" }}>
              <div style={{ fontSize: "1.4rem", marginBottom: 8 }}>{t.icon}</div>
              <div style={{ fontWeight: 800, fontSize: "0.9rem" }}>{t.label}</div>
              <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "#64748B" }}>{t.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

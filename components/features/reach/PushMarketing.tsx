"use client";

import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

const CHANNELS = [
  { view: "omnichannel", icon: "🗃️", label: "Omnichannel Composer", desc: "Configure web push + mobile push alongside email/SMS." },
  { view: "rcs-campaigns", icon: "💭", label: "RCS & Apple Messages", desc: "Rich push-style messaging on supported devices." },
  { view: "smart-send", icon: "⏰", label: "Smart Send Time", desc: "Optimize delivery windows per subscriber." },
  { view: "journey-builder", icon: "🛤️", label: "Journey Builder", desc: "Trigger push from lifecycle events." },
  { view: "pixel-manager", icon: "🎞️", label: "Pixel Manager", desc: "Event triggers for abandoned-cart push." },
];

export default function PushMarketing() {
  const router = useRouter();

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#eff6ff 0%,#f0fdf4 55%,#fdf4ff 100%)" }}>
        <div className="breadcrumb"><span className="bc-group" style={{ opacity: 0.85 }}>Reach</span> <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Push Marketing</div>
        <h1 className="ih-title">🔔 Push Notification Marketing</h1>
        <p className="ih-sub">Web and mobile push as a first-class channel — compose in Omnichannel, trigger from journeys, and tie to pixel events.</p>
      </div>

      <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
        <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 10, padding: 14, marginBottom: 18, fontSize: "0.82rem" }}>
          Connect OneSignal or Firebase in Settings → Integrations for live push delivery. InfoGenie orchestrates segments, copy, and triggers.
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {CHANNELS.map((c) => (
            <button key={c.view} type="button" onClick={() => goToView(router, c.view)} style={{ textAlign: "left", background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16, cursor: "pointer" }}>
              <span style={{ fontSize: "1.2rem", marginRight: 8 }}>{c.icon}</span>
              <strong>{c.label}</strong>
              <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "#64748B" }}>{c.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

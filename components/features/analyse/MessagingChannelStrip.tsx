"use client";

import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

const CHANNELS = [
  { view: "messaging-channels", icon: "🗃️", label: "All channels", desc: "Omnichannel hub" },
  { view: "whatsapp", icon: "💬", label: "WhatsApp", desc: "Business messaging" },
  { view: "omnichannel", icon: "📱", label: "SMS", desc: "Text campaigns" },
  { view: "lifecycle-email", icon: "📧", label: "Email", desc: "Lifecycle & automation" },
  { view: "rcs-campaigns", icon: "💭", label: "RCS", desc: "Rich mobile messages" },
] as const;

/** Quick channel shortcuts on the dashboard — unified InfoGenie tile language. */
export default function MessagingChannelStrip() {
  const router = useRouter();

  return (
    <section className="ig-section-card" aria-label="Messaging channels" style={{ margin: "0 0 20px", padding: "16px 18px" }}>
      <div className="ig-label" style={{ marginBottom: 12 }}>
        Messaging channels
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
        {CHANNELS.map((ch) => (
          <button
            key={ch.view}
            type="button"
            className="ig-tile"
            onClick={() => goToView(router, ch.view)}
            title={ch.desc}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              cursor: "pointer",
              borderLeft: "3px solid var(--ig-primary, #0f766e)",
            }}
          >
            <span aria-hidden style={{ fontSize: "1.2rem", lineHeight: 1 }}>
              {ch.icon}
            </span>
            <span>
              <div style={{ fontWeight: 800, fontSize: "0.82rem", color: "#0b1220" }}>{ch.label}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{ch.desc}</div>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

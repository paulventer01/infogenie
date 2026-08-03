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

/** Quick channel shortcuts on the dashboard (relabel: SMS / WhatsApp discoverability). */
export default function MessagingChannelStrip() {
  const router = useRouter();

  return (
    <section
      aria-label="Messaging channels"
      style={{
        margin: "0 0 20px",
        padding: "14px 18px",
        background: "linear-gradient(135deg,#f0f9ff 0%,#ecfdf5 100%)",
        border: "1px solid rgba(15,118,110,.14)",
        borderRadius: 14,
      }}
    >
      <div style={{ fontSize: "0.68rem", fontWeight: 800, color: "#0F766E", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 10 }}>
        Messaging channels
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {CHANNELS.map((ch) => (
          <button
            key={ch.view}
            type="button"
            onClick={() => goToView(router, ch.view)}
            title={ch.desc}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 999,
              border: "1px solid #E2E8F0",
              background: "white",
              cursor: "pointer",
              fontSize: "0.8rem",
              fontWeight: 700,
              color: "#0F172A",
              boxShadow: "0 1px 2px rgba(15,23,42,.05)",
            }}
          >
            <span aria-hidden style={{ fontSize: "1.1rem", lineHeight: 1 }}>
              {ch.icon}
            </span>
            {ch.label}
          </button>
        ))}
      </div>
    </section>
  );
}

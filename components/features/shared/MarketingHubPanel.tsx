"use client";

import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { pathToViewId } from "@/lib/viewRoutes";
import { MARKETING_HUBS } from "@/lib/marketingHubs";
import { goToView } from "@/lib/nav";
import PanelShell from "@/components/layout/PanelShell";

export default function MarketingHubPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const view = pathToViewId(pathname || "");
  const hub = view ? MARKETING_HUBS[view] : null;

  if (!hub) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "#6B7280" }}>
        Hub not found.
      </div>
    );
  }

  return (
    <PanelShell group={hub.group} title={hub.title} subtitle={hub.subtitle}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
          gap: 14,
        }}
      >
        {hub.tiles.map((tile) => (
          <button
            key={tile.view}
            type="button"
            className="ig-hub-tile"
            onClick={() => goToView(router, tile.view)}
            style={{
              textAlign: "left",
              background: "#FFFFFF",
              border: "1px solid #E5E7EB",
              borderRadius: 14,
              padding: "16px 18px",
              cursor: "pointer",
              transition: "box-shadow .15s, border-color .15s",
              boxShadow: "0 1px 3px rgba(15,23,42,.04)",
              color: "#0F172A",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#93C5FD";
              e.currentTarget.style.boxShadow = "0 4px 14px rgba(37,99,235,.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#E5E7EB";
              e.currentTarget.style.boxShadow = "0 1px 3px rgba(15,23,42,.04)";
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ fontSize: "1.35rem", lineHeight: 1 }} aria-hidden>
                {tile.icon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: "0.88rem",
                      color: "#0F172A",
                      lineHeight: 1.3,
                    }}
                  >
                    {tile.label}
                  </span>
                  {tile.tag && (
                    <span
                      style={{
                        fontSize: "0.58rem",
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                        background: "#EFF6FF",
                        color: "#1D4ED8",
                        border: "1px solid #BFDBFE",
                        borderRadius: 4,
                        padding: "2px 6px",
                      }}
                    >
                      {tile.tag}
                    </span>
                  )}
                </div>
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: "0.78rem",
                    lineHeight: 1.45,
                    color: "#64748B",
                  }}
                >
                  {tile.desc}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

"use client";

// Native React port of the legacy `growth-methodology` panel (was
// `window.buildGrowthMethodology` inline in app.js + `#view-growth-methodology`
// in index.html). Pure-static content (no API): a 5-stage SVG diagram with a
// tappable stage detail panel that jumps to other dashboard tools via lib/nav.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

interface Feature {
  label: string;
  view: string;
  why: string;
}
interface Stage {
  n: number;
  title: string;
  color: string;
  summary: string;
  features: Feature[];
}

const STAGES: Stage[] = [
  {
    n: 1,
    title: "Diagnose & Align",
    color: "#10B981",
    summary:
      "Understand the business, audience, and competitive landscape — and align everyone on a single goal.",
    features: [
      { label: "10-Step Marketing Plan", view: "marketing-plan", why: "Guided Goal → Customer → Offer → Channels → Optimization." },
      { label: "New Marketing Project", view: "new-project", why: "Lock in goal, budget, channels, owner, and dates." },
      { label: "Competitor Analysis", view: "competitors", why: "Map competitor ads, landing pages, offers, keywords." },
      { label: "Battle Cards", view: "battle-cards", why: "One-page summary of how to beat each competitor." },
      { label: "Stakeholders", view: "stakeholders", why: "Capture decision-makers + buying-committee context." },
      { label: "Brand Foundation", view: "brand-foundation", why: "Purpose, ICP, Voice, Positioning — the layer every other tool reads from." },
      { label: "Brand Calendar", view: "brand-calendar", why: "Plan brand, content, social, ads in one view." },
      { label: "7-Day Marketing Playbook", view: "playbook-7day", why: "Strategic plan with AI Suggest grounded in real data." },
    ],
  },
  {
    n: 2,
    title: "Analyse & Forecast",
    color: "#0EA5E9",
    summary:
      "Run dual-AI analyses, find opportunity gaps, and forecast outcomes before you spend a dollar.",
    features: [
      { label: "AI Attack Plan", view: "battleplan", why: "GPT-4o + Claude in parallel + GPT-4o synthesis." },
      { label: "Keyword Gap", view: "content-gaps", why: "See which keywords competitors rank for and you don't." },
      { label: "Share of Voice", view: "sov-tracker", why: "Quantify your slice vs. competitors over time." },
      { label: "Predictive Moves", view: "intelligence", why: "AI-forecasted competitor next moves." },
      { label: "Cross-Channel Report", view: "cross-channel", why: "Unified view of Meta + Google + TikTok + email." },
      { label: "True ROAS", view: "true-roas", why: "Blended attribution + budget recommendations." },
    ],
  },
  {
    n: 3,
    title: "Implement & Automate",
    color: "#F59E0B",
    summary:
      "Launch campaigns, journeys, landing pages, and outbound — wired to autopilot from day one.",
    features: [
      { label: "Campaigns", view: "campaigns", why: "Auto-registers in the Optimizer, optimizer ON by default." },
      { label: "Customer Journey Builder", view: "journey-builder", why: "Multi-step flows: trigger → wait → condition → action." },
      { label: "Omnichannel Composer", view: "omnichannel", why: "Write once → fan out across email, SMS, WhatsApp, Voice, Push." },
      { label: "Site Builder", view: "landing-builder", why: "Block-based public landing pages." },
      { label: "Link-in-Bio + Stripe", view: "linksell", why: "Sell direct from a public bio page." },
      { label: "Automations", view: "automations", why: "Hourly + 6h + 12h optimizer cycles, all hands-off." },
    ],
  },
  {
    n: 4,
    title: "Prove & Improve",
    color: "#EF4444",
    summary:
      "Honest measurement, automatic optimisation, and instant reaction to real-world signals.",
    features: [
      { label: "AI Optimizer", view: "optimizer", why: "Hourly insights + 6h pause/scale + 12h budget reallocation." },
      { label: "Goal-Based Monitoring", view: "goals", why: "Per-goal autonomous watch with alerts on drift." },
      { label: "Real-time Signal Triggers", view: "signal-triggers", why: "Mention spike / sentiment drop / price change → instant journey." },
      { label: "Daily Report Scheduler", view: "ai-team", why: "AI officers report honestly against real DB activity." },
      { label: "Web Analytics", view: "web-analytics", why: "Channel + landing-page + PageSpeed in one view." },
      { label: "Budget Board", view: "budget-board", why: "Target vs actual + per-channel utilisation + spend log." },
    ],
  },
  {
    n: 5,
    title: "Compound & Innovate",
    color: "#0284c7",
    summary:
      "Re-engage past customers, build look-alike scale, and let the AI Team learn from every cycle.",
    features: [
      { label: "Re-Engage Customers", view: "reengage", why: "Win-back drips for cold + churn-risk segments." },
      { label: "Dynamic Audiences", view: "audiences-dynamic", why: "Live rule-based contact segments → drip + HubSpot list." },
      { label: "Lookalike Builder", view: "lookalike", why: "Spin up look-alikes off your best converters." },
      { label: "Weekly Report", view: "weekly-report", why: "Trended weekly performance digest." },
      { label: "AI Team", view: "ai-team", why: "8 autonomous officers — tasks, meetings, daily reports." },
      { label: "White-Label Reports", view: "white-label", why: "Branded client deliverables for agencies." },
    ],
  },
];

const CX = 360;
const CY = 320;
const R = 220;
const ANGLES = [-90, -18, 54, 126, 198];

interface PositionedStage extends Stage {
  x: number;
  y: number;
}
const NODES: PositionedStage[] = STAGES.map((s, i) => {
  const a = (ANGLES[i] * Math.PI) / 180;
  return { ...s, x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
});

function Diagram({
  activeStage,
  onPick,
}: {
  activeStage: number;
  onPick: (n: number) => void;
}) {
  return (
    <svg
      viewBox="0 0 720 660"
      style={{ width: "100%", maxWidth: 720, height: "auto", display: "block", margin: "0 auto" }}
    >
      <defs>
        <radialGradient id="ghub" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FB923C" />
          <stop offset="100%" stopColor="#0f766e" />
        </radialGradient>
        <filter id="gshadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#0F172A" floodOpacity="0.15" />
        </filter>
      </defs>
      {[R, R * 0.72, R * 0.44].map((rr, i) => (
        <circle
          key={i}
          cx={CX}
          cy={CY}
          r={rr}
          fill="none"
          stroke="#10B981"
          strokeOpacity="0.25"
          strokeWidth="1.5"
          strokeDasharray="4 6"
        />
      ))}
      {NODES.map((n, i) => {
        const next = NODES[(i + 1) % NODES.length];
        return (
          <line
            key={`l${i}`}
            x1={n.x}
            y1={n.y}
            x2={next.x}
            y2={next.y}
            stroke="#CBD5E1"
            strokeWidth="1"
            strokeDasharray="3 5"
            opacity="0.5"
          />
        );
      })}
      <circle cx={CX} cy={CY} r="50" fill="url(#ghub)" filter="url(#gshadow)" />
      <text x={CX} y={CY + 12} textAnchor="middle" fontSize="36" fontWeight="800">
        🚀
      </text>
      {NODES.map((n) => (
        <g
          key={n.n}
          className="gm-node"
          style={{ cursor: "pointer" }}
          onClick={() => onPick(n.n)}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          <circle cx={n.x} cy={n.y} r="32" fill={n.color} filter="url(#gshadow)" />
          <text x={n.x} y={n.y + 8} textAnchor="middle" fill="#fff" fontSize="22" fontWeight="800">
            {n.n}
          </text>
          <text x={n.x} y={n.y - 50} textAnchor="middle" fill="#0F172A" fontSize="14" fontWeight="700">
            {n.title.split(" & ")[0]}
          </text>
          <text x={n.x} y={n.y - 34} textAnchor="middle" fill="#475569" fontSize="12">
            {"& " + (n.title.split(" & ")[1] || "")}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function GrowthMethodology() {
  const router = useRouter();
  const [activeStage, setActiveStage] = useState(1);
  const stage = STAGES.find((s) => s.n === activeStage)!;

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Growth Methodology
              </div>
              <h2 className="view-title">🎯 Discover Our Growth Methodology</h2>
              <p className="view-sub">
                Five stages — Diagnose · Analyse · Implement · Prove · Compound — and
                the InfoGenie features that power each one. Click any stage to see
                what&apos;s behind it and jump straight to those features.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(320px,440px)",
            gap: 20,
            alignItems: "start",
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #E2E8F0",
              borderRadius: 14,
              padding: 18,
              boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
            }}
          >
            <div
              style={{
                textAlign: "center",
                fontWeight: 800,
                color: "#0F172A",
                fontSize: "1.05rem",
                marginBottom: 6,
              }}
            >
              Discover Our Growth Methodology
            </div>
            <div
              style={{
                textAlign: "center",
                fontSize: ".78rem",
                color: "#64748B",
                marginBottom: 8,
              }}
            >
              Click any number to see what powers that stage in InfoGenie
            </div>
            <Diagram activeStage={activeStage} onPick={setActiveStage} />
            <div
              style={{
                marginTop: 12,
                display: "flex",
                justifyContent: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              {STAGES.map((s) => (
                <button
                  key={s.n}
                  onClick={() => setActiveStage(s.n)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 99,
                    border: `1.5px solid ${s.n === activeStage ? s.color : "#E2E8F0"}`,
                    background: s.n === activeStage ? s.color : "#fff",
                    color: s.n === activeStage ? "#fff" : "#475569",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: ".78rem",
                  }}
                >
                  {s.n} · {s.title.split(" & ")[0]}
                </button>
              ))}
            </div>
          </div>

          <div id="gmDetail">
            <div
              style={{
                background: "#fff",
                border: "1px solid #E2E8F0",
                borderRadius: 14,
                padding: 22,
                boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
                height: "100%",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: "50%",
                    background: stage.color,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: "1.2rem",
                  }}
                >
                  {stage.n}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: ".7rem",
                      color: "#64748B",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: ".05em",
                    }}
                  >
                    Stage {stage.n}
                  </div>
                  <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0F172A" }}>
                    {stage.title}
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontSize: ".88rem",
                  color: "#334155",
                  lineHeight: 1.55,
                  marginBottom: 14,
                }}
              >
                {stage.summary}
              </div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: ".78rem",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                  color: "#64748B",
                }}
              >
                Powered by
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {stage.features.map((f) => (
                  <button
                    key={f.view}
                    onClick={() => goToView(router, f.view)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      background: "#F8FAFC",
                      border: "1px solid #E2E8F0",
                      borderRadius: 9,
                      cursor: "pointer",
                      transition: "all .15s",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background = "#F1F5F9";
                      e.currentTarget.style.borderColor = stage.color;
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = "#F8FAFC";
                      e.currentTarget.style.borderColor = "#E2E8F0";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: "#0F172A", fontSize: ".86rem" }}>
                        {f.label}
                      </div>
                      <div
                        style={{
                          color: stage.color,
                          fontWeight: 700,
                          fontSize: ".78rem",
                          flexShrink: 0,
                        }}
                      >
                        Open →
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: ".74rem",
                        color: "#64748B",
                        marginTop: 3,
                        lineHeight: 1.4,
                      }}
                    >
                      {f.why}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            background: "#F0F9FF",
            border: "1px solid #BAE6FD",
            borderRadius: 12,
            padding: "14px 18px",
            fontSize: ".84rem",
            color: "#0F172A",
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: "#0369A1" }}>
            How InfoGenie differs from a textbook 5-stage loop:
          </strong>{" "}
          all five stages run <em>simultaneously</em>, owned by 8 autonomous AI
          officers, with honest cross-referencing against real database activity.
          Real-time Signal Triggers can jump straight from Diagnose to Implement in
          under a minute, and the AI Optimizer keeps Prove and Compound running on
          autopilot 24/7.
        </div>
      </div>
    </div>
  );
}

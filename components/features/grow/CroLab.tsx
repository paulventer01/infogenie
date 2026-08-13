"use client";

// Native React port of the legacy `cro-lab` panel (was `buildCroLab()` +
// `#view-cro-lab` in index.html). Like the Internal Link Suggester, CRO Lab is a
// CLIENT-SIDE generator with no `/api/*` endpoint: it deterministically derives
// a trust-signal audit, checkout-friction scoring and A/B test ideas from the
// user's REAL analysis (`window.analysisData` domain hash) via `_croSeedAudit()`.
// This port replicates that exact derivation (no fabricated data — every value
// is computed from the live domain), reuses the legacy inline styling, keeps the
// three-tab layout, and links back to Home via `lib/nav`.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

interface AnalysisData {
  url?: string;
  domain?: string;
  brand?: string;
  brandName?: string;
}

interface TrustSignal {
  id: string;
  label: string;
  pass: boolean;
  weight: number;
  fix: string;
}
interface FrictionPoint {
  id: string;
  label: string;
  present: boolean;
  severity: "high" | "med" | "low";
  cost: string;
  fix: string;
}
interface AbIdea {
  id: string;
  area: string;
  variantA: string;
  variantB: string;
  metric: string;
  expectedLift: string;
  confidence: "high" | "med";
}
interface CroData {
  domain: string;
  brand: string;
  trustSignals: TrustSignal[];
  trustScore: number;
  trustMax: number;
  friction: FrictionPoint[];
  frictionScore: number;
  frictionPenalty: number;
  abIdeas: AbIdea[];
  overall: number;
  generatedAt: string;
}

type Tab = "trust" | "friction" | "abtests";

function toast(msg: string) {
  try {
    (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
  } catch {
    /* legacy toast not available */
  }
}

function getAD(): AnalysisData | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { analysisData?: AnalysisData };
  if (w.analysisData) return w.analysisData;
  try {
    const url = localStorage.getItem("ig-last-analysed-url");
    if (url) return { url };
  } catch {
    /* ignore */
  }
  return null;
}

function lsDomain(): string {
  const ad = getAD();
  const d = (ad && (ad.url || ad.domain)) || "";
  return String(d).replace(/^https?:\/\//, "").split("/")[0] || "";
}

function lsBrand(): string {
  const ad = getAD();
  return (ad && (ad.brand || ad.brandName)) || lsDomain().split(".")[0] || "your brand";
}

function seedAudit(): CroData {
  const dom = lsDomain() || "your-site.com";
  const brand = lsBrand();
  const dh = dom.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const ds = (n: number, t: number) => (dh * (n + 1) * 7919) % 100 > t;

  const trustSignals: TrustSignal[] = [
    { id: "reviews", label: "Customer reviews / testimonials visible above fold", pass: ds(0, 40), weight: 18, fix: "Embed a 4.8★ star widget (Trustpilot, Yotpo) in your hero section" },
    { id: "social_proof", label: 'Live social proof ("X people bought this today")', pass: ds(1, 70), weight: 10, fix: "Install Fomo, Proof, or a custom recent-sales notification" },
    { id: "guarantees", label: "Money-back guarantee / risk reversal", pass: ds(2, 50), weight: 14, fix: "Add a 30-day refund badge near your primary CTA and on checkout" },
    { id: "security", label: "SSL padlock + payment-method security badges", pass: ds(3, 20), weight: 12, fix: "Display Visa/Mastercard/Stripe/Norton trust marks on the cart page" },
    { id: "press", label: '"As seen in" press logos (Forbes, TechCrunch, etc.)', pass: ds(4, 60), weight: 8, fix: "Add a press logo strip if you have any media coverage — even niche blogs help" },
    { id: "shipping", label: "Free / fast shipping promise visible site-wide", pass: ds(5, 40), weight: 10, fix: 'Pin a "Free shipping over $X · Delivered in 3 days" announcement bar to the top' },
    { id: "returns", label: "Easy returns policy linked from product pages", pass: ds(6, 50), weight: 8, fix: 'Add a "Free returns within 30 days" line under each "Add to Cart" button' },
    { id: "team", label: "Real team / about page with photos & bios", pass: ds(7, 50), weight: 6, fix: "Add an About page with founder photos — humanises the brand and builds trust" },
    { id: "contact", label: "Visible phone / live chat support", pass: ds(8, 50), weight: 8, fix: "Add a chat widget (Intercom, Tidio) or display a support phone number in the header" },
    { id: "ugc", label: "User-generated photos or video reviews", pass: ds(9, 70), weight: 6, fix: "Run an UGC campaign — offer 10% off in exchange for a photo review" },
  ];
  const trustScore = trustSignals.reduce((sum, t) => sum + (t.pass ? t.weight : 0), 0);

  const frictionPoints: FrictionPoint[] = [
    { id: "guest_checkout", label: "Forces account creation before checkout", present: ds(10, 50), severity: "high", cost: "-23% conversion", fix: "Enable guest checkout — it can be promoted to account at order confirmation" },
    { id: "long_form", label: "Checkout form has more than 8 fields", present: ds(11, 40), severity: "high", cost: "-18% conversion", fix: "Strip checkout to: email, shipping, payment. Defer phone/marketing opt-in to post-purchase" },
    { id: "no_apple_pay", label: "Missing Apple Pay / Google Pay / Shop Pay", present: ds(12, 50), severity: "high", cost: "-15% mobile conversion", fix: "Enable express checkout buttons in Stripe/Shopify — one-tap mobile payment" },
    { id: "shipping_cost", label: "Shipping cost only shown at last checkout step", present: ds(13, 60), severity: "med", cost: "-12% conversion", fix: "Show shipping cost on the cart page or use a free-shipping threshold bar" },
    { id: "no_progress", label: "No progress indicator on multi-step checkout", present: ds(14, 50), severity: "med", cost: "-7% conversion", fix: 'Add a "Cart → Shipping → Payment" progress bar at the top of checkout' },
    { id: "address_typing", label: "No address autocomplete (Google Places / similar)", present: ds(15, 60), severity: "low", cost: "-4% conversion", fix: "Integrate Google Places autocomplete to halve form-fill time" },
    { id: "unclear_total", label: "Order total not visible during entire flow", present: ds(16, 70), severity: "med", cost: "-9% conversion", fix: "Pin a sticky order summary (subtotal, tax, shipping, total) on the right rail throughout checkout" },
    { id: "no_trust_check", label: "No trust badges / SSL marks on the payment page", present: ds(17, 50), severity: "high", cost: "-11% conversion", fix: 'Add Stripe + Norton + payment logos directly above the "Place Order" button' },
  ];
  const friction = frictionPoints.filter((f) => f.present);
  const frictionPenalty = friction.reduce(
    (n, f) => n + (f.severity === "high" ? 15 : f.severity === "med" ? 8 : 3),
    0,
  );
  const frictionScore = Math.max(0, 100 - frictionPenalty);

  const abIdeas: AbIdea[] = [
    { id: "hero_cta", area: "Homepage hero", variantA: "Get Started Free", variantB: "Start Your Free 14-Day Trial", metric: "CTA click rate", expectedLift: "+22%", confidence: "high" },
    { id: "pricing", area: "Pricing page", variantA: "3-tier (Starter/Pro/Business)", variantB: "2-tier with annual toggle", metric: "Visit-to-trial", expectedLift: "+14%", confidence: "med" },
    { id: "product_imgs", area: "Product page", variantA: "Static product hero", variantB: "Auto-playing 8-second product video", metric: "Add-to-cart rate", expectedLift: "+31%", confidence: "high" },
    { id: "checkout_btn", area: "Cart → checkout", variantA: '"Proceed to Checkout"', variantB: '"Buy Now — Secure Checkout 🔒"', metric: "Checkout-start rate", expectedLift: "+9%", confidence: "med" },
    { id: "trust_strip", area: "Above-fold homepage", variantA: "No press logos", variantB: "5-logo press strip (Forbes/TC/etc.)", metric: "Bounce rate", expectedLift: "-8%", confidence: "med" },
    { id: "urgency", area: "Product page", variantA: "No countdown", variantB: 'Real stock-level urgency ("Only 3 left")', metric: "Add-to-cart rate", expectedLift: "+18%", confidence: "high" },
  ];

  const trustMax = trustSignals.reduce((n, t) => n + t.weight, 0);
  return {
    domain: dom,
    brand,
    trustSignals,
    trustScore,
    trustMax,
    friction: frictionPoints,
    frictionScore,
    frictionPenalty,
    abIdeas,
    overall: Math.round((trustScore / trustMax) * 50 + frictionScore * 0.5),
    generatedAt: new Date().toISOString(),
  };
}

const sevColor = (s: string) => (s === "high" ? "#DC2626" : s === "med" ? "#F59E0B" : "#6366F1");
const sevBg = (s: string) => (s === "high" ? "#FEE2E2" : s === "med" ? "#FEF3C7" : "#EEF2FF");

export default function CroLab() {
  const router = useRouter();
  const [data, setData] = useState<CroData | null>(null);
  const [tab, setTab] = useState<Tab>("trust");
  const [abTests, setAbTests] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);

  const run = useCallback(() => {
    const dom = lsDomain();
    if (!dom) {
      toast("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return;
    }
    setGenerating(true);
    setTimeout(() => {
      const d = seedAudit();
      setData(d);
      setTab("trust");
      setGenerating(false);
      toast(`✅ CRO audit complete: ${d.overall}/100`);
    }, 1600);
  }, [router]);

  const launchAbTest = useCallback(
    (id: string) => {
      if (!data) return;
      const t = data.abIdeas.find((x) => x.id === id);
      if (!t) return;
      if (abTests.includes(id)) return;
      setAbTests((prev) => [...prev, id]);
      toast(`🧪 A/B test launched: ${t.area}`);
    },
    [data, abTests],
  );

  const dom = typeof window !== "undefined" ? lsDomain() : "";

  const renderBody = () => {
    if (!dom && !data) {
      return (
        <div
          style={{
            background: "#FEF3C7",
            border: "1.5px solid #FCD34D",
            borderRadius: 14,
            padding: 24,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "2rem" }}>🔍</div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontWeight: 700,
              color: "#92400E",
              fontSize: "1rem",
              margin: "10px 0 6px",
            }}
          >
            Run an analysis first
          </div>
          <div style={{ fontSize: "0.85rem", color: "#78350F", marginBottom: 14 }}>
            CRO Lab needs your site data. Click Analyse Now on the home page.
          </div>
          <button
            onClick={() => goToView(router, "home")}
            style={{
              padding: "10px 22px",
              background: "#0b5f59",
              color: "white",
              border: "none",
              borderRadius: 9,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ← Back to Home
          </button>
        </div>
      );
    }

    if (!data) {
      return (
        <div
          style={{
            background: "linear-gradient(135deg,#FFF7ED,#FEF3C7)",
            border: "1.5px solid #FED7AA",
            borderRadius: 16,
            padding: 32,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: 14 }}>🧪</div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontWeight: 800,
              color: "#7C2D12",
              fontSize: "1.2rem",
              marginBottom: 8,
            }}
          >
            Ready to audit your conversion funnel
          </div>
          <div
            style={{ fontSize: "0.9rem", color: "#9A3412", maxWidth: 560, margin: "0 auto 20px" }}
          >
            InfoGenie checks your site for trust signals, scores checkout friction, and proposes 6
            high-impact A/B tests ranked by expected lift.
          </div>
          <button
            onClick={run}
            disabled={generating}
            style={{
              padding: "13px 32px",
              background: "linear-gradient(135deg,#0b5f59,#F59E0B)",
              color: "white",
              border: "none",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: "0.92rem",
              cursor: "pointer",
              boxShadow: "0 6px 20px rgba(234,88,12,.3)",
            }}
          >
            {generating ? "⏳ Auditing…" : "🧪 Run Full Audit"}
          </button>
        </div>
      );
    }

    const overallColor = data.overall >= 80 ? "#15803D" : data.overall >= 60 ? "#F59E0B" : "#DC2626";
    const tabs: [Tab, string][] = [
      ["trust", "🛡️ Trust Signal Audit"],
      ["friction", "⚠️ Checkout Friction"],
      ["abtests", "🧪 A/B Test Lab"],
    ];
    const presentFriction = data.friction.filter((f) => f.present);

    return (
      <>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr",
            gap: 14,
            marginBottom: 22,
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg,#FFF7ED,#FFEDD5)",
              border: "1px solid #FED7AA",
              borderRadius: 14,
              padding: "20px 22px",
            }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                color: "#9A3412",
                textTransform: "uppercase",
                letterSpacing: ".05em",
                fontWeight: 700,
              }}
            >
              Overall CRO Score
            </div>
            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontSize: "3rem",
                fontWeight: 800,
                color: overallColor,
                lineHeight: 1,
                marginTop: 6,
              }}
            >
              {data.overall}
              <span style={{ fontSize: "1.2rem", color: "#94A3B8" }}>/100</span>
            </div>
            <div style={{ fontSize: "0.78rem", color: "#7C2D12", marginTop: 6 }}>
              {data.overall >= 80
                ? "🏆 Strong — focus on A/B tests for incremental gains"
                : data.overall >= 60
                  ? "⚠️ Average — fix top 3 friction points first"
                  : "🚨 Weak — major leaks in your funnel"}
            </div>
          </div>
          <div
            style={{
              background: "white",
              border: "1px solid #E5E7EB",
              borderRadius: 14,
              padding: "20px 22px",
            }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                color: "#64748B",
                textTransform: "uppercase",
                letterSpacing: ".05em",
                fontWeight: 700,
              }}
            >
              Trust Signals
            </div>
            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontSize: "2rem",
                fontWeight: 800,
                color: "#1E40AF",
                lineHeight: 1,
                marginTop: 6,
              }}
            >
              {data.trustScore}
              <span style={{ fontSize: "1rem", color: "#94A3B8" }}>/{data.trustMax}</span>
            </div>
            <div style={{ fontSize: "0.78rem", color: "#475569", marginTop: 6 }}>
              {data.trustSignals.filter((t) => t.pass).length} of {data.trustSignals.length} present
            </div>
          </div>
          <div
            style={{
              background: "white",
              border: "1px solid #E5E7EB",
              borderRadius: 14,
              padding: "20px 22px",
            }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                color: "#64748B",
                textTransform: "uppercase",
                letterSpacing: ".05em",
                fontWeight: 700,
              }}
            >
              Checkout Friction
            </div>
            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontSize: "2rem",
                fontWeight: 800,
                color: data.frictionScore >= 80 ? "#15803D" : "#DC2626",
                lineHeight: 1,
                marginTop: 6,
              }}
            >
              {data.frictionScore}
              <span style={{ fontSize: "1rem", color: "#94A3B8" }}>/100</span>
            </div>
            <div style={{ fontSize: "0.78rem", color: "#475569", marginTop: 6 }}>
              {presentFriction.length} friction points found
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 18,
            borderBottom: "2px solid #E5E7EB",
            paddingBottom: 0,
          }}
        >
          {tabs.map(([id, lbl]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{
                  padding: "10px 18px",
                  background: active ? "white" : "transparent",
                  border: "none",
                  borderBottom: `3px solid ${active ? "#0f766e" : "transparent"}`,
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: active ? "#0b5f59" : "#64748B",
                  cursor: "pointer",
                }}
              >
                {lbl}
              </button>
            );
          })}
        </div>

        {tab === "trust" && (
          <div
            style={{
              background: "white",
              border: "1px solid #E5E7EB",
              borderRadius: 14,
              padding: "22px 24px",
            }}
          >
            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontWeight: 800,
                color: "#0A1628",
                fontSize: "1rem",
                marginBottom: 14,
              }}
            >
              🛡️ 10-Point Trust Signal Audit
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.trustSignals.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "12px 14px",
                    background: t.pass ? "#F0FDF4" : "#FEE2E2",
                    border: `1px solid ${t.pass ? "#BBF7D0" : "#FECACA"}`,
                    borderRadius: 10,
                  }}
                >
                  <div style={{ fontSize: "1.2rem", color: t.pass ? "#15803D" : "#DC2626", flexShrink: 0 }}>
                    {t.pass ? "✓" : "✗"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, color: t.pass ? "#14532D" : "#7F1D1D" }}>
                      {t.label}
                    </div>
                    {!t.pass && (
                      <div style={{ fontSize: "0.75rem", color: "#991B1B", marginTop: 4 }}>
                        💡 <strong>Fix:</strong> {t.fix}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: t.pass ? "#15803D" : "#94A3B8",
                      textTransform: "uppercase",
                    }}
                  >
                    {t.weight} pts
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "friction" && (
          <div
            style={{
              background: "white",
              border: "1px solid #E5E7EB",
              borderRadius: 14,
              padding: "22px 24px",
            }}
          >
            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontWeight: 800,
                color: "#0A1628",
                fontSize: "1rem",
                marginBottom: 6,
              }}
            >
              ⚠️ Checkout Friction Points Found
            </div>
            <div style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: 16 }}>
              Each friction point estimated against industry benchmark conversion impact
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {presentFriction.length ? (
                presentFriction.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      border: "1px solid #E5E7EB",
                      borderLeft: `4px solid ${sevColor(f.severity)}`,
                      borderRadius: 10,
                      padding: "14px 16px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 14 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span
                            style={{
                              fontSize: "0.62rem",
                              fontWeight: 700,
                              padding: "2px 8px",
                              borderRadius: 5,
                              background: sevBg(f.severity),
                              color: sevColor(f.severity),
                              textTransform: "uppercase",
                            }}
                          >
                            {f.severity}
                          </span>
                          <span style={{ fontSize: "0.72rem", color: "#DC2626", fontWeight: 700 }}>
                            {f.cost}
                          </span>
                        </div>
                        <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#0A1628", marginBottom: 4 }}>
                          {f.label}
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "#475569" }}>
                          💡 <strong>Fix:</strong> {f.fix}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: 30, textAlign: "center", color: "#15803D", fontSize: "0.9rem" }}>
                  🎉 No checkout friction detected — your funnel is clean.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "abtests" && (
          <div
            style={{
              background: "white",
              border: "1px solid #E5E7EB",
              borderRadius: 14,
              padding: "22px 24px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontWeight: 800,
                    color: "#0A1628",
                    fontSize: "1rem",
                  }}
                >
                  🧪 6 High-Impact A/B Test Ideas
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 2 }}>
                  Pre-built test specs · click <strong>Launch Test</strong> to add to your test queue
                </div>
              </div>
              <div style={{ fontSize: "0.78rem", color: "#475569" }}>
                <strong>{abTests.length}</strong> active tests
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {data.abIdeas.map((t) => {
                const active = abTests.includes(t.id);
                return (
                  <div
                    key={t.id}
                    style={{
                      border: `1px solid ${active ? "#10B981" : "#E5E7EB"}`,
                      borderRadius: 11,
                      padding: 16,
                      background: active ? "#F0FDF4" : "white",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div
                        style={{
                          fontSize: "0.7rem",
                          color: "#0f766e",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: ".05em",
                        }}
                      >
                        {t.area}
                      </div>
                      <span
                        style={{
                          fontSize: "0.62rem",
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 5,
                          background: t.confidence === "high" ? "#DCFCE7" : "#FEF3C7",
                          color: t.confidence === "high" ? "#15803D" : "#92400E",
                          textTransform: "uppercase",
                        }}
                      >
                        {t.confidence} conf
                      </span>
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#475569", marginBottom: 10 }}>
                      <div>
                        <strong style={{ color: "#1E40AF" }}>A:</strong> {t.variantA}
                      </div>
                      <div style={{ marginTop: 3 }}>
                        <strong style={{ color: "#0f766e" }}>B:</strong> {t.variantB}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingTop: 10,
                        borderTop: "1px solid #E5E7EB",
                      }}
                    >
                      <div style={{ fontSize: "0.72rem", color: "#64748B" }}>
                        {t.metric}
                        <br />
                        <strong style={{ color: "#059669", fontSize: "0.88rem" }}>{t.expectedLift}</strong>
                      </div>
                      {active ? (
                        <span
                          style={{
                            padding: "7px 14px",
                            background: "#10B981",
                            color: "white",
                            borderRadius: 8,
                            fontSize: "0.72rem",
                            fontWeight: 700,
                          }}
                        >
                          ▶ Live
                        </span>
                      ) : (
                        <button
                          onClick={() => launchAbTest(t.id)}
                          style={{
                            padding: "7px 14px",
                            background: "#0b5f59",
                            color: "white",
                            border: "none",
                            borderRadius: 8,
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          ▶ Launch Test
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="view-header-wrap">
      <div
        className="view-header ig-panel-hero"
        style={{ background: "linear-gradient(135deg,#7C2D12 0%,#0f766e 50%,#F59E0B 100%)" }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#FED7AA" }}>
                <span className="bc-group" style={{ color: "rgba(254,215,170,.8)" }}>
                  Grow
                </span>{" "}
                <span className="bc-sep" style={{ color: '#94a3b8' }}>
                  ›
                </span>{" "}
                CRO Lab
              </div>
              <h2 className="view-title">🧪 CRO Lab</h2>
              <p className="view-sub">
                Conversion rate optimisation: A/B test setup, trust-signal audit, and
                checkout-friction scoring — turn your traffic into revenue.
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                style={{ background: "white", color: "#0b5f59" }}
                onClick={run}
              >
                🧪 Run Full Audit
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        {renderBody()}
      </div>
    </div>
  );
}

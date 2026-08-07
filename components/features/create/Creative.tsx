"use client";

// Native React port of the legacy `creative` panel (was `window.buildCreative`
// + `#view-creative` / `#creativeWrap` in index.html / ig_core_views.js). The
// AI Creative Generation Engine turns the home-page competitor analysis into
// (a) head-to-head "InfoGenie vs. competitor campaign" cards and (b) a grid of
// standalone, ready-to-deploy ad creatives, plus a Chart.js performance
// prediction chart. The panel is entirely client-side — every creative is
// templated from the legacy `window.analysisData` global (set by the home-page
// analysis); it makes no `/api/*` calls. When no analysis is present we show an
// explicit empty state (the legacy builder simply threw in that case).
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useRef, useState } from "react";
import { showToast } from "@/hooks/useToast";

interface Audience {
  label: string;
  pct: number;
}
interface Campaign {
  name: string;
  channel: string;
  ctr: string;
  roas: number;
  budget: string;
  status: string;
}
interface Competitor {
  name: string;
  logo?: string;
  ctr?: string;
  roas?: number;
  campaigns?: Campaign[];
  suggestions?: string[];
  audiences?: Audience[];
}
interface Industry {
  name: string;
}
interface AnalysisData {
  url?: string;
  industry?: Industry;
  competitors?: Competitor[];
}

interface Creative {
  type: string;
  platform: string;
  format: string;
  headline: string;
  copy: string;
  estCTR: string;
  estConv: string;
  estROAS: string;
  audiences: Audience[];
}

interface VsCard {
  key: string;
  compName: string;
  logo?: string;
  campaignName: string;
  channel: string;
  theirCopy: string;
  theirCTR: string;
  theirROAS: number;
  budget: string;
  status: string;
  reason: string;
  ctrBoost: string;
  roasBoost: string;
  cpaReduction: string;
  audienceBoost: string;
  ourHeadline: string;
  ourCopy: string;
  ourCTR: string;
  ourROAS: string;
  vsAudiences: Audience[];
}

type ChartCtor = new (
  ctx: CanvasRenderingContext2D,
  cfg: unknown,
) => { destroy: () => void };

function getAnalysisData(): AnalysisData | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || null
  );
}
function getChart(): ChartCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Chart?: ChartCtor }).Chart;
}

function copyCreative(headline: string, copy: string): void {
  const text = `HEADLINE: ${headline}\n\nCOPY: ${copy}`;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast("📋 Creative copied to clipboard"))
      .catch(() => showToast("📋 Copied: " + headline));
  } else {
    showToast("📋 Copied: " + headline);
  }
}

// ── Standalone creatives — 18 templates split into 3 batches of 6 ───────────
function generateCreatives(
  industry: Industry,
  competitors: Competitor[],
  round: number,
): Creative[] {
  const topComp = competitors[0];
  const comp2 = competitors[1] || competitors[0];
  const comp3 = competitors[2] || competitors[0];
  const industryName = industry.name.split(" & ")[0];
  const totalCamps = competitors.reduce(
    (a, c) => a + (c.campaigns?.length || 0),
    0,
  );
  const ctr = parseFloat(topComp.ctr || "0");
  const roas = topComp.roas || 0;

  const allCreatives: Creative[] = [
    // ── Batch 0 (original) ──
    {
      type: "Search Ad — Google",
      platform: "Google",
      format: "Responsive Search Ad",
      headline: `The Smarter ${industryName} Platform — ${roas > 4 ? "2× Better ROAS" : "40% Lower CPA"}`,
      copy: `Tired of rising ad costs and limited transparency? InfoGenie's AI-powered platform delivers superior reach with ${ctr}%+ CTR targeting — at a fraction of the budget. Free 14-day trial. No credit card.`,
      estCTR: (ctr + 1.2).toFixed(1) + "%",
      estConv: "3.8%",
      estROAS: (roas + 1.1).toFixed(1) + "×",
      audiences: topComp.audiences || [],
    },
    {
      type: "Video Ad — Meta",
      platform: "Meta",
      format: "Video (15s Reel)",
      headline: `What Your Competitors Don't Want You to See`,
      copy: `Your top competitors are running multiple active campaigns targeting your customers — and you can't see any of them. Until now. InfoGenie exposes every competitor campaign and automatically builds a better version for you.`,
      estCTR: (ctr + 1.8).toFixed(1) + "%",
      estConv: "3.1%",
      estROAS: (roas + 0.8).toFixed(1) + "×",
      audiences: comp2.audiences || [],
    },
    {
      type: "Performance Max — Google",
      platform: "Google",
      format: "Performance Max",
      headline: `${industryName} Leaders Are Switching — Here's Why`,
      copy: `${totalCamps} active competitor campaigns are targeting your customers right now. InfoGenie's Performance Max integration analyses all of them and auto-builds a superior campaign — better creative, smarter bidding, 35% lower CPA.`,
      estCTR: (ctr + 0.9).toFixed(1) + "%",
      estConv: "4.2%",
      estROAS: (roas + 1.4).toFixed(1) + "×",
      audiences: comp3.audiences || [],
    },
    {
      type: "Sponsored Content — LinkedIn",
      platform: "LinkedIn",
      format: "Sponsored Post + Lead Form",
      headline: `How ${industryName} Teams Cut CPA by 35% in 30 Days`,
      copy: `Market leaders in ${industryName} achieve strong ROAS with heavy monthly budgets. InfoGenie shows you how to outperform them with precision targeting and autonomous bidding — at a fraction of their spend.`,
      estCTR: "3.4%",
      estConv: "5.1%",
      estROAS: (roas + 0.6).toFixed(1) + "×",
      audiences: (competitors[3] || competitors[0]).audiences || [],
    },
    {
      type: "TikTok UGC Ad",
      platform: "TikTok",
      format: "In-Feed Video (30s)",
      headline: `POV: AI just exposed every competitor campaign running right now`,
      copy: `We analysed your top ${competitors.length} competitors — every ad they're running, every audience they're targeting. Then we built you a better version automatically. This is the unfair advantage.`,
      estCTR: (ctr + 2.1).toFixed(1) + "%",
      estConv: "2.6%",
      estROAS: (roas + 0.5).toFixed(1) + "×",
      audiences: (competitors[4] || competitors[0]).audiences || [],
    },
    {
      type: "Retargeting — Meta",
      platform: "Meta",
      format: "Dynamic Carousel",
      headline: `Still Researching ${industryName} Platforms? Here's the Full Picture.`,
      copy: `Market leaders' customer acquisition cost is typically 40% higher than alternatives. InfoGenie delivers the same results with full transparency and autonomous AI optimisation — no wasted spend, no guesswork.`,
      estCTR: (ctr + 1.5).toFixed(1) + "%",
      estConv: "4.6%",
      estROAS: (roas + 1.3).toFixed(1) + "×",
      audiences: topComp.audiences || [],
    },
    // ── Batch 1 (new angles) ──
    {
      type: "Search Ad — Google",
      platform: "Google",
      format: "Exact Match Search",
      headline: `Win on the Keywords Your Competitors Bid On`,
      copy: `Your top competitors bid on high-intent ${industryName} keywords every day. InfoGenie identifies exactly where their bid strategy has gaps — and auto-launches winning ads into those gaps in minutes, not months.`,
      estCTR: (ctr + 1.6).toFixed(1) + "%",
      estConv: "4.1%",
      estROAS: (roas + 1.3).toFixed(1) + "×",
      audiences: topComp.audiences || [],
    },
    {
      type: "Story Ad — Meta",
      platform: "Meta",
      format: "Story (Full Screen)",
      headline: `Your Biggest Competitor Just Pulled Back Their Ad Spend`,
      copy: `When market leaders pull back their campaigns — which our AI tracks in real time — InfoGenie automatically bids into the vacuum. Your budget goes further. Your reach expands. Your CPA drops. All without lifting a finger.`,
      estCTR: (ctr + 2.3).toFixed(1) + "%",
      estConv: "3.4%",
      estROAS: (roas + 0.9).toFixed(1) + "×",
      audiences: comp2.audiences || [],
    },
    {
      type: "YouTube Pre-Roll",
      platform: "Google",
      format: "Skippable In-Stream (15s)",
      headline: `The ${industryName} Tool Market Leaders Don't Want You to Have`,
      copy: `Your top competitors spend heavily on ads every month. InfoGenie reads every campaign they launch and generates a higher-performing counter-campaign for you automatically — for a fraction of their budget. Skip the guessing. Start winning.`,
      estCTR: (ctr + 0.7).toFixed(1) + "%",
      estConv: "3.9%",
      estROAS: (roas + 1.1).toFixed(1) + "×",
      audiences: comp3.audiences || [],
    },
    {
      type: "Thought Leadership — LinkedIn",
      platform: "LinkedIn",
      format: "Document Ad",
      headline: `Why ${industryName} CMOs Are Abandoning Manual Bidding`,
      copy: `We analysed ${competitors.length} competitors in ${industryName}. The ones gaining share all have one thing in common: autonomous AI bidding. Download the free benchmark report — see where the market leaders are spending and where their gaps are.`,
      estCTR: "2.9%",
      estConv: "6.2%",
      estROAS: (roas + 0.4).toFixed(1) + "×",
      audiences: (competitors[3] || competitors[0]).audiences || [],
    },
    {
      type: "TikTok Comparison",
      platform: "TikTok",
      format: "Duet / Reaction (30s)",
      headline: `Reacting to the Biggest ${industryName} Ad of the Year`,
      copy: `We pulled the top-performing campaign in ${industryName} right now. It's good. But our AI found 4 specific weaknesses in the copy, targeting, and timing — and built a version that outperforms it. We'll show you exactly what we changed and why.`,
      estCTR: (ctr + 2.8).toFixed(1) + "%",
      estConv: "2.2%",
      estROAS: (roas + 0.3).toFixed(1) + "×",
      audiences: topComp.audiences || [],
    },
    {
      type: "Dynamic Remarketing — Google",
      platform: "Google",
      format: "Display Network",
      headline: `${industryName} Ads That Auto-Optimise While You Sleep`,
      copy: `Market leaders adjust bids dozens of times per day. You can't match that manually — but InfoGenie can. Our autonomous bidding engine analyses every competitor move in real time and auto-adjusts your campaigns to stay ahead. Set it once. Win continuously.`,
      estCTR: (ctr + 1.1).toFixed(1) + "%",
      estConv: "4.8%",
      estROAS: (roas + 1.6).toFixed(1) + "×",
      audiences: comp2.audiences || [],
    },
    // ── Batch 2 (emotional / urgency hooks) ──
    {
      type: "Search — Intent Capture",
      platform: "Google",
      format: "High-Intent Search",
      headline: `Comparing ${industryName} Platforms? Try InfoGenie First`,
      copy: `Before committing to a market leader, see how InfoGenie delivers ${(ctr + 1.5).toFixed(1)}% CTR vs the industry average of ${ctr}% — with 40% lower spend and AI that self-optimises in real time. Free 14-day trial. No setup fee. Cancel anytime.`,
      estCTR: (ctr + 2.0).toFixed(1) + "%",
      estConv: "4.5%",
      estROAS: (roas + 1.8).toFixed(1) + "×",
      audiences: topComp.audiences || [],
    },
    {
      type: "Reels Ad — Meta",
      platform: "Meta",
      format: "Reels (9:16 Video)",
      headline: `Your ${industryName} Competitors Are Running Ads RIGHT NOW`,
      copy: `While you're reading this, your top competitors are running campaigns targeting your exact audience. InfoGenie detects every new competitor ad within 2 hours of launch and builds you a better version instantly. Try it free — no card needed.`,
      estCTR: (ctr + 2.5).toFixed(1) + "%",
      estConv: "3.3%",
      estROAS: (roas + 0.7).toFixed(1) + "×",
      audiences: comp2.audiences || [],
    },
    {
      type: "Connected TV — Google",
      platform: "Google",
      format: "CTV / YouTube TV (30s)",
      headline: `${industryName} Intelligence That Actually Moves Budget`,
      copy: `Most "intelligence" platforms give you data. InfoGenie gives you done — competitor campaign analysis, counter-ad creation, and autonomous bidding all in one. ${totalCamps} competitor campaigns analysed. ${competitors.length} weakness maps generated. Your move.`,
      estCTR: (ctr + 0.6).toFixed(1) + "%",
      estConv: "4.0%",
      estROAS: (roas + 1.2).toFixed(1) + "×",
      audiences: comp3.audiences || [],
    },
    {
      type: "InMail — LinkedIn",
      platform: "LinkedIn",
      format: "Sponsored Message",
      headline: `We Mapped Every ${industryName} Competitor Ad — For Free`,
      copy: `${competitors.length} competitors. ${totalCamps} active campaigns. Multiple keyword gaps worth hundreds of thousands of monthly searches. Your free ${industryName} competitor intelligence report is ready — click to claim it before your competitors see it.`,
      estCTR: "4.1%",
      estConv: "7.3%",
      estROAS: (roas + 0.8).toFixed(1) + "×",
      audiences: (competitors[3] || competitors[0]).audiences || [],
    },
    {
      type: "Spark Ad — TikTok",
      platform: "TikTok",
      format: "Creator Boost (45s)",
      headline: `I Switched My ${industryName} Platform to InfoGenie — Here's My ROAS`,
      copy: `After 6 months on a legacy platform, my ROAS was stuck at ${(roas - 0.8).toFixed(1)}×. InfoGenie's AI rebuilt my campaigns from competitor data in 4 hours. By week 2, I was at ${(roas + 1.4).toFixed(1)}×. I'll show you exactly what changed — and what it would look like for your industry.`,
      estCTR: (ctr + 3.1).toFixed(1) + "%",
      estConv: "2.8%",
      estROAS: (roas + 1.0).toFixed(1) + "×",
      audiences: topComp.audiences || [],
    },
    {
      type: "Retargeting — Google Display",
      platform: "Google",
      format: "Custom Intent Audience",
      headline: `Still Comparing ${industryName} Options? See the Full Breakdown`,
      copy: `Traditional platforms show you what's happening. InfoGenie acts on it — autonomously launching and optimising counter-campaigns in real time. Industry average ${roas}× ROAS vs ${(roas + 1.4).toFixed(1)}× with InfoGenie on the same budget. See the full breakdown.`,
      estCTR: (ctr + 1.9).toFixed(1) + "%",
      estConv: "5.2%",
      estROAS: (roas + 1.5).toFixed(1) + "×",
      audiences: comp2.audiences || [],
    },
  ];

  const batchSize = 6;
  const batchIndex = round % 3;
  return allCreatives.slice(
    batchIndex * batchSize,
    batchIndex * batchSize + batchSize,
  );
}

// ── Head-to-head "InfoGenie vs. competitor campaign" cards ──────────────────
function buildVsCards(
  industry: Industry,
  competitors: Competitor[],
): VsCard[] {
  const improvements = [
    {
      ctrBoost: "+1.4%",
      roasBoost: "+1.2×",
      cpaReduction: "-28%",
      audienceBoost: "+35%",
      reason:
        "Hyper-specific value proposition outperforms generic brand messaging",
    },
    {
      ctrBoost: "+1.1%",
      roasBoost: "+0.9×",
      cpaReduction: "-22%",
      audienceBoost: "+28%",
      reason: "Urgency-driven copy with social proof converts 2.3× better",
    },
    {
      ctrBoost: "+1.8%",
      roasBoost: "+1.4×",
      cpaReduction: "-31%",
      audienceBoost: "+42%",
      reason:
        "Competitor weakness targeting drives significantly higher intent",
    },
    {
      ctrBoost: "+0.9%",
      roasBoost: "+0.7×",
      cpaReduction: "-19%",
      audienceBoost: "+24%",
      reason: "Personalised audience segmentation beats broad targeting",
    },
    {
      ctrBoost: "+1.3%",
      roasBoost: "+1.1×",
      cpaReduction: "-26%",
      audienceBoost: "+33%",
      reason:
        "Outcome-focused headlines outperform feature-based messaging",
    },
    {
      ctrBoost: "+1.6%",
      roasBoost: "+1.3×",
      cpaReduction: "-29%",
      audienceBoost: "+38%",
      reason:
        "Intent-signal bidding captures high-value moments competitors miss",
    },
    {
      ctrBoost: "+1.0%",
      roasBoost: "+0.8×",
      cpaReduction: "-21%",
      audienceBoost: "+27%",
      reason: "Creative refresh velocity at 8× competitor cadence lifts CTR",
    },
    {
      ctrBoost: "+2.1%",
      roasBoost: "+1.6×",
      cpaReduction: "-34%",
      audienceBoost: "+45%",
      reason:
        "Autonomous multi-channel orchestration eliminates cross-channel waste",
    },
  ];

  const infoGenieHeadlines = [
    `The Smarter ${industry.name} Platform — See Results in 14 Days or Free`,
    `What the Market Leaders Won't Tell You About Their Ad Strategy`,
    `Your Top Competitor Outspends You — Here's How to Beat Them for Less`,
    `The ${industry.name} Playbook That Established Players Don't Want You to Know`,
    `Outperform the Market — AI-Powered Campaigns. Zero Guesswork.`,
    `The Market Leader Is Losing Ground — Your AI Opportunity Window Is Now`,
    `We Mapped Every Competitor Campaign in ${industry.name}. Here's What We Found.`,
    `Manual Campaign Management Can't Compete With Autonomous AI. Here's Proof.`,
  ];

  const infoGenieCopies = [
    `While market leaders rely on broad keyword targeting, our AI pinpoints the exact audience segments their campaigns miss — delivering your message at the precise moment prospects are ready to convert. No wasted spend. No guesswork.`,
    `Generic competitor creatives get lost in the feed. Our AI generates personalised ad variants tailored to each audience segment's language, pain points, and intent signals — driving 2.3× higher engagement at lower cost.`,
    `Your top competitor invests heavily in ads — most of it wasted on the wrong audiences. Our competitor intelligence identifies exactly where their budget bleeds, then targets those gaps with precision campaigns that cost a fraction of their spend.`,
    `Market-leading brands' audiences are actively seeking a better alternative. Our AI identifies dissatisfied customer segments and delivers your superior offer at the exact moment they're considering a switch. Average CPA reduction: 31%.`,
    `Stop reacting to competitors' campaigns. Our autonomous AI monitors the market 24/7 — detecting new creatives, budget shifts, and audience changes — then automatically rebuilds your campaigns to stay one step ahead. Always.`,
    `Your primary competitor is showing early signs of market retreat. Our predictive intelligence detected reduced ad frequency and creative stagnation weeks before their rivals noticed. Your window to capture their audience is open right now.`,
    `We reverse-engineered the top-performing campaigns in ${industry.name}. Our AI identified every messaging gap and built superior variants that outperform the originals across every benchmark we ran — ready to deploy in one click.`,
    `Most competitors optimise campaigns once a week. Our AI optimises every 4 hours — adjusting bids, refreshing creatives, and shifting budget based on live conversion signals. That's 42× more optimisation cycles every month.`,
  ];

  const cards: VsCard[] = [];
  competitors.slice(0, 8).forEach((comp, i) => {
    if (!comp || !comp.campaigns || !comp.campaigns[0]) return;
    const campaign = comp.campaigns[0];
    const imp = improvements[i] || improvements[0];
    // campaign.ctr / campaign.roas can be the placeholder '—' (or null) when a
    // competitor has no metrics. Coerce to a number first and only do the
    // arithmetic when it's finite — otherwise '—' + number would stringify and
    // crash on .toFixed. Render a graceful '—' when the base value is missing.
    const baseCtr = parseFloat(String(campaign.ctr));
    const baseRoas = parseFloat(String(campaign.roas));
    const ourCTR = Number.isFinite(baseCtr)
      ? (baseCtr + parseFloat(imp.ctrBoost)).toFixed(1) + "%"
      : "—";
    const ourROAS = Number.isFinite(baseRoas)
      ? (baseRoas + parseFloat(imp.roasBoost)).toFixed(1) + "×"
      : "—";
    cards.push({
      key: `vs-panel-${i}`,
      compName: comp.name,
      logo: comp.logo,
      campaignName: campaign.name,
      channel: campaign.channel,
      theirCopy:
        comp.suggestions?.[0] ||
        "Generic broad-targeting campaign with standard creative and minimal audience segmentation.",
      theirCTR: campaign.ctr,
      theirROAS: campaign.roas,
      budget: campaign.budget,
      status: campaign.status,
      reason: imp.reason,
      ctrBoost: imp.ctrBoost,
      roasBoost: imp.roasBoost,
      cpaReduction: imp.cpaReduction,
      audienceBoost: imp.audienceBoost,
      ourHeadline: infoGenieHeadlines[i],
      ourCopy: infoGenieCopies[i],
      ourCTR,
      ourROAS,
      vsAudiences: comp.audiences || [],
    });
  });
  return cards;
}

const DEFAULT_SEGMENTS: Audience[] = [
  { label: "High-Intent Converters", pct: 42 },
  { label: "Competitor Switchers", pct: 31 },
  { label: "Research-Phase Buyers", pct: 17 },
  { label: "Brand Loyalists", pct: 10 },
];

function AudiencePanel({
  label,
  audiences,
  onClose,
}: {
  label: string;
  audiences: Audience[];
  onClose: () => void;
}) {
  const segs = audiences.length > 0 ? audiences : DEFAULT_SEGMENTS;
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(segs.map((_, i) => i)),
  );
  const [budget, setBudget] = useState("200");
  const [deploy, setDeploy] = useState<Record<string, boolean>>({
    "Google Ads": true,
    "Meta Ads": true,
    TikTok: false,
    LinkedIn: false,
  });
  const [activated, setActivated] = useState(false);

  const toggleSegment = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const activate = () => {
    if (selected.size === 0) {
      showToast("⚠️ Please select at least one audience segment");
      return;
    }
    showToast(
      `🎯 Auto-targeting activated for "${label}" — ${selected.size} audience segments across selected platforms with $${budget}/day budget. InfoGenie is optimising in real-time.`,
    );
    setActivated(true);
  };

  if (activated) {
    return (
      <div
        style={{
          background: "rgba(16,185,129,.06)",
          border: "1.5px solid var(--green)",
          borderRadius: 10,
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 10,
        }}
      >
        <span style={{ fontSize: "1.25rem" }}>✅</span>
        <div>
          <div
            style={{
              fontSize: "0.875rem",
              fontWeight: 700,
              color: "var(--green)",
            }}
          >
            Auto-Targeting Active
          </div>
          <div style={{ fontSize: "0.8125rem", color: "var(--gray-500)" }}>
            {selected.size} audience segments · ${budget}/day · InfoGenie
            monitoring &amp; optimising 24/7
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="audience-targeting-panel">
      <div className="atp-header">
        <span>🎯</span>
        <div className="atp-title">Audience Auto-Targeting — {label}</div>
        <button className="atp-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="atp-body">
        <div>
          <div className="atp-sub-label">Select Audience Segments to Target</div>
          <div className="atp-segments">
            {segs.map((s, i) => {
              const sel = selected.has(i);
              return (
                <div
                  key={i}
                  className={`atp-segment${sel ? " selected" : ""}`}
                  onClick={() => toggleSegment(i)}
                >
                  <div className="atp-seg-top">
                    <div className="atp-seg-check">{sel ? "✓" : ""}</div>
                    <div className="atp-seg-name">{s.label}</div>
                  </div>
                  <div className="atp-seg-bar-wrap">
                    <div
                      className="atp-seg-bar"
                      style={{ width: `${s.pct}%` }}
                    />
                  </div>
                  <div className="atp-seg-stats">
                    <span>{s.pct}% engagement</span>
                    <span>Est. CPM: ${(8 + s.pct * 0.15).toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="atp-sub-label">
            Exclusion Audiences (auto-applied)
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span className="atp-pill active">Existing Customers</span>
            <span className="atp-pill active">Competitor Employees</span>
            <span className="atp-pill active">Low-LTV Segments</span>
            <span className="atp-pill">Bot / Invalid Traffic</span>
          </div>
        </div>
        <div className="atp-row">
          <div className="atp-row-label">Daily Budget:</div>
          <input
            type="number"
            className="atp-budget-input"
            placeholder="e.g. 150"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
          <span style={{ fontSize: "0.8rem", color: "var(--gray-400)" }}>
            USD/day
          </span>
        </div>
        <div className="atp-row">
          <div className="atp-row-label">Deploy on:</div>
          <div className="atp-pills">
            {Object.keys(deploy).map((p) => (
              <span
                key={p}
                className={`atp-pill${deploy[p] ? " active" : ""}`}
                onClick={() =>
                  setDeploy((prev) => ({ ...prev, [p]: !prev[p] }))
                }
              >
                {p}
              </span>
            ))}
          </div>
        </div>
        <button className="btn-activate-targeting" onClick={activate}>
          🚀 Activate Auto-Targeting Now
        </button>
      </div>
    </div>
  );
}

const PLATFORM_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All Platforms" },
  { id: "google", label: "Google" },
  { id: "meta", label: "Meta" },
  { id: "tiktok", label: "TikTok" },
  { id: "linkedin", label: "LinkedIn" },
];

export default function Creative() {
  const analysisData = getAnalysisData();
  const competitors = useMemo(
    () => analysisData?.competitors || [],
    [analysisData],
  );
  const industry = analysisData?.industry || { name: "your industry" };
  const hasData = !!analysisData && competitors.length > 0;

  const [round, setRound] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [platform, setPlatform] = useState("all");
  const [openPanels, setOpenPanels] = useState<Set<string>>(new Set());

  const aiCards = useMemo(
    () => (hasData ? generateCreatives(industry, competitors, round) : []),
    [hasData, industry, competitors, round],
  );
  const vsCards = useMemo(
    () => (hasData ? buildVsCards(industry, competitors) : []),
    [hasData, industry, competitors],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<{ destroy: () => void } | null>(null);

  const togglePanel = (id: string) => {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generateMore = () => {
    if (!hasData) {
      showToast("⚠️ Run an analysis first to generate creatives");
      return;
    }
    const batchNum = round + 2;
    showToast(
      `✨ Generating creative batch ${batchNum} — new angles, hooks & messaging variants…`,
    );
    setGenerating(true);
    window.setTimeout(() => {
      setRound((r) => r + 1);
      setGenerating(false);
      showToast(`✅ Batch ${batchNum} ready — 6 new creative variants generated`);
    }, 1600);
  };

  const regenAll = () => {
    showToast("⚡ Regenerating creatives with latest competitor intelligence...");
    window.setTimeout(() => {
      setRound((r) => r + 1);
      showToast(
        "✅ 6 new AI creatives generated based on updated competitor data",
      );
    }, 1600);
  };

  // Render / destroy the Chart.js performance-prediction chart.
  useEffect(() => {
    if (!hasData || !canvasRef.current) return;
    const Chart = getChart();
    if (!Chart) return;
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const labels = aiCards.map((c) => c.platform + " · " + c.format.split(" ")[0]);
    const ctrs = aiCards.map((c) => parseFloat(c.estCTR));
    const roasArr = aiCards.map((c) => parseFloat(c.estROAS));

    chartRef.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Est. CTR (%)",
            data: ctrs,
            backgroundColor: "rgba(0,201,200,0.75)",
            borderColor: "#00C9C8",
            borderWidth: 2,
            borderRadius: 6,
            yAxisID: "y",
          },
          {
            label: "Est. ROAS (×)",
            data: roasArr,
            backgroundColor: "rgba(0,102,255,0.55)",
            borderColor: "#0066FF",
            borderWidth: 2,
            borderRadius: 6,
            yAxisID: "y2",
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true, position: "top", labels: { font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (c: { dataset: { label: string }; raw: unknown }) =>
                c.dataset.label + ": " + c.raw,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            position: "left",
            ticks: {
              callback: (v: unknown) => v + "%",
              font: { size: 11 },
            },
            grid: { color: "rgba(0,0,0,.04)" },
          },
          y2: {
            beginAtZero: true,
            position: "right",
            ticks: {
              callback: (v: unknown) => v + "×",
              font: { size: 11 },
            },
            grid: { display: false },
          },
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [aiCards, hasData]);

  const filteredCards = aiCards.filter(
    (c) => platform === "all" || c.type.toLowerCase().includes(platform),
  );

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> AI Creative
              </div>
              <h2 className="view-title">AI Creative Generation Engine</h2>
              <p className="view-sub">
                Ad copy, headlines, and campaign briefs generated from real
                competitor intelligence
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                onClick={generateMore}
                disabled={generating}
              >
                {generating ? "⏳ Generating…" : "✨ Generate More Creatives"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container">
        {!hasData ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 16px",
              color: "var(--gray-400)",
            }}
          >
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>✨</div>
            <div style={{ fontSize: "0.95rem", fontWeight: 700 }}>
              Run a brand analysis first
            </div>
            <div style={{ fontSize: "0.8rem", marginTop: 6 }}>
              Analyse a website on the home page to unlock AI-generated creatives
              built from real competitor intelligence.
            </div>
          </div>
        ) : (
          <>
            <div className="creative-controls">
              <div className="platform-filter">
                {PLATFORM_FILTERS.map((p) => (
                  <button
                    key={p.id}
                    className={`pf-btn${platform === p.id ? " active" : ""}`}
                    onClick={() => setPlatform(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button className="creative-regen-btn" onClick={regenAll}>
                ⚡ Regenerate All
              </button>
            </div>

            <div className="comp-vs-section">
              <div className="comp-vs-label">
                ⚡ InfoGenie vs. Competitor Campaigns — AI-Generated Superior
                Alternatives
              </div>
              <div className="comp-vs-grid" id="vsGrid">
                {vsCards.map((v) => (
                  <div key={v.key}>
                    <div className="comp-vs-card">
                      <div className="comp-vs-side theirs">
                        <div className="cvs-label their-label">
                          🏢 {v.compName}&apos;s Campaign
                        </div>
                        <div className="cvs-comp-name">
                          <div className="cvs-favicon">{v.logo}</div>
                          <div className="cvs-comp-text">
                            {v.campaignName} · {v.channel}
                          </div>
                        </div>
                        <div className="cvs-headline">
                          &quot;{v.campaignName}&quot;
                        </div>
                        <div className="cvs-copy">{v.theirCopy}</div>
                        <div className="cvs-stats">
                          <div className="cvs-stat">
                            <div className="cvs-stat-val">{v.theirCTR}</div>
                            <div className="cvs-stat-lbl">Their CTR</div>
                          </div>
                          <div className="cvs-stat">
                            <div className="cvs-stat-val">{v.theirROAS}×</div>
                            <div className="cvs-stat-lbl">Their ROAS</div>
                          </div>
                          <div className="cvs-stat">
                            <div className="cvs-stat-val">{v.budget}</div>
                            <div className="cvs-stat-lbl">Monthly Budget</div>
                          </div>
                          <div className="cvs-stat">
                            <div className="cvs-stat-val">{v.status}</div>
                            <div className="cvs-stat-lbl">Status</div>
                          </div>
                        </div>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--gray-400)",
                            fontStyle: "italic",
                          }}
                        >
                          ⚠️ {v.reason}
                        </div>
                      </div>

                      <div className="comp-vs-divider">
                        <div className="vs-line" />
                        <div className="vs-circle">VS</div>
                        <div className="vs-line" />
                      </div>

                      <div className="comp-vs-side ours">
                        <div className="cvs-label our-label">
                          ✦ InfoGenie Superior Alternative
                        </div>
                        <div className="cvs-beat-badge">
                          ▲ CTR {v.ctrBoost} · ROAS {v.roasBoost} · CPA{" "}
                          {v.cpaReduction} · Audience {v.audienceBoost}
                        </div>
                        <div className="cvs-headline">
                          &quot;{v.ourHeadline}&quot;
                        </div>
                        <div className="cvs-copy">{v.ourCopy}</div>
                        <div className="cvs-stats">
                          <div className="cvs-stat">
                            <div
                              className="cvs-stat-val"
                              style={{ color: "var(--teal)" }}
                            >
                              {v.ourCTR}
                            </div>
                            <div className="cvs-stat-lbl">Est. CTR</div>
                          </div>
                          <div className="cvs-stat">
                            <div
                              className="cvs-stat-val"
                              style={{ color: "var(--teal)" }}
                            >
                              {v.ourROAS}
                            </div>
                            <div className="cvs-stat-lbl">Est. ROAS</div>
                          </div>
                          <div className="cvs-stat">
                            <div
                              className="cvs-stat-val"
                              style={{ color: "var(--green)" }}
                            >
                              {v.cpaReduction}
                            </div>
                            <div className="cvs-stat-lbl">CPA Change</div>
                          </div>
                          <div className="cvs-stat">
                            <div
                              className="cvs-stat-val"
                              style={{ color: "var(--green)" }}
                            >
                              Auto
                            </div>
                            <div className="cvs-stat-lbl">Optimisation</div>
                          </div>
                        </div>
                        <div className="cvs-actions">
                          <button
                            className="btn-auto-target"
                            onClick={() => togglePanel(v.key)}
                          >
                            🎯 Auto-Target Audience
                          </button>
                          <button
                            className="btn-vs-launch"
                            onClick={() =>
                              showToast(
                                `🚀 Launching superior campaign vs. ${v.compName} on ${v.channel} — InfoGenie AI is configuring targeting and bidding automatically`,
                              )
                            }
                          >
                            🚀 Launch This
                          </button>
                          <button
                            className="btn-vs-copy"
                            onClick={() => copyCreative(v.ourHeadline, v.ourCopy)}
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    </div>
                    {openPanels.has(v.key) && (
                      <AudiencePanel
                        label={v.compName}
                        audiences={v.vsAudiences}
                        onClose={() => togglePanel(v.key)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="comp-vs-label" style={{ marginBottom: 16 }}>
              🤖 Standalone AI-Generated Creatives — Ready to Deploy
            </div>
            <div className="creative-grid" id="creativeCardGrid">
              {filteredCards.map((c, i) => {
                const panelId = `creative-card-${i}`;
                return (
                  <div className="creative-card" key={panelId}>
                    <div className="creative-card-top">
                      <div className="creative-type">{c.type}</div>
                      <div className="creative-headline">
                        &quot;{c.headline}&quot;
                      </div>
                      <div className="creative-ai-badge">AI Generated</div>
                    </div>
                    <div className="creative-card-body">
                      <div className="creative-copy">{c.copy}</div>
                      <div className="creative-meta">
                        <div className="creative-meta-item">
                          <div
                            className="creative-meta-val"
                            style={{ color: "var(--teal)" }}
                          >
                            {c.estCTR}
                          </div>
                          <div className="creative-meta-lbl">Est. CTR</div>
                        </div>
                        <div className="creative-meta-item">
                          <div className="creative-meta-val">{c.estConv}</div>
                          <div className="creative-meta-lbl">Est. Conv.</div>
                        </div>
                        <div className="creative-meta-item">
                          <div className="creative-meta-val">{c.estROAS}</div>
                          <div className="creative-meta-lbl">Est. ROAS</div>
                        </div>
                        <div className="creative-meta-item">
                          <div className="creative-meta-val">{c.platform}</div>
                          <div className="creative-meta-lbl">Platform</div>
                        </div>
                      </div>
                      <div className="creative-actions">
                        <button
                          className="btn-auto-target"
                          onClick={() => togglePanel(panelId)}
                        >
                          🎯 Auto-Target Audience
                        </button>
                        <button
                          className="btn-creative-use"
                          onClick={() =>
                            showToast(
                              "🚀 Campaign launched with this AI creative — InfoGenie is deploying and optimising in real-time",
                            )
                          }
                        >
                          🚀 Launch
                        </button>
                        <button
                          className="btn-creative-copy"
                          onClick={() => copyCreative(c.headline, c.copy)}
                        >
                          Copy
                        </button>
                      </div>
                      {openPanels.has(panelId) && (
                        <AudiencePanel
                          label="InfoGenie AI Creative"
                          audiences={c.audiences}
                          onClose={() => togglePanel(panelId)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="chart-box full">
              <div className="chart-box-header">
                <h3>
                  Creative Performance Prediction{" "}
                  <span className="chart-tag ctr-tag">AI SCORE</span>
                </h3>
                <span
                  style={{ fontSize: "0.8125rem", color: "var(--gray-400)" }}
                >
                  Based on competitor CTR benchmarks and audience engagement
                  signals
                </span>
              </div>
              <canvas ref={canvasRef} height={100} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

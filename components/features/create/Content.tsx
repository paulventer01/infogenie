"use client";

// Native React port of the legacy `content` panel — "Content AI / Content
// Intelligence" (was `window.buildContent` + its helpers in
// public/js/ig_content_social.js, mounted in `#view-content` in index.html).
//
// Faithful port: the Overview / Clusters / Gaps / Audit / Funnel tabs derive the
// same display values from the legacy `window.analysisData` global (set by the
// home-page brand analysis) exactly as the legacy builder did, and the live
// actions hit the SAME Express endpoints via `lib/api`:
//   POST /api/pagespeed/run        (Lighthouse / Core Web Vitals)
//   POST /api/page-audit/run       (real page crawl audit)
//   POST /api/ai-content-clusters  (topical cluster builder)
//   POST /api/seed-topic-suggest   (✨ suggest seed topics)
//   POST /api/ai-build-content     (AI content builder modal)
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Competitor {
  name?: string;
}
interface AnalysisData {
  url?: string;
  industry?: { name?: string };
  competitors?: Competitor[];
}

interface Cluster {
  pillar: string;
  topics?: string[];
  questions?: string[];
  aiNote?: string;
  _dualAI?: boolean;
}

interface GapItem {
  type: string;
  topic: string;
  intent: string;
  volume: string;
  priority: string;
  llm: boolean;
}

interface AuditPage {
  url: string;
  title: string;
  issue: string;
  crawl: number;
  fix: string;
  errorKind?: string;
  ok?: boolean;
}

interface LhMetric {
  display?: string;
}
interface LhOpportunity {
  title: string;
  display?: string;
  savingsMs?: number;
}
interface PageSpeedResult {
  ok: boolean;
  error?: string;
  score: number;
  metrics?: Record<string, LhMetric>;
  opportunities?: LhOpportunity[];
  finalUrl?: string;
  dataSource?: string;
  confidence?: string;
}

interface PageAuditResult {
  ok: boolean;
  error?: string;
  pages?: AuditPage[];
  notice?: string | null;
  domain?: string;
  summary?: {
    elapsedMs?: number;
    blockedAll?: boolean;
    reachable?: number;
    totalChecked?: number;
    avgCrawlScore?: number;
  };
}

interface ClusterResult {
  cluster?: Cluster;
}

interface SeedTopicResult {
  topics?: string[];
  error?: string;
}

interface ClaudeExtras {
  altTitles?: string[];
  expertInsight?: string;
  extraFAQs?: { q: string; a: string }[];
}
interface BuildContentResult {
  article?: string;
  error?: string;
  dualAI?: boolean;
  claudeExtras?: ClaudeExtras;
}

type TabId = "overview" | "clusters" | "gaps" | "audit" | "funnel";

interface FunnelStage {
  id: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  fmt: string;
  tip: string;
}

const FUNNEL_STAGES: FunnelStage[] = [
  { id: "awareness", label: "Awareness", icon: "🌱", color: "#10B981", bg: "#ECFDF5", fmt: "Reels", tip: "Story-driven reels, micro-education, trending angles — stop the scroll." },
  { id: "interest", label: "Interest", icon: "💡", color: "#3B82F6", bg: "#EFF6FF", fmt: "Carousels", tip: "Frameworks, before-after, step-by-step tutorials — convert attention to curiosity." },
  { id: "nurture", label: "Nurture", icon: "❤️", color: "#EC4899", bg: "#FDF2F8", fmt: "Stories", tip: "Process sharing, myth-breaking, polls, soft CTAs — build belief & trust." },
  { id: "conversion", label: "Conversion", icon: "💰", color: "#F59E0B", bg: "#FFFBEB", fmt: "DMs", tip: "Personalised DMs, testimonials, limited-spot urgency — turn trust into sales." },
  { id: "advocacy", label: "Advocacy", icon: "🌟", color: "#0f766e", bg: "#F5F3FF", fmt: "Community", tip: "Client wins, UGC, referrals, private challenges — turn buyers into brand evangelists." },
];

const FORMAT_EXAMPLES: Record<string, [string, string][]> = {
  awareness: [
    ["Story-driven Reel", "Hook with a relatable pain point in the first 2s, educate with one tip, end with a soft CTA"],
    ["Micro-education post", "Teach one high-value concept fast — carousel or short Reel"],
    ["Trend adaptation", "Take a trending format and add your unique niche perspective"],
  ],
  interest: [
    ["Framework carousel", "Visual step-by-step blueprint people will save & share"],
    ["Before / After post", "Show the problem vs the shift — use real data or client results"],
    ["Expert tutorial", 'Position yourself as the authority — "What most people get wrong about X"'],
  ],
  nurture: [
    ["Process story", "Share behind-the-scenes of how you deliver results"],
    ["Belief-breaker story", "Myth-busting content that shifts audience perception"],
    ["Interactive story", "Poll, quiz, or question box — builds micro-commitment"],
  ],
  conversion: [
    ["Personalised DM follow-up", "Use a story or post to prompt followers to DM you a keyword, then deliver value + offer"],
    ["Testimonial / Win post", "Screenshot or video of a real result — builds social proof"],
    ["Limited-spots offer", "Urgency with a specific number — not fake scarcity, real capacity"],
  ],
  advocacy: [
    ["Client feature post", "Celebrate a client win publicly — they share it too"],
    ["UGC reshare", "Repost customer content — lowers your effort, boosts trust"],
    ["Referral challenge", "Private challenge or bonus for clients who bring a friend"],
  ],
};

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "📊 Overview" },
  { id: "clusters", label: "🧩 Topical Clusters" },
  { id: "gaps", label: "🔍 Content Gaps" },
  { id: "audit", label: "🛠️ Page Audit" },
  { id: "funnel", label: "🎯 Funnel Planner" },
];

function getWin<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as Record<string, T>)[key];
}
function setWin<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  (window as unknown as Record<string, unknown>)[key] = value;
}
function toast(msg: string): void {
  getWin<(m: string) => void>("showToast")?.(msg);
}
function getAnalysisData(): AnalysisData | null {
  return getWin<AnalysisData>("analysisData") || null;
}

function firstWord(s: string): string {
  return s.split(" ")[0];
}

export default function Content() {
  const router = useRouter();
  const ad = useMemo(() => getAnalysisData(), []);
  const hasAd = !!ad;
  const domain = ad?.url?.replace(/https?:\/\//, "").split("/")[0] || "yourdomain.com";
  const industry = ad?.industry?.name || "your industry";

  const [tab, setTab] = useState<TabId>("overview");
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [seedInput, setSeedInput] = useState("");
  const [seedSuggestions, setSeedSuggestions] = useState<string[]>([]);
  const [clusterBuilding, setClusterBuilding] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);

  // Page audit + lighthouse
  const [auditPages, setAuditPages] = useState<AuditPage[] | null>(null);
  const [auditNotice, setAuditNotice] = useState<string | null>(null);
  const [auditRunning, setAuditRunning] = useState(false);
  const [lhRunning, setLhRunning] = useState(false);
  const [lh, setLh] = useState<{ strategy: string; data: PageSpeedResult } | null>(null);
  const [lhError, setLhError] = useState<string | null>(null);
  const [lhLoadingStrategy, setLhLoadingStrategy] = useState<string | null>(null);

  // Build-content modal
  const [bcTopic, setBcTopic] = useState<string | null>(null);
  const [bcIntent, setBcIntent] = useState("");

  // Pick up the tab a sibling panel may have requested before navigating here.
  useEffect(() => {
    const req = getWin<TabId>("_contentTab");
    if (req && TABS.some((t) => t.id === req)) setTab(req);
    const prefill = getWin<string>("_clusterSeedPrefill");
    if (prefill) {
      setSeedInput(prefill);
      setWin("_clusterSeedPrefill", "");
    }
  }, []);

  function switchTab(id: TabId, seedPrefill?: string) {
    setWin("_contentTab", id);
    if (seedPrefill) setSeedInput(seedPrefill);
    setTab(id);
  }

  // ── Derived overview data (faithful to legacy) ────────────────────────────
  const trafficHealth = hasAd ? 78 : 65;
  const aiVisibility = hasAd ? 61 : 44;
  const contentScore = hasAd ? 72 : 55;
  const gapCount = hasAd ? 23 : 18;

  const kShifts = useMemo(() => {
    const base = (ad?.competitors || []).slice(0, 4);
    if (base.length) {
      return base.map((c, i) => ({
        term: `${c.name || "competitor"} ${["vs", "alternatives", "pricing", "review"][i % 4]}`,
        change: ["+34%", "+19%", "-12%", "+47%"][i % 4],
        dir: [true, true, false, true][i % 4],
      }));
    }
    return [
      { term: "best marketing platform", change: "+41%", dir: true },
      { term: "ai marketing tools 2025", change: "+67%", dir: true },
      { term: "marketing software review", change: "-8%", dir: false },
      { term: "marketing automation free", change: "+29%", dir: true },
    ];
  }, [ad]);

  const llmGaps = useMemo(
    () => [
      { topic: "What is the best tool for " + firstWord(industry).toLowerCase() + " automation?", cited: false, opportunity: "High" },
      { topic: "How does " + domain + " compare to alternatives?", cited: false, opportunity: "Critical" },
      { topic: "Best practices for " + firstWord(industry).toLowerCase() + " in 2025", cited: false, opportunity: "High" },
      { topic: domain + " pricing and plans breakdown", cited: true, opportunity: "Existing" },
      { topic: "AI-powered " + firstWord(industry).toLowerCase() + " tools comparison", cited: false, opportunity: "Critical" },
    ],
    [domain, industry],
  );

  const gaps = useMemo<GapItem[]>(
    () => [
      { type: "Missing Page", topic: "What is " + firstWord(industry) + " automation?", intent: "Informational", volume: "8.2K/mo", priority: "Critical", llm: true },
      { type: "Thin Content", topic: domain + " vs alternatives comparison", intent: "Comparison", volume: "4.1K/mo", priority: "Critical", llm: true },
      { type: "Missing Page", topic: "Best " + firstWord(industry).toLowerCase() + " tools 2025", intent: "Commercial", volume: "11.5K/mo", priority: "High", llm: true },
      { type: "Outdated", topic: "Getting started with " + domain, intent: "Navigational", volume: "2.8K/mo", priority: "Medium", llm: false },
      { type: "Missing Page", topic: firstWord(industry) + " ROI calculator", intent: "Tool", volume: "3.4K/mo", priority: "High", llm: false },
      { type: "Thin Content", topic: domain + " case studies and success stories", intent: "Trust", volume: "1.9K/mo", priority: "Medium", llm: true },
      { type: "Missing Page", topic: "How to choose a " + firstWord(industry).toLowerCase() + " platform", intent: "Educational", volume: "6.7K/mo", priority: "High", llm: true },
      { type: "Outdated", topic: domain + " pricing guide", intent: "Commercial", volume: "5.3K/mo", priority: "High", llm: false },
    ],
    [domain, industry],
  );

  const defaultAuditPages = useMemo<AuditPage[]>(
    () => [
      { url: "/blog/getting-started", title: "Getting Started Guide", issue: "Outdated — last updated 18 months ago", crawl: 62, fix: "Refresh with 2025 data and add FAQ schema" },
      { url: "/pricing", title: "Pricing Page", issue: "Thin content — no comparison table", crawl: 74, fix: "Add competitor pricing comparison + schema" },
      { url: "/features", title: "Features Overview", issue: "Missing H2 structure, no internal links", crawl: 55, fix: "Add subheadings, internal links, FAQ block" },
      { url: "/blog/ai-tools-comparison", title: "AI Tools Comparison (2023)", issue: "Outdated year in title and body content", crawl: 48, fix: "Update to 2025, add new tools, refresh stats" },
      { url: "/about", title: "About Us", issue: "No structured data or social proof", crawl: 80, fix: "Add LocalBusiness schema + team profiles" },
      { url: "/blog/roi-guide", title: "Marketing ROI Guide", issue: "No internal links pointing here", crawl: 66, fix: "Add internal links from 5 related blog posts" },
    ],
    [],
  );

  const pagesToShow = auditPages ?? defaultAuditPages;

  // ── Actions ───────────────────────────────────────────────────────────────
  async function generateCluster() {
    const seed = seedInput.trim();
    if (!seed) {
      toast("⚠️ Enter a seed topic first");
      return;
    }
    setClusterBuilding(true);
    const clusterIndustry = ad?.industry?.name || "digital marketing";
    const clusterDomain = ad?.url?.replace(/https?:\/\//, "").split("/")[0] || "yourdomain.com";
    const res = await apiPost<ClusterResult & { ok?: boolean }>("/api/ai-content-clusters", {
      seed,
      domain: clusterDomain,
      industry: clusterIndustry,
    });
    if (res.cluster) {
      setClusters((prev) => [res.cluster as Cluster, ...prev]);
      toast(`✅ Topical cluster built for "${seed}"!`);
    } else {
      // Legacy fallback: built-in template cluster when the AI call returns none.
      const fallback: Cluster = {
        pillar: seed,
        topics: [`What is ${seed}?`, `${seed} best practices`, `${seed} for beginners`, `Advanced ${seed} strategies`, `${seed} tools and software`, `${seed} ROI and metrics`, `${seed} case studies`],
        questions: [`What is the best way to get started with ${seed}?`, `How does ${seed} improve business results?`, `What are the most common ${seed} mistakes to avoid?`, `How long does it take to see results from ${seed}?`, `What budget do I need for ${seed}?`, `How does ${seed} compare to traditional methods?`],
        aiNote: `Create a pillar page on "${seed}" and link to all subtopics. Include FAQ schema to maximise LLM citation chances. Publish one supporting page per week for best cluster authority.`,
      };
      setClusters((prev) => [fallback, ...prev]);
      toast(`✅ Cluster built for "${seed}" — built-in template (add an OpenAI key for richer AI suggestions)`);
    }
    setClusterBuilding(false);
  }

  async function suggestSeedTopic() {
    const sDomain = (ad?.url || "").replace(/https?:\/\//, "").split("/")[0] || "";
    const sIndustry = ad?.industry?.name || "";
    const competitorsArr = Array.isArray(ad?.competitors) ? ad!.competitors!.map((c) => c?.name).filter(Boolean) : [];
    const competitors = competitorsArr.join(", ");
    if (!sDomain && !sIndustry) {
      toast("⚠️ Run a brand analysis first so I know your space");
      return;
    }
    setSuggestBusy(true);
    const data = await apiPost<SeedTopicResult>("/api/seed-topic-suggest", {
      domain: sDomain,
      industry: sIndustry,
      competitors,
    });
    if (data && Array.isArray(data.topics) && data.topics.length) {
      setSeedSuggestions(data.topics);
      toast(`✨ ${data.topics.length} seed topic ideas — pick one or type your own`);
    } else {
      setSeedSuggestions([]);
      toast("⚠️ No topics returned — " + (data.error || "try again"));
    }
    setSuggestBusy(false);
  }

  async function runRealPageAudit() {
    if (auditRunning) return;
    const auditDomain = (ad?.url || "").replace(/^https?:\/\//, "").split("/")[0];
    if (!auditDomain) {
      toast("⚠️ Analyse a website on the home page first — we'll audit that domain.");
      return;
    }
    setAuditRunning(true);
    const j = await apiPost<PageAuditResult>("/api/page-audit/run", { domain: auditDomain });
    if (!j.ok || !Array.isArray(j.pages)) {
      toast(`❌ Page audit failed: ${j.error || "Audit failed"}`);
      setAuditRunning(false);
      return;
    }
    setAuditPages(
      j.pages.map((p) => ({
        url: p.url,
        title: p.title || p.url,
        issue: p.issue,
        crawl: p.crawl,
        fix: p.fix,
        errorKind: p.errorKind,
        ok: p.ok,
      })),
    );
    setAuditNotice(j.notice || null);
    setTab("audit");
    const elapsed = j.summary?.elapsedMs ? Math.round(j.summary.elapsedMs / 1000) : "?";
    if (j.summary?.blockedAll) {
      toast(`⛔ ${j.domain} blocks crawlers — see banner above for what to do.`);
    } else {
      toast(`✅ Audited ${j.summary?.reachable || 0} of ${j.summary?.totalChecked || 0} pages on ${j.domain} in ${elapsed}s — avg score ${j.summary?.avgCrawlScore || 0}/100`);
    }
    setAuditRunning(false);
  }

  async function runLighthouse(strategy: string) {
    if (lhRunning) return;
    const lhDomain = (ad?.url || "").replace(/^https?:\/\//, "").split("/")[0];
    if (!lhDomain) {
      toast("⚠️ Analyse a website on the home page first — we'll run Lighthouse on that domain.");
      return;
    }
    const stratNorm = strategy === "desktop" ? "desktop" : "mobile";
    setLhRunning(true);
    setLhError(null);
    setLh(null);
    setLhLoadingStrategy(stratNorm);
    const j = await apiPost<PageSpeedResult>("/api/pagespeed/run", { url: lhDomain, strategy: stratNorm });
    if (!j.ok) {
      setLhError(j.error || "PSI failed");
      toast(`❌ Lighthouse failed: ${j.error || "PSI failed"}`);
    } else {
      setLh({ strategy: stratNorm, data: j });
      toast(`✅ Lighthouse score: ${j.score}/100 (${stratNorm}) — see panel above for details`);
    }
    setLhLoadingStrategy(null);
    setLhRunning(false);
  }

  function openFunnelPost(stage: FunnelStage) {
    setWin("_socialTab", "calendar");
    setWin("_prefillFunnelStage", stage.id);
    toast(`✅ Opening Social Calendar — create a ${stage.fmt} for ${stage.label} stage!`);
    goToView(router, "social");
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="view" style={{ display: "block" }}>
      <style dangerouslySetInnerHTML={{ __html: SPIN_CSS }} />
      <div className="view-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)" }}>
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#64748b" }}>
                <span className="bc-group" style={{ color: "#0f766e" }}>Create</span>{" "}
                <span className="bc-sep" style={{ color: "#94a3b8" }}>›</span> Content AI
              </div>
              <h2 className="view-title">Content Intelligence</h2>
              <p className="view-sub">
                Spot content gaps, build topical clusters and AI-powered page audits — create content that ranks and drives compounding organic traffic
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                style={{ background: "white", color: "#065F46" }}
                onClick={() => {
                  setAuditPages(null);
                  setAuditNotice(null);
                  setTab("gaps");
                  toast("⚡ Content analysis refreshed!");
                }}
              >
                ⚡ Analyse Content
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container">
        <div style={{ padding: "28px 0" }}>
          {/* Tab bar */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                style={{
                  padding: "9px 18px",
                  borderRadius: 9,
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  border: `1.5px solid ${tab === t.id ? "#059669" : "#E5E7EB"}`,
                  background: tab === t.id ? "#065F46" : "white",
                  color: tab === t.id ? "white" : "#374151",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <OverviewTab
              metrics={{ trafficHealth, aiVisibility, contentScore, gapCount }}
              kShifts={kShifts}
              llmGaps={llmGaps}
              onSeedFromTerm={(term) => switchTab("clusters", term)}
            />
          )}

          {tab === "clusters" && (
            <ClustersTab
              clusters={clusters}
              seedInput={seedInput}
              setSeedInput={setSeedInput}
              suggestions={seedSuggestions}
              onPickSuggestion={(s) => {
                setSeedInput(s);
                setSeedSuggestions([]);
                toast("✅ Seed topic selected — click 🧩 Build Cluster");
              }}
              onSuggest={suggestSeedTopic}
              suggestBusy={suggestBusy}
              onGenerate={generateCluster}
              building={clusterBuilding}
              onRemove={(i) => setClusters((prev) => prev.filter((_, idx) => idx !== i))}
            />
          )}

          {tab === "gaps" && (
            <GapsTab
              gaps={gaps}
              onGenerateAll={() => switchTab("clusters")}
              onBuild={(topic, intent) => {
                setBcTopic(topic);
                setBcIntent(intent);
              }}
            />
          )}

          {tab === "audit" && (
            <AuditTab
              pages={pagesToShow}
              notice={auditNotice}
              onRunAudit={runRealPageAudit}
              auditRunning={auditRunning}
              onRunLighthouse={runLighthouse}
              lhRunning={lhRunning}
              lhLoadingStrategy={lhLoadingStrategy}
              lh={lh}
              lhError={lhError}
            />
          )}

          {tab === "funnel" && (
            <FunnelTab
              stages={FUNNEL_STAGES}
              socialPosts={getWin<{ funnelStage?: string }[]>("_socialPosts") || []}
              onCreatePost={openFunnelPost}
            />
          )}
        </div>
      </div>

      {bcTopic !== null && (
        <BuildContentModal
          topic={bcTopic}
          intent={bcIntent}
          ad={ad}
          onClose={() => setBcTopic(null)}
        />
      )}
    </div>
  );
}

const SPIN_CSS = "@keyframes spin{to{transform:rotate(360deg)}}";

// ── Overview tab ────────────────────────────────────────────────────────────
function OverviewTab({
  metrics,
  kShifts,
  llmGaps,
  onSeedFromTerm,
}: {
  metrics: { trafficHealth: number; aiVisibility: number; contentScore: number; gapCount: number };
  kShifts: { term: string; change: string; dir: boolean }[];
  llmGaps: { topic: string; cited: boolean; opportunity: string }[];
  onSeedFromTerm: (term: string) => void;
}) {
  const { trafficHealth, aiVisibility, contentScore, gapCount } = metrics;
  const cards: [string, string, string, string, string][] = [
    ["Traffic Health", trafficHealth + "%", trafficHealth > 70 ? "#10B981" : trafficHealth > 50 ? "#F59E0B" : "#DC2626", "📈", "Traffic Health — how well your site's organic, referral and paid traffic is performing. Green = 70%+, Amber = 50–70%, Red = below 50%."],
    ["Content Score", contentScore + "/100", contentScore > 70 ? "#10B981" : contentScore > 50 ? "#F59E0B" : "#DC2626", "📝", "Content Score — overall quality and depth rating of your published content. 100 = exceptional, 70+ = good, below 50 = needs significant improvement."],
    ["AI Visibility", aiVisibility + "%", aiVisibility > 70 ? "#10B981" : aiVisibility > 50 ? "#F59E0B" : "#DC2626", "🤖", "AI Visibility — percentage of key industry queries where AI assistants (ChatGPT, Gemini, Perplexity) cite or recommend your brand. Higher = better LLM presence."],
    ["Content Gaps", gapCount + " found", "#0f766e", "🔍", "Content Gaps — number of topics your competitors rank for where you currently have no content. Each gap is a missed traffic opportunity."],
  ];
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
        {cards.map(([l, v, c, ic, tip]) => (
          <div key={l} title={tip} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", cursor: "help" }}>
            <div style={{ fontSize: "1.8rem", marginBottom: 4 }}>{ic}</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: "0.65rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Keyword Shifts */}
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.95rem", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>📉 Keyword Shift Monitor</div>
          <div style={{ fontSize: "0.75rem", color: "#6B7280", marginBottom: 12 }}>Trending shifts in your industry — act before traffic drops.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {kShifts.map((k, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: k.dir ? "#F0FDF4" : "#FFF5F5", border: `1px solid ${k.dir ? "#BBF7D0" : "#FCA5A5"}`, borderRadius: 9 }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#374151", flex: 1 }}>{k.term}</div>
                <div style={{ fontSize: "0.78rem", fontWeight: 800, color: k.dir ? "#059669" : "#DC2626", marginLeft: 10 }}>{k.change}</div>
                <button onClick={() => onSeedFromTerm(k.term)} style={{ marginLeft: 10, padding: "3px 9px", background: k.dir ? "#059669" : "#DC2626", border: "none", borderRadius: 6, fontSize: "0.62rem", fontWeight: 700, color: "white", cursor: "pointer" }}>
                  {k.dir ? "Capitalise" : "Defend"}
                </button>
              </div>
            ))}
          </div>
        </div>
        {/* LLM Citation Gaps */}
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.95rem", fontWeight: 800, color: "#0A1628", marginBottom: 6 }}>🤖 AI Visibility Gaps</div>
          <div style={{ fontSize: "0.75rem", color: "#6B7280", marginBottom: 12 }}>Topics where ChatGPT, Gemini & Perplexity are NOT citing your site — fix these to capture LLM traffic.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {llmGaps.map((g, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: g.cited ? "#F0FDF4" : "#FFF5F5", border: `1px solid ${g.cited ? "#BBF7D0" : "#FECACA"}`, borderRadius: 9 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#0A1628", marginBottom: 2 }}>{g.topic}</div>
                  <div style={{ fontSize: "0.62rem", fontWeight: 700, color: g.cited ? "#059669" : g.opportunity === "Critical" ? "#DC2626" : "#D97706" }}>
                    {g.cited ? "✅ Cited" : "⚠️ Not Cited"} · {g.opportunity} Opportunity
                  </div>
                </div>
                {!g.cited && (
                  <button onClick={() => onSeedFromTerm(g.topic)} style={{ marginLeft: 8, padding: "4px 10px", background: "#0f766e", border: "none", borderRadius: 6, fontSize: "0.62rem", fontWeight: 700, color: "white", cursor: "pointer", flexShrink: 0 }}>
                    Fix Gap
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Clusters tab ────────────────────────────────────────────────────────────
function ClustersTab({
  clusters,
  seedInput,
  setSeedInput,
  suggestions,
  onPickSuggestion,
  onSuggest,
  suggestBusy,
  onGenerate,
  building,
  onRemove,
}: {
  clusters: Cluster[];
  seedInput: string;
  setSeedInput: (v: string) => void;
  suggestions: string[];
  onPickSuggestion: (s: string) => void;
  onSuggest: () => void;
  suggestBusy: boolean;
  onGenerate: () => void;
  building: boolean;
  onRemove: (i: number) => void;
}) {
  return (
    <>
      <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 22, marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
        <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1rem", fontWeight: 800, color: "#0A1628", marginBottom: 6 }}>🧩 AI Topical Cluster Builder</div>
        <div style={{ fontSize: "0.78rem", color: "#6B7280", marginBottom: 14 }}>Enter your own seed topic, or click ✨ Suggest Topics for InfoGenie to draft 5 ideas tailored to your brand.</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onGenerate()}
            placeholder="e.g. email marketing automation, AI SEO tools, SaaS pricing strategies…"
            style={{ flex: 1, minWidth: 200, padding: "11px 14px", border: "1.5px solid #E2E8F0", borderRadius: 10, fontSize: "0.82rem", color: "#0A1628", outline: "none", fontFamily: "'Inter',sans-serif" }}
          />
          <button onClick={onSuggest} disabled={suggestBusy} style={{ padding: "11px 16px", background: "white", border: "1.5px solid #059669", borderRadius: 10, fontSize: "0.82rem", fontWeight: 700, color: "#059669", cursor: "pointer", whiteSpace: "nowrap", opacity: suggestBusy ? 0.7 : 1 }}>
            {suggestBusy ? "⏳ Drafting…" : "✨ Suggest Topics"}
          </button>
          <button onClick={onGenerate} disabled={building} style={{ padding: "11px 22px", background: "linear-gradient(135deg,#0f766e,#0284c7)", border: "none", borderRadius: 10, fontSize: "0.85rem", fontWeight: 700, color: "white", cursor: "pointer", whiteSpace: "nowrap" }}>
            {building ? "⏳ Building…" : "🧩 Build Cluster"}
          </button>
        </div>
        {suggestions.length > 0 && (
          <div style={{ display: "flex", marginTop: 12, flexWrap: "wrap", gap: 7 }}>
            <div style={{ fontSize: "0.7rem", color: "#6B7280", fontWeight: 700, width: "100%", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".05em" }}>💡 Tap a topic to use it (or keep typing your own)</div>
            {suggestions.map((s, i) => (
              <button key={i} type="button" onClick={() => onPickSuggestion(s)} style={{ padding: "7px 13px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 999, fontSize: "0.76rem", fontWeight: 600, color: "#065F46", cursor: "pointer", fontFamily: "inherit" }}>
                {s}
              </button>
            ))}
          </div>
        )}
        {building && <div style={{ marginTop: 10, fontSize: "0.78rem", color: "#059669", fontWeight: 600 }}>⏳ Building topical cluster with GPT-4o + Claude Sonnet…</div>}
      </div>
      <div>
        {clusters.length ? (
          clusters.map((cl, ci) => (
            <div key={ci} style={{ background: "white", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 3 }}>Topical Cluster</div>
                  <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1rem", fontWeight: 800, color: "#0A1628" }}>{cl.pillar}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {cl._dualAI && (
                    <span title="Synthesised from GPT-4o + Claude Sonnet" style={{ fontSize: "0.6rem", fontWeight: 700, padding: "3px 9px", borderRadius: 6, background: "linear-gradient(135deg,#EFF6FF,#F3E8FF)", color: "#6D28D9", border: "1px solid #C4B5FD" }}>✨ GPT-4o + Claude</span>
                  )}
                  <span title="Number of subtopic pages in this cluster" style={{ fontSize: "0.65rem", fontWeight: 700, padding: "3px 9px", borderRadius: 6, background: "#EFF6FF", color: "#0066FF" }}>{cl.topics?.length || 0} Topics</span>
                  <span title="Number of user questions to target for AI citation" style={{ fontSize: "0.65rem", fontWeight: 700, padding: "3px 9px", borderRadius: 6, background: "#F3E8FF", color: "#0f766e" }}>{cl.questions?.length || 0} Questions</span>
                  <button onClick={() => onRemove(ci)} style={{ fontSize: "0.65rem", fontWeight: 700, padding: "3px 9px", background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 6, color: "#DC2626", cursor: "pointer" }}>Remove</button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#065F46", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>📄 Subtopics & Pages</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {(cl.topics || []).map((t, ti) => (
                      <div key={ti} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 7, fontSize: "0.75rem", color: "#065F46", fontWeight: 500 }}>
                        <div style={{ width: 6, height: 6, background: "#10B981", borderRadius: "50%", flexShrink: 0 }} />
                        {t}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#6D28D9", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>❓ Real User Questions</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {(cl.questions || []).map((q, qi) => (
                      <div key={qi} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "7px 10px", background: "#F3E8FF", border: "1px solid #DDD6FE", borderRadius: 7, fontSize: "0.74rem", color: "#5B21B6", fontWeight: 500, lineHeight: 1.4 }}>
                        <div style={{ marginTop: 2, flexShrink: 0 }}>❓</div>
                        {q}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {cl.aiNote && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, fontSize: "0.75rem", color: "#92400E", lineHeight: 1.5 }}>
                  <strong>💡 LLM Tip:</strong> {cl.aiNote}
                </div>
              )}
            </div>
          ))
        ) : (
          <div style={{ textAlign: "center", padding: "40px 16px", color: "#9CA3AF" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>🧩</div>
            <div style={{ fontSize: "0.88rem", fontWeight: 600 }}>No clusters yet — build your first topical cluster above</div>
            <div style={{ fontSize: "0.75rem", marginTop: 6 }}>Try: &quot;marketing automation&quot;, &quot;competitor analysis&quot;, or &quot;AI content creation&quot;</div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Gaps tab ────────────────────────────────────────────────────────────────
function GapsTab({
  gaps,
  onGenerateAll,
  onBuild,
}: {
  gaps: GapItem[];
  onGenerateAll: () => void;
  onBuild: (topic: string, intent: string) => void;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1rem", fontWeight: 800, color: "#0A1628" }}>🔍 Content Gap Analysis</div>
          <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: 3 }}>Pages your competitors rank for and AI engines cite — but you&apos;re missing or underperforming on</div>
        </div>
        <button onClick={onGenerateAll} style={{ padding: "9px 18px", background: "linear-gradient(135deg,#0f766e,#0284c7)", border: "none", borderRadius: 9, fontSize: "0.78rem", fontWeight: 700, color: "white", cursor: "pointer" }}>🧩 Generate Clusters for All Gaps</button>
      </div>
      <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", padding: "10px 16px", background: "#F9FAFB", borderBottom: "1px solid #E5E7EB", fontSize: "0.65rem", fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".05em" }}>
          <div>Topic / Page</div><div>Intent</div><div>Volume</div><div>Priority</div><div>Action</div>
        </div>
        {gaps.map((g, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", padding: "12px 16px", borderBottom: "1px solid #F3F4F6", alignItems: "center", gap: 8 }}>
            <div>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#0A1628", marginBottom: 2 }}>{g.topic}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: "0.62rem", fontWeight: 700, padding: "2px 7px", background: g.type === "Missing Page" ? "#FEF2F2" : g.type === "Outdated" ? "#FFFBEB" : "#EFF6FF", color: g.type === "Missing Page" ? "#DC2626" : g.type === "Outdated" ? "#D97706" : "#0066FF", borderRadius: 4 }}>{g.type}</span>
                {g.llm && <span style={{ fontSize: "0.6rem", fontWeight: 700, padding: "2px 7px", background: "#F3E8FF", color: "#0f766e", borderRadius: 4 }}>🤖 LLM Gap</span>}
              </div>
            </div>
            <div style={{ fontSize: "0.75rem", color: "#6B7280", fontWeight: 500 }}>{g.intent}</div>
            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#0A1628" }}>{g.volume}</div>
            <div><span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: g.priority === "Critical" ? "#FEF2F2" : g.priority === "High" ? "#FFFBEB" : "#F0FDF4", color: g.priority === "Critical" ? "#DC2626" : g.priority === "High" ? "#D97706" : "#059669" }}>{g.priority}</span></div>
            <div><button onClick={() => onBuild(g.topic, g.intent)} style={{ padding: "5px 11px", background: "#059669", border: "none", borderRadius: 7, fontSize: "0.68rem", fontWeight: 700, color: "white", cursor: "pointer" }}>✍️ Build Content</button></div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Audit tab ───────────────────────────────────────────────────────────────
function AuditTab({
  pages,
  notice,
  onRunAudit,
  auditRunning,
  onRunLighthouse,
  lhRunning,
  lhLoadingStrategy,
  lh,
  lhError,
}: {
  pages: AuditPage[];
  notice: string | null;
  onRunAudit: () => void;
  auditRunning: boolean;
  onRunLighthouse: (s: string) => void;
  lhRunning: boolean;
  lhLoadingStrategy: string | null;
  lh: { strategy: string; data: PageSpeedResult } | null;
  lhError: string | null;
}) {
  return (
    <>
      {notice && (
        <div style={{ background: "#FEF3C7", border: "1.5px solid #F59E0B", borderRadius: 12, padding: "14px 16px", marginBottom: 14, display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ fontSize: "1.25rem", lineHeight: 1 }}>⛔</div>
          <div>
            <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#92400E", marginBottom: 3 }}>Site blocks automated crawlers</div>
            <div style={{ fontSize: "0.75rem", color: "#78350F", lineHeight: 1.55 }}>{notice}</div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1rem", fontWeight: 800, color: "#0A1628" }}>🛠️ Page Crawlability & Content Audit</div>
          <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: 3 }}>Find pages with crawl issues, thin content, and missing structured data — ranked by fix impact.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => onRunLighthouse("mobile")} disabled={lhRunning} style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0F766E,#14B8A6)", border: "none", borderRadius: 9, fontSize: "0.78rem", fontWeight: 700, color: "white", cursor: "pointer" }}>⚡ Lighthouse (mobile)</button>
          <button onClick={onRunAudit} disabled={auditRunning} style={{ padding: "9px 18px", background: "linear-gradient(135deg,#0f766e,#0284c7)", border: "none", borderRadius: 9, fontSize: "0.78rem", fontWeight: 700, color: "white", cursor: "pointer" }}>{auditRunning ? "⏳ Auditing…" : "⚡ Run Full Audit"}</button>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        {lhRunning && (
          <div style={{ background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 10, padding: "12px 16px", color: "#0F766E", fontSize: "0.78rem" }}>
            ⏳ Running Google Lighthouse ({lhLoadingStrategy}) — this can take 30–60s for heavy sites…
          </div>
        )}
        {!lhRunning && lhError && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 16px", color: "#B91C1C", fontSize: "0.78rem" }}>❌ Lighthouse failed: {lhError}</div>
        )}
        {!lhRunning && lh && <LighthousePanel strategy={lh.strategy} data={lh.data} onSwitch={onRunLighthouse} />}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {pages.map((p, i) => {
          const score = p.crawl;
          const sc = score >= 75 ? "#10B981" : score >= 55 ? "#F59E0B" : "#DC2626";
          return (
            <div key={i} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0A1628" }}>{p.title || ""}</div>
                  <code style={{ fontSize: "0.68rem", color: "#6B7280", background: "#F3F4F6", padding: "1px 7px", borderRadius: 4 }}>{p.url || ""}</code>
                </div>
                <div style={{ fontSize: "0.75rem", color: "#DC2626", fontWeight: 600, marginBottom: 4 }}>⚠️ {p.issue || ""}</div>
                <div style={{ fontSize: "0.74rem", color: "#059669", lineHeight: 1.4 }}><strong>AI Fix:</strong> {p.fix || ""}</div>
              </div>
              <div style={{ textAlign: "center", flexShrink: 0 }}>
                <div style={{ width: 52, height: 52, borderRadius: "50%", background: `conic-gradient(${sc} ${score * 3.6}deg,#E5E7EB ${score * 3.6}deg)`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", margin: "0 auto 4px" }}>
                  <div style={{ width: 36, height: 36, background: "white", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.78rem", fontWeight: 800, color: sc }}>{score}</div>
                </div>
                <div style={{ fontSize: "0.62rem", color: "#6B7280", fontWeight: 600 }}>Crawl Score</div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function LighthousePanel({ strategy, data, onSwitch }: { strategy: string; data: PageSpeedResult; onSwitch: (s: string) => void }) {
  const sc = data.score >= 90 ? "#10B981" : data.score >= 50 ? "#F59E0B" : "#DC2626";
  const m = data.metrics || {};
  const other = strategy === "mobile" ? "desktop" : "mobile";
  const cell = (label: string, val?: string, hint?: string) => (
    <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
      <div style={{ fontSize: "0.62rem", color: "#6B7280", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#0A1628", margin: "3px 0" }}>{val || "—"}</div>
      {hint && <div style={{ fontSize: "0.6rem", color: "#9CA3AF" }}>{hint}</div>}
    </div>
  );
  return (
    <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#0A1628" }}>⚡ Lighthouse · {strategy}</div>
          <div style={{ fontSize: "0.7rem", color: "#6B7280", marginTop: 2 }}>
            Real Core Web Vitals via Google PageSpeed Insights ·{" "}
            <a href={data.finalUrl} target="_blank" rel="noreferrer" style={{ color: "#0F766E" }}>{data.finalUrl}</a>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: `conic-gradient(${sc} ${data.score * 3.6}deg,#E5E7EB ${data.score * 3.6}deg)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <div style={{ width: 46, height: 46, background: "white", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.95rem", fontWeight: 800, color: sc }}>{data.score}</div>
          </div>
          <button onClick={() => onSwitch(other)} style={{ padding: "7px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: "0.7rem", fontWeight: 700, color: "#475569", cursor: "pointer" }}>Switch to {other}</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8 }}>
        {cell("LCP", m.lcp?.display, "Largest Contentful Paint")}
        {cell("FCP", m.fcp?.display, "First Contentful Paint")}
        {cell("CLS", m.cls?.display, "Cumulative Layout Shift")}
        {cell("TBT", m.tbt?.display, "Total Blocking Time")}
        {cell("Speed Index", m.si?.display, "")}
        {cell("TTI", m.tti?.display, "Time to Interactive")}
      </div>
      {(data.opportunities || []).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#0A1628", marginBottom: 6 }}>Top performance opportunities</div>
          {(data.opportunities || []).map((o, i) => (
            <div key={i} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: "0.74rem", color: "#0A1628", flex: 1 }}>{o.title}</div>
              <div style={{ fontSize: "0.7rem", color: "#DC2626", fontWeight: 700, whiteSpace: "nowrap" }}>{o.display || Math.round(o.savingsMs || 0) + "ms"}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 10, padding: "6px 10px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: "0.62rem", color: "#6B7280" }}>
        Source: {data.dataSource} · {data.confidence} confidence
      </div>
    </div>
  );
}

// ── Funnel tab ──────────────────────────────────────────────────────────────
function FunnelTab({
  stages,
  socialPosts,
  onCreatePost,
}: {
  stages: FunnelStage[];
  socialPosts: { funnelStage?: string }[];
  onCreatePost: (s: FunnelStage) => void;
}) {
  const counts: Record<string, number> = {};
  stages.forEach((s) => {
    counts[s.id] = 0;
  });
  socialPosts.forEach((p) => {
    if (p.funnelStage && counts[p.funnelStage] != null) counts[p.funnelStage]++;
  });
  return (
    <>
      <div style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)", borderRadius: 20, padding: "24px 28px", marginBottom: 24 }}>
        <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1.15rem", fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>🎯 Viral Content Funnel Planner</div>
        <div style={{ fontSize: "0.85rem", color: "#0f766e", lineHeight: 1.5 }}>5-stage Instagram growth framework — map every post to a stage and build a funnel that converts strangers into brand evangelists</div>
      </div>
      {stages.map((s) => {
        const examples = FORMAT_EXAMPLES[s.id] || [];
        return (
          <div key={s.id} style={{ background: "white", border: `1.5px solid ${s.color}33`, borderRadius: 18, padding: "22px 24px", marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
              <div style={{ width: 46, height: 46, background: s.bg, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", flexShrink: 0 }}>{s.icon}</div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628" }}>{s.label} Stage</div>
                <div style={{ fontSize: "0.72rem", color: s.color, fontWeight: 700, marginTop: 2 }}>Best format: {s.fmt}</div>
                <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 4, lineHeight: 1.5 }}>{s.tip}</div>
              </div>
              <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "3px 10px", background: s.bg, color: s.color, borderRadius: 7, whiteSpace: "nowrap", height: "fit-content" }}>{counts[s.id] || 0} posts tagged</span>
            </div>
            <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 12 }}>
              <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 }}>Content Ideas</div>
              {examples.map(([title, desc], i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid #F9FAFB" }}>
                  <div style={{ width: 6, height: 6, background: s.color, borderRadius: "50%", marginTop: 6, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#111827" }}>{title}</div>
                    <div style={{ fontSize: "0.68rem", color: "#6B7280", marginTop: 1, lineHeight: 1.45 }}>{desc}</div>
                  </div>
                  <button onClick={() => onCreatePost(s)} style={{ marginLeft: "auto", flexShrink: 0, padding: "5px 12px", background: s.bg, border: `1px solid ${s.color}44`, borderRadius: 8, fontSize: "0.65rem", fontWeight: 700, color: s.color, cursor: "pointer", whiteSpace: "nowrap" }}>+ Create Post</button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ── AI Content Builder modal ────────────────────────────────────────────────
const BC_TYPES: { id: string; label: string; desc: string }[] = [
  { id: "article", label: "📄 Blog Article", desc: "Full authoritative article with FAQ" },
  { id: "howto", label: "🛠️ How-To Guide", desc: "Step-by-step practical guide" },
  { id: "comparison", label: "⚖️ Comparison Page", desc: "Side-by-side competitor comparison" },
  { id: "landing", label: "🚀 Landing Page", desc: "High-converting page copy" },
];

function markdownToHtml(article: string): string {
  return article
    .replace(/^# (.+)$/gm, "<h1 style=\"font-family:'Sora',sans-serif;font-size:1.35rem;font-weight:800;color:white;margin:0 0 14px;line-height:1.3\">$1</h1>")
    .replace(/^## (.+)$/gm, "<h2 style=\"font-family:'Sora',sans-serif;font-size:1rem;font-weight:700;color:#00C9C8;margin:22px 0 8px\">$1</h2>")
    .replace(/^### (.+)$/gm, '<h3 style="font-size:0.88rem;font-weight:700;color:rgba(255,255,255,.7);margin:14px 0 6px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:white">$1</strong>')
    .replace(/^- (.+)$/gm, '<li style="font-size:0.82rem;color:rgba(255,255,255,.75);margin:4px 0;padding-left:6px">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (mm) => `<ul style="margin:8px 0 12px;padding-left:18px">${mm}</ul>`)
    .replace(/^\d+\. (.+)$/gm, '<li style="font-size:0.82rem;color:rgba(255,255,255,.75);margin:6px 0">$1</li>')
    .replace(/^(?!<[h|u|l|s]).+$/gm, (mm) => (mm.trim() ? `<p style="font-size:0.83rem;color:rgba(255,255,255,.75);line-height:1.7;margin:6px 0">${mm}</p>` : ""))
    .trim();
}

function BuildContentModal({ topic, intent, ad, onClose }: { topic: string; intent: string; ad: AnalysisData | null; onClose: () => void }) {
  const [bcType, setBcType] = useState("article");
  const [busy, setBusy] = useState(false);
  const [sec, setSec] = useState(0);
  const [result, setResult] = useState<BuildContentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready to generate");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  async function generate(typeOverride?: string) {
    const contentType = typeOverride || bcType;
    const gDomain = ad?.url?.replace(/https?:\/\//, "").split("/")[0] || "yourdomain.com";
    const gIndustry = ad?.industry?.name || "digital marketing";
    setBusy(true);
    setError(null);
    setResult(null);
    setSec(0);
    setStatus("GPT-4o + Claude Sonnet generating in parallel…");
    if (tickRef.current) clearInterval(tickRef.current);
    let s = 0;
    tickRef.current = setInterval(() => {
      s++;
      setSec(s);
      setStatus(`GPT-4o + Claude Sonnet generating… ${s}s`);
    }, 1000);

    const data = await apiPost<BuildContentResult>("/api/ai-build-content", {
      topic,
      intent,
      domain: gDomain,
      industry: gIndustry,
      contentType,
    });
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (!data.article) {
      setError(data.error || "No content returned");
      setStatus("Generation failed");
      setBusy(false);
      return;
    }
    setResult(data);
    const wordCount = data.article.split(/\s+/).length;
    setStatus(`✅ ${wordCount} words generated in ${s}s`);
    setBusy(false);
  }

  function selectType(id: string) {
    setBcType(id);
    if (result) generate(id);
  }

  function copyContent() {
    if (!result?.article) return;
    const text = result.article;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => toast("📋 Content copied to clipboard!")).catch(() => toast("⚠️ Copy not supported here — use Download instead"));
    } else {
      toast("⚠️ Copy not supported here — use Download instead");
    }
  }

  function downloadContent() {
    if (!result?.article) return;
    const blob = new Blob([result.article], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (topic || "content").replace(/[^a-z0-9]/gi, "_").toLowerCase() + ".txt";
    a.click();
  }

  const wordCount = result?.article ? result.article.split(/\s+/).length : 0;
  const ex = result?.claudeExtras;

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--ig-rgba70)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--ig-panel)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 20, width: "100%", maxWidth: 720, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,.6)" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: "0.6rem", fontWeight: 700, color: "#00C9C8", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 4 }}>AI Content Builder · GPT-4o + Claude Sonnet</div>
            <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1.05rem", fontWeight: 800, color: "white", lineHeight: 1.3 }}>{topic}</div>
            <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,.4)", marginTop: 3 }}>Intent: {intent}</div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,.06)", border: "none", borderRadius: 8, color: "rgba(255,255,255,.5)", fontSize: "1.1rem", width: 32, height: 32, cursor: "pointer", flexShrink: 0 }}>✕</button>
        </div>
        {/* Content type selector */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,.08)", flexShrink: 0 }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "rgba(255,255,255,.4)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>Content Type</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
            {BC_TYPES.map((t) => {
              const selected = bcType === t.id;
              return (
                <button key={t.id} onClick={() => selectType(t.id)} style={{ padding: "12px 8px", background: selected ? "rgba(0,201,200,.15)" : "rgba(100,116,139,.1)", border: `1.5px solid ${selected ? "#00C9C8" : "rgba(100,116,139,.3)"}`, borderRadius: 10, color: "white", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", textAlign: "center", transition: "all .15s" }}>
                  <div style={{ fontSize: "1.4rem", marginBottom: 4 }}>{t.label.split(" ")[0]}</div>
                  <div style={{ color: "white", fontWeight: 700 }}>{t.label.split(" ").slice(1).join(" ")}</div>
                  <div style={{ fontSize: "0.58rem", color: "rgba(255,255,255,.55)", marginTop: 3, fontWeight: 400, lineHeight: 1.3 }}>{t.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
        {/* Output */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", minHeight: 200 }}>
          {busy && (
            <div style={{ textAlign: "center", padding: "40px 16px" }}>
              <div style={{ width: 44, height: 44, border: "3px solid rgba(0,201,200,.2)", borderTopColor: "#00C9C8", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 14px" }} />
              <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "white", marginBottom: 5 }}>Building your content… <span style={{ color: "#00C9C8" }}>{sec}s</span></div>
              <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,.35)" }}>GPT-4o writing the article · Claude Sonnet adding expert insights</div>
            </div>
          )}
          {!busy && error && <div style={{ textAlign: "center", padding: 32, color: "#EF4444", fontSize: "0.82rem" }}>⚠️ {error}</div>}
          {!busy && !error && result?.article && (
            <>
              <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {result.dualAI && <span style={{ fontSize: "0.62rem", fontWeight: 700, padding: "3px 10px", borderRadius: 6, background: "linear-gradient(135deg,rgba(0,201,200,.15),rgba(124,58,237,.15))", color: "#A78BFA", border: "1px solid rgba(167,139,250,.3)" }}>✨ GPT-4o + Claude Sonnet</span>}
                <span style={{ fontSize: "0.62rem", fontWeight: 700, padding: "3px 10px", borderRadius: 6, background: "rgba(255,255,255,.06)", color: "rgba(255,255,255,.5)" }}>{wordCount} words</span>
                <span style={{ fontSize: "0.62rem", fontWeight: 700, padding: "3px 10px", borderRadius: 6, background: "rgba(5,150,105,.12)", color: "#10B981" }}>{bcType.charAt(0).toUpperCase() + bcType.slice(1)}</span>
              </div>
              <div style={{ padding: 20, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 12 }} dangerouslySetInnerHTML={{ __html: markdownToHtml(result.article) }} />
              {ex && (
                <div style={{ marginTop: 24, padding: 16, background: "rgba(124,58,237,.1)", border: "1px solid rgba(124,58,237,.25)", borderRadius: 12 }}>
                  <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#A78BFA", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 12 }}>✨ Claude Sonnet Additions</div>
                  {ex.altTitles && ex.altTitles.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "rgba(255,255,255,.5)", marginBottom: 6 }}>Alternative Headlines</div>
                      {ex.altTitles.map((t, i) => (
                        <div key={i} style={{ fontSize: "0.82rem", color: "white", padding: "6px 10px", background: "rgba(255,255,255,.05)", borderRadius: 7, marginBottom: 4, fontWeight: 600 }}>{t}</div>
                      ))}
                    </div>
                  )}
                  {ex.expertInsight && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "rgba(255,255,255,.5)", marginBottom: 6 }}>Expert Insight</div>
                      <div style={{ fontSize: "0.82rem", color: '#475569', lineHeight: 1.6, padding: "8px 12px", background: "rgba(255,255,255,.04)", borderLeft: "3px solid #A78BFA", borderRadius: "0 8px 8px 0" }}>{ex.expertInsight}</div>
                    </div>
                  )}
                  {ex.extraFAQs && ex.extraFAQs.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "rgba(255,255,255,.5)", marginBottom: 6 }}>Additional FAQ Questions</div>
                      {ex.extraFAQs.map((f, i) => (
                        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", background: "rgba(255,255,255,.04)", borderRadius: 8 }}>
                          <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#A78BFA", marginBottom: 3 }}>{f.q}</div>
                          <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,.65)", lineHeight: 1.5 }}>{f.a}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {!busy && !error && !result && (
            <div style={{ textAlign: "center", padding: "40px 16px", color: "rgba(255,255,255,.25)" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>✍️</div>
              <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>Choose a content type above, then click Generate</div>
            </div>
          )}
        </div>
        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexShrink: 0 }}>
          <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,.35)" }}>{status}</div>
          <div style={{ display: "flex", gap: 8 }}>
            {result?.article && (
              <button onClick={copyContent} style={{ padding: "9px 16px", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 9, color: "rgba(255,255,255,.7)", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>📋 Copy</button>
            )}
            {result?.article && (
              <button onClick={downloadContent} style={{ padding: "9px 16px", background: "rgba(0,201,200,.12)", border: "1px solid rgba(0,201,200,.25)", borderRadius: 9, color: "#00C9C8", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>⬇️ Download</button>
            )}
            <button onClick={() => generate()} disabled={busy} style={{ padding: "11px 22px", background: "linear-gradient(135deg,#10B981,#059669)", border: "none", borderRadius: 9, color: "#FFFFFF", fontSize: "0.85rem", fontWeight: 800, cursor: "pointer", letterSpacing: ".02em", textShadow: "0 1px 2px rgba(0,0,0,.35)", boxShadow: "0 4px 12px rgba(16,185,129,.35)" }}>
              {busy ? "⏳ Generating…" : result?.article ? "🔄 Regenerate" : "⚡ Generate Content"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

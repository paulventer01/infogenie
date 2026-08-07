"use client";

// Native React port of the legacy `autoseo` panel (was `buildAutoSEO` and the
// AutoSEO Pro cluster in public/js/ig_manual_comp_autoseo.js + `#view-autoseo`
// / `#autoseoWrap` in index.html). AI-powered SEO on autopilot — content
// calendar, backlink targets, outreach sequencer, keyword research, traffic
// intelligence and automation settings + WordPress publishing.
//
// Calls the SAME Express endpoints as the legacy module:
//   POST /api/generate-article-topics
//   POST /api/generate-seo-article
//   POST /api/publish-to-wordpress
//   POST /api/content-fact-check
//   POST /api/content-fact-check/auto-correct
//   POST /api/backlink-opportunities
//   POST /api/keyword-research
//   POST /api/generate-outreach-sequence
//   POST /api/traffic-projection
//
// Cross-module legacy globals it still relies on (set by the replayed SPA):
//   window.analysisData, window.showToast, window._wpCreds,
//   window.openWpCredentialsModal, window._socialPosts.
//
// See docs/react-panel-migration.md for the porting pattern.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  apiPost,
} from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────
type ArticleStatus =
  | "pending"
  | "generating"
  | "generated"
  | "publishing"
  | "published";

interface FactClaim {
  claim?: string;
  correction?: string;
  reason?: string;
  evidence?: string;
}
interface FactCheck {
  ok?: boolean;
  error?: string;
  sourceFetched?: boolean;
  note?: string;
  alignmentScore?: number;
  summary?: string;
  sourceLength?: number;
  contradicting?: FactClaim[];
  unverifiable?: FactClaim[];
  aligned?: FactClaim[];
}
interface Article {
  title: string;
  keyword: string;
  intent?: string;
  status: ArticleStatus;
  generatedHtml: string | null;
  wordCount?: number;
  customDate?: string;
  wpUrl?: string;
  factCheck?: FactCheck;
}

interface Keyword {
  keyword: string;
  monthly_volume?: number;
  difficulty?: number;
  cpc?: number | string;
  intent?: string;
  opportunity_score?: number;
  content_angle?: string;
}

interface BacklinkOpp {
  site: string;
  url: string;
  dr: number | string;
  type: string;
  angle: string;
  difficulty: string;
}

interface OutreachEmail {
  subject: string;
  body: string;
}
interface OutreachState {
  status: string;
  emails: OutreachEmail[] | null;
}

interface KeywordRanking {
  keyword: string;
  monthly_volume?: number;
  current_position?: number;
  projected_position_90d?: number;
}
interface MonthlyBreakdown {
  total_traffic?: number;
}
interface TrafficData {
  baseline_monthly?: number;
  projected_monthly_30d?: number;
  projected_monthly_60d?: number;
  projected_monthly_90d?: number;
  growth_pct_90d?: number;
  da_improvement?: number | string;
  monthly_breakdown?: MonthlyBreakdown[];
  keyword_rankings?: KeywordRanking[];
  top_opportunities?: string[];
}

interface Schedule {
  frequency: string;
  count: number;
  tone: string;
  wordCount: number;
  startDate: string;
  endDate: string;
}

interface WpCreds {
  siteUrl?: string;
  username?: string;
  appPassword?: string;
}
interface AnalysisIndustry {
  name?: string;
}
interface AnalysisCompetitor {
  name?: string;
  domain?: string;
  url?: string;
}
interface AnalysisData {
  url?: string;
  domain?: string;
  industry?: string | AnalysisIndustry;
  competitors?: AnalysisCompetitor[];
}
interface SocialPost {
  id: string;
  platform: string;
  caption: string;
  scheduledDate: string;
  scheduledTime: string;
  status: string;
  sourceArticleIdx: number;
  sourceArticleTitle: string;
  fileName: string | null;
  createdAt: string;
}

// API response shapes (legacy endpoints return raw JSON, not always {ok}).
interface TopicsResp {
  ok?: boolean;
  topics?: { title: string; keyword: string; intent?: string }[];
}
interface ArticleResp {
  ok?: boolean;
  content?: string;
  wordCount?: number;
}
interface PublishResp {
  ok?: boolean;
  url?: string;
  error?: string;
}
interface AutoCorrectResp {
  ok?: boolean;
  error?: string;
  correctedHtml?: string;
  edits?: { before?: string; after?: string; reason?: string }[];
}
interface BacklinkResp {
  ok?: boolean;
  opportunities?: BacklinkOpp[];
  data_unavailable?: boolean;
  _dataMode?: string;
  _demo?: boolean;
}
interface KeywordResp {
  ok?: boolean;
  keywords?: Keyword[];
}
interface OutreachResp {
  ok?: boolean;
  emails?: OutreachEmail[];
}

// ── Window helpers ─────────────────────────────────────────────────────────────
function getAnalysisData(): AnalysisData | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || null;
}
function getWpCreds(): WpCreds | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { _wpCreds?: WpCreds })._wpCreds || null;
}
function toast(msg: string): void {
  if (typeof window === "undefined") return;
  (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
}
function openWpModal(): void {
  if (typeof window === "undefined") return;
  (window as unknown as { openWpCredentialsModal?: () => void }).openWpCredentialsModal?.();
}
function getSocialPosts(): SocialPost[] {
  if (typeof window === "undefined") return [];
  const w = window as unknown as { _socialPosts?: SocialPost[] };
  if (!w._socialPosts) w._socialPosts = [];
  return w._socialPosts;
}

const _today = new Date().toISOString().split("T")[0];
const _nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  .toISOString()
  .split("T")[0];

const TONES = ["professional", "conversational", "authoritative", "friendly", "educational"];
const WORD_COUNTS = [800, 1000, 1200, 1500, 2000, 2500];

const TABS = [
  { id: "calendar", label: "📅 Content Calendar" },
  { id: "backlinks", label: "🔗 Backlink Targets" },
  { id: "outreach", label: "📬 Outreach Sequencer" },
  { id: "keywords", label: "🔍 Keyword Research" },
  { id: "traffic", label: "📈 Traffic Intel" },
  { id: "settings", label: "⚙️ Automation Settings" },
];

// ── Date helpers ───────────────────────────────────────────────────────────────
function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function artInterval(sch: Schedule, articlesLen: number): number {
  const s = new Date(sch.startDate || new Date());
  const e = new Date(sch.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  const totalDays = Math.max(1, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)));
  const count = articlesLen || sch.count || 30;
  return Math.max(1, Math.round(totalDays / count));
}
function artDate(i: number, sch: Schedule, articles: Article[] | null): string {
  if (articles && articles[i] && articles[i].customDate) return articles[i].customDate as string;
  const s = new Date(sch.startDate || new Date());
  const interval = artInterval(sch, articles?.length || 0);
  const d = new Date(s.getTime() + i * interval * 24 * 60 * 60 * 1000);
  return d.toISOString().split("T")[0];
}

const esc = (s?: string): string => String(s || "");

export default function Autoseo() {
  const [tab, setTab] = useState("calendar");
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [keywords, setKeywords] = useState<Keyword[] | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkOpp[] | null>(null);
  const [backlinksUnavailable, setBacklinksUnavailable] = useState(false);
  const [outreach, setOutreach] = useState<Record<number, OutreachState>>({});
  const [traffic, setTraffic] = useState<TrafficData | null>(null);
  const [schedule, setSchedule] = useState<Schedule>({
    frequency: "monthly",
    count: 30,
    tone: "professional",
    wordCount: 1200,
    startDate: _today,
    endDate: _nextMonth,
  });

  const [manualDomain, setManualDomain] = useState("");
  const [manualIndustry, setManualIndustry] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [industryInput, setIndustryInput] = useState("");
  const [senderName, setSenderName] = useState("");
  const [kwSeed, setKwSeed] = useState("");

  const [genLoading, setGenLoading] = useState(false);
  const [genTimer, setGenTimer] = useState(0);
  const [blLoading, setBlLoading] = useState(false);
  const [kwLoading, setKwLoading] = useState(false);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [seqLoading, setSeqLoading] = useState<number | null>(null);

  // Modals
  const [calOpen, setCalOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [openOutreach, setOpenOutreach] = useState<Record<number, boolean>>({});
  const [factChecking, setFactChecking] = useState(false);
  const [autoCorrecting, setAutoCorrecting] = useState(false);
  const [autoCorrectInfo, setAutoCorrectInfo] = useState<AutoCorrectResp | null>(null);

  // tick to keep WordPress connection status reactive after legacy modal saves
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, []);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const analysisData = getAnalysisData();
  const wpCreds = getWpCreds();
  const wpConnected = !!(wpCreds && wpCreds.siteUrl && wpCreds.appPassword);

  // ── Context (domain / industry / competitors) ───────────────────────────────
  const ctx = useMemo(() => {
    if (analysisData) {
      const domain = analysisData.url || analysisData.domain || "";
      const industry =
        analysisData.industry && typeof analysisData.industry === "object"
          ? analysisData.industry.name || "General"
          : (analysisData.industry as string) || "General";
      const comps = (analysisData.competitors || [])
        .map((c) => c.name || c.domain || c.url || "")
        .filter(Boolean);
      return { domain, industry, comps };
    }
    return {
      domain: manualDomain || "",
      industry: manualIndustry || "General",
      comps: [] as string[],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisData, manualDomain, manualIndustry]);

  const needsSetup = !analysisData && !manualDomain;
  const domain = ctx.domain || "yourdomain.com";
  const industry = ctx.industry;

  function updateArticle(idx: number, patch: Partial<Article>) {
    setArticles((prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────────
  function saveAutoSeoDomain() {
    const dom = domainInput.trim().replace(/https?:\/\//, "").replace(/www\./, "").replace(/\//, "");
    if (!dom) {
      toast("⚠️ Please enter your domain");
      return;
    }
    setManualDomain(dom);
    setManualIndustry(industryInput.trim() || "General");
    toast(`✅ Domain set to ${dom}`);
  }

  async function generateArticleTopics() {
    if (!ctx.domain) {
      toast("⚠️ Enter your domain in the field above first");
      return;
    }
    setGenLoading(true);
    setGenTimer(0);
    const start = Date.now();
    timerRef.current = setInterval(() => setGenTimer(Math.floor((Date.now() - start) / 1000)), 1000);
    const data = await apiPost<TopicsResp>("/api/generate-article-topics", {
      domain: ctx.domain,
      industry: ctx.industry,
      competitors: ctx.comps,
      count: schedule.count,
      tone: schedule.tone,
    });
    if (timerRef.current) clearInterval(timerRef.current);
    if (data.topics && data.topics.length) {
      setArticles(
        data.topics.map((t) => ({
          title: t.title,
          keyword: t.keyword,
          intent: t.intent,
          status: "pending" as ArticleStatus,
          generatedHtml: null,
        })),
      );
      toast(`✅ ${data.topics.length} article topics generated in ${Math.floor((Date.now() - start) / 1000)}s!`);
    } else {
      toast("⚠️ Could not generate topics — try again");
    }
    setGenLoading(false);
  }

  async function generateSingleArticle(idx: number) {
    if (!articles || !articles[idx]) return;
    const art = articles[idx];
    updateArticle(idx, { status: "generating" });
    const data = await apiPost<ArticleResp>("/api/generate-seo-article", {
      title: art.title,
      keyword: art.keyword,
      domain: ctx.domain || "yourdomain.com",
      industry: ctx.industry,
      competitors: ctx.comps,
      wordCount: schedule.wordCount,
      tone: schedule.tone,
    });
    if (data.content) {
      updateArticle(idx, { generatedHtml: data.content, status: "generated", wordCount: data.wordCount });
      toast(`✅ Article written: "${art.title.substring(0, 40)}…"`);
    } else {
      updateArticle(idx, { status: "pending" });
      toast("⚠️ Could not write article");
    }
  }

  async function publishSingleArticle(idx: number) {
    if (!articles || !articles[idx]) return;
    const art = articles[idx];
    if (!art.generatedHtml) {
      toast("⚠️ Generate the article first");
      return;
    }
    const creds = getWpCreds();
    if (!creds || !creds.siteUrl || !creds.appPassword) {
      toast("⚠️ Connect WordPress first");
      openWpModal();
      return;
    }
    updateArticle(idx, { status: "publishing" });
    const data = await apiPost<PublishResp>("/api/publish-to-wordpress", {
      siteUrl: creds.siteUrl,
      username: creds.username,
      appPassword: creds.appPassword,
      title: art.title,
      content: art.generatedHtml,
    });
    if (data.url) {
      updateArticle(idx, { status: "published", wpUrl: data.url });
      toast("🟦 Published to WordPress as draft!");
    } else {
      updateArticle(idx, { status: "generated" });
      toast("⚠️ Publish failed: " + (data.error || "Unknown error"));
    }
  }

  async function publishAllToWordPress() {
    const arts = (articles || []).filter((a) => a.status === "generated");
    if (!arts.length) {
      toast("⚠️ No generated articles to publish");
      return;
    }
    toast(`🚀 Publishing ${arts.length} articles…`);
    for (const a of arts) {
      const idx = (articles || []).indexOf(a);
      await publishSingleArticle(idx);
      await new Promise((r) => setTimeout(r, 600));
    }
    toast("✅ All articles published to WordPress!");
  }

  async function runArticleFactCheck(idx: number) {
    if (!articles || !articles[idx] || !articles[idx].generatedHtml) return;
    setFactChecking(true);
    setAutoCorrectInfo(null);
    const d = await apiPost<FactCheck>("/api/content-fact-check", {
      content: articles[idx].generatedHtml,
      domain: ctx.domain || "yourdomain.com",
    });
    setFactChecking(false);
    if (!d.ok) {
      updateArticle(idx, { factCheck: { ok: false, error: d.error || "Fact-check failed" } });
      return;
    }
    if (!d.sourceFetched) {
      updateArticle(idx, { factCheck: { ok: true, sourceFetched: false, note: d.note } });
      return;
    }
    updateArticle(idx, { factCheck: d });
  }

  async function runArticleAutoCorrect(idx: number) {
    if (!articles || !articles[idx] || !articles[idx].factCheck) {
      toast("⚠️ Run a fact-check first");
      return;
    }
    const fc = articles[idx].factCheck as FactCheck;
    setAutoCorrecting(true);
    const start = Date.now();
    const r = await apiPost<AutoCorrectResp>("/api/content-fact-check/auto-correct", {
      content: articles[idx].generatedHtml,
      contradictions: fc.contradicting || [],
      unverifiable: fc.unverifiable || [],
      domain: ctx.domain || "yourdomain.com",
    });
    setAutoCorrecting(false);
    if (!r.ok) {
      toast("❌ " + (r.error || "Auto-correct failed"));
      return;
    }
    if (r.correctedHtml) updateArticle(idx, { generatedHtml: r.correctedHtml });
    setAutoCorrectInfo(r);
    toast(`✨ Auto-corrected ${(r.edits || []).length} passages in ${Math.floor((Date.now() - start) / 1000)}s`);
  }

  async function loadBacklinkOpps() {
    if (!ctx.domain) {
      toast("⚠️ Enter your domain in the field above first");
      return;
    }
    setBlLoading(true);
    const kws = (keywords || []).slice(0, 5).map((k) => k.keyword);
    const data = await apiPost<BacklinkResp>("/api/backlink-opportunities", {
      domain: ctx.domain,
      industry: ctx.industry,
      competitors: ctx.comps,
      keywords: kws,
    });
    setBlLoading(false);
    const unavailable = data.data_unavailable === true;
    setBacklinksUnavailable(unavailable);
    setBacklinks(data.opportunities || []);
    if (unavailable) {
      toast("📭 Backlink data unavailable — Demo Data Mode is off (admin can enable it).");
    } else {
      toast(`✅ Found ${(data.opportunities || []).length} backlink opportunities!`);
    }
  }

  async function loadKeywordResearch() {
    if (!ctx.domain) {
      toast("⚠️ Enter your domain in the field above first");
      return;
    }
    setKwLoading(true);
    const data = await apiPost<KeywordResp>("/api/keyword-research", {
      domain: ctx.domain,
      industry: ctx.industry,
      seedKeyword: kwSeed.trim(),
      competitors: ctx.comps,
    });
    setKwLoading(false);
    setKeywords(data.keywords || []);
    toast(`✅ Found ${(data.keywords || []).length} keyword opportunities!`);
  }

  function addKeywordsToCalendar() {
    if (!keywords || !keywords.length) {
      toast("⚠️ No keywords to add");
      return;
    }
    const top5 = [...keywords]
      .sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0))
      .slice(0, 5);
    setArticles((prev) => {
      const next = prev ? prev.slice() : [];
      top5.forEach((k) => {
        if (!next.find((a) => a.keyword === k.keyword)) {
          next.push({
            title: k.content_angle || `Complete Guide to ${k.keyword}`,
            keyword: k.keyword,
            intent: k.intent,
            status: "pending",
            generatedHtml: null,
          });
        }
      });
      return next;
    });
    setTab("calendar");
    toast(`📅 Added ${top5.length} keywords to your content calendar!`);
  }

  function copyKeywordsCSV() {
    if (!keywords || !keywords.length) {
      toast("⚠️ No keywords to copy");
      return;
    }
    const csv = [
      "Keyword,Volume,Difficulty,CPC,Intent,Score,Content Angle",
      ...keywords.map(
        (k) =>
          `"${k.keyword}",${k.monthly_volume || 0},${k.difficulty || 0},$${k.cpc || 0},"${k.intent || ""}",${k.opportunity_score || 0},"${k.content_angle || ""}"`,
      ),
    ].join("\n");
    navigator.clipboard.writeText(csv).then(() => toast("📋 Keywords copied as CSV!"));
  }

  function copyOutreachEmail(idx: number) {
    const opp = backlinks && backlinks[idx];
    if (!opp) return;
    const email = `Subject: Guest Post Opportunity — ${ctx.domain || "Our Site"}

Hi ${opp.site} Team,

I came across your site and noticed you cover topics relevant to ${ctx.industry || "our industry"}.

${opp.angle}

I'd love to contribute a high-quality, original article to your publication. In return, a contextual backlink to ${ctx.domain || "our site"} would be greatly appreciated.

Would you be open to a quick chat or can I send over some topic ideas?

Best regards,
[Your Name]
${ctx.domain || "yourdomain.com"}`;
    navigator.clipboard.writeText(email).then(() => toast("📧 Outreach email copied to clipboard!"));
  }

  function addArticleToSocialCalendar(idx: number) {
    if (!articles || !articles[idx]) return;
    const art = articles[idx];
    const pubDate = artDate(idx, schedule, articles);
    const domainStr = ctx.domain || "yourdomain.com";
    const caption =
      `📝 New Article: "${art.title}"\n\n` +
      `Looking to learn more about ${art.keyword}? We've just published a comprehensive guide covering everything you need to know.\n\n` +
      `👉 Read it now at ${domainStr}\n\n` +
      `#${(art.keyword || "").replace(/\s+/g, "")} #${ctx.industry.replace(/\s+/g, "")} #SEO #ContentMarketing`;
    const posts = getSocialPosts();
    const platforms = ["Blog / LinkedIn", "Instagram", "Twitter / X"];
    let added = 0;
    platforms.forEach((platform) => {
      const exists = posts.some((p) => p.sourceArticleIdx === idx && p.platform === platform);
      if (!exists) {
        posts.push({
          id: "art_" + idx + "_" + platform.replace(/\W+/g, "") + "_" + Date.now(),
          platform,
          caption,
          scheduledDate: pubDate,
          scheduledTime: "09:00",
          status: "scheduled",
          sourceArticleIdx: idx,
          sourceArticleTitle: art.title,
          fileName: null,
          createdAt: new Date().toLocaleString(),
        });
        added++;
      }
    });
    if (added > 0) {
      toast(`📲 Added "${art.title.substring(0, 35)}…" to Social Calendar on ${fmtDate(pubDate)}`);
      setTick((t) => t + 1);
    } else {
      toast("ℹ️ This article is already in the Social Calendar");
    }
  }

  function addAllGeneratedToSocialCalendar() {
    const arts = (articles || []).filter((a) => a.generatedHtml);
    if (!arts.length) {
      toast("⚠️ Write at least one article first — then add to Social Calendar");
      return;
    }
    arts.forEach((a) => addArticleToSocialCalendar((articles || []).indexOf(a)));
    toast(`📲 ${arts.length} articles added to Social Calendar!`);
  }

  async function generateOutreachSequence(idx: number) {
    const opp = backlinks && backlinks[idx];
    if (!opp) return;
    setSeqLoading(idx);
    const sender = senderName || "The Team";
    const data = await apiPost<OutreachResp>("/api/generate-outreach-sequence", {
      site: opp.site,
      url: opp.url,
      type: opp.type,
      angle: opp.angle,
      domain: ctx.domain,
      industry: ctx.industry,
      senderName: sender,
    });
    setSeqLoading(null);
    setOutreach((prev) => ({
      ...prev,
      [idx]: { status: prev[idx]?.status || "not_started", emails: data.emails || [] },
    }));
    setOpenOutreach((prev) => ({ ...prev, [idx]: true }));
    toast(`✅ 3-email sequence written for ${opp.site}!`);
  }

  function setOutreachStatus(idx: number, status: string) {
    setOutreach((prev) => ({
      ...prev,
      [idx]: { status, emails: prev[idx]?.emails || null },
    }));
    if (status === "secured")
      toast("🎉 Link secured! Great work — this will boost your domain authority.");
  }

  function copyOutreachEmailText(idx: number, ei: number) {
    const or = outreach[idx];
    if (!or || !or.emails || !or.emails[ei]) return;
    const { subject, body } = or.emails[ei];
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => toast("📋 Email copied to clipboard!"));
  }

  async function loadTrafficProjection() {
    setTrafficLoading(true);
    const kws = keywords || [];
    const articlesCount = (articles || []).length;
    const backlinksCount = Object.values(outreach).filter((o) => o.status === "secured").length;
    const data = await apiPost<TrafficData>("/api/traffic-projection", {
      domain: ctx.domain,
      industry: ctx.industry,
      articlesPublished: articlesCount,
      backlinksSecured: backlinksCount,
      keywords: kws,
    });
    setTrafficLoading(false);
    setTraffic(data);
    toast("📈 Traffic projection generated!");
  }

  // Calendar edit popup
  function openCalEdit(idx: number) {
    if (!articles || !articles[idx]) return;
    setEditIdx(idx);
    setEditTitle(articles[idx].title || "");
    setEditDate(articles[idx].customDate || artDate(idx, schedule, articles));
  }
  function calSaveEdit() {
    if (editIdx === null) return;
    const patch: Partial<Article> = {};
    if (editTitle.trim()) patch.title = editTitle.trim();
    if (editDate) patch.customDate = editDate;
    updateArticle(editIdx, patch);
    setEditIdx(null);
    toast(`✅ Article #${editIdx + 1} updated`);
  }
  function calDeleteArticle(idx: number) {
    if (!confirm("Delete article #" + (idx + 1) + "? This cannot be undone.")) return;
    setArticles((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev));
    setEditIdx(null);
    toast("🗑️ Article deleted from calendar");
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const blkCount = backlinks ? backlinks.length : "—";
  const kwCount = keywords ? keywords.length : "—";
  const stats = [
    { icon: "📄", label: "Articles / Month", val: String(schedule.count), color: "#059669", bg: "#F0FDF4" },
    { icon: "🔗", label: "Backlinks Tracked", val: String(blkCount), color: "#0066FF", bg: "#EFF6FF" },
    { icon: "🔍", label: "Keywords Found", val: String(kwCount), color: "#7C3AED", bg: "#F5F3FF" },
    {
      icon: "🟦",
      label: "WordPress",
      val: wpConnected ? "Connected" : "Not Connected",
      color: wpConnected ? "#059669" : "#DC2626",
      bg: wpConnected ? "#F0FDF4" : "#FFF1F2",
    },
  ];

  return (
    <div className="view" id="view-autoseo">
      <style dangerouslySetInnerHTML={{ __html: SPIN_CSS }} />
      <div
        className="view-header ig-panel-hero"
        style={{
          background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
          borderBottom: "1px solid rgba(0,229,255,.2)",
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span> <span className="bc-sep">›</span> AutoSEO Pro
              </div>
              <h2 className="view-title">🚀 AutoSEO Pro</h2>
              <p className="view-sub">
                AI-powered SEO on autopilot — articles, backlinks, keyword research &amp; WordPress publishing
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {wpConnected ? (
                <div
                  onClick={openWpModal}
                  style={{
                    padding: "6px 12px",
                    background: "rgba(0,102,255,.15)",
                    border: "1px solid rgba(0,102,255,.35)",
                    borderRadius: 8,
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "#93C5FD",
                    cursor: "pointer",
                  }}
                >
                  🟦 WordPress Connected
                </div>
              ) : (
                <button
                  onClick={openWpModal}
                  style={{
                    padding: "9px 18px",
                    background: "rgba(255,255,255,.08)",
                    border: "1px solid rgba(255,255,255,.15)",
                    borderRadius: 9,
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  🟦 Connect WordPress
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24 }}>
        {/* Domain setup banner */}
        {needsSetup && (
          <div
            style={{
              background: "linear-gradient(135deg,#EFF6FF,#F5F3FF)",
              border: "1.5px solid #C7D2FE",
              borderRadius: 14,
              padding: "18px 22px",
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: "1.6rem" }}>🌐</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: "0.88rem", fontWeight: 800, color: "#3730A3", marginBottom: 2 }}>
                Enter your website to get started
              </div>
              <div style={{ fontSize: "0.75rem", color: "#6B7280" }}>
                AutoSEO Pro works best after running a full analysis, but you can start here with just your domain.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
              <input
                placeholder="yourdomain.com"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveAutoSeoDomain()}
                style={{
                  padding: "9px 14px",
                  border: "1.5px solid #C7D2FE",
                  borderRadius: 9,
                  fontSize: "0.82rem",
                  width: 200,
                  outline: "none",
                  background: "white",
                }}
              />
              <input
                placeholder="Industry (e.g. Fintech)"
                value={industryInput}
                onChange={(e) => setIndustryInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveAutoSeoDomain()}
                style={{
                  padding: "9px 14px",
                  border: "1.5px solid #C7D2FE",
                  borderRadius: 9,
                  fontSize: "0.82rem",
                  width: 160,
                  outline: "none",
                  background: "white",
                }}
              />
              <button
                onClick={saveAutoSeoDomain}
                style={{
                  padding: "9px 18px",
                  background: "linear-gradient(135deg,#4F46E5,#6D28D9)",
                  border: "none",
                  borderRadius: 9,
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Set Domain →
              </button>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
          {stats.map((s) => (
            <div
              key={s.label}
              style={{
                background: "white",
                borderRadius: 14,
                border: "1.5px solid #E5E7EB",
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: s.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.3rem",
                  flexShrink: 0,
                }}
              >
                {s.icon}
              </div>
              <div>
                <div style={{ fontSize: "1.1rem", fontWeight: 800, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 600 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "9px 18px",
                borderRadius: 10,
                fontSize: "0.8rem",
                fontWeight: 700,
                cursor: "pointer",
                border: "1.5px solid " + (tab === t.id ? "#0066FF" : "#E5E7EB"),
                background: tab === t.id ? "#0066FF" : "white",
                color: tab === t.id ? "white" : "#374151",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab body */}
        <div style={{ paddingBottom: 56 }}>
          {tab === "calendar" && renderCalendarTab()}
          {tab === "backlinks" && renderBacklinksTab()}
          {tab === "outreach" && renderOutreachTab()}
          {tab === "keywords" && renderKeywordsTab()}
          {tab === "traffic" && renderTrafficTab()}
          {tab === "settings" && renderSettingsTab()}
        </div>
      </div>

      {calOpen && renderCalendarModal()}
      {editIdx !== null && renderEditPopup()}
      {previewIdx !== null && renderPreviewModal()}
    </div>
  );

  // ─── TAB 1: Content Calendar ──────────────────────────────────────────────
  function renderCalendarTab() {
    return (
      <div style={{ background: "white", borderRadius: 16, border: "1.5px solid #E5E7EB", overflow: "hidden" }}>
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1.5px solid #F3F4F6",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 800, color: "#111827" }}>📅 Monthly Content Calendar</div>
            <div style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: 2 }}>
              {schedule.count} SEO-optimised articles for <strong>{domain}</strong> in the <strong>{industry}</strong> niche
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {articles && (
              <button
                onClick={addAllGeneratedToSocialCalendar}
                style={{
                  padding: "9px 14px",
                  background: "linear-gradient(135deg,#7C3AED,#5B21B6)",
                  border: "none",
                  borderRadius: 9,
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  color: "white",
                  cursor: "pointer",
                }}
              >
                📲 Add All to Social
              </button>
            )}
            {articles && (
              <button
                onClick={publishAllToWordPress}
                disabled={!wpConnected}
                title={!wpConnected ? "Connect WordPress first" : undefined}
                style={{
                  padding: "9px 14px",
                  background: wpConnected ? "linear-gradient(135deg,#2563EB,#1D4ED8)" : "#E5E7EB",
                  border: "none",
                  borderRadius: 9,
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  color: wpConnected ? "white" : "#9CA3AF",
                  cursor: wpConnected ? "pointer" : "not-allowed",
                }}
              >
                🟦 Publish All to WP
              </button>
            )}
            <button
              onClick={generateArticleTopics}
              disabled={genLoading}
              style={{
                padding: "9px 18px",
                background: "linear-gradient(135deg,#0f766e,#0284c7)",
                border: "none",
                borderRadius: 9,
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "white",
                cursor: genLoading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>{genLoading ? "⏳" : "✨"}</span>{" "}
              <span>
                {genLoading
                  ? "Generating…"
                  : articles
                    ? "Regenerate Topics"
                    : "Generate " + schedule.count + " Article Topics"}
              </span>
              {genLoading && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    opacity: 0.85,
                    marginLeft: 2,
                    background: "rgba(0,0,0,0.2)",
                    padding: "1px 6px",
                    borderRadius: 5,
                  }}
                >
                  {genTimer < 60 ? genTimer + "s" : Math.floor(genTimer / 60) + "m " + (genTimer % 60) + "s"}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Date range */}
        <div
          style={{
            padding: "14px 24px",
            background: "#F9FAFB",
            borderBottom: "1.5px solid #F3F4F6",
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#374151", whiteSpace: "nowrap" }}>
            📆 Publishing Schedule:
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.72rem", fontWeight: 600, color: "#6B7280" }}>
              Start Date
              <input
                type="date"
                value={schedule.startDate}
                onChange={(e) => setSchedule((s) => ({ ...s, startDate: e.target.value }))}
                style={{
                  display: "block",
                  marginTop: 3,
                  padding: "6px 10px",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 7,
                  fontSize: "0.78rem",
                  outline: "none",
                  background: "white",
                }}
              />
            </label>
            <span style={{ fontSize: "0.9rem", color: "#9CA3AF", marginTop: 16 }}>→</span>
            <label style={{ fontSize: "0.72rem", fontWeight: 600, color: "#6B7280" }}>
              End Date
              <input
                type="date"
                value={schedule.endDate}
                onChange={(e) => setSchedule((s) => ({ ...s, endDate: e.target.value }))}
                style={{
                  display: "block",
                  marginTop: 3,
                  padding: "6px 10px",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 7,
                  fontSize: "0.78rem",
                  outline: "none",
                  background: "white",
                }}
              />
            </label>
          </div>
          {articles && (
            <>
              <span style={{ fontSize: "0.72rem", color: "#6B7280", marginLeft: 4 }}>
                Articles auto-spread across date range · 1 article every {artInterval(schedule, articles.length)} day(s)
              </span>
              <button
                onClick={() => {
                  if (!articles.length) {
                    toast("Generate article topics first");
                    return;
                  }
                  setCalOpen(true);
                }}
                style={{
                  marginLeft: 10,
                  padding: "5px 12px",
                  background: "linear-gradient(135deg,#6D28D9,#5B21B6)",
                  border: "none",
                  borderRadius: 8,
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  color: "white",
                  cursor: "pointer",
                }}
              >
                📅 Calendar View
              </button>
            </>
          )}
        </div>

        <div style={{ padding: "20px 24px" }}>
          {articles ? renderArticleGrid(articles) : renderCalendarEmpty()}
        </div>
      </div>
    );
  }

  function renderCalendarEmpty() {
    return (
      <div style={{ textAlign: "center", padding: "50px 20px" }}>
        <div style={{ fontSize: "3rem", marginBottom: 12 }}>📄</div>
        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#111827", marginBottom: 8 }}>
          Generate Your {schedule.count}-Article Content Plan
        </div>
        <div style={{ fontSize: "0.82rem", color: "#6B7280", maxWidth: 400, margin: "0 auto 24px" }}>
          InfoGenie will create a complete monthly content calendar with SEO-optimised article topics, target keywords,
          and publishing schedule tailored to your niche.
        </div>
        <button
          onClick={generateArticleTopics}
          style={{
            padding: "12px 28px",
            background: "linear-gradient(135deg,#0f766e,#0284c7)",
            border: "none",
            borderRadius: 10,
            fontSize: "0.88rem",
            fontWeight: 700,
            color: "white",
            cursor: "pointer",
          }}
        >
          ✨ Generate Article Topics
        </button>
      </div>
    );
  }

  function renderArticleGrid(arts: Article[]) {
    const perWeek = Math.ceil(arts.length / 4);
    const weeks: { art: Article; idx: number }[][] = [[], [], [], []];
    arts.forEach((a, i) => weeks[Math.floor(i / perWeek)].push({ art: a, idx: i }));
    const socialPosts = getSocialPosts();

    return weeks
      .filter((w) => w.length)
      .map((week, wi) => {
        const firstInWeek = wi * perWeek;
        const lastInWeek = Math.min(arts.length - 1, (wi + 1) * perWeek - 1);
        return (
          <div key={wi} style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 800,
                  color: "#6B7280",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                }}
              >
                Week {wi + 1}
              </span>
              <span style={{ fontSize: "0.68rem", color: "#9CA3AF", fontWeight: 600 }}>
                {fmtDate(artDate(firstInWeek, schedule, arts))} — {fmtDate(artDate(lastInWeek, schedule, arts))}
              </span>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {week.map(({ art: a, idx }) => {
                const pubDate = artDate(idx, schedule, arts);
                const alreadyInSocial = socialPosts.some((p) => p.sourceArticleIdx === idx);
                return (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: "14px 16px",
                      border: "1.5px solid #E5E7EB",
                      borderRadius: 12,
                      background: "#FAFAFA",
                    }}
                  >
                    <div
                      style={{
                        flexShrink: 0,
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background:
                          a.status === "published" ? "#059669" : a.status === "generated" ? "#0066FF" : "#E5E7EB",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.65rem",
                        fontWeight: 800,
                        color: a.status === "published" || a.status === "generated" ? "white" : "#6B7280",
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "0.85rem",
                          fontWeight: 700,
                          color: "#111827",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {a.title}
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
                        <span
                          style={{
                            fontSize: "0.66rem",
                            padding: "2px 7px",
                            background: "#EFF6FF",
                            borderRadius: 4,
                            color: "#1D4ED8",
                            fontWeight: 600,
                          }}
                        >
                          {a.keyword}
                        </span>
                        <span
                          style={{
                            fontSize: "0.66rem",
                            padding: "2px 7px",
                            background: "#F5F3FF",
                            borderRadius: 4,
                            color: "#6D28D9",
                            fontWeight: 600,
                          }}
                        >
                          {a.intent || "Informational"}
                        </span>
                        <span
                          style={{
                            fontSize: "0.66rem",
                            padding: "2px 7px",
                            background:
                              a.status === "published" ? "#DCFCE7" : a.status === "generated" ? "#DBEAFE" : "#F3F4F6",
                            borderRadius: 4,
                            color:
                              a.status === "published" ? "#059669" : a.status === "generated" ? "#1D4ED8" : "#6B7280",
                            fontWeight: 700,
                          }}
                        >
                          {a.status === "published" ? "✓ Published" : a.status === "generated" ? "✓ Written" : "Pending"}
                        </span>
                        <span
                          style={{
                            fontSize: "0.66rem",
                            padding: "2px 7px",
                            background: "#FFF7ED",
                            borderRadius: 4,
                            color: "#C2410C",
                            fontWeight: 600,
                          }}
                        >
                          📅 {fmtDate(pubDate)}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 5, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {a.status === "generating" ? (
                        <button
                          disabled
                          style={{
                            padding: "5px 10px",
                            background: "linear-gradient(135deg,#0066FF,#0052CC)",
                            border: "none",
                            borderRadius: 7,
                            fontSize: "0.67rem",
                            fontWeight: 700,
                            color: "white",
                            cursor: "not-allowed",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            opacity: 0.9,
                          }}
                        >
                          <span
                            style={{
                              width: 11,
                              height: 11,
                              border: "2px solid rgba(255,255,255,.3)",
                              borderTopColor: "white",
                              borderRadius: "50%",
                              animation: "spin .7s linear infinite",
                              display: "inline-block",
                              flexShrink: 0,
                            }}
                          />
                          Writing…
                        </button>
                      ) : a.status !== "generated" && a.status !== "published" ? (
                        <button
                          onClick={() => generateSingleArticle(idx)}
                          style={{
                            padding: "5px 10px",
                            background: "linear-gradient(135deg,#0066FF,#0052CC)",
                            border: "none",
                            borderRadius: 7,
                            fontSize: "0.67rem",
                            fontWeight: 700,
                            color: "white",
                            cursor: "pointer",
                          }}
                        >
                          ✍️ Write
                        </button>
                      ) : null}
                      {a.generatedHtml && (
                        <button
                          onClick={() => setPreviewIdx(idx)}
                          style={{
                            padding: "5px 10px",
                            background: "white",
                            border: "1px solid #E5E7EB",
                            borderRadius: 7,
                            fontSize: "0.67rem",
                            fontWeight: 700,
                            color: "#374151",
                            cursor: "pointer",
                          }}
                        >
                          👁 Preview
                        </button>
                      )}
                      {a.generatedHtml && (
                        <button
                          onClick={() => addArticleToSocialCalendar(idx)}
                          style={{
                            padding: "5px 10px",
                            background: alreadyInSocial ? "#F0FDF4" : "linear-gradient(135deg,#7C3AED,#5B21B6)",
                            border: alreadyInSocial ? "1px solid #BBF7D0" : "none",
                            borderRadius: 7,
                            fontSize: "0.67rem",
                            fontWeight: 700,
                            color: alreadyInSocial ? "#059669" : "white",
                            cursor: "pointer",
                          }}
                        >
                          {alreadyInSocial ? "✓ In Social" : "📲 Social"}
                        </button>
                      )}
                      {a.status === "generated" && wpConnected && (
                        <button
                          onClick={() => publishSingleArticle(idx)}
                          style={{
                            padding: "5px 10px",
                            background: "linear-gradient(135deg,#0f766e,#0284c7)",
                            border: "none",
                            borderRadius: 7,
                            fontSize: "0.67rem",
                            fontWeight: 700,
                            color: "white",
                            cursor: "pointer",
                          }}
                        >
                          🟦 Publish
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      });
  }

  // ─── TAB 2: Backlinks ─────────────────────────────────────────────────────
  function renderBacklinksTab() {
    const opps = backlinks;
    return (
      <div style={{ background: "white", borderRadius: 16, border: "1.5px solid #E5E7EB", overflow: "hidden" }}>
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1.5px solid #F3F4F6",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 800, color: "#111827" }}>
              🔗 High-Authority Backlink Opportunities
            </div>
            <div style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: 2 }}>
              AI-identified link prospects tailored to <strong>{domain}</strong>
            </div>
          </div>
          <button
            onClick={loadBacklinkOpps}
            disabled={blLoading}
            style={{
              padding: "9px 18px",
              background: "linear-gradient(135deg,#0066FF,#0052CC)",
              border: "none",
              borderRadius: 9,
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "white",
              cursor: blLoading ? "not-allowed" : "pointer",
            }}
          >
            {blLoading ? "⏳ Analysing…" : opps ? "🔍 Refresh Opportunities" : "🔍 Find Backlink Targets"}
          </button>
        </div>
        <div style={{ padding: "20px 24px" }}>
          {backlinksUnavailable ? (
            <div
              style={{
                padding: 18,
                background: "#FFFBEB",
                border: "1px solid #FCD34D",
                borderRadius: 10,
                fontSize: "0.8rem",
                color: "#92400E",
              }}
            >
              Backlink opportunities are AI-generated suggestions, not verified live link data. Demo Data Mode is off, so
              estimated results are hidden. An administrator can enable Demo Data Mode for this client in the Admin
              portal.
            </div>
          ) : opps ? (
            renderBacklinkTable(opps)
          ) : (
            <div style={{ textAlign: "center", padding: "50px 20px" }}>
              <div style={{ fontSize: "3rem", marginBottom: 12 }}>🔗</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#111827", marginBottom: 8 }}>
                Discover 5+ High-Authority Backlink Targets
              </div>
              <div style={{ fontSize: "0.82rem", color: "#6B7280", maxWidth: 420, margin: "0 auto 24px" }}>
                Our AI analyses your niche and competitors to surface the best link-building opportunities — guest posts,
                resource pages, HARO, directories and more.
              </div>
              <button
                onClick={loadBacklinkOpps}
                style={{
                  padding: "12px 28px",
                  background: "linear-gradient(135deg,#0066FF,#0052CC)",
                  border: "none",
                  borderRadius: 10,
                  fontSize: "0.88rem",
                  fontWeight: 700,
                  color: "white",
                  cursor: "pointer",
                }}
              >
                🔍 Find Backlink Targets
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderBacklinkTable(opps: BacklinkOpp[]) {
    const diffColor: Record<string, string> = { Easy: "#059669", Medium: "#D97706", Hard: "#DC2626" };
    const diffBg: Record<string, string> = { Easy: "#F0FDF4", Medium: "#FFFBEB", Hard: "#FFF1F2" };
    return (
      <>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                {["Site", "DR", "Type", "Outreach Angle", "Difficulty", "Action"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 14px",
                      textAlign: "left",
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      textTransform: "uppercase",
                      borderBottom: "1.5px solid #E5E7EB",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {opps.map((o, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #F3F4F6", background: i % 2 === 0 ? undefined : "#FAFAFA" }}>
                  <td style={{ padding: "12px 14px", fontWeight: 700, color: "#111827" }}>
                    {o.site}
                    <br />
                    <a
                      href={o.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: "0.65rem", color: "#0066FF", fontWeight: 500, textDecoration: "none" }}
                    >
                      {o.url}
                    </a>
                  </td>
                  <td style={{ padding: "12px 14px", textAlign: "center" }}>
                    <span style={{ fontWeight: 800, color: "#0066FF" }}>{o.dr}</span>
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    <span
                      style={{
                        padding: "3px 8px",
                        background: "#EFF6FF",
                        borderRadius: 5,
                        fontSize: "0.66rem",
                        fontWeight: 700,
                        color: "#0066FF",
                      }}
                    >
                      {o.type}
                    </span>
                  </td>
                  <td style={{ padding: "12px 14px", color: "#374151", maxWidth: 260 }}>{o.angle}</td>
                  <td style={{ padding: "12px 14px", textAlign: "center" }}>
                    <span
                      style={{
                        padding: "3px 9px",
                        borderRadius: 5,
                        fontSize: "0.66rem",
                        fontWeight: 700,
                        background: diffBg[o.difficulty] || "#F3F4F6",
                        color: diffColor[o.difficulty] || "#374151",
                      }}
                    >
                      {o.difficulty}
                    </span>
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    <button
                      onClick={() => copyOutreachEmail(i)}
                      title="Copy outreach email template"
                      style={{
                        padding: "5px 10px",
                        background: "white",
                        border: "1px solid #E5E7EB",
                        borderRadius: 7,
                        fontSize: "0.67rem",
                        fontWeight: 700,
                        color: "#374151",
                        cursor: "pointer",
                      }}
                    >
                      📧 Copy Pitch
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          style={{
            marginTop: 16,
            padding: "14px 16px",
            background: "#F0FDF4",
            borderRadius: 10,
            border: "1px solid #BBF7D0",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>💡</span>
          <div style={{ fontSize: "0.75rem", color: "#065F46", fontWeight: 600 }}>
            Pro Tip: Start with <strong>Easy</strong> targets — even 3-4 quality links from DR 60+ sites can lift your
            domain authority significantly within 90 days.
          </div>
        </div>
      </>
    );
  }

  // ─── TAB 3: Outreach Sequencer ────────────────────────────────────────────
  function renderOutreachTab() {
    const opps = backlinks;
    if (!opps || !opps.length) {
      return (
        <div style={{ background: "white", borderRadius: 16, border: "1.5px solid #E5E7EB", padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: 14 }}>📬</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#111827", marginBottom: 8 }}>
            No Backlink Targets Yet
          </div>
          <div style={{ fontSize: "0.82rem", color: "#6B7280", maxWidth: 380, margin: "0 auto 20px" }}>
            Find backlink targets first — then the Outreach Sequencer will auto-generate personalised 3-email sequences
            for each one.
          </div>
          <button
            onClick={() => setTab("backlinks")}
            style={{
              padding: "11px 24px",
              background: "linear-gradient(135deg,#0066FF,#0052CC)",
              border: "none",
              borderRadius: 10,
              fontSize: "0.82rem",
              fontWeight: 700,
              color: "white",
              cursor: "pointer",
            }}
          >
            🔍 Find Backlink Targets First
          </button>
        </div>
      );
    }

    const statuses: Record<string, string> = {
      not_started: "Not Started",
      email1_sent: "Email 1 Sent",
      followup_sent: "Follow-up Sent",
      final_sent: "Final Sent",
      responded: "Responded ✉️",
      secured: "🔗 Link Secured",
    };
    const statusColors: Record<string, string> = {
      not_started: "#6B7280",
      email1_sent: "#0066FF",
      followup_sent: "#7C3AED",
      final_sent: "#D97706",
      responded: "#059669",
      secured: "#059669",
    };
    const statusBg: Record<string, string> = {
      not_started: "#F3F4F6",
      email1_sent: "#EFF6FF",
      followup_sent: "#F5F3FF",
      final_sent: "#FFFBEB",
      responded: "#DCFCE7",
      secured: "#F0FDF4",
    };

    const secured = Object.values(outreach).filter((o) => o.status === "secured").length;
    const active = Object.values(outreach).filter((o) => o.status !== "not_started" && o.status !== "secured").length;
    const total = opps.length;

    return (
      <div style={{ background: "white", borderRadius: 16, border: "1.5px solid #E5E7EB", overflow: "hidden" }}>
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1.5px solid #F3F4F6",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 800, color: "#111827" }}>📬 Backlink Outreach Sequencer</div>
            <div style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: 2 }}>
              AI-written 3-email sequences — copy, send, track, get links
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ textAlign: "center", padding: "8px 16px", background: "#F0FDF4", borderRadius: 10 }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#059669" }}>{secured}</div>
              <div style={{ fontSize: "0.65rem", color: "#6B7280", fontWeight: 600 }}>Links Secured</div>
            </div>
            <div style={{ textAlign: "center", padding: "8px 16px", background: "#EFF6FF", borderRadius: 10 }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#0066FF" }}>{active}</div>
              <div style={{ fontSize: "0.65rem", color: "#6B7280", fontWeight: 600 }}>Active Outreach</div>
            </div>
            <div style={{ textAlign: "center", padding: "8px 16px", background: "#F3F4F6", borderRadius: 10 }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#374151" }}>{total}</div>
              <div style={{ fontSize: "0.65rem", color: "#6B7280", fontWeight: 600 }}>Total Targets</div>
            </div>
          </div>
        </div>
        <div
          style={{
            padding: "12px 24px",
            background: "#F9FAFB",
            borderBottom: "1px solid #F3F4F6",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#374151" }}>Sender Name:</span>
          <input
            placeholder={`e.g. Sarah from ${domain}`}
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            style={{
              padding: "7px 12px",
              border: "1.5px solid #E5E7EB",
              borderRadius: 8,
              fontSize: "0.8rem",
              width: 220,
              outline: "none",
              background: "white",
            }}
          />
          <span style={{ fontSize: "0.72rem", color: "#9CA3AF" }}>Used in personalised email signatures</span>
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          {opps.map((opp, i) => {
            const or = outreach[i] || { status: "not_started", emails: null };
            const statusKey = or.status || "not_started";
            const isOpen = !!openOutreach[i];
            return (
              <div
                key={i}
                style={{
                  border: "1.5px solid " + (statusKey === "secured" ? "#BBF7D0" : "#E5E7EB"),
                  borderRadius: 14,
                  overflow: "hidden",
                  background: statusKey === "secured" ? "#F0FDF4" : "white",
                }}
              >
                <div
                  style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
                  onClick={() => setOpenOutreach((prev) => ({ ...prev, [i]: !prev[i] }))}
                >
                  <div
                    style={{
                      flexShrink: 0,
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: "#F3F4F6",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.72rem",
                      fontWeight: 800,
                      color: "#374151",
                      textAlign: "center",
                      lineHeight: 1.1,
                    }}
                  >
                    DR
                    <br />
                    {opp.dr}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.88rem", fontWeight: 800, color: "#111827" }}>{opp.site}</div>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
                      {opp.type} · {opp.url}
                    </div>
                  </div>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      background: statusBg[statusKey],
                      color: statusColors[statusKey],
                    }}
                  >
                    {statuses[statusKey]}
                  </span>
                  <select
                    value={statusKey}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      setOutreachStatus(i, e.target.value);
                    }}
                    style={{
                      padding: "5px 8px",
                      border: "1px solid #E5E7EB",
                      borderRadius: 7,
                      fontSize: "0.68rem",
                      background: "white",
                      cursor: "pointer",
                    }}
                  >
                    {Object.entries(statuses).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  {!or.emails ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        generateOutreachSequence(i);
                      }}
                      disabled={seqLoading === i}
                      style={{
                        padding: "6px 14px",
                        background: "linear-gradient(135deg,#0066FF,#0052CC)",
                        border: "none",
                        borderRadius: 8,
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: "white",
                        cursor: seqLoading === i ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {seqLoading === i ? "⏳ Writing…" : "✍️ Generate Sequence"}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenOutreach((prev) => ({ ...prev, [i]: !prev[i] }));
                      }}
                      style={{
                        padding: "6px 14px",
                        background: "white",
                        border: "1px solid #E5E7EB",
                        borderRadius: 8,
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: "#374151",
                        cursor: "pointer",
                      }}
                    >
                      View Emails ▾
                    </button>
                  )}
                </div>
                {or.emails && isOpen && (
                  <div style={{ borderTop: "1px solid #F3F4F6", padding: "16px 18px", background: "#F9FAFB" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {or.emails.map((e, ei) => (
                        <div
                          key={ei}
                          style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 16px" }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: 10,
                            }}
                          >
                            <div>
                              <span
                                style={{
                                  fontSize: "0.7rem",
                                  fontWeight: 800,
                                  color: "#0066FF",
                                  background: "#EFF6FF",
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                }}
                              >
                                {ei === 0 ? "Email 1 — Day 0" : ei === 1 ? "Email 2 — Day 5 Follow-up" : "Email 3 — Day 10 Final"}
                              </span>
                              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#111827", marginLeft: 8 }}>
                                {e.subject}
                              </span>
                            </div>
                            <button
                              onClick={() => copyOutreachEmailText(i, ei)}
                              style={{
                                padding: "4px 10px",
                                background: "white",
                                border: "1px solid #E5E7EB",
                                borderRadius: 7,
                                fontSize: "0.67rem",
                                fontWeight: 700,
                                color: "#374151",
                                cursor: "pointer",
                              }}
                            >
                              📋 Copy
                            </button>
                          </div>
                          <div
                            style={{
                              fontSize: "0.78rem",
                              color: "#374151",
                              lineHeight: 1.6,
                              whiteSpace: "pre-wrap",
                              background: "#F9FAFB",
                              padding: "10px 12px",
                              borderRadius: 8,
                            }}
                          >
                            {e.body}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── TAB 4: Keyword Research ──────────────────────────────────────────────
  function renderKeywordsTab() {
    const kws = keywords;
    return (
      <div style={{ background: "white", borderRadius: 16, border: "1.5px solid #E5E7EB", overflow: "hidden" }}>
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1.5px solid #F3F4F6",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 800, color: "#111827" }}>🔍 Advanced Keyword Research</div>
            <div style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: 2 }}>
              High-value, low-competition opportunities for <strong>{domain}</strong>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              placeholder="Seed keyword (optional)"
              value={kwSeed}
              onChange={(e) => setKwSeed(e.target.value)}
              style={{
                padding: "8px 12px",
                border: "1.5px solid #E5E7EB",
                borderRadius: 8,
                fontSize: "0.78rem",
                width: 180,
                outline: "none",
              }}
            />
            <button
              onClick={loadKeywordResearch}
              disabled={kwLoading}
              style={{
                padding: "9px 18px",
                background: "linear-gradient(135deg,#7C3AED,#5B21B6)",
                border: "none",
                borderRadius: 9,
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "white",
                cursor: kwLoading ? "not-allowed" : "pointer",
              }}
            >
              {kwLoading ? "⏳ Researching…" : kws ? "🔍 Refresh" : "🔍 Research Keywords"}
            </button>
          </div>
        </div>
        <div style={{ padding: "20px 24px" }}>
          {kws ? (
            renderKeywordTable(kws)
          ) : (
            <div style={{ textAlign: "center", padding: "50px 20px" }}>
              <div style={{ fontSize: "3rem", marginBottom: 12 }}>🔍</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#111827", marginBottom: 8 }}>
                Uncover Winning Keywords
              </div>
              <div style={{ fontSize: "0.82rem", color: "#6B7280", maxWidth: 420, margin: "0 auto 24px" }}>
                AI-powered research surfaces high-volume, low-difficulty keywords your competitors haven&apos;t fully
                captured — perfect for quick wins.
              </div>
              <button
                onClick={loadKeywordResearch}
                style={{
                  padding: "12px 28px",
                  background: "linear-gradient(135deg,#7C3AED,#5B21B6)",
                  border: "none",
                  borderRadius: 10,
                  fontSize: "0.88rem",
                  fontWeight: 700,
                  color: "white",
                  cursor: "pointer",
                }}
              >
                🔍 Start Keyword Research
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderKeywordTable(kws: Keyword[]) {
    const intentColor: Record<string, string> = {
      Informational: "#0066FF",
      Commercial: "#7C3AED",
      Transactional: "#059669",
      Navigational: "#D97706",
    };
    const intentBg: Record<string, string> = {
      Informational: "#EFF6FF",
      Commercial: "#F5F3FF",
      Transactional: "#F0FDF4",
      Navigational: "#FFFBEB",
    };
    const sorted = [...kws].sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0));
    return (
      <>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                {["Keyword", "Monthly Volume", "Difficulty", "CPC", "Intent", "Opp. Score", "Content Angle"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 12px",
                      textAlign: "left",
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      textTransform: "uppercase",
                      borderBottom: "1.5px solid #E5E7EB",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((k, i) => {
                const diff = k.difficulty || 0;
                const diffColor = diff < 30 ? "#059669" : diff < 60 ? "#D97706" : "#DC2626";
                const oppScore = k.opportunity_score || 0;
                const oppColor = oppScore >= 8 ? "#059669" : oppScore >= 5 ? "#D97706" : "#6B7280";
                return (
                  <tr key={i} style={{ borderBottom: "1px solid #F3F4F6", background: i % 2 === 0 ? undefined : "#FAFAFA" }}>
                    <td style={{ padding: "11px 12px", fontWeight: 700, color: "#111827" }}>{k.keyword}</td>
                    <td style={{ padding: "11px 12px", textAlign: "center", fontWeight: 700, color: "#0066FF" }}>
                      {(k.monthly_volume || 0).toLocaleString()}
                    </td>
                    <td style={{ padding: "11px 12px", textAlign: "center" }}>
                      <span style={{ fontWeight: 800, color: diffColor }}>{k.difficulty}</span>
                    </td>
                    <td style={{ padding: "11px 12px", textAlign: "center", color: "#374151" }}>
                      ${parseFloat(String(k.cpc || 0)).toFixed(2)}
                    </td>
                    <td style={{ padding: "11px 12px" }}>
                      <span
                        style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          fontSize: "0.65rem",
                          fontWeight: 700,
                          background: intentBg[k.intent || ""] || "#F3F4F6",
                          color: intentColor[k.intent || ""] || "#374151",
                        }}
                      >
                        {k.intent || "—"}
                      </span>
                    </td>
                    <td style={{ padding: "11px 12px", textAlign: "center" }}>
                      <span style={{ fontWeight: 800, color: oppColor }}>{k.opportunity_score}/10</span>
                    </td>
                    <td style={{ padding: "11px 12px", color: "#374151", maxWidth: 200, fontSize: "0.72rem" }}>
                      {k.content_angle || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={addKeywordsToCalendar}
            style={{
              padding: "8px 16px",
              background: "linear-gradient(135deg,#0f766e,#0284c7)",
              border: "none",
              borderRadius: 8,
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "white",
              cursor: "pointer",
            }}
          >
            📅 Add Top Keywords to Calendar
          </button>
          <button
            onClick={copyKeywordsCSV}
            style={{
              padding: "8px 16px",
              background: "white",
              border: "1.5px solid #E5E7EB",
              borderRadius: 8,
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#374151",
              cursor: "pointer",
            }}
          >
            📋 Copy as CSV
          </button>
        </div>
      </>
    );
  }

  // ─── TAB 5: Traffic Intel ─────────────────────────────────────────────────
  function renderTrafficTab() {
    const td = traffic;
    const articlesCount = (articles || []).length;
    const backlinksCount = Object.values(outreach).filter((o) => o.status === "secured").length;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            background: "var(--ig-grad)",
            borderRadius: 16,
            padding: "22px 26px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 14,
          }}
        >
          <div>
            <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "white", marginBottom: 4 }}>
              📈 90-Day Traffic Intelligence
            </div>
            <div style={{ fontSize: "0.78rem", color: "#93C5FD" }}>
              AI-powered organic growth projections for <strong>{domain}</strong>
            </div>
          </div>
          <button
            onClick={loadTrafficProjection}
            disabled={trafficLoading}
            style={{
              padding: "10px 22px",
              background: "linear-gradient(135deg,#00E5FF,#0066FF)",
              border: "none",
              borderRadius: 10,
              fontSize: "0.82rem",
              fontWeight: 700,
              color: "white",
              cursor: trafficLoading ? "not-allowed" : "pointer",
            }}
          >
            {trafficLoading ? "⏳ Analysing…" : td ? "🔄 Refresh Projection" : "📈 Generate Projection"}
          </button>
        </div>

        {!td ? (
          <div style={{ background: "white", borderRadius: 16, border: "1.5px solid #E5E7EB", padding: 50, textAlign: "center" }}>
            <div style={{ fontSize: "3.5rem", marginBottom: 14 }}>📊</div>
            <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#111827", marginBottom: 8 }}>
              Your Traffic Growth Forecast
            </div>
            <div style={{ fontSize: "0.82rem", color: "#6B7280", maxWidth: 440, margin: "0 auto 10px" }}>
              Based on your content calendar ({articlesCount} articles) and backlinks ({backlinksCount} secured),
              InfoGenie projects your organic traffic growth over the next 90 days.
            </div>
            <div style={{ fontSize: "0.78rem", color: "#9CA3AF", marginBottom: 24 }}>
              More articles written + more links secured = higher projections
            </div>
            <button
              onClick={loadTrafficProjection}
              style={{
                padding: "12px 28px",
                background: "linear-gradient(135deg,#0066FF,#0052CC)",
                border: "none",
                borderRadius: 10,
                fontSize: "0.88rem",
                fontWeight: 700,
                color: "white",
                cursor: "pointer",
              }}
            >
              📈 Generate My Traffic Forecast
            </button>
          </div>
        ) : (
          renderTrafficDashboard(td, articlesCount, backlinksCount)
        )}

        {/* GSC connection */}
        <div style={{ background: "white", borderRadius: 16, border: "1.5px solid #E5E7EB", padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: "#FEF2F2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.2rem",
              }}
            >
              🔍
            </div>
            <div>
              <div style={{ fontSize: "0.9rem", fontWeight: 800, color: "#111827" }}>Connect Google Search Console</div>
              <div style={{ fontSize: "0.72rem", color: "#6B7280" }}>
                Import real impressions, clicks &amp; keyword rankings for live data
              </div>
            </div>
            <span
              style={{
                marginLeft: "auto",
                padding: "4px 10px",
                background: "#FEF3C7",
                borderRadius: 6,
                fontSize: "0.67rem",
                fontWeight: 700,
                color: "#D97706",
              }}
            >
              Coming Soon
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {[
              { icon: "📊", t: "Real Impressions", d: "Live data from Google instead of projections" },
              { icon: "🎯", t: "Actual Rankings", d: "See exactly where you rank for each keyword" },
              { icon: "📈", t: "Click-Through Rate", d: "Track how many searchers actually visit your site" },
            ].map((f) => (
              <div key={f.t} style={{ padding: 12, background: "#F9FAFB", borderRadius: 10, border: "1px solid #E5E7EB" }}>
                <div style={{ fontSize: "1.2rem", marginBottom: 6 }}>{f.icon}</div>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#111827", marginBottom: 3 }}>{f.t}</div>
                <div style={{ fontSize: "0.68rem", color: "#6B7280" }}>{f.d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderTrafficDashboard(td: TrafficData, articlesCount: number, backlinksCount: number) {
    const fmt = (n?: number) => (n && n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n || 0));
    const pct = td.growth_pct_90d || 0;
    const bars = [
      { label: "Baseline", val: td.baseline_monthly || 0, color: "#E5E7EB" },
      { label: "Month 1", val: td.projected_monthly_30d || 0, color: "#93C5FD" },
      { label: "Month 2", val: td.projected_monthly_60d || 0, color: "#3B82F6" },
      { label: "Month 3", val: td.projected_monthly_90d || 0, color: "#0066FF" },
    ];
    const maxVal = Math.max(...bars.map((b) => b.val), 1);

    const kpis = [
      { icon: "👥", label: "Baseline Traffic", val: fmt(td.baseline_monthly), sub: "/month", color: "#374151", bg: "#F3F4F6" },
      { icon: "📈", label: "Projected (90d)", val: fmt(td.projected_monthly_90d), sub: "/month", color: "#0066FF", bg: "#EFF6FF" },
      { icon: "🚀", label: "Growth Forecast", val: "+" + pct + "%", sub: "in 90 days", color: "#059669", bg: "#F0FDF4" },
      { icon: "🔗", label: "DA Improvement", val: "+" + (td.da_improvement || "3-5"), sub: "points est.", color: "#7C3AED", bg: "#F5F3FF" },
    ];

    return (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          {kpis.map((s) => (
            <div
              key={s.label}
              style={{
                background: "white",
                borderRadius: 14,
                border: "1.5px solid #E5E7EB",
                padding: "16px 18px",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: s.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.3rem",
                  flexShrink: 0,
                }}
              >
                {s.icon}
              </div>
              <div>
                <div style={{ fontSize: "1.15rem", fontWeight: 800, color: s.color }}>
                  {s.val}
                  <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#9CA3AF", marginLeft: 3 }}>{s.sub}</span>
                </div>
                <div style={{ fontSize: "0.7rem", color: "#6B7280", fontWeight: 600 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: "white", borderRadius: 16, border: "1.5px solid #E5E7EB", padding: "22px 24px" }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 800, color: "#111827", marginBottom: 18 }}>
            📊 90-Day Organic Traffic Projection
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16, height: 160, padding: "0 10px" }}>
            {bars.map((b) => {
              const h = Math.round((b.val / maxVal) * 140);
              return (
                <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151" }}>{fmt(b.val)}</div>
                  <div
                    style={{
                      width: "100%",
                      height: h,
                      background: b.color,
                      borderRadius: "8px 8px 0 0",
                      transition: "height .3s",
                      minHeight: 4,
                    }}
                  />
                  <div style={{ fontSize: "0.67rem", color: "#6B7280", fontWeight: 600, textAlign: "center" }}>{b.label}</div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              marginTop: 16,
              padding: "12px 14px",
              background: "#F0FDF4",
              borderRadius: 10,
              border: "1px solid #BBF7D0",
              fontSize: "0.75rem",
              color: "#065F46",
            }}
          >
            <strong>🤖 AI Insight:</strong> Based on {articlesCount} articles planned and {backlinksCount} backlinks
            secured. {td.top_opportunities?.[0] || "Focus on publishing consistently to compound your SEO gains."}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <div style={{ background: "white", borderRadius: 14, border: "1.5px solid #E5E7EB", padding: "18px 20px" }}>
            <div style={{ fontSize: "0.88rem", fontWeight: 800, color: "#111827", marginBottom: 14 }}>
              🎯 Keyword Ranking Forecast
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(td.keyword_rankings || []).map((k, i) => {
                const imp = (k.current_position || 50) - (k.projected_position_90d || 30);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#F9FAFB", borderRadius: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "0.78rem",
                          fontWeight: 700,
                          color: "#111827",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {k.keyword}
                      </div>
                      <div style={{ fontSize: "0.65rem", color: "#9CA3AF" }}>
                        {(k.monthly_volume || 0).toLocaleString()} searches/mo
                      </div>
                    </div>
                    <div style={{ textAlign: "center", minWidth: 36 }}>
                      <div style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>Now</div>
                      <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#374151" }}>
                        #{k.current_position || "50+"}
                      </div>
                    </div>
                    <div style={{ fontSize: "0.9rem", color: "#9CA3AF" }}>→</div>
                    <div style={{ textAlign: "center", minWidth: 36 }}>
                      <div style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>90d</div>
                      <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#059669" }}>
                        #{k.projected_position_90d || "20"}
                      </div>
                    </div>
                    {imp > 0 && (
                      <span
                        style={{
                          fontSize: "0.65rem",
                          fontWeight: 700,
                          color: "#059669",
                          background: "#DCFCE7",
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        +{imp}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: "white", borderRadius: 14, border: "1.5px solid #E5E7EB", padding: "18px 20px" }}>
            <div style={{ fontSize: "0.88rem", fontWeight: 800, color: "#111827", marginBottom: 14 }}>
              💡 Top Growth Opportunities
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(td.top_opportunities || []).map((opp, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "10px 12px",
                    background: "#F9FAFB",
                    borderRadius: 10,
                    borderLeft: "3px solid " + (["#0066FF", "#7C3AED", "#059669"][i] || "#0066FF"),
                  }}
                >
                  <span style={{ fontSize: "1rem", flexShrink: 0 }}>{["🚀", "🔗", "📝"][i] || "✅"}</span>
                  <div style={{ fontSize: "0.78rem", color: "#374151", lineHeight: 1.5 }}>{opp}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, padding: 12, background: "#FFF7ED", borderRadius: 10, border: "1px solid #FED7AA" }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#92400E", marginBottom: 4 }}>
                📅 Recommended Action Plan
              </div>
              <div style={{ fontSize: "0.7rem", color: "#B45309", lineHeight: 1.5 }}>
                Week 1–2: Publish first 8 articles from your calendar
                <br />
                Week 2–4: Send outreach sequences to top 3 backlink targets
                <br />
                Month 2: Add generated articles to Social Calendar
                <br />
                Month 3: Review rankings, refresh top-performing content
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ─── TAB 6: Automation Settings ───────────────────────────────────────────
  function renderSettingsTab() {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "white", borderRadius: 16, border: "1.5px solid #E5E7EB", padding: "22px 24px" }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#111827", marginBottom: 16 }}>
            ⚡ Publishing Schedule
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#374151" }}>
              Articles per month
              <input
                type="number"
                min={1}
                max={60}
                value={schedule.count}
                onChange={(e) => setSchedule((s) => ({ ...s, count: +e.target.value }))}
                style={{
                  marginTop: 5,
                  display: "block",
                  width: "100%",
                  padding: "8px 12px",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 8,
                  fontSize: "0.82rem",
                  outline: "none",
                }}
              />
            </label>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#374151" }}>
              Target word count
              <select
                value={schedule.wordCount}
                onChange={(e) => setSchedule((s) => ({ ...s, wordCount: +e.target.value }))}
                style={{
                  marginTop: 5,
                  display: "block",
                  width: "100%",
                  padding: "8px 12px",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 8,
                  fontSize: "0.82rem",
                  outline: "none",
                  background: "white",
                }}
              >
                {WORD_COUNTS.map((w) => (
                  <option key={w} value={w}>
                    {w.toLocaleString()} words
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#374151" }}>
              Content tone
              <select
                value={schedule.tone}
                onChange={(e) => setSchedule((s) => ({ ...s, tone: e.target.value }))}
                style={{
                  marginTop: 5,
                  display: "block",
                  width: "100%",
                  padding: "8px 12px",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 8,
                  fontSize: "0.82rem",
                  outline: "none",
                  background: "white",
                }}
              >
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => toast("✅ AutoSEO settings saved!")}
              style={{
                padding: 10,
                background: "linear-gradient(135deg,#0f766e,#0284c7)",
                border: "none",
                borderRadius: 10,
                fontSize: "0.8rem",
                fontWeight: 700,
                color: "white",
                cursor: "pointer",
                marginTop: 4,
              }}
            >
              💾 Save Settings
            </button>
          </div>
        </div>

        <div style={{ background: "white", borderRadius: 16, border: "1.5px solid #E5E7EB", padding: "22px 24px" }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#111827", marginBottom: 6 }}>
            🟦 WordPress Auto-Publishing
          </div>
          <div style={{ fontSize: "0.75rem", color: "#6B7280", marginBottom: 16 }}>
            Articles are published as drafts — you approve &amp; go live from WP Admin
          </div>
          {wpConnected ? (
            <>
              <div style={{ padding: 14, background: "#F0FDF4", border: "1.5px solid #BBF7D0", borderRadius: 10, marginBottom: 14 }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#065F46", marginBottom: 4 }}>
                  ✅ WordPress Connected
                </div>
                <div style={{ fontSize: "0.72rem", color: "#059669" }}>{wpCreds?.siteUrl}</div>
              </div>
              <button
                onClick={openWpModal}
                style={{
                  width: "100%",
                  padding: 10,
                  background: "white",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 10,
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                🔄 Update Credentials
              </button>
            </>
          ) : (
            <>
              <div style={{ padding: 14, background: "#FFF7ED", border: "1.5px solid #FED7AA", borderRadius: 10, marginBottom: 14 }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#92400E", marginBottom: 4 }}>
                  ⚠️ WordPress Not Connected
                </div>
                <div style={{ fontSize: "0.72rem", color: "#B45309" }}>
                  Connect your WordPress site to enable auto-publishing
                </div>
              </div>
              <button
                onClick={openWpModal}
                style={{
                  width: "100%",
                  padding: 10,
                  background: "linear-gradient(135deg,#0066FF,#0052CC)",
                  border: "none",
                  borderRadius: 10,
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: "white",
                  cursor: "pointer",
                }}
              >
                🟦 Connect WordPress
              </button>
            </>
          )}
        </div>

        <div
          style={{
            background: "white",
            borderRadius: 16,
            border: "1.5px solid #E5E7EB",
            padding: "22px 24px",
            gridColumn: "span 2",
          }}
        >
          <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#111827", marginBottom: 16 }}>
            🤖 AutoSEO Automation Status
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            {[
              { icon: "📄", title: "Content Generation", desc: "AI writes articles based on your calendar topics & keywords", status: "Ready", ok: true },
              { icon: "🔍", title: "Keyword Monitoring", desc: "Tracks ranking changes and surfaces new opportunities weekly", status: "Active", ok: true },
              { icon: "🟦", title: "WordPress Publishing", desc: "Publishes generated drafts automatically on schedule", status: wpConnected ? "Connected" : "Setup Required", ok: wpConnected },
            ].map((f) => (
              <div
                key={f.title}
                style={{
                  padding: 16,
                  border: "1.5px solid " + (f.ok ? "#BBF7D0" : "#FED7AA"),
                  borderRadius: 12,
                  background: f.ok ? "#F0FDF4" : "#FFFBEB",
                }}
              >
                <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>{f.icon}</div>
                <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#111827", marginBottom: 4 }}>{f.title}</div>
                <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 10 }}>{f.desc}</div>
                <span
                  style={{
                    padding: "3px 9px",
                    borderRadius: 5,
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    background: f.ok ? "#DCFCE7" : "#FEF3C7",
                    color: f.ok ? "#059669" : "#D97706",
                  }}
                >
                  {f.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── Calendar view modal ──────────────────────────────────────────────────
  function renderCalendarModal() {
    const arts = articles || [];
    const sch = schedule;
    const dateMap: Record<string, { art: Article; idx: number }[]> = {};
    arts.forEach((a, i) => {
      const d = artDate(i, sch, arts);
      if (!dateMap[d]) dateMap[d] = [];
      dateMap[d].push({ art: a, idx: i });
    });
    const start = new Date((sch.startDate || _today) + "T00:00:00");
    const end = new Date((sch.endDate || _nextMonth) + "T00:00:00");
    const months: Date[] = [];
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const lastMonth = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur <= lastMonth) {
      months.push(new Date(cur));
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    const statusColor = (s: string) => (s === "published" ? "#059669" : s === "generated" ? "#1D4ED8" : "#6B7280");
    const statusBg = (s: string) => (s === "published" ? "#DCFCE7" : s === "generated" ? "#DBEAFE" : "#F3F4F6");
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const todayIso = new Date().toISOString().split("T")[0];

    return (
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) setCalOpen(false);
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(0,0,0,.55)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "24px 12px",
          overflowY: "auto",
        }}
      >
        <div style={{ background: "white", borderRadius: 18, width: "100%", maxWidth: 960, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,.25)", margin: "auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "18px 24px",
              background: "linear-gradient(135deg,#4C1D95,#5B21B6)",
              color: "white",
            }}
          >
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>📅 Content Publishing Calendar</div>
              <div style={{ fontSize: "0.75rem", opacity: 0.8, marginTop: 2 }}>
                Articles scheduled from {fmtDate(sch.startDate)} to {fmtDate(sch.endDate)}
              </div>
            </div>
            <button
              onClick={() => setCalOpen(false)}
              style={{
                background: "rgba(255,255,255,.15)",
                border: "none",
                borderRadius: 8,
                color: "white",
                fontSize: "1rem",
                width: 34,
                height: 34,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ padding: 24 }}>
            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                marginBottom: 20,
                padding: "12px 16px",
                background: "#F9FAFB",
                borderRadius: 10,
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151" }}>Legend:</span>
              <span style={{ fontSize: "0.7rem", padding: "2px 8px", background: "#DBEAFE", color: "#1D4ED8", borderRadius: 4, fontWeight: 600 }}>✓ Written</span>
              <span style={{ fontSize: "0.7rem", padding: "2px 8px", background: "#DCFCE7", color: "#059669", borderRadius: 4, fontWeight: 600 }}>✓ Published</span>
              <span style={{ fontSize: "0.7rem", padding: "2px 8px", background: "#F3F4F6", color: "#6B7280", borderRadius: 4, fontWeight: 600 }}>Pending</span>
              <span style={{ fontSize: "0.7rem", padding: "2px 8px", background: "#EFF6FF", color: "#1D4ED8", borderRadius: 4, fontWeight: 600 }}>🔵 Today</span>
              <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "#9CA3AF" }}>
                {arts.length} articles · {Object.keys(dateMap).length} scheduled dates
              </span>
            </div>
            {months.map((monthStart, mi) => {
              const yr = monthStart.getFullYear();
              const mo = monthStart.getMonth();
              const monthName = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });
              const firstDay = monthStart.getDay();
              const daysInMonth = new Date(yr, mo + 1, 0).getDate();
              const cells: (number | null)[] = [];
              for (let p = 0; p < firstDay; p++) cells.push(null);
              for (let d = 1; d <= daysInMonth; d++) cells.push(d);
              while (cells.length % 7 !== 0) cells.push(null);
              const rows: (number | null)[][] = [];
              for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
              return (
                <div key={mi} style={{ marginBottom: 32 }}>
                  <div style={{ fontSize: "1rem", fontWeight: 800, color: "#111827", marginBottom: 12, paddingBottom: 8, borderBottom: "2px solid #E5E7EB" }}>
                    {monthName}
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                    <thead>
                      <tr>
                        {dayNames.map((d) => (
                          <th key={d} style={{ textAlign: "center", fontSize: "0.65rem", fontWeight: 700, color: "#9CA3AF", padding: "4px 2px", textTransform: "uppercase" }}>
                            {d}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((day, di) => {
                            if (!day) return <td key={di} style={{ padding: "4px 3px", verticalAlign: "top", height: 80 }} />;
                            const isoDate = yr + "-" + String(mo + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
                            const dayArts = dateMap[isoDate] || [];
                            const isToday = isoDate === todayIso;
                            const inRange = isoDate >= (sch.startDate || "") && isoDate <= (sch.endDate || "9999");
                            return (
                              <td
                                key={di}
                                style={{
                                  padding: "4px 3px",
                                  verticalAlign: "top",
                                  height: 80,
                                  border: "1px solid #F3F4F6",
                                  borderRadius: 6,
                                  background: isToday ? "#EFF6FF" : inRange && dayArts.length ? "#FAFAFA" : "white",
                                }}
                              >
                                <div style={{ fontSize: "0.72rem", fontWeight: isToday ? 800 : 600, color: isToday ? "#1D4ED8" : "#374151", marginBottom: 3, textAlign: "right", paddingRight: 3 }}>
                                  {isToday ? (
                                    <span
                                      style={{
                                        background: "#1D4ED8",
                                        color: "white",
                                        borderRadius: "50%",
                                        width: 18,
                                        height: 18,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: "0.68rem",
                                      }}
                                    >
                                      {day}
                                    </span>
                                  ) : (
                                    day
                                  )}
                                </div>
                                {dayArts.map((a) => (
                                  <div
                                    key={a.idx}
                                    style={{
                                      borderRadius: 4,
                                      background: statusBg(a.art.status),
                                      color: statusColor(a.art.status),
                                      marginBottom: 2,
                                      lineHeight: 1.3,
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 1,
                                      overflow: "hidden",
                                    }}
                                  >
                                    <span
                                      onClick={() => a.art.generatedHtml && setPreviewIdx(a.idx)}
                                      title={a.art.title}
                                      style={{
                                        flex: 1,
                                        minWidth: 0,
                                        overflow: "hidden",
                                        whiteSpace: "nowrap",
                                        textOverflow: "ellipsis",
                                        cursor: "pointer",
                                        fontSize: "0.6rem",
                                        fontWeight: 600,
                                        padding: "2px 4px",
                                      }}
                                    >
                                      #{a.idx + 1} {(a.art.title || "").substring(0, 22)}
                                    </span>
                                    <button
                                      onClick={() => {
                                        setCalOpen(false);
                                        openCalEdit(a.idx);
                                      }}
                                      title="Edit"
                                      style={{ flexShrink: 0, border: "none", background: "rgba(0,0,0,.06)", cursor: "pointer", padding: "1px 3px", fontSize: "0.6rem", lineHeight: 1.4, borderRadius: 3, color: "inherit" }}
                                    >
                                      ✏️
                                    </button>
                                    <button
                                      onClick={() => calDeleteArticle(a.idx)}
                                      title="Delete"
                                      style={{ flexShrink: 0, border: "none", background: "rgba(239,68,68,.1)", cursor: "pointer", padding: "1px 3px", fontSize: "0.6rem", lineHeight: 1.4, borderRadius: 3, color: "#DC2626" }}
                                    >
                                      🗑
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (!a.art.generatedHtml) {
                                          toast("⚠️ Write the article first before publishing");
                                          return;
                                        }
                                        setCalOpen(false);
                                        publishSingleArticle(a.idx);
                                      }}
                                      title="Publish Now"
                                      style={{ flexShrink: 0, border: "none", background: "rgba(5,150,105,.12)", cursor: "pointer", padding: "1px 3px", fontSize: "0.6rem", lineHeight: 1.4, borderRadius: 3, color: "#059669" }}
                                    >
                                      🚀
                                    </button>
                                  </div>
                                ))}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ─── Edit popup ───────────────────────────────────────────────────────────
  function renderEditPopup() {
    const idx = editIdx as number;
    return (
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) setEditIdx(null);
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 10000,
          background: "rgba(0,0,0,.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <div style={{ background: "white", borderRadius: 16, padding: 26, width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div style={{ fontSize: "1rem", fontWeight: 800, color: "#111827" }}>✏️ Edit Article #{idx + 1}</div>
            <button
              onClick={() => setEditIdx(null)}
              style={{ background: "#F3F4F6", border: "none", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: "0.9rem", color: "#6B7280" }}
            >
              ✕
            </button>
          </div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#374151", display: "block", marginBottom: 14 }}>
            Article Title
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Article title"
              style={{
                display: "block",
                width: "100%",
                marginTop: 5,
                padding: "9px 12px",
                border: "1.5px solid #E5E7EB",
                borderRadius: 8,
                fontSize: "0.85rem",
                outline: "none",
                boxSizing: "border-box",
                color: "#111827",
              }}
            />
          </label>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#374151", display: "block", marginBottom: 20 }}>
            Scheduled Date
            <input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              style={{
                display: "block",
                width: "100%",
                marginTop: 5,
                padding: "9px 12px",
                border: "1.5px solid #E5E7EB",
                borderRadius: 8,
                fontSize: "0.85rem",
                outline: "none",
                boxSizing: "border-box",
                color: "#111827",
              }}
            />
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={calSaveEdit}
              style={{ flex: 1, padding: 10, background: "linear-gradient(135deg,#0066FF,#0052CC)", border: "none", borderRadius: 9, fontSize: "0.82rem", fontWeight: 700, color: "white", cursor: "pointer" }}
            >
              💾 Save
            </button>
            <button
              onClick={() => {
                if (!articles || !articles[idx] || !articles[idx].generatedHtml) {
                  toast("⚠️ Write the article first before publishing");
                  return;
                }
                setEditIdx(null);
                publishSingleArticle(idx);
              }}
              style={{ padding: "10px 14px", background: "linear-gradient(135deg,#0f766e,#0284c7)", border: "none", borderRadius: 9, fontSize: "0.82rem", fontWeight: 700, color: "white", cursor: "pointer" }}
            >
              🚀 Publish Now
            </button>
            <button
              onClick={() => calDeleteArticle(idx)}
              style={{ padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 9, fontSize: "0.82rem", fontWeight: 700, color: "#DC2626", cursor: "pointer" }}
            >
              🗑️ Delete
            </button>
            <button
              onClick={() => setEditIdx(null)}
              style={{ padding: "10px 14px", background: "#F3F4F6", border: "none", borderRadius: 9, fontSize: "0.82rem", fontWeight: 700, color: "#6B7280", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Preview modal (with fact-check) ──────────────────────────────────────
  function renderPreviewModal() {
    const idx = previewIdx as number;
    if (!articles || !articles[idx] || !articles[idx].generatedHtml) return null;
    const art = articles[idx];
    const fc = art.factCheck;
    const score = fc?.alignmentScore || 0;
    const scoreColor = score >= 80 ? "#10B981" : score >= 60 ? "#F59E0B" : "#DC2626";
    const verdict = score >= 80 ? "✅ Safe to Publish" : score >= 60 ? "⚠️ Review Recommended" : "🛑 Hold — fix contradictions";
    const hasIssues = !!((fc?.contradicting && fc.contradicting.length) || (fc?.unverifiable && fc.unverifiable.length));

    const renderList = (arr: FactClaim[] | undefined, color: string, bg: string, icon: string, label: string, detailKey: keyof FactClaim) =>
      arr && arr.length ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: "0.74rem", fontWeight: 800, color, marginBottom: 6 }}>
            {icon} {arr.length} {label}
          </div>
          {arr.slice(0, 8).map((x, xi) => (
            <div key={xi} style={{ background: bg, borderLeft: "3px solid " + color, padding: "8px 11px", borderRadius: 6, marginBottom: 5, fontSize: "0.74rem", lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, color: "#0A1628" }}>{esc(x.claim)}</div>
              <div style={{ color: "#475569", marginTop: 3, fontStyle: "italic" }}>{esc(x[detailKey])}</div>
            </div>
          ))}
        </div>
      ) : null;

    return (
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setPreviewIdx(null);
            setAutoCorrectInfo(null);
          }
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(0,0,0,.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <div style={{ background: "white", borderRadius: 16, width: 820, maxWidth: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#111827" }}>{art.title}</div>
              <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
                ~{art.wordCount || 1200} words · Keyword: <strong>{art.keyword}</strong>
              </div>
            </div>
            <button
              onClick={() => {
                setPreviewIdx(null);
                setAutoCorrectInfo(null);
              }}
              style={{ padding: "6px 12px", background: "#F3F4F6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: "0.8rem", fontWeight: 700 }}
            >
              ✕ Close
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
            <div
              style={{ padding: "24px 30px", fontSize: "0.88rem", lineHeight: 1.7, color: "#374151" }}
              dangerouslySetInnerHTML={{ __html: art.generatedHtml || "" }}
            />
            <div style={{ padding: "0 30px 24px" }}>
              {factChecking && (
                <div style={{ padding: 14, background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 10, fontSize: "0.78rem", color: "#64748B", margin: "10px 0" }}>
                  Scraping <strong>{ctx.domain || "your site"}</strong> and grading every factual claim against your live
                  source-of-truth…
                </div>
              )}
              {!factChecking && fc && fc.ok === false && (
                <div style={{ padding: 12, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, fontSize: "0.78rem", color: "#991B1B", margin: "10px 0" }}>
                  ❌ {fc.error || "Fact-check failed"}
                </div>
              )}
              {!factChecking && fc && fc.ok !== false && fc.sourceFetched === false && (
                <div style={{ padding: 12, background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 10, fontSize: "0.78rem", color: "#92400E", margin: "10px 0" }}>
                  ⚠️ {fc.note}
                </div>
              )}
              {!factChecking && fc && fc.sourceFetched && (
                <div style={{ background: "white", border: "2px solid " + scoreColor, borderRadius: 12, padding: "14px 16px", margin: "12px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#0A1628" }}>Fact Alignment Report</div>
                      <div style={{ fontSize: "0.7rem", color: "#6B7280", marginTop: 2 }}>
                        Graded against {ctx.domain} ({((fc.sourceLength || 0) / 1000).toFixed(1)}k chars scraped)
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "1.6rem", fontWeight: 800, color: scoreColor }}>
                        {score}
                        <span style={{ fontSize: "0.8rem" }}>/100</span>
                      </div>
                      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: scoreColor }}>{verdict}</div>
                    </div>
                  </div>
                  {fc.summary && (
                    <div style={{ fontSize: "0.76rem", color: "#374151", background: "#F8FAFC", padding: "8px 11px", borderRadius: 7, marginBottom: 6 }}>
                      <strong>Verdict:</strong> {esc(fc.summary)}
                    </div>
                  )}
                  {hasIssues && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "6px 0 10px" }}>
                      <button
                        onClick={() => runArticleAutoCorrect(idx)}
                        disabled={autoCorrecting}
                        style={{
                          padding: "8px 14px",
                          background: "linear-gradient(135deg,#10B981,#059669)",
                          border: "none",
                          borderRadius: 8,
                          fontSize: "0.78rem",
                          fontWeight: 800,
                          color: "#fff",
                          WebkitTextFillColor: "#fff",
                          cursor: autoCorrecting ? "not-allowed" : "pointer",
                          boxShadow: "0 2px 6px rgba(16,185,129,.35)",
                        }}
                      >
                        {autoCorrecting
                          ? "⏳ Auto-correcting…"
                          : `🪄 Auto-Correct (${(fc.contradicting || []).length + (fc.unverifiable || []).length} issues)`}
                      </button>
                      <span style={{ fontSize: "0.7rem", color: "#6B7280", alignSelf: "center" }}>
                        Rewrites flagged claims to match {esc(ctx.domain)} — preserves your HTML structure
                      </span>
                    </div>
                  )}
                  {renderList(fc.contradicting, "#DC2626", "#FEF2F2", "🛑", "Contradicting Claims", "correction")}
                  {renderList(fc.unverifiable, "#F59E0B", "#FFFBEB", "⚠️", "Unverifiable Claims", "reason")}
                  {renderList(fc.aligned, "#10B981", "#F0FDF4", "✅", "Aligned Claims", "evidence")}
                </div>
              )}
              {!factChecking && autoCorrectInfo && (
                <div style={{ background: "white", border: "2px solid #10B981", borderRadius: 12, padding: "14px 16px", margin: "12px 0" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#0A1628", marginBottom: 8 }}>
                    🪄 Auto-Correct Complete — {(autoCorrectInfo.edits || []).length} passages rewritten
                  </div>
                  {(autoCorrectInfo.edits || []).slice(0, 12).map((e, ei) => (
                    <div key={ei} style={{ background: "#F0FDF4", borderLeft: "3px solid #10B981", padding: "8px 11px", borderRadius: 6, marginBottom: 6, fontSize: "0.74rem", lineHeight: 1.5 }}>
                      <div style={{ color: "#991B1B", textDecoration: "line-through" }}>{esc(e.before)}</div>
                      <div style={{ color: "#065F46", fontWeight: 700, marginTop: 3 }}>→ {esc(e.after)}</div>
                      <div style={{ color: "#475569", fontStyle: "italic", marginTop: 2 }}>{esc(e.reason)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={{ padding: "14px 20px", borderTop: "1px solid #E5E7EB", display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button
              onClick={() => runArticleFactCheck(idx)}
              disabled={factChecking}
              style={{ padding: "8px 16px", background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)", border: "none", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, color: "#0f172a", cursor: factChecking ? "not-allowed" : "pointer" }}
            >
              {factChecking ? "⏳ Scraping & checking…" : fc ? "🔄 Re-check Facts" : "🔍 Check Facts"}
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(art.generatedHtml || "");
                toast("📋 Copied!");
              }}
              style={{ padding: "8px 16px", background: "white", border: "1.5px solid #E5E7EB", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}
            >
              📋 Copy HTML
            </button>
            {!!(wpCreds && wpCreds.siteUrl) && (
              <button
                onClick={() => {
                  setPreviewIdx(null);
                  publishSingleArticle(idx);
                }}
                style={{ padding: "8px 16px", background: "linear-gradient(135deg,#0f766e,#0284c7)", border: "none", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, color: "white", cursor: "pointer" }}
              >
                🟦 Publish to WP
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}

const SPIN_CSS = `@keyframes spin { to { transform: rotate(360deg); } }`;

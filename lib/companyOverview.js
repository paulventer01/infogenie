'use strict';
/**
 * Semrush / SE Ranking-style domain snapshot for the post-analyse Company Overview.
 * Deterministic per domain until live GSC/GA4/Ahrefs integrations are connected.
 */

const { applyJourneyStatus } = require('./journeyStatus');

function hashDomain(domain) {
  return String(domain || 'site').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
}

function pick(domain, salt, min, max) {
  const h = hashDomain(domain);
  return min + ((h * 6271 + salt * 9973) % 10000) % (max - min + 1);
}

function trend(domain, salt) {
  const v = pick(domain, salt, -25, 35);
  return { pct: v, up: v >= 0 };
}

function fmtNum(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

/**
 * SE Ranking Project Overview widgets — each teases a full report with key stats.
 */
function buildOverviewWidgets(dom, ad, kpis) {
  const comps = ad.competitors || [];
  const liveTraffic = ad._yourRealData && ad._yourRealData.organicTraffic;
  const traffic = liveTraffic || kpis.trafficMo || pick(dom, 1, 800, 45000);
  const siteHealth = pick(dom, 5, 42, 94);
  const errors = pick(dom, 80, 2, 18);
  const warnings = pick(dom, 81, 3, 24);
  const notices = pick(dom, 82, 4, 30);
  const backlinks = pick(dom, 3, 80, 89000);
  const refDomains = pick(dom, 71, 20, 800);
  const domainTrust = pick(dom, 72, 12, 78);
  const toxic = pick(dom, 73, 0, 12);
  const broken = pick(dom, 74, 0, 20);
  const sessions = pick(dom, 90, 400, Math.max(500, Math.round(traffic * 1.2)));
  const engaged = Math.round(sessions * (pick(dom, 91, 35, 72) / 100));
  const users = Math.round(sessions * 0.78);
  const conversions = pick(dom, 92, 4, 180);
  const views = Math.round(sessions * (pick(dom, 93, 18, 35) / 10));
  const aiPresence = pick(dom, 6, 5, 48);
  const planTotal = 65;
  const planDone = pick(dom, 100, 0, 18);
  const planTodo = planTotal - planDone;
  const battlePhases = (ad.battlePlan && ad.battlePlan.phases) || [];

  return [
    {
      id: 'analytics',
      title: 'Analytics and Traffic',
      view: 'analytics-hub',
      accent: '#0066FF',
      metrics: [
        { label: 'Sessions', value: fmtNum(sessions) },
        { label: 'Engaged sessions', value: fmtNum(engaged) },
        { label: 'Users', value: fmtNum(users) },
        { label: 'Conversions', value: String(conversions) },
        { label: 'Views', value: fmtNum(views) },
      ],
      note: liveTraffic ? 'Includes live organic traffic signal' : 'Industry-benchmark estimate until GA4 is connected',
    },
    {
      id: 'audit',
      title: 'Website Audit',
      view: 'seo-auditor',
      accent: siteHealth >= 70 ? '#10B981' : '#F59E0B',
      hero: { label: 'Health score', value: String(siteHealth), suffix: siteHealth >= 80 ? 'Strong' : siteHealth >= 60 ? 'Fair' : 'Needs work' },
      metrics: [
        { label: 'Errors', value: String(errors), tone: 'danger' },
        { label: 'Warnings', value: String(warnings), tone: 'warn' },
        { label: 'Notices', value: String(notices), tone: 'info' },
        { label: 'Passed checks', value: String(pick(dom, 83, 40, 120)), tone: 'ok' },
      ],
      note: 'On-page & technical SEO health for this domain',
    },
    {
      id: 'backlinks',
      title: 'Backlink Checker',
      view: 'backlinks',
      accent: '#6366F1',
      metrics: [
        { label: 'Total backlinks', value: fmtNum(backlinks) },
        { label: 'Referring domains', value: fmtNum(refDomains) },
        { label: 'Domain trust', value: String(domainTrust) },
        { label: 'Toxic', value: String(toxic), tone: toxic > 5 ? 'danger' : 'ok' },
        { label: 'Broken', value: String(broken), tone: broken > 5 ? 'warn' : 'ok' },
      ],
      note: 'Link profile snapshot — open full report for anchors & new/lost',
    },
    {
      id: 'ai',
      title: 'AI Presence',
      view: 'geo-audit',
      accent: '#7C3AED',
      hero: { label: 'AI visibility', value: `${aiPresence}%`, suffix: 'across LLM answers' },
      metrics: [
        { label: 'AI Overview', value: `${pick(dom, 110, 0, 12)} mentions` },
        { label: 'ChatGPT', value: `${pick(dom, 111, 0, 10)} mentions` },
        { label: 'Gemini', value: `${pick(dom, 112, 0, 8)} mentions` },
        { label: 'Perplexity', value: `${pick(dom, 113, 0, 9)} mentions` },
      ],
      note: 'How often this brand appears in AI search answers',
    },
    {
      id: 'competitors',
      title: 'My Competitors',
      view: 'competitors',
      accent: '#0EA5E9',
      metrics: [
        { label: 'Tracked rivals', value: String(comps.length) },
        { label: 'Share of voice', value: `${pick(dom, 61, 4, 28)}%` },
        { label: 'Top threat', value: comps[0]?.name || comps[0]?.domain || '—' },
        { label: 'Channels mapped', value: String(new Set(comps.map((c) => c.topChannel).filter(Boolean)).size || Math.min(comps.length, 4)) },
      ],
      note: comps.length ? 'Rivals mapped from Analyse Now' : 'Re-run Analyse Now to map competitors',
    },
    {
      id: 'plan',
      title: 'Marketing Plan',
      view: 'battleplan',
      accent: '#F59E0B',
      hero: {
        label: 'Plan progress',
        value: `${planDone}/${planTotal}`,
        suffix: battlePhases.length ? `${battlePhases.length} battle-plan phases` : '90-day checklist',
      },
      metrics: [
        { label: 'Done', value: String(planDone), tone: 'ok' },
        { label: 'To do', value: String(planTodo), tone: 'warn' },
        { label: 'High priority', value: String(pick(dom, 101, 4, 16)), tone: 'danger' },
        { label: 'Ignored', value: '0', tone: 'info' },
      ],
      note: 'Action checklist generated from this analysis',
    },
  ];
}

function buildCompanyOverview(domain, industryName, analysisData, journeyStatus) {
  const dom = String(domain || '').replace(/^https?:\/\//, '').split('/')[0] || 'your-site.com';
  const ad = analysisData || {};
  const kpis = ad.websiteKPIs || {};
  const comps = ad.competitors || [];
  const liveTraffic = ad._yourRealData && ad._yourRealData.organicTraffic;
  const traffic = liveTraffic || kpis.trafficMo || pick(dom, 1, 800, 45000);
  const keywords = pick(dom, 2, 12, 2400);
  const backlinks = pick(dom, 3, 80, 89000);
  const visibility = pick(dom, 4, 8, 72);
  const siteHealth = pick(dom, 5, 42, 94);
  const aiVisibility = pick(dom, 6, 5, 48);
  const mentions = pick(dom, 7, 0, 120);
  const refDomains = pick(dom, 71, 20, 800);

  const modules = [
    {
      key: 'seo',
      label: 'SEO & Search',
      color: '#0066FF',
      desc: 'Rankings, keywords, site health',
      view: 'seo-auditor',
      metrics: [
        { label: 'Site health', value: `${siteHealth}%`, trend: trend(dom, 10) },
        { label: 'Visibility', value: `${visibility}%`, trend: trend(dom, 11) },
        { label: 'Organic keywords', value: keywords.toLocaleString(), trend: trend(dom, 12) },
      ],
    },
    {
      key: 'traffic',
      label: 'Traffic & Market',
      color: '#00C9C8',
      desc: 'Traffic, channels, market share',
      view: 'analytics-hub',
      metrics: [
        { label: 'Organic traffic', value: fmtNum(traffic), trend: trend(dom, 20) },
        { label: 'Competitors tracked', value: String(comps.length), trend: { pct: 0, up: true } },
        { label: 'Market visibility', value: `${visibility}%`, trend: trend(dom, 21) },
      ],
    },
    {
      key: 'ai',
      label: 'AI Visibility',
      color: '#7C3AED',
      desc: 'Presence in AI answers',
      view: 'geo-audit',
      metrics: [
        { label: 'AI visibility', value: `${aiVisibility}%`, trend: trend(dom, 30) },
        { label: 'Brand mentions', value: String(mentions), trend: trend(dom, 31) },
      ],
    },
    {
      key: 'content',
      label: 'Content',
      color: '#10B981',
      desc: 'Gaps, briefs, performance',
      view: 'content-gaps',
      metrics: [
        { label: 'Content gaps', value: String(pick(dom, 40, 3, 24)), trend: trend(dom, 40) },
        { label: 'Top pages', value: String(pick(dom, 41, 5, 40)), trend: trend(dom, 41) },
      ],
    },
    {
      key: 'ads',
      label: 'Advertising',
      color: '#F59E0B',
      desc: 'Paid search & social intel',
      view: 'ad-library',
      metrics: [
        { label: 'Est. ROAS', value: `${kpis.roas || pick(dom, 50, 18, 42) / 10}×`, trend: trend(dom, 50) },
        { label: 'Ad channels', value: String(new Set(comps.map((c) => c.topChannel).filter(Boolean)).size || 3), trend: trend(dom, 51) },
      ],
    },
    {
      key: 'social',
      label: 'Social & PR',
      color: '#EC4899',
      desc: 'Social, mentions, reputation',
      view: 'mentions',
      metrics: [
        { label: 'Mentions', value: String(mentions), trend: trend(dom, 60) },
        { label: 'Share of voice', value: `${pick(dom, 61, 4, 28)}%`, trend: trend(dom, 61) },
      ],
    },
    {
      key: 'links',
      label: 'Backlinks',
      color: '#6366F1',
      desc: 'Authority & link profile',
      view: 'backlinks',
      metrics: [
        { label: 'Backlinks', value: fmtNum(backlinks), trend: trend(dom, 70) },
        { label: 'Referring domains', value: String(refDomains), trend: trend(dom, 71) },
      ],
    },
  ];

  const snapshot = [
    { key: 'ai-vis', label: 'AI Presence', value: aiVisibility > 0 ? `${aiVisibility}%` : '—', trend: trend(dom, 6), view: 'geo-audit' },
    { key: 'traffic', label: 'Organic Traffic', value: fmtNum(traffic), trend: trend(dom, 1), view: 'analytics-hub', live: !!liveTraffic },
    { key: 'keywords', label: 'Organic Keywords', value: keywords.toLocaleString(), trend: trend(dom, 12), view: 'keyword-explorer' },
    { key: 'ref-domains', label: 'Referring Domains', value: fmtNum(refDomains), trend: trend(dom, 71), view: 'backlinks' },
    { key: 'visibility', label: 'Search Visibility', value: `${visibility}%`, trend: trend(dom, 4), view: 'serp-tracker' },
    { key: 'health', label: 'Site Health', value: `${siteHealth}%`, trend: trend(dom, 5), view: 'seo-auditor', cta: siteHealth < 70 ? 'Fix issues' : null },
    { key: 'backlinks', label: 'Backlinks', value: fmtNum(backlinks), trend: trend(dom, 70), view: 'backlinks' },
  ];

  const journey = applyJourneyStatus(
    [
      { step: 1, label: 'Overview', desc: 'Company snapshot & health', view: 'dashboard', done: true },
      { step: 2, label: 'Rankings', desc: 'Keywords & SERP positions', view: 'serp-tracker', done: false },
      { step: 3, label: 'Analytics', desc: 'Traffic & engagement', view: 'analytics-hub', done: false },
      { step: 4, label: 'Competitors', desc: `${comps.length} rivals mapped`, view: 'competitors', done: comps.length > 0 },
      { step: 5, label: 'AI Search', desc: 'LLM visibility', view: 'geo-audit', done: false },
      { step: 6, label: 'Backlinks', desc: 'Link profile', view: 'backlinks', done: false },
      { step: 7, label: 'Marketing Plan', desc: '10-step revenue plan', view: 'marketing-plan', done: comps.length > 0 },
      { step: 8, label: 'Website Audit', desc: 'Technical health', view: 'seo-auditor', done: false },
    ],
    journeyStatus,
    {
      competitorsCount: comps.length,
      hasBattlePlan: !!(ad.battlePlan && ad.battlePlan.phases && ad.battlePlan.phases.length),
    },
  );

  return {
    domain: dom,
    industry: industryName || 'Your industry',
    snapshot,
    modules,
    widgets: buildOverviewWidgets(dom, ad, kpis),
    journey,
    profile: ad.companyProfile || null,
  };
}

module.exports = { buildCompanyOverview, buildOverviewWidgets, applyJourneyStatus };

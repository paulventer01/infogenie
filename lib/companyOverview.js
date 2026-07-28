'use strict';
/**
 * Semrush-style domain snapshot for the post-analyse Company Overview dashboard.
 * Deterministic per domain until live GSC/GA4/Ahrefs integrations are connected.
 */

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

function buildCompanyOverview(domain, industryName, analysisData) {
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
      { label: 'Organic traffic', value: traffic >= 1e6 ? `${(traffic / 1e6).toFixed(1)}M` : traffic >= 1e3 ? `${Math.round(traffic / 1e3)}K` : String(traffic), trend: trend(dom, 20) },
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
      { label: 'Backlinks', value: backlinks >= 1e3 ? `${(backlinks / 1e3).toFixed(1)}K` : String(backlinks), trend: trend(dom, 70) },
      { label: 'Referring domains', value: String(pick(dom, 71, 20, 800)), trend: trend(dom, 71) },
    ],
  },
  ];

  const snapshot = [
    { key: 'ai-vis', label: 'AI Visibility', value: aiVisibility > 0 ? `${aiVisibility}%` : '—', trend: trend(dom, 6), view: 'geo-audit' },
    { key: 'mentions', label: 'Mentions', value: String(mentions), trend: trend(dom, 7), view: 'mentions' },
    { key: 'health', label: 'Site Health', value: `${siteHealth}%`, trend: trend(dom, 5), view: 'seo-auditor', cta: siteHealth < 70 ? 'Fix issues' : null },
    { key: 'visibility', label: 'Visibility', value: `${visibility}%`, trend: trend(dom, 4), view: 'serp-tracker' },
    { key: 'traffic', label: 'Organic Traffic', value: traffic >= 1e3 ? `${Math.round(traffic / 1e3)}K` : String(traffic), trend: trend(dom, 1), view: 'analytics-hub', live: !!liveTraffic },
    { key: 'keywords', label: 'Organic Keywords', value: keywords.toLocaleString(), trend: trend(dom, 12), view: 'keyword-explorer' },
    { key: 'backlinks', label: 'Backlinks', value: backlinks >= 1e3 ? `${(backlinks / 1e3).toFixed(1)}K` : String(backlinks), trend: trend(dom, 70), view: 'backlinks' },
  ];

  const journey = [
    { step: 1, label: 'Overview', desc: 'Company snapshot & health', view: 'dashboard', done: true },
    { step: 2, label: 'Competitors', desc: `${comps.length} rivals mapped`, view: 'competitors', done: comps.length > 0 },
    { step: 3, label: 'Strategy', desc: '90-day battle plan', view: 'battleplan', done: comps.length > 0 },
    { step: 4, label: 'SEO & Content', desc: 'Gaps & rankings', view: 'content-gaps', done: false },
    { step: 5, label: 'Launch', desc: 'Campaigns & ads', view: 'campaigns', done: false },
    { step: 6, label: 'Measure', desc: 'Analytics & ROI', view: 'analytics-hub', done: false },
  ];

  return {
    domain: dom,
    industry: industryName || 'Your industry',
    snapshot,
    modules,
    journey,
    profile: ad.companyProfile || null,
  };
}

module.exports = { buildCompanyOverview };

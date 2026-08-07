'use strict';
/**
 * Domain-seeded marketing intelligence panels matching the 7-section
 * framework in InfoGenie_features2.3 (GA4 / GSC reference screenshots).
 * Deterministic per domain — replace with live GA4/GSC when connected.
 */

function hashDomain(domain) {
  return String(domain || 'site').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
}

function seeded(domain, salt, max) {
  const h = hashDomain(domain);
  return ((h * 6271 + salt * 9973) % 10000) % max;
}

function buildMarketingIntel(domain, industryName) {
  const dom = String(domain || 'your-site.com').replace(/^https?:\/\//, '').split('/')[0];
  const sector = industryName || 'your industry';

  const channels = [
    { name: 'Organic Search', color: '#0066FF' },
    { name: 'Direct', color: '#00C9C8' },
    { name: 'Referral', color: '#7C3AED' },
    { name: 'Organic Social', color: '#F59E0B' },
    { name: 'Paid Search', color: '#10B981' },
  ];

  const engagementByChannel = channels.map((ch, i) => {
    const s = seeded(dom, i + 1, 10000);
    const sessions = 400 + (s % 12000);
    const engaged = Math.round(sessions * (0.45 + (s % 350) / 1000));
    const engagementRate = +((engaged / sessions) * 100).toFixed(1);
    const bounceRate = +(100 - engagementRate - (s % 8)).toFixed(1);
    const avgEngagement = `${Math.floor(40 + (s % 120))}s`;
    const eventsPerSession = +((3 + (s % 800) / 100).toFixed(2));
    return {
      ...ch,
      sessions,
      engaged,
      engagementRate,
      bounceRate: Math.max(12, bounceRate),
      avgEngagement,
      eventsPerSession,
    };
  });

  const slug = sector.toLowerCase().replace(/\s+/g, '-');
  const queries = [
    `${slug} platform`,
    `best ${slug}`,
    `${dom.split('.')[0]} review`,
    `${slug} vs alternatives`,
    `how to choose ${slug}`,
    `${slug} pricing`,
    `${slug} login`,
    `${slug} demo`,
  ].map((q, i) => {
    const s = seeded(dom, 20 + i, 10000);
    const impressions = 1200 + (s % 18000);
    const ctr = +(0.8 + (s % 280) / 100).toFixed(2);
    const clicks = Math.round((impressions * ctr) / 100);
    const position = +(4 + (s % 1800) / 100).toFixed(1);
    return { query: q, impressions, clicks, ctr, position };
  });
  const lowCtrPages = [...queries]
    .filter((q) => q.impressions > 5000 && q.ctr < 2.5)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5);

  const days = 28;
  const channelTrend = channels.map((ch, ci) => ({
    name: ch.name,
    color: ch.color,
    points: Array.from({ length: days }, (_, di) => {
      const base = 20 + seeded(dom, ci * 10 + di, 80);
      const wave = Math.sin(di / 4 + ci) * 8;
      return Math.max(5, Math.round(base + wave));
    }),
  }));

  const scrollDepth = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((pct, i) => {
    const s = seeded(dom, 50 + i, 10000);
    const total = Math.round(18000 * Math.pow(0.82, i) + (s % 500));
    const unique = Math.round(total * 0.72);
    return { pct, total, unique };
  });

  const s = seeded(dom, 99, 10000);
  const newUsers = 55 + (s % 25);
  const returningUsers = 100 - newUsers;
  const newBounce = +(38 + (s % 120) / 10).toFixed(1);
  const retBounce = +(22 + (s % 80) / 10).toFixed(1);

  const topReturningPages = [
    { path: '/pricing', label: 'Pricing', visitors: 820 + (s % 400), delta: 12 },
    { path: '/products', label: 'Products', visitors: 640 + (s % 300), delta: -4 },
    { path: `/blog/${slug}-guide`, label: `${sector} Guide`, visitors: 510 + (s % 250), delta: 18 },
    { path: '/about', label: 'About', visitors: 380 + (s % 200), delta: 6 },
    { path: '/contact', label: 'Contact', visitors: 290 + (s % 150), delta: -2 },
  ];

  const siteSearches = [
    'pricing',
    'demo',
    'support',
    'api',
    'integrations',
    `${slug}`,
    'login',
    'refund policy',
  ].map((term, i) => {
    const ss = seeded(dom, 70 + i, 10000);
    return { term, searches: 5 + (ss % 120), pct: +((5 + (ss % 120)) / 1.2).toFixed(1) };
  }).sort((a, b) => b.searches - a.searches);

  const seoNotes = [
    { date: '14 days ago', note: 'Updated meta titles on top landing pages' },
    { date: '21 days ago', note: 'Published new comparison content vs top competitor' },
    { date: '28 days ago', note: 'Fixed Core Web Vitals on mobile homepage' },
  ];

  return {
    domain: dom,
    period: 'Last 28 days',
    engagementByChannel,
    lowCtrQueries: lowCtrPages.length ? lowCtrPages : queries.filter((q) => q.ctr < 2).slice(0, 5),
    channelTrend,
    scrollDepth,
    audienceSplit: { newUsers, returningUsers, newBounce, retBounce },
    topReturningPages,
    siteSearches: siteSearches.slice(0, 6),
    seoNotes,
    dataSource: 'estimated',
  };
}

module.exports = { buildMarketingIntel };

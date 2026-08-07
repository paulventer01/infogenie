'use strict';
/** Helpers for the post-analyse Marketing Command Center dashboard. */

function parseTrafficNum(c) {
  if (c.trafficMo) return c.trafficMo;
  const raw = c.traffic;
  if (!raw || raw === '—') return 0;
  const t = String(raw).replace(/[, ]/g, '');
  if (t.endsWith('B')) return parseFloat(t) * 1e9;
  if (t.endsWith('M')) return parseFloat(t) * 1e6;
  if (t.endsWith('K')) return parseFloat(t) * 1e3;
  const n = parseFloat(t);
  return isFinite(n) && n > 0 ? n : 0;
}

function safeAvg(arr) {
  const nums = arr.filter((n) => typeof n === 'number' && isFinite(n) && n > 0);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function buildSwot(ad, yourDomain) {
  const kpis = ad.websiteKPIs;
  const comps = ad.competitors || [];
  const avgCtr = safeAvg(comps.map((c) => parseFloat(String(c.ctr))));
  const avgRoas = safeAvg(comps.map((c) => (typeof c.roas === 'number' ? c.roas : parseFloat(String(c.roas)))));
  const strengths = [];
  const weaknesses = [];
  const opportunities = [];
  const threats = [];

  if (kpis) {
    if (kpis.ctr >= avgCtr) strengths.push(`CTR benchmark (${kpis.ctr}%) beats competitor average (${avgCtr.toFixed(2)}%)`);
    else weaknesses.push(`CTR (${kpis.ctr}%) trails competitor average (${avgCtr.toFixed(2)}%)`);
    if (kpis.roas >= avgRoas) strengths.push(`ROAS (${kpis.roas}×) outperforms rival average (${avgRoas.toFixed(1)}×)`);
    else weaknesses.push(`ROAS (${kpis.roas}×) below competitor average (${avgRoas.toFixed(1)}×)`);
    if (ad._yourRealData && ad._yourRealData.organicTraffic) strengths.push('Live organic traffic data connected via DataForSEO');
    else weaknesses.push('Organic traffic is estimated — connect Google Analytics for verified numbers');
  }

  if (ad.companyProfile && ad.companyProfile.businessSummary) {
    strengths.push(ad.companyProfile.businessSummary);
  }

  const topOpp = comps.flatMap((c) => c.suggestions || []).slice(0, 4);
  opportunities.push(...topOpp);
  if (!opportunities.length) {
    opportunities.push("Launch comparison landing pages against top rivals' branded keywords");
    opportunities.push('Shift budget to the highest-efficiency channel in your sector');
  }

  comps
    .filter((c) => ['critical', 'high'].includes(String(c.threatLevel || '').toLowerCase()))
    .slice(0, 3)
    .forEach((c) => {
      threats.push(`${c.name} (${c.threatLevel} threat) — ${c.topChannel || 'multi-channel'} · ${c.traffic || 'unknown traffic'}`);
    });
  if (!threats.length) threats.push('Monitor competitor ad spend shifts weekly');

  return { strengths, weaknesses, opportunities, threats };
}

function buildChannelMix(comps) {
  const counts = {};
  comps.forEach((c) => {
    const ch = c.topChannel || (c.topChannels && c.topChannels[0]);
    if (!ch || ch === '—') return;
    counts[ch] = (counts[ch] || 0) + 1;
  });
  const palette = ['#0066FF', '#00C9C8', '#7C3AED', '#F59E0B', '#10B981', '#EF4444'];
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n], i) => ({
      name,
      share: Math.round((n / total) * 100),
      color: palette[i % palette.length],
    }));
}

function buildPriorityActions(ad) {
  const comps = ad.competitors || [];
  const industry = (ad.industry && ad.industry.name) || 'your market';
  const actions = [
    {
      title: 'Review Intelligence Report KPIs',
      detail: `Benchmark CTR, ROAS, CPA and traffic for ${ad.url || 'your domain'} against ${comps.length} mapped rivals.`,
      impact: 'high',
      area: 'Performance',
      view: 'dashboard',
    },
    {
      title: 'Open 90-day Battle Plan',
      detail: `Execution roadmap tailored to gaps found in ${industry}.`,
      impact: 'high',
      area: 'Strategy',
      view: 'battleplan',
    },
  ];

  const lead = comps.find((c) => c.threatLevel === 'critical') || comps[0];
  if (lead && lead.name) {
    actions.push({
      title: `Counter ${lead.name}`,
      detail: (lead.suggestions && lead.suggestions[0]) || `Analyse ${lead.name}'s channel mix and launch a comparison campaign.`,
      impact: 'high',
      area: 'Competitive',
      view: 'competitors',
    });
  }

  actions.push(
    {
      title: 'Audit SEO & content gaps',
      detail: 'Map keywords rivals rank for that you do not — close gaps with targeted pages.',
      impact: 'medium',
      area: 'SEO',
      view: 'content-gaps',
    },
    {
      title: 'Connect live ad accounts',
      detail: 'Replace benchmark estimates with real Google Ads, Meta and GA4 performance.',
      impact: 'medium',
      area: 'Integrations',
      view: 'settings',
    },
    {
      title: 'Set up competitor alerts',
      detail: 'Get notified when rivals change spend, creatives or pricing.',
      impact: 'low',
      area: 'Monitoring',
      view: 'change-monitor',
    },
  );

  return actions.slice(0, 6);
}

function formatAdSpend(c) {
  if (typeof c.adSpendEst === 'number' && c.adSpendEst > 0) {
    return `$${c.adSpendEst >= 1e6 ? (c.adSpendEst / 1e6).toFixed(1) + 'M' : c.adSpendEst >= 1e3 ? Math.round(c.adSpendEst / 1e3) + 'K' : c.adSpendEst}/mo`;
  }
  if (c.adSpend && c.adSpend !== '—') return String(c.adSpend);
  const t = parseTrafficNum(c);
  if (t > 0) {
    const est = Math.min(Math.round(t * 0.03 * 3), 1_500_000);
    return est >= 1e6 ? `~$${(est / 1e6).toFixed(1)}M/mo` : est >= 1e3 ? `~$${Math.round(est / 1e3)}K/mo` : `~$${est}/mo`;
  }
  return '—';
}

function blendedMarketingMetrics(ad) {
  const kpis = ad.websiteKPIs;
  const comps = ad.competitors || [];
  const traffic = (ad._yourRealData && ad._yourRealData.organicTraffic) || (kpis && kpis.trafficMo) || 0;
  const avgRoas = safeAvg(comps.map((c) => (typeof c.roas === 'number' ? c.roas : parseFloat(String(c.roas)))));
  const yourRoas = (kpis && kpis.roas) || 0;
  const totalCompTraffic = comps.reduce((a, c) => a + parseTrafficNum(c), 0);
  const marketShare = totalCompTraffic > 0 ? Math.min(99, Math.round((traffic / (traffic + totalCompTraffic)) * 100)) : null;

  return {
    monthlyTraffic: traffic,
    roas: yourRoas,
    roasVsMarket: avgRoas > 0 ? ((yourRoas / avgRoas - 1) * 100) : 0,
    cpa: kpis && kpis.cpa,
    convRate: kpis && kpis.convRate,
    marketShare,
    competitorCount: comps.length,
    projectedRoas: avgRoas > 0 ? (yourRoas * 1.28).toFixed(1) : null,
  };
}

module.exports = {
  buildSwot,
  buildChannelMix,
  buildPriorityActions,
  formatAdSpend,
  blendedMarketingMetrics,
};

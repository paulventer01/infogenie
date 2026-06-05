'use strict';
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

async function _safeCount(sql, params) {
  try {
    const r = await _db.query(sql, params);
    return parseInt(r.rows[0]?.count || 0, 10);
  } catch (_) { return 0; }
}

async function _safeLastAt(sql, params) {
  try {
    const r = await _db.query(sql, params);
    return r.rows[0]?.last_at || null;
  } catch (_) { return null; }
}

router.get('/summary', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'flywheel:summary' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });

    const [
      competitorCount, adSwipeCount,
      contentScoreCount, bulkAuditCount,
      serpCount, keywordMapCount,
      campaignCount, calendarCount,
      banditCount, perfCount,
      digestCount, broadcastCount
    ] = await Promise.all([
      _safeCount('SELECT COUNT(*) AS count FROM competitors WHERE tenant_id=$1', [tid]),
      _safeCount('SELECT COUNT(*) AS count FROM ad_swipe WHERE tenant_id=$1', [tid]),
      _safeCount('SELECT COUNT(*) AS count FROM content_score_runs WHERE tenant_id=$1', [tid]),
      _safeCount('SELECT COUNT(*) AS count FROM bulk_audit_runs WHERE tenant_id=$1', [tid]),
      _safeCount('SELECT COUNT(*) AS count FROM serp_tracker_keywords WHERE tenant_id=$1', [tid]),
      _safeCount('SELECT COUNT(*) AS count FROM keyword_page_map_runs WHERE tenant_id=$1', [tid]),
      _safeCount('SELECT COUNT(*) AS count FROM ad_campaigns WHERE tenant_id=$1 AND status NOT IN (\'paused\',\'archived\')', [tid]),
      _safeCount('SELECT COUNT(*) AS count FROM content_calendar_runs WHERE tenant_id=$1', [tid]),
      _safeCount('SELECT COUNT(*) AS count FROM bandit_allocations WHERE tenant_id=$1', [tid]),
      _safeCount('SELECT COUNT(*) AS count FROM ad_performance_hourly WHERE tenant_id=$1', [tid]),
      _safeCount('SELECT COUNT(*) AS count FROM digest_runs WHERE tenant_id=$1', [tid]),
      _safeCount('SELECT COUNT(*) AS count FROM email_broadcasts WHERE tenant_id=$1', [tid]),
    ]);

    const stages = {
      research:     { count: competitorCount + adSwipeCount,    label: 'Sources tracked',    lastAction: competitorCount > 0 ? 'Competitor profiles' : null, view: 'competitors', tools: [{ label: '🧠 Intelligence Hub', view: 'intelligence' }, { label: '🕵️ Ad Library Spy', view: 'ad-library' }] },
      gaps:         { count: contentScoreCount + bulkAuditCount, label: 'Audits completed',  lastAction: contentScoreCount > 0 ? 'Content scored' : null,      view: 'content-score', tools: [{ label: '📊 Content Scorer', view: 'content-score' }, { label: '🔍 SEO Crawler', view: 'seo-crawler' }] },
      opportunities:{ count: serpCount + keywordMapCount,        label: 'Keywords mapped',   lastAction: serpCount > 0 ? 'SERP tracked' : null,               view: 'keyword-explorer', tools: [{ label: '🔑 Keyword Explorer', view: 'keyword-explorer' }, { label: '🗺️ Keyword Map', view: 'keyword-map' }] },
      execute:      { count: campaignCount + calendarCount,      label: 'Items live',        lastAction: campaignCount > 0 ? 'Campaigns active' : null,       view: 'campaigns', tools: [{ label: '🚀 Campaign Launch', view: 'campaigns' }, { label: '📅 Content Calendar', view: 'content-calendar' }] },
      evaluate:     { count: banditCount + perfCount,            label: 'Optimizer cycles',  lastAction: banditCount > 0 ? 'Bandit ran' : null,               view: 'optimizer', tools: [{ label: '🤖 AI Optimizer', view: 'optimizer' }, { label: '📈 iROAS', view: 'iroas' }] },
      report:       { count: digestCount + broadcastCount,       label: 'Reports sent',      lastAction: digestCount > 0 ? 'Digest sent' : null,              view: 'weekly-report', tools: [{ label: '📬 Weekly Report', view: 'weekly-report' }, { label: '💰 Budget Board', view: 'budget-board' }] },
    };

    const order = ['research','gaps','opportunities','execute','evaluate','report'];
    const minStage = order.reduce((min, s) => stages[s].count < stages[min].count ? s : min, 'research');
    const nextMessages = {
      research:      'Profile 3+ competitors to feed the flywheel with market intel.',
      gaps:          'Run a content audit to spot where you\'re falling behind competitors.',
      opportunities: 'Map your top keywords to pages — find quick-win ranking gaps.',
      execute:       'Launch a campaign or schedule content to start driving traffic.',
      evaluate:      'Turn on the AI Optimizer so it reallocates budget to winning ads.',
      report:        'Set up a weekly digest to close the loop and share results with your team.',
    };

    res.json({
      stages,
      order,
      nextAction: { stage: minStage, message: nextMessages[minStage], view: stages[minStage].view },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

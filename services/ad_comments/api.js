// Ad Comment Monitor — scans Meta (Facebook/Instagram) ad posts for comments,
// analyses sentiment with GPT-4o-mini, and surfaces negative comments as
// actionable alerts. Requires META_ACCESS_TOKEN + META_AD_ACCOUNT_ID.
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI  = require('openai');

const hasDb = () => _db.hasDb && _db.hasDb();
const pool  = { query: (...a) => _db.getPool().query(...a) };

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[ad-comments]', e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}

async function _fetchMeta(path, token) {
  const url = `https://graph.facebook.com/v19.0${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const j = await r.json();
  if (j.error) throw new Error(`Meta API: ${j.error.message}`);
  return j;
}

async function _analyseSentiment(comments) {
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY || !comments.length) return [];
  const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
  const texts = comments.map((c, i) => `${i}: "${c.message || ''}"`).join('\n');
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `Classify the sentiment of each ad comment below as positive, neutral, or negative.
Comments (index: text):
${texts}

Return JSON: {"results":[{"index":0,"sentiment":"negative"},...]}`,
      }],
      max_tokens: 400,
    });
    const parsed = JSON.parse(r.choices[0].message.content);
    return parsed.results || [];
  } catch (e) {
    console.warn('[ad-comments] sentiment analysis failed:', e.message);
    return [];
  }
}

// ── GET /api/ad-comments/alerts ───────────────────────────────────────────────

router.get('/alerts', _safe(async (req, res) => {
  if (!hasDb()) return res.json({ ok: true, alerts: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ad-comments:list' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { sentiment, actioned } = req.query;
  const conditions = ['tenant_id=$1'];
  const args = [tid];
  if (sentiment) { conditions.push(`sentiment=$${args.length + 1}`); args.push(sentiment); }
  if (actioned !== undefined) { conditions.push(`actioned=$${args.length + 1}`); args.push(actioned === 'true'); }
  const r = await pool.query(
    `SELECT * FROM ad_comment_alerts WHERE ${conditions.join(' AND ')} ORDER BY detected_at DESC LIMIT 200`,
    args
  );
  const counts = await pool.query(
    `SELECT sentiment, COUNT(*) AS n FROM ad_comment_alerts WHERE tenant_id=$1 AND actioned=FALSE GROUP BY sentiment`,
    [tid]
  );
  const summary = { positive: 0, neutral: 0, negative: 0 };
  for (const row of counts.rows) summary[row.sentiment] = parseInt(row.n, 10);
  res.json({ ok: true, alerts: r.rows, summary });
}));

// ── POST /api/ad-comments/scan ────────────────────────────────────────────────

router.post('/scan', _safe(async (req, res) => {
  if (!hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ad-comments:scan' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const token    = process.env.META_ACCESS_TOKEN;
  const adAcctId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !adAcctId) {
    return _err(res, 400, 'META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are required');
  }

  // 1. Fetch active ads with their post IDs
  let adsData;
  try {
    adsData = await _fetchMeta(
      `/act_${adAcctId.replace(/^act_/, '')}/ads?fields=id,name,creative{effective_object_story_id}&limit=20&effective_status=["ACTIVE"]`,
      token
    );
  } catch (e) {
    return _err(res, 502, `Failed to fetch ads: ${e.message}`);
  }
  const ads = adsData.data || [];
  if (!ads.length) return res.json({ ok: true, scanned: 0, new_alerts: 0, message: 'No active ads found' });

  let totalNew = 0;
  let scannedPosts = 0;

  for (const ad of ads.slice(0, 10)) {
    const postId = ad.creative?.effective_object_story_id;
    if (!postId) continue;
    scannedPosts++;

    // 2. Fetch comments on the post
    let commentsData;
    try {
      commentsData = await _fetchMeta(
        `/${postId}/comments?fields=id,message,from&limit=25&filter=stream`,
        token
      );
    } catch (e) {
      console.warn('[ad-comments] comment fetch failed for post', postId, e.message);
      continue;
    }
    const comments = (commentsData.data || []).filter(c => c.message);
    if (!comments.length) continue;

    // 3. Analyse sentiment
    const sentiments = await _analyseSentiment(comments);
    const sentMap = {};
    for (const s of sentiments) sentMap[s.index] = s.sentiment;

    // 4. Store
    for (let i = 0; i < comments.length; i++) {
      const c = comments[i];
      const sentiment = sentMap[i] || 'neutral';
      const alertId = 'adc_' + crypto.randomBytes(6).toString('hex');
      try {
        const result = await pool.query(
          `INSERT INTO ad_comment_alerts(id,tenant_id,platform,ad_id,ad_name,post_id,comment_id,comment_text,author,sentiment)
           VALUES($1,$2,'meta',$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT(tenant_id,platform,comment_id) DO NOTHING`,
          [alertId, tid, ad.id, ad.name || '', postId, c.id, c.message.slice(0, 1000), c.from?.name || 'Unknown', sentiment]
        );
        if (result.rowCount > 0) totalNew++;
      } catch (e) { console.warn('[ad-comments] insert error:', e.message); }
    }
  }

  res.json({ ok: true, scanned: scannedPosts, new_alerts: totalNew, total_ads: ads.length });
}));

// ── POST /api/ad-comments/:id/action ─────────────────────────────────────────

router.post('/:id/action', _safe(async (req, res) => {
  if (!hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ad-comments:action' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { note = '' } = req.body || {};
  await pool.query(
    `UPDATE ad_comment_alerts SET actioned=TRUE, actioned_at=NOW(), actioned_note=$1 WHERE id=$2 AND tenant_id=$3`,
    [String(note).slice(0, 500), req.params.id, tid]
  );
  res.json({ ok: true });
}));

module.exports = router;

const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const _http = require('http');
const _https = require('https');
const { generateDigest } = require('./generator');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

let _cronTimer = null;
function startCron(intervalHours = 24) {
  if (_cronTimer) return;
  const tick = async () => {
    if (!_db.hasDb()) return;
    try {
      const r = await _db.getPool().query('SELECT DISTINCT brand FROM crisis_watchlist LIMIT 5');
      for (const row of r.rows) {
        try { await generateDigest(row.brand); console.log('[digest] auto-generated for', row.brand); }
        catch (e) { console.warn('[digest] auto-gen failed for', row.brand, e.message); }
      }
    } catch (e) { console.warn('[digest] cron tick failed:', e.message); }
  };
  _cronTimer = setInterval(tick, intervalHours * 3600 * 1000);
  console.log(`[digest] cron started — every ${intervalHours}h`);
}

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const brand = String(req.query.brand || '').trim().slice(0, 80);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'digest:history', allowFallback:true });
    const q = brand
      ? await _db.getPool().query(
          `SELECT id, brand, headline, generated_by, delivered_to, created_at
           FROM digest_runs WHERE tenant_id=$1 AND brand=$2 ORDER BY created_at DESC LIMIT $3`, [tid, brand, limit])
      : await _db.getPool().query(
          `SELECT id, brand, headline, generated_by, delivered_to, created_at
           FROM digest_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`, [tid, limit]);
    res.json({ ok:true, digests: q.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'bad id');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'digest:get', allowFallback:true });
    const q = await _db.getPool().query('SELECT * FROM digest_runs WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!q.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok:true, digest: q.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/run-now', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const brand = String(req.body?.brand || '').trim().slice(0, 80);
  if (!brand) return _err(res, 400, 'brand required');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'digest:run-now', allowFallback:true });
    const d = await generateDigest(brand, tid);
    res.json({ ok:true, digest: d });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/:id/send', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'bad id');
  const channels = Array.isArray(req.body?.channels) ? req.body.channels : ['slack'];
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'digest:send', allowFallback:true });
    const q = await _db.getPool().query('SELECT * FROM digest_runs WHERE id=$1 AND tenant_id=$2', [id, tid]);
    const d = q.rows[0];
    if (!d) return _err(res, 404, 'not found');
    const delivered = [];

    if (channels.includes('slack') && process.env.SLACK_WEBHOOK_URL) {
      try {
        const text = `*${d.headline}*\n\n${d.summary_md}\n\n${(d.sections||[]).map(s => `• *${s.title}* — ${s.body}`).join('\n')}`;
        await _slackPost(text);
        delivered.push({ channel: 'slack', at: new Date().toISOString(), ok: true });
      } catch (e) { delivered.push({ channel: 'slack', ok: false, error: e.message }); }
    }

    await _db.getPool().query(
      `UPDATE digest_runs SET delivered_to = delivered_to || $1::jsonb WHERE id=$2 AND tenant_id=$3`,
      [JSON.stringify(delivered), id, tid]);
    res.json({ ok:true, delivered });
  } catch (e) { _err(res, 500, e.message); }
});

function _slackPost(text) {
  const u = new URL(process.env.SLACK_WEBHOOK_URL);
  if (u.protocol !== 'https:') throw new Error('slack url not https');
  if (!['hooks.slack.com','discord.com','discordapp.com'].includes(u.hostname))
    throw new Error('slack host not allowed');
  const isDiscord = u.hostname.includes('discord');
  const body = JSON.stringify(isDiscord ? { content: text.slice(0, 1900) } : { text });
  return new Promise((resolve, reject) => {
    const r = _https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, resp => { resp.on('data', () => {}); resp.on('end', () =>
      resp.statusCode < 300 ? resolve() : reject(new Error('slack '+resp.statusCode))); });
    r.on('error', reject);
    r.setTimeout(8000, () => r.destroy(new Error('slack timeout')));
    r.write(body); r.end();
  });
}

module.exports = router;
module.exports.startCron = startCron;

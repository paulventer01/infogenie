const express  = require('express');
const _db       = require('../../db');
const _tenantCtx = require('../tenants/context');
const _https    = require('https');
const { generateBrief } = require('./generator');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error:msg }); }
function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

// Cadence gate: returns true if a new brief should be generated
function _shouldGenerate(lastBrief, cadence) {
  if (!lastBrief) return true;
  const last = new Date(lastBrief.created_at);
  const now  = new Date();
  const hoursAgo = (now - last) / 3600000;
  if (cadence === 'weekly') return hoursAgo >= 168;
  return hoursAgo >= 22; // daily (allow 2h window for timezone drift)
}

// GET /api/marketing-brief/today  — returns cached brief or generates one
router.get('/today', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const tid = await _tid(req, 'brief:today');
  if (!tid) return _err(res, 400, 'no_tenant');
  const brand = String(req.query.brand || '').trim().slice(0, 80);
  const cadence = String(req.query.cadence || 'daily');
  const forceNew = req.query.force === '1';
  try {
    const pool = _db.getPool();
    const existing = await pool.query(
      `SELECT * FROM marketing_briefs WHERE tenant_id=$1
       ORDER BY created_at DESC LIMIT 1`, [tid]);
    const last = existing.rows[0];

    if (!forceNew && last && !_shouldGenerate(last, cadence)) {
      return res.json({ ok:true, brief:last, fresh:false });
    }

    const brief = await generateBrief(brand || 'your brand', tid);
    res.json({ ok:true, brief, fresh:true });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/marketing-brief/generate — force regenerate
router.post('/generate', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const tid = await _tid(req, 'brief:generate');
  if (!tid) return _err(res, 400, 'no_tenant');
  const brand = String(req.body?.brand || '').trim().slice(0, 80);
  try {
    const brief = await generateBrief(brand || 'your brand', tid);
    res.json({ ok:true, brief, fresh:true });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /api/marketing-brief/history
router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const tid = await _tid(req, 'brief:history');
  if (!tid) return _err(res, 400, 'no_tenant');
  const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 14));
  try {
    const pool = _db.getPool();
    const r = await pool.query(
      `SELECT id, brand, cadence, headline, greeting, active_pillars, generated_by, delivered_to, created_at
       FROM marketing_briefs WHERE tenant_id=$1
       ORDER BY created_at DESC LIMIT $2`, [tid, limit]);
    res.json({ ok:true, briefs:r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /api/marketing-brief/:id
router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'bad id');
  const tid = await _tid(req, 'brief:get');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const pool = _db.getPool();
    const r = await pool.query(
      `SELECT * FROM marketing_briefs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok:true, brief:r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/marketing-brief/:id/deliver — send to Slack / email
router.post('/:id/deliver', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'bad id');
  const tid = await _tid(req, 'brief:deliver');
  if (!tid) return _err(res, 400, 'no_tenant');
  const channels = Array.isArray(req.body?.channels) ? req.body.channels : ['slack'];
  try {
    const pool = _db.getPool();
    const q = await pool.query(
      `SELECT * FROM marketing_briefs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    const brief = q.rows[0];
    if (!brief) return _err(res, 404, 'not found');
    const delivered = [];

    if (channels.includes('slack') && process.env.SLACK_WEBHOOK_URL) {
      try {
        const actions = (brief.actions || []).slice(0, 5)
          .map((a, i) => `${i+1}. *${a.label}* — ${a.rationale}`)
          .join('\n');
        const text = `*📋 Today's Marketing Brief*\n*${brief.headline}*\n\n${(brief.sections || []).slice(0,3).map(s =>
          `*${s.title}*\n${(s.items||[]).slice(0,3).map(item=>`• ${item}`).join('\n')}`).join('\n\n')}\n\n*Recommended Actions*\n${actions}`;
        await _slackPost(text);
        delivered.push({ channel:'slack', at:new Date().toISOString(), ok:true });
      } catch (e) { delivered.push({ channel:'slack', ok:false, error:e.message }); }
    }

    await pool.query(
      `UPDATE marketing_briefs SET delivered_to = delivered_to || $1::jsonb WHERE id=$2 AND tenant_id=$3`,
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
  const body = JSON.stringify(isDiscord ? { content:text.slice(0,1900) } : { text });
  return new Promise((resolve, reject) => {
    const r = _https.request({
      hostname:u.hostname, path:u.pathname+u.search, method:'POST',
      headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, resp => { resp.on('data', ()=>{}); resp.on('end', () =>
      resp.statusCode < 300 ? resolve() : reject(new Error('slack '+resp.statusCode))); });
    r.on('error', reject);
    r.setTimeout(8000, () => r.destroy(new Error('slack timeout')));
    r.write(body); r.end();
  });
}

// ── Daily cron ──
let _cronTimer = null;
function startCron() {
  if (_cronTimer || !_db.hasDb()) return;
  const tick = async () => {
    if (!_db.hasDb()) return;
    try {
      const pool = _db.getPool();
      const tenants = await pool.query(
        `SELECT DISTINCT t.id, t.name FROM tenants t
         WHERE t.active = TRUE LIMIT 50`);
      for (const tenant of tenants.rows) {
        try {
          const last = await pool.query(
            `SELECT created_at FROM marketing_briefs WHERE tenant_id=$1
             ORDER BY created_at DESC LIMIT 1`, [tenant.id]);
          if (_shouldGenerate(last.rows[0], 'daily')) {
            await generateBrief(tenant.name || 'brand', tenant.id);
          }
        } catch { /* skip failed tenant */ }
      }
    } catch (e) { console.warn('[marketing-brief] cron tick failed:', e.message); }
  };
  _cronTimer = setInterval(tick, 6 * 3600 * 1000); // check every 6h, gate internally
  console.log('[marketing-brief] cron started — 6h check interval');
}

module.exports = router;
module.exports.startCron = startCron;

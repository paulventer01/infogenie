const express = require('express');
const _https = require('https');
const _db = require('../../db');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const VALID_CHANNELS = ['instagram','tiktok','linkedin','x','facebook','youtube','blog','email'];

async function _aiCalendar({ brand, goal, channels, days, audience, tone }) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const sys = `You are a senior content strategist drafting a ${days}-day social content calendar for ${brand}. Return strict JSON:
{"posts":[{"day":1,"date":"YYYY-MM-DD","channel":"instagram|tiktok|linkedin|x|facebook|youtube|blog|email","format":"reel|carousel|short|post|thread|article|video|email","hook":"<8-word scroll-stopper>","copy":"<the full caption / body>","hashtags":["#tag1","#tag2"],"cta":"<single call to action>","best_time":"HH:MM"}]}
Rules:
- Cover exactly ${days} days, dates starting today.
- Distribute across the requested channels (${channels.join(', ')}) — vary the format.
- Tone: ${tone || 'authentic + on-brand'}.
- Each post must be specific and immediately usable — no placeholders, no "[insert here]".
- Hashtags: 3-6, mix of niche + branded + trending.
- Hooks must earn the click — no generic "Excited to share…".`;
  const user = `Brand: ${brand}
Goal: ${goal || 'awareness + engagement'}
Audience: ${audience || 'general consumers'}
Channels: ${channels.join(', ')}
Days: ${days}
Today's date: ${new Date().toISOString().slice(0,10)}

Draft the calendar now.`;
  const body = JSON.stringify({
    model:'gpt-4o-mini',
    messages: [{ role:'system', content: sys }, { role:'user', content: user }],
    response_format: { type:'json_object' },
    temperature: 0.7, max_tokens: 3500,
  });
  return await new Promise((resolve) => {
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d); resolve(JSON.parse(j.choices[0].message.content));
      } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _templateCalendar({ brand, channels, days }) {
  const today = new Date();
  const formats = { instagram:'carousel', tiktok:'short', linkedin:'post', x:'thread', facebook:'post', youtube:'video', blog:'article', email:'email' };
  const posts = [];
  for (let d = 1; d <= days; d++) {
    const date = new Date(today.getTime() + (d-1)*864e5).toISOString().slice(0,10);
    const ch = channels[(d-1) % channels.length];
    posts.push({
      day:d, date, channel:ch, format: formats[ch] || 'post',
      hook: `${brand} day ${d} — what changed this week`,
      copy: `Day ${d} update for ${brand}. Share a behind-the-scenes win, customer story, or product insight. Keep it human.`,
      hashtags: [`#${brand.replace(/\s+/g,'')}`, '#brand', '#marketing'],
      cta: 'Comment below with your take.',
      best_time: ch === 'linkedin' ? '08:30' : ch === 'tiktok' ? '19:00' : '12:00',
    });
  }
  return { posts };
}

router.post('/generate', async (req, res) => {
  const brand = String(req.body?.brand || '').trim().slice(0, 80);
  const goal = String(req.body?.goal || '').slice(0, 300);
  const audience = String(req.body?.audience || '').slice(0, 300);
  const tone = String(req.body?.tone || '').slice(0, 100);
  const days = Math.min(30, Math.max(1, parseInt(req.body?.days, 10) || 7));
  const channels = (Array.isArray(req.body?.channels) ? req.body.channels : ['instagram','linkedin','x'])
    .filter(c => VALID_CHANNELS.includes(c)).slice(0, 6);
  if (!brand) return _err(res, 400, 'brand required');
  if (!channels.length) return _err(res, 400, 'at least one valid channel required');

  let result = await _aiCalendar({ brand, goal, channels, days, audience, tone });
  let source = 'openai';
  if (!result || !Array.isArray(result.posts)) { result = _templateCalendar({ brand, channels, days }); source = 'template'; }
  if (_db.hasDb()) {
    try {
      await _db.getPool().query(
        `INSERT INTO content_calendar_runs (brand, goal, channels, days, posts, generated_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [brand, goal, JSON.stringify(channels), days, JSON.stringify(result.posts), source]);
    } catch (e) { console.warn('[content-calendar] persist failed:', e.message); }
  }
  res.json({ ok:true, source, brand, days, channels, posts: result.posts });
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  try {
    const r = await _db.getPool().query(
      `SELECT id, brand, goal, channels, days, generated_by, created_at FROM content_calendar_runs ORDER BY created_at DESC LIMIT $1`, [limit]);
    res.json({ ok:true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'bad id');
  try {
    const r = await _db.getPool().query(`SELECT * FROM content_calendar_runs WHERE id=$1`, [id]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok:true, run: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;

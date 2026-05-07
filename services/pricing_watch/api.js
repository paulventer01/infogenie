const express = require('express');
const _https = require('https');
const _db = require('../../db');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const URL_RE = /^https?:\/\/[^\s]+$/i;

async function _firecrawlScrape(url) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const body = JSON.stringify({ url, formats:['markdown'], onlyMainContent: true });
  return await new Promise((resolve) => {
    const req = _https.request({
      hostname:'api.firecrawl.dev', path:'/v1/scrape', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d); resolve(j?.data?.markdown || j?.data?.content || null);
      } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(45000, () => req.destroy());
    req.write(body); req.end();
  });
}

async function _aiExtractPrice({ markdown, label }) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const sys = `You extract product pricing from scraped page markdown. Return strict JSON ONLY:
{"product_name":"<the product or service title>","price":<number or null>,"currency":"<USD|EUR|GBP|ZAR|...>","original_price":<number or null if discounted>,"in_stock":<true|false|null>,"promo":"<promo text shown or empty>"}
- Use the most prominent main product price (not shipping, not bundle add-ons).
- price must be a number, no currency symbols.
- If you cannot reliably find a price, return null for it.`;
  const user = `Page label: ${label || 'product page'}\n\nMarkdown:\n${(markdown || '').slice(0, 6000)}\n\nExtract now.`;
  const body = JSON.stringify({
    model:'gpt-4o-mini',
    messages:[{role:'system',content:sys},{role:'user',content:user}],
    response_format:{ type:'json_object' }, temperature:0.1, max_tokens:400,
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
    req.setTimeout(45000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _regexExtractPrice(markdown) {
  const txt = String(markdown || '').slice(0, 8000);
  const m = txt.match(/(?:USD|EUR|GBP|ZAR|R|\$|€|£)\s*([0-9]{1,5}(?:[.,][0-9]{2})?)/);
  if (!m) return null;
  const sym = m[0].match(/USD|EUR|GBP|ZAR|R|\$|€|£/i)?.[0] || '';
  const cur = sym==='$'?'USD':sym==='€'?'EUR':sym==='£'?'GBP':sym==='R'?'ZAR':sym.toUpperCase();
  return { product_name: null, price: parseFloat(m[1].replace(',','.')), currency: cur, original_price: null, in_stock: null, promo: '' };
}

router.get('/targets', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const r = await _db.getPool().query(`
      SELECT t.*, (
        SELECT row_to_json(s) FROM (
          SELECT product_name, price, currency, original_price, in_stock, promo, taken_at
          FROM pricing_watch_snapshots WHERE target_id=t.id ORDER BY taken_at DESC LIMIT 1
        ) s
      ) AS latest,
      (SELECT COUNT(*) FROM pricing_watch_snapshots WHERE target_id=t.id) AS snapshot_count
      FROM pricing_watch_targets t ORDER BY t.created_at DESC`);
    res.json({ ok:true, targets: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/targets', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const label = String(req.body?.label || '').trim().slice(0, 120);
  const url = String(req.body?.url || '').trim().slice(0, 600);
  const competitor = String(req.body?.competitor || '').trim().slice(0, 80);
  if (!label || !url) return _err(res, 400, 'label + url required');
  if (!URL_RE.test(url)) return _err(res, 400, 'url must be http(s)://');
  try {
    const r = await _db.getPool().query(
      `INSERT INTO pricing_watch_targets (label, url, competitor) VALUES ($1,$2,$3)
       ON CONFLICT (url) DO UPDATE SET label=EXCLUDED.label, competitor=EXCLUDED.competitor RETURNING *`,
      [label, url, competitor]);
    res.json({ ok:true, target: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/targets/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  try { await _db.getPool().query(`DELETE FROM pricing_watch_targets WHERE id=$1`, [id]); res.json({ ok:true }); }
  catch (e) { _err(res, 500, e.message); }
});

router.post('/scan/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  try {
    const t = (await _db.getPool().query(`SELECT * FROM pricing_watch_targets WHERE id=$1`, [id])).rows[0];
    if (!t) return _err(res, 404, 'target not found');
    const md = await _firecrawlScrape(t.url);
    if (!md) return _err(res, 502, 'scrape failed (Firecrawl key missing or page blocked)');
    let extract = await _aiExtractPrice({ markdown: md, label: t.label });
    let source = 'openai';
    if (!extract) { extract = _regexExtractPrice(md) || { product_name:null, price:null, currency:null, original_price:null, in_stock:null, promo:'' }; source = 'regex'; }
    const ins = await _db.getPool().query(
      `INSERT INTO pricing_watch_snapshots (target_id, product_name, price, currency, original_price, in_stock, promo, raw_extract)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, extract.product_name || t.label, extract.price, extract.currency, extract.original_price, extract.in_stock, extract.promo || '', JSON.stringify({ source, extract })]);
    res.json({ ok:true, snapshot: ins.rows[0], source });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/snapshots/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  try {
    const r = await _db.getPool().query(
      `SELECT * FROM pricing_watch_snapshots WHERE target_id=$1 ORDER BY taken_at DESC LIMIT $2`, [id, limit]);
    res.json({ ok:true, snapshots: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;

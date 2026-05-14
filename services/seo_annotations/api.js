// SEO Change Annotations — log "what we did" markers (date + note + URLs +
// tags) so the user can overlay them on SERP, on-page audit, and traffic
// charts and answer the question "did our last edit help?".
//
// Charts in the SPA fetch /list?since=…&urls=… and render vertical lines.

const express = require('express');
const router  = express.Router();
const _db     = require('../../db');

const ALLOWED_TAGS = ['content','technical','onpage','backlink','redesign','launch','outage','other'];

async function ensureSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS seo_annotations (
      id SERIAL PRIMARY KEY,
      occurred_at TIMESTAMPTZ NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      tag TEXT DEFAULT 'other',
      urls TEXT[] DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS seo_annot_when ON seo_annotations(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS seo_annot_urls ON seo_annotations USING GIN(urls);
  `);
}
ensureSchema().catch(e => console.error('[seo-annotations] schema:', e.message));

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

router.post('/log', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'database not available');
  try {
    const { title, description = '', tag = 'other', urls = [], occurredAt } = req.body || {};
    if (!title || typeof title !== 'string') return _err(res, 400, 'title required');
    const safeTag = ALLOWED_TAGS.includes(tag) ? tag : 'other';
    const safeUrls = Array.isArray(urls) ? urls.filter(u => typeof u === 'string').slice(0, 50) : [];
    const when = occurredAt ? new Date(occurredAt) : new Date();
    if (Number.isNaN(when.getTime())) return _err(res, 400, 'bad occurredAt');
    const r = await _db.getPool().query(
      `INSERT INTO seo_annotations (occurred_at, title, description, tag, urls)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [when.toISOString(), String(title).slice(0, 200), String(description).slice(0, 2000), safeTag, safeUrls]
    );
    res.json({ ok:true, id: r.rows[0].id });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/list', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, annotations: [] });
  try {
    const since = req.query.since ? new Date(req.query.since) : null;
    const urlFilter = req.query.url ? String(req.query.url) : null;
    const tagFilter = req.query.tag ? String(req.query.tag) : null;
    const cond = []; const args = [];
    if (since && !Number.isNaN(since.getTime())) { args.push(since.toISOString()); cond.push(`occurred_at >= $${args.length}`); }
    if (urlFilter) { args.push(urlFilter); cond.push(`$${args.length} = ANY(urls)`); }
    if (tagFilter && ALLOWED_TAGS.includes(tagFilter)) { args.push(tagFilter); cond.push(`tag = $${args.length}`); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const r = await _db.getPool().query(
      `SELECT id, occurred_at, title, description, tag, urls FROM seo_annotations ${where} ORDER BY occurred_at DESC LIMIT 500`,
      args
    );
    res.json({ ok:true, annotations: r.rows.map(row => ({
      id: row.id, occurredAt: row.occurred_at, title: row.title,
      description: row.description, tag: row.tag, urls: row.urls || [],
    })) });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'database not available');
  try {
    await _db.getPool().query(`DELETE FROM seo_annotations WHERE id=$1`, [Number(req.params.id)]);
    res.json({ ok:true });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/tags', (_req, res) => res.json({ ok:true, tags: ALLOWED_TAGS }));

module.exports = router;

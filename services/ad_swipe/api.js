const express = require('express');
const router = express.Router();
const _db = require('../../db');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[ad-swipe]', e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }

// POST /save — persist an ad from the Ad Library into the swipe file
router.post('/save', _safe(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'database unavailable');
  const b = req.body || {};
  const source = String(b.source || 'meta').slice(0, 32);
  const advertiser = String(b.advertiser || b.page_name || '').slice(0, 200);
  if (!advertiser) return _err(res, 400, 'advertiser required');
  const external_id = b.external_id ? String(b.external_id).slice(0, 120) : null;
  const headline = String(b.headline || b.title || '').slice(0, 500);
  const body = String(b.body || '').slice(0, 4000);
  const cta = String(b.cta || b.description || '').slice(0, 200);
  let snapshot_url = String(b.snapshot_url || '').slice(0, 2000).trim();
  if (snapshot_url && !/^https?:\/\//i.test(snapshot_url)) snapshot_url = '';
  const platforms = Array.isArray(b.platforms) ? b.platforms.slice(0, 8) : [];
  const tags = Array.isArray(b.tags) ? b.tags.slice(0, 12).map(t => String(t).slice(0, 40)) : [];
  const notes = String(b.notes || '').slice(0, 1000);
  const score = Math.max(0, Math.min(10, parseInt(b.score, 10) || 0));
  try {
    const r = await _db.getPool().query(
      `INSERT INTO ad_swipe (source, external_id, advertiser, headline, body, cta, snapshot_url, platforms, tags, notes, score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET advertiser=EXCLUDED.advertiser, headline=EXCLUDED.headline, body=EXCLUDED.body,
                     cta=EXCLUDED.cta, snapshot_url=EXCLUDED.snapshot_url, platforms=EXCLUDED.platforms,
                     tags=EXCLUDED.tags, notes=EXCLUDED.notes, score=EXCLUDED.score
       RETURNING id, saved_at`,
      [source, external_id, advertiser, headline, body, cta, snapshot_url, JSON.stringify(platforms), JSON.stringify(tags), notes, score]
    );
    res.json({ ok:true, id: r.rows[0].id, saved_at: r.rows[0].saved_at });
  } catch (e) { _err(res, 500, e.message); }
}));

// GET /list — paginated swipe file with optional tag/advertiser filter
router.get('/list', _safe(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, items: [] });
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
  const tag = req.query.tag ? String(req.query.tag).slice(0, 40) : null;
  const advertiser = req.query.advertiser ? String(req.query.advertiser).slice(0, 200) : null;
  let sql = `SELECT id, source, external_id, advertiser, headline, body, cta, snapshot_url, platforms, tags, notes, score, saved_at FROM ad_swipe WHERE 1=1`;
  const params = [];
  if (advertiser) { params.push(advertiser); sql += ` AND advertiser ILIKE '%' || $${params.length} || '%'`; }
  if (tag)        { params.push(JSON.stringify([tag])); sql += ` AND tags @> $${params.length}::jsonb`; }
  params.push(limit);
  sql += ` ORDER BY score DESC, saved_at DESC LIMIT $${params.length}`;
  const r = await _db.getPool().query(sql, params);
  res.json({ ok:true, items: r.rows });
}));

// POST /:id/update — update tags/notes/score
router.post('/:id/update', _safe(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'database unavailable');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  const b = req.body || {};
  const tags = Array.isArray(b.tags) ? b.tags.slice(0, 12).map(t => String(t).slice(0, 40)) : null;
  const notes = b.notes !== undefined ? String(b.notes).slice(0, 1000) : null;
  const score = b.score !== undefined ? Math.max(0, Math.min(10, parseInt(b.score, 10) || 0)) : null;
  const sets = []; const params = [];
  if (tags !== null)  { params.push(JSON.stringify(tags));  sets.push(`tags=$${params.length}::jsonb`); }
  if (notes !== null) { params.push(notes);  sets.push(`notes=$${params.length}`); }
  if (score !== null) { params.push(score);  sets.push(`score=$${params.length}`); }
  if (!sets.length) return _err(res, 400, 'nothing to update');
  params.push(id);
  await _db.getPool().query(`UPDATE ad_swipe SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
  res.json({ ok:true });
}));

// DELETE /:id
router.delete('/:id', _safe(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'database unavailable');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  await _db.getPool().query('DELETE FROM ad_swipe WHERE id=$1', [id]);
  res.json({ ok:true });
}));

// GET /tags — distinct tag list (for filter UI)
router.get('/tags', _safe(async (_req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, tags: [] });
  const r = await _db.getPool().query(`SELECT DISTINCT jsonb_array_elements_text(tags) AS tag FROM ad_swipe ORDER BY tag`);
  res.json({ ok:true, tags: r.rows.map(x => x.tag) });
}));

module.exports = router;

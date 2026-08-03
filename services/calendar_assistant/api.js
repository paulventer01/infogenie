const express = require('express');
const crypto = require('crypto');
const OpenAI = require('openai');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { buildAgenda, detectConflicts, findFreeSlots } = require('./agenda');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[calendar-assistant]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'calendar_assistant_error' });
    }
  };
}

function _hasOpenAI() {
  const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  return !!(k && !/^_DUMMY/i.test(k));
}

function _openai() {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
  });
}

async function _loadAgenda(tid, from, to) {
  if (!_db.hasDb() || tid == null) return [];
  const p = _db.getPool();
  const brandConds = ['tenant_id = $1'];
  const brandParams = [tid];
  if (from) { brandParams.push(from); brandConds.push(`scheduled_at >= $${brandParams.length}`); }
  if (to) { brandParams.push(to); brandConds.push(`scheduled_at <= $${brandParams.length}`); }

  const [brand, content] = await Promise.all([
    p.query(
      `SELECT * FROM brand_calendar_items WHERE ${brandConds.join(' AND ')} ORDER BY scheduled_at ASC LIMIT 500`,
      brandParams,
    ).catch(() => ({ rows: [] })),
    p.query(
      `SELECT id, brand, channels, posts, created_at FROM content_calendar_runs
       WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [tid],
    ).catch(() => ({ rows: [] })),
  ]);

  return buildAgenda({
    brandItems: brand.rows,
    contentRuns: content.rows,
    from,
    to,
  });
}

async function _persistRun(tid, kind, input, result) {
  if (!_db.hasDb() || tid == null) return;
  const id = 'ca_' + crypto.randomBytes(6).toString('hex');
  try {
    await _db.getPool().query(
      `INSERT INTO calendar_assistant_runs (id, tenant_id, kind, input, result) VALUES ($1,$2,$3,$4,$5)`,
      [id, tid, kind, JSON.stringify(input || {}), JSON.stringify(result || {})],
    );
  } catch (e) {
    console.warn('[calendar-assistant] persist failed:', e.message);
  }
  return id;
}

router.get('/agenda', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'calendar-assistant:agenda' });
  const from = req.query.from || new Date().toISOString();
  const to = req.query.to || new Date(Date.now() + 21 * 864e5).toISOString();
  const events = await _loadAgenda(tid, from, to);
  const conflictReport = detectConflicts(events);
  res.json({
    ok: true,
    from,
    to,
    events,
    count: events.length,
    healthScore: conflictReport.healthScore,
    conflictSummary: {
      overlaps: conflictReport.overlapCount,
      duplicates: conflictReport.duplicateCount,
      busyDays: conflictReport.busyDayCount,
    },
  });
}));

router.get('/conflicts', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'calendar-assistant:conflicts' });
  const from = req.query.from || new Date().toISOString();
  const to = req.query.to || new Date(Date.now() + 21 * 864e5).toISOString();
  const events = await _loadAgenda(tid, from, to);
  const report = detectConflicts(events);
  res.json({ ok: true, from, to, eventCount: events.length, ...report });
}));

router.post('/suggest', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'calendar-assistant:suggest' });
  const title = String(req.body?.title || '').trim();
  const category = String(req.body?.category || 'mine').trim();
  const durationMins = Math.min(240, Math.max(15, parseInt(req.body?.duration_mins, 10) || 60));
  const notes = String(req.body?.notes || '').trim();
  if (!title) return _err(res, 400, 'title required');

  const from = req.body?.from || new Date().toISOString();
  const to = req.body?.to || new Date(Date.now() + 14 * 864e5).toISOString();
  const events = await _loadAgenda(tid, from, to);
  const freeSlots = findFreeSlots(events, { from, to, durationMins, maxSlots: 10 });

  let aiPicks = null;
  if (_hasOpenAI() && freeSlots.length) {
    try {
      const client = _openai();
      const prompt = `You are a marketing calendar scheduler for InfoGenie.
Existing agenda (next window): ${JSON.stringify(events.slice(0, 40).map((e) => ({ title: e.title, start: e.start, category: e.category, source: e.source })))}
Free candidate slots: ${JSON.stringify(freeSlots)}
Schedule this item: title=${JSON.stringify(title)}, category=${category}, durationMins=${durationMins}, notes=${JSON.stringify(notes)}

Return strict JSON:
{"picks":[{"start":"ISO","end":"ISO","score":0-100,"reason":"why this slot"},...],
 "summary":"1-2 sentence recommendation"}
Pick up to 3 slots from the free candidates only. Prefer mid-week mornings for content/ads, afternoons for meetings/mine.`;
      const r = await client.chat.completions.create({
        model: 'gpt-5-mini',
        temperature: 0.3,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Return valid JSON only.' },
          { role: 'user', content: prompt },
        ],
      });
      aiPicks = JSON.parse(r.choices[0].message.content);
    } catch (e) {
      console.warn('[calendar-assistant] AI suggest failed:', e.message);
    }
  }

  const picks = Array.isArray(aiPicks?.picks) && aiPicks.picks.length
    ? aiPicks.picks
    : freeSlots.slice(0, 3).map((s, i) => ({
      start: s.start,
      end: s.end,
      score: 90 - i * 10,
      reason: s.reason,
    }));

  const result = {
    title,
    category,
    durationMins,
    freeSlots,
    picks,
    summary: aiPicks?.summary || (picks[0]
      ? `Best open slot: ${new Date(picks[0].start).toLocaleString()}`
      : 'No free slots in the selected window — widen the date range.'),
    source: aiPicks ? 'openai' : 'rules',
  };

  await _persistRun(tid, 'suggest', { title, category, durationMins, from, to }, result);
  res.json({ ok: true, ...result });
}));

router.post('/resolve', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'calendar-assistant:resolve' });
  const from = req.body?.from || new Date().toISOString();
  const to = req.body?.to || new Date(Date.now() + 21 * 864e5).toISOString();
  const events = await _loadAgenda(tid, from, to);
  const report = detectConflicts(events);
  const overlaps = report.conflicts.filter((c) => c.type === 'overlap');

  if (!overlaps.length) {
    return res.json({
      ok: true,
      resolutions: [],
      summary: 'No time overlaps — calendars look clear.',
      healthScore: report.healthScore,
    });
  }

  const freeSlots = findFreeSlots(events, { from, to, durationMins: 60, maxSlots: 20 });
  let resolutions = [];

  if (_hasOpenAI()) {
    try {
      const client = _openai();
      const prompt = `You resolve marketing calendar conflicts.
Overlaps: ${JSON.stringify(overlaps.slice(0, 12).map((c) => ({
        message: c.message,
        a: { id: c.events[0].id, title: c.events[0].title, start: c.events[0].start, source: c.events[0].source, category: c.events[0].category },
        b: { id: c.events[1].id, title: c.events[1].title, start: c.events[1].start, source: c.events[1].source, category: c.events[1].category },
      })))}
Free slots: ${JSON.stringify(freeSlots.slice(0, 12))}

Return strict JSON:
{"resolutions":[{"conflictId":"...","moveEventId":"...","newStart":"ISO","newEnd":"ISO","reason":"..."}],
 "summary":"brief plan"}
Prefer moving content/social items over brand events. Prefer brand-calendar items (source=brand) when a move is needed — content items are from generation runs and harder to rewrite.`;
      const r = await client.chat.completions.create({
        model: 'gpt-5-mini',
        temperature: 0.2,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Return valid JSON only.' },
          { role: 'user', content: prompt },
        ],
      });
      const parsed = JSON.parse(r.choices[0].message.content);
      resolutions = Array.isArray(parsed.resolutions) ? parsed.resolutions : [];
      var aiSummary = parsed.summary;
    } catch (e) {
      console.warn('[calendar-assistant] AI resolve failed:', e.message);
    }
  }

  if (!resolutions.length) {
    // Rule-based: move the second event in each overlap to the next free slot
    const used = new Set();
    resolutions = overlaps.slice(0, 8).map((c, i) => {
      const move = c.events[1].source === 'brand' ? c.events[1] : (c.events[0].source === 'brand' ? c.events[0] : c.events[1]);
      const slot = freeSlots.find((s) => !used.has(s.start));
      if (slot) used.add(slot.start);
      return {
        conflictId: c.id,
        moveEventId: move.id,
        moveTitle: move.title,
        currentStart: move.start,
        newStart: slot?.start || null,
        newEnd: slot?.end || null,
        reason: slot
          ? `Move "${move.title}" to next free window to clear overlap`
          : 'No free slot available — widen date range',
        canApply: !!(slot && move.source === 'brand'),
        source: move.source,
      };
    });
  } else {
    resolutions = resolutions.map((r) => {
      const ev = events.find((e) => e.id === r.moveEventId);
      return {
        ...r,
        moveTitle: ev?.title || r.moveEventId,
        currentStart: ev?.start,
        canApply: !!(ev && ev.source === 'brand' && r.newStart),
        source: ev?.source,
      };
    });
  }

  const result = {
    resolutions,
    summary: typeof aiSummary !== 'undefined' && aiSummary
      ? aiSummary
      : `Proposed ${resolutions.filter((r) => r.newStart).length} move(s) to clear overlaps.`,
    healthScore: report.healthScore,
    overlapCount: report.overlapCount,
  };
  await _persistRun(tid, 'resolve', { from, to }, result);
  res.json({ ok: true, ...result });
}));

router.post('/apply', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'calendar-assistant:apply' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');

  const eventId = String(req.body?.event_id || '').trim();
  const newStart = String(req.body?.new_start || req.body?.scheduled_at || '').trim();
  const title = String(req.body?.title || '').trim();
  const category = String(req.body?.category || 'mine').trim();
  const notes = String(req.body?.notes || '').trim();

  // Create new brand item from a suggest pick
  if (!eventId && title && newStart) {
    const id = 'bcal_' + crypto.randomBytes(5).toString('hex');
    await _db.getPool().query(
      `INSERT INTO brand_calendar_items (id,tenant_id,category,title,scheduled_at,notes,status)
       VALUES ($1,$2,$3,$4,$5,$6,'planned')`,
      [id, tid, category, title, newStart, notes || 'Scheduled via Calendar Assistant'],
    );
    return res.json({ ok: true, id, action: 'created' });
  }

  // Reschedule existing brand calendar item
  if (!eventId || !newStart) return _err(res, 400, 'event_id and new_start required (or title + new_start to create)');
  if (!String(eventId).startsWith('bcal_') && !/^[a-z0-9_]+$/i.test(eventId)) {
    // content-calendar generated ids cannot be moved in brand table
  }
  const r = await _db.getPool().query(
    `UPDATE brand_calendar_items SET scheduled_at=$1
     WHERE id=$2 AND tenant_id=$3 RETURNING id, title, scheduled_at, category`,
    [newStart, eventId, tid],
  );
  if (!r.rows.length) {
    return _err(res, 404, 'Brand calendar item not found — content-calendar posts must be regenerated or added to Brand Calendar first');
  }
  res.json({ ok: true, action: 'moved', item: r.rows[0] });
}));

router.get('/status', _route(async (req, res) => {
  res.json({ ok: true, openai: _hasOpenAI() });
}));

module.exports = router;

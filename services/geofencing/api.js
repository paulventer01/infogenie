const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();

function _err(res, code, msg) {
  res.status(code).json({ ok: false, error: msg });
}

async function _tid(req, label) {
  return _tenantCtx.resolveTenantId(req, { label });
}

/**
 * Haversine formula to calculate distance between two points in meters.
 */
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// GET /api/geofencing/fences
router.get('/fences', async (req, res) => {
  const tid = await _tid(req, 'geofencing:list');
  if (!tid) return _err(res, 400, 'no_tenant');

  try {
    const p = await _db.getPool();
    const rows = await p.query(
      'SELECT * FROM geofences WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tid]
    );
    res.json({ ok: true, fences: rows.rows });
  } catch (err) {
    _err(res, 500, err.message);
  }
});

// POST /api/geofencing/fences
router.post('/fences', async (req, res) => {
  const tid = await _tid(req, 'geofencing:create');
  if (!tid) return _err(res, 400, 'no_tenant');

  const { name, lat, lng, radius_meters, channel, message_template } = req.body || {};
  if (!name || lat === undefined || lng === undefined || !channel || !message_template) {
    return _err(res, 400, 'missing fields');
  }

  try {
    const p = await _db.getPool();
    const result = await p.query(
      `INSERT INTO geofences (tenant_id, name, lat, lng, radius_meters, channel, message_template)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tid, name, lat, lng, radius_meters || 200, channel, message_template]
    );
    res.json({ ok: true, fence: result.rows[0] });
  } catch (err) {
    _err(res, 500, err.message);
  }
});

// PUT /api/geofencing/fences/:id
router.put('/fences/:id', async (req, res) => {
  const tid = await _tid(req, 'geofencing:update');
  if (!tid) return _err(res, 400, 'no_tenant');

  const { name, lat, lng, radius_meters, channel, message_template, active } = req.body || {};
  
  try {
    const p = await _db.getPool();
    const result = await p.query(
      `UPDATE geofences 
       SET name = COALESCE($1, name),
           lat = COALESCE($2, lat),
           lng = COALESCE($3, lng),
           radius_meters = COALESCE($4, radius_meters),
           channel = COALESCE($5, channel),
           message_template = COALESCE($6, message_template),
           active = COALESCE($7, active)
       WHERE id = $8 AND tenant_id = $9
       RETURNING *`,
      [name, lat, lng, radius_meters, channel, message_template, active, req.params.id, tid]
    );
    
    if (result.rows.length === 0) return _err(res, 404, 'not found');
    res.json({ ok: true, fence: result.rows[0] });
  } catch (err) {
    _err(res, 500, err.message);
  }
});

// DELETE /api/geofencing/fences/:id
router.delete('/fences/:id', async (req, res) => {
  const tid = await _tid(req, 'geofencing:delete');
  if (!tid) return _err(res, 400, 'no_tenant');

  try {
    const p = await _db.getPool();
    const result = await p.query(
      'DELETE FROM geofences WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, tid]
    );
    if (result.rows.length === 0) return _err(res, 404, 'not found');
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    _err(res, 500, err.message);
  }
});

// GET /api/geofencing/events
router.get('/events', async (req, res) => {
  const tid = await _tid(req, 'geofencing:events');
  if (!tid) return _err(res, 400, 'no_tenant');

  try {
    const p = await _db.getPool();
    const rows = await p.query(
      `SELECT e.*, f.name as geofence_name 
       FROM geofence_events e
       LEFT JOIN geofences f ON e.geofence_id = f.id
       WHERE e.tenant_id = $1 
       ORDER BY e.triggered_at DESC 
       LIMIT 100`,
      [tid]
    );
    res.json({ ok: true, events: rows.rows });
  } catch (err) {
    _err(res, 500, err.message);
  }
});

// POST /api/geofencing/check-in
router.post('/check-in', async (req, res) => {
  const tid = await _tid(req, 'geofencing:check-in');
  if (!tid) return _err(res, 400, 'no_tenant');

  const { lat, lng, contact_email, contact_phone } = req.body || {};
  if (lat === undefined || lng === undefined) return _err(res, 400, 'missing lat/lng');

  try {
    const p = await _db.getPool();
    const fences = await p.query(
      'SELECT * FROM geofences WHERE tenant_id = $1 AND active = true',
      [tid]
    );

    const triggered = [];
    for (const fence of fences.rows) {
      const dist = getDistanceMeters(lat, lng, fence.lat, fence.lng);
      if (dist <= fence.radius_meters) {
        // Render message (simple replacement for now)
        const body = fence.message_template
          .replace(/{{contact_email}}/g, contact_email || '')
          .replace(/{{contact_phone}}/g, contact_phone || '');
        
        // Mock send logic mirroring smart_send node
        let delivery_status = 'skipped:no-provider';
        if (fence.channel === 'email' && process.env.RESEND_API_KEY && contact_email) {
          // In a real app, we'd call Resend here
          delivery_status = 'sent';
        } else if (fence.channel === 'sms' && contact_phone) {
          // In a real app, we'd call Twilio/Vonage here
          delivery_status = 'sent';
        }

        const ins = await p.query(
          `INSERT INTO geofence_events (tenant_id, geofence_id, contact_email, contact_phone, lat, lng, distance_meters, delivery_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [tid, fence.id, contact_email, contact_phone, lat, lng, dist, delivery_status]
        );
        
        triggered.push({
          fence_id: fence.id,
          fence_name: fence.name,
          distance: dist,
          delivery_status,
          message: body
        });
      }
    }

    res.json({ ok: true, triggered_count: triggered.length, triggered });
  } catch (err) {
    _err(res, 500, err.message);
  }
});

module.exports = router;

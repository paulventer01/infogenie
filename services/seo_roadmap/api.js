'use strict';
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const KV_KEY = (tid) => `seo_roadmap_progress_${tid}`;

router.get('/progress', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'seo-roadmap:get' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const r = await _db.query('SELECT value FROM kv_store WHERE key=$1', [KV_KEY(tid)]);
    const progress = r.rows[0] ? JSON.parse(r.rows[0].value) : {};
    res.json({ progress });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/progress', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'seo-roadmap:set' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { stepId, status } = req.body;
    if (!stepId || !['todo','in_progress','done'].includes(status))
      return res.status(400).json({ error: 'bad_params' });

    const r = await _db.query('SELECT value FROM kv_store WHERE key=$1', [KV_KEY(tid)]);
    const progress = r.rows[0] ? JSON.parse(r.rows[0].value) : {};
    progress[stepId] = { status, updatedAt: new Date().toISOString() };

    await _db.query(
      `INSERT INTO kv_store (key,value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
      [KV_KEY(tid), JSON.stringify(progress)]
    );
    res.json({ ok: true, progress });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

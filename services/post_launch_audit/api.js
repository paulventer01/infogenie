const express = require('express');
const https   = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

// GET /api/post-launch-audit/audits
router.get('/audits', async (req, res) => {
  const tid = await _tid(req, 'audit:list');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      `SELECT a.*,
         json_agg(json_build_object('check_type',c.check_type,'status',c.status,'details',c.details,'run_at',c.run_at)
           ORDER BY c.id) AS checks
       FROM post_launch_audits a
       LEFT JOIN post_launch_checks c ON c.audit_id = a.id AND c.tenant_id = $1
       WHERE a.tenant_id=$1 GROUP BY a.id ORDER BY a.created_at DESC LIMIT 50`,
      [tid]
    );
    res.json({ ok: true, audits: rows });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/post-launch-audit/audits
router.post('/audits', async (req, res) => {
  const tid = await _tid(req, 'audit:create');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { campaign_name, platform, campaign_id, audit_window } = req.body || {};
  if (!campaign_name) return _err(res, 400, 'campaign_name required');
  const win = ['24h','48h'].includes(audit_window) ? audit_window : '48h';
  const scheduledFor = new Date(Date.now() + (win === '24h' ? 86400000 : 172800000));
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      `INSERT INTO post_launch_audits (tenant_id,campaign_name,platform,campaign_id,audit_window,scheduled_for)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tid, campaign_name, platform||'meta', campaign_id||null, win, scheduledFor]
    );
    const audit = rows[0];
    // Seed pending check slots — stamp the resolved tenant, never body.tenant_id.
    for (const ct of ['live_data','lead_flow','spend','impressions']) {
      await p.query(
        'INSERT INTO post_launch_checks (tenant_id,audit_id,check_type,status) VALUES ($1,$2,$3,$4)',
        [tid, audit.id, ct, 'pending']
      );
    }
    res.json({ ok: true, audit });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /api/post-launch-audit/audits/:id
router.get('/audits/:id', async (req, res) => {
  const tid = await _tid(req, 'audit:get');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      'SELECT * FROM post_launch_audits WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]
    );
    if (!rows.length) return _err(res, 404, 'not_found');
    const { rows: checks } = await p.query(
      'SELECT * FROM post_launch_checks WHERE audit_id=$1 AND tenant_id=$2 ORDER BY id', [rows[0].id, tid]
    );
    res.json({ ok: true, audit: { ...rows[0], checks } });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/post-launch-audit/audits/:id/run-live-check
router.post('/audits/:id/run-live-check', async (req, res) => {
  const tid = await _tid(req, 'audit:live-check');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      'SELECT * FROM post_launch_audits WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]
    );
    if (!rows.length) return _err(res, 404, 'not_found');
    const audit = rows[0];

    // Query our ad_campaigns data for this campaign
    let campaignData = null;
    try {
      const { rows: camps } = await p.query(
        `SELECT * FROM ad_campaigns WHERE tenant_id=$1 AND platform=$2
         ${audit.campaign_id ? 'AND id=$3' : ''}
         ORDER BY created_at DESC LIMIT 5`,
        audit.campaign_id ? [tid, audit.platform, audit.campaign_id] : [tid, audit.platform]
      );
      campaignData = camps;
    } catch { campaignData = []; }

    const launchedHoursAgo = (Date.now() - new Date(audit.created_at)) / 3600000;
    const issues = [];
    let liveStatus = 'pass';

    if (!campaignData || campaignData.length === 0) {
      issues.push('No campaign data found in InfoGenie — ensure the campaign is linked.');
      liveStatus = 'fail';
    } else {
      for (const c of campaignData) {
        const spend = Number(c.total_spend || 0);
        const impressions = Number(c.impressions || 0);
        const status = c.status;

        if (status === 'paused' || status === 'stopped') {
          issues.push(`Campaign "${c.name || c.id}" is ${status} — expected active.`);
          liveStatus = 'fail';
        }
        if (launchedHoursAgo > 4 && spend === 0) {
          issues.push(`Campaign "${c.name || c.id}" has £0 spend after ${Math.round(launchedHoursAgo)}h — check platform for warnings.`);
          liveStatus = 'fail';
        }
        if (launchedHoursAgo > 6 && impressions === 0) {
          issues.push(`Campaign "${c.name || c.id}" has 0 impressions — ad may be in review or audience too narrow.`);
          if (liveStatus !== 'fail') liveStatus = 'fail';
        }
      }
    }

    const details = {
      campaigns_found: campaignData?.length || 0,
      hours_since_launch: Math.round(launchedHoursAgo * 10) / 10,
      issues,
      campaigns: campaignData?.map(c => ({
        id: c.id, name: c.name, platform: c.platform, status: c.status,
        spend: c.total_spend, impressions: c.impressions, daily_budget: c.daily_budget,
      })) || [],
    };

    await p.query(
      `UPDATE post_launch_checks SET status=$1,details=$2,run_at=NOW()
       WHERE audit_id=$3 AND tenant_id=$4 AND check_type IN ('live_data','spend','impressions')`,
      [liveStatus, JSON.stringify(details), audit.id, tid]
    );
    await _updateAuditStatus(p, audit.id, tid);
    res.json({ ok: true, status: liveStatus, details });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/post-launch-audit/audits/:id/run-lead-flow
router.post('/audits/:id/run-lead-flow', async (req, res) => {
  const tid = await _tid(req, 'audit:lead-flow');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      'SELECT * FROM post_launch_audits WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]
    );
    if (!rows.length) return _err(res, 404, 'not_found');
    const audit = rows[0];

    const testEmail = `infogenie-test-${Date.now()}@infogenie-audit.internal`;
    let flowStatus = 'pending';
    let details = { test_email: testEmail, steps: [] };

    const hubspotToken = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    if (!hubspotToken) {
      flowStatus = 'na';
      details.steps.push({ step: 'HubSpot connection', result: 'skipped', note: 'HUBSPOT_PRIVATE_APP_TOKEN not configured — connect HubSpot to enable automated lead flow verification.' });
    } else {
      // Step 1: Create test contact in HubSpot
      let contactId = null;
      try {
        const createBody = JSON.stringify({
          properties: { email: testEmail, firstname: 'InfoGenie', lastname: 'AuditTest', company: 'InfoGenie Audit Bot' },
        });
        const createResult = await _hubspotPost('/crm/v3/objects/contacts', createBody, hubspotToken);
        if (createResult.ok) {
          contactId = createResult.body?.id;
          details.steps.push({ step: 'Create test contact in HubSpot', result: 'pass', contact_id: contactId });
        } else {
          details.steps.push({ step: 'Create test contact in HubSpot', result: 'fail', error: createResult.body?.message || 'Creation failed' });
          flowStatus = 'fail';
        }
      } catch (e) {
        details.steps.push({ step: 'Create test contact in HubSpot', result: 'fail', error: e.message });
        flowStatus = 'fail';
      }

      // Step 2: Verify contact appears in HubSpot search
      if (contactId) {
        try {
          await new Promise(r => setTimeout(r, 1500)); // brief wait for indexing
          const searchBody = JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: testEmail }] }], limit: 1 });
          const searchResult = await _hubspotPost('/crm/v3/objects/contacts/search', searchBody, hubspotToken);
          const found = searchResult.body?.total > 0;
          details.steps.push({ step: 'Verify contact visible in CRM', result: found ? 'pass' : 'fail', total: searchResult.body?.total });
          if (!found) flowStatus = 'fail';
        } catch (e) {
          details.steps.push({ step: 'Verify contact visible in CRM', result: 'fail', error: e.message });
          flowStatus = 'fail';
        }

        // Step 3: Clean up test contact
        try {
          await _hubspotDelete(`/crm/v3/objects/contacts/${contactId}`, hubspotToken);
          details.steps.push({ step: 'Delete test contact (cleanup)', result: 'pass' });
        } catch {
          details.steps.push({ step: 'Delete test contact (cleanup)', result: 'skipped' });
        }

        if (flowStatus === 'pending') flowStatus = 'pass';
      }
    }

    await p.query(
      'UPDATE post_launch_checks SET status=$1,details=$2,run_at=NOW() WHERE audit_id=$3 AND tenant_id=$4 AND check_type=$5',
      [flowStatus, JSON.stringify(details), audit.id, tid, 'lead_flow']
    );
    await _updateAuditStatus(p, audit.id, tid);
    res.json({ ok: true, status: flowStatus, details });
  } catch (e) { _err(res, 500, e.message); }
});

// DELETE /api/post-launch-audit/audits/:id
router.delete('/audits/:id', async (req, res) => {
  const tid = await _tid(req, 'audit:delete');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    await p.query('DELETE FROM post_launch_audits WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function _updateAuditStatus(p, auditId, tid) {
  const { rows } = await p.query(
    'SELECT status FROM post_launch_checks WHERE audit_id=$1 AND tenant_id=$2', [auditId, tid]
  );
  const statuses = rows.map(r => r.status);
  let overall = 'passed';
  if (statuses.some(s => s === 'fail')) overall = 'failed';
  else if (statuses.some(s => s === 'pending')) overall = 'in_progress';
  await p.query(
    'UPDATE post_launch_audits SET overall_result=$1,status=$2,updated_at=NOW() WHERE id=$3 AND tenant_id=$4',
    [overall, overall, auditId, tid]
  );
}

function _hubspotPost(path, body, token) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.hubapi.com',
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, (r) => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => {
        try { resolve({ ok: r.statusCode < 300, statusCode: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ ok: false, statusCode: r.statusCode, body: d }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

function _hubspotDelete(path, token) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.hubapi.com',
      path,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    };
    const req = https.request(opts, r => { r.resume(); resolve({ ok: r.statusCode < 300 }); });
    req.on('error', () => resolve({ ok: false }));
    req.end();
  });
}

module.exports = router;

const express = require('express');
const _tenantCtx = require('../tenants/context');
const { normDomain, queryJourneyStatus } = require('./journey');

const router = express.Router();

function _err(res, code, msg) {
  res.status(code).json({ ok: false, error: msg });
}

router.get('/journey-status', async (req, res) => {
  const domain = normDomain(req.query.domain || req.query.url || '');
  if (!domain) return _err(res, 400, 'domain query param required');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'company_overview:journey' });
    const status = await queryJourneyStatus(tid, domain);
    res.json({ ok: true, domain, status });
  } catch (e) {
    _err(res, 500, e.message || 'journey status failed');
  }
});

module.exports = router;

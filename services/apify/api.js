const express  = require('express');
const _https   = require('https');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[apify]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}
function _hasApify() {
  const k = process.env.APIFY_API_KEY;
  return k && !/^_DUMMY/i.test(k);
}

// ── Apify REST helpers ─────────────────────────────────────────────────────
function _apifyReq(path, method, body) {
  const key = process.env.APIFY_API_KEY;
  const sep = path.includes('?') ? '&' : '?';
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.apify.com',
      path: `${path}${sep}token=${key}`,
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = _https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Apify request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

async function _startRun(actorId, input) {
  const body = JSON.stringify(input);
  const res = await _apifyReq(`/v2/acts/${actorId}/runs`, 'POST', body);
  if (res.error) throw new Error(res.error.message || JSON.stringify(res.error));
  if (!res.data?.id) throw new Error('No run ID returned by Apify');
  return res.data;
}

async function _pollRun(runId) {
  const res = await _apifyReq(`/v2/actor-runs/${runId}`, 'GET');
  if (res.error) throw new Error(res.error.message || JSON.stringify(res.error));
  return res.data;
}

async function _getItems(datasetId, limit) {
  const res = await _apifyReq(
    `/v2/datasets/${datasetId}/items?format=json&limit=${limit || 25}&clean=true`,
    'GET'
  );
  return Array.isArray(res) ? res : [];
}

// ── TikTok Organic Social Monitor ─────────────────────────────────────────
router.post('/tiktok-organic', _safeAsync(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'apify:tiktok-organic' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_hasApify()) return _err(res, 503, 'APIFY_API_KEY required — add it in Settings → Integrations');
  const { keyword, limit = 20 } = req.body;
  if (!keyword) return _err(res, 400, 'keyword required');
  const run = await _startRun('clockworks~tiktok-scraper', {
    searchQueries: [String(keyword).slice(0, 100)],
    searchSection: 'videos',
    maxVideos: Math.min(50, Math.max(5, parseInt(limit) || 20)),
    shouldDownloadCovers: false,
    shouldDownloadVideos: false,
    shouldDownloadSubtitles: false,
  });
  res.json({ ok: true, run_id: run.id, dataset_id: run.defaultDatasetId, status: run.status });
}));

// ── Google Maps Local Lead Finder ──────────────────────────────────────────
router.post('/maps-leads', _safeAsync(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'apify:maps-leads' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_hasApify()) return _err(res, 503, 'APIFY_API_KEY required — add it in Settings → Integrations');
  const { query, limit = 20 } = req.body;
  if (!query) return _err(res, 400, 'query required (e.g. "dentists in Miami FL")');
  const run = await _startRun('compass~crawler-google-places', {
    searchStringsArray: [String(query).slice(0, 200)],
    maxCrawledPlaces: Math.min(50, Math.max(5, parseInt(limit) || 20)),
    language: 'en',
    exportPlaceUrls: false,
    includeHistogram: false,
    includeOpeningHours: true,
    includePeopleAlsoSearch: false,
    additionalInfo: false,
  });
  res.json({ ok: true, run_id: run.id, dataset_id: run.defaultDatasetId, status: run.status });
}));

// ── Poll run + return items when done ──────────────────────────────────────
router.get('/run-status', _safeAsync(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'apify:run-status' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_hasApify()) return _err(res, 503, 'No APIFY_API_KEY');
  const { run_id, dataset_id, limit = 25 } = req.query;
  if (!run_id) return _err(res, 400, 'run_id required');
  const run = await _pollRun(run_id);
  const terminal = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'];
  if (!terminal.includes(run.status)) {
    return res.json({ status: 'pending', apify_status: run.status, stats: run.stats || {} });
  }
  if (run.status !== 'SUCCEEDED') {
    return res.json({ status: 'failed', error: `Apify run ended with status: ${run.status}` });
  }
  const dsId = dataset_id || run.defaultDatasetId;
  if (!dsId) return res.json({ status: 'complete', items: [] });
  const items = await _getItems(dsId, parseInt(limit) || 25);
  res.json({ status: 'complete', items });
}));

module.exports = router;

const express = require('express');
const _tenantCtx = require('../tenants/context');
const { fetchSource, SOURCES } = require('./data_sources');
const { streamPptx } = require('./pptx_report');
const { streamXlsx } = require('./xlsx_report');
const { streamPdf }  = require('./pdf_report');

const router = express.Router();

// Lazy require to avoid circular load order: white_label is mounted later.
async function _loadBrand() {
  try {
    const wl = require('../white_label/api');
    if (wl && typeof wl.getBrand === 'function') {
      const b = await wl.getBrand();
      return (b && b.enabled) ? b : null;
    }
  } catch {}
  return null;
}

router.get('/sources', (req, res) => {
  res.json({ ok: true, sources: Object.keys(SOURCES), formats: ['pptx', 'pdf', 'xlsx'] });
});

router.get('/:format/:source', async (req, res) => {
  const { format, source } = req.params;
  if (!SOURCES[source])               return res.status(400).json({ ok: false, error: 'unknown source' });
  if (!['pptx','pdf','xlsx'].includes(format)) return res.status(400).json({ ok: false, error: 'unknown format' });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'exports:' + source });
    const report = await fetchSource(source, tid);
    const brand  = await _loadBrand();
    const stamp = new Date().toISOString().slice(0, 10);
    const slug = (brand && brand.agencyName) ? brand.agencyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'infogenie';
    const filename = `${slug}-${source}-${stamp}.${format}`;
    if (format === 'pptx') return await streamPptx(report, res, filename, brand);
    if (format === 'xlsx') return await streamXlsx(report, res, filename, brand);
    if (format === 'pdf')  return       streamPdf(report, res, filename, brand);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;

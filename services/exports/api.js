const express = require('express');
const { fetchSource, SOURCES } = require('./data_sources');
const { streamPptx } = require('./pptx_report');
const { streamXlsx } = require('./xlsx_report');
const { streamPdf }  = require('./pdf_report');

const router = express.Router();

router.get('/sources', (req, res) => {
  res.json({ ok: true, sources: Object.keys(SOURCES), formats: ['pptx', 'pdf', 'xlsx'] });
});

router.get('/:format/:source', async (req, res) => {
  const { format, source } = req.params;
  if (!SOURCES[source])               return res.status(400).json({ ok: false, error: 'unknown source' });
  if (!['pptx','pdf','xlsx'].includes(format)) return res.status(400).json({ ok: false, error: 'unknown format' });
  try {
    const report = await fetchSource(source);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `infogenie-${source}-${stamp}.${format}`;
    if (format === 'pptx') return await streamPptx(report, res, filename);
    if (format === 'xlsx') return await streamXlsx(report, res, filename);
    if (format === 'pdf')  return       streamPdf(report, res, filename);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;

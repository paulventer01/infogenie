const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');

const upload = multer({ dest: '/tmp/removebg_uploads/', limits: { fileSize: 12 * 1024 * 1024 } });

const REMOVE_BG_URL = 'https://api.remove.bg/v1.0/removebg';

function getKey() {
  return process.env.REMOVE_BG_API_KEY || '';
}

// POST /api/tools/remove-bg
// Accepts: multipart file field "image" OR JSON { image_url: "https://..." }
// Returns: { ok: true, result_b64: "<base64 PNG>", credits_charged: N }
router.post('/', upload.single('image'), async (req, res) => {
  const apiKey = getKey();
  if (!apiKey) {
    return res.status(503).json({ ok: false, error: 'REMOVE_BG_API_KEY not configured. Add it in Secrets.' });
  }

  try {
    const form = new FormData();
    form.append('size', 'auto');

    let tmpPath = null;

    if (req.file) {
      // File upload via multipart
      tmpPath = req.file.path;
      const fileBuffer = fs.readFileSync(tmpPath);
      const blob = new Blob([fileBuffer], { type: req.file.mimetype || 'image/jpeg' });
      form.append('image_file', blob, req.file.originalname || 'image.jpg');
    } else if (req.body && req.body.image_url) {
      form.append('image_url', req.body.image_url);
    } else {
      return res.status(400).json({ ok: false, error: 'Provide either a file upload (field: image) or JSON { image_url }' });
    }

    const response = await fetch(REMOVE_BG_URL, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: form,
    });

    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch(_) {} }

    if (!response.ok) {
      let errMsg = `remove.bg error ${response.status}`;
      try {
        const errJson = await response.json();
        errMsg = (errJson.errors && errJson.errors[0] && errJson.errors[0].title) || errMsg;
      } catch(_) {}
      return res.status(response.status === 402 ? 402 : 502).json({ ok: false, error: errMsg });
    }

    const credits = response.headers.get('X-Credits-Charged') || '1';
    const arrayBuf = await response.arrayBuffer();
    const b64 = Buffer.from(arrayBuf).toString('base64');

    res.json({ ok: true, result_b64: b64, mime: 'image/png', credits_charged: Number(credits) });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/tools/remove-bg/status — check if key is configured
router.get('/status', (req, res) => {
  res.json({ configured: !!getKey() });
});

module.exports = router;

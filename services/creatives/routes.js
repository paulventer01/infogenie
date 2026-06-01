// Creative uploads · config routes.
// Extracted verbatim from server.js (pure structural move — no behavior change).
// Shared module-scope helpers are injected via `ctx`.
// __dirname and relative require() are rebased to the app root so the moved code
// (originally at server.js, project root) resolves paths exactly as before.
const __path__ = require('path');
const __APP_ROOT__ = __path__.join(__dirname, '..', '..');
const __root_require__ = (p) =>
  (typeof p === 'string' && (p.startsWith('./') || p.startsWith('../')))
    ? require(__path__.resolve(__APP_ROOT__, p))
    : require(p);

module.exports = function register(app, ctx) {
  const __dirname = __APP_ROOT__;
  const require = __root_require__;
  const { UPLOADS_DIR, fs, multer, path } = ctx;

const creativesStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const creativesUpload = multer({
  storage: creativesStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|pdf|svg)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('File type not allowed — use JPG, PNG, GIF, WebP, MP4, MOV, PDF or SVG'));
  }
});

// Metadata file for persisting creative records
const META_FILE = path.join(__dirname, 'uploads', 'creatives_meta.json');
function readMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); }
  catch { return []; }
}
function writeMeta(records) {
  fs.writeFileSync(META_FILE, JSON.stringify(records, null, 2));
}

// POST /api/creatives/upload — upload one or multiple brand asset files
app.post('/api/creatives/upload', creativesUpload.array('files', 20), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files received' });
  const meta   = readMeta();
  const added  = req.files.map(f => {
    const ext  = path.extname(f.filename).toLowerCase();
    const type = /\.(mp4|mov|avi)$/.test(ext) ? 'video'
               : /\.(pdf)$/.test(ext)          ? 'document'
               : 'image';
    const record = {
      id:         f.filename,
      name:       f.originalname,
      filename:   f.filename,
      url:        `/uploads/creatives/${f.filename}`,
      size:       f.size,
      type,
      tag:        req.body.tag || 'General',
      uploadedAt: new Date().toISOString()
    };
    meta.unshift(record);
    return record;
  });
  writeMeta(meta);
  res.json({ ok: true, files: added });
});

// GET /api/creatives/list — return all brand creative assets
app.get('/api/creatives/list', (req, res) => {
  res.json({ assets: readMeta() });
});

// DELETE /api/creatives/:id — delete an asset by filename id
app.delete('/api/creatives/:id', (req, res) => {
  const id   = req.params.id;
  let meta   = readMeta();
  const rec  = meta.find(r => r.id === id);
  if (!rec) return res.status(404).json({ error: 'Asset not found' });
  const filePath = path.join(UPLOADS_DIR, rec.filename);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  meta = meta.filter(r => r.id !== id);
  writeMeta(meta);
  res.json({ ok: true });
});

// ── Public config (non-secret browser keys) ───────────────────────────────────
app.get('/api/config', (req, res) => {
  // Extract just the phc_... token in case the user pasted the full curl example
  const rawPh = process.env.POSTHOG_API_KEY || '';
  const phMatch = rawPh.match(/phc_[A-Za-z0-9_\-]+/);
  const posthogApiKey = phMatch ? phMatch[0] : rawPh;

  res.json({
    amplitudeApiKey: process.env.AMPLITUDE_API_KEY || '',
    posthogApiKey
  });
});
};

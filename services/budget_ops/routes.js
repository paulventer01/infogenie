// Budget status · manual/backup downloads routes.
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
  const { _budgetSnapshot, fs, path } = ctx;

app.get('/api/budget/status', (_req, res) => {
  res.json({ ok:true, enforced: !!process.env.INFOGENIE_API_KEY, budgets: _budgetSnapshot() });
});

// ── User Manual PDF (clean URLs) ─────────────────────────────────────────────
// Serve the manual at friendly paths with proper inline-PDF headers so it
// opens directly in the browser tab instead of triggering a download dialog
// or being blocked by the asset-card viewer.
const MANUAL_PDF = path.join(__dirname, 'attached_assets', 'InfoGenie_User_Manual.pdf');
function sendManual(res, disposition) {
  if (!fs.existsSync(MANUAL_PDF)) return res.status(404).send('Manual not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="InfoGenie_User_Manual.pdf"`);
  res.setHeader('Cache-Control', 'public, max-age=300');
  fs.createReadStream(MANUAL_PDF).pipe(res);
}
app.get(['/manual', '/manual.pdf', '/InfoGenie_User_Manual.pdf'],
  (req, res) => sendManual(res, 'inline'));
app.get('/manual/download',
  (req, res) => sendManual(res, 'attachment'));

// ── Source code backup downloads ─────────────────────────────────────────────
// Stream the backup archives with proper download headers so large files
// download reliably instead of failing through the inline preview card.
function sendBackup(res, filename) {
  const filePath = path.join(__dirname, 'attached_assets', filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Backup not found');
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(filePath).pipe(res);
}
app.get('/backup/full',  (req, res) => sendBackup(res, 'InfoGenie_Source_Backup.tar.gz'));
app.get('/backup/code',  (req, res) => sendBackup(res, 'InfoGenie_Source_Code_Only.tar.gz'));
};

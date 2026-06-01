// Public LP / Bio / Booking pages routes.
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

app.get('/lp/:slug',  (req, res, next) => { req.url = '/render/' + req.params.slug; require('./services/site_builder/api')(req, res, next); });
app.get('/bio/:slug', (req, res, next) => { req.url = '/render/' + req.params.slug; require('./services/linksell/api')(req, res, next);     });
app.get('/book/:slug', async (req, res) => {
  // Slug is URL-safe by design (only [a-z0-9_-]), but defense-in-depth: validate strictly.
  const slug = String(req.params.slug || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (!slug) return res.status(400).send('Invalid slug');
  // JSON-encode for safe inline embedding inside JS string literal (prevents XSS via slug).
  const slugJs = JSON.stringify(slug);
  res.set('Content-Type','text/html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book a time</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#F8FAFC;color:#0F172A;padding:40px 16px}.wrap{max-width:560px;margin:0 auto;background:white;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.06)}h1{margin:0 0 6px}p.sub{color:#64748B;margin:0 0 24px}.slot{display:inline-block;margin:4px;padding:10px 14px;background:#F0F9FF;border:1.5px solid #BAE6FD;border-radius:8px;cursor:pointer;font-size:14px}.slot:hover{background:#0066FF;color:white;border-color:#0066FF}.day{margin-bottom:16px}.day h3{font-size:14px;color:#64748B;margin:12px 0 8px;text-transform:uppercase;letter-spacing:.06em}input,textarea{width:100%;padding:10px 12px;border:1.5px solid #E5E7EB;border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box;margin-bottom:10px}button{background:#0066FF;color:white;border:0;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer;font-size:15px}</style>
</head><body><div class="wrap" id="root">Loading…</div>
<script>
const slug=${slugJs};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function load(){
  const r=await fetch('/api/bookings/slots/'+encodeURIComponent(slug));const j=await r.json();
  const grouped={};(j.slots||[]).forEach(s=>{(grouped[s.date]=grouped[s.date]||[]).push(s);});
  const days=Object.keys(grouped).sort().map(d=>'<div class="day"><h3>'+esc(new Date(d).toLocaleDateString('en-GB',{weekday:'long',month:'long',day:'numeric'}))+'</h3>'+grouped[d].map(s=>'<span class="slot" data-iso="'+esc(s.iso)+'">'+esc(s.time)+'</span>').join('')+'</div>').join('');
  document.getElementById('root').innerHTML='<h1>'+esc(j.schedule?.title||'Book a time')+'</h1><p class="sub">'+esc(j.schedule?.description||'')+'</p>'+(days||'<p>No slots available.</p>');
  document.querySelectorAll('.slot').forEach(el=>el.addEventListener('click',()=>pick(el.dataset.iso)));
}
function pick(iso){
  document.getElementById('root').innerHTML='<h1>Confirm</h1><p class="sub">'+esc(new Date(iso).toLocaleString('en-GB',{dateStyle:'full',timeStyle:'short'}))+'</p>'+
  '<form id="bf"><input name="name" placeholder="Your name" required><input name="email" type="email" placeholder="Email" required><input name="phone" placeholder="Phone (optional)"><textarea name="notes" placeholder="Notes (optional)" rows="3"></textarea><button type="submit">Confirm booking</button></form>';
  document.getElementById('bf').addEventListener('submit',e=>book(e,iso));
}
async function book(e,iso){e.preventDefault();const f=e.target;const r=await fetch('/api/bookings/book/'+encodeURIComponent(slug),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({startsAt:iso,name:f.name.value,email:f.email.value,phone:f.phone.value,notes:f.notes.value})});const j=await r.json();if(j.ok)document.getElementById('root').innerHTML='<h1>✓ Booked!</h1><p class="sub">A confirmation will be emailed to you.</p>';else alert(j.error||'Failed');return false;}
load();
</script></body></html>`);
});
};

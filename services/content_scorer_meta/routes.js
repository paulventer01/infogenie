// Content scorer countries · related routes.
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
  const { CONTENT_COUNTRY_CODES } = ctx;

const CONTENT_COUNTRY_NAMES = {
  US:'United States', CA:'Canada', MX:'Mexico',
  BR:'Brazil', AR:'Argentina', CL:'Chile', CO:'Colombia', PE:'Peru', VE:'Venezuela', EC:'Ecuador', UY:'Uruguay', BO:'Bolivia', PY:'Paraguay', CR:'Costa Rica', GT:'Guatemala', DO:'Dominican Republic',
  GB:'United Kingdom', IE:'Ireland', FR:'France', DE:'Germany', ES:'Spain', IT:'Italy', PT:'Portugal', NL:'Netherlands', BE:'Belgium', LU:'Luxembourg', CH:'Switzerland', AT:'Austria',
  SE:'Sweden', NO:'Norway', DK:'Denmark', FI:'Finland', IS:'Iceland',
  PL:'Poland', CZ:'Czechia', SK:'Slovakia', HU:'Hungary', RO:'Romania', BG:'Bulgaria', HR:'Croatia', SI:'Slovenia', RS:'Serbia', GR:'Greece', RU:'Russia', UA:'Ukraine', BY:'Belarus', EE:'Estonia', LV:'Latvia', LT:'Lithuania',
  AE:'United Arab Emirates', SA:'Saudi Arabia', IL:'Israel', TR:'Turkey', EG:'Egypt', QA:'Qatar', KW:'Kuwait', JO:'Jordan', LB:'Lebanon',
  ZA:'South Africa', NG:'Nigeria', KE:'Kenya', MA:'Morocco', GH:'Ghana', TN:'Tunisia', DZ:'Algeria', ET:'Ethiopia',
  IN:'India', JP:'Japan', CN:'China', KR:'South Korea', HK:'Hong Kong', TW:'Taiwan', SG:'Singapore', MY:'Malaysia', TH:'Thailand', ID:'Indonesia', PH:'Philippines', VN:'Vietnam', PK:'Pakistan', BD:'Bangladesh', LK:'Sri Lanka',
  AU:'Australia', NZ:'New Zealand',
};

// Endpoint exposed to frontend so the dropdown stays in sync.
app.get('/api/content-scorer/countries', (req, res) => {
  const list = Object.keys(CONTENT_COUNTRY_CODES).map(code => ({ code, name: CONTENT_COUNTRY_NAMES[code] || code }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ ok:true, countries: list });
});

// Suggest related keywords for the seed keyword via DataForSEO Labs.
async function _fetchRelatedKeywords(keyword, countryCode = 2840, limit = 12) {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return { ok:false, error:'DataForSEO not configured', keywords:[] };
  const auth = 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
  try {
    const r = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live', {
      method:'POST',
      headers:{ 'Authorization': auth, 'Content-Type':'application/json' },
      body: JSON.stringify([{ keyword, location_code: countryCode, language_code:'en', limit, include_seed_keyword: false }]),
    });
    const j = await r.json();
    const items = j?.tasks?.[0]?.result?.[0]?.items || [];
    const out = items
      .filter(it => it.keyword && it.keyword.toLowerCase() !== String(keyword).toLowerCase())
      .slice(0, limit)
      .map(it => ({
        keyword: it.keyword,
        searchVolume: it.keyword_info?.search_volume ?? null,
        competition:  it.keyword_info?.competition_level ?? null,
        cpc:          it.keyword_info?.cpc ?? null,
      }));
    return { ok:true, seed: keyword, keywords: out };
  } catch (e) { return { ok:false, error: e.message, keywords:[] }; }
}

app.get('/api/content-scorer/related', async (req, res) => {
  const kw = (req.query.keyword || '').toString().trim();
  const country = (req.query.country || 'US').toString().toUpperCase();
  if (!kw) return res.status(400).json({ ok:false, error:'keyword query param required' });
  const code = CONTENT_COUNTRY_CODES[country] || 2840;
  const r = await _fetchRelatedKeywords(kw, code, 12);
  res.json(r);
});
};

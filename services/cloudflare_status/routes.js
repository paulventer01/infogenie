// Cloudflare status routes.
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
// Module-scope (real node require) so it resolves correctly even though `require`
// is rebased to __root_require__ inside register(). Gates the BOOT_TASKS runner
// (schema-ensures + start*Cron() kicks) on whether this is the live server
// process (off when required for tests).
const _runtimeFlags = require('../runtime_flags');

module.exports = function register(app, ctx) {
  const __dirname = __APP_ROOT__;
  const require = __root_require__;
  const { BOOT_TASKS, _abdSchema, _adSwipeSchema, _aiProvidersSchema, _alertRouteSchema, _battleSchema, _bfSchema, _calendarSchema, _coldEmailSchema, _crisisDetector, _crisisSchema, _db, _digestRouter, _digestSchema, _heatmapsSchema, _kwExplorerSchema, _leadFinderSchema, _lpSchema, _nlSchema, _optimizerBandit, _optimizerCreative, _optimizerIngest, _optimizerRules, _optimizerSchema, _podcastSchema, _pwSchema, _redditSchema, _searchIntelSchema, _serpTrackerSchema, _sovSchema, _vocSchema } = ctx;

BOOT_TASKS.push(async () => { try {
  if (process.env.DATABASE_URL) {
    await _redditSchema.ensureRedditPulseSchema();
    await _nlSchema.ensureNewsletterTrackerSchema();
    console.log('[tier17] reddit-pulse + newsletter-tracker schemas ready');
  }
} catch (e) { console.warn('[tier17] schema init failed:', e.message); }});

BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _crisisSchema.ensureCrisisRadarSchema();
    await _battleSchema.ensureBattleCardsSchema();
    await _sovSchema.ensureSovSchema();
    await _digestSchema.ensureDigestSchema();
    await _alertRouteSchema.ensureAlertRoutingSchema();
    await _calendarSchema.ensureContentCalendarSchema();
    await _podcastSchema.ensurePodcastMonitorSchema();
    await _abdSchema.ensureAbDesignerSchema();
    await _vocSchema.ensureVocSchema();
    await _pwSchema.ensurePricingWatchSchema();
    await _lpSchema.ensureLandingPagesSchema();
    await _bfSchema.ensureBrandFoundationSchema();
    await _adSwipeSchema.ensureAdSwipeSchema();
    await _heatmapsSchema.ensureHeatmapsSchema();
    await _aiProvidersSchema.ensureAiProvidersSchema();
    await _coldEmailSchema.ensureColdEmailSchema();
    await _leadFinderSchema.ensureLeadFinderSchema();
    await _serpTrackerSchema.ensureSerpTrackerSchema();
    await _kwExplorerSchema.ensureKeywordExplorerSchema();
    _crisisDetector.startCron(6);
    _digestRouter.startCron(24);
    console.log('[tier2-5] crisis + battle + trends + sov + discovery + digest + reply + press-release + alert-routing mounted');
  }
} catch(e) { console.error('[tier2-5] init failed:', e.message); } });
BOOT_TASKS.push(async () => {
  try {
    if (_db.hasDb()) {
      await _searchIntelSchema.ensureSearchIntelSchema();
      const _aiVis = require('./services/search_intel/ai_visibility');
      _aiVis.startCron(24); // daily
      console.log('[search-intel] schema ready, ai-visibility cron=24h');
    } else {
      console.log('[search-intel] disabled — DATABASE_URL not set');
    }
  } catch (e) { console.error('[search-intel] init failed:', e.message); }
});
let _googleCronsStarted = false;
BOOT_TASKS.push(async () => {
  try {
    if (_db.hasDb()) {
      await _optimizerSchema.ensureOptimizerSchema();
      _optimizerIngest.startIngestCron(60);              // every 60 min
      _optimizerRules.startOptimizerCron(6);             // every 6 hours
      _optimizerCreative.startCreativeRefreshCron(24);   // every 24h (Phase 8 — Meta)
      _optimizerBandit.startBanditCron(12);              // every 12h (Phase 7 — Meta)
      // T34 — day-part analysis + predictive creative fatigue (recommendation
      // only; never auto-pauses anything). Both are mutex-guarded and no-op
      // when no campaigns are optimizer-enabled.
      try {
        const _dayparting = require('./services/optimizer/dayparting');
        const _fatigue    = require('./services/optimizer/fatigue_forecast');
        _dayparting.startDaypartingCron(24);
        _fatigue.startFatigueForecastCron(24);
      } catch (e) { console.error('[t34-optimizer] init failed:', e.message); }
      // Google Ads ports — same cadence as their Meta counterparts. Each is
      // its own mutex-guarded module that no-ops when GOOGLE_ADS_* creds are
      // missing, so it's safe to start them unconditionally.
      try {
        const _gBandit   = require('./services/optimizer/google_bandit');
        const _gCreative = require('./services/optimizer/google_creative_refresh');
        if (!_googleCronsStarted) {
          _googleCronsStarted = true;
          // First runs offset from Meta (10 + 8 min) so they don't all fire at once
          setTimeout(() => _gBandit.runGoogleBanditOnce().catch(e => console.error('[google-bandit]', e.message)), 10 * 60 * 1000);
          setInterval(() => _gBandit.runGoogleBanditOnce().catch(e => console.error('[google-bandit]', e.message)), 12 * 3600 * 1000);
          setTimeout(() => _gCreative.runGoogleCreativeRefreshOnce().catch(e => console.error('[google-creative-refresh]', e.message)), 8 * 60 * 1000);
          setInterval(() => _gCreative.runGoogleCreativeRefreshOnce().catch(e => console.error('[google-creative-refresh]', e.message)), 24 * 3600 * 1000);
        }
      } catch (e) { console.error('[google-optimizer] init failed:', e.message); }
      console.log('[optimizer] schema ready, ingest=60m, rules=6h, creative-refresh=24h, bandit=12h, google-bandit=12h, google-creative-refresh=24h, dry-run=default');
    } else {
      console.log('[optimizer] disabled — DATABASE_URL not set');
    }
  } catch (e) { console.error('[optimizer] init failed:', e.message); }
});

// ── Boot registry runner ─────────────────────────────────────────────────────
// Awaits each registered boot task in registration order (replaces the ~30
// individual fire-and-forget async IIFEs above). Each task carries its own
// `_db.hasDb()` guard and try/catch logging, so this loop only sequences them;
// a belt-and-suspenders catch here ensures one task's unexpected throw can never
// abort the rest of boot.
// Only the live server runs the boot tasks (schema-ensures + start*Cron() kicks).
// Required as a module for tests (buildApp) this is skipped, so requiring the app
// starts no crons and touches no schema.
if (_runtimeFlags.backgroundEnabled()) {
  (async () => {
    for (const _bootTask of BOOT_TASKS) {
      try { await _bootTask(); } catch (e) { console.error('[boot] task failed:', e && e.message); }
    }
  })();
}

// Cloudflare Workers AI status ping (used by frontend to show provider state).
app.get('/api/cloudflare/status', (_req, res) => {
  const ok = !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN);
  res.json({ ok, configured: ok, model: '@cf/meta/llama-3.1-8b-instruct',
    missing: ok ? [] : ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_AI_TOKEN'].filter(k => !process.env[k]) });
});
};

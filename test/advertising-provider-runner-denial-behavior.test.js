'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const https = require('node:https');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const realGuard = require('../services/security/advertising_provider_mutations');

const originalLoad = Module._load;
const originalFetch = global.fetch;
const originalHttpsRequest = https.request;
const originalSetTimeout = global.setTimeout;
const originalSetInterval = global.setInterval;

const activity = {
  fetch: 0,
  httpsRequest: 0,
  oauthRefresh: 0,
  dbHasDb: 0,
  dbGetPool: 0,
  dbQuery: 0,
  settingsFactory: 0,
  settingsRead: 0,
  metaCredentialRead: 0,
  googleCredentialRead: 0,
  providerRead: 0,
  aiCopyGeneration: 0,
  imageGeneration: 0,
  mutationHelper: 0,
  mutationGuard: 0,
  deny: 0,
};

const PREPARATION_KEYS = [
  'fetch',
  'httpsRequest',
  'oauthRefresh',
  'dbHasDb',
  'dbGetPool',
  'dbQuery',
  'settingsFactory',
  'settingsRead',
  'metaCredentialRead',
  'googleCredentialRead',
  'providerRead',
  'aiCopyGeneration',
  'imageGeneration',
  'mutationHelper',
  'mutationGuard',
];

function hit(name) {
  activity[name] += 1;
  return Promise.reject(new Error(`${name} must not run while provider mutation is disabled`));
}

const actionableCampaign = {
  id: 41,
  tenant_id: 7,
  name: 'Live-looking QA campaign',
  platform_camp_id: '123456789',
  optimizer_enabled: true,
  target_roas: 3,
  owner_email: 'qa@example.test',
};

const fakeDb = {
  hasDb() {
    activity.dbHasDb += 1;
    return true;
  },
  getPool() {
    activity.dbGetPool += 1;
    return {
      async query() {
        activity.dbQuery += 1;
        return { rows: [actionableCampaign] };
      },
    };
  },
};

const fakeSchema = {
  makeSettingsCache() {
    activity.settingsFactory += 1;
    return async () => {
      activity.settingsRead += 1;
      return { v: true };
    };
  },
};

const fakeVault = {
  async resolveMetaAdsCredentials() {
    activity.metaCredentialRead += 1;
    return {
      ok: true,
      creds: {
        accessToken: 'test-meta-access-token',
        adAccountId: 'act_123456789',
      },
    };
  },
  async resolveGoogleAdsCredentials() {
    activity.googleCredentialRead += 1;
    return {
      ok: true,
      creds: {
        clientId: 'test-google-client-id',
        clientSecret: 'test-google-client-secret',
        refreshToken: 'test-google-refresh-token',
        customerId: '123-456-7890',
        devToken: 'test-google-developer-token',
      },
    };
  },
};

class FakeOpenAI {
  constructor() {
    this.chat = {
      completions: {
        create: () => hit('aiCopyGeneration'),
      },
    };
    this.images = {
      generate: () => hit('imageGeneration'),
    };
  }
}

const guardedSecurity = {
  ...realGuard,
  assertAdvertisingProviderMutationAllowed(context) {
    activity.mutationGuard += 1;
    return realGuard.assertAdvertisingProviderMutationAllowed(context);
  },
  denyAdvertisingProviderMutation(extra) {
    activity.deny += 1;
    return realGuard.denyAdvertisingProviderMutation(extra);
  },
};

process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'test-openai-key-present';
process.env.META_ACCESS_TOKEN = 'test-meta-access-token-present';
process.env.META_AD_ACCOUNT_ID = 'act_123456789';
process.env.GOOGLE_ADS_CLIENT_ID = 'test-google-client-id-present';
process.env.GOOGLE_ADS_CLIENT_SECRET = 'test-google-client-secret-present';
process.env.GOOGLE_ADS_REFRESH_TOKEN = 'test-google-refresh-token-present';
process.env.GOOGLE_ADS_CUSTOMER_ID = '123-456-7890';
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-google-developer-token-present';

global.fetch = async function forbiddenFetch() {
  activity.fetch += 1;
  throw new Error('global fetch must not run while provider mutation is disabled');
};

https.request = function forbiddenHttpsRequest(options) {
  activity.httpsRequest += 1;
  const host = String((options && (options.hostname || options.host)) || options || '');
  if (host.includes('oauth2.googleapis.com')) activity.oauthRefresh += 1;
  throw new Error('https.request must not run while provider mutation is disabled');
};

function isOptimizerParent(parent) {
  return Boolean(parent && parent.filename && parent.filename.includes(`${path.sep}services${path.sep}optimizer${path.sep}`));
}

Module._load = function advertisingRunnerTestLoad(request, parent, isMain) {
  if (isOptimizerParent(parent)) {
    if (request === '../../db') return fakeDb;
    if (request === './schema') return fakeSchema;
    if (request === '../credentials/vault') return fakeVault;
    if (request === '../security/advertising_provider_mutations') return guardedSecurity;
    if (request === 'openai') return FakeOpenAI;
  }

  if (parent && parent.filename.endsWith(`${path.sep}services${path.sep}cloudflare_status${path.sep}routes.js`)) {
    if (request === '../runtime_flags') return { backgroundEnabled: () => false };
    if (String(request).endsWith(`${path.sep}services${path.sep}search_intel${path.sep}ai_visibility`)) {
      return { startCron() {} };
    }
    if (String(request).endsWith(`${path.sep}services${path.sep}optimizer${path.sep}dayparting`)) {
      return { startDaypartingCron() {} };
    }
    if (String(request).endsWith(`${path.sep}services${path.sep}optimizer${path.sep}fatigue_forecast`)) {
      return { startFatigueForecastCron() {} };
    }
  }

  return originalLoad.call(this, request, parent, isMain);
};

const importTimers = [];
global.setTimeout = (callback, delay) => {
  importTimers.push({ type: 'timeout', callback, delay });
  return { kind: 'timeout', delay };
};
global.setInterval = (callback, delay) => {
  importTimers.push({ type: 'interval', callback, delay });
  return { kind: 'interval', delay };
};

// Every spy/stub above is installed before these modules are imported.
const bandit = require('../services/optimizer/bandit');
const googleBandit = require('../services/optimizer/google_bandit');
const creativeRefresh = require('../services/optimizer/creative_refresh');
const googleCreativeRefresh = require('../services/optimizer/google_creative_refresh');
const registerCloudflareStatusRoutes = require('../services/cloudflare_status/routes');

global.setTimeout = originalSetTimeout;
global.setInterval = originalSetInterval;

function snapshotPreparation() {
  return Object.fromEntries(PREPARATION_KEYS.map(key => [key, activity[key]]));
}

function assertNoPreparationSince(before, label) {
  for (const key of PREPARATION_KEYS) {
    assert.equal(activity[key], before[key], `${label}: ${key} must remain untouched`);
  }
}

function assertStandardDenial(result, platform, op) {
  assert.deepEqual(
    {
      ok: result.ok,
      success: result.success,
      blocked: result.blocked,
      code: result.code,
      published: result.published,
      external_action_taken: result.external_action_taken,
      platform: result.platform,
      op: result.op,
    },
    {
      ok: false,
      success: false,
      blocked: true,
      code: 'advertising_provider_mutation_disabled',
      published: false,
      external_action_taken: false,
      platform,
      op,
    },
  );
}

function withCapturedTimers(register) {
  const timers = [];
  global.setTimeout = (callback, delay) => {
    timers.push({ type: 'timeout', callback, delay });
    return { kind: 'timeout', delay };
  };
  global.setInterval = (callback, delay) => {
    timers.push({ type: 'interval', callback, delay });
    return { kind: 'interval', delay };
  };
  try {
    register();
  } finally {
    global.setTimeout = originalSetTimeout;
    global.setInterval = originalSetInterval;
  }
  return timers;
}

function makeSchema(method) {
  return {
    async [method]() {},
  };
}

function makeRouteContext(bootTasks) {
  return {
    BOOT_TASKS: bootTasks,
    _db: fakeDb,
    _redditSchema: makeSchema('ensureRedditPulseSchema'),
    _nlSchema: makeSchema('ensureNewsletterTrackerSchema'),
    _crisisSchema: makeSchema('ensureCrisisRadarSchema'),
    _battleSchema: makeSchema('ensureBattleCardsSchema'),
    _sovSchema: makeSchema('ensureSovSchema'),
    _digestSchema: makeSchema('ensureDigestSchema'),
    _alertRouteSchema: makeSchema('ensureAlertRoutingSchema'),
    _calendarSchema: makeSchema('ensureContentCalendarSchema'),
    _podcastSchema: makeSchema('ensurePodcastMonitorSchema'),
    _abdSchema: makeSchema('ensureAbDesignerSchema'),
    _vocSchema: makeSchema('ensureVocSchema'),
    _pwSchema: makeSchema('ensurePricingWatchSchema'),
    _lpSchema: makeSchema('ensureLandingPagesSchema'),
    _bfSchema: makeSchema('ensureBrandFoundationSchema'),
    _adSwipeSchema: makeSchema('ensureAdSwipeSchema'),
    _heatmapsSchema: makeSchema('ensureHeatmapsSchema'),
    _aiProvidersSchema: makeSchema('ensureAiProvidersSchema'),
    _coldEmailSchema: makeSchema('ensureColdEmailSchema'),
    _leadFinderSchema: makeSchema('ensureLeadFinderSchema'),
    _serpTrackerSchema: makeSchema('ensureSerpTrackerSchema'),
    _kwExplorerSchema: makeSchema('ensureKeywordExplorerSchema'),
    _searchIntelSchema: makeSchema('ensureSearchIntelSchema'),
    _optimizerSchema: makeSchema('ensureOptimizerSchema'),
    _crisisDetector: { startCron() {} },
    _digestRouter: { startCron() {} },
    _optimizerIngest: { startIngestCron() {} },
    _optimizerRules: { startOptimizerCron() {} },
    _optimizerCreative: { startCreativeRefreshCron() {} },
    _optimizerBandit: { startBanditCron() {} },
  };
}

const dependencyLookingFunctions = {
  fetchAdSetsMeta: () => hit('providerRead'),
  fetchAdGroupsGoogle: () => hit('providerRead'),
  fetchActiveAdsMeta: () => hit('providerRead'),
  fetchActiveRSAsGoogle: () => hit('providerRead'),
  refreshAccessToken: () => hit('oauthRefresh'),
  generateCopy: () => hit('aiCopyGeneration'),
  generateRSACopy: () => hit('aiCopyGeneration'),
  generateImage: () => hit('imageGeneration'),
  applyAdSetBudget: () => hit('mutationHelper'),
  applyAdGroupBid: () => hit('mutationHelper'),
  uploadImageToMeta: () => hit('mutationHelper'),
  createMetaCreative: () => hit('mutationHelper'),
  createMetaAd: () => hit('mutationHelper'),
  pauseMetaAd: () => hit('mutationHelper'),
  createRSA: () => hit('mutationHelper'),
  pauseRSA: () => hit('mutationHelper'),
};

const hostileOptions = {
  force: true,
  dryRun: false,
  live: true,
  mode: 'live',
  publish: true,
  mutateProvider: true,
  tenantId: actionableCampaign.tenant_id,
  campaign: actionableCampaign,
  campaigns: [actionableCampaign],
  fixtures: {
    adsets: [
      { id: 'meta-arm-a', daily_budget: 25, perf: { clicks: 10, conversions: 2, revenue: 100 } },
      { id: 'meta-arm-b', daily_budget: 25, perf: { clicks: 12, conversions: 1, revenue: 50 } },
    ],
    staleAd: {
      id: 'stale-ad-1',
      ageHours: 120,
      perf72h: { spend: 100, impressions: 10000, clicks: 10, ctr: 0.001, roas: 0.2 },
      final_urls: ['https://example.test/buy'],
    },
  },
  credentials: {
    meta: fakeVault.resolveMetaAdsCredentials,
    google: fakeVault.resolveGoogleAdsCredentials,
  },
  dependencies: dependencyLookingFunctions,
  ...dependencyLookingFunctions,
};

test('advertising optimizer runners deny before all DB/provider/AI preparation', async t => {
  t.after(() => {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    https.request = originalHttpsRequest;
    global.setTimeout = originalSetTimeout;
    global.setInterval = originalSetInterval;
  });

  await t.test('module imports do not start timers or perform preparation', () => {
    assert.deepEqual(importTimers, []);
    assertNoPreparationSince(Object.fromEntries(PREPARATION_KEYS.map(key => [key, 0])), 'module import');
  });

  const directCases = [
    ['runBanditOnce', bandit.runBanditOnce, 'meta'],
    ['runGoogleBanditOnce', googleBandit.runGoogleBanditOnce, 'google'],
    ['runCreativeRefreshOnce', creativeRefresh.runCreativeRefreshOnce, 'meta'],
    ['runGoogleCreativeRefreshOnce', googleCreativeRefresh.runGoogleCreativeRefreshOnce, 'google'],
  ];

  for (const [op, runner, platform] of directCases) {
    await t.test(`${op} ignores hostile live options and injected dependencies`, async () => {
      const before = snapshotPreparation();
      const result = await runner(hostileOptions);
      assertStandardDenial(result, platform, op);
      assertNoPreparationSince(before, op);
    });
  }

  await t.test('Meta cron callbacks execute real runners and remain pre-preparation denials', async () => {
    const timers = withCapturedTimers(() => {
      assert.equal(bandit.startBanditCron(12), true);
      assert.equal(creativeRefresh.startCreativeRefreshCron(24), true);
    });
    assert.deepEqual(
      timers.map(({ type, delay }) => ({ type, delay })),
      [
        { type: 'timeout', delay: 7 * 60 * 1000 },
        { type: 'interval', delay: 12 * 3600 * 1000 },
        { type: 'timeout', delay: 5 * 60 * 1000 },
        { type: 'interval', delay: 24 * 3600 * 1000 },
      ],
    );

    const before = snapshotPreparation();
    const denyBefore = activity.deny;
    const originalLog = console.log;
    console.log = () => {};
    try {
      for (const timer of timers) await timer.callback();
    } finally {
      console.log = originalLog;
    }
    assert.equal(activity.deny - denyBefore, 4, 'each Meta scheduled callback reaches a real denied runner');
    assertNoPreparationSince(before, 'Meta scheduled callbacks');
  });

  await t.test('Google boot scheduling callbacks execute real runners and remain pre-preparation denials', async () => {
    const bootTasks = [];
    registerCloudflareStatusRoutes(
      { get() {} },
      makeRouteContext(bootTasks),
    );
    assert.ok(bootTasks.length >= 1, 'route registration exposes boot tasks');

    let googleTimers = [];
    googleTimers = withCapturedTimers(() => {
      // The optimizer task is the only registered task that creates the four
      // Google timers. Running all controlled boot tasks avoids relying on a
      // source-order/index assertion.
      return undefined;
    });

    global.setTimeout = (callback, delay) => {
      googleTimers.push({ type: 'timeout', callback, delay });
      return { kind: 'timeout', delay };
    };
    global.setInterval = (callback, delay) => {
      googleTimers.push({ type: 'interval', callback, delay });
      return { kind: 'interval', delay };
    };
    try {
      for (const bootTask of bootTasks) await bootTask();
    } finally {
      global.setTimeout = originalSetTimeout;
      global.setInterval = originalSetInterval;
    }

    const relevant = googleTimers.filter(({ delay }) => [
      10 * 60 * 1000,
      12 * 3600 * 1000,
      8 * 60 * 1000,
      24 * 3600 * 1000,
    ].includes(delay));
    assert.deepEqual(
      relevant.map(({ type, delay }) => ({ type, delay })),
      [
        { type: 'timeout', delay: 10 * 60 * 1000 },
        { type: 'interval', delay: 12 * 3600 * 1000 },
        { type: 'timeout', delay: 8 * 60 * 1000 },
        { type: 'interval', delay: 24 * 3600 * 1000 },
      ],
    );

    const before = snapshotPreparation();
    const denyBefore = activity.deny;
    for (const timer of relevant) await timer.callback();
    assert.equal(activity.deny - denyBefore, 4, 'each Google scheduled callback reaches a real denied runner');
    assertNoPreparationSince(before, 'Google scheduled callbacks');
  });
});

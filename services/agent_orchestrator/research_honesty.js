'use strict';

/**
 * Research-evidence honesty / provenance classification.
 *
 * Fixture, simulated, demo, synthetic and test evidence must never persist or
 * surface as live platform evidence. Classification lives on
 * `provider_metrics` (existing jsonb) and a page/run-level
 * `continuation_state` field. Fail closed on missing, unknown, or
 * mode-conflicting classification.
 *
 * `source` on persisted metrics is either a data-mode FAKE_SOURCES value
 * (non-live: fixture/synthetic/mock/demo/…) or `live` / `provider`
 * (not fabrication markers). Fixture/mock/test evidence stamps
 * `source: 'fixture'`; synthetic mode stamps `source: 'synthetic'`.
 * Do not put `verified` / `independently_verified` / `fact` on
 * provider_metrics — research_validate.assertNoHonestyFlagsDeep forbids them.
 */

const { fail } = require('./errors');

const FAKE_SOURCES = Object.freeze([
  'placeholder',
  'fallback',
  'template',
  'serp-fallback',
  'demo',
  'mock',
  'sample',
  'fixture',
  'synthetic',
]);

const LIVE_SOURCES = Object.freeze(['live', 'provider']);

const NON_LIVE_MODES = Object.freeze([
  'fixture',
  'simulated',
  'demo',
  'synthetic',
  'test',
  'mock',
  'sample',
  'placeholder',
  'template',
]);

const LIVE_MODES = Object.freeze(['live', 'provider']);

const MODE_CLASSIFICATION = Object.freeze({
  fixture: Object.freeze({ class: 'fixture', source: 'fixture', kind: 'non_live' }),
  simulated: Object.freeze({ class: 'simulated', source: 'fixture', kind: 'non_live' }),
  demo: Object.freeze({ class: 'demo', source: 'demo', kind: 'non_live' }),
  synthetic: Object.freeze({ class: 'synthetic', source: 'synthetic', kind: 'non_live' }),
  test: Object.freeze({ class: 'test', source: 'fixture', kind: 'non_live' }),
  mock: Object.freeze({ class: 'mock', source: 'fixture', kind: 'non_live' }),
  sample: Object.freeze({ class: 'sample', source: 'sample', kind: 'non_live' }),
  placeholder: Object.freeze({ class: 'placeholder', source: 'placeholder', kind: 'non_live' }),
  template: Object.freeze({ class: 'template', source: 'template', kind: 'non_live' }),
  live: Object.freeze({ class: 'live', source: 'live', kind: 'live' }),
  provider: Object.freeze({ class: 'provider', source: 'provider', kind: 'live' }),
});

const FAKE_SOURCE_SET = new Set(FAKE_SOURCES);
const LIVE_SOURCE_SET = new Set(LIVE_SOURCES);
const NON_LIVE_MODE_SET = new Set(NON_LIVE_MODES);
const LIVE_MODE_SET = new Set(LIVE_MODES);

function honestyFail(reason, field) {
  fail('validation_failed', { field: field || 'honesty', reason: reason || 'invalid_classification' });
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}

function normalizeToken(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim().toLowerCase();
  return s || null;
}

function classificationForMode(mode) {
  const key = normalizeToken(mode);
  if (!key) return null;
  return MODE_CLASSIFICATION[key] || null;
}

function isNonLiveMode(mode) {
  const key = normalizeToken(mode);
  return !!(key && NON_LIVE_MODE_SET.has(key));
}

function isLiveMode(mode) {
  const key = normalizeToken(mode);
  return !!(key && LIVE_MODE_SET.has(key));
}

function isFakeSource(source) {
  const key = normalizeToken(source);
  return !!(key && FAKE_SOURCE_SET.has(key));
}

function isLiveSource(source) {
  const key = normalizeToken(source);
  return !!(key && LIVE_SOURCE_SET.has(key));
}

function isKnownSource(source) {
  return isFakeSource(source) || isLiveSource(source);
}

function metricsOf(evidence) {
  if (!evidence || !isPlainObject(evidence)) return null;
  const metrics = evidence.provider_metrics;
  if (metrics == null || metrics === '') return {};
  if (!isPlainObject(metrics)) return null;
  return metrics;
}

function sourceOfEvidence(evidence) {
  const metrics = metricsOf(evidence);
  if (!metrics) return null;
  return normalizeToken(metrics.source);
}

function pageSourceOf(page) {
  if (!page || !isPlainObject(page)) return null;
  const cont = isPlainObject(page.continuation_state) ? page.continuation_state : null;
  return (
    normalizeToken(page.honesty)
    || normalizeToken(page.honesty_class)
    || (cont && normalizeToken(cont.honesty_class))
    || (cont && normalizeToken(cont.honesty_source))
    || null
  );
}

function inferModeFromSource(source) {
  const key = normalizeToken(source);
  if (!key) return null;
  const mapped = MODE_CLASSIFICATION[key];
  if (mapped) return key;
  if (FAKE_SOURCE_SET.has(key)) return 'fixture';
  if (LIVE_SOURCE_SET.has(key)) return 'live';
  return null;
}

function resolveMode(mode, evidence, page) {
  if (mode != null && mode !== '') {
    const spec = classificationForMode(mode);
    if (!spec) honestyFail('invalid_classification', 'honesty.mode');
    return normalizeToken(mode);
  }
  const fromEvidence = inferModeFromSource(sourceOfEvidence(evidence));
  if (fromEvidence) return fromEvidence;
  const fromPage = inferModeFromSource(pageSourceOf(page));
  if (fromPage) return fromPage;
  return null;
}

function assertModeSourceAgreement(mode, source, field) {
  if (mode != null && mode !== '' && !classificationForMode(mode)) {
    honestyFail('invalid_classification', 'honesty.mode');
  }
  if (source != null && source !== '' && !isKnownSource(source) && !classificationForMode(source)) {
    honestyFail('invalid_classification', field || 'provider_metrics.source');
  }
  if (isLiveMode(mode) && (isFakeSource(source) || isNonLiveMode(source))) {
    honestyFail('classification_conflict', field || 'provider_metrics.source');
  }
  if (isNonLiveMode(mode) && (isLiveSource(source) || isLiveMode(source))) {
    honestyFail('classification_conflict', field || 'provider_metrics.source');
  }
}

function nonLiveHonestyMetrics(extra) {
  const out = isPlainObject(extra) ? { ...extra } : {};
  const incoming = normalizeToken(out.source);
  out.source = incoming === 'synthetic' ? 'synthetic' : 'fixture';
  out._fabricated = true;
  out._estimated = true;
  return out;
}

function stampProviderMetrics(rawMetrics, mode) {
  const spec = classificationForMode(mode) || classificationForMode('fixture');
  const metrics = isPlainObject(rawMetrics) ? { ...rawMetrics } : {};
  if (spec.kind === 'non_live') {
    metrics.source = spec.source;
    metrics._fabricated = true;
    metrics._estimated = true;
    return metrics;
  }
  if (isFakeSource(metrics.source) || metrics._fabricated === true) {
    return metrics;
  }
  if (!isLiveSource(metrics.source)) metrics.source = spec.source;
  else metrics.source = normalizeToken(metrics.source);
  return metrics;
}

function stampContinuation(raw, mode) {
  const spec = classificationForMode(mode) || classificationForMode('fixture');
  const next = isPlainObject(raw) ? { ...raw } : {};
  // Do not write FAKE_SOURCES onto continuation_state.source — publicRun
  // returns that jsonb and strict data-mode would withhold the run status.
  delete next.source;
  if (spec.kind === 'non_live') {
    next.honesty_class = spec.class;
    return next;
  }
  if (isNonLiveMode(next.honesty_class) || isFakeSource(next.honesty_source)) {
    return next;
  }
  if (!next.honesty_class) next.honesty_class = spec.class;
  return next;
}

function stampPageHonesty(page, mode) {
  if (mode != null && mode !== '' && !classificationForMode(mode)) {
    honestyFail('invalid_classification', 'honesty.mode');
  }
  const useMode = classificationForMode(mode) ? normalizeToken(mode) : 'fixture';
  const incoming = isPlainObject(page) ? page : {};
  const evidence = Array.isArray(incoming.evidence)
    ? incoming.evidence.map((row) => {
      const item = isPlainObject(row) ? row : {};
      return {
        ...item,
        provider_metrics: stampProviderMetrics(item.provider_metrics, useMode),
        metrics_kind: isNonLiveMode(useMode) ? 'estimated' : item.metrics_kind,
      };
    })
    : [];
  return {
    ...incoming,
    evidence,
    continuation_state: stampContinuation(incoming.continuation_state, useMode),
  };
}

function assertEvidenceHonesty({ mode, evidence, competitor, page } = {}) {
  void competitor;
  if (evidence == null || !isPlainObject(evidence)) {
    honestyFail('missing_classification', 'honesty.evidence');
  }
  const resolvedMode = resolveMode(mode, evidence, page);
  if (mode != null && mode !== '' && !classificationForMode(mode)) {
    honestyFail('invalid_classification', 'honesty.mode');
  }
  const metrics = metricsOf(evidence);
  if (!metrics) honestyFail('missing_classification', 'provider_metrics');
  const source = sourceOfEvidence(evidence);
  if (!source) honestyFail('missing_classification', 'provider_metrics.source');
  if (!isKnownSource(source)) honestyFail('invalid_classification', 'provider_metrics.source');

  if (resolvedMode) assertModeSourceAgreement(resolvedMode, source);

  const pageSource = pageSourceOf(page);
    if (pageSource) {
    if (!isKnownSource(pageSource) && !classificationForMode(pageSource)) {
      honestyFail('invalid_classification', 'continuation_state.honesty_class');
    }
    if (resolvedMode) assertModeSourceAgreement(resolvedMode, pageSource, 'continuation_state.honesty_class');
    if ((isLiveSource(source) || isLiveMode(source)) && (isFakeSource(pageSource) || isNonLiveMode(pageSource))) {
      honestyFail('classification_conflict', 'continuation_state.honesty_class');
    }
    if ((isFakeSource(source) || isNonLiveMode(source)) && (isLiveSource(pageSource) || isLiveMode(pageSource))) {
      honestyFail('classification_conflict', 'continuation_state.honesty_class');
    }
  }

  if (isNonLiveMode(resolvedMode) || isFakeSource(source)) {
    if (metrics._fabricated !== true) {
      honestyFail('missing_classification', 'provider_metrics._fabricated');
    }
    if (metrics._estimated !== true) {
      honestyFail('missing_classification', 'provider_metrics._estimated');
    }
    if (evidence.metrics_kind === 'provider_reported') {
      honestyFail('classification_conflict', 'metrics_kind');
    }
  }

  if (isLiveMode(resolvedMode) || isLiveSource(source)) {
    if (metrics._fabricated === true) {
      honestyFail('classification_conflict', 'provider_metrics._fabricated');
    }
    if (isFakeSource(source)) {
      honestyFail('classification_conflict', 'provider_metrics.source');
    }
  }

  return evidence;
}

function assertPageHonesty({ mode, page } = {}) {
  if (page == null || !isPlainObject(page)) {
    honestyFail('missing_classification', 'honesty.page');
  }
  if (mode != null && mode !== '' && !classificationForMode(mode)) {
    honestyFail('invalid_classification', 'honesty.mode');
  }
  const competitors = Array.isArray(page.competitors) ? page.competitors : [];
  const evidence = Array.isArray(page.evidence) ? page.evidence : [];
  if (competitors.length === 0 && evidence.length === 0) return page;

  const seed = evidence[0] || null;
  const resolvedMode = resolveMode(mode, seed, page);
  if (!resolvedMode && mode == null) {
    const pageSource = pageSourceOf(page);
    const evSource = sourceOfEvidence(seed);
    if (!pageSource && !evSource) honestyFail('missing_classification', 'honesty');
  }

  for (let i = 0; i < evidence.length; i += 1) {
    try {
      assertEvidenceHonesty({ mode: resolvedMode || mode, evidence: evidence[i], page });
    } catch (err) {
      if (err && err.code === 'validation_failed' && err.extra && !/evidence\[/.test(String(err.extra.field || ''))) {
        err.extra = { ...err.extra, field: `evidence[${i}].${err.extra.field || 'honesty'}` };
      }
      throw err;
    }
  }

  if (competitors.length > 0) {
    const pageSource = pageSourceOf(page);
    if (!pageSource && evidence.length === 0) {
      honestyFail('missing_classification', 'continuation_state.honesty_class');
    }
    if (pageSource) {
      if (!isKnownSource(pageSource) && !classificationForMode(pageSource)) {
        honestyFail('invalid_classification', 'continuation_state.honesty_class');
      }
      if (resolvedMode || mode) {
        assertModeSourceAgreement(resolvedMode || mode, pageSource, 'continuation_state.honesty_class');
      }
    }
  }

  return page;
}

function honestyFieldsFromPage(page) {
  if (!page || !isPlainObject(page)) return {};
  const cont = isPlainObject(page.continuation_state) ? page.continuation_state : {};
  const out = {};
  if (cont.honesty_class != null && cont.honesty_class !== '') {
    out.honesty_class = normalizeToken(cont.honesty_class) || cont.honesty_class;
  }
  return out;
}

module.exports = {
  FAKE_SOURCES,
  LIVE_SOURCES,
  NON_LIVE_MODES,
  LIVE_MODES,
  MODE_CLASSIFICATION,
  classificationForMode,
  isNonLiveMode,
  isLiveMode,
  isFakeSource,
  isLiveSource,
  nonLiveHonestyMetrics,
  stampProviderMetrics,
  stampContinuation,
  stampPageHonesty,
  assertEvidenceHonesty,
  assertPageHonesty,
  honestyFieldsFromPage,
  sourceOfEvidence,
};

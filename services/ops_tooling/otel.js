'use strict';

/**
 * OpenTelemetry + OpenLLMetry-style LLM spans → OTLP/HTTP (SigNoz).
 * Fail-open: no-op when OTEL_EXPORTER_OTLP_ENDPOINT / SIGNOZ_OTLP_ENDPOINT unset.
 * Uses a minimal OTLP JSON exporter so we do not hard-require the full SDK.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { present } = require('./env');
const { logger } = require('../infra/logger');

let _enabled = false;
let _endpoint = null;
let _headers = {};
let _serviceName = 'infogenie';
const _pending = [];
let _flushTimer = null;

function otelEndpoint() {
  const raw =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.SIGNOZ_OTLP_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    '';
  if (!raw) return null;
  // Accept base (…:4318) or full traces path
  if (/\/v1\/traces\/?$/.test(raw)) return raw.replace(/\/$/, '');
  return raw.replace(/\/$/, '') + '/v1/traces';
}

function initOtel() {
  const endpoint = otelEndpoint();
  if (!endpoint) return false;
  _endpoint = endpoint;
  _serviceName = process.env.OTEL_SERVICE_NAME || process.env.SIGNOZ_SERVICE_NAME || 'infogenie';
  _headers = { 'Content-Type': 'application/json' };
  const hdr = process.env.OTEL_EXPORTER_OTLP_HEADERS || process.env.SIGNOZ_INGESTION_KEY || '';
  if (hdr) {
    // "k=v,k2=v2" or bare SigNoz ingestion key
    if (hdr.includes('=')) {
      for (const part of hdr.split(',')) {
        const [k, ...rest] = part.split('=');
        if (k && rest.length) _headers[k.trim()] = rest.join('=').trim();
      }
    } else {
      _headers['signoz-ingestion-key'] = hdr.trim();
    }
  }
  _enabled = true;
  logger.info('otel_initialized', { endpoint: _endpoint, service: _serviceName });

  // Optional: full auto-instrumentation when packages are installed
  try {
    if (process.env.OTEL_NODE_ENABLED === '1') {
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      const { NodeSDK } = require('@opentelemetry/sdk-node');
      // eslint-disable-next-line global-require
      const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
      // eslint-disable-next-line global-require
      const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
      const sdk = new NodeSDK({
        serviceName: _serviceName,
        traceExporter: new OTLPTraceExporter({ url: _endpoint, headers: _headers }),
        instrumentations: [getNodeAutoInstrumentations()],
      });
      sdk.start();
      logger.info('otel_sdk_started');
    }
  } catch (e) {
    logger.warn('otel_sdk_optional_skip', { error: e.message });
  }

  // Optional Traceloop / OpenLLMetry SDK
  try {
    if (process.env.TRACELOOP_API_KEY || process.env.TRACELOOP_BASE_URL) {
      // eslint-disable-next-line global-require
      const { initializeTracing } = require('@traceloop/node-server-sdk');
      initializeTracing({
        appName: _serviceName,
        apiKey: process.env.TRACELOOP_API_KEY,
        baseUrl: process.env.TRACELOOP_BASE_URL || undefined,
        disableBatch: process.env.NODE_ENV !== 'production',
      });
      logger.info('traceloop_initialized');
    }
  } catch (e) {
    logger.warn('traceloop_optional_skip', { error: e.message });
  }

  return true;
}

function otelEnabled() {
  return _enabled;
}

function _hexId(bytes = 16) {
  return require('crypto').randomBytes(bytes).toString('hex');
}

function _nowNano() {
  const ms = Date.now();
  return String(BigInt(ms) * 1000000n);
}

function _attr(key, value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? { key, value: { intValue: value } }
      : { key, value: { doubleValue: value } };
  }
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  return { key, value: { stringValue: String(value) } };
}

function emitLlmSpan(opts = {}) {
  if (!_enabled || !_endpoint) return false;
  const start = opts.start_ns || _nowNano();
  const end = opts.end_ns || (opts.latency_ms != null
    ? String(BigInt(start) + BigInt(Math.max(0, Math.round(opts.latency_ms))) * 1000000n)
    : _nowNano());
  const attrs = [
    _attr('service.name', _serviceName),
    _attr('llm.vendor', opts.provider || 'unknown'),
    _attr('llm.request.model', opts.model || 'unknown'),
    _attr('llm.request.type', opts.category || 'chat'),
    _attr('gen_ai.system', opts.provider || 'unknown'),
    _attr('gen_ai.request.model', opts.model || 'unknown'),
    _attr('gen_ai.usage.prompt_tokens', opts.prompt_tokens),
    _attr('gen_ai.usage.completion_tokens', opts.completion_tokens),
    _attr('llm.usage.total_tokens', (opts.prompt_tokens || 0) + (opts.completion_tokens || 0)),
    _attr('infogenie.surface', opts.surface),
    _attr('infogenie.tenant_id', opts.tenant_id),
    _attr('infogenie.cascade_tier', opts.cascade_tier),
    _attr('infogenie.cost_usd', opts.cost_usd),
    _attr('infogenie.status', opts.status || 'ok'),
  ].filter(Boolean);

  const span = {
    traceId: _hexId(16),
    spanId: _hexId(8),
    name: opts.name || `llm.${opts.surface || opts.category || 'chat'}`,
    kind: 3, // CLIENT
    startTimeUnixNano: start,
    endTimeUnixNano: end,
    attributes: attrs,
    status: {
      code: opts.error || opts.status === 'error' ? 2 : 1,
      message: opts.error ? String(opts.error).slice(0, 200) : undefined,
    },
  };

  _pending.push(span);
  if (_pending.length >= 20) flushSpans();
  else if (!_flushTimer) _flushTimer = setTimeout(() => flushSpans(), 2000);

  return true;
}

function flushSpans() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  if (!_enabled || !_endpoint || !_pending.length) return Promise.resolve(false);
  const spans = _pending.splice(0, _pending.length);
  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            _attr('service.name', _serviceName),
            _attr('deployment.environment', process.env.NODE_ENV || 'development'),
          ].filter(Boolean),
        },
        scopeSpans: [
          {
            scope: { name: 'infogenie.openllmetry', version: '1.0.0' },
            spans,
          },
        ],
      },
    ],
  };

  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(_endpoint);
    } catch (e) {
      return resolve(false);
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { ..._headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: 5000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

function otelStatus() {
  return {
    enabled: _enabled,
    endpoint: _endpoint ? _endpoint.replace(/([a-z0-9]{8})[a-z0-9]+/gi, '$1…') : null,
    service_name: _serviceName,
    sdk_auto: process.env.OTEL_NODE_ENABLED === '1',
    traceloop: !!(process.env.TRACELOOP_API_KEY || process.env.TRACELOOP_BASE_URL),
    configured: present('OTEL_EXPORTER_OTLP_ENDPOINT') || present('SIGNOZ_OTLP_ENDPOINT'),
  };
}

module.exports = {
  initOtel,
  otelEnabled,
  emitLlmSpan,
  flushSpans,
  otelStatus,
  otelEndpoint,
};

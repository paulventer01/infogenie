// services/infra/sentry.js — Optional Sentry init (no-op without SENTRY_DSN).
'use strict';

const { logger } = require('./logger');

let _enabled = false;

function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.05),
    });
    _enabled = true;
    logger.info('sentry_initialized');
    return true;
  } catch (e) {
    logger.warn('sentry_init_failed', { error: e.message });
    return false;
  }
}

function captureException(err, context) {
  if (!_enabled) return;
  try {
    const Sentry = require('@sentry/node');
    Sentry.withScope((scope) => {
      if (context) {
        for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
      }
      Sentry.captureException(err);
    });
  } catch { /* ignore */ }
}

function sentryEnabled() { return _enabled; }

module.exports = { initSentry, captureException, sentryEnabled };

// services/infra/shutdown.js — Graceful shutdown registry.
'use strict';

const { logger } = require('./logger');

const _hooks = [];
let _server = null;
let _shuttingDown = false;

function registerServer(server) {
  _server = server;
}

function onShutdown(name, fn) {
  _hooks.push({ name, fn });
}

async function shutdown(reason = 'signal') {
  if (_shuttingDown) return;
  _shuttingDown = true;
  logger.info('shutdown_start', { reason, hooks: _hooks.length });

  // Stop accepting new connections first.
  if (_server && typeof _server.close === 'function') {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 8000);
      _server.close(() => { clearTimeout(t); resolve(); });
    });
  }

  for (const h of _hooks) {
    try {
      await Promise.race([
        Promise.resolve(h.fn()),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
      logger.info('shutdown_hook_ok', { name: h.name });
    } catch (e) {
      logger.warn('shutdown_hook_failed', { name: h.name, error: e.message });
    }
  }

  logger.info('shutdown_complete', { reason });
  process.exit(0);
}

function installSignalHandlers() {
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      shutdown(sig).catch((e) => {
        console.error('[shutdown] fatal', e);
        process.exit(1);
      });
    });
  }
}

function isShuttingDown() { return _shuttingDown; }

module.exports = {
  registerServer,
  onShutdown,
  shutdown,
  installSignalHandlers,
  isShuttingDown,
};

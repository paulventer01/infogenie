// services/infra/logger.js — Structured JSON logger with request correlation.
'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const configured = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const minLevel = LEVELS[configured] != null ? LEVELS[configured] : LEVELS.info;

function _emit(level, msg, fields) {
  if ((LEVELS[level] ?? 99) > minLevel) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: String(msg),
    ...(fields && typeof fields === 'object' ? fields : {}),
  };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

function child(baseFields = {}) {
  return {
    error: (msg, fields) => _emit('error', msg, { ...baseFields, ...fields }),
    warn:  (msg, fields) => _emit('warn',  msg, { ...baseFields, ...fields }),
    info:  (msg, fields) => _emit('info',  msg, { ...baseFields, ...fields }),
    debug: (msg, fields) => _emit('debug', msg, { ...baseFields, ...fields }),
    child: (more) => child({ ...baseFields, ...more }),
  };
}

const logger = child({ service: 'infogenie' });

/** Express middleware — attaches req.log + x-request-id. */
function requestLogger() {
  return function _requestLogger(req, res, next) {
    const id = req.headers['x-request-id'] || require('crypto').randomBytes(8).toString('hex');
    req.requestId = id;
    res.setHeader('x-request-id', id);
    req.log = logger.child({ requestId: id, method: req.method, path: req.path });
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
      req.log[level]('http_request', { status: res.statusCode, ms });
    });
    next();
  };
}

module.exports = { logger, child, requestLogger };

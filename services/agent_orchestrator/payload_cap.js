'use strict';

const { sendError } = require('./errors');

const MAX_BYTES = 64 * 1024;

function byteLengthOfRaw(raw) {
  if (Buffer.isBuffer(raw)) return raw.length;
  return Buffer.byteLength(typeof raw === 'string' ? raw : String(raw), 'utf8');
}

function bodyHasContent(body) {
  if (body == null) return false;
  if (typeof body === 'string') return body.length > 0;
  if (Array.isArray(body)) return body.length > 0;
  if (typeof body === 'object') return Object.keys(body).length > 0;
  return false;
}

function measuredBodyBytes(req) {
  if (req.rawBody != null) return byteLengthOfRaw(req.rawBody);
  if (!bodyHasContent(req.body)) return 0;
  if (typeof req.body === 'object' || typeof req.body === 'string') {
    return Buffer.byteLength(JSON.stringify(req.body), 'utf8');
  }
  return 0;
}

function parseContentLength(req) {
  const raw = req.headers && req.headers['content-length'];
  if (raw == null || raw === '') return null;
  const cl = Number(raw);
  return Number.isFinite(cl) ? cl : null;
}

function isChunkedTransfer(req) {
  const te = req.headers && req.headers['transfer-encoding'];
  if (te == null || te === '') return false;
  return String(te).toLowerCase().includes('chunked');
}

function drainUnread(req) {
  if (!req || typeof req.resume !== 'function') return;
  if (typeof req.on === 'function') req.on('error', () => {});
  req.resume();
}

function rejectTooLarge(req, res) {
  sendError(res, 413, 'payload_too_large');
  drainUnread(req);
}

function capPayload(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const cl = parseContentLength(req);
  if (cl != null && cl > MAX_BYTES) {
    return rejectTooLarge(req, res);
  }

  // express.json only captures rawBody when it actually parses JSON.
  if (req.rawBody != null) {
    if (byteLengthOfRaw(req.rawBody) > MAX_BYTES) return rejectTooLarge(req, res);
    return next();
  }
  if (bodyHasContent(req.body)) {
    if (measuredBodyBytes(req) > MAX_BYTES) return rejectTooLarge(req, res);
    return next();
  }

  // Parser did not capture the body. Content-Length alone is not trustworthy
  // (missing, chunked, or a misleading small value on a non-JSON type).
  // Allow only a provably empty body: finite Content-Length === 0 and not chunked.
  if (cl === 0 && !isChunkedTransfer(req)) return next();
  return rejectTooLarge(req, res);
}

module.exports = { MAX_BYTES, capPayload, measuredBodyBytes };

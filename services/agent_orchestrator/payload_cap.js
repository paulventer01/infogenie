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

function capPayload(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const cl = Number(req.headers['content-length']);
  if (Number.isFinite(cl) && cl > MAX_BYTES) {
    return sendError(res, 413, 'payload_too_large');
  }

  const actual = measuredBodyBytes(req);
  if (actual > MAX_BYTES) {
    return sendError(res, 413, 'payload_too_large');
  }

  return next();
}

module.exports = { MAX_BYTES, capPayload, measuredBodyBytes };

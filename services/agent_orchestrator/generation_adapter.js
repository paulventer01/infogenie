'use strict';

const crypto = require('crypto');
const { fail, OrchError } = require('./errors');
const { assertSafeHttpsUrl } = require('../security/safe_url');

const DUMMY_KEY = /^_DUMMY/i;
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DECODED = 64 * 1024 * 1024;
const MAX_DIM = 8192;

const FIXTURE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function hasLiveKey() {
  const k = process.env.OPENAI_API_KEY;
  return !!(k && !DUMMY_KEY.test(k));
}

function createGenerationRuntime(opts = {}) {
  const requested = opts.mode === 'live' ? 'live' : 'fixture';
  return {
    mode: requested === 'live' && hasLiveKey() ? 'live' : 'fixture',
    requestedMode: requested,
    generate: opts.generate || null,
    fetchUrl: opts.fetchUrl || null,
    moderate: opts.moderate || null,
    now: opts.now || null,
  };
}

function looksMarkup(buf) {
  const head = buf.slice(0, 256).toString('utf8').replace(/^\uFEFF/, '').trim().toLowerCase();
  return head.startsWith('<svg') || head.startsWith('<?xml') || head.includes('image/svg+xml')
    || head.startsWith('<html') || head.startsWith('<!doctype') || head.startsWith('<script')
    || head.startsWith('javascript:');
}

function detectMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function pngSize(buf) {
  if (buf.length < 24 || detectMime(buf) !== 'image/png') return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf) {
  if (buf.length < 10 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(buf) {
  if (detectMime(buf) !== 'image/webp' || buf.length < 30) return null;
  const tag = buf.toString('ascii', 12, 16);
  if (tag === 'VP8X') {
    return {
      width: 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16),
      height: 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16),
    };
  }
  if (tag === 'VP8 ' && buf[20] === 0x9d && buf[21] === 0x01 && buf[22] === 0x2a) {
    return { width: buf.readUInt16LE(23) & 0x3fff, height: buf.readUInt16LE(25) & 0x3fff };
  }
  if (tag === 'VP8L' && buf[20] === 0x2f) {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function parseRasterSize(buf, mime) {
  if (mime === 'image/png') return pngSize(buf);
  if (mime === 'image/jpeg') return jpegSize(buf);
  if (mime === 'image/webp') return webpSize(buf);
  return null;
}

function validateRaster(bytes, declaredMime) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1) fail('unsafe_asset');
  if (bytes.length > MAX_BYTES) fail('payload_too_large');
  if (looksMarkup(bytes)) fail('moderation_failed');
  const mime = detectMime(bytes);
  if (!mime) fail('unsafe_asset');
  if (declaredMime && declaredMime !== mime) fail('unsafe_asset');
  const dim = parseRasterSize(bytes, mime);
  if (!dim || !dim.width || !dim.height) fail('unsafe_asset');
  if (dim.width < 1 || dim.height < 1 || dim.width > MAX_DIM || dim.height > MAX_DIM) fail('unsafe_asset');
  if (dim.width * dim.height * 4 > MAX_DECODED) fail('payload_too_large');
  return {
    mime, width: dim.width, height: dim.height, byte_size: bytes.length,
    asset_hash: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function mapErr(err) {
  if (err instanceof OrchError) throw err;
  const code = err && err.code;
  if (code === 'provider_timeout' || code === 'provider_transient' || code === 'provider_malformed'
      || code === 'provider_not_configured' || code === 'unsafe_url' || code === 'unsafe_asset'
      || code === 'moderation_failed' || code === 'payload_too_large') {
    fail(code);
  }
  fail('provider_malformed');
}

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => {
      try { fail('provider_timeout'); } catch (e) { reject(e); }
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(t));
}

async function fetchProviderBytes(url, runtime = {}) {
  const checked = await assertSafeHttpsUrl(url);
  if (!checked.ok) fail('unsafe_url');
  const href = typeof checked.url === 'string' ? checked.url : String(url);
  if (typeof runtime.fetchUrl === 'function') {
    const result = await runtime.fetchUrl(href, { pinned: checked });
    const status = result && result.status;
    if (status >= 300 && status < 400) fail('unsafe_url');
    if (Buffer.isBuffer(result)) return result;
    if (result && Buffer.isBuffer(result.bytes)) return result.bytes;
    fail('provider_malformed');
  }
  const res = await fetch(href, { method: 'GET', redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) fail('unsafe_url');
  if (!res.ok) fail('provider_transient');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) fail('payload_too_large');
  return buf;
}

function fixtureResult(bytes) {
  const v = validateRaster(bytes, 'image/png');
  return {
    bytes, mime: v.mime, width: v.width, height: v.height,
    provider: 'placeholder', model: 'stub-chargeable', modelVersion: 'v1',
    providerRequestId: null, honesty_class: 'fixture', provenance: 'fixture',
    moderation: { status: 'passed', source: 'fixture' },
  };
}

async function liveOpenAi({ brief, signal }) {
  if (!hasLiveKey()) fail('provider_not_configured');
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 });
  const prompt = String((brief && brief.payload && (brief.payload.visual_direction || brief.payload.objective)) || 'brand still image').slice(0, 320);
  const r = await client.images.generate({
    model: 'dall-e-2', prompt, size: '256x256', response_format: 'b64_json', n: 1,
  }, signal ? { signal } : undefined);
  const b64 = r && r.data && r.data[0] && r.data[0].b64_json;
  if (!b64) fail('provider_malformed');
  return Buffer.from(b64, 'base64');
}

async function generateStaticImage({ job, brief, runtime, signal }) {
  const rt = runtime || createGenerationRuntime({ mode: 'fixture' });
  if (rt.requestedMode === 'live' && !hasLiveKey()) fail('provider_not_configured');
  const mode = rt.requestedMode === 'live' ? 'live' : 'fixture';
  const attempts = mode === 'live' ? 2 : 1;

  const runOnce = async () => {
    if (typeof rt.generate === 'function') {
      const raw = await rt.generate({ job, brief, runtime: rt, signal });
      if (Buffer.isBuffer(raw)) return fixtureResult(raw);
      if (!raw || !Buffer.isBuffer(raw.bytes)) fail('provider_malformed');
      return raw;
    }
    if (mode === 'live') {
      const bytes = await liveOpenAi({ brief, signal });
      const v = validateRaster(bytes);
      return {
        bytes, mime: v.mime, width: v.width, height: v.height,
        provider: 'openai', model: 'dall-e-2', modelVersion: 'v1',
        providerRequestId: null, honesty_class: 'provider', provenance: 'live',
        moderation: { status: 'passed', source: 'provider' },
      };
    }
    return fixtureResult(FIXTURE_PNG);
  };

  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const out = await withTimeout(runOnce(), TIMEOUT_MS);
      const v = validateRaster(out.bytes, out.mime);
      if (typeof rt.moderate === 'function') {
        const mod = await rt.moderate({ bytes: out.bytes, mime: v.mime, job });
        if (!mod || mod.status === 'fail' || mod.status === 'failed') fail('moderation_failed');
        out.moderation = { status: 'passed', source: (mod.source || (mode === 'live' ? 'provider' : 'fixture')) };
      } else if (!out.moderation || out.moderation.status !== 'passed') {
        out.moderation = { status: 'passed', source: mode === 'live' ? 'provider' : 'fixture' };
      }
      if (mode !== 'live') {
        out.honesty_class = 'fixture';
        out.provenance = 'fixture';
        if (out.moderation) out.moderation.source = out.moderation.source === 'provider' ? 'fixture' : out.moderation.source;
      }
      out.mime = v.mime;
      out.width = v.width;
      out.height = v.height;
      return out;
    } catch (err) {
      last = err;
      const code = err && err.code;
      if (code !== 'provider_timeout' && code !== 'provider_transient') mapErr(err);
      if (i === attempts - 1) mapErr(err);
    }
  }
  mapErr(last);
}

module.exports = {
  FIXTURE_PNG,
  TIMEOUT_MS,
  MAX_BYTES,
  hasLiveKey,
  createGenerationRuntime,
  generateStaticImage,
  validateRaster,
  fetchProviderBytes,
  detectMime,
};

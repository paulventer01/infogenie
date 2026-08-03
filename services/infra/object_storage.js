// services/infra/object_storage.js — S3-compatible uploads with local fallback.
'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

const LOCAL_ROOT = path.join(__dirname, '..', '..', 'uploads');

function s3Configured() {
  return !!(process.env.S3_BUCKET && (process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID));
}

function _creds() {
  return {
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.S3_ENDPOINT || undefined,
    publicBase: (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  };
}

let _s3 = null;
function _client() {
  if (_s3) return _s3;
  if (!s3Configured()) return null;
  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    const c = _creds();
    _s3 = new S3Client({
      region: c.region,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      ...(c.endpoint ? { endpoint: c.endpoint, forcePathStyle: true } : {}),
    });
    return _s3;
  } catch (e) {
    logger.warn('s3_client_unavailable', { error: e.message });
    return null;
  }
}

function _ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Store a buffer/string under a relative key (e.g. "officer-avatars/x.png").
 * Returns a public URL path: "/uploads/..." (local) or CDN/S3 URL.
 */
async function putObject(relKey, body, opts = {}) {
  const key = String(relKey || '').replace(/^\/+/, '').replace(/\.\./g, '');
  if (!key) throw new Error('object key required');
  const contentType = opts.contentType || 'application/octet-stream';
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);

  const client = _client();
  if (client) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const c = _creds();
    await client.send(new PutObjectCommand({
      Bucket: c.bucket,
      Key: key,
      Body: buf,
      ContentType: contentType,
      ACL: opts.acl || undefined,
    }));
    if (c.publicBase) return `${c.publicBase}/${key}`;
    if (c.endpoint) return `${c.endpoint.replace(/\/+$/, '')}/${c.bucket}/${key}`;
    return `https://${c.bucket}.s3.${c.region}.amazonaws.com/${key}`;
  }

  const abs = path.join(LOCAL_ROOT, key);
  _ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, buf);
  return `/uploads/${key}`;
}

async function getObjectBuffer(relKey) {
  const key = String(relKey || '').replace(/^\/+/, '').replace(/\.\./g, '');
  const client = _client();
  if (client) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const c = _creds();
    const out = await client.send(new GetObjectCommand({ Bucket: c.bucket, Key: key }));
    const chunks = [];
    for await (const chunk of out.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  const abs = path.join(LOCAL_ROOT, key);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs);
}

async function objectStorageHealth() {
  if (!s3Configured()) {
    return { configured: false, backend: 'local', root: LOCAL_ROOT, ok: true };
  }
  try {
    const client = _client();
    if (!client) return { configured: true, backend: 's3', ok: false, error: 'client_init_failed' };
    const { HeadBucketCommand } = require('@aws-sdk/client-s3');
    await client.send(new HeadBucketCommand({ Bucket: _creds().bucket }));
    return { configured: true, backend: 's3', ok: true, bucket: _creds().bucket };
  } catch (e) {
    return { configured: true, backend: 's3', ok: false, error: e.message };
  }
}

module.exports = {
  putObject,
  getObjectBuffer,
  objectStorageHealth,
  s3Configured,
  LOCAL_ROOT,
};

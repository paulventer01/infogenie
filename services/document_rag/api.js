'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const router = express.Router();
const _tenantCtx = require('../tenants/context');
const { extractDocumentText, MAX_BYTES } = require('./extract');
const {
  upsertIndexedChunks,
  deleteBySourceRef,
  listDocuments,
  ensureSharedIndexTable,
  _hasOpenAI,
} = require('./index');
const { ensureDocumentRagSchema } = require('./schema');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch((e) => {
    console.warn('[document-rag]', e.message);
    if (!res.headersSent) _err(res, e.status || 500, e.message || 'Internal server error');
  });
}

const _upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 5 },
});

ensureDocumentRagSchema().catch((e) => console.warn('[document-rag] schema:', e.message));

router.get('/documents', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'document_rag:list' });
  if (!tid) return _err(res, 400, 'no_tenant');
  await ensureSharedIndexTable();
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;
  const source = req.query.source ? String(req.query.source) : null;
  const result = await listDocuments(tid, { limit, offset, source });
  res.json({ ok: true, ...result, hasOpenAI: _hasOpenAI() });
}));

router.post('/upload', _upload.array('files', 5), _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'document_rag:upload' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const files = req.files || (req.file ? [req.file] : []);
  if (!files.length) return _err(res, 400, 'file required (field: files)');

  const results = [];
  for (const file of files) {
    try {
      const parsed = await extractDocumentText(file);
      const sourceRef = `upload:${crypto.createHash('sha1').update(file.buffer).digest('hex').slice(0, 16)}:${parsed.name}`;
      const indexed = await upsertIndexedChunks({
        tenantId: tid,
        sourceRef,
        dataType: parsed.dataType,
        title: parsed.name,
        kind: parsed.kind,
        sourceLabel: 'Uploaded document',
        text: parsed.text,
        meta: {
          source: 'upload',
          filename: parsed.name,
          truncated: parsed.truncated,
          chars: parsed.chars,
        },
      });
      results.push({
        ok: true,
        name: parsed.name,
        kind: parsed.kind,
        chars: parsed.chars,
        truncated: parsed.truncated,
        ...indexed,
      });
      try {
        const { fireEvent } = require('../automation_bridge/dispatch');
        fireEvent(tid, 'document.indexed', {
          title: parsed.name,
          kind: parsed.kind,
          chunks: indexed.chunks,
        }).catch(() => {});
      } catch { /* optional bridge */ }
    } catch (e) {
      results.push({
        ok: false,
        name: file.originalname || 'file',
        error: e.message || 'upload-failed',
      });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  res.json({
    ok: okCount > 0,
    uploaded: okCount,
    failed: results.length - okCount,
    results,
    note: _hasOpenAI()
      ? 'Documents are searchable in Ask InfoGenie.'
      : 'Documents stored; add an OpenAI key to embed for semantic search.',
  });
}));

router.post('/ingest-text', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'document_rag:text' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const title = String(req.body?.title || 'Untitled note').trim().slice(0, 240);
  const text = String(req.body?.text || '').trim();
  if (text.length < 20) return _err(res, 400, 'text too short');
  const sourceRef = `text:${crypto.createHash('sha1').update(title + '\n' + text).digest('hex').slice(0, 20)}`;
  const indexed = await upsertIndexedChunks({
    tenantId: tid,
    sourceRef,
    dataType: 'document_txt',
    title,
    kind: 'txt',
    sourceLabel: 'Pasted text',
    text,
    meta: { source: 'paste' },
  });
  res.json({ ok: true, title, ...indexed });
}));

router.delete('/documents/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'document_rag:delete' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  const _db = require('../../db');
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const pool = _db.getPool();
  const row = await pool.query(
    `SELECT source_ref FROM rag_documents WHERE id=$1 AND tenant_id=$2`,
    [id, tid],
  );
  if (!row.rows.length) return _err(res, 404, 'not found');
  const sourceRef = row.rows[0].source_ref;
  const result = await deleteBySourceRef(tid, sourceRef);
  res.json({ ok: true, ...result });
}));

module.exports = router;

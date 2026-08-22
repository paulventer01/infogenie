'use strict';

const _https = require('https');
const _db = require('../../db');
const { chunkText, formatChunkContent } = require('./chunk');
const { ensureDocumentRagSchema } = require('./schema');

function _openAIKey() {
  return process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
}
function _hasOpenAI() {
  const k = _openAIKey();
  return k && !/^_DUMMY/i.test(k);
}

async function _openaiPost(path, body) {
  const key = _openAIKey();
  const payload = JSON.stringify(body);
  return new Promise((resolve) => {
    const req = _https.request({
      hostname: 'api.openai.com', path, method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => {
        try { resolve(r.statusCode === 200 ? JSON.parse(d) : null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(payload);
    req.end();
  });
}

async function embedBatch(texts) {
  if (!_hasOpenAI() || !texts.length) return texts.map(() => null);
  const r = await _openaiPost('/v1/embeddings', {
    model: 'text-embedding-3-small',
    input: texts.map((t) => String(t).slice(0, 8000)),
  });
  if (!r?.data) return texts.map(() => null);
  return r.data.map((d) => d.embedding || null);
}

async function ensureSharedIndexTable() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_search_index (
      id           SERIAL PRIMARY KEY,
      tenant_id    INTEGER NOT NULL,
      data_type    TEXT NOT NULL,
      content      TEXT NOT NULL,
      embedding    JSONB,
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await ensureDocumentRagSchema();
}

/**
 * Upsert chunks into platform_search_index keyed by source_ref.
 * Does NOT wipe platform-native index rows.
 */
async function upsertIndexedChunks({
  tenantId,
  sourceRef,
  dataType,
  title,
  kind,
  sourceLabel,
  text,
  meta = {},
}) {
  if (!_db.hasDb() || !tenantId || !sourceRef || !text) {
    return { chunks: 0, embedded: 0, documentId: null };
  }
  await ensureSharedIndexTable();
  const pool = _db.getPool();

  const pieces = chunkText(text);
  const contents = pieces.map((chunk, i) => formatChunkContent({
    title,
    kind,
    sourceLabel,
    chunk,
    index: i,
    total: pieces.length,
  }));

  // Embed in batches of 40
  const embeddings = [];
  for (let i = 0; i < contents.length; i += 40) {
    const slice = contents.slice(i, i + 40);
    const embs = await embedBatch(slice);
    embeddings.push(...embs);
  }

  await pool.query(
    `DELETE FROM platform_search_index WHERE tenant_id=$1 AND source_ref=$2`,
    [tenantId, sourceRef],
  );

  let embedded = 0;
  for (let i = 0; i < contents.length; i++) {
    const emb = embeddings[i];
    await pool.query(
      `INSERT INTO platform_search_index
         (tenant_id, data_type, content, embedding, updated_at, source_ref, meta_json)
       VALUES ($1,$2,$3,$4,NOW(),$5,$6)`,
      [
        tenantId,
        dataType,
        contents[i],
        emb ? JSON.stringify(emb) : null,
        sourceRef,
        JSON.stringify({ ...meta, title, kind, chunkIndex: i }),
      ],
    );
    if (emb) embedded++;
  }

  const titleSafe = String(title || 'Untitled').slice(0, 240);
  const kindSafe = kind || dataType;
  const sourceSafe = meta.source || 'upload';
  const chars = String(text).length;
  const metaJson = JSON.stringify(meta);

  const existing = await pool.query(
    `SELECT id FROM rag_documents WHERE tenant_id=$1 AND source_ref=$2 LIMIT 1`,
    [tenantId, sourceRef],
  );
  let documentId = existing.rows[0]?.id || null;
  if (documentId) {
    await pool.query(
      `UPDATE rag_documents
       SET title=$3, kind=$4, source=$5, chars=$6, chunk_count=$7,
           status='indexed', meta_json=$8, updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2`,
      [documentId, tenantId, titleSafe, kindSafe, sourceSafe, chars, contents.length, metaJson],
    );
  } else {
    const ins = await pool.query(
      `INSERT INTO rag_documents
         (tenant_id, title, kind, source, source_ref, chars, chunk_count, status, meta_json, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'indexed',$8,NOW())
       RETURNING id`,
      [tenantId, titleSafe, kindSafe, sourceSafe, sourceRef, chars, contents.length, metaJson],
    );
    documentId = ins.rows[0]?.id || null;
  }

  return { chunks: contents.length, embedded, documentId };
}

async function deleteBySourceRef(tenantId, sourceRef) {
  if (!_db.hasDb() || !tenantId || !sourceRef) return { deleted: 0 };
  const pool = _db.getPool();
  const r = await pool.query(
    `DELETE FROM platform_search_index WHERE tenant_id=$1 AND source_ref=$2`,
    [tenantId, sourceRef],
  );
  await pool.query(
    `DELETE FROM rag_documents WHERE tenant_id=$1 AND source_ref=$2`,
    [tenantId, sourceRef],
  );
  return { deleted: r.rowCount || 0 };
}

async function listDocuments(tenantId, { limit = 50, offset = 0, source = null } = {}) {
  if (!_db.hasDb() || !tenantId) return { items: [], total: 0 };
  const pool = _db.getPool();
  const params = [tenantId];
  let where = 'tenant_id=$1';
  if (source) {
    params.push(source);
    where += ` AND source=$${params.length}`;
  }
  const totalR = await pool.query(`SELECT COUNT(*)::int AS n FROM rag_documents WHERE ${where}`, params);
  params.push(Math.min(100, Math.max(1, limit)));
  params.push(Math.max(0, offset));
  const r = await pool.query(
    `SELECT id, title, kind, source, source_ref, chars, chunk_count, status, meta_json, created_at, updated_at
     FROM rag_documents
     WHERE ${where}
     ORDER BY updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: r.rows, total: totalR.rows[0]?.n || 0 };
}

module.exports = {
  upsertIndexedChunks,
  deleteBySourceRef,
  listDocuments,
  embedBatch,
  ensureSharedIndexTable,
  _hasOpenAI,
};

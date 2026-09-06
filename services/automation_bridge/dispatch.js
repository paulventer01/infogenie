'use strict';

const crypto = require('crypto');
const _db = require('../../db');
const { ensureAutomationBridgeSchema } = require('./schema');
const { TRIGGERS, ACTIONS } = require('./catalog');

function _safeUrl(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return null;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(host)) return null;
  return u.toString();
}

async function logDelivery(tid, row) {
  if (!_db.hasDb()) return;
  await ensureAutomationBridgeSchema();
  await _db.getPool().query(
    `INSERT INTO automation_bridge_deliveries
       (tenant_id, direction, provider, event_type, status, payload_json, response_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      tid,
      row.direction,
      row.provider || null,
      row.event_type || null,
      row.status,
      JSON.stringify(row.payload || {}),
      String(row.response_text || '').slice(0, 2000),
    ],
  );
}

async function fireEvent(tid, eventType, payload = {}) {
  if (!_db.hasDb() || !tid || !eventType) return { delivered: 0 };
  await ensureAutomationBridgeSchema();
  const pool = _db.getPool();
  const r = await pool.query(
    `SELECT id, provider, name, target_url, secret, triggers
     FROM automation_bridge_targets
     WHERE tenant_id=$1 AND enabled=TRUE`,
    [tid],
  );

  let delivered = 0;
  const body = {
    event: eventType,
    occurred_at: new Date().toISOString(),
    tenant_id: tid,
    data: payload,
  };

  for (const row of r.rows) {
    const triggers = Array.isArray(row.triggers) ? row.triggers : (row.triggers || []);
    const allowAll = !triggers.length || triggers.includes('*');
    if (!allowAll && !triggers.includes(eventType)) continue;

    const url = _safeUrl(row.target_url);
    if (!url) {
      await logDelivery(tid, {
        direction: 'outbound',
        provider: row.provider,
        event_type: eventType,
        status: 'rejected_url',
        payload: body,
        response_text: 'unsafe url',
      });
      continue;
    }

    try {
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'InfoGenie-AutomationBridge/1.0',
        'X-InfoGenie-Event': eventType,
      };
      if (row.secret) {
        const sig = crypto.createHmac('sha256', row.secret).update(JSON.stringify(body)).digest('hex');
        headers['X-InfoGenie-Signature'] = sig;
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        redirect: 'manual',
      });
      const text = await resp.text().catch(() => '');
      const ok = resp.status >= 200 && resp.status < 300;
      await logDelivery(tid, {
        direction: 'outbound',
        provider: row.provider,
        event_type: eventType,
        status: ok ? 'delivered' : `http_${resp.status}`,
        payload: body,
        response_text: text.slice(0, 500),
      });
      if (ok) delivered++;
    } catch (e) {
      await logDelivery(tid, {
        direction: 'outbound',
        provider: row.provider,
        event_type: eventType,
        status: 'error',
        payload: body,
        response_text: e.message,
      });
    }
  }
  return { delivered };
}

async function runInboundAction(tid, action, params = {}) {
  const known = ACTIONS.find((a) => a.id === action);
  if (!known) {
    const e = new Error('unknown_action');
    e.status = 400;
    throw e;
  }

  if (action === 'webhook.echo') {
    return { ok: true, echo: params };
  }

  if (action === 'memory.ingest') {
    const summary = String(params.summary || '').trim();
    if (summary.length < 8) {
      const e = new Error('summary required');
      e.status = 400;
      throw e;
    }
    const { ingestMemoryNode } = require('../knowledge_graph/api');
    const id = await ingestMemoryNode({
      tenant_id: tid,
      node_type: String(params.node_type || 'manual_observation'),
      summary,
      detail: params.detail || { via: 'automation_bridge' },
      source_ref: params.source_ref || `automation:${Date.now()}`,
      importance: Math.max(0, Math.min(1, Number(params.importance) || 0.5)),
    });
    fireEvent(tid, 'memory.ingested', { summary, node_type: params.node_type || 'manual_observation' }).catch(() => {});
    return { ok: true, memory_id: id };
  }

  if (action === 'document.ingest_text') {
    const title = String(params.title || 'Inbound note').trim().slice(0, 240);
    const text = String(params.text || '').trim();
    if (text.length < 20) {
      const e = new Error('text too short');
      e.status = 400;
      throw e;
    }
    const { upsertIndexedChunks } = require('../document_rag/index');
    const sourceRef = `automation:${crypto.createHash('sha1').update(title + text).digest('hex').slice(0, 16)}`;
    const indexed = await upsertIndexedChunks({
      tenantId: tid,
      sourceRef,
      dataType: 'document_txt',
      title,
      kind: 'txt',
      sourceLabel: 'Automation inbound',
      text,
      meta: { source: 'automation' },
    });
    fireEvent(tid, 'document.indexed', { title, kind: 'txt', chunks: indexed.chunks }).catch(() => {});
    return { ok: true, ...indexed };
  }

  if (action === 'task.create') {
    if (!_db.hasDb()) {
      const e = new Error('no-db');
      e.status = 503;
      throw e;
    }
    const officer = String(params.officer || 'ops').slice(0, 40);
    const title = String(params.title || '').trim().slice(0, 200);
    if (!title) {
      const e = new Error('title required');
      e.status = 400;
      throw e;
    }
    const notes = String(params.notes || '').slice(0, 2000);
    try {
      const r = await _db.getPool().query(
        `INSERT INTO officer_tasks_v1 (officer, title, notes, status, created_at)
         VALUES ($1,$2,$3,'open',NOW()) RETURNING id`,
        [officer, title, notes],
      );
      return { ok: true, task_id: r.rows[0]?.id };
    } catch (e) {
      // Fallback when schema differs — store in kv.
      const key = `auto_task:${tid}:${Date.now()}`;
      await _db.kvSet(key, { officer, title, notes, created_at: new Date().toISOString() });
      return { ok: true, task_key: key, note: 'stored_via_kv' };
    }
  }

  return { ok: false, error: 'unhandled_action' };
}

function listCatalog() {
  return { triggers: TRIGGERS, actions: ACTIONS };
}

module.exports = {
  fireEvent,
  runInboundAction,
  listCatalog,
  logDelivery,
  _safeUrl,
};

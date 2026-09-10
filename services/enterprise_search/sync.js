'use strict';

const _db = require('../../db');
const _vault = require('../credentials/vault');
const { ensureEnterpriseSearchSchema } = require('./schema');
const { upsertIndexedChunks, deleteBySourceRef } = require('../document_rag/index');
const { fetchSlackItems } = require('./connectors/slack');
const { fetchNotionItems } = require('./connectors/notion');
const { fetchDriveItems } = require('./connectors/drive');

const CONNECTORS = {
  slack: {
    label: 'Slack',
    vaultKeys: ['slack', 'slack_bot'],
    dataType: 'connector_slack',
    fetch: fetchSlackItems,
  },
  notion: {
    label: 'Notion',
    vaultKeys: ['notion'],
    dataType: 'connector_notion',
    fetch: fetchNotionItems,
  },
  google_drive: {
    label: 'Google Drive',
    vaultKeys: ['google_drive', 'gdrive', 'google'],
    dataType: 'connector_drive',
    fetch: fetchDriveItems,
  },
};

async function resolveToken(tid, connector) {
  const conf = CONNECTORS[connector];
  if (!conf) return null;
  for (const key of conf.vaultKeys) {
    try {
      const v = await _vault.getApiKey(tid, key);
      if (v && String(v).trim()) return String(v).trim();
    } catch { /* continue */ }
  }
  // Env fallbacks for local/dev
  const envMap = {
    slack: process.env.SLACK_BOT_TOKEN || process.env.SLACK_TOKEN,
    notion: process.env.NOTION_API_KEY || process.env.NOTION_TOKEN,
    google_drive: process.env.GOOGLE_DRIVE_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN,
  };
  return envMap[connector] || null;
}

async function setSyncState(tid, connector, patch) {
  if (!_db.hasDb()) return;
  await ensureEnterpriseSearchSchema();
  const pool = _db.getPool();
  await pool.query(
    `INSERT INTO enterprise_connector_sync
       (tenant_id, connector, status, last_sync_at, items_synced, chunks_indexed, error, meta_json, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (tenant_id, connector) DO UPDATE SET
       status = EXCLUDED.status,
       last_sync_at = COALESCE(EXCLUDED.last_sync_at, enterprise_connector_sync.last_sync_at),
       items_synced = EXCLUDED.items_synced,
       chunks_indexed = EXCLUDED.chunks_indexed,
       error = EXCLUDED.error,
       meta_json = EXCLUDED.meta_json,
       updated_at = NOW()`,
    [
      tid,
      connector,
      patch.status || 'idle',
      patch.last_sync_at || null,
      patch.items_synced || 0,
      patch.chunks_indexed || 0,
      patch.error || null,
      JSON.stringify(patch.meta_json || {}),
    ],
  );
}

async function syncConnector(tid, connector, opts = {}) {
  const conf = CONNECTORS[connector];
  if (!conf) {
    const e = new Error('unknown_connector');
    e.status = 400;
    throw e;
  }
  const token = await resolveToken(tid, connector);
  if (!token) {
    const e = new Error(`${connector}_not_connected`);
    e.status = 400;
    e.hint = `Save a ${conf.label} API token in Settings → Integrations, then sync again.`;
    throw e;
  }

  await setSyncState(tid, connector, { status: 'syncing', items_synced: 0, chunks_indexed: 0, error: null });

  try {
    const items = await conf.fetch(token, opts);
    let chunks = 0;
    let embedded = 0;
    for (const item of items) {
      const sourceRef = `${connector}:${item.id}`;
      const r = await upsertIndexedChunks({
        tenantId: tid,
        sourceRef,
        dataType: conf.dataType,
        title: item.title,
        kind: connector,
        sourceLabel: conf.label,
        text: item.text,
        meta: {
          source: connector,
          url: item.url || null,
          ...(item.meta || {}),
        },
      });
      chunks += r.chunks || 0;
      embedded += r.embedded || 0;
    }

    await setSyncState(tid, connector, {
      status: 'ok',
      last_sync_at: new Date().toISOString(),
      items_synced: items.length,
      chunks_indexed: chunks,
      error: null,
      meta_json: { embedded },
    });

    try {
      const { fireEvent } = require('../automation_bridge/dispatch');
      fireEvent(tid, 'connector.synced', {
        connector,
        items: items.length,
        chunks,
      }).catch(() => {});
    } catch { /* optional */ }

    return {
      ok: true,
      connector,
      items: items.length,
      chunks,
      embedded,
    };
  } catch (e) {
    await setSyncState(tid, connector, {
      status: 'error',
      items_synced: 0,
      chunks_indexed: 0,
      error: e.message || 'sync_failed',
    });
    throw e;
  }
}

async function clearConnector(tid, connector) {
  if (!_db.hasDb()) return { deleted: 0 };
  const pool = _db.getPool();
  const r = await pool.query(
    `DELETE FROM platform_search_index
     WHERE tenant_id=$1 AND data_type=$2`,
    [tid, CONNECTORS[connector]?.dataType || `connector_${connector}`],
  );
  await pool.query(
    `DELETE FROM rag_documents WHERE tenant_id=$1 AND source=$2`,
    [tid, connector],
  );
  await setSyncState(tid, connector, {
    status: 'idle',
    items_synced: 0,
    chunks_indexed: 0,
    error: null,
  });
  return { deleted: r.rowCount || 0 };
}

async function listStatus(tid) {
  await ensureEnterpriseSearchSchema();
  const out = [];
  for (const [id, conf] of Object.entries(CONNECTORS)) {
    const token = await resolveToken(tid, id);
    let row = null;
    if (_db.hasDb()) {
      const r = await _db.getPool().query(
        `SELECT status, last_sync_at, items_synced, chunks_indexed, error, meta_json, updated_at
         FROM enterprise_connector_sync WHERE tenant_id=$1 AND connector=$2`,
        [tid, id],
      );
      row = r.rows[0] || null;
    }
    out.push({
      id,
      label: conf.label,
      connected: !!token,
      status: row?.status || 'idle',
      last_sync_at: row?.last_sync_at || null,
      items_synced: row?.items_synced || 0,
      chunks_indexed: row?.chunks_indexed || 0,
      error: row?.error || null,
    });
  }
  return out;
}

module.exports = {
  CONNECTORS,
  syncConnector,
  clearConnector,
  listStatus,
  resolveToken,
  deleteBySourceRef,
};

'use strict';

const express = require('express');
const { BASE_DRAFT } = require('./composer-draft-fixtures');

function makeTxPool(state) {
  const tx = { active: false, locked: false };
  const client = {
    query: async (sql, params) => {
      if (sql === 'BEGIN') { tx.active = true; return { rows: [] }; }
      if (sql === 'ROLLBACK' || sql === 'COMMIT') { tx.active = false; tx.locked = false; return { rows: [] }; }
      if (sql.includes('FOR UPDATE')) {
        const [id, tid] = params;
        if (state.row.id === id && state.row.tenant_id === tid && state.row.status === 'draft' && !tx.locked) {
          tx.locked = true;
          return { rows: [{ ...state.row, draft: { ...state.row.draft } }] };
        }
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO audience_segments')) {
        state.segmentInserts.push({ sql, params });
        return { rows: [{ id: ++state.nextSegmentId }] };
      }
      if (sql.includes('SELECT * FROM campaign_composer_drafts') && !sql.includes('FOR UPDATE')) {
        const [id, tid] = params;
        if (state.row.id === id && state.row.tenant_id === tid) {
          return { rows: [{ ...state.row, draft: { ...state.row.draft } }] };
        }
        return { rows: [] };
      }
      if (sql.includes("UPDATE campaign_composer_drafts SET status = 'approved'")) {
        state.approveUpdates.push({ sql, params });
        const id = params[2];
        const tid = params[3];
        if (state.row.id === id && state.row.tenant_id === tid && state.row.status === 'draft') {
          state.row = {
            ...state.row,
            status: 'approved',
            segment_id: params[0],
            content_safety_warnings: JSON.parse(params[1]),
            updated_at: new Date().toISOString(),
          };
          return { rows: [{ ...state.row }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  return {
    query: client.query,
    connect: async () => client,
    tx,
  };
}

function createApproveMockState(overrides = {}) {
  return {
    row: {
      id: 42,
      tenant_id: 11,
      prompt: 'Nurture recent signups',
      draft: { ...BASE_DRAFT },
      content_safety_warnings: ['Existing warning should remain on block'],
      status: 'draft',
      segment_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(overrides.row || {}),
    },
    segmentInserts: [],
    approveUpdates: [],
    nextSegmentId: overrides.nextSegmentId ?? 500,
  };
}

function mountApproveRouter(state, apiPath) {
  delete require.cache[apiPath];
  const tenantCtx = require('../../services/tenants/context');
  tenantCtx.resolveTenantId = async (req) => Number(req.headers['x-test-tenant'] || 11);
  require('../../db').getPool = () => makeTxPool(state);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const tid = Number(req.headers['x-test-tenant'] || 11);
    req.user = { id: 3 };
    req.tenant = tid ? { id: tid, name: 'Test', slug: 'test', status: 'active' } : null;
    next();
  });
  app.use('/api/campaign-composer', require(apiPath));
  return app;
}

async function listenApproveApp(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

function postApprove(baseUrl, draftId = 42, tenant = 11, headers = {}) {
  return fetch(`${baseUrl}/api/campaign-composer/drafts/${draftId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-tenant': String(tenant), ...headers },
    body: JSON.stringify({}),
  });
}

module.exports = {
  makeTxPool,
  createApproveMockState,
  mountApproveRouter,
  listenApproveApp,
  postApprove,
};

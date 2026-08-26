'use strict';

const https = require('https');
const { fail } = require('../errors');
const {
  assertMetaCreateProviderDraftMutationAllowed,
} = require('../../security/advertising_provider_mutations');
const { metaGraphVersion } = require('./meta_graph_version');
const {
  validateApprovedSnapshotForMetaDraft,
  buildMetaPausedDraftRequests,
} = require('./meta_paused_draft_snapshot');

const GRAPH = 'graph.facebook.com';
const OBJECT_SEQUENCE = Object.freeze(['campaign', 'adset', 'creative', 'ad']);
const PAUSED = 'PAUSED';

function graphVersionPath(path) {
  return `/${metaGraphVersion()}${path}`;
}

function postForm(path, params) {
  const body = params.toString();
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: GRAPH,
      path: graphVersionPath(path),
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'InfoGenie-MetaPausedDraft/1.0',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch (_e) { parsed = { _raw: data }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function deleteObject(objectId, token) {
  const params = new URLSearchParams({ access_token: token });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: GRAPH,
      path: `${graphVersionPath(`/${encodeURIComponent(objectId)}`)}?${params}`,
      method: 'DELETE',
      headers: { 'User-Agent': 'InfoGenie-MetaPausedDraft/1.0' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch (_e) { parsed = { _raw: data }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

function materializeStep(step, ctx) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(step.params)) {
    let resolved = value;
    if (resolved === '$campaign_id') resolved = ctx.campaign_id;
    if (resolved === '$adset_id') resolved = ctx.adset_id;
    if (resolved === '$creative_id') resolved = ctx.creative_id;
    params.set(key, String(resolved));
  }
  return { path: step.path, params };
}

async function compensateCreated(created, token) {
  let compensated = 0;
  for (let i = created.length - 1; i >= 0; i -= 1) {
    const row = created[i];
    if (!row || !row.provider_object_id) continue;
    try {
      const res = await deleteObject(row.provider_object_id, token);
      if (res.status >= 200 && res.status < 300 && res.body && res.body.success === true) {
        compensated += 1;
        row.compensated = true;
      }
    } catch (_e) { /* best effort */ }
  }
  return compensated;
}

/**
 * Create the bounded four-object Meta graph synchronously. Every object is
 * PAUSED / non-delivering. Requires a consumed capability and credential
 * handle scoped to the execution callback.
 */
async function createPausedDraftGraph(input) {
  const capability = input && input.capability;
  assertMetaCreateProviderDraftMutationAllowed(capability);

  const creds = input && input.credentials;
  const snapshot = input && input.snapshot;
  const inject = input && input.inject;
  if (!creds || !creds.accessToken || !creds.adAccountId) fail('missing_credentials');
  if (!snapshot || typeof snapshot !== 'object') fail('validation_failed', { field: 'snapshot' });

  validateApprovedSnapshotForMetaDraft(snapshot, creds);
  const steps = buildMetaPausedDraftRequests(snapshot, creds);
  const token = String(creds.accessToken);
  const ctx = Object.create(null);
  const created = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const spec = materializeStep(step, ctx);
    spec.params.set('access_token', token);
    let response;
    try {
      if (inject && typeof inject.create === 'function') {
        response = await inject.create(step.kind, spec, ctx, created);
      } else {
        response = await postForm(spec.path, spec.params);
      }
    } catch (_transportErr) {
      const compensated = await compensateCreated(created, token);
      return Object.freeze({
        ok: false,
        partial: created.length > 0,
        objects: Object.freeze(created.slice()),
        objects_created: created.length,
        objects_compensated: compensated,
        error_code: 'provider_transport_failed',
        published: false,
        external_action_taken: created.length > 0,
        activated: false,
      });
    }
    if (!response || response.status < 200 || response.status >= 300 || !response.body || !response.body.id) {
      const code = response && response.body && response.body.error && response.body.error.code;
      const compensated = await compensateCreated(created, token);
      return Object.freeze({
        ok: false,
        partial: created.length > 0,
        objects: Object.freeze(created.slice()),
        objects_created: created.length,
        objects_compensated: compensated,
        error_code: code === 190 ? 'provider_auth_failed' : 'provider_create_failed',
        published: false,
        external_action_taken: created.length > 0,
        activated: false,
      });
    }
    const id = String(response.body.id);
    ctx[`${step.kind}_id`] = id;
    created.push(Object.freeze({
      object_kind: step.kind,
      provider_object_id: id,
      provider_status: PAUSED,
      sequence_number: i + 1,
      compensated: false,
    }));
    for (const obj of created) {
      if (obj.provider_status !== PAUSED) fail('validation_failed', { field: 'provider_status' });
    }
  }

  return Object.freeze({
    ok: true,
    partial: false,
    objects: Object.freeze(created.slice()),
    objects_created: created.length,
    objects_compensated: 0,
    error_code: null,
    published: false,
    external_action_taken: created.length === 4,
    activated: false,
  });
}

module.exports = {
  OBJECT_SEQUENCE,
  PAUSED,
  createPausedDraftGraph,
  compensateCreated,
  metaGraphVersion,
};

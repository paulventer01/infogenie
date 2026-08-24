'use strict';

const { fail } = require('./errors');
const { assertStorageRef } = require('./video_validate');
const { MIME } = require('./video_contracts');

const HONESTY = new Set(['fixture', 'synthetic', 'demo', 'test', 'mock']);
const MOD_SRC = new Set(['fixture', 'synthetic', 'internal']);

function createVideoRuntime(opts = {}) {
  return { generate: opts.generate || null, now: opts.now || null };
}

function hasBytes(v) {
  if (v == null) return false;
  if (Buffer.isBuffer(v) || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return true;
  if (typeof v !== 'object') return false;
  return Buffer.isBuffer(v.bytes) || Buffer.isBuffer(v.buffer) || Buffer.isBuffer(v.video_bytes)
    || v.bytes != null || v.video_bytes != null || v.buffer != null
    || (typeof v.data === 'string' && v.data.length > 0 && /base64|data:video/i.test(v.data));
}

function fixtureMeta(job, contract) {
  const tid = Number(job.tenant_id);
  return {
    storage_ref: `orchestrator/video/${tid}/${job.id}`,
    mime: MIME[contract && contract.output_format] || 'video/mp4',
    width: contract && contract.width_px, height: contract && contract.height_px,
    duration_ms: contract && contract.duration_ms, fps: contract && contract.fps,
    honesty_class: 'fixture', provenance: 'fixture',
    moderation: { status: 'passed', source: 'fixture' },
  };
}

async function completeVideoJob({ job, brief, contract, runtime }) {
  const rt = runtime || createVideoRuntime();
  const base = fixtureMeta(job, contract);
  let out = base;
  if (typeof rt.generate === 'function') {
    const raw = await rt.generate({ job, brief, contract, runtime: rt });
    if (hasBytes(raw)) fail('provider_malformed');
    if (!raw || typeof raw !== 'object' || Buffer.isBuffer(raw)) fail('provider_malformed');
    out = { ...base, ...raw };
  }
  if (hasBytes(out)) fail('provider_malformed');
  out.honesty_class = HONESTY.has(out.honesty_class) ? out.honesty_class : 'fixture';
  out.provenance = 'fixture';
  const mod = out.moderation && typeof out.moderation === 'object' ? out.moderation : {};
  const src = MOD_SRC.has(mod.source) ? mod.source : 'fixture';
  if (mod.status !== 'passed') fail('moderation_failed');
  out.moderation = { status: 'passed', source: src };
  assertStorageRef(out.storage_ref, job.tenant_id, job.id);
  return out;
}

module.exports = { createVideoRuntime, completeVideoJob };

'use strict';

const { fail } = require('./errors');
const { sha256Hex, canonicalize } = require('./hash');
const { normalizeKey } = require('./research_validate');
const C = require('./video_contracts');

const FORBIDDEN = new Set(C.FORBIDDEN.map(normalizeKey));
const ALLOW = {
  root: new Set(C.KEYS), scene: new Set(C.SCENE), copy: new Set(C.COPY),
  asset: new Set(C.ASSET), audio: new Set(C.AUDIO), safety: new Set(C.SAFETY), gen: new Set(C.GEN),
};

function vf(field, reason) { fail('validation_failed', { field, reason: reason || 'invalid' }); }
function isPlain(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}
function isVideoBrief(row) {
  return !!row && String(row.kind) === 'creative_brief'
    && !!row.payload && typeof row.payload === 'object' && row.payload.format === 'video';
}
function isImageBrief(row) {
  return !!row && String(row.kind) === 'creative_brief'
    && !!row.payload && typeof row.payload === 'object' && row.payload.format === 'image';
}
function txt(v, max) { return v == null ? '' : String(v).slice(0, max); }
function int(v, min, max, field) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) vf(field, 'out_of_range');
  return n;
}
function rejectUnknown(obj, allowed, field) {
  if (!isPlain(obj)) vf(field || 'object', 'not_object');
  for (const k of Object.keys(obj)) {
    if (FORBIDDEN.has(normalizeKey(k))) vf(k, 'forbidden');
    if (!allowed.has(k)) vf(field ? `${field}.${k}` : k, 'unknown');
  }
}
function walkForbidden(value) {
  if (value == null || typeof value !== 'object') return;
  if (Buffer.isBuffer(value)) vf('value', 'binary');
  if (Array.isArray(value)) { value.forEach(walkForbidden); return; }
  for (const k of Object.keys(value)) {
    if (FORBIDDEN.has(normalizeKey(k))) vf(k, 'forbidden');
    walkForbidden(value[k]);
  }
}

function validateContract(raw) {
  if (!isPlain(raw)) vf('contract', 'not_object');
  walkForbidden(raw);
  rejectUnknown(raw, ALLOW.root, '');
  const bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  if (bytes > C.MAX_JSON) vf('contract_json', 'oversized');
  if (raw.contract_version !== C.CONTRACT_VERSION) vf('contract_version', 'invalid');
  if (!C.ASPECT.includes(raw.aspect_ratio)) vf('aspect_ratio', 'invalid_enum');
  const [ew, eh] = C.DIMS[raw.aspect_ratio];
  const width_px = int(raw.width_px, 1, 7680, 'width_px');
  const height_px = int(raw.height_px, 1, 7680, 'height_px');
  if (width_px !== ew || height_px !== eh) vf('aspect_ratio', 'dimension_mismatch');
  const duration_ms = int(raw.duration_ms, C.DURATION.min, C.DURATION.max, 'duration_ms');
  const fps = int(raw.fps, 1, 60, 'fps');
  if (!C.FPS.includes(fps)) vf('fps', 'invalid_enum');
  if (!Array.isArray(raw.scenes) || raw.scenes.length < 1 || raw.scenes.length > C.MAX_SCENES) vf('scenes', 'invalid');
  const scenes = raw.scenes.map((s, i) => {
    rejectUnknown(s, ALLOW.scene, `scenes[${i}]`);
    const start_ms = int(s.start_ms, 0, duration_ms, `scenes[${i}].start_ms`);
    const end_ms = int(s.end_ms, start_ms + 1, duration_ms, `scenes[${i}].end_ms`);
    return {
      index: int(s.index, 0, C.MAX_SCENES - 1, `scenes[${i}].index`),
      start_ms, end_ms, visual_direction: txt(s.visual_direction, C.TEXT),
    };
  });
  rejectUnknown(raw.copy, ALLOW.copy, 'copy');
  const captions = Array.isArray(raw.copy.captions) ? raw.copy.captions.map((c) => txt(c, 500)) : vf('copy.captions', 'not_array');
  if (!Array.isArray(raw.source_assets)) vf('source_assets', 'not_array');
  const source_assets = raw.source_assets.map((a, i) => {
    rejectUnknown(a, ALLOW.asset, `source_assets[${i}]`);
    const asset_id = String(a.asset_id || '');
    if (!C.ASSET_ID_RE.test(asset_id)) vf(`source_assets[${i}].asset_id`, 'invalid');
    return { asset_id };
  });
  rejectUnknown(raw.audio, ALLOW.audio, 'audio');
  rejectUnknown(raw.safety, ALLOW.safety, 'safety');
  rejectUnknown(raw.generation_settings, ALLOW.gen, 'generation_settings');
  if (raw.safety.moderation_required !== true) vf('safety.moderation_required', 'required');
  if (!Array.isArray(raw.safety.prohibited_claims)) vf('safety.prohibited_claims', 'not_array');
  if (!C.FORMATS.includes(raw.output_format)) vf('output_format', 'invalid_enum');
  if (typeof raw.audio.voice_required !== 'boolean') vf('audio.voice_required', 'not_boolean');
  return {
    contract_version: C.CONTRACT_VERSION, aspect_ratio: raw.aspect_ratio, width_px, height_px,
    duration_ms, fps, scenes, visual_direction: txt(raw.visual_direction, C.TEXT),
    copy: { primary: txt(raw.copy.primary, C.TEXT), captions, cta: txt(raw.copy.cta, 200) },
    source_assets, audio: { voice_required: raw.audio.voice_required, notes: txt(raw.audio.notes, 500) },
    output_format: raw.output_format,
    safety: { moderation_required: true, prohibited_claims: raw.safety.prohibited_claims.map((p) => txt(p, 500)) },
    generation_settings: { style: txt(raw.generation_settings.style, 64), pacing: txt(raw.generation_settings.pacing, 64) },
  };
}

function deriveContract(artifact) {
  if (!isVideoBrief(artifact)) fail('approval_scope_mismatch');
  const p = isPlain(artifact.payload) ? artifact.payload : {};
  const ratio = C.ASPECT.includes(p.aspect_ratio) ? p.aspect_ratio : '9:16';
  const [width_px, height_px] = C.DIMS[ratio];
  let duration_ms = Number(p.duration_ms);
  if (!Number.isInteger(duration_ms) || duration_ms < C.DURATION.min || duration_ms > C.DURATION.max) duration_ms = 15000;
  const fps = C.FPS.includes(Number(p.fps)) ? Number(p.fps) : 30;
  const visual_direction = txt(p.visual_direction || p.script_or_storyboard
    || (p.primary_message && p.primary_message.text) || 'Approved video brief', C.TEXT);
  const primary = txt((p.primary_message && p.primary_message.text) || p.objective || visual_direction, C.TEXT);
  const scenes = Array.isArray(p.scenes) && p.scenes.length
    ? p.scenes.slice(0, C.MAX_SCENES).map((s, i) => ({
      index: Number.isInteger(s && s.index) ? s.index : i,
      start_ms: Number(s && s.start_ms) || 0,
      end_ms: Number(s && s.end_ms) || duration_ms,
      visual_direction: txt((s && s.visual_direction) || visual_direction, C.TEXT),
    }))
    : [{ index: 0, start_ms: 0, end_ms: duration_ms, visual_direction }];
  const assets = Array.isArray(p.source_assets)
    ? p.source_assets.map((a) => ({ asset_id: String((a && a.asset_id) || '') })).filter((a) => C.ASSET_ID_RE.test(a.asset_id))
    : [];
  const audio = isPlain(p.audio) ? p.audio : {};
  const gen = isPlain(p.generation_settings) ? p.generation_settings : {};
  const claims = Array.isArray(p.prohibited_claims) ? p.prohibited_claims.map((c) => txt(c, 500)).filter(Boolean).slice(0, 20) : [];
  return validateContract({
    contract_version: C.CONTRACT_VERSION, aspect_ratio: ratio, width_px, height_px, duration_ms, fps, scenes,
    visual_direction, copy: { primary, captions: Array.isArray(p.captions) ? p.captions.map((c) => txt(c, 500)).slice(0, 12) : [], cta: txt(p.call_to_action || 'Learn more', 200) },
    source_assets: assets, audio: { voice_required: audio.voice_required === true, notes: txt(audio.notes, 500) },
    output_format: C.FORMATS.includes(p.output_format) ? p.output_format : 'mp4',
    safety: { moderation_required: true, prohibited_claims: claims },
    generation_settings: { style: txt(gen.style || 'neutral', 64), pacing: txt(gen.pacing || 'medium', 64) },
  });
}

function contractHash(contract) { return sha256Hex(canonicalize(contract)); }

function generationRequestHash(f) {
  return sha256Hex({
    proposal_id: String(f.proposal_id), proposal_version: Number(f.proposal_version),
    proposal_content_hash: String(f.proposal_content_hash), approval_id: Number(f.approval_id),
    approval_hash: String(f.approval_hash), workflow_id: String(f.workflow_id),
    contract_hash: String(f.contract_hash), estimated_max_cost_micros: Number(f.estimated_max_cost_micros),
    contract: C.CONTRACT_VERSION,
  });
}

function assertStorageRef(ref, tenantId, jobId) {
  const expected = `orchestrator/video/${Number(tenantId)}/${jobId}`;
  if (String(ref || '') !== expected) fail('provider_malformed');
  const m = C.STORAGE_RE.exec(expected);
  if (!m || Number(m[1]) !== Number(tenantId) || m[2] !== String(jobId)) fail('provider_malformed');
  return expected;
}

module.exports = {
  isVideoBrief, isImageBrief, validateContract, deriveContract, contractHash,
  generationRequestHash, assertStorageRef,
};

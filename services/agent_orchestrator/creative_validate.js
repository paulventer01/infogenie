'use strict';

const { fail } = require('./errors');
const { sha256Hex, canonicalize } = require('./hash');
const C = require('./creative_contracts');
const {
  boundedText,
  redactContactPii,
  stripUnknown,
  assertNoForbiddenFields,
  assertNoBinaryDeep,
  assertNoCredentialMaterialDeep,
  assertNoHonestyFlagsDeep,
  assertHttpsUrl,
  contextTenant,
  resolveTenant,
  deepFreeze,
  normalizeKey,
} = require('./research_validate');

const HEX64 = /^[0-9a-f]{64}$/;
const EXTRA_FORBIDDEN = new Set(C.EXTRA_FORBIDDEN_KEYS.map(normalizeKey));
const ALLOWED_BY_KIND = Object.freeze({
  angle: C.ANGLE_ALLOWED,
  hook: C.HOOK_ALLOWED,
  message: C.MESSAGE_ALLOWED,
  claim: C.CLAIM_ALLOWED,
  creative_concept: C.CONCEPT_ALLOWED,
  creative_brief: C.BRIEF_ALLOWED,
});

function vf(field, reason) {
  fail('validation_failed', { field, reason: reason || 'invalid' });
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}

function assertEnum(v, allowed, field, { optional = false } = {}) {
  if (v == null || v === '') {
    if (optional) return null;
    vf(field, 'required');
  }
  const s = String(v).trim();
  if (!allowed.includes(s)) vf(field, 'invalid_enum');
  return s;
}

function assertSha256Hex(v, field) {
  if (v == null || v === '') vf(field, 'required');
  const s = String(v).trim().toLowerCase();
  if (!HEX64.test(s)) vf(field, 'not_sha256_hex');
  return s;
}

function requiredId(v, field) {
  return boundedText(v, C.LIMITS.id.min, C.LIMITS.id.max, field, { allowEmpty: false });
}

function optionalId(v, field) {
  if (v == null || v === '') return null;
  return requiredId(v, field);
}

function requiredTime(v, field) {
  if (v == null || v === '') vf(field, 'required');
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) vf(field, 'invalid_time');
  return d.toISOString();
}

function optionalTime(v, field) {
  if (v == null || v === '') return null;
  return requiredTime(v, field);
}

function asBoundedInt(v, min, max, field) {
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < min || n > max) vf(field, 'out_of_range');
  return n;
}

function utf8Bytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch (_) {
    vf('json', 'unserializable');
  }
}

function detachJson(value, field) {
  let out;
  try {
    out = JSON.parse(JSON.stringify(value));
  } catch (_) {
    vf(field || 'json', 'unserializable');
  }
  return deepFreeze(out);
}

function assertNoExtraForbidden(obj) {
  const seen = new Set();
  function walk(value) {
    if (value == null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const k of Object.keys(value)) {
      if (EXTRA_FORBIDDEN.has(normalizeKey(k))) vf(k, 'forbidden');
      walk(value[k]);
    }
  }
  walk(obj);
}

function assertNoPiiValue(s, field) {
  if (s == null || s === '') return s;
  const redacted = redactContactPii(String(s));
  if (redacted !== String(s)) vf(field, 'pii');
  return s;
}

function publicCopy(s, max, field) {
  const text = boundedText(s, 1, max, field, { allowEmpty: false });
  return redactContactPii(text);
}

function optionalCopy(s, max, field) {
  if (s == null || s === '') return '';
  const text = boundedText(s, 0, max, field);
  return redactContactPii(text);
}

function assertTargeting(raw, field) {
  if (raw == null || raw === '') return null;
  if (!isPlainObject(raw)) vf(field, 'not_object');
  const t = stripUnknown(raw, C.TARGETING_ALLOWED);
  return detachJson({
    platform: assertEnum(t.platform, C.PLATFORMS, `${field}.platform`, { optional: true }),
    placement: t.placement == null || t.placement === ''
      ? null
      : boundedText(t.placement, C.LIMITS.placement.min, C.LIMITS.placement.max, `${field}.placement`, { allowEmpty: false }),
    format: assertEnum(t.format, C.FORMATS, `${field}.format`, { optional: true }),
  }, field);
}

function assertCitation(input, opts, index) {
  const field = index == null ? 'citation' : `citations[${index}]`;
  if (!isPlainObject(input)) vf(field, 'not_object');
  assertNoForbiddenFields(input);
  assertNoExtraForbidden(input);
  assertNoBinaryDeep(input, field);
  const raw = stripUnknown(input, C.CITATION_ALLOWED);
  const tenant_id = resolveTenant(input, contextTenant(opts));
  const evidence_id = requiredId(raw.evidence_id, `${field}.evidence_id`);
  const research_run_id = requiredId(raw.research_run_id, `${field}.research_run_id`);
  const workflow_id = requiredId(raw.workflow_id, `${field}.workflow_id`);
  const evidence_fingerprint = assertSha256Hex(raw.evidence_fingerprint, `${field}.evidence_fingerprint`);
  const evidence_hash = raw.evidence_hash == null || raw.evidence_hash === ''
    ? evidence_fingerprint
    : assertSha256Hex(raw.evidence_hash, `${field}.evidence_hash`);
  if (evidence_hash !== evidence_fingerprint) vf(`${field}.evidence_hash`, 'mismatch');
  const honesty_class = assertEnum(raw.honesty_class, C.HONESTY_CLASSES, `${field}.honesty_class`);
  const source_label = raw.source_label == null || raw.source_label === ''
    ? honesty_class
    : assertEnum(raw.source_label, C.HONESTY_CLASSES, `${field}.source_label`);
  if (C.NON_LIVE_HONESTY.includes(honesty_class) && C.LIVE_HONESTY.includes(source_label)) {
    vf(`${field}.source_label`, 'fixture_as_live');
  }
  const source_url = assertHttpsUrl(raw.source_url, `${field}.source_url`, { optional: true });
  const platform_source_id = raw.platform_source_id == null || raw.platform_source_id === ''
    ? null
    : boundedText(raw.platform_source_id, C.LIMITS.platform_source_id.min, C.LIMITS.platform_source_id.max, `${field}.platform_source_id`, { allowEmpty: false });
  if (!source_url && !platform_source_id) vf(`${field}.source`, 'missing_source_identifier');
  return detachJson({
    tenant_id,
    evidence_id,
    research_run_id,
    workflow_id,
    source_url,
    platform_source_id,
    evidence_fingerprint,
    evidence_hash,
    snapshot_version: raw.snapshot_version == null || raw.snapshot_version === ''
      ? evidence_fingerprint
      : boundedText(raw.snapshot_version, 1, 128, `${field}.snapshot_version`, { allowEmpty: false }),
    honesty_class,
    source_label,
    captured_at: optionalTime(raw.captured_at, `${field}.captured_at`),
    expires_at: optionalTime(raw.expires_at, `${field}.expires_at`),
    contract_version: raw.contract_version == null || raw.contract_version === ''
      ? C.CONTRACT_VERSION
      : assertEnum(raw.contract_version, [C.CONTRACT_VERSION], `${field}.contract_version`),
  }, field);
}

function assertCitations(raw, opts) {
  if (raw == null) return Object.freeze([]);
  if (!Array.isArray(raw)) vf('citations', 'not_array');
  if (raw.length > C.LIMITS.citations.max) vf('citations', 'too_many');
  const out = raw.map((c, i) => assertCitation(c, opts, i));
  const seen = new Set();
  for (const c of out) {
    if (seen.has(c.evidence_id)) vf('citations', 'duplicate_evidence');
    seen.add(c.evidence_id);
  }
  return Object.freeze(out);
}

function mergeCitationLists(lists) {
  const byId = new Map();
  for (const list of lists) {
    if (!list) continue;
    for (const c of list) {
      const prev = byId.get(c.evidence_id);
      if (prev) {
        if (prev.evidence_fingerprint !== c.evidence_fingerprint) vf('citations', 'fingerprint_mismatch');
        continue;
      }
      byId.set(c.evidence_id, c);
    }
  }
  if (byId.size > C.LIMITS.citations.max) vf('citations', 'too_many');
  return Object.freeze([...byId.values()]);
}

function assertSourceEvidenceIds(raw, citations) {
  if (raw == null) {
    return Object.freeze(citations.map((c) => c.evidence_id));
  }
  if (!Array.isArray(raw)) vf('source_evidence_ids', 'not_array');
  if (raw.length > C.LIMITS.source_evidence_ids.max) vf('source_evidence_ids', 'too_many');
  const ids = raw.map((id, i) => requiredId(id, `source_evidence_ids[${i}]`));
  const cited = new Set(citations.map((c) => c.evidence_id));
  for (const id of ids) {
    if (!cited.has(id)) vf('source_evidence_ids', 'uncited');
  }
  return Object.freeze(ids);
}

function assertClaimShape(raw, opts, field, citations) {
  const text = publicCopy(raw.text, C.LIMITS.text_claim.max, `${field}.text`);
  const claim_kind = assertEnum(raw.claim_kind, C.CLAIM_KINDS, `${field}.claim_kind`);
  const evidence_backed = raw.evidence_backed === true;
  const localCitations = raw.citations == null ? citations : assertCitations(raw.citations, opts);
  if (claim_kind !== 'factual' && evidence_backed) vf(`${field}.evidence_backed`, 'unsupported_claim');
  if (claim_kind === 'factual' && evidence_backed && localCitations.length < 1) {
    vf(`${field}.citations`, 'citation_required');
  }
  return { text, claim_kind, evidence_backed, citations: localCitations };
}

function assertGenerationRequirements(raw) {
  if (raw == null || raw === '') {
    return detachJson({ static_images: 0, videos: 0, notes: '' }, 'estimated_generation_requirements');
  }
  if (!isPlainObject(raw)) vf('estimated_generation_requirements', 'not_object');
  const t = stripUnknown(raw, C.GENERATION_REQ_ALLOWED);
  return detachJson({
    static_images: t.static_images == null || t.static_images === ''
      ? 0
      : asBoundedInt(t.static_images, C.LIMITS.static_images.min, C.LIMITS.static_images.max, 'estimated_generation_requirements.static_images'),
    videos: t.videos == null || t.videos === ''
      ? 0
      : asBoundedInt(t.videos, C.LIMITS.videos.min, C.LIMITS.videos.max, 'estimated_generation_requirements.videos'),
    notes: optionalCopy(t.notes, C.LIMITS.generation_notes.max, 'estimated_generation_requirements.notes'),
  }, 'estimated_generation_requirements');
}

function computeEvidenceHash(citations) {
  const rows = (citations || []).map((c) => ({
    evidence_id: c.evidence_id,
    evidence_fingerprint: c.evidence_fingerprint,
    honesty_class: c.honesty_class,
  })).sort((a, b) => String(a.evidence_id).localeCompare(String(b.evidence_id)));
  return sha256Hex(canonicalize(rows));
}

function computeContentHash(payload) {
  const subset = {};
  for (const k of C.CONTENT_HASH_FIELDS) {
    if (payload[k] !== undefined) subset[k] = payload[k];
  }
  return sha256Hex(canonicalize(subset));
}

function materialChanged(before, after) {
  for (const f of C.MATERIAL_FIELDS) {
    const a = canonicalize(before && before[f] != null ? before[f] : null);
    const b = canonicalize(after && after[f] != null ? after[f] : null);
    if (JSON.stringify(a) !== JSON.stringify(b)) return true;
  }
  return false;
}

function prepareKind(input, kind) {
  if (!isPlainObject(input)) vf(kind, 'not_object');
  assertNoForbiddenFields(input);
  assertNoExtraForbidden(input);
  assertNoBinaryDeep(input, kind);
  assertNoHonestyFlagsDeep(input, kind);
  assertNoCredentialMaterialDeep(input, kind);
  const allowed = ALLOWED_BY_KIND[kind];
  if (!allowed) vf('kind', 'invalid_enum');
  return stripUnknown(input, allowed);
}

function assertEnvelope(raw, input, opts, kind) {
  const tenant_id = resolveTenant(input, contextTenant(opts));
  const contract_version = raw.contract_version == null || raw.contract_version === ''
    ? C.CONTRACT_VERSION
    : (() => {
      const s = String(raw.contract_version).trim();
      if (s !== C.CONTRACT_VERSION) vf('contract_version', 'unsupported');
      return C.CONTRACT_VERSION;
    })();
  const citations = assertCitations(raw.citations, opts);
  const source_evidence_ids = assertSourceEvidenceIds(raw.source_evidence_ids, citations);
  const confidence = assertEnum(raw.confidence, C.CONFIDENCE, 'confidence', { optional: true }) || 'unverified';
  let limitations = optionalCopy(raw.limitations, C.LIMITS.limitations.max, 'limitations');
  return {
    id: requiredId(raw.id, 'id'),
    artifact_id: optionalId(raw.artifact_id, 'artifact_id') || requiredId(raw.id, 'id'),
    kind,
    tenant_id,
    workflow_id: requiredId(raw.workflow_id, 'workflow_id'),
    research_run_id: requiredId(raw.research_run_id, 'research_run_id'),
    citations,
    source_evidence_ids,
    confidence,
    limitations,
    created_at: raw.created_at == null || raw.created_at === '' ? new Date().toISOString() : requiredTime(raw.created_at, 'created_at'),
    contract_version,
  };
}

function finalize(payload) {
  if (utf8Bytes(payload) > C.LIMITS.payload_bytes) vf('payload', 'oversized');
  const content_hash = computeContentHash(payload);
  const evidence_hash = computeEvidenceHash(payload.citations);
  return detachJson({ ...payload, content_hash, evidence_hash }, 'payload');
}

function assertTextKind(kind, textLimit, input, opts) {
  const raw = prepareKind(input, kind);
  const env = assertEnvelope(raw, input, opts, kind);
  const evidence_backed = raw.evidence_backed === true;
  if (evidence_backed && env.citations.length < 1) vf('citations', 'citation_required');
  const out = {
    ...env,
    text: publicCopy(raw.text, textLimit, 'text'),
    claim_kind: assertEnum(raw.claim_kind, C.CLAIM_KINDS, 'claim_kind', { optional: true }) || 'creative_interpretation',
    evidence_backed,
  };
  if (kind === 'angle' || kind === 'hook') out.targeting = assertTargeting(raw.targeting, 'targeting');
  return finalize(out);
}

function assertAngle(input, opts) {
  return assertTextKind('angle', C.LIMITS.text_angle.max, input, opts);
}

function assertHook(input, opts) {
  return assertTextKind('hook', C.LIMITS.text_hook.max, input, opts);
}

function assertMessage(input, opts) {
  return assertTextKind('message', C.LIMITS.text_message.max, input, opts);
}

function assertClaim(input, opts) {
  const raw = prepareKind(input, 'claim');
  const env = assertEnvelope(raw, input, opts, 'claim');
  const shaped = assertClaimShape(raw, opts, 'claim', env.citations);
  const citations = shaped.citations;
  const source_evidence_ids = assertSourceEvidenceIds(raw.source_evidence_ids, citations);
  let confidence = env.confidence;
  if (shaped.claim_kind === 'factual' && !shaped.evidence_backed) confidence = 'unverified';
  return finalize({
    ...env,
    citations,
    source_evidence_ids,
    confidence,
    text: shaped.text,
    claim_kind: shaped.claim_kind,
    evidence_backed: shaped.evidence_backed,
  });
}

function assertCreativeConcept(input, opts) {
  const raw = prepareKind(input, 'creative_concept');
  const env = assertEnvelope(raw, input, opts, 'creative_concept');
  return finalize({
    ...env,
    title: publicCopy(raw.title, C.LIMITS.title.max, 'title'),
    summary: publicCopy(raw.summary, C.LIMITS.summary.max, 'summary'),
    visual_direction: optionalCopy(raw.visual_direction, C.LIMITS.visual_direction.max, 'visual_direction'),
    targeting: assertTargeting(raw.targeting, 'targeting'),
    angle_id: optionalId(raw.angle_id, 'angle_id'),
    hook_id: optionalId(raw.hook_id, 'hook_id'),
  });
}

function assertNestedAngle(raw, opts, citations) {
  if (!isPlainObject(raw)) vf('angle', 'not_object');
  const text = publicCopy(raw.text, C.LIMITS.text_angle.max, 'angle.text');
  return detachJson({
    id: optionalId(raw.id, 'angle.id'),
    text,
    targeting: assertTargeting(raw.targeting, 'angle.targeting'),
    citations: raw.citations == null ? citations : assertCitations(raw.citations, opts),
  }, 'angle');
}

function assertNestedHook(raw, opts, citations) {
  if (!isPlainObject(raw)) vf('hook', 'not_object');
  return detachJson({
    id: optionalId(raw.id, 'hook.id'),
    text: publicCopy(raw.text, C.LIMITS.text_hook.max, 'hook.text'),
    targeting: assertTargeting(raw.targeting, 'hook.targeting'),
    citations: raw.citations == null ? citations : assertCitations(raw.citations, opts),
  }, 'hook');
}

function assertNestedMessage(raw, opts, citations) {
  if (!isPlainObject(raw)) vf('primary_message', 'not_object');
  return detachJson({
    id: optionalId(raw.id, 'primary_message.id'),
    text: publicCopy(raw.text, C.LIMITS.text_message.max, 'primary_message.text'),
    citations: raw.citations == null ? citations : assertCitations(raw.citations, opts),
  }, 'primary_message');
}

function assertSupportingClaims(raw, opts, citations) {
  if (raw == null) return Object.freeze([]);
  if (!Array.isArray(raw)) vf('supporting_claims', 'not_array');
  if (raw.length > C.LIMITS.supporting_claims.max) vf('supporting_claims', 'too_many');
  return Object.freeze(raw.map((c, i) => {
    if (!isPlainObject(c)) vf(`supporting_claims[${i}]`, 'not_object');
    const shaped = assertClaimShape(c, opts, `supporting_claims[${i}]`, citations);
    return detachJson({
      id: optionalId(c.id, `supporting_claims[${i}].id`),
      text: shaped.text,
      claim_kind: shaped.claim_kind,
      evidence_backed: shaped.evidence_backed,
      citations: shaped.citations,
    }, `supporting_claims[${i}]`);
  }));
}

function assertCreativeBrief(input, opts) {
  const raw = prepareKind(input, 'creative_brief');
  const env = assertEnvelope(raw, input, opts, 'creative_brief');
  const audience = assertNoPiiValue(
    boundedText(raw.target_audience, C.LIMITS.target_audience.min, C.LIMITS.target_audience.max, 'target_audience', { allowEmpty: false }),
    'target_audience'
  );
  const offer = assertNoPiiValue(optionalCopy(raw.offer, C.LIMITS.offer.max, 'offer'), 'offer');
  const cta = assertNoPiiValue(
    publicCopy(raw.call_to_action, C.LIMITS.call_to_action.max, 'call_to_action'),
    'call_to_action'
  );
  const prohibited = raw.prohibited_claims == null ? [] : raw.prohibited_claims;
  if (!Array.isArray(prohibited)) vf('prohibited_claims', 'not_array');
  if (prohibited.length > C.LIMITS.prohibited_claims.max) vf('prohibited_claims', 'too_many');
  const supporting = assertSupportingClaims(raw.supporting_claims, opts, env.citations);
  const angle = assertNestedAngle(raw.angle, opts, env.citations);
  const hook = assertNestedHook(raw.hook, opts, env.citations);
  const primary_message = assertNestedMessage(raw.primary_message, opts, env.citations);
  const citations = mergeCitationLists([
    env.citations,
    angle.citations,
    hook.citations,
    primary_message.citations,
    ...supporting.map((c) => c.citations),
  ]);
  for (const claim of supporting) {
    if (claim.claim_kind === 'factual' && claim.evidence_backed && claim.citations.length < 1 && citations.length < 1) {
      vf('supporting_claims', 'citation_required');
    }
  }
  return finalize({
    ...env,
    citations,
    source_evidence_ids: assertSourceEvidenceIds(
      raw.source_evidence_ids == null ? citations.map((c) => c.evidence_id) : raw.source_evidence_ids,
      citations
    ),
    objective: publicCopy(raw.objective, C.LIMITS.objective.max, 'objective'),
    target_audience: audience,
    platform: assertEnum(raw.platform, C.PLATFORMS, 'platform'),
    placement: boundedText(raw.placement, C.LIMITS.placement.min, C.LIMITS.placement.max, 'placement', { allowEmpty: false }),
    format: assertEnum(raw.format, C.FORMATS, 'format'),
    angle,
    hook,
    primary_message,
    supporting_claims: supporting,
    offer,
    call_to_action: cta,
    visual_direction: optionalCopy(raw.visual_direction, C.LIMITS.visual_direction.max, 'visual_direction'),
    script_or_storyboard: optionalCopy(raw.script_or_storyboard, C.LIMITS.script_or_storyboard.max, 'script_or_storyboard'),
    compliance_notes: assertNoPiiValue(
      optionalCopy(raw.compliance_notes, C.LIMITS.compliance_notes.max, 'compliance_notes'),
      'compliance_notes'
    ),
    prohibited_claims: Object.freeze(prohibited.map((p, i) => (
      boundedText(p, C.LIMITS.prohibited_claim.min, C.LIMITS.prohibited_claim.max, `prohibited_claims[${i}]`, { allowEmpty: false })
    ))),
    estimated_generation_requirements: assertGenerationRequirements(raw.estimated_generation_requirements),
    approval_status: 'draft',
  });
}

function assertCreativeArtifact(input, opts) {
  const kind = assertEnum(input && input.kind, C.ARTIFACT_KINDS, 'kind');
  if (kind === 'angle') return assertAngle(input, opts);
  if (kind === 'hook') return assertHook(input, opts);
  if (kind === 'message') return assertMessage(input, opts);
  if (kind === 'claim') return assertClaim(input, opts);
  if (kind === 'creative_concept') return assertCreativeConcept(input, opts);
  return assertCreativeBrief(input, opts);
}

function approvalContentHash(contentHash, evidenceHash) {
  return sha256Hex(canonicalize({
    content_hash: assertSha256Hex(contentHash, 'content_hash'),
    evidence_hash: assertSha256Hex(evidenceHash, 'evidence_hash'),
    contract_version: C.CONTRACT_VERSION,
  }));
}

module.exports = {
  assertCitation,
  assertCitations,
  assertAngle,
  assertHook,
  assertMessage,
  assertClaim,
  assertCreativeConcept,
  assertCreativeBrief,
  assertCreativeArtifact,
  computeContentHash,
  computeEvidenceHash,
  approvalContentHash,
  materialChanged,
};

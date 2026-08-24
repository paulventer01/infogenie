'use strict';

// Frozen v1 evidence-to-brief contracts. Enums and size limits match
// services/agent_orchestrator/schema.js PR4A CHECKs. Data-only: no HTTP,
// no LLM, no generation, no publishing.

const { PLATFORMS, FORBIDDEN_KEYS, POLLUTION_KEYS, HONESTY_FORBIDDEN_KEYS } = require('./research_contracts');

const CONTRACT_VERSION = 'v1';

const ARTIFACT_KINDS = Object.freeze([
  'angle',
  'hook',
  'message',
  'claim',
  'creative_concept',
  'creative_brief',
]);

const ARTIFACT_STATES = Object.freeze(['draft', 'approved', 'invalidated', 'superseded']);
const CLAIM_KINDS = Object.freeze(['factual', 'opinion', 'hypothesis', 'creative_interpretation']);
const CONFIDENCE = Object.freeze(['high', 'medium', 'low', 'unverified']);
const FORMATS = Object.freeze(['image', 'video', 'carousel', 'text']);
const HONESTY_CLASSES = Object.freeze([
  'fixture', 'simulated', 'demo', 'synthetic', 'test', 'mock',
  'sample', 'placeholder', 'template', 'live', 'provider',
]);
const NON_LIVE_HONESTY = Object.freeze([
  'fixture', 'simulated', 'demo', 'synthetic', 'test', 'mock',
  'sample', 'placeholder', 'template',
]);
const LIVE_HONESTY = Object.freeze(['live', 'provider']);
const AUDIT_EVENTS = Object.freeze([
  'created', 'revised', 'approved', 'invalidated', 'superseded', 'approval_rejected',
]);
const APPROVAL_GATE = 'creative_generation';
const APPROVAL_OBJECT_TYPE = 'creative_artifact';
const CROSS_WORKFLOW_POLICY = 'reject';

const LIMITS = Object.freeze({
  id: Object.freeze({ min: 1, max: 128 }),
  text_angle: Object.freeze({ min: 1, max: 500 }),
  text_hook: Object.freeze({ min: 1, max: 280 }),
  text_message: Object.freeze({ min: 1, max: 2000 }),
  text_claim: Object.freeze({ min: 1, max: 1000 }),
  title: Object.freeze({ min: 1, max: 200 }),
  summary: Object.freeze({ min: 1, max: 2000 }),
  objective: Object.freeze({ min: 1, max: 1000 }),
  target_audience: Object.freeze({ min: 1, max: 1000 }),
  placement: Object.freeze({ min: 1, max: 64 }),
  offer: Object.freeze({ min: 0, max: 1000 }),
  call_to_action: Object.freeze({ min: 1, max: 200 }),
  visual_direction: Object.freeze({ min: 0, max: 2000 }),
  script_or_storyboard: Object.freeze({ min: 0, max: 4000 }),
  compliance_notes: Object.freeze({ min: 0, max: 2000 }),
  limitations: Object.freeze({ min: 0, max: 2000 }),
  prohibited_claim: Object.freeze({ min: 1, max: 500 }),
  generation_notes: Object.freeze({ min: 0, max: 500 }),
  platform_source_id: Object.freeze({ min: 1, max: 256 }),
  url: Object.freeze({ min: 0, max: 2048 }),
  sha256_hex: 64,
  citations: Object.freeze({ min: 0, max: 20 }),
  supporting_claims: Object.freeze({ min: 0, max: 10 }),
  prohibited_claims: Object.freeze({ min: 0, max: 20 }),
  source_evidence_ids: Object.freeze({ min: 0, max: 20 }),
  payload_bytes: 32768,
  audit_detail_bytes: 2048,
  static_images: Object.freeze({ min: 0, max: 20 }),
  videos: Object.freeze({ min: 0, max: 5 }),
});

const EXTRA_FORBIDDEN_KEYS = Object.freeze([
  'customer_email',
  'business_email',
  'lead_email',
  'leads',
  'crm_contact',
  'mailing_address',
  'billing_address',
  'raw_prompt',
  'prompt',
  'system_prompt',
]);

const PII_STRICT_FIELDS = Object.freeze([
  'target_audience',
  'offer',
  'call_to_action',
  'compliance_notes',
]);

const MATERIAL_FIELDS = Object.freeze([
  'objective',
  'target_audience',
  'platform',
  'placement',
  'format',
  'angle',
  'hook',
  'primary_message',
  'supporting_claims',
  'citations',
  'source_evidence_ids',
  'offer',
  'call_to_action',
  'visual_direction',
  'script_or_storyboard',
  'prohibited_claims',
]);

const CITATION_REQUIRED = Object.freeze([
  'evidence_id',
  'research_run_id',
  'workflow_id',
  'evidence_fingerprint',
  'honesty_class',
]);

const CITATION_OPTIONAL = Object.freeze([
  'source_url',
  'platform_source_id',
  'evidence_hash',
  'snapshot_version',
  'captured_at',
  'expires_at',
  'source_label',
  'contract_version',
]);

const CITATION_ALLOWED = Object.freeze([...CITATION_REQUIRED, ...CITATION_OPTIONAL]);

const TARGETING_ALLOWED = Object.freeze(['platform', 'placement', 'format']);

const ENVELOPE_REQUIRED = Object.freeze([
  'id',
  'tenant_id',
  'workflow_id',
  'research_run_id',
]);

const ENVELOPE_OPTIONAL = Object.freeze([
  'artifact_id',
  'kind',
  'citations',
  'source_evidence_ids',
  'confidence',
  'limitations',
  'created_at',
  'contract_version',
  'claim_kind',
  'evidence_backed',
]);

const ANGLE_ALLOWED = Object.freeze([
  ...ENVELOPE_REQUIRED, ...ENVELOPE_OPTIONAL, 'text', 'targeting',
]);
const HOOK_ALLOWED = Object.freeze([
  ...ENVELOPE_REQUIRED, ...ENVELOPE_OPTIONAL, 'text', 'targeting',
]);
const MESSAGE_ALLOWED = Object.freeze([
  ...ENVELOPE_REQUIRED, ...ENVELOPE_OPTIONAL, 'text',
]);
const CLAIM_ALLOWED = Object.freeze([
  ...ENVELOPE_REQUIRED, ...ENVELOPE_OPTIONAL, 'text',
]);
const CONCEPT_ALLOWED = Object.freeze([
  ...ENVELOPE_REQUIRED, ...ENVELOPE_OPTIONAL,
  'title', 'summary', 'visual_direction', 'targeting', 'angle_id', 'hook_id',
]);
const BRIEF_ALLOWED = Object.freeze([
  ...ENVELOPE_REQUIRED, ...ENVELOPE_OPTIONAL,
  'objective', 'target_audience', 'platform', 'placement', 'format',
  'angle', 'hook', 'primary_message', 'supporting_claims',
  'offer', 'call_to_action', 'visual_direction', 'script_or_storyboard',
  'compliance_notes', 'prohibited_claims',
  'estimated_generation_requirements', 'approval_status',
]);

const GENERATION_REQ_ALLOWED = Object.freeze(['static_images', 'videos', 'notes']);

const CONTENT_HASH_FIELDS = Object.freeze([
  'kind', 'workflow_id', 'research_run_id', 'text', 'title', 'summary',
  'objective', 'target_audience', 'platform', 'placement', 'format',
  'angle', 'hook', 'primary_message', 'supporting_claims', 'targeting',
  'offer', 'call_to_action', 'visual_direction', 'script_or_storyboard',
  'compliance_notes', 'prohibited_claims', 'claim_kind', 'evidence_backed',
  'confidence', 'limitations', 'estimated_generation_requirements',
  'source_evidence_ids', 'angle_id', 'hook_id',
]);

module.exports = Object.freeze({
  CONTRACT_VERSION,
  ARTIFACT_KINDS,
  ARTIFACT_STATES,
  CLAIM_KINDS,
  CONFIDENCE,
  FORMATS,
  PLATFORMS,
  HONESTY_CLASSES,
  NON_LIVE_HONESTY,
  LIVE_HONESTY,
  AUDIT_EVENTS,
  APPROVAL_GATE,
  APPROVAL_OBJECT_TYPE,
  CROSS_WORKFLOW_POLICY,
  LIMITS,
  FORBIDDEN_KEYS,
  EXTRA_FORBIDDEN_KEYS,
  POLLUTION_KEYS,
  HONESTY_FORBIDDEN_KEYS,
  PII_STRICT_FIELDS,
  MATERIAL_FIELDS,
  CITATION_REQUIRED,
  CITATION_OPTIONAL,
  CITATION_ALLOWED,
  TARGETING_ALLOWED,
  ENVELOPE_REQUIRED,
  ENVELOPE_OPTIONAL,
  ANGLE_ALLOWED,
  HOOK_ALLOWED,
  MESSAGE_ALLOWED,
  CLAIM_ALLOWED,
  CONCEPT_ALLOWED,
  BRIEF_ALLOWED,
  GENERATION_REQ_ALLOWED,
  CONTENT_HASH_FIELDS,
});

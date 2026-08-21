'use strict';

// Frozen v1 research-evidence contracts. Enums and size limits match
// services/agent_orchestrator/schema.js PR3A CHECKs exactly. This module is
// data-only: no network, no persistence, no HTTP.

const CONTRACT_VERSION = 'v1';

const PLATFORMS = Object.freeze(['meta', 'google', 'tiktok']);
const RUN_STATES = Object.freeze(['pending', 'running', 'completed', 'failed', 'cancelled']);
const FAILURE_CLASSES = Object.freeze([
  'rate_limit',
  'auth_failure',
  'transient',
  'invalid_response',
  'policy_rejection',
  'terminal',
]);
const DISCOVERY_SOURCES = Object.freeze([
  'ad_library',
  'ads_transparency_center',
  'keyword_planner',
  'public_profile',
  'connector',
]);
const SOURCE_TYPES = Object.freeze([
  'ad_creative',
  'ad_copy',
  'landing_page',
  'auction_insight',
  'search_term',
  'public_page',
  'public_video',
  'labelled_metric',
]);
const CREATIVE_FORMATS = Object.freeze(['image', 'video', 'carousel', 'text', 'html', 'unknown']);
const METRICS_KINDS = Object.freeze(['provider_reported', 'estimated']);
const PROVENANCE_METHODS = Object.freeze([
  'ad_library',
  'ads_transparency_center',
  'keyword_planner',
  'public_scrape',
  'connector',
]);
const CONNECTOR_IDS = Object.freeze(['meta_research', 'google_research', 'tiktok_research']);
const RETENTION_CLASSES = Object.freeze(['standard', 'short', 'legal_hold']);
const MEDIA_TYPES = Object.freeze(['image', 'video', 'html', 'other']);
const RETRY_CLASSES = Object.freeze(['retryable', 'terminal', 'none']);

const CONNECTOR_PLATFORM = Object.freeze({
  meta_research: 'meta',
  google_research: 'google',
  tiktok_research: 'tiktok',
});

const PLATFORM_CONNECTOR = Object.freeze({
  meta: 'meta_research',
  google: 'google_research',
  tiktok: 'tiktok_research',
});

const LIMITS = Object.freeze({
  id: Object.freeze({ min: 1, max: 128 }),
  idempotency_key: Object.freeze({ min: 1, max: 256 }),
  research_brief: Object.freeze({ min: 0, max: 4000 }),
  search_parameters_bytes: 8192,
  continuation_state_bytes: 4096,
  error_code: Object.freeze({ min: 0, max: 128 }),
  error_message: Object.freeze({ min: 0, max: 512 }),
  provider_advertiser_id: Object.freeze({ min: 1, max: 256 }),
  provider_external_id: Object.freeze({ min: 1, max: 256 }),
  normalized_name: Object.freeze({ min: 1, max: 256 }),
  advertiser_name: Object.freeze({ min: 0, max: 256 }),
  url: Object.freeze({ min: 0, max: 2048 }),
  country: Object.freeze({ min: 0, max: 8 }),
  market: Object.freeze({ min: 0, max: 64 }),
  language: Object.freeze({ min: 0, max: 16 }),
  placement: Object.freeze({ min: 0, max: 64 }),
  headline: Object.freeze({ min: 0, max: 500 }),
  body_text: Object.freeze({ min: 0, max: 4000 }),
  excerpt: Object.freeze({ min: 0, max: 2000 }),
  sha256_hex: 64,
  dedup_key: Object.freeze({ min: 1, max: 128 }),
  provider_metrics_bytes: 8192,
  connector_version: Object.freeze({ min: 1, max: 64 }),
  storage_ref: Object.freeze({ min: 1, max: 1024 }),
  requested_platforms: Object.freeze({ min: 1, max: 3 }),
  cursor: Object.freeze({ min: 0, max: 1024 }),
  search_query: Object.freeze({ min: 0, max: 500 }),
  search_countries: Object.freeze({ maxItems: 20, itemMax: 8 }),
  search_languages: Object.freeze({ maxItems: 10, itemMax: 16 }),
  lookback_days: Object.freeze({ min: 1, max: 365 }),
  max_pages: Object.freeze({ min: 1, max: 50 }),
  max_results_per_page: Object.freeze({ min: 1, max: 100 }),
  workflow_id: Object.freeze({ min: 1, max: 128 }),
  research_run_id: Object.freeze({ min: 1, max: 128 }),
});

const SEARCH_PARAMETER_KEYS = Object.freeze([
  'countries',
  'languages',
  'query',
  'lookback_days',
  'max_pages',
  'max_results_per_page',
]);

const FORBIDDEN_KEYS = Object.freeze([
  'raw_payload',
  'payload',
  'raw',
  'raw_response',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'cookies',
  'email',
  'emails',
  'phone',
  'telephone',
  'comment',
  'comments',
  'commenter',
  'user_profile',
  'private_profile',
  'media_bytes',
  'binary',
  'buffer',
  'image_base64',
  'video_base64',
  'data_uri',
]);

const POLLUTION_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

const EVIDENCE_HASH_FIELDS = Object.freeze([
  'platform',
  'source_type',
  'provider_external_id',
  'canonical_source_url',
  'headline',
  'body_text',
  'excerpt',
  'advertiser_name',
  'creative_format',
]);

const RESEARCH_RUN_REQUIRED = Object.freeze([
  'id',
  'tenant_id',
  'workflow_id',
  'approval_id',
  'approval_object_version',
  'requested_platforms',
  'idempotency_key',
]);

const RESEARCH_RUN_OPTIONAL = Object.freeze([
  'contract_version',
  'research_brief',
  'search_parameters',
  'state',
  'continuation_state',
  'failure_class',
  'error_code',
  'error_message',
  'created_at',
  'started_at',
  'completed_at',
  'failed_at',
]);

const RESEARCH_RUN_DEFAULTS = Object.freeze({
  contract_version: CONTRACT_VERSION,
  research_brief: '',
  search_parameters: Object.freeze({}),
  state: 'pending',
  continuation_state: Object.freeze({}),
});

const RESEARCH_RUN_ALLOWED = Object.freeze([...RESEARCH_RUN_REQUIRED, ...RESEARCH_RUN_OPTIONAL]);

const COMPETITOR_REQUIRED = Object.freeze([
  'id',
  'tenant_id',
  'research_run_id',
  'platform',
  'provider_advertiser_id',
  'normalized_name',
  'discovery_source',
  'captured_at',
]);

const COMPETITOR_OPTIONAL = Object.freeze([
  'canonical_url',
  'country',
  'market',
  'dedup_key',
  'contract_version',
  'created_at',
]);

const COMPETITOR_ALLOWED = Object.freeze([...COMPETITOR_REQUIRED, ...COMPETITOR_OPTIONAL]);

const EVIDENCE_REQUIRED = Object.freeze([
  'id',
  'tenant_id',
  'research_run_id',
  'competitor_id',
  'platform',
  'source_type',
  'captured_at',
  'provenance_method',
  'connector_id',
  'connector_version',
  'metrics_kind',
]);

const EVIDENCE_OPTIONAL = Object.freeze([
  'provider_external_id',
  'canonical_source_url',
  'advertiser_name',
  'creative_format',
  'headline',
  'body_text',
  'excerpt',
  'provider_started_on',
  'provider_ended_on',
  'market',
  'language',
  'placement',
  'provider_metrics',
  'contract_version',
  'evidence_hash',
  'dedup_key',
  'expires_at',
  'retention_class',
  'supersedes_id',
  'created_at',
]);

const EVIDENCE_ALLOWED = Object.freeze([...EVIDENCE_REQUIRED, ...EVIDENCE_OPTIONAL]);

const ASSET_REQUIRED = Object.freeze([
  'id',
  'tenant_id',
  'evidence_id',
  'media_type',
  'storage_ref',
  'checksum_sha256',
  'captured_at',
]);

const ASSET_OPTIONAL = Object.freeze([
  'width_px',
  'height_px',
  'duration_ms',
  'expires_at',
  'retention_class',
  'created_at',
]);

const ASSET_ALLOWED = Object.freeze([...ASSET_REQUIRED, ...ASSET_OPTIONAL]);

const CONNECTOR_REQUEST_REQUIRED = Object.freeze([
  'connector_id',
  'connector_version',
  'contract_version',
  'tenant_id',
  'research_run_id',
  'workflow_id',
  'approval_id',
  'approval_object_version',
  'requested_platforms',
  'idempotency_key',
]);

const CONNECTOR_REQUEST_OPTIONAL = Object.freeze([
  'research_brief',
  'search_parameters',
  'cursor',
  'continuation_state',
]);

const CONNECTOR_REQUEST_ALLOWED = Object.freeze([
  ...CONNECTOR_REQUEST_REQUIRED,
  ...CONNECTOR_REQUEST_OPTIONAL,
]);

const CONNECTOR_PAGE_ALLOWED = Object.freeze([
  'ok',
  'contract_version',
  'connector_id',
  'connector_version',
  'competitors',
  'evidence',
  'assets',
  'page',
  'continuation_state',
  'rate_limit',
  'retry_class',
]);

const CONNECTOR_ERROR_ALLOWED = Object.freeze([
  'ok',
  'error',
  'retry_class',
  'retry_after_ms',
  'rate_limit',
  'continuation_state',
  'message',
  'contract_version',
  'connector_id',
  'connector_version',
]);

const RATE_LIMIT_ALLOWED = Object.freeze(['limit', 'remaining', 'reset_at']);
const PAGE_ALLOWED = Object.freeze(['next_cursor', 'has_more']);

module.exports = Object.freeze({
  CONTRACT_VERSION,
  PLATFORMS,
  RUN_STATES,
  FAILURE_CLASSES,
  DISCOVERY_SOURCES,
  SOURCE_TYPES,
  CREATIVE_FORMATS,
  METRICS_KINDS,
  PROVENANCE_METHODS,
  CONNECTOR_IDS,
  RETENTION_CLASSES,
  MEDIA_TYPES,
  RETRY_CLASSES,
  CONNECTOR_PLATFORM,
  PLATFORM_CONNECTOR,
  LIMITS,
  SEARCH_PARAMETER_KEYS,
  FORBIDDEN_KEYS,
  POLLUTION_KEYS,
  EVIDENCE_HASH_FIELDS,
  RESEARCH_RUN_REQUIRED,
  RESEARCH_RUN_OPTIONAL,
  RESEARCH_RUN_DEFAULTS,
  RESEARCH_RUN_ALLOWED,
  COMPETITOR_REQUIRED,
  COMPETITOR_OPTIONAL,
  COMPETITOR_ALLOWED,
  EVIDENCE_REQUIRED,
  EVIDENCE_OPTIONAL,
  EVIDENCE_ALLOWED,
  ASSET_REQUIRED,
  ASSET_OPTIONAL,
  ASSET_ALLOWED,
  CONNECTOR_REQUEST_REQUIRED,
  CONNECTOR_REQUEST_OPTIONAL,
  CONNECTOR_REQUEST_ALLOWED,
  CONNECTOR_PAGE_ALLOWED,
  CONNECTOR_ERROR_ALLOWED,
  RATE_LIMIT_ALLOWED,
  PAGE_ALLOWED,
});

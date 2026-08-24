'use strict';

const { FORBIDDEN_KEYS } = require('./research_contracts');

const CONTRACT_VERSION = 'campaign_draft_v1';
const OBJECTIVES = Object.freeze(['awareness', 'traffic', 'leads', 'sales', 'app']);
const PLATFORMS = Object.freeze(['meta', 'google', 'tiktok']);
const CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'AUD', 'CAD']);
const CREATIVE_KINDS = Object.freeze(['static_image', 'video', 'creative_brief']);
const CREDENTIAL_REF_RE = /^[A-Za-z0-9_:-]{1,128}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO2 = /^[A-Z]{2}$/;
const ASSET_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_JSON = 16384;
const MAX_CREATIVES = 8;
const MAX_COUNTRIES = 32;

const EXTRA_FORBIDDEN = Object.freeze([
  'credentials', 'tokens', 'access_token', 'refresh_token', 'authorization', 'api_key',
]);
const FORBIDDEN = Object.freeze([...new Set([...FORBIDDEN_KEYS, ...EXTRA_FORBIDDEN])]);

const KEYS = Object.freeze([
  'contract_version', 'objective', 'platforms', 'accounts', 'destination', 'budget',
  'schedule', 'geo', 'audience', 'placements', 'creatives', 'tracking', 'provenance',
  'platform_extensions',
]);
const ACCOUNT = Object.freeze(['platform', 'credential_ref']);
const DESTINATION = Object.freeze(['landing_page_url']);
const BUDGET = Object.freeze(['amount_micros', 'currency']);
const SCHEDULE = Object.freeze(['start_at', 'end_at']);
const GEO = Object.freeze(['countries']);
const AUDIENCE = Object.freeze(['name', 'notes']);
const PLACEMENT = Object.freeze(['type']);
const CREATIVE = Object.freeze(['kind', 'asset_id', 'version', 'content_hash']);
const TRACKING = Object.freeze(['utm_source', 'utm_medium', 'utm_campaign']);
const PROVENANCE = Object.freeze(['workflow_id', 'proposal_id', 'brief_artifact_id', 'evidence_hash']);
const EXTENSION = Object.freeze(['optimization_goal', 'placement']);
const NON_MATERIAL = Object.freeze(['label', 'notes']);

module.exports = {
  CONTRACT_VERSION, OBJECTIVES, PLATFORMS, CURRENCIES, CREATIVE_KINDS,
  CREDENTIAL_REF_RE, HEX64, ISO2, ASSET_ID_RE, MAX_JSON, MAX_CREATIVES, MAX_COUNTRIES,
  FORBIDDEN, KEYS, ACCOUNT, DESTINATION, BUDGET, SCHEDULE, GEO, AUDIENCE, PLACEMENT,
  CREATIVE, TRACKING, PROVENANCE, EXTENSION, NON_MATERIAL,
};

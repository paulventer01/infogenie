'use strict';

const { CONTRACT_VERSION } = require('./creative_contracts');

const PROMPT_TEMPLATE_VERSION = 'v1';
const BUNDLE_KINDS = Object.freeze(['angle', 'hook', 'message', 'claim', 'creative_concept', 'creative_brief']);
const LIVE_PROVIDER = 'openai';
const LIVE_MODEL = 'gpt-4o-mini';
const FIXTURE_PROVIDER = 'fixture';
const FIXTURE_MODEL = 'fixture-proposal-v1';
const ALLOWED_WF = Object.freeze([
  'research_approved', 'research_complete', 'generation_approval_required',
  'generation_approved', 'generation_running', 'creative_review_required',
]);

module.exports = Object.freeze({
  CONTRACT_VERSION, PROMPT_TEMPLATE_VERSION, BUNDLE_KINDS,
  LIVE_PROVIDER, LIVE_MODEL, FIXTURE_PROVIDER, FIXTURE_MODEL, ALLOWED_WF,
});

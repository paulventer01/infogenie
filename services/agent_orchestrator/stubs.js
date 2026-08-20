'use strict';

// PR 1 stub handlers — NON-PRODUCTION PLACEHOLDERS.
// NEVER fabricate competitor research, evidence, creatives, campaigns, or metrics.

const NOTE = 'PR 1 stub — not live research/creatives/campaigns/performance';

function placeholder(agentId) {
  return {
    ok: true,
    placeholder: true,
    source: 'placeholder',
    agent_id: agentId,
    note: NOTE,
  };
}

function safeOutput(agentId) {
  return {
    placeholder: true,
    source: 'placeholder',
    agent_id: agentId,
    note: NOTE,
  };
}

function isChargeableRequest(ctx) {
  return !!(ctx && ctx.chargeable);
}

async function researchPhase() {
  return {
    ok: true,
    placeholder: true,
    source: 'placeholder',
    agent_id: 'research_coordinator',
    note: NOTE,
    output_ref: safeOutput('research_coordinator'),
  };
}

async function generationPhase() {
  return {
    ok: true,
    placeholder: true,
    source: 'placeholder',
    agent_id: 'creative_director',
    note: NOTE,
    output_ref: safeOutput('creative_director'),
  };
}

async function selectionPhase() {
  return {
    ok: true,
    placeholder: true,
    source: 'placeholder',
    agent_id: 'campaign_planning',
    note: NOTE,
    output_ref: safeOutput('campaign_planning'),
  };
}

async function publishingPhase() {
  return {
    ok: true,
    placeholder: true,
    source: 'placeholder',
    agent_id: 'meta_publishing',
    note: NOTE,
    output_ref: safeOutput('meta_publishing'),
  };
}

async function activationPhase() {
  return {
    ok: true,
    placeholder: true,
    source: 'placeholder',
    agent_id: 'performance',
    note: NOTE,
    output_ref: safeOutput('performance'),
  };
}

async function optimizationPhase() {
  return {
    ok: true,
    placeholder: true,
    source: 'placeholder',
    agent_id: 'optimization',
    note: NOTE,
    output_ref: safeOutput('optimization'),
  };
}

const HANDLERS = Object.freeze({
  research: researchPhase,
  creative_generation: generationPhase,
  creative_selection: selectionPhase,
  publishing: publishingPhase,
  activation: activationPhase,
  optimization: optimizationPhase,
  optimization_loop: optimizationPhase,
});

module.exports = {
  NOTE,
  placeholder,
  safeOutput,
  HANDLERS,
  researchPhase,
  generationPhase,
  selectionPhase,
  publishingPhase,
  activationPhase,
  optimizationPhase,
  isChargeableRequest,
};

'use strict';

const { GATES } = require('./states');

function contract(spec) {
  return Object.freeze({
    agentId: spec.agentId,
    permittedStates: Object.freeze([...(spec.permittedStates || [])]),
    inputSchema: Object.freeze({ ...(spec.inputSchema || {}) }),
    outputSchema: Object.freeze({ ...(spec.outputSchema || {}) }),
    requiredApproval: spec.requiredApproval == null ? null : spec.requiredApproval,
    permissions: Object.freeze([...(spec.permissions || [])]),
    costEstimate() {
      return { credits: 0, note: 'not implemented' };
    },
    timeoutMs: spec.timeoutMs || 30_000,
    retryClass: spec.retryClass || 'retryable',
    idempotency: spec.idempotency !== false,
    auditEvents: Object.freeze([...(spec.auditEvents || ['phase_started', 'phase_completed', 'phase_failed'])]),
    safeErrorContract: Object.freeze({
      ok: false,
      error: 'string code',
      retry_class: 'retryable|terminal',
    }),
  });
}

const workflowInput = Object.freeze({
  type: 'object',
  properties: {
    workflow_id: { type: 'string' },
    version: { type: 'integer' },
    selected_platforms: { type: 'array', items: { enum: ['meta', 'google', 'tiktok'] } },
    gate: { type: 'string' },
  },
});

const placeholderOutput = Object.freeze({
  type: 'object',
  properties: {
    ok: { const: true },
    placeholder: { const: true },
    source: { const: 'placeholder' },
    agent_id: { type: 'string' },
    note: { type: 'string' },
  },
});

const AGENTS = Object.freeze({
  research_coordinator: contract({
    agentId: 'research_coordinator',
    permittedStates: ['research_approved', 'research_running'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: GATES[0],
    permissions: ['orchestrator.workflows.edit'],
  }),
  meta_research: contract({
    agentId: 'meta_research',
    permittedStates: ['research_running'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'research_execution',
    permissions: ['orchestrator.workflows.edit'],
  }),
  google_research: contract({
    agentId: 'google_research',
    permittedStates: ['research_running'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'research_execution',
    permissions: ['orchestrator.workflows.edit'],
  }),
  tiktok_research: contract({
    agentId: 'tiktok_research',
    permittedStates: ['research_running'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'research_execution',
    permissions: ['orchestrator.workflows.edit'],
  }),
  evidence_normalization: contract({
    agentId: 'evidence_normalization',
    permittedStates: ['research_running', 'research_complete'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'research_execution',
    permissions: ['orchestrator.workflows.edit'],
  }),
  strategy_and_angles: contract({
    agentId: 'strategy_and_angles',
    permittedStates: ['research_running', 'research_complete'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'research_execution',
    permissions: ['orchestrator.workflows.edit'],
  }),
  creative_director: contract({
    agentId: 'creative_director',
    permittedStates: ['generation_approved', 'generation_running'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'creative_generation',
    permissions: ['orchestrator.workflows.edit'],
  }),
  static_creative: contract({
    agentId: 'static_creative',
    permittedStates: ['generation_running'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'creative_generation',
    permissions: ['orchestrator.workflows.edit'],
  }),
  video_production: contract({
    agentId: 'video_production',
    permittedStates: ['generation_running'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'creative_generation',
    permissions: ['orchestrator.workflows.edit'],
  }),
  campaign_planning: contract({
    agentId: 'campaign_planning',
    permittedStates: ['creative_approved', 'campaign_drafting', 'campaign_review_required'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'creative_selection',
    permissions: ['orchestrator.workflows.edit'],
  }),
  meta_publishing: contract({
    agentId: 'meta_publishing',
    permittedStates: ['publishing_approved', 'publishing'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'campaign_publishing',
    permissions: ['orchestrator.workflows.edit'],
  }),
  google_publishing: contract({
    agentId: 'google_publishing',
    permittedStates: ['publishing_approved', 'publishing'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'campaign_publishing',
    permissions: ['orchestrator.workflows.edit'],
  }),
  tiktok_publishing: contract({
    agentId: 'tiktok_publishing',
    permittedStates: ['publishing_approved', 'publishing'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'campaign_publishing',
    permissions: ['orchestrator.workflows.edit'],
  }),
  performance: contract({
    agentId: 'performance',
    permittedStates: ['activation_approved', 'activating', 'active', 'monitoring'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'campaign_activation',
    permissions: ['orchestrator.workflows.edit'],
  }),
  optimization: contract({
    agentId: 'optimization',
    permittedStates: ['optimization_approved', 'optimization_applying', 'optimization_applied', 'monitoring'],
    inputSchema: workflowInput,
    outputSchema: placeholderOutput,
    requiredApproval: 'optimization_application',
    permissions: ['orchestrator.workflows.edit'],
  }),
});

module.exports = { AGENTS, contract };

'use strict';

const { fail } = require('./errors');

const GATES = Object.freeze([
  'research_execution',
  'creative_generation',
  'creative_selection',
  'campaign_publishing',
  'campaign_activation',
  'optimization_application',
]);

const GATE_PERMISSION = Object.freeze({
  research_execution: 'orchestrator.workflows.approve.research_execution',
  creative_generation: 'orchestrator.workflows.approve.creative_generation',
  creative_selection: 'orchestrator.workflows.approve.creative_selection',
  campaign_publishing: 'orchestrator.workflows.approve.campaign_publishing',
  campaign_activation: 'orchestrator.workflows.approve.campaign_activation',
  optimization_application: 'orchestrator.workflows.approve.optimization_application',
});

const PERMS = Object.freeze({
  view: 'orchestrator.workflows.view',
  create: 'orchestrator.workflows.create',
  edit: 'orchestrator.workflows.edit',
  request: 'orchestrator.workflows.request_approval',
  pause: 'orchestrator.workflows.pause',
  resume: 'orchestrator.workflows.resume',
  cancel: 'orchestrator.workflows.cancel',
  recover: 'orchestrator.workflows.recover',
  auditView: 'orchestrator.workflows.audit.view',
});

const TERMINAL_STATES = Object.freeze(['cancelled', 'completed']);
const FAILED_STATES = Object.freeze(['failed', 'research_failed']);

const APPROVAL_WAIT = Object.freeze({
  research_execution: 'research_approval_required',
  creative_generation: 'generation_approval_required',
  creative_selection: 'creative_review_required',
  campaign_publishing: 'publishing_approval_required',
  campaign_activation: 'activation_approval_required',
  optimization_application: 'optimization_approval_required',
});

const APPROVED_STATE = Object.freeze({
  research_execution: 'research_approved',
  creative_generation: 'generation_approved',
  creative_selection: 'creative_approved',
  campaign_publishing: 'publishing_approved',
  campaign_activation: 'activation_approved',
  optimization_application: 'optimization_approved',
});

const GATE_FOR_WAIT = Object.freeze(Object.fromEntries(
  Object.entries(APPROVAL_WAIT).map(([gate, state]) => [state, gate])
));

const GATE_FOR_APPROVED = Object.freeze(Object.fromEntries(
  Object.entries(APPROVED_STATE).map(([gate, state]) => [state, gate])
));

const APPROVED_TO_CHAIN = Object.freeze({
  research_approved: 'research',
  generation_approved: 'creative_generation',
  creative_approved: 'creative_selection',
  publishing_approved: 'publishing',
  activation_approved: 'activation',
  optimization_approved: 'optimization',
});

const CHAIN_REQUIRED_GATE = Object.freeze({
  research: 'research_execution',
  creative_generation: 'creative_generation',
  creative_selection: 'creative_selection',
  publishing: 'campaign_publishing',
  activation: 'campaign_activation',
  optimization: 'optimization_application',
  optimization_loop: 'optimization_application',
});

// Stub runner walks these in order and STOPS at the next approval gate.
const PHASE_CHAINS = Object.freeze({
  research: Object.freeze([
    { to: 'research_running', phase: 'research', auditEvent: 'phase_started' },
    { to: 'research_complete', phase: 'research' },
    {
      to: 'generation_approval_required',
      phase: 'research',
      stop: true,
      nextGate: 'creative_generation',
      auditEvent: 'phase_completed',
    },
  ]),
  creative_generation: Object.freeze([
    { to: 'generation_running', phase: 'creative_generation', auditEvent: 'phase_started' },
    {
      to: 'creative_review_required',
      phase: 'creative_generation',
      stop: true,
      nextGate: 'creative_selection',
      auditEvent: 'phase_completed',
    },
  ]),
  creative_selection: Object.freeze([
    { to: 'campaign_drafting', phase: 'campaign_construction', auditEvent: 'phase_started' },
    { to: 'campaign_review_required', phase: 'campaign_construction' },
    {
      to: 'publishing_approval_required',
      phase: 'campaign_construction',
      stop: true,
      nextGate: 'campaign_publishing',
      auditEvent: 'phase_completed',
    },
  ]),
  publishing: Object.freeze([
    { to: 'publishing', phase: 'publishing', auditEvent: 'phase_started' },
    { to: 'published_paused', phase: 'publishing' },
    {
      to: 'activation_approval_required',
      phase: 'publishing',
      stop: true,
      nextGate: 'campaign_activation',
      auditEvent: 'phase_completed',
    },
  ]),
  activation: Object.freeze([
    { to: 'activating', phase: 'activation', auditEvent: 'phase_started' },
    { to: 'active', phase: 'activation' },
    { to: 'monitoring', phase: 'monitoring' },
    { to: 'optimization_proposed', phase: 'optimization' },
    {
      to: 'optimization_approval_required',
      phase: 'optimization',
      stop: true,
      nextGate: 'optimization_application',
      auditEvent: 'phase_completed',
    },
  ]),
  optimization: Object.freeze([
    { to: 'optimization_applying', phase: 'optimization', auditEvent: 'phase_started' },
    { to: 'optimization_applied', phase: 'optimization' },
    {
      to: 'monitoring',
      phase: 'monitoring',
      stop: true,
      nextGate: 'optimization_application',
      auditEvent: 'phase_completed',
    },
  ]),
  optimization_loop: Object.freeze([
    { to: 'optimization_proposed', phase: 'optimization', auditEvent: 'phase_started' },
    {
      to: 'optimization_approval_required',
      phase: 'optimization',
      stop: true,
      nextGate: 'optimization_application',
      auditEvent: 'phase_completed',
    },
  ]),
});

const FAIL_TARGET = Object.freeze({
  research_running: 'research_failed',
  research_complete: 'research_failed',
});

function _t(partial) {
  return Object.freeze({
    permission: null,
    requiredApproval: null,
    validation: null,
    autonomous: false,
    auditEvent: null,
    idempotent: false,
    stop: false,
    nextGate: null,
    phase: null,
    gate: null,
    ...partial,
  });
}

const TRANSITIONS = Object.freeze([
  _t({
    from: 'draft', event: 'request_approval', to: 'research_approval_required',
    permission: PERMS.request, gate: 'research_execution',
    nextGate: 'research_execution', phase: 'research',
    auditEvent: 'approval_requested',
  }),

  _t({
    from: 'research_approval_required', event: 'approve', to: 'research_approved',
    permission: GATE_PERMISSION.research_execution, gate: 'research_execution',
    requiredApproval: 'research_execution', nextGate: 'research_execution',
    phase: 'research', auditEvent: 'approval_granted',
  }),
  _t({
    from: 'generation_approval_required', event: 'approve', to: 'generation_approved',
    permission: GATE_PERMISSION.creative_generation, gate: 'creative_generation',
    requiredApproval: 'creative_generation', nextGate: 'creative_generation',
    phase: 'creative_generation', auditEvent: 'approval_granted',
  }),
  _t({
    from: 'creative_review_required', event: 'approve', to: 'creative_approved',
    permission: GATE_PERMISSION.creative_selection, gate: 'creative_selection',
    requiredApproval: 'creative_selection', nextGate: 'creative_selection',
    phase: 'creative_generation', auditEvent: 'approval_granted',
  }),
  _t({
    from: 'publishing_approval_required', event: 'approve', to: 'publishing_approved',
    permission: GATE_PERMISSION.campaign_publishing, gate: 'campaign_publishing',
    requiredApproval: 'campaign_publishing', nextGate: 'campaign_publishing',
    phase: 'campaign_construction', auditEvent: 'approval_granted',
  }),
  _t({
    from: 'activation_approval_required', event: 'approve', to: 'activation_approved',
    permission: GATE_PERMISSION.campaign_activation, gate: 'campaign_activation',
    requiredApproval: 'campaign_activation', nextGate: 'campaign_activation',
    phase: 'publishing', auditEvent: 'approval_granted',
  }),
  _t({
    from: 'optimization_approval_required', event: 'approve', to: 'optimization_approved',
    permission: GATE_PERMISSION.optimization_application, gate: 'optimization_application',
    requiredApproval: 'optimization_application', nextGate: 'optimization_application',
    phase: 'optimization', auditEvent: 'approval_granted',
  }),

  _t({
    from: 'research_approval_required', event: 'reject', to: 'research_approval_required',
    permission: GATE_PERMISSION.research_execution, gate: 'research_execution',
    nextGate: 'research_execution', phase: 'research',
    auditEvent: 'approval_rejected', idempotent: true,
  }),
  _t({
    from: 'generation_approval_required', event: 'reject', to: 'generation_approval_required',
    permission: GATE_PERMISSION.creative_generation, gate: 'creative_generation',
    nextGate: 'creative_generation', auditEvent: 'approval_rejected', idempotent: true,
  }),
  _t({
    from: 'creative_review_required', event: 'reject', to: 'creative_review_required',
    permission: GATE_PERMISSION.creative_selection, gate: 'creative_selection',
    nextGate: 'creative_selection', auditEvent: 'approval_rejected', idempotent: true,
  }),
  _t({
    from: 'publishing_approval_required', event: 'reject', to: 'publishing_approval_required',
    permission: GATE_PERMISSION.campaign_publishing, gate: 'campaign_publishing',
    nextGate: 'campaign_publishing', auditEvent: 'approval_rejected', idempotent: true,
  }),
  _t({
    from: 'activation_approval_required', event: 'reject', to: 'activation_approval_required',
    permission: GATE_PERMISSION.campaign_activation, gate: 'campaign_activation',
    nextGate: 'campaign_activation', auditEvent: 'approval_rejected', idempotent: true,
  }),
  _t({
    from: 'optimization_approval_required', event: 'reject', to: 'optimization_approval_required',
    permission: GATE_PERMISSION.optimization_application, gate: 'optimization_application',
    nextGate: 'optimization_application', auditEvent: 'approval_rejected', idempotent: true,
  }),

  _t({
    from: 'research_approved', event: 'advance', to: 'research_running',
    permission: PERMS.edit, requiredApproval: 'research_execution',
    phase: 'research', nextGate: 'research_execution', auditEvent: 'phase_started',
  }),
  _t({
    from: 'generation_approved', event: 'advance', to: 'generation_running',
    permission: PERMS.edit, requiredApproval: 'creative_generation',
    phase: 'creative_generation', auditEvent: 'phase_started',
  }),
  _t({
    from: 'creative_approved', event: 'advance', to: 'campaign_drafting',
    permission: PERMS.edit, requiredApproval: 'creative_selection',
    phase: 'campaign_construction', auditEvent: 'phase_started',
  }),
  _t({
    from: 'publishing_approved', event: 'advance', to: 'publishing',
    permission: PERMS.edit, requiredApproval: 'campaign_publishing',
    phase: 'publishing', auditEvent: 'phase_started',
  }),
  _t({
    from: 'activation_approved', event: 'advance', to: 'activating',
    permission: PERMS.edit, requiredApproval: 'campaign_activation',
    phase: 'activation', auditEvent: 'phase_started',
  }),
  _t({
    from: 'optimization_approved', event: 'advance', to: 'optimization_applying',
    permission: PERMS.edit, requiredApproval: 'optimization_application',
    phase: 'optimization', auditEvent: 'phase_started',
  }),
  _t({
    from: 'monitoring', event: 'advance', to: 'optimization_proposed',
    permission: PERMS.edit, requiredApproval: 'optimization_application',
    phase: 'optimization', auditEvent: 'phase_started',
  }),

  _t({ from: 'research_running', event: 'tick', to: 'research_complete', autonomous: true, phase: 'research' }),
  _t({
    from: 'research_complete', event: 'tick', to: 'generation_approval_required',
    autonomous: true, stop: true, nextGate: 'creative_generation', phase: 'research',
    auditEvent: 'phase_completed',
  }),
  _t({
    from: 'generation_running', event: 'tick', to: 'creative_review_required',
    autonomous: true, stop: true, nextGate: 'creative_selection', phase: 'creative_generation',
    auditEvent: 'phase_completed',
  }),
  _t({ from: 'campaign_drafting', event: 'tick', to: 'campaign_review_required', autonomous: true, phase: 'campaign_construction' }),
  _t({
    from: 'campaign_review_required', event: 'tick', to: 'publishing_approval_required',
    autonomous: true, stop: true, nextGate: 'campaign_publishing', phase: 'campaign_construction',
    auditEvent: 'phase_completed',
  }),
  _t({ from: 'publishing', event: 'tick', to: 'published_paused', autonomous: true, phase: 'publishing' }),
  _t({
    from: 'published_paused', event: 'tick', to: 'activation_approval_required',
    autonomous: true, stop: true, nextGate: 'campaign_activation', phase: 'publishing',
    auditEvent: 'phase_completed',
  }),
  _t({ from: 'activating', event: 'tick', to: 'active', autonomous: true, phase: 'activation' }),
  _t({ from: 'active', event: 'tick', to: 'monitoring', autonomous: true, phase: 'monitoring' }),
  _t({ from: 'monitoring', event: 'tick', to: 'optimization_proposed', autonomous: true, phase: 'optimization' }),
  _t({
    from: 'optimization_proposed', event: 'tick', to: 'optimization_approval_required',
    autonomous: true, stop: true, nextGate: 'optimization_application', phase: 'optimization',
    auditEvent: 'phase_completed',
  }),
  _t({ from: 'optimization_applying', event: 'tick', to: 'optimization_applied', autonomous: true, phase: 'optimization' }),
  _t({
    from: 'optimization_applied', event: 'tick', to: 'monitoring',
    autonomous: true, stop: true, nextGate: 'optimization_application', phase: 'monitoring',
    auditEvent: 'phase_completed',
  }),

  _t({
    from: 'research_running', event: 'fail', to: 'research_failed',
    phase: 'research', auditEvent: 'phase_failed',
  }),
  _t({
    from: 'research_complete', event: 'fail', to: 'research_failed',
    phase: 'research', auditEvent: 'phase_failed',
  }),
  _t({
    from: 'research_failed', event: 'recover', to: 'research_approved',
    permission: PERMS.recover, requiredApproval: 'research_execution',
    phase: 'research', auditEvent: 'workflow_recovered',
  }),
  _t({
    from: 'failed', event: 'recover', to: null,
    permission: PERMS.recover, auditEvent: 'workflow_recovered',
  }),

  _t({
    from: '*pauseable', event: 'pause', to: 'paused',
    permission: PERMS.pause, auditEvent: 'workflow_paused',
  }),
  _t({
    from: 'paused', event: 'resume', to: null,
    permission: PERMS.resume, auditEvent: 'workflow_resumed',
  }),
  _t({
    from: '*cancellable', event: 'cancel', to: 'cancelled',
    permission: PERMS.cancel, auditEvent: 'workflow_cancelled',
  }),
]);

function _isTerminal(state) {
  return TERMINAL_STATES.includes(state);
}

function _isPauseable(state) {
  return !!state && state !== 'paused' && !_isTerminal(state);
}

function _isCancellable(state) {
  return !!state && !_isTerminal(state);
}

function _match(from, event, opts) {
  const gate = opts && opts.gate != null ? String(opts.gate) : null;
  return TRANSITIONS.find((t) => {
    if (t.event !== event) return false;
    if (t.from === from) {
      if (t.gate && gate && t.gate !== gate) return false;
      return true;
    }
    return false;
  }) || null;
}

function canTransition(from, event, opts = {}) {
  const state = String(from || '');
  const ev = String(event || '');

  if (ev === 'pause') {
    if (!_isPauseable(state)) return { ok: false, code: 'invalid_transition' };
    return {
      ok: true,
      transition: _t({
        from: state, event: 'pause', to: 'paused',
        permission: PERMS.pause, auditEvent: 'workflow_paused',
      }),
    };
  }

  if (ev === 'resume') {
    if (state !== 'paused') return { ok: false, code: 'invalid_transition' };
    const prev = opts.previousState;
    if (!prev) return { ok: false, code: 'invalid_transition' };
    return {
      ok: true,
      transition: _t({
        from: 'paused', event: 'resume', to: prev,
        permission: PERMS.resume, auditEvent: 'workflow_resumed',
      }),
    };
  }

  if (ev === 'cancel') {
    if (!_isCancellable(state)) return { ok: false, code: 'invalid_transition' };
    return {
      ok: true,
      transition: _t({
        from: state, event: 'cancel', to: 'cancelled',
        permission: PERMS.cancel, auditEvent: 'workflow_cancelled',
      }),
    };
  }

  if (ev === 'approve' || ev === 'reject') {
    const expected = GATE_FOR_WAIT[state];
    if (!expected) return { ok: false, code: 'invalid_transition' };
    if (opts.gate && opts.gate !== expected) {
      return { ok: false, code: 'approval_scope_mismatch' };
    }
    const gate = opts.gate || expected;
    const t = _match(state, ev, { gate });
    if (!t) return { ok: false, code: 'invalid_transition' };
    return { ok: true, transition: t };
  }

  if (ev === 'request_approval') {
    if (state === 'draft') {
      const gate = opts.gate || 'research_execution';
      if (gate !== 'research_execution') return { ok: false, code: 'approval_scope_mismatch' };
      const t = _match('draft', 'request_approval', { gate: 'research_execution' });
      return t ? { ok: true, transition: t } : { ok: false, code: 'invalid_transition' };
    }
    const expected = GATE_FOR_WAIT[state];
    if (expected && (!opts.gate || opts.gate === expected)) {
      return {
        ok: true,
        transition: _t({
          from: state, event: 'request_approval', to: state, gate: expected,
          permission: PERMS.request, nextGate: expected, idempotent: true,
          auditEvent: 'approval_requested',
        }),
      };
    }
    return { ok: false, code: 'invalid_transition' };
  }

  if (ev === 'advance') {
    if (state === 'draft' || GATE_FOR_WAIT[state]) return { ok: false, code: 'approval_required' };
    const t = _match(state, 'advance', opts);
    if (t) return { ok: true, transition: t };
    if (resolveAdvanceChain({ current_state: state, current_phase: opts.phase || opts.current_phase })) {
      return {
        ok: true,
        transition: _t({
          from: state, event: 'advance', to: state,
          permission: PERMS.edit, auditEvent: 'phase_started',
        }),
      };
    }
    return { ok: false, code: 'invalid_transition' };
  }

  if (ev === 'recover') {
    if (state === 'research_failed') {
      return { ok: true, transition: _match('research_failed', 'recover', opts) };
    }
    if (state === 'failed') {
      const to = opts.previousState || opts.retryState;
      if (!to) return { ok: false, code: 'recovery_not_allowed' };
      return {
        ok: true,
        transition: _t({
          from: 'failed', event: 'recover', to,
          permission: PERMS.recover, auditEvent: 'workflow_recovered',
        }),
      };
    }
    return { ok: false, code: 'recovery_not_allowed' };
  }

  if (ev === 'fail') {
    const to = FAIL_TARGET[state] || 'failed';
    if (_isTerminal(state) || state === 'paused' || GATE_FOR_WAIT[state] || GATE_FOR_APPROVED[state] || state === 'draft') {
      return { ok: false, code: 'invalid_transition' };
    }
    return {
      ok: true,
      transition: _t({
        from: state, event: 'fail', to, auditEvent: 'phase_failed',
      }),
    };
  }

  const t = _match(state, ev, opts);
  if (!t) return { ok: false, code: 'invalid_transition' };
  return { ok: true, transition: t };
}

function applyTransition(from, event, opts = {}) {
  const result = canTransition(from, event, opts);
  if (!result.ok) fail(result.code);
  const t = result.transition;
  return {
    from,
    to: t.to,
    event,
    permission: t.permission,
    requiredApproval: t.requiredApproval,
    autonomous: !!t.autonomous,
    auditEvent: t.auditEvent,
    idempotent: !!t.idempotent,
    stop: !!t.stop,
    nextGate: t.nextGate,
    phase: t.phase,
    gate: t.gate || opts.gate || null,
  };
}

function chainNameForPhase(phase) {
  switch (String(phase || '')) {
    case 'research': return 'research';
    case 'creative_generation': return 'creative_generation';
    case 'creative_selection':
    case 'campaign_construction': return 'creative_selection';
    case 'publishing': return 'publishing';
    case 'activation': return 'activation';
    case 'optimization': return 'optimization';
    default: return null;
  }
}

function resolveAdvanceChain(workflow) {
  const state = workflow && workflow.current_state;
  if (!state) return null;
  if (APPROVED_TO_CHAIN[state]) {
    const name = APPROVED_TO_CHAIN[state];
    return { name, steps: PHASE_CHAINS[name], fromIndex: -1, requiredGate: CHAIN_REQUIRED_GATE[name] };
  }
  if (state === 'monitoring' && workflow.current_phase === 'monitoring') {
    return {
      name: 'optimization_loop',
      steps: PHASE_CHAINS.optimization_loop,
      fromIndex: -1,
      requiredGate: CHAIN_REQUIRED_GATE.optimization_loop,
    };
  }
  const name = chainNameForPhase(workflow.current_phase);
  if (!name || !PHASE_CHAINS[name]) return null;
  const steps = PHASE_CHAINS[name];
  const idx = steps.findIndex((s) => s.to === state);
  if (idx < 0) return null;
  if (steps[idx].stop && idx === steps.length - 1) return null;
  return { name, steps, fromIndex: idx, requiredGate: CHAIN_REQUIRED_GATE[name] };
}

function failTargetFor(state) {
  return FAIL_TARGET[state] || 'failed';
}

function retryStateFor(workflow) {
  const state = workflow && workflow.current_state;
  if (state === 'research_failed') return 'research_approved';
  if (GATE_FOR_APPROVED[workflow.previous_state]) return workflow.previous_state;
  const name = chainNameForPhase(workflow.current_phase);
  if (name === 'research') return 'research_approved';
  if (name === 'creative_generation') return 'generation_approved';
  if (name === 'creative_selection') return 'creative_approved';
  if (name === 'publishing') return 'publishing_approved';
  if (name === 'activation') return 'activation_approved';
  if (name === 'optimization') return 'optimization_approved';
  return workflow.previous_state || null;
}

module.exports = {
  GATES,
  GATE_PERMISSION,
  PERMS,
  TERMINAL_STATES,
  FAILED_STATES,
  APPROVAL_WAIT,
  APPROVED_STATE,
  GATE_FOR_WAIT,
  GATE_FOR_APPROVED,
  APPROVED_TO_CHAIN,
  PHASE_CHAINS,
  TRANSITIONS,
  canTransition,
  applyTransition,
  resolveAdvanceChain,
  failTargetFor,
  retryStateFor,
  chainNameForPhase,
};

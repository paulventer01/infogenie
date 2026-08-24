'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { OrchError } = require('../services/agent_orchestrator/errors');
const C = require('../services/agent_orchestrator/creative_contracts');
const {
  assertAngle,
  assertHook,
  assertClaim,
  assertCreativeBrief,
  assertCreativeArtifact,
  computeEvidenceHash,
  approvalContentHash,
  materialChanged,
} = require('../services/agent_orchestrator/creative_validate');

const TENANT_A = 1;
const FP = 'a'.repeat(64);
const FP2 = 'b'.repeat(64);

function isValidation(err, reason) {
  return err instanceof OrchError && err.code === 'validation_failed' && (!reason || err.extra.reason === reason);
}

function throwsValidation(fn, reason) {
  assert.throws(fn, (err) => isValidation(err, reason));
}

function citation(extra = {}) {
  return {
    evidence_id: extra.evidence_id || 'ev-1',
    research_run_id: extra.research_run_id || 'run-1',
    workflow_id: extra.workflow_id || 'wf-1',
    source_url: extra.source_url || 'https://www.facebook.com/ads/library/?id=1',
    platform_source_id: extra.platform_source_id || 'ad-1',
    evidence_fingerprint: extra.evidence_fingerprint || FP,
    evidence_hash: extra.evidence_hash || extra.evidence_fingerprint || FP,
    honesty_class: extra.honesty_class || 'fixture',
    source_label: extra.source_label || extra.honesty_class || 'fixture',
    captured_at: extra.captured_at || '2026-01-01T00:00:00.000Z',
  };
}

function envelope(extra = {}) {
  return {
    id: extra.id || 'art-1',
    artifact_id: extra.artifact_id || 'art-1',
    tenant_id: extra.tenant_id || TENANT_A,
    workflow_id: extra.workflow_id || 'wf-1',
    research_run_id: extra.research_run_id || 'run-1',
    citations: extra.citations || [citation()],
    confidence: extra.confidence || 'medium',
    limitations: extra.limitations || 'Public library snapshot only',
    contract_version: extra.contract_version || 'v1',
    created_at: extra.created_at || '2026-01-02T00:00:00.000Z',
  };
}

test('PR4A frozen enums and contract version', () => {
  assert.strictEqual(C.CONTRACT_VERSION, 'v1');
  assert.deepStrictEqual([...C.ARTIFACT_KINDS], [
    'angle', 'hook', 'message', 'claim', 'creative_concept', 'creative_brief',
  ]);
  assert.ok(C.CLAIM_KINDS.includes('factual'));
  assert.ok(C.CLAIM_KINDS.includes('opinion'));
  assert.ok(C.NON_LIVE_HONESTY.includes('fixture'));
  assert.strictEqual(C.APPROVAL_GATE, 'creative_generation');
  assert.strictEqual(C.CROSS_WORKFLOW_POLICY, 'reject');
});

test('every factual evidence-backed claim requires a citation', () => {
  throwsValidation(() => assertClaim({
    ...envelope({ citations: [] }),
    kind: 'claim',
    text: 'They spent $1M last month',
    claim_kind: 'factual',
    evidence_backed: true,
  }, { tenantId: TENANT_A }), 'citation_required');

  const ok = assertClaim({
    ...envelope(),
    kind: 'claim',
    text: 'The public ad uses a 20% off hook',
    claim_kind: 'factual',
    evidence_backed: true,
  }, { tenantId: TENANT_A });
  assert.strictEqual(ok.citations.length, 1);
  assert.strictEqual(ok.evidence_backed, true);
  assert.ok(ok.content_hash);
  assert.ok(ok.evidence_hash);
});

test('unsupported claims cannot be marked evidence-backed', () => {
  throwsValidation(() => assertClaim({
    ...envelope(),
    kind: 'claim',
    text: 'This will definitely convert',
    claim_kind: 'opinion',
    evidence_backed: true,
  }, { tenantId: TENANT_A }), 'unsupported_claim');
  throwsValidation(() => assertClaim({
    ...envelope(),
    kind: 'claim',
    text: 'Perhaps they are expanding',
    claim_kind: 'hypothesis',
    evidence_backed: true,
  }, { tenantId: TENANT_A }), 'unsupported_claim');
  const opinion = assertClaim({
    ...envelope({ citations: [] }),
    kind: 'claim',
    text: 'This tone feels premium',
    claim_kind: 'opinion',
    evidence_backed: false,
  }, { tenantId: TENANT_A });
  assert.strictEqual(opinion.evidence_backed, false);
  assert.strictEqual(opinion.claim_kind, 'opinion');
});

test('fixture citations cannot be labelled live vendor evidence', () => {
  throwsValidation(() => assertAngle({
    ...envelope({
      citations: [citation({ honesty_class: 'fixture', source_label: 'live' })],
    }),
    kind: 'angle',
    text: 'Save on jackets this season',
    targeting: { platform: 'meta', placement: 'feed', format: 'image' },
  }, { tenantId: TENANT_A }), 'fixture_as_live');
  const row = assertHook({
    ...envelope({ citations: [citation({ honesty_class: 'fixture', source_label: 'fixture' })] }),
    kind: 'hook',
    text: '20% off this week',
    targeting: { platform: 'meta', format: 'image' },
    evidence_backed: true,
  }, { tenantId: TENANT_A });
  assert.strictEqual(row.citations[0].honesty_class, 'fixture');
  assert.strictEqual(row.citations[0].source_label, 'fixture');
  assert.notStrictEqual(row.citations[0].source_label, 'live');
});

test('tenant_id from body cannot override context', () => {
  throwsValidation(() => assertAngle({
    ...envelope({ tenant_id: 99 }),
    kind: 'angle',
    text: 'A winter layering angle',
  }, { tenantId: TENANT_A }), 'mismatch');
});

test('PII and secret-like fields fail closed', () => {
  throwsValidation(() => assertCreativeBrief({
    ...envelope(),
    kind: 'creative_brief',
    objective: 'Acquire jackets buyers',
    target_audience: 'Email jane@example.com',
    platform: 'meta',
    placement: 'feed',
    format: 'image',
    angle: { text: 'Warm layers' },
    hook: { text: 'Stay warm' },
    primary_message: { text: 'Shop the winter drop' },
    call_to_action: 'Shop now',
  }, { tenantId: TENANT_A }), 'pii');
  throwsValidation(() => assertAngle({
    ...envelope(),
    kind: 'angle',
    text: 'Angle',
    access_token: 'secret',
  }, { tenantId: TENANT_A }), 'forbidden');
  throwsValidation(() => assertAngle({
    ...envelope({ limitations: 'Authorization: Bearer aaaaaaaaaaaa' }),
    kind: 'angle',
    text: 'Angle',
  }, { tenantId: TENANT_A }), 'credential_material');
});

test('oversized and malformed contracts fail closed', () => {
  throwsValidation(() => assertAngle('nope', { tenantId: TENANT_A }), 'not_object');
  throwsValidation(() => assertAngle({
    ...envelope(),
    kind: 'angle',
    text: 'x'.repeat(C.LIMITS.text_angle.max + 1),
  }, { tenantId: TENANT_A }), 'oversized');
  throwsValidation(() => assertCreativeArtifact({
    ...envelope(),
    kind: 'nope',
    text: 'x',
  }, { tenantId: TENANT_A }), 'invalid_enum');
  throwsValidation(() => assertCreativeArtifact({
    ...envelope({ contract_version: 'v2' }),
    kind: 'angle',
    text: 'x',
  }, { tenantId: TENANT_A }), 'unsupported');
});

  test('nested brief citations are bound and hashed with top-level citations', () => {
    const nestedOnly = citation({ evidence_id: 'ev-nested', evidence_fingerprint: FP2, evidence_hash: FP2 });
    const brief = assertCreativeBrief({
      ...envelope({ citations: [] }),
      kind: 'creative_brief',
      objective: 'Awareness',
      target_audience: 'Outdoor shoppers',
      platform: 'meta',
      placement: 'feed',
      format: 'image',
      angle: { text: 'Warm layers' },
      hook: { text: 'Stay warm' },
      primary_message: { text: 'Shop the drop' },
      supporting_claims: [{
        text: 'Public ads use packable language',
        claim_kind: 'factual',
        evidence_backed: true,
        citations: [nestedOnly],
      }],
      call_to_action: 'Shop now',
    }, { tenantId: TENANT_A });
    assert.strictEqual(brief.citations.length, 1);
    assert.strictEqual(brief.citations[0].evidence_id, 'ev-nested');
    assert.strictEqual(brief.evidence_hash, computeEvidenceHash(brief.citations));
  });

  test('creative brief carries required generation-prep fields without generating', () => {
  const brief = assertCreativeBrief({
    ...envelope(),
    kind: 'creative_brief',
    objective: 'Awareness for winter jackets',
    target_audience: 'Outdoor shoppers aged 25-44',
    platform: 'meta',
    placement: 'feed',
    format: 'image',
    angle: { text: 'Stay warm without the bulk', targeting: { platform: 'meta', format: 'image' } },
    hook: { text: 'Packable warmth. Public-library proven.' },
    primary_message: { text: 'A packable jacket that photographs well in feed' },
    supporting_claims: [{
      text: 'Competitor ads in the library use packable-warmth language',
      claim_kind: 'factual',
      evidence_backed: true,
    }],
    offer: 'Free shipping on the winter drop',
    call_to_action: 'Shop the drop',
    visual_direction: 'Static product on snow, no logos of competitors',
    script_or_storyboard: '0-3s hook, 3-8s product, 8-12s CTA',
    compliance_notes: 'Do not claim medical warmth benefits',
    prohibited_claims: ['Guaranteed sales lift'],
    estimated_generation_requirements: { static_images: 2, videos: 0, notes: 'stills only' },
  }, { tenantId: TENANT_A });
  assert.strictEqual(brief.kind, 'creative_brief');
  assert.strictEqual(brief.platform, 'meta');
  assert.strictEqual(brief.format, 'image');
  assert.strictEqual(brief.approval_status, 'draft');
  assert.strictEqual(brief.estimated_generation_requirements.videos, 0);
  assert.ok(brief.content_hash);
  assert.strictEqual(brief.evidence_hash, computeEvidenceHash(brief.citations));
  const bound = approvalContentHash(brief.content_hash, brief.evidence_hash);
  assert.match(bound, /^[0-9a-f]{64}$/);
  assert.strictEqual(materialChanged(brief, { ...brief, hook: { ...brief.hook, text: 'changed' } }), true);
  assert.strictEqual(materialChanged(brief, brief), false);
  const angle = assertAngle({
    ...envelope(),
    kind: 'angle',
    text: 'Stay warm without the bulk',
    targeting: { platform: 'meta', format: 'image' },
  }, { tenantId: TENANT_A });
  assert.strictEqual(materialChanged(angle, { ...angle, text: 'Different angle text' }), true);
  assert.notStrictEqual(approvalContentHash(brief.content_hash, FP2), bound);
});

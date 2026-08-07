// test/marketing-spine.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildSpineContext } = require('../services/marketing_spine/context');

describe('Marketing Spine context', () => {
  it('returns a zeroed health snapshot without tenant/db', async () => {
    const ctx = await buildSpineContext(null);
    assert.equal(typeof ctx.healthScore, 'number');
    assert.ok(Array.isArray(ctx.gaps));
    assert.equal(ctx.audiences.segments, 0);
    assert.equal(ctx.pixels.total, 3);
  });

  it('health score stays within 0–100', async () => {
    const ctx = await buildSpineContext(null);
    assert.ok(ctx.healthScore >= 0 && ctx.healthScore <= 100);
  });
});

describe('Marketing Spine action helpers', () => {
  it('resolvePlan returns empty plan without db/tenant', async () => {
    const { resolvePlan } = require('../services/marketing_spine/actions');
    const plan = await resolvePlan(null);
    assert.ok(Array.isArray(plan.plan));
    assert.equal(plan.plan.length, 0);
  });

  it('suggestFromSources returns empty inserted without db/tenant', async () => {
    const { suggestFromSources } = require('../services/marketing_spine/actions');
    const out = await suggestFromSources(null, {});
    assert.ok(Array.isArray(out.proposed));
    assert.ok(Array.isArray(out.inserted));
    assert.equal(out.inserted.length, 0);
  });
});

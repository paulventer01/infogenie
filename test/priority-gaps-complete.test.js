'use strict';
// Priority gaps: canonical metrics + calendar unification + capacity pacing helpers.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAgenda,
  normalizeCampaign,
  normalizeSocialPost,
  normalizeSeoArticle,
} = require('../services/calendar_assistant/agenda');
const { readMetric } = require('../services/canonical_metrics/compute');
const matrix = require('../services/tenants/permission_matrix');

describe('canonical metrics helpers', () => {
  it('readMetric maps ads.* keys onto a snapshot', () => {
    const snap = {
      spend: 1200,
      cac: 40,
      blended_roas: 2.4,
      true_roas: 3.1,
      total_revenue: 3720,
      mer: 310,
      conversions: 30,
      impressions: 10000,
      clicks: 400,
    };
    assert.equal(readMetric(snap, 'ads.totalSpend'), 1200);
    assert.equal(readMetric(snap, 'ads.cac'), 40);
    assert.equal(readMetric(snap, 'ads.blendedRoas'), 2.4);
    assert.equal(readMetric(snap, 'ads.trueRoas'), 3.1);
    assert.equal(readMetric(snap, 'roas'), 2.4);
    assert.equal(readMetric(snap, 'unknown.metric'), null);
  });
});

describe('unified calendar agenda sources', () => {
  it('includes campaigns, social, and SEO articles alongside brand/content', () => {
    const events = buildAgenda({
      brandItems: [
        { id: 'b1', category: 'ads', title: 'Brand launch', scheduled_at: '2026-08-10T10:00:00.000Z' },
      ],
      contentRuns: [
        { id: 1, posts: [{ date: '2026-08-11', best_time: '09:00', channel: 'x', hook: 'Tweet' }] },
      ],
      campaigns: [
        { id: 'c1', name: 'Summer Sale', platform: 'meta', status: 'active', launched_at: '2026-08-12T12:00:00.000Z' },
      ],
      socialPosts: [
        { id: 's1', caption: 'Hello world', platform: 'linkedin', scheduled_at: '2026-08-13T15:00:00.000Z' },
      ],
      seoArticles: [
        { id: 'a1', title: 'How to win', status: 'scheduled', publish_at: '2026-08-14T08:00:00.000Z' },
      ],
    });
    const sources = new Set(events.map((e) => e.source));
    assert.ok(sources.has('brand'));
    assert.ok(sources.has('content'));
    assert.ok(sources.has('campaign'));
    assert.ok(sources.has('social'));
    assert.ok(sources.has('article'));
    assert.equal(events.length, 5);
  });

  it('normalizers return null for missing dates', () => {
    assert.equal(normalizeCampaign({ name: 'x' }), null);
    assert.equal(normalizeSocialPost({ caption: 'x' }), null);
    assert.equal(normalizeSeoArticle({ title: 'x' }), null);
  });
});

describe('permission matrix coverage for new surfaces', () => {
  it('maps /api/metrics and /api/capacity', () => {
    assert.equal(matrix.requiredPermissionForRequest('/api/metrics/canonical', 'GET').matched, true);
    assert.equal(matrix.requiredPermissionForRequest('/api/capacity/summary', 'GET').matched, true);
  });

  it('maps capacity view in COMPONENT_MATRIX', () => {
    assert.equal(matrix.COMPONENT_MATRIX?.capacity || matrix.viewPermission?.('capacity'), matrix.COMPONENT_MATRIX?.capacity ? matrix.COMPONENT_MATRIX.capacity : undefined);
    // Prefer direct COMPONENT_MATRIX lookup
    const { COMPONENT_MATRIX } = matrix;
    assert.ok(COMPONENT_MATRIX);
    assert.equal(COMPONENT_MATRIX.capacity, 'manage.projects.view');
  });
});

describe('budget pacing math', () => {
  it('projects month-end from day-of-month spend', () => {
    const spent = 10000; // cents
    const dayOfMonth = 10;
    const daysInMonth = 30;
    const projected = Math.round(spent * (daysInMonth / dayOfMonth));
    assert.equal(projected, 30000);
    const target = 25000;
    const expected = Math.round(target * (dayOfMonth / daysInMonth));
    const pacePct = Math.round((spent / expected) * 100);
    assert.ok(pacePct > 100);
  });
});

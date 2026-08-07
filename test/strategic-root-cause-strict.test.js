// Ensures Strategic Intelligence heuristic/AI analyses are not withheld by
// strict data-mode enforcement (they are intentional analysis, not fabricated metrics).
const { test } = require('node:test');
const assert = require('node:assert');
const { detectFabrication } = require('../services/admin/enforcement');

test('heuristic root-cause payload is not treated as fabrication', () => {
  const payload = {
    ok: true,
    primary_cause: 'Rising CPC with conversion drop',
    why_best: 'Stop the largest spend leak first',
    fix_sequence: [{ step: 1, action: 'Pause bottom ROAS campaigns', impact: 'Stop bleed' }],
    analysis_mode: 'heuristic',
    source: 'heuristic-analysis',
  };
  assert.equal(detectFabrication(payload), null);
});

test('_estimated root-cause payload is still detected as fabrication', () => {
  const payload = {
    ok: true,
    primary_cause: 'x',
    _estimated: true,
  };
  const m = detectFabrication(payload);
  assert.ok(m);
  assert.equal(m.kind, '_estimated');
});

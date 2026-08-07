// test/context-pack.test.js — M1 unified context pack
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  buildContextPack,
  injectContextIntoMessages,
  clearContextPackCache,
  _formatSystemBlock,
} = require('../services/ai_governance/context_pack');

beforeEach(() => {
  clearContextPackCache();
});

test('buildContextPack without tenant returns degraded empty pack', async () => {
  const pack = await buildContextPack({ question: 'How is ROAS?' });
  assert.equal(pack.degraded, true);
  assert.equal(pack.degrade_reason, 'no_tenant');
  assert.equal(pack.system_block, '');
  assert.ok(pack.id);
});

test('buildContextPack fail-open with tenant when no DB/memory', async () => {
  const pack = await buildContextPack({
    tenantId: 99,
    question: 'What should we post this week?',
    surface: 'test',
  });
  assert.ok(pack.id);
  assert.equal(pack.tenant_id, 99);
  // May be degraded (thin) but must not throw and must still be usable
  assert.ok(typeof pack.system_block === 'string');
  assert.ok(Array.isArray(pack.memory_nodes));
  assert.ok(Array.isArray(pack.recent_outcomes));
});

test('injectContextIntoMessages prepends system block once', () => {
  const pack = {
    id: 'cp_test',
    system_block: 'Prefer answering from CONTEXT_PACK.\n[MARKETING MEMORY]\n[M1] hello',
  };
  const msgs = [
    { role: 'system', content: 'You are a helpful analyst.' },
    { role: 'user', content: 'How are campaigns?' },
  ];
  const first = injectContextIntoMessages(msgs, pack);
  assert.equal(first.injected, true);
  assert.equal(first.messages[0].role, 'system');
  assert.ok(first.messages[0].content.includes('CONTEXT_PACK_ID: cp_test'));
  assert.equal(first.messages[1].content, 'You are a helpful analyst.');

  const second = injectContextIntoMessages(first.messages, pack);
  assert.equal(second.injected, false);
  assert.equal(second.messages.filter((m) => String(m.content).includes('CONTEXT_PACK_ID')).length, 1);
});

test('_formatSystemBlock includes recent outcomes section', () => {
  const text = _formatSystemBlock({
    brand_block: '<<BRAND_FOUNDATION\nVOICE: bold\nEND_BRAND_FOUNDATION>>',
    memory_nodes: [{ id: 1, node_type: 'manual_observation', summary: 'CAC rising', score: 0.9 }],
    recent_outcomes: [{ id: 2, node_type: 'campaign_result', summary: 'Meta ROAS 3.2x last week' }],
    facts: [],
  });
  assert.ok(text.includes('[MARKETING MEMORY]'));
  assert.ok(text.includes('[RECENT OUTCOMES'));
  assert.ok(text.includes('memory:1'));
  assert.ok(text.includes('Meta ROAS'));
});

test('cache returns same pack id meta.cached on second call', async () => {
  const a = await buildContextPack({ tenantId: 7, question: 'cache me please', surface: 'cache-test' });
  const b = await buildContextPack({ tenantId: 7, question: 'cache me please', surface: 'cache-test' });
  assert.equal(a.id, b.id);
  assert.equal(b.retrieval_meta.cached, true);
});

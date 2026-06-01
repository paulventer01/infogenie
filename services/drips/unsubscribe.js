// services/drips/unsubscribe.js — bounded, single-tenant drip unsubscribe core.
//
// Shared by the public GET /api/drips/unsubscribe route and its isolation test.
// The unsubscribe is bound to EXACTLY ONE workspace — never fanned out across
// tenants. A public, unauthenticated link must not be able to mutate every
// workspace's drip state. Modern links carry the tenant in `t`; legacy links
// (no `t`) fall back to the default/owner tenant only, which is also where
// pre-tenant drip data was migrated at boot.
//
// `store` is the tenant-scoped drip store (global._dripStore): every read/write
// is keyed by tenant id, so a write for tenant A can never touch tenant B.
// `ctx` is the tenant context (getDefaultTenantId).
async function unsubscribeEmail({ email, tParam, store, ctx }) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return { ok: false, error: 'missing_email', touched: 0 };

  const qt = tParam != null ? parseInt(tParam, 10) : NaN;
  let tid;
  if (Number.isFinite(qt)) tid = qt;
  else { try { tid = await ctx.getDefaultTenantId(); } catch (_) { tid = null; } }

  const touched = await store.lock(async () => {
    if (tid == null) return 0; // no resolvable tenant → no-op, never broadcast
    let n = 0;
    const unsubs = await store.loadUnsubs(tid);
    unsubs.add(e);
    await store.saveUnsubs(tid, unsubs);
    const list = await store.load(tid);
    let changed = false;
    for (const en of list) {
      if (en.email === e && en.status === 'active') { en.status = 'unsubscribed'; n++; changed = true; }
    }
    if (changed) await store.save(tid, list);
    return n;
  });

  return { ok: true, email: e, tid, touched };
}

module.exports = { unsubscribeEmail };

'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Only account/brief/credit prerequisites are fixtures. Research, proposal,
// exact brief approval and campaign creation must come from real UI actions.
module.exports = async function creativeHandoff(browser, pool, origin, fixture) {
  assert.equal(process.env.INFOGENIE_REQUIRE_PREVIEW_TEST, '1');
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'infogenie_preview');
  assert.equal(origin, 'http://127.0.0.1:5000');
  const {tenantId, ownerId, ownerEmail, ownerPassword, briefId} = fixture;
  const credits = require('../../services/agent_orchestrator/credits');
  await require('../../services/agent_orchestrator/limits').updateLimits(pool, tenantId, {
    credit_ceiling_micros: 100000, daily_ai_cost_micros: 100000,
    monthly_ai_cost_micros: 100000, per_workflow_cost_micros: 100000,
    requests_per_minute: 60, max_concurrent_ai: 1,
  }, ownerId);
  await credits.grant({pool, tenantId, amountMicros: 100000, actorUserId: ownerId,
    idempotencyKey: 'preview-handoff-' + crypto.randomUUID()});
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  let stage = 'login';
  const errors = [], mutations = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    const url = new URL(r.url());
    if (r.method() !== 'GET' && url.pathname.startsWith('/api/agent-orchestrator/')) {
      mutations.push({method:r.method(), path:url.pathname});
    }
  });
  async function click(text) {
    await page.waitForFunction(text => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === text && !b.disabled), {}, text);
    await page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text && !b.disabled).click(), text);
  }
  async function action(text, path) {
    stage = text;
    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === path), click(text),
    ]);
    const body = await response.json();
    assert.ok(response.ok(), text + ': ' + JSON.stringify(body));
    assert.equal(body.ok, true, text + ': ' + JSON.stringify(body));
    return body;
  }
  async function read(path) {
    return page.evaluate(async path => {
      const r = await fetch(path); if (!r.ok) throw new Error('Acceptance read failed: ' + r.status);
      return r.json();
    }, path);
  }
  const api = '/api/agent-orchestrator';
  try {
    await page.goto(origin + '/login', {waitUntil:'networkidle2'});
    await page.locator('#email').fill(ownerEmail); await page.locator('#pass').fill(ownerPassword);
    await Promise.all([page.waitForNavigation({waitUntil:'networkidle2'}), page.locator('form button[type="submit"]').click()]);
    await page.goto(origin + '/manage/agent-orchestrator', {waitUntil:'networkidle2'});
    await click('New workflow');
    // Existing form labels are the accessible UI contract; no API create shortcut.
    async function fill(label, value) {
      const input = await page.evaluateHandle(label => [...document.querySelectorAll('label')]
        .find(el => el.firstChild?.textContent.trim() === label)?.querySelector('input'), label);
      assert.ok(input.asElement(), 'Missing field: ' + label);
      await input.asElement().click({clickCount:3}); await input.asElement().press('Backspace');
      await input.asElement().type(value); await input.dispose();
    }
    await fill('Name', 'DEMO real creative handoff');
    await fill('Objective', 'traffic');
    await fill('Product / service', 'DEMO coastal homeware');
    await fill('Landing page (https)', 'https://example.com/handoff');
    await fill('Workflow credit ceiling (', '0.10');
    const created = await action('Create workflow', api + '/workflows');
    const wf = created.workflow.id;
    await action('Request approval', api + '/workflows/' + wf + '/request-approval');
    await action('Approve', api + '/workflows/' + wf + '/approve');
    assert.equal(await page.$eval('input[name="metaMode"]', el => el.checked), true);
    const research = await action('Start Meta research', api + '/research/runs');
    const run = research.run.id;
    await page.waitForFunction(run => document.body.innerText.includes('Run: ' + run + ' · State: completed'), {}, run);
    await click('Refresh creative review');
    await page.waitForFunction(run => document.querySelector('[aria-label="Completed research snapshot"]')?.value === run, {}, run);
    const generated = await action('Generate proposals', api + '/proposals');
    const proposal = generated.generation;
    assert.equal(proposal.research_run_id, run); assert.equal(proposal.workflow_id, wf);
    assert.equal(proposal.provider, 'fixture');
    const image = proposal.artifacts.find(a => a.kind === 'creative_brief' && a.format === 'image');
    const video = proposal.artifacts.find(a => a.kind === 'creative_brief' && a.format === 'video');
    assert.ok(image && video); assert.equal(image.status, 'draft'); assert.equal(video.status, 'draft');
    const artifact = image.artifact_id || image.id;
    await action('Approve image brief', api + '/static-images/approve-brief');
    await page.waitForFunction(() => document.body.innerText.includes('Image brief approved.'));
    const approved = (await read(api + '/proposals?workflow_id=' + wf)).generation;
    const approvedImage = approved.artifacts.find(a => (a.artifact_id || a.id) === artifact);
    assert.equal(approvedImage.status, 'approved'); assert.ok(approvedImage.approval_id);
    assert.equal(approved.artifacts.find(a => a.format === 'video').status, 'draft', 'image approval must not approve video');
    const checkpoint = await credits.getSnapshot(pool, tenantId);
    const writesBeforeReload = mutations.length;
    stage = 'restore actual research and proposal';
    await page.goto(origin + '/manage/agent-orchestrator?workflow_id=' + wf, {waitUntil:'networkidle2'});
    await page.reload({waitUntil:'networkidle2'});
    await page.waitForFunction(id => document.body.innerText.includes('Proposal ' + id), {}, proposal.id);
    assert.equal(await page.$eval('[aria-label="Completed research snapshot"]', el => el.value), run);
    assert.deepEqual((await read(api + '/proposals?workflow_id=' + wf)).generation, approved);
    assert.equal(mutations.length, writesBeforeReload, 'restoration must not generate or approve again');
    assert.deepEqual(await credits.getSnapshot(pool, tenantId), checkpoint, 'restoration does not charge credits');
    await click('Open Campaign Journey');
    await page.waitForSelector('[name="marketing_brief"]:enabled');
    await page.select('[name="marketing_brief"]', String(briefId));
    await page.select('[name="campaign_workflow"]', wf);
    await click('Refresh creative briefs');
    await page.waitForFunction(id => [...(document.querySelector('[name="creative"]')?.options || [])].some(o => o.value === id), {}, image.id);
    assert.equal(await page.$$eval('[name="creative"] option', (options, id) => options.some(o => o.value === id), video.id), false);
    await page.select('[name="creative"]', image.id);
    await page.locator('[name="label"]').fill('DEMO generated proposal handoff');
    const saved = (await action('Save campaign draft', api + '/campaign-drafts')).draft;
    assert.equal(saved.workflow_id, wf); assert.equal(saved.tenant_id, tenantId);
    assert.deepEqual(saved.contract.creatives, [{kind:'creative_brief', asset_id:artifact, version:approvedImage.version, content_hash:approvedImage.content_hash}]);
    assert.equal(String(saved.contract.provenance.marketing_brief_id), String(briefId));
    const beforeCampaignReload = mutations.length;
    await page.reload({waitUntil:'networkidle2'});
    await page.waitForSelector('[name="marketing_brief"]:enabled');
    await page.select('[name="marketing_brief"]', String(briefId));
    await page.select('[name="campaign_workflow"]', wf);
    await page.waitForFunction(id => [...(document.querySelector('[name="saved_campaign"]')?.options || [])].some(o => o.value === id), {}, saved.id);
    await page.select('[name="saved_campaign"]', saved.id);
    await page.waitForFunction(label => document.querySelector('[name="label"]')?.value === label, {}, saved.label);
    assert.equal(await page.$eval('[name="creative"]', el => el.value), image.id);
    assert.deepEqual((await read(api + '/campaign-drafts/' + saved.id)).draft, saved);
    assert.equal(mutations.length, beforeCampaignReload);
    assert.deepEqual(await credits.getSnapshot(pool, tenantId), checkpoint, 'handoff/save/reload does not charge credits');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM orchestrator_campaign_publish_requests WHERE tenant_id=$1 AND draft_id=$2', [tenantId,saved.id])).rows[0].n, 0);
    assert.deepEqual(errors, []);
    await page.screenshot({path:'/tmp/preview-artifacts/creative-handoff-restored.png',fullPage:true});
  } catch (error) {
    await page.screenshot({path:'/tmp/preview-artifacts/creative-handoff-failure.png',fullPage:true}).catch(() => {});
    error.message = 'Creative handoff (' + stage + '): ' + error.message;
    throw error;
  } finally { await context.close(); }
};

'use strict';
const assert = require('node:assert/strict');

// Continue the UI-created proposal; never seed jobs, outputs or approvals.
module.exports = async function fixtureMedia({page, pool, origin, tenantId, wf, proposal,
  approvedImage, saved, credits, mutations, action, read}) {
  assert.equal(process.env.INFOGENIE_REQUIRE_PREVIEW_TEST, '1');
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'infogenie_preview');
  assert.equal(origin, 'http://127.0.0.1:5000');
  assert.equal(require('../../services/infra/object_storage').s3Configured(), false,
    'fixture worker must use local disposable storage, never S3');
  const api = '/api/agent-orchestrator';
  await page.goto(origin + '/manage/agent-orchestrator?workflow_id=' + wf, {waitUntil:'networkidle2'});
  await page.waitForFunction(id => document.body.innerText.includes('Proposal ' + id), {}, proposal.id);
  async function confirm(label) {
    const control = await page.evaluateHandle(label => [...document.querySelectorAll('label')]
      .find(el => el.textContent.trim() === label)?.querySelector('input[type="checkbox"]'), label);
    assert.ok(control.asElement(), 'Missing confirmation: ' + label);
    assert.equal(await control.evaluate(el => el.checked), false);
    await control.asElement().click(); await control.dispose();
  }
  async function disabled(text) {
    assert.equal(await page.evaluate(text => [...document.querySelectorAll('button')]
      .find(el => el.textContent.trim() === text)?.disabled, text), true);
  }
  await disabled('Generate static image');
  await confirm('I confirm generation of this exact approved proposal version');
  const imageJob = (await action('Generate static image', api + '/static-images')).job;
  assert.equal(imageJob.workflow_id, wf); assert.equal(imageJob.proposal_id, proposal.id);
  assert.equal(imageJob.proposal_version, proposal.version);
  assert.equal(imageJob.provider, 'placeholder');
  const binding = (await pool.query('SELECT approval_id, approval_hash FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2',
    [tenantId,imageJob.id])).rows[0];
  assert.equal(String(binding.approval_id), String(approvedImage.approval_id));
  assert.equal(binding.approval_hash, approvedImage.approval_hash);
  // Scheduling stays off. Explicitly drain only this synthetic tenant's real
  // worker with its fixture adapter; no live adapter or background tick is used.
  const {createGenerationRuntime} = require('../../services/agent_orchestrator/generation_adapter');
  assert.equal(await require('../../services/agent_orchestrator/generation_jobs').processStaticImageJobs(pool,
    {tenantId, runtime:createGenerationRuntime({mode:'fixture'})}), 1);
  await page.waitForFunction(id => document.body.innerText.includes('Job ' + id + ' · succeeded'), {}, imageJob.id);
  const image = (await read(api + '/static-images/' + imageJob.id)).job;
  assert.equal(image.asset.honesty_class, 'fixture');
  assert.equal(image.asset.mime_type, 'image/png');
  assert.equal(image.asset.width_px, 1); assert.equal(image.asset.height_px, 1);
  await page.waitForFunction(() => {
    const image = document.querySelector('img[alt="Generated static advertisement"]');
    return image?.complete && image.naturalWidth === 1 && image.naturalHeight === 1;
  });
  assert.ok(await page.evaluate(() => document.body.innerText.includes('Fixture / synthetic output — not live-provider generated.')));
  await action('Approve video brief', api + '/video-jobs/approve-brief');
  await page.waitForFunction(() => document.body.innerText.includes('Video brief approved.'));
  const approved = (await read(api + '/proposals?workflow_id=' + wf)).generation;
  assert.deepEqual(approved.artifacts.find(a => a.format === 'image'), approvedImage,
    'separate video approval must leave exact image approval intact');
  const videoBrief = approved.artifacts.find(a => a.format === 'video');
  assert.equal(videoBrief.status, 'approved');
  assert.notEqual(videoBrief.approval_id, approvedImage.approval_id);
  await disabled('Enqueue video job');
  await confirm('I confirm enqueue of this exact approved proposal version');
  const videoJob = (await action('Enqueue video job', api + '/video-jobs')).job;
  assert.equal(videoJob.workflow_id, wf); assert.equal(videoJob.proposal_id, proposal.id);
  assert.equal(videoJob.proposal_version, proposal.version);
  assert.equal(videoJob.approval_hash, videoBrief.approval_hash);
  const {createVideoRuntime} = require('../../services/agent_orchestrator/video_adapter');
  assert.equal(await require('../../services/agent_orchestrator/video_jobs').processVideoJobs(pool,
    {tenantId, runtime:createVideoRuntime()}), 1);
  await page.waitForFunction(id => document.body.innerText.includes('Job ' + id + ' · succeeded'), {}, videoJob.id);
  const video = (await read(api + '/video-jobs/' + videoJob.id)).job;
  assert.equal(video.output.honesty_class, 'fixture'); assert.equal(video.output.provenance, 'fixture');
  assert.equal(video.output.storage_ref, 'orchestrator/video/' + tenantId + '/' + videoJob.id);
  assert.equal(await page.$('video'), null);
  assert.ok(await page.evaluate(() => document.body.innerText.includes('Fixture / synthetic — not live-provider generated. No finished video is stored.')));
  await page.screenshot({path:'/tmp/preview-artifacts/fixture-media-completed.png',fullPage:true});
  const accounting = await credits.getSnapshot(pool, tenantId), writes = mutations.length;
  await page.reload({waitUntil:'networkidle2'});
  await page.waitForFunction(id => document.body.innerText.includes('Proposal ' + id), {}, proposal.id);
  assert.deepEqual((await read(api + '/proposals?workflow_id=' + wf)).generation, approved);
  assert.deepEqual((await read(api + '/static-images/' + imageJob.id)).job, image);
  assert.deepEqual((await read(api + '/video-jobs/' + videoJob.id)).job, video);
  assert.deepEqual((await read(api + '/campaign-drafts/' + saved.id)).draft, saved);
  assert.equal(mutations.length, writes, 'reload must not regenerate, enqueue or approve');
  assert.deepEqual(await credits.getSnapshot(pool, tenantId), accounting, 'reload must not charge');
  await disabled('Generate static image'); await disabled('Enqueue video job');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM orchestrator_campaign_publish_requests WHERE tenant_id=$1',
    [tenantId])).rows[0].n, 0);
};

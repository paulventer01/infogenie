'use strict';
const assert = require('node:assert/strict');

// Reuse the real login/Next/Express/PostgreSQL harness. Only upstream article
// generation and the reserved WordPress provider are fixtures; publishing isn't.
module.exports = async function wordpressSafety({page, baseUrl, actors, db}) {
  const pool=db.getPool(), tids=[actors.owner.tid,actors.other.tid];
  await require('../../services/wordpress/schema').ensureWordpressSchema();
  const provider=require('./wordpress-provider-fixture')();
  const scanner=require('../../services/ai_governance/output_gate'), originalScan=scanner.scanOutput;
  const sites=[];
  try {
    for (const tid of tids) sites.push((await pool.query(`INSERT INTO wordpress_sites
      (tenant_id,name,site_url,username,app_password) VALUES ($1,'DEMO WordPress','https://wordpress.example.test','fixture','synthetic-only') RETURNING id`,[tid])).rows[0].id);
    page.removeAllListeners('request');
    page.on('request', request => {
      const url=new URL(request.url());
      if (!['data:','blob:'].includes(url.protocol) && url.origin!==baseUrl) return void request.abort('blockedbyclient');
      if (url.pathname==='/api/content-modes/generate') return void request.respond({status:200,contentType:'application/json',
        body:JSON.stringify({ok:true,article:{title:'DEMO article',intro:'Learn about marketing.',meta_description:'A useful guide.'},source:'fixture'})});
      if (request.method()==='GET' && url.pathname.startsWith('/api/') &&
          !['/api/auth/me','/api/wordpress/sites'].includes(url.pathname)) return void request.respond({status:200,contentType:'application/json',body:'{"ok":false}'});
      void request.continue();
    });
    page.on('dialog', dialog=>dialog.dismiss());
    async function click(text) {
      await page.waitForFunction(text=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===text&&!b.disabled),{},text);
      await page.evaluate(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text&&!b.disabled).click(),text);
    }
    async function submit() {
      const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/wordpress/publish'&&r.request().method()==='POST'),click('📤 Publish to WordPress')]);
      return {status:response.status(),body:await response.json()};
    }
    await page.goto(baseUrl+'/create/content-modes',{waitUntil:'networkidle2'});
    await page.locator('input[placeholder="e.g. best running shoes 2026"]').fill('DEMO guide');
    await click('✍️ Generate Article'); await click('📤 Publish to WP');
    // The modal is the only fixed overlay with its title input.
    const title=await page.evaluateHandle(()=>[...document.querySelectorAll('label')]
      .find(l=>l.textContent==='POST TITLE').parentElement.querySelector('input'));
    async function setTitle(value) {
      await title.asElement().click({clickCount:3}); await title.asElement().press('Backspace'); await title.asElement().type(value);
    }
    await setTitle('guaranteed returns');
    assert.equal((await submit()).status,403);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('Revise the title'));
    assert.equal(await title.evaluate(el=>el.value),'guaranteed returns','blocked submission preserves edits');
    assert.equal(provider.calls.length,0);
    await setTitle('DEMO revised title');
    scanner.scanOutput=()=>{throw new Error('synthetic scanner outage');};
    assert.equal((await submit()).status,503);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('Nothing was sent to WordPress'));
    assert.equal(await title.evaluate(el=>el.value),'DEMO revised title');
    scanner.scanOutput=originalScan;
    assert.equal(provider.calls.length,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM wordpress_publish_log WHERE tenant_id=ANY($1::int[])',[tids])).rows[0].n,0);
    // Cross-tenant ID cannot reach the scanner/provider even with a valid login.
    const foreign=await page.evaluate(async id=>{
      const r=await fetch('/api/wordpress/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({site_id:id,title:'Safe title',content:'Safe content'})});
      return {status:r.status,body:await r.json()};
    },sites[1]);
    assert.equal(foreign.status,404); assert.equal(provider.calls.length,0);
    await pool.query(`INSERT INTO ai_governance_policies (id,tenant_id,content_safety_mode,content_safety_explicit)
      VALUES ($1,$2,'warning_only',true) ON CONFLICT (tenant_id) DO UPDATE SET content_safety_mode='warning_only',content_safety_explicit=true`,['wp-fixture-'+tids[0],tids[0]]);
    await setTitle('guaranteed returns');
    const allowed=await submit();
    assert.equal(allowed.status,200); assert.ok(allowed.body.content_safety_warnings.length);
    await page.waitForFunction(()=>document.body.innerText.includes('CONTENT SAFETY WARNINGS'));
    assert.equal(provider.calls.length,1); assert.equal(provider.calls[0].body.status,'draft');
    assert.equal(provider.calls[0].body.title,'guaranteed returns');
    const logs=(await pool.query('SELECT tenant_id,site_id,title,status FROM wordpress_publish_log WHERE tenant_id=ANY($1::int[])',[tids])).rows;
    assert.deepEqual(logs,[{tenant_id:tids[0],site_id:sites[0],title:'guaranteed returns',status:'draft'}]);
    await title.dispose();
  } finally {
    scanner.scanOutput=originalScan; provider.restore();
    await pool.query('DELETE FROM wordpress_publish_log WHERE site_id=ANY($1::int[])',[sites]);
    await pool.query('DELETE FROM wordpress_sites WHERE id=ANY($1::int[])',[sites]);
  }
};

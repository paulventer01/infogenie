'use strict';
const assert=require('node:assert/strict');

module.exports=async function reviewApproval({page,baseUrl,actors,db}) {
  const pool=db.getPool(), tids=[actors.owner.tid,actors.other.tid];
  await require('../../services/review_monitor/reply_schema').ensureReviewReplySchema();
  const scanner=require('../../services/ai_governance/output_gate'), scan=scanner.scanOutput;
  const ids=[];
  const seed=async (tid,text)=>{
    const r=await pool.query(`INSERT INTO review_reply_drafts
      (tenant_id,platform,reviewer_name,rating,review_text,ai_draft_reply)
      VALUES ($1,'DEMO','DEMO reviewer',5,'DEMO review',$2) RETURNING id`,[tid,text]);
    ids.push(r.rows[0].id);return r.rows[0].id;
  };
  const read=async id=>(await pool.query('SELECT status,ai_draft_reply,content_safety_warnings FROM review_reply_drafts WHERE id=$1',[id])).rows[0];
  const approve=(id,body={})=>page.evaluate(async(id,body)=>{
    const r=await fetch(`/api/review-monitor/replies/${id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  },id,body);
  try {
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce',content_safety_explicit=true WHERE tenant_id=$1",[tids[0]]);
    const id=await seed(tids[0],'guaranteed returns'), foreign=await seed(tids[1],'FOREIGN private reply');
    page.removeAllListeners('request');
    page.on('request',r=>{
      const url=new URL(r.url());
      if(!['data:','blob:'].includes(url.protocol)&&url.origin!==baseUrl) return void r.abort('blockedbyclient');
      if(r.method()==='GET'&&url.pathname.startsWith('/api/')&&url.pathname!=='/api/auth/me'&&!url.pathname.startsWith('/api/review-monitor/')) {
        return void r.respond({status:200,contentType:'application/json',body:'{"ok":false}'});
      }
      void r.continue();
    });
    await page.goto(baseUrl+'/analyse/review-automation',{waitUntil:'networkidle2'});
    await page.waitForSelector('.replies-section textarea');
    assert.equal((await approve(id)).status,403,'legacy client rechecks stored unsafe copy');
    assert.equal((await approve(foreign)).status,404);
    assert.doesNotMatch(await page.evaluate(()=>document.body.innerText),/FOREIGN private reply/);
    const submit=async()=>{
      const [r]=await Promise.all([page.waitForResponse(r=>r.url()===`${baseUrl}/api/review-monitor/replies/${id}/approve`),
        page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Approve reply').click())]);
      return {status:r.status(),body:await r.json()};
    };
    await page.locator('.replies-section textarea').fill('guaranteed returns edited');
    assert.equal((await submit()).status,403);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('Revise the reply'));
    assert.equal(await page.$eval('textarea',e=>e.value),'guaranteed returns edited');
    assert.equal((await read(id)).ai_draft_reply,'guaranteed returns');
    await page.locator('.replies-section textarea').fill('Thank you for your feedback.');
    scanner.scanOutput=()=>{throw new Error('synthetic scanner outage');};
    assert.equal((await submit()).status,503);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('temporarily unavailable'));
    assert.equal((await read(id)).status,'pending');
    assert.equal(await page.$eval('textarea',e=>e.value),'Thank you for your feedback.');
    scanner.scanOutput=scan;
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tids[0]]);
    await page.locator('.replies-section textarea').fill('guaranteed returns edited');
    const allowed=await submit();assert.equal(allowed.status,200);assert.ok(allowed.body.content_safety_warnings.length);
    await page.waitForFunction(()=>!document.querySelector('.replies-section textarea')&&document.body.innerText.includes('CONTENT SAFETY WARNINGS'));
    assert.deepEqual(await read(id),{status:'approved',ai_draft_reply:'guaranteed returns edited',content_safety_warnings:allowed.body.content_safety_warnings});
    assert.equal((await approve(id)).status,409);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tids[0]]);
    // Real row locks force the HTTP approval to reach its UPDATE before a
    // competing edit is committed, proving compare-and-set with PostgreSQL.
    const raceId=await seed(tids[0],'Thank you.');
    const lock=await pool.connect();
    let pending;
    try {
      await lock.query('BEGIN');await lock.query('SELECT id FROM review_reply_drafts WHERE id=$1 FOR UPDATE',[raceId]);
      pending=approve(raceId);
      let waiting=false;
      for(let n=0;n<200&&!waiting;n++) {
        waiting=(await pool.query('SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',[lock.processID])).rows.length>0;
        if(!waiting) await new Promise(r=>setTimeout(r,25));
      }
      assert.ok(waiting,'approval reaches locked row after scan');
      await lock.query("UPDATE review_reply_drafts SET ai_draft_reply='guaranteed returns' WHERE id=$1",[raceId]);
      await lock.query('COMMIT');assert.equal((await pending).status,409);
      assert.equal((await read(raceId)).status,'pending');
    } finally { await lock.query('ROLLBACK');lock.release();if(pending) await pending; }
    const once=await seed(tids[0],'Thank you for the review.');
    const attempts=await Promise.all([approve(once),approve(once)]);
    assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
    assert.equal((await read(once)).status,'approved');
  } finally {
    scanner.scanOutput=scan;
    await pool.query('DELETE FROM ai_governance_events WHERE tenant_id=ANY($1::int[])',[tids]);
    await pool.query('DELETE FROM review_reply_drafts WHERE id=ANY($1::int[])',[ids]);
  }
};
